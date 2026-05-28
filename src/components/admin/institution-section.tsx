'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  School,
  Landmark,
  MapPin,
  Phone,
  Mail,
  Globe,
  Calendar,
  FileText,
  Loader2,
  Save,
  ImagePlus,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import { useInstitutionStore } from '@/stores/institution-store';
import type { UserProfile } from '@/lib/types';

// ─── Types ───

type InstitutionType = 'center' | 'school' | 'university';

interface InstitutionData {
  id?: string;
  name: string;
  name_en?: string | null;
  type: InstitutionType;
  logo_url?: string | null;
  tagline?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  timezone?: string | null;
  academic_year?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface InstitutionSectionProps {
  profile: UserProfile;
}

// ─── Animation variants ───

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: 'easeOut' as const },
  }),
};

// ─── Component ───

export default function InstitutionSection({ profile }: InstitutionSectionProps) {
  const { t, direction } = useTranslations();
  // ─── State ───
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [institution, setInstitution] = useState<InstitutionData>({
    name: '',
    type: 'center',
  });
  const [originalData, setOriginalData] = useState<string>('');

  // ─── Auto-migrate tagline column ───
  const [taglineMigrationStatus, setTaglineMigrationStatus] = useState<'checking' | 'migrated' | 'pending' | 'error'>('checking');

  useEffect(() => {
    // Check if the tagline column exists in the database
    const checkMigration = async () => {
      try {
        const res = await fetch('/api/migrate/tagline-column');
        const data = await res.json();
        if (data.status === 'migrated') {
          setTaglineMigrationStatus('migrated');
        } else if (data.status === 'pending') {
          setTaglineMigrationStatus('pending');
        } else {
          setTaglineMigrationStatus('error');
        }
      } catch {
        setTaglineMigrationStatus('error');
      }
    };
    checkMigration();
  }, []);

  // ─── Fetch institution data ───
  const fetchInstitution = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/setup');
      if (res.ok) {
        const data = await res.json();
        if (data.institution) {
          const inst = data.institution as InstitutionData;
          setInstitution(inst);
          setOriginalData(JSON.stringify(inst));
          // Update the global institution store so header/auth pages reflect changes
          useInstitutionStore.getState().setInstitution(inst);
        }
      }
    } catch {
      // Silent error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstitution();
  }, [fetchInstitution]);

  // ─── Track changes ───
  useEffect(() => {
    setHasChanges(JSON.stringify(institution) !== originalData);
  }, [institution, originalData]);

  // ─── Update field helper ───
  const updateField = (field: keyof InstitutionData, value: string | null) => {
    setInstitution((prev) => ({ ...prev, [field]: value }));
  };

  // ─── Logo upload ───
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('admin.institutionLogo') + ': ' + t('common.error'));
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('common.error'));
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use the dedicated institution-logo endpoint instead of /api/avatar
      // This avoids overwriting the user's avatar_url in the database
      const res = await fetch('/api/institution-logo', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success && data.url) {
        updateField('logo_url', data.url);
        toast.success(t('common.success'));
      } else {
        toast.error(data.error || t('common.unexpectedError'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setUploadingLogo(false);
    }
  };

  // ─── Save handler ───
  const handleSave = async () => {
    if (!institution.name.trim()) {
      toast.error(t('admin.institutionName') + ': ' + t('common.required'));
      return;
    }
    if (!institution.type) {
      toast.error(t('admin.institutionType') + ': ' + t('common.required'));
      return;
    }

    setSaving(true);
    try {
      // Get auth token for the request
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'save_institution',
          name: institution.name.trim(),
          nameEn: institution.name_en?.trim() || null,
          type: institution.type,
          logo_url: institution.logo_url || null,
          tagline: institution.tagline?.trim() || null,
          country: institution.country?.trim() || null,
          city: institution.city?.trim() || null,
          address: institution.address?.trim() || null,
          phone: institution.phone?.trim() || null,
          email: institution.email?.trim() || null,
          website: institution.website?.trim() || null,
          timezone: institution.timezone?.trim() || null,
          academic_year: institution.academic_year?.trim() || null,
          description: institution.description?.trim() || null,
        }),
      });

      const result = await res.json();
      if (!res.ok || result.error) {
        toast.error(result.error || t('common.unexpectedError'));
        return;
      }

      toast.success(t('common.success'));
      // Refresh data
      await fetchInstitution();
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
          <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  const institutionTypes: { key: InstitutionType; label: string; icon: React.ReactNode }[] = [
    { key: 'center', label: t('admin.institutionTypeOptions.trainingCenter'), icon: <Building2 className="h-5 w-5" /> },
    { key: 'school', label: t('admin.institutionTypeOptions.school'), icon: <School className="h-5 w-5" /> },
    { key: 'university', label: t('admin.institutionTypeOptions.university'), icon: <Landmark className="h-5 w-5" /> },
  ];

  const typeLabelMap: Record<InstitutionType, string> = {
    center: t('admin.institutionTypeOptions.trainingCenter'),
    school: t('admin.institutionTypeOptions.school'),
    university: t('admin.institutionTypeOptions.university'),
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-sky-700 dark:text-sky-400" />
            {t('admin.institutionSettings')}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('admin.institutionSettings')}</p>

          {/* Migration banner for tagline column */}
          {taglineMigrationStatus === 'pending' && (
            <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{t('admin.databaseHealth')}</p>
                <p className="text-[10px] text-amber-700 dark:text-amber-500 mt-0.5">
                  {t('admin.databaseHealth')}
                </p>
                <code className="mt-1 block text-[10px] bg-amber-100/80 rounded p-1.5 font-mono text-amber-900 select-all">
                  ALTER TABLE institution_settings ADD COLUMN IF NOT EXISTS tagline TEXT;
                </code>
              </div>
            </div>
          )}
        </div>
        {institution.name && (
          <Badge className="bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400 border-sky-200 dark:border-sky-900/60 text-xs">
            {typeLabelMap[institution.type]}
          </Badge>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ─── Left column: Logo + Type ─── */}
        <div className="space-y-4">
          {/* Logo Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <ImagePlus className="h-4 w-4 text-sky-700 dark:text-sky-400" />
              <h3 className="font-semibold text-foreground text-sm">{t('admin.institutionLogo')}</h3>
            </div>
            <div className="p-4 flex flex-col items-center gap-4">
              <div className="relative group">
                {institution.logo_url ? (
                  <img
                    src={institution.logo_url}
                    alt={t('admin.institutionLogo')}
                    className="h-28 w-28 rounded-2xl object-cover border-2 border-sky-200 dark:border-sky-900/60 shadow-sm"
                  />
                ) : (
                  <div className="h-28 w-28 rounded-2xl bg-gradient-to-br from-sky-50 to-teal-50 dark:from-sky-900/20 dark:to-teal-900/20 border-2 border-dashed border-sky-300 dark:border-sky-900/60 flex flex-col items-center justify-center gap-2">
                    <Building2 className="h-10 w-10 text-sky-400" />
                    <span className="text-[10px] text-sky-600 dark:text-sky-400">{t('common.noData')}</span>
                  </div>
                )}
                {uploadingLogo && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => document.getElementById('institution-logo-input')?.click()}
                  disabled={uploadingLogo}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  {institution.logo_url ? t('settings.changeAvatar') : t('common.add')}
                </Button>
                {institution.logo_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs text-rose-600 dark:text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    onClick={() => updateField('logo_url', null)}
                    disabled={uploadingLogo}
                  >
                    {t('common.delete')}
                  </Button>
                )}
              </div>
              <input
                id="institution-logo-input"
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
                disabled={uploadingLogo}
              />
              <p className="text-[10px] text-muted-foreground text-center">PNG, JPG {t('files.maxFileSize', { size: '2MB' })}</p>
            </div>
          </motion.div>

          {/* Institution Type Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={1}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <School className="h-4 w-4 text-sky-700 dark:text-sky-400" />
              <h3 className="font-semibold text-foreground text-sm">{t('admin.institutionType')}</h3>
            </div>
            <div className="p-4 space-y-2">
              {institutionTypes.map(({ key, label, icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateField('type', key)}
                  className={`w-full flex items-center gap-3 rounded-xl p-3 border-2 transition-all duration-200 ${
                    institution.type === key
                      ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15 text-sky-800 dark:text-sky-400 shadow-sm'
                      : 'border-border text-muted-foreground hover:border-sky-200 dark:hover:border-sky-900/60 hover:bg-sky-50/50 dark:hover:bg-sky-900/20'
                  }`}
                  disabled={saving}
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    institution.type === key ? 'bg-sky-100 dark:bg-sky-800/40' : 'bg-muted/50'
                  }`}>
                    {icon}
                  </div>
                  <span className="text-sm font-medium">{label}</span>
                  {institution.type === key && (
                    <CheckCircle2 className="h-4 w-4 ms-auto text-sky-600 dark:text-sky-400" />
                  )}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Quick info card */}
          {institution.name && (
            <motion.div
              className="rounded-xl border bg-sky-50/50 dark:bg-sky-900/15 shadow-sm overflow-hidden"
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              custom={2}
            >
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                  <span className="text-xs font-medium text-sky-800 dark:text-sky-400">{t('summary.summary')}</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('auth.name')}</span>
                    <span className="font-medium text-foreground">{institution.name}</span>
                  </div>
                  {institution.country && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('admin.institutionAddress')}</span>
                      <span className="font-medium text-foreground">{institution.country}</span>
                    </div>
                  )}
                  {institution.city && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('admin.institutionAddress')}</span>
                      <span className="font-medium text-foreground">{institution.city}</span>
                    </div>
                  )}
                  {institution.academic_year && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('admin.institutionAcademicYear')}</span>
                      <span className="font-medium text-foreground">{institution.academic_year}</span>
                    </div>
                  )}
                  {institution.updated_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('files.lastModified')}</span>
                      <span className="font-medium text-foreground">
                        {new Date(institution.updated_at).toLocaleDateString(direction === 'rtl' ? 'ar-SA' : 'en-US')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* ─── Right column: Details ─── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Basic Info Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={3}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <FileText className="h-4 w-4 text-sky-700 dark:text-sky-400" />
              <h3 className="font-semibold text-foreground text-sm">{t('settings.profile.title')}</h3>
            </div>
            <div className="p-4 space-y-4">
              {/* Institution Name (Arabic) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {t('admin.institutionName')} <span className="text-red-400">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder={t('admin.institutionName')}
                    value={institution.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    className="h-10 text-sm pe-10"
                    disabled={saving}
                  />
                  <Building2 className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Institution Name (English) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('admin.institutionName')} (EN)</Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder={t('admin.institutionNameEnPlaceholder')}
                    value={institution.name_en || ''}
                    onChange={(e) => updateField('name_en', e.target.value)}
                    className="h-10 text-sm ps-10"
                    dir="ltr"
                    disabled={saving}
                  />
                  <FileText className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Tagline */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('admin.institutionTagline')}</Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder={t('admin.institutionTagline')}
                    value={institution.tagline || ''}
                    onChange={(e) => updateField('tagline', e.target.value)}
                    className="h-10 text-sm pe-10"
                    disabled={saving}
                    maxLength={200}
                  />
                  <FileText className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
                <p className="text-[10px] text-muted-foreground">{t('admin.institutionTagline')}</p>
              </div>

              {/* Country + City */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('admin.institutionAddress')}</Label>
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder={t('admin.institutionAddress')}
                      value={institution.country || ''}
                      onChange={(e) => updateField('country', e.target.value)}
                      className="h-10 text-sm pe-10"
                      disabled={saving}
                    />
                    <MapPin className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('admin.institutionAddress')}</Label>
                  <Input
                    type="text"
                    placeholder={t('admin.institutionAddress')}
                    value={institution.city || ''}
                    onChange={(e) => updateField('city', e.target.value)}
                    className="h-10 text-sm"
                    disabled={saving}
                  />
                </div>
              </div>

              {/* Address */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('admin.institutionAddress')}</Label>
                <Input
                  type="text"
                  placeholder={t('admin.institutionAddress')}
                  value={institution.address || ''}
                  onChange={(e) => updateField('address', e.target.value)}
                  className="h-10 text-sm"
                  disabled={saving}
                />
              </div>
            </div>
          </motion.div>

          {/* Contact Info Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={4}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <Phone className="h-4 w-4 text-sky-700 dark:text-sky-400" />
              <h3 className="font-semibold text-foreground text-sm">{t('admin.institutionContact')}</h3>
            </div>
            <div className="p-4 space-y-4">
              {/* Phone + Email */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('admin.institutionPhone')}</Label>
                  <div className="relative">
                    <Input
                      type="tel"
                      placeholder="+966 5x xxx xxxx"
                      value={institution.phone || ''}
                      onChange={(e) => updateField('phone', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Phone className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('admin.institutionEmail')}</Label>
                  <div className="relative">
                    <Input
                      type="email"
                      placeholder="info@institution.com"
                      value={institution.email || ''}
                      onChange={(e) => updateField('email', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Website + Academic Year */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('admin.institutionWebsite')}</Label>
                  <div className="relative">
                    <Input
                      type="url"
                      placeholder="www.institution.com"
                      value={institution.website || ''}
                      onChange={(e) => updateField('website', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Globe className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('admin.institutionAcademicYear')}</Label>
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="2025/2026"
                      value={institution.academic_year || ''}
                      onChange={(e) => updateField('academic_year', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Timezone */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('settings.languageAndRegion')}</Label>
                <div className="relative">
                  <select
                    value={institution.timezone || 'Africa/Cairo'}
                    onChange={(e) => updateField('timezone', e.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600 appearance-none"
                    disabled={saving}
                    dir="ltr"
                  >
                    <option value="Africa/Cairo">{t('admin.cairo')} (GMT+2)</option>
                    <option value="Asia/Riyadh">{t('admin.riyadh')} (GMT+3)</option>
                    <option value="Asia/Dubai">{t('admin.dubai')} (GMT+4)</option>
                    <option value="Asia/Kuwait">{t('admin.kuwait')} (GMT+3)</option>
                    <option value="Asia/Qatar">{t('admin.qatar')} (GMT+3)</option>
                    <option value="Asia/Bahrain">{t('admin.bahrain')} (GMT+3)</option>
                    <option value="Asia/Muscat">{t('admin.muscat')} (GMT+4)</option>
                    <option value="Africa/Casablanca">{t('admin.casablanca')} (GMT+1)</option>
                    <option value="Africa/Tunis">{t('admin.tunis')} (GMT+1)</option>
                    <option value="Africa/Algiers">{t('admin.algiers')} (GMT+1)</option>
                    <option value="Asia/Amman">{t('admin.amman')} (GMT+3)</option>
                    <option value="Asia/Baghdad">{t('admin.baghdad')} (GMT+3)</option>
                    <option value="Asia/Damascus">{t('admin.damascus')} (GMT+3)</option>
                    <option value="Asia/Beirut">{t('admin.beirut')} (GMT+3)</option>
                    <option value="Asia/Jerusalem">{t('admin.jerusalem')} (GMT+3)</option>
                    <option value="Asia/Jeddah">{t('admin.jeddah')} (GMT+3)</option>
                    <option value="Europe/Istanbul">{t('admin.istanbul')} (GMT+3)</option>
                    <option value="Europe/London">{t('admin.london')} (GMT+0)</option>
                    <option value="Europe/Paris">{t('admin.paris')} (GMT+1)</option>
                    <option value="America/New_York">{t('admin.newYork')} (GMT-5)</option>
                    <option value="America/Chicago">{t('admin.chicago')} (GMT-6)</option>
                    <option value="America/Denver">{t('admin.denver')} (GMT-7)</option>
                    <option value="America/Los_Angeles">{t('admin.losAngeles')} (GMT-8)</option>
                    <option value="Asia/Tokyo">{t('admin.tokyo')} (GMT+9)</option>
                    <option value="Asia/Shanghai">{t('admin.shanghai')} (GMT+8)</option>
                    <option value="Asia/Kolkata">{t('admin.mumbai')} (GMT+5:30)</option>
                    <option value="Australia/Sydney">{t('admin.sydney')} (GMT+11)</option>
                  </select>
                  <Globe className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Description Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={5}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <FileText className="h-4 w-4 text-sky-700 dark:text-sky-400" />
              <h3 className="font-semibold text-foreground text-sm">{t('course.description')}</h3>
            </div>
            <div className="p-4">
              <textarea
                placeholder={t('course.description')}
                value={institution.description || ''}
                onChange={(e) => updateField('description', e.target.value)}
                className="w-full rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-sky-400 focus:ring-sky-400/20 px-3 py-2.5 text-sm resize-none h-24"
                disabled={saving}
              />
            </div>
          </motion.div>

          {/* Save Button */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => fetchInstitution()}
              disabled={saving || loading}
              className="h-10"
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="bg-sky-700 hover:bg-sky-800 text-white gap-1.5 h-10 min-w-[140px]"
            >
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.loading')}...
                </span>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {t('common.save')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
