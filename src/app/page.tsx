'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Loader2, BookOpen, BrainCircuit, Users, Shield, LayoutDashboard, Settings, Megaphone, Ban, TrendingUp, MessageCircle, Building2, FileText, FolderOpen, FileSpreadsheet, Bell } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore } from '@/stores/status-store';
import { useNotificationStore } from '@/stores/notification-store';
import type { StudentSection, TeacherSection, AdminSection } from '@/lib/types';
import { setSocketAuth, destroySocket } from '@/lib/socket';
import { isSupabaseConfigured } from '@/lib/supabase';
import SupabaseConfigError from '@/components/shared/supabase-config-error';
import LoginForm from '@/components/auth/login-form';
import RegisterForm from '@/components/auth/register-form';
import ForgotPasswordForm from '@/components/auth/forgot-password-form';
import StudentDashboard from '@/components/student/student-dashboard';
import TeacherDashboard from '@/components/teacher/teacher-dashboard';
import AdminDashboard from '@/components/admin/admin-dashboard';
import QuizView from '@/components/shared/quiz-view';
import UserProfilePage from '@/components/shared/user-profile-page';
import AppHeader from '@/components/shared/app-header';
import AppSidebar from '@/components/shared/app-sidebar';
import MobileBottomNav from '@/components/shared/mobile-bottom-nav';
import SetupWizard from '@/components/setup/setup-wizard';
import BannedUserOverlay from '@/components/shared/banned-user-overlay';

type AuthMode = 'login' | 'register' | 'forgot-password';

// Admin navigation items (shared between admin-dashboard and profile page sidebar)
const adminNavItems = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'users', label: 'المستخدمون', icon: <Users className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'announcements', label: 'الإعلانات', icon: <Megaphone className="h-5 w-5" /> },
  { id: 'banned', label: 'المحظورون', icon: <Ban className="h-5 w-5" /> },
  { id: 'reports', label: 'التقارير', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'chat', label: 'المحادثات', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-5 w-5" /> },
  { id: 'institution', label: 'المؤسسة', icon: <Building2 className="h-5 w-5" /> },
];

// Teacher navigation items (for profile page sidebar)
const teacherNavItems = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'chat', label: 'المحادثات', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'students', label: 'الطلاب', icon: <Users className="h-5 w-5" /> },
  { id: 'files', label: 'ملفاتي', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'analytics', label: 'التقارير', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-5 w-5" /> },
];

// Student navigation items (for profile page sidebar)
const studentNavItems = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'chat', label: 'المحادثات', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'teachers', label: 'المعلمون', icon: <Users className="h-5 w-5" /> },
  { id: 'summaries', label: 'الملخصات', icon: <FileText className="h-5 w-5" /> },
  { id: 'assignments', label: 'المهام', icon: <FileSpreadsheet className="h-5 w-5" /> },
  { id: 'files', label: 'ملفاتي', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-5 w-5" /> },
];

