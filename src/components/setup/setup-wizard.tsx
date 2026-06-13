'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  User,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

// ─── Types ───

type WizardStep = 'db-migration' | 'admin-account' | 'complete';

interface SetupWizardProps {
  onComplete: () => void;
  onStart?: () => void;
  onError?: () => void;
}

// ─── Password Strength ───

function getPasswordStrength(password: string) {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { score, labelKey: 'weak', color: 'bg-red-500' };
  if (score <= 2) return { score, labelKey: 'fair', color: 'bg-yellow-500' };
  if (score <= 3) return { score, labelKey: 'good', color: 'bg-blue-500' };
  return { score, labelKey: 'strong', color: 'bg-teal-500' };
}

// ─── Step Indicator ───

function StepIndicator({ currentStep, showMigration }: { currentStep: WizardStep; showMigration: boolean }) {
  const { t } = useTranslations('setup');
  const steps = [
    ...(showMigration ? [{ key: 'db-migration' as const, label: t('dbSetup'), num: 0 }] : []),
    { key: 'admin-account' as const, label: t('adminAccount'), num: showMigration ? 2 : 1 },
    { key: 'complete' as const, label: t('done'), num: showMigration ? 3 : 2 },
  ];

  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, idx) => {
        const isActive = idx === currentIndex;
        const isDone = idx < currentIndex;
        return (
          <div key={step.key} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 ${
                  isDone
                    ? 'bg-sky-600 text-white'
                    : isActive
                    ? 'bg-sky-700 text-white shadow-lg shadow-sky-500/30'
                    : 'bg-white/20 text-white/60'
                }`}
              >
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : step.num}
              </div>
              <span
                className={`text-xs font-medium transition-colors ${
                  isActive ? 'text-white' : isDone ? 'text-sky-200' : 'text-white/50'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`h-0.5 w-8 rounded-full transition-colors ${
                  idx < currentIndex ? 'bg-sky-400' : 'bg-white/20'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───

export default function SetupWizard({ onComplete, onStart, onError }: SetupWizardProps) {
  const { t, direction } = useTranslations('setup');
  const { t: tc } = useTranslations('common');
  const { t: ta } = useTranslations('auth');
  const [step, setStep] = useState<WizardStep>('admin-account');
  const [tableExists, setTableExists] = useState(true);

  // Check if the institution_settings table exists on mount
  useEffect(() => {
    fetch('/api/setup')
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('json')) {
          try {
            const data = await res.json();
            if (data.tableExists === false) {
              setTableExists(false);
              setStep('db-migration');
            }
          } catch {
            // JSON parse failed — ignore
          }
        }
      })
      .catch(() => {});
  }, []);

  // ─── Step 1: Admin Account ───
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [checkingMigration, setCheckingMigration] = useState(false);

  const passwordStrength = useMemo(() => getPasswordStrength(adminPassword), [adminPassword]);

  // ─── Step 1: Create admin account ───
  const handleCreateAdmin = async () => {
    if (!adminName.trim()) {
      toast.error(t('pleaseEnterAdminName'));
      return;
    }
    if (!adminEmail.trim()) {
      toast.error(t('pleaseEnterAdminEmail'));
      return;
    }
    if (!adminPassword) {
      toast.error(t('pleaseEnterPassword'));
      return;
    }
    if (adminPassword.length < 6) {
      toast.error(ta('passwordMinLength'));
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      toast.error(ta('passwordsDontMatch'));
      return;
    }

    setCreatingAccount(true);
    onStart?.();

    // CRITICAL: Set _loginInProgress flag to prevent onAuthStateChange
    // from overwriting the correct profile with a fallback (role='student')
    useAuthStore.getState().setLoginInProgress(true);

    try {
      // Sign up with role = superadmin
      const { data: signUpData, error: authError } = await supabase.auth.signUp({
        email: adminEmail.trim().toLowerCase(),
        password: adminPassword,
        options: {
          data: { name: adminName.trim(), role: 'superadmin' },
        },
      });

      if (authError) {
        const msg = (authError.message || '').toLowerCase();
        if (msg.includes('already registered') || msg.includes('user_already_exists')) {
          toast.error(ta('userAlreadyExists'));
        } else if (msg.includes('weak')) {
          toast.error(t('weakPasswordChooseStronger'));
        } else if (msg.includes('signup is disabled') || msg.includes('signups not allowed')) {
          toast.error(t('signupDisabled'));
        } else {
          toast.error(t('errorCreatingAccount'));
        }
        useAuthStore.getState().setLoginInProgress(false);
        onError?.();
        return;
      }

      // Check if email confirmation is required
      const needsConfirmation = !!signUpData.user && !signUpData.session;
      if (needsConfirmation) {
        toast.error(t('emailConfirmationMustBeDisabled'));
        useAuthStore.getState().setLoginInProgress(false);
        onError?.();
        return;
      }

      const authUser = signUpData.user;
      if (!authUser) {
        toast.error(t('failedToCreateAccount'));
        useAuthStore.getState().setLoginInProgress(false);
        onError?.();
        return;
      }

      // ─── IMMEDIATELY ensure superadmin role ───
      // CRITICAL: Call /api/auth/check-first-user FIRST, before /api/auth/me.
      // /api/auth/me can create the profile as 'student' and sync app_metadata
      // to 'student', which would destroy the superadmin status.
      // check-first-user sets app_metadata='superadmin' FIRST (always works),
      // then creates/updates the DB profile.
      let profile: Record<string, unknown> | null = null;
      let setupSucceeded = false;

      // Step 1: Call check-first-user IMMEDIATELY (no waiting for trigger)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const promoteRes = await fetch('/api/auth/check-first-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify({ userId: authUser.id }),
        });

        // Robust JSON parsing
        let promoteData: { success?: boolean; user?: Record<string, unknown>; warning?: string; error?: string; role?: string } | null = null;
        const promoteContentType = promoteRes.headers.get('content-type') || '';
        if (promoteRes.ok && promoteContentType.includes('json')) {
          try {
            promoteData = await promoteRes.json();
          } catch (jsonErr) {
            console.warn('[Setup] check-first-user JSON parse failed:', jsonErr);
          }
        } else if (!promoteRes.ok) {
          console.warn('[Setup] check-first-user returned status:', promoteRes.status);
          try {
            promoteData = await promoteRes.json();
          } catch {
            // Not JSON — ignore
          }
        }

        if (promoteData?.success && promoteData.user) {
          profile = promoteData.user;
          setupSucceeded = true;
          if (promoteData.warning) {
            toast.warning(promoteData.warning, { duration: 8000 });
          }
        } else if (promoteData?.success && promoteData.role === 'superadmin') {
          // Success but no user object — role is set in app_metadata
          setupSucceeded = true;
        } else {
          console.error('[Setup] check-first-user failed:', promoteData?.error);
        }
      } catch (err) {
        console.error('[Setup] check-first-user request failed:', err);
      }

      // Step 2: If check-first-user didn't return a profile, call /api/auth/me
      // This is safe now because app_metadata is already set to 'superadmin'
      if (!profile) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            const meRes = await fetch('/api/auth/me', {
              headers: { 'Authorization': `Bearer ${session.access_token}` },
            });
            if (meRes.ok) {
              const contentType = meRes.headers.get('content-type') || '';
              if (contentType.includes('json')) {
                try {
                  const meData = await meRes.json();
                  if (meData.profile) {
                    profile = meData.profile;
                  }
                } catch (jsonErr) {
                  console.warn('[Setup] /api/auth/me JSON parse failed:', jsonErr);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[Setup] /api/auth/me failed:', err);
        }
      }

      // Step 3: Final fallback — client-side query (with retries)
      if (!profile) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 1000));
          const { data: p } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();
          if (p) {
            profile = p;
            break;
          }
        }
      }

      // Step 4: Override role from app_metadata if needed
      // This handles the case where DB profile is 'student' but app_metadata says 'superadmin'
      if (profile && profile.role !== 'superadmin') {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.app_metadata?.role === 'superadmin') {
            profile = { ...profile, role: 'superadmin' };
          }
        } catch { /* ignore */ }
      }

      // Update auth store with the profile we have
      if (profile) {
        useAuthStore.getState().setUser(profile as unknown as import('@/lib/types').UserProfile);
      }

      // Show ONLY ONE toast
      if (setupSucceeded) {
        toast.success(t('adminAccountCreatedSuccess'));
      } else {
        toast.warning(t('adminAccountCreatedSuccess'), { duration: 5000 });
      }
      setStep('complete');
    } catch {
      toast.error(tc('unexpectedError'));
      onError?.();
    } finally {
      setCreatingAccount(false);
      setTimeout(() => {
        useAuthStore.getState().setLoginInProgress(false);
      }, 5000);
    }
  };

  // ─── Render Step 0: DB Migration ───
  const renderMigrationStep = () => {
    const migrationSQL = `-- انسخ هذا الكود وشغّله في محرر SQL في لوحة تحكم Supabase
-- (Dashboard → SQL Editor → New Query)
-- ثم اضغط "تم تنفيذ SQL" للاستمرار

-- 1. Institution settings table
CREATE TABLE IF NOT EXISTS institution_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_en TEXT,
  type TEXT NOT NULL CHECK (type IN ('center', 'school', 'university')),
  logo_url TEXT,
  tagline TEXT,
  country TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  timezone TEXT,
  academic_year TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE institution_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Anyone can read institution_settings" ON institution_settings
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service can insert institution_settings" ON institution_settings
    FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service can update institution_settings" ON institution_settings
    FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION update_institution_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_institution_updated_at ON institution_settings;
CREATE TRIGGER trg_institution_updated_at
  BEFORE UPDATE ON institution_settings
  FOR EACH ROW EXECUTE FUNCTION update_institution_updated_at();

-- 2. System initialized table (prevents race condition for first-user superadmin)
CREATE TABLE IF NOT EXISTS system_initialized (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initialized BOOLEAN NOT NULL DEFAULT true,
  initialized_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS system_initialized_single_row
  ON system_initialized ((initialized));

ALTER TABLE system_initialized ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service can insert system_initialized" ON system_initialized
    FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service can read system_initialized" ON system_initialized
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add superadmin to users role CHECK constraint (CRITICAL)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'teacher', 'admin', 'superadmin'));

-- 4. Update auth trigger: first user becomes superadmin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count integer;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.users;
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    CASE
      WHEN user_count = 0 THEN 'superadmin'
      ELSE COALESCE(NEW.raw_user_meta_data->>'role', 'student')
    END
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Setup initialization RPC function
CREATE OR REPLACE FUNCTION setup_initialize_system(
  p_name TEXT, p_name_en TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'center', p_logo_url TEXT DEFAULT NULL,
  p_tagline TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL, p_website TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_academic_year TEXT DEFAULT NULL, p_description TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID; v_existing_id UUID;
BEGIN
  SELECT id INTO v_existing_id FROM institution_settings LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    UPDATE institution_settings SET name=p_name, name_en=p_name_en, type=p_type,
      logo_url=p_logo_url, tagline=p_tagline, country=p_country, city=p_city, address=p_address,
      phone=p_phone, email=p_email, website=p_website, timezone=p_timezone,
      academic_year=p_academic_year, description=p_description
    WHERE id=v_existing_id;
    RETURN json_build_object('action','updated','id',v_existing_id);
  END IF;
  INSERT INTO institution_settings(name,name_en,type,logo_url,tagline,country,city,address,phone,email,website,timezone,academic_year,description)
  VALUES(p_name,p_name_en,p_type,p_logo_url,p_tagline,p_country,p_city,p_address,p_phone,p_email,p_website,p_timezone,p_academic_year,p_description)
  RETURNING id INTO v_id;
  RETURN json_build_object('action','created','id',v_id);
END;
$$;`;

    const handleCheckTable = async () => {
      setCheckingMigration(true);
      try {
        const res = await fetch('/api/setup');
        const contentType = res.headers.get('content-type') || '';
        let data: { tableExists?: boolean } | null = null;
        if (res.ok && contentType.includes('json')) {
          try {
            data = await res.json();
          } catch {
            // JSON parse failed
          }
        }
        if (data?.tableExists) {
          setTableExists(true);
          setStep('admin-account');
          toast.success(t('tableCreated'));
        } else {
          toast.error(t('tableNotCreatedExecuteSQL'));
        }
      } catch {
        toast.error(t('errorDuringVerification'));
      } finally {
        setCheckingMigration(false);
      }
    };

    return (
      <motion.div
        key="migration-step"
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -50 }}
        transition={{ duration: 0.4, ease: 'easeOut' as const }}
        className="space-y-5"
      >
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-400 to-red-500 shadow-lg">
            <GraduationCap className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">{t('dbSetup')}</h2>
          <p className="text-sky-100 mt-2 text-sm">{t('mustCreateTableFirst')}</p>
        </div>

        <div className="rounded-xl bg-amber-500/20 border border-amber-400/30 p-3 text-xs text-amber-100 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t('copySqlInstructionDetail')}</span>
        </div>

        <div className="relative">
          <pre className="rounded-xl bg-black/30 border border-white/10 p-4 text-xs text-sky-200 overflow-x-auto max-h-64 overflow-y-auto font-mono" dir="ltr">
            {migrationSQL}
          </pre>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(migrationSQL);
              toast.success(t('sqlCopied'));
            }}
            className="absolute top-2 start-2 bg-white/20 hover:bg-white/30 text-white border-0 text-xs"
          >
            {tc('copy')}
          </Button>
        </div>

        <Button
          onClick={handleCheckTable}
          disabled={checkingMigration}
          className="w-full h-12 text-base font-bold bg-gradient-to-l from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-500/25 transition-all duration-300 rounded-xl"
        >
          {checkingMigration ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{t('verifying')}</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5 me-1" />
              <span>{t('executeSQLVerify')}</span>
            </>
          )}
        </Button>
      </motion.div>
    );
  };

  // ─── Render Step 1: Admin Account ───
  const renderAdminStep = () => (
    <motion.div
      key="admin-step"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.4, ease: 'easeOut' as const }}
      className="space-y-5"
    >
      <div className="text-center mb-6">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg">
          <User className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-white">{t('createPlatformAdminAccount')}</h2>
        <p className="text-sky-100 mt-2 text-sm">{t('adminFullPrivileges')}</p>
      </div>

      {/* Admin Name */}
      <div className="space-y-1.5">
        <Label className="text-sky-100 font-medium text-sm">{t('adminName')}</Label>
        <div className="relative">
          <Input
            type="text"
            placeholder={ta('enterFullName')}
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            className="h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-amber-400 focus:ring-amber-400/20"
            disabled={creatingAccount}
            maxLength={100}
          />
          <User className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
        </div>
      </div>

      {/* Admin Email */}
      <div className="space-y-1.5">
        <Label className="text-sky-100 font-medium text-sm">{t('adminEmail')}</Label>
        <div className="relative">
          <Input
            type="email"
            placeholder="admin@institution.com"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            className="h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-amber-400 focus:ring-amber-400/20"
            disabled={creatingAccount}
            dir="ltr"
            maxLength={254}
          />
          <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
        </div>
      </div>

      {/* Admin Password */}
      <div className="space-y-1.5">
        <Label className="text-sky-100 font-medium text-sm">{t('adminPassword')}</Label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            placeholder={t('createStrongPassword')}
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            className="h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-amber-400 focus:ring-amber-400/20 pe-10 ps-10"
            disabled={creatingAccount}
            dir="ltr"
          />
          <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {adminPassword && (
          <div className="flex gap-1 mt-1">
            {[1, 2, 3, 4, 5].map((level) => (
              <div
                key={level}
                className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                  level <= passwordStrength.score ? passwordStrength.color : 'bg-white/10'
                }`}
              />
            ))}
            <span className="text-xs text-white/60 ms-2">{t('passwordStrength')}: {ta(`passwordStrength.${passwordStrength.labelKey}`)}</span>
          </div>
        )}
      </div>

      {/* Confirm Password */}
      <div className="space-y-1.5">
        <Label className="text-sky-100 font-medium text-sm">{t('confirmPassword')}</Label>
        <div className="relative">
          <Input
            type={showConfirmPassword ? 'text' : 'password'}
            placeholder={ta('reenterPassword')}
            value={adminConfirmPassword}
            onChange={(e) => setAdminConfirmPassword(e.target.value)}
            className="h-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-amber-400 focus:ring-amber-400/20 pe-10 ps-10"
            disabled={creatingAccount}
            dir="ltr"
          />
          <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
          >
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Info Box */}
      <div className="rounded-xl bg-amber-500/20 border border-amber-400/30 p-3 text-xs text-amber-100 flex items-start gap-2">
        <GraduationCap className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{t('adminSuperAdminNote')}</span>
      </div>

      {/* Create Button */}
      <Button
        onClick={handleCreateAdmin}
        disabled={creatingAccount}
        className="w-full h-12 text-base font-bold bg-gradient-to-l from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-500/25 transition-all duration-300 rounded-xl"
      >
        {creatingAccount ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{t('creating')}</span>
          </>
        ) : (
          <span>{t('createAdminAccount')}</span>
        )}
      </Button>
    </motion.div>
  );

  // ─── Render Step 2: Complete ───
  const renderCompleteStep = () => (
    <motion.div
      key="complete-step"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' as const }}
      className="text-center space-y-6"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-500 to-teal-500 shadow-2xl shadow-sky-500/30"
      >
        <CheckCircle2 className="h-12 w-12 text-white" />
      </motion.div>

      <div>
        <h2 className="text-3xl font-bold text-white mb-2">{t('setupCompleteSuccess')}</h2>
        <p className="text-sky-100 text-lg">
          {t('systemSetupSuccessPrefix')} <span className="font-bold text-amber-300">{adminName}</span>
        </p>
      </div>

      <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-white/70 text-sm">{t('adminAccount')}</span>
          <span className="text-white font-bold">{adminName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/70 text-sm">{t('adminEmail')}</span>
          <span className="text-white font-bold text-sm" dir="ltr">{adminEmail}</span>
        </div>
      </div>

      <p className="text-sky-200/70 text-sm">
        يمكنك تعديل بيانات المؤسسة من إعدادات لوحة التحكم
      </p>

      <Button
        onClick={onComplete}
        className="w-full h-12 text-base font-bold bg-gradient-to-l from-sky-600 to-teal-500 hover:from-sky-700 hover:to-teal-600 shadow-lg shadow-sky-500/25 transition-all duration-300 rounded-xl"
      >
        <span>{t('startUsingSystem')}</span>
      </Button>
    </motion.div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-sky-800 via-teal-800 to-sky-900" dir={direction}>
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -end-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -start-40 w-96 h-96 bg-teal-400/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 start-1/3 w-72 h-72 bg-sky-400/10 rounded-full blur-2xl" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6"
        >
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 shadow-lg shadow-sky-500/30">
            <GraduationCap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">{t('setupTitle')}</h1>
        </motion.div>

        {/* Step Indicator */}
        <StepIndicator currentStep={step} showMigration={!tableExists} />

        {/* Content Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 p-6 shadow-2xl"
        >
          <AnimatePresence mode="wait">
            {step === 'db-migration' && renderMigrationStep()}
            {step === 'admin-account' && renderAdminStep()}
            {step === 'complete' && renderCompleteStep()}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