function HomeContent() {
  const { user, loading, initialized, initialize, signOut, sessionKickedMessage, banInfo } = useAuthStore();
  const { currentPage, viewingQuizId, viewingSummaryId, profileUserId, setCurrentPage, setViewingQuizId, setViewingSummaryId, reset: resetAppStore, sidebarOpen, setSidebarOpen, setStudentSection, setTeacherSection, setAdminSection, studentSection: storedStudentSection, teacherSection: storedTeacherSection, adminSection: storedAdminSection } = useAppStore();
  const { cleanup: cleanupStatusStore, init: initStatusStore } = useStatusStore();
  const { cleanup: cleanupNotifications } = useNotificationStore();
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const searchParams = useSearchParams();

  // ─── Close sidebar when navigating to quiz view ───
  // Quiz view doesn't include the sidebar component, so we need to ensure
  // the mobile Sheet (portal) is closed and desktop sidebar state is reset
  // NOTE: Summary view is now rendered inside the student dashboard (with sidebar),
  // so we no longer close the sidebar for 'summary' page.
  // NOTE: Profile page DOES include AppSidebar, so we don't force-close it there
  useEffect(() => {
    if (currentPage === 'quiz') {
      if (sidebarOpen) {
        setSidebarOpen(false);
      }
    }
  }, [currentPage, sidebarOpen, setSidebarOpen]);

  // ─── Setup Wizard state ───
  const [setupCheckDone, setSetupCheckDone] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [wizardInProgress, setWizardInProgress] = useState(false);

  // Check if the system needs initial setup (no users in DB)
  const checkSetupStatus = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('/api/setup', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (!data.initialized) {
          setNeedsSetup(true);
        }
      }
    } catch {
      // timeout or error - still mark as done
    }
    setSetupCheckDone(true);
  }, []);

  // Handle setup wizard start (wizard is now active, don't interrupt it)
  const handleWizardStart = useCallback(() => {
    setWizardInProgress(true);
  }, []);

  // Handle setup wizard error (reset wizardInProgress if signup fails)
  const handleWizardError = useCallback(() => {
    setWizardInProgress(false);
  }, []);

  // Handle setup wizard completion
  const handleSetupComplete = useCallback(() => {
    setNeedsSetup(false);
    setWizardInProgress(false);
    // Re-initialize auth to pick up the new admin account
    initialize();
  }, [initialize]);

  // Check setup status on mount (before auth)
  useEffect(() => {
    checkSetupStatus();
  }, [checkSetupStatus]);

  // Handle OAuth callback parameters
  useEffect(() => {
    const authError = searchParams.get('auth_error');
    const newUser = searchParams.get('new_user');

    if (authError) {
      // Clean the URL
      window.history.replaceState({}, '', '/');
    }

    if (newUser && user) {
      // New Google OAuth user - redirect to student dashboard (default role)
      setCurrentPage('student-dashboard');
      // Clean the URL
      window.history.replaceState({}, '', '/');
    }
  }, [searchParams, user, setCurrentPage]);

  // Initialize auth on mount
  useEffect(() => {
    initialize();
    // Clear the white-screen-reload flag on successful mount
    // (so the detection script can run again if needed in a future session)
    try { localStorage.removeItem('_wsr'); } catch {}
    // Clean up ?pwa=1 query param from the URL (set by manifest start_url
    // to indicate PWA process restore). We don't want it lingering in the URL.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('pwa')) {
        params.delete('pwa');
        const cleanUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    } catch {}
  }, [initialize]);

  // Set correct page when user state changes
  useEffect(() => {
    if (!initialized) return;

    // Don't redirect away from the setup wizard while it's in progress
    if (wizardInProgress) return;

    if (user) {
      if (currentPage === 'auth') {
        setCurrentPage(
          user.role === 'superadmin' || user.role === 'admin'
            ? 'admin-dashboard'
            : user.role === 'teacher'
              ? 'teacher-dashboard'
              : 'student-dashboard'
        );
      }
    } else if (currentPage !== 'auth') {
      // Only set to auth if we're not already on auth page
      // This prevents flicker during sign-out
      setCurrentPage('auth');
    }
  }, [user, initialized, currentPage, setCurrentPage, wizardInProgress]);

  // Show auth error toast if present in URL
  useEffect(() => {
    const authError = searchParams.get('auth_error');
    if (authError) {
      import('sonner').then(({ toast }) => {
        toast.error(decodeURIComponent(authError));
      });
    }
  }, [searchParams]);

  // Show session kicked toast if another device logged in
  useEffect(() => {
    if (sessionKickedMessage) {
      import('sonner').then(({ toast }) => {
        toast.error(sessionKickedMessage, { duration: 5000 });
      });
    }
  }, [sessionKickedMessage]);

  // Initialize shared socket auth and status store when user is available
  useEffect(() => {
    if (user) {
      setSocketAuth(user.id, user.name);
      // Initialize status store at app level so online/offline tracking
      // works even before the user opens the chat section
      initStatusStore(user.id);
    } else {
      destroySocket();
      cleanupStatusStore();
      cleanupNotifications();
    }
  }, [user, initStatusStore, cleanupStatusStore]);

  // ─── Supabase Configuration Check ───
  // If Supabase is not configured, show a clear error page
  if (!isSupabaseConfigured) {
    return <SupabaseConfigError />;
  }

  // ─── PWA Process Restore: Skip full loading spinner if we have a persisted session ───
  // On mobile PWA, when Android kills the WebView process (e.g., while the native
  // file picker is open) and restores it, the app remounts from scratch. The auth
  // initialization calls supabase.auth.getSession() which can take 1-15 seconds on
  // mobile. During this time, the user sees a full-page "جاري التحميل..." spinner,
  // which they perceive as "infinity loading".
  //
  // FIX: If the Zustand app-store has a persisted navigation state that's NOT 'auth',
  // it means the user was logged in before the process was killed. We skip the full
  // loading spinner and render the app shell immediately. Auth initializes in the
  // background. This makes process restore feel instant.
  //
  // ALSO: Check for ?pwa=1 query param (set as start_url in manifest) which indicates
  // this is a PWA process restore, not a fresh browser visit. This provides an
  // additional signal to skip the loading spinner.
  const [hasPersistedSession] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      // Check 1: Is this a PWA process restore? (start_url = /?pwa=1)
      const params = new URLSearchParams(window.location.search);
      const isPwaRestore = params.has('pwa');

      // Check 2: Does the app-store have a persisted user session?
      const raw = localStorage.getItem('attendo-app-store');
      if (!raw && !isPwaRestore) return false;

      if (raw) {
        const parsed = JSON.parse(raw);
        // If the user was on a non-auth page, they were logged in
        const storedPage = parsed?.state?.currentPage;
        if (storedPage && storedPage !== 'auth') return true;
      }

      // Check 3: PWA restore with busy operation flag (localStorage)
      // This means the app was killed while the user was in the middle of something
      if (isPwaRestore) {
        const busyRaw = localStorage.getItem('_attendo_busy');
        if (busyRaw) {
          try {
            const entry = JSON.parse(busyRaw);
            if (entry.busy && Date.now() - entry.ts < 5 * 60 * 1000) {
              return true; // User was in a busy operation — definitely logged in
            }
          } catch {}
        }
      }

      return false;
    } catch {
      return false;
    }
  });

  // Show loading spinner ONLY if:
  // 1. Auth is still loading AND we don't have a persisted session (fresh start)
  // 2. Setup check isn't done yet — BUT if we have a persisted session, skip this too!
  //    (setupCheckDone requires a network call that can be slow on mobile)
  const showFullLoading = (loading || !initialized) && !hasPersistedSession;
  if (showFullLoading || (!setupCheckDone && !hasPersistedSession)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir="rtl">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-sky-600 animate-ping" />
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">جاري التحميل...</span>
          </div>
        </motion.div>
      </div>
    );
  }

  // Setup Wizard — shown when system is not initialized (no users in DB)
  // Once the wizard starts (wizardInProgress), keep showing it even after
  // the user creates their admin account and gets a session, so they can
  // complete the institution details step.
  if (needsSetup && (!user || wizardInProgress)) {
    return <SetupWizard onComplete={handleSetupComplete} onStart={handleWizardStart} onError={handleWizardError} />;
  }

  // Auth pages (login / register)
  if (!user || currentPage === 'auth') {
    return (
      <div className="min-h-screen flex flex-col lg:flex-row" dir="rtl">
        {/* ── Right Panel: Branding & Illustration (hidden on mobile) ── */}
        <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative bg-gradient-to-br from-sky-700 via-sky-800 to-teal-700 overflow-hidden">
          {/* Background decoration */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
            <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
            <div className="absolute top-1/3 left-1/3 w-72 h-72 bg-teal-400/10 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-56 h-56 bg-sky-400/10 rounded-full blur-2xl" />
            {/* Pattern overlay */}
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
          </div>

          {/* Content */}
          <div className="relative z-10 flex flex-col justify-center items-center px-12 xl:px-20 w-full">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="text-center max-w-lg"
            >
              {/* Logo */}
              <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 backdrop-blur-sm shadow-2xl border border-white/20">
                <GraduationCap className="h-10 w-10 text-white" />
              </div>

              <h2 className="text-3xl xl:text-4xl font-bold text-white mb-4 leading-tight">
                منصتك التعليمية الذكية
              </h2>
              <p className="text-lg text-sky-100/80 mb-10 leading-relaxed">
                منصة متكاملة مدعومة بالذكاء الاصطناعي للطلاب والمعلمين، توفر تلخيص ذكي، اختبارات تفاعلية، ومتابعة مستمرة
              </p>

              {/* Feature cards */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: <BrainCircuit className="h-5 w-5" />, title: 'ذكاء اصطناعي', desc: 'تلخيص وتحليل ذكي' },
                  { icon: <BookOpen className="h-5 w-5" />, title: 'تلخيص ذكي', desc: 'من أي مصدر تعليمي' },
                  { icon: <Users className="h-5 w-5" />, title: 'متابعة الطلاب', desc: 'تقارير وإحصائيات' },
                  { icon: <Shield className="h-5 w-5" />, title: 'آمن وموثوق', desc: 'حماية بياناتك' },
                ].map((feature, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                    className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-4 text-center"
                  >
                    <div className="text-teal-300">{feature.icon}</div>
                    <span className="text-sm font-semibold text-white">{feature.title}</span>
                    <span className="text-xs text-sky-200/70">{feature.desc}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>

        {/* ── Left Panel: Auth Form ── */}
        <div className="flex-1 flex flex-col justify-start pt-8 px-4 pb-4 lg:justify-center lg:items-center lg:p-8 bg-gradient-to-b from-slate-50 via-white to-sky-50/30">
          {/* Mobile-only top branding */}
          <div className="lg:hidden flex flex-col items-center mb-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 shadow-lg"
            >
              <GraduationCap className="h-7 w-7 text-white" />
            </motion.div>
            {/* Feature badges - mobile */}
            <div className="flex items-center gap-3 text-muted-foreground flex-wrap justify-center">
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <BrainCircuit className="w-3 h-3" />
                <span>ذكاء اصطناعي</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <BookOpen className="w-3 h-3" />
                <span>تلخيص ذكي</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <Users className="w-3 h-3" />
                <span>متابعة الطلاب</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <Shield className="w-3 h-3" />
                <span>آمن وموثوق</span>
              </div>
            </div>
          </div>

          {/* Auth form with mode toggle */}
          <div className="relative z-10 w-full max-w-md mx-auto">
            <AnimatePresence mode="wait">
              {authMode === 'login' ? (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 30 }}
                  transition={{ duration: 0.3 }}
                >
                  <LoginForm
                    onSwitchToRegister={() => setAuthMode('register')}
                    onForgotPassword={() => setAuthMode('forgot-password')}
                  />
                </motion.div>
              ) : authMode === 'register' ? (
                <motion.div
                  key="register"
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.3 }}
                >
                  <RegisterForm onSwitchToLogin={() => setAuthMode('login')} />
                </motion.div>
              ) : (
                <motion.div
                  key="forgot-password"
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.3 }}
                >
                  <ForgotPasswordForm onBackToLogin={() => setAuthMode('login')} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  }

  // Quiz view
  if (currentPage === 'quiz' && viewingQuizId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 via-slate-50 to-teal-50/30" dir="rtl">
        <QuizView
          quizId={viewingQuizId}
          onBack={() => {
            setViewingQuizId(null);
            setCurrentPage(user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' : user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard');
          }}
          profile={user}
        />
      </div>
    );
  }

  // ─── Orphaned 'quiz' page (currentPage='quiz' without viewingQuizId) ───
  if (currentPage === 'quiz' && !viewingQuizId) {
    setCurrentPage(
      user.role === 'superadmin' || user.role === 'admin'
        ? 'admin-dashboard'
        : user.role === 'teacher'
          ? 'teacher-dashboard'
          : 'student-dashboard'
    );
  }

  // ─── Orphaned 'summary' page ───
  // Summary view is now rendered INSIDE the student dashboard, so 'summary' currentPage
  // should never be set for students. This handles legacy persisted state or
  // teacher/admin fallback: redirect back to the appropriate dashboard.
  // For students, setViewingSummaryId(null) will restore the previousStudentSection.
  if (currentPage === 'summary') {
    // Clear the orphaned summary state and redirect
    if (viewingSummaryId) {
      setViewingSummaryId(null);
    } else {
      setCurrentPage(
        user.role === 'superadmin' || user.role === 'admin'
          ? 'admin-dashboard'
          : user.role === 'teacher'
            ? 'teacher-dashboard'
            : 'student-dashboard'
      );
    }
  }

  // Profile view — includes AppSidebar so the toggle button works
  if (currentPage === 'profile' && profileUserId) {
    const profileNavItems = (() => {
      if (user.role === 'superadmin' || user.role === 'admin') {
        return adminNavItems;
      } else if (user.role === 'teacher') {
        return teacherNavItems;
      } else {
        return studentNavItems;
      }
    })();

    const profileActiveSection = (() => {
      if (user.role === 'superadmin' || user.role === 'admin') return storedAdminSection || 'dashboard';
      if (user.role === 'teacher') return storedTeacherSection || 'dashboard';
      return storedStudentSection || 'dashboard';
    })();

    const profileSectionChangeHandler = (section: string) => {
      if (user.role === 'superadmin' || user.role === 'admin') {
        setAdminSection(section as AdminSection);
      } else if (user.role === 'teacher') {
        setTeacherSection(section as TeacherSection);
      } else {
        setStudentSection(section as StudentSection);
      }
      setCurrentPage(
        user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' :
        user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard'
      );
    };

    return (
      <div className="flex min-h-screen bg-background" dir="rtl">
        <AppHeader
          userName={user.name}
          userId={user.id}
          userRole={user.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
          userGender={user.gender}
          titleId={user.title_id}
          avatarUrl={user.avatar_url}
          onSignOut={() => {
            destroySocket();
            cleanupStatusStore();
            cleanupNotifications();
            resetAppStore();
            setCurrentPage('auth');
            signOut();
          }}
          onOpenSettings={() => {
            if (user.role === 'superadmin' || user.role === 'admin') {
              setAdminSection('settings' as AdminSection);
              setCurrentPage('admin-dashboard');
            } else if (user.role === 'teacher') {
              setTeacherSection('settings' as TeacherSection);
              setCurrentPage('teacher-dashboard');
            } else {
              setStudentSection('settings' as StudentSection);
              setCurrentPage('student-dashboard');
            }
          }}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          sidebarCollapsed={!sidebarOpen}
        />
        <AppSidebar
          role={user.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
          activeSection={profileActiveSection}
          onSectionChange={profileSectionChangeHandler}
          customNavItems={profileNavItems}
        />
        <main className={`flex-1 pt-14 sm:pt-16 pb-20 md:pb-0 transition-all duration-300 pl-0 ${
          sidebarOpen ? 'md:pr-64' : 'md:pr-[68px]'
        }`}>
          <UserProfilePage
            userId={profileUserId}
            currentUser={user}
            onBack={() => setCurrentPage(
              user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' :
              user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard'
            )}
          />
        </main>
        <MobileBottomNav
          role={user.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
          activeSection={profileActiveSection}
          onSectionChange={profileSectionChangeHandler}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>
    );
  }

  // Authenticated content wrapped with SocketProvider
  const dashboardContent = (() => {
    // Check if user is banned (but not admin - admins can't be banned)
    const isBannedUser = banInfo && user.role !== 'admin' && user.role !== 'superadmin';

    // Superadmin or Admin dashboard
    if (user.role === 'superadmin' || user.role === 'admin' || currentPage === 'admin-dashboard') {
      return (
        <AdminDashboard
          profile={user}
          onSignOut={() => {
            destroySocket();
            cleanupStatusStore();
            cleanupNotifications();
            resetAppStore();
            setCurrentPage('auth');
            signOut();
          }}
        />
      );
    }

    // Teacher dashboard
    if (user.role === 'teacher' || currentPage === 'teacher-dashboard') {
      const teacherContent = (
        <TeacherDashboard
          profile={user}
          onSignOut={() => {
            destroySocket();
            cleanupStatusStore();
            cleanupNotifications();
            resetAppStore();
            setCurrentPage('auth');
            signOut();
          }}
        />
      );
      return isBannedUser ? <BannedUserOverlay>{teacherContent}</BannedUserOverlay> : teacherContent;
    }

    // Student dashboard (default)
    const studentContent = (
      <StudentDashboard
        profile={user}
        onSignOut={() => {
          destroySocket();
          cleanupStatusStore();
          cleanupNotifications();
          resetAppStore();
          setCurrentPage('auth');
          signOut();
        }}
      />
    );
    return isBannedUser ? <BannedUserOverlay>{studentContent}</BannedUserOverlay> : studentContent;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-50/50 to-sky-50/30" dir="rtl">
      {dashboardContent}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir="rtl">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
                <GraduationCap className="w-9 h-9 text-white" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
              <span className="text-sm font-medium text-sky-800">جاري التحميل...</span>
            </div>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
