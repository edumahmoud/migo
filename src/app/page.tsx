'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Loader2, BookOpen, BrainCircuit, Users, Shield, LayoutDashboard, Settings, Megaphone, Ban, TrendingUp, MessageCircle, Building2, FileText, FolderOpen, FileSpreadsheet, Bell, Activity, AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore } from '@/stores/status-store';
import { useNotificationStore } from '@/stores/notification-store';
import type { StudentSection, TeacherSection, AdminSection } from '@/lib/types';
import { setSocketAuth, destroySocket } from '@/lib/socket';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n/context';
import SupabaseConfigError from '@/components/shared/supabase-config-error';
import LoginForm from '@/components/auth/login-form';
import RegisterForm from '@/components/auth/register-form';
import ForgotPasswordForm from '@/components/auth/forgot-password-form';
import UpdatePasswordForm from '@/components/auth/update-password-form';
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
import DashboardErrorBoundary from '@/components/shared/dashboard-error-boundary';

// ─── AppErrorBoundary: wraps the entire dashboard content area ───
// Separate from DashboardErrorBoundary which wraps individual dashboards.
// This catches errors that might happen at the layout level (sidebar, header, etc.)
//
// FIX (v2): Added auto-recovery (3-second timer) and Zustand store reset
// so transient layout-level errors don't permanently crash the app.
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; onFallbackToLogin?: () => void; t?: (key: string) => string; dir?: 'rtl' | 'ltr' },
  { hasError: boolean; error: Error | null; retryKey: number; retryCount: number; autoRetrying: boolean }
> {
  private autoRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  static MAX_AUTO_RETRIES = 1; // Only auto-retry once to prevent infinite loops

  constructor(props: { children: React.ReactNode; onFallbackToLogin?: () => void; t?: (key: string) => string; dir?: 'rtl' | 'ltr' }) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0, retryCount: 0, autoRetrying: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, autoRetrying: false };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Layout-level crash:', error, errorInfo);

    // Auto-retry after 3 seconds ONLY on the first error to prevent infinite loops
    // After the first auto-retry, the user must manually click the retry button
    const nextRetryCount = this.state.retryCount + 1;
    this.setState({ retryCount: nextRetryCount });

    if (nextRetryCount <= AppErrorBoundary.MAX_AUTO_RETRIES) {
      this.setState({ autoRetrying: true });
      this.autoRecoveryTimer = setTimeout(() => {
        this.handleRetry();
      }, 3000);
    }
  }

  componentWillUnmount() {
    if (this.autoRecoveryTimer) {
      clearTimeout(this.autoRecoveryTimer);
      this.autoRecoveryTimer = null;
    }
  }

  handleRetry = () => {
    // Clear potentially corrupted localStorage flags
    try {
      localStorage.removeItem('_wsr');
      localStorage.removeItem('_sw_reload_pending');
      localStorage.removeItem('_attendo_busy');
    } catch {}

    // NOTE: We intentionally do NOT reset Zustand stores here.
    // Resetting the app store (setCurrentPage('auth')) causes the routing
    // useEffect to redirect back to the dashboard (since user is still set),
    // which triggers the same error again → infinite loop.
    // Instead, just force remount via retryKey and keep current state.

    // Force remount via retryKey and clear error state
    this.setState(prev => ({
      hasError: false,
      error: null,
      autoRetrying: false,
      retryKey: prev.retryKey + 1,
    }));
  };

  render() {
    const t = this.props.t || ((key: string) => key);
    const dir = this.props.dir || 'rtl';
    if (this.state.hasError) {
      // Auto-recovery spinner
      if (this.state.autoRetrying) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir={dir}>
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
                  <GraduationCap className="w-9 h-9 text-white" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-sky-700" />
                <span className="text-sm font-medium text-sky-800">{t('common.retrying')}</span>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir={dir}>
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-sky-100/50 p-8 text-center max-w-md mx-auto">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-4 ring-amber-100/50">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">{t('common.appError')}</h1>
            <p className="text-sm text-gray-500 mb-4">{t('common.errorUnexpected')}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button onClick={this.handleRetry} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 hover:from-sky-800 hover:to-teal-700 w-full sm:w-auto">
                <RefreshCw className="h-4 w-4" />
                {t('common.retry')}
              </button>
              {this.props.onFallbackToLogin && (
                <button onClick={this.props.onFallbackToLogin} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 w-full sm:w-auto">
                  <LogOut className="h-4 w-4" />
                  {t('common.backToLogin')}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

type AuthMode = 'login' | 'register' | 'forgot-password' | 'update-password';

// Admin navigation items (shared between admin-dashboard and profile page sidebar)
const adminNavItems = [
  { id: 'dashboard', label: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'users', label: 'nav.users', icon: <Users className="h-5 w-5" /> },
  { id: 'subjects', label: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'announcements', label: 'nav.announcements', icon: <Megaphone className="h-5 w-5" /> },
  { id: 'banned', label: 'nav.banned', icon: <Ban className="h-5 w-5" /> },
  { id: 'reports', label: 'nav.analytics', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'chat', label: 'nav.chat', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'settings', label: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
  { id: 'institution', label: 'nav.institution', icon: <Building2 className="h-5 w-5" /> },
];

// Teacher navigation items (for profile page sidebar)
const teacherNavItems = [
  { id: 'dashboard', label: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'chat', label: 'nav.chat', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'students', label: 'nav.students', icon: <Users className="h-5 w-5" /> },
  { id: 'tracking', label: 'nav.studentTracking', icon: <Activity className="h-5 w-5" /> },
  { id: 'files', label: 'nav.files', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'analytics', label: 'nav.analytics', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'notifications', label: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

// Student navigation items (for profile page sidebar)
const studentNavItems = [
  { id: 'dashboard', label: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'tracking', label: 'nav.tracking', icon: <Activity className="h-5 w-5" /> },
  { id: 'chat', label: 'nav.chat', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'teachers', label: 'nav.teachers', icon: <Users className="h-5 w-5" /> },
  { id: 'summaries', label: 'nav.summaries', icon: <FileText className="h-5 w-5" /> },
  { id: 'assignments', label: 'nav.assignments', icon: <FileSpreadsheet className="h-5 w-5" /> },
  { id: 'files', label: 'nav.files', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'notifications', label: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

function HomeContent() {
  const { user, loading, initialized, initialize, signOut, sessionKickedMessage, banInfo, passwordRecoveryMode, clearPasswordRecovery } = useAuthStore();
  const { currentPage, viewingQuizId, viewingSummaryId, profileUserId, setCurrentPage, setViewingQuizId, setViewingSummaryId, setQuizReviewMode, reset: resetAppStore, sidebarOpen, setSidebarOpen, setStudentSection, setTeacherSection, setAdminSection, studentSection: storedStudentSection, teacherSection: storedTeacherSection, adminSection: storedAdminSection, quizReviewMode } = useAppStore();
  const { cleanup: cleanupStatusStore, init: initStatusStore } = useStatusStore();
  const { cleanup: cleanupNotifications } = useNotificationStore();
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const searchParams = useSearchParams();
  const { t, dir } = useI18n();

  // ─── Early Password Recovery Detection (synchronous) ───
  // Must run BEFORE initialize() so we can prevent the SIGNED_IN race condition.
  // Supabase consumes the URL hash/query on first getSession() call, so we
  // need to capture it now before the auth store initializes.
  //
  // Detection methods:
  // 1. Implicit flow: hash contains #type=recovery or ?type=recovery (legacy)
  // 2. PKCE flow with explicit recovery: URL contains ?code=xxx AND ?type=recovery
  //
  // IMPORTANT FIX: We NO LONGER treat all ?code= URLs as recovery URLs.
  // The ?code= parameter is used for multiple PKCE flows:
  //   - Password recovery (type=recovery)
  //   - Email confirmation/verification (type=signup)
  //   - Magic link sign-in
  //   - OAuth callback
  // Previously, any ?code= URL was treated as a recovery URL, which caused
  // email confirmation to redirect to the update-password form instead of
  // the dashboard. Now we only treat it as recovery if type=recovery is also
  // present in the URL, or if the hash contains type=recovery.
  const [isRecoveryUrl] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const hash = window.location.hash;
      const search = window.location.search;
      const params = new URLSearchParams(search);
      // Only consider it a recovery URL if type=recovery is explicitly present
      // (either in hash or query params). A bare ?code= without type=recovery
      // could be email confirmation, magic link, or OAuth callback.
      return hash.includes('type=recovery') || 
             params.get('type') === 'recovery';
    } catch {
      return false;
    }
  });

  // ─── PWA Process Restore: Check for persisted session ───
  // MUST be defined BEFORE the useEffect that references it.
  // On mobile PWA, when Android kills the WebView process and restores it,
  // the app remounts from scratch. We check if the user was logged in before
  // to skip the loading spinner and render the app shell immediately.
  const [hasPersistedSession] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      // Check 1: Is this a PWA process restore? (start_url = /?pwa=1)
      const params = new URLSearchParams(window.location.search);
      const isPwaRestore = params.has('pwa');

      // Check 2: Does the app-store have a persisted user session?
      const raw = localStorage.getItem('attendo-app-store');
      if (raw) {
        const parsed = JSON.parse(raw);
        // If the user was on a non-auth page, they were logged in
        const storedPage = parsed?.state?.currentPage;
        if (storedPage && storedPage !== 'auth') return true;
      }

      // Check 3: Does Supabase have a persisted auth session?
      // This catches the case where Zustand store was cleared but Supabase session exists
      const supabaseKeys = Object.keys(localStorage).filter(k =>
        k.startsWith('sb-') && k.endsWith('-auth-token')
      );
      if (supabaseKeys.length > 0) {
        try {
          const sessionData = JSON.parse(localStorage.getItem(supabaseKeys[0]) || '');
          // If there's an access token, the user was logged in
          if (sessionData?.access_token || (Array.isArray(sessionData) && sessionData[0]?.access_token)) {
            return true;
          }
        } catch { /* ignore malformed session data */ }
      }

      // Check 4: PWA restore with busy operation flag (localStorage)
      if (isPwaRestore) {
        const busyRaw = localStorage.getItem('_attendo_busy');
        if (busyRaw) {
          try {
            const entry = JSON.parse(busyRaw);
            if (entry.busy && Date.now() - entry.ts < 5 * 60 * 1000) {
              return true;
            }
          } catch {}
        }
      }

      return false;
    } catch {
      return false;
    }
  });

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

  // ─── Password Recovery Detection ───
  // When the auth store detects a PASSWORD_RECOVERY event (user clicked
  // reset-password link from email), switch to the update-password form.
  // Also handles the case where we detected type=recovery in the URL synchronously.
  useEffect(() => {
    if (passwordRecoveryMode || isRecoveryUrl) {
      setAuthMode('update-password');
      setCurrentPage('auth');
      // Clean the URL to prevent re-detection
      try {
        window.history.replaceState({}, '', window.location.pathname);
      } catch {}
    }
  }, [passwordRecoveryMode, isRecoveryUrl, setCurrentPage]);

  // Set correct page when user state changes
  useEffect(() => {
    if (!initialized) return;

    // Don't redirect away from the setup wizard while it's in progress
    if (wizardInProgress) return;

    // ─── Don't redirect to dashboard during password recovery ───
    // When the user clicks a password reset link, we need to keep them
    // on the auth page to show the UpdatePasswordForm. Without this guard,
    // the routing useEffect redirects to the dashboard because the user
    // has a valid session (Supabase sets it during the recovery flow).
    if (passwordRecoveryMode || isRecoveryUrl) {
      if (currentPage !== 'auth') {
        setCurrentPage('auth');
      }
      return;
    }

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
      // FIX: Don't immediately redirect to auth on refresh if we have a persisted session.
      // The auth store may still be initializing (session hydration on mobile can take 2-5s).
      // Only redirect if we're confident the user is actually logged out (not just slow to load).
      // If hasPersistedSession is true, the user was logged in before — wait a bit before redirecting.
      if (hasPersistedSession) {
        // Give the auth listener a short grace period to recover the session.
        // The onAuthStateChange listener will set the user if the session is still valid.
        // Only redirect to auth after a short grace period (3s, not 10s — 10s is too long
        // and makes the app appear stuck/frozen).
        const gracePeriod = setTimeout(() => {
          // Re-check: if user is STILL null after the grace period, then truly logged out
          const currentUser = useAuthStore.getState().user;
          const currentInitialized = useAuthStore.getState().initialized;
          // Only redirect if initialization is complete and user is still null
          if (!currentUser && currentInitialized) {
            setCurrentPage('auth');
          }
        }, 3000); // 3 second grace period for session recovery
        return () => clearTimeout(gracePeriod);
      }
      setCurrentPage('auth');
    }
  }, [user, initialized, currentPage, setCurrentPage, wizardInProgress, hasPersistedSession, passwordRecoveryMode, isRecoveryUrl]);

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

  // ─── Orphaned page fix useEffect ───
  // MUST be called before any early returns to obey React's Rules of Hooks.
  // Previously this was after early returns, causing "Rendered more hooks than
  // previous render" when transitioning from auth page to dashboard.
  useEffect(() => {
    if (currentPage === 'quiz' && !viewingQuizId) {
      setCurrentPage(
        user?.role === 'superadmin' || user?.role === 'admin'
          ? 'admin-dashboard'
          : user?.role === 'teacher'
            ? 'teacher-dashboard'
            : 'student-dashboard'
      );
    }
    if (currentPage === 'summary') {
      if (viewingSummaryId) {
        setViewingSummaryId(null);
      } else {
        setCurrentPage(
          user?.role === 'superadmin' || user?.role === 'admin'
            ? 'admin-dashboard'
            : user?.role === 'teacher'
              ? 'teacher-dashboard'
              : 'student-dashboard'
        );
      }
    }
  }, [currentPage, viewingQuizId, viewingSummaryId, user?.role, setCurrentPage, setViewingSummaryId]);

  // ─── Shared sign-out handler ───
  // MUST be defined before any early returns to obey React's Rules of Hooks.
  // Previously this was after early returns, causing hook count mismatch.
  const handleSignOut = useCallback(() => {
    setCurrentPage('auth');
    destroySocket();
    cleanupStatusStore();
    cleanupNotifications();
    try { localStorage.removeItem('attendo-app-store'); } catch {}
    resetAppStore();
    try {
      signOut();
    } catch (err) {
      console.warn('[handleSignOut] signOut() threw, but UI is already on auth page:', err);
    }
  }, [signOut, destroySocket, cleanupStatusStore, cleanupNotifications, resetAppStore, setCurrentPage]);

  // ─── Supabase Configuration Check ───
  // If Supabase is not configured, show a clear error page
  if (!isSupabaseConfigured) {
    return <SupabaseConfigError />;
  }

  // hasPersistedSession is defined at the top of the component (before useEffects)
  // to avoid ReferenceError from temporal dead zone.

  // Show loading spinner ONLY if:
  // 1. Auth is still loading AND we don't have a persisted session (fresh start)
  // 2. Setup check isn't done yet — BUT if we have a persisted session, skip this too!
  //    (setupCheckDone requires a network call that can be slow on mobile)
  const showFullLoading = (loading || !initialized) && !hasPersistedSession;
  if (showFullLoading || (!setupCheckDone && !hasPersistedSession)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={dir}>
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
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
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
  // FIX: Don't show auth page during session recovery (hasPersistedSession).
  // When refreshing, user starts as null while the session is being hydrated.
  // If we have a persisted session, show a loading spinner instead of the login page
  // to prevent the jarring flash of login → dashboard.
  if ((!user && hasPersistedSession) || (loading && hasPersistedSession && !initialized)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={dir}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user || currentPage === 'auth') {
    return (
      <div className="min-h-screen flex flex-col lg:flex-row" dir={dir}>
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
              transition={{ duration: 0.7, ease: 'easeOut' as const }}
              className="text-center max-w-lg"
            >
              {/* Logo — removed per user request: no app icon on auth pages */}
              {/* <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 backdrop-blur-sm shadow-2xl border border-white/20">
                <GraduationCap className="h-10 w-10 text-white" />
              </div> */}

              <h2 className="text-3xl xl:text-4xl font-bold text-white mb-4 leading-tight">
                {t('app.platformTagline')}
              </h2>
              <p className="text-lg text-sky-100/80 mb-10 leading-relaxed">
                {t('app.platformDescription')}
              </p>

              {/* Feature cards */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: <BrainCircuit className="h-5 w-5" />, title: t('features.aiTitle'), desc: t('features.aiDesc') },
                  { icon: <BookOpen className="h-5 w-5" />, title: t('features.summarizeTitle'), desc: t('features.summarizeDesc') },
                  { icon: <Users className="h-5 w-5" />, title: t('features.trackingTitle'), desc: t('features.trackingDesc') },
                  { icon: <Shield className="h-5 w-5" />, title: t('features.securityTitle'), desc: t('features.securityDesc') },
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
          {/* Mobile-only top branding — no app icon per user request */}
          <div className="lg:hidden flex flex-col items-center mb-6">
            {/* Feature badges - mobile */}
            <div className="flex items-center gap-3 text-muted-foreground flex-wrap justify-center">
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <BrainCircuit className="w-3 h-3" />
                <span>{t('features.aiTitle')}</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <BookOpen className="w-3 h-3" />
                <span>{t('features.summarizeTitle')}</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <Users className="w-3 h-3" />
                <span>{t('features.trackingTitle')}</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium">
                <Shield className="w-3 h-3" />
                <span>{t('features.securityTitle')}</span>
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
              ) : authMode === 'update-password' ? (
                <motion.div
                  key="update-password"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <UpdatePasswordForm
                    onSuccess={() => {
                      clearPasswordRecovery();
                      setAuthMode('login');
                    }}
                  />
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

  // Quiz view — wrapped in AppErrorBoundary to prevent full app crash
  // Previously, QuizView was rendered OUTSIDE any error boundary, so any
  // unhandled error in the quiz (e.g., bad quiz data, Supabase failure)
  // would crash the entire app with no recovery.
  if (currentPage === 'quiz' && viewingQuizId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 via-slate-50 to-teal-50/30" dir={dir}>
        <AppErrorBoundary t={t} dir={dir} onFallbackToLogin={() => {
          setViewingQuizId(null);
          setCurrentPage('auth');
        }}>
          <QuizView
            quizId={viewingQuizId}
            onBack={() => {
              setViewingQuizId(null);
              setQuizReviewMode(false);
              setCurrentPage(user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' : user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard');
            }}
            profile={user}
            reviewMode={quizReviewMode}
          />
        </AppErrorBoundary>
      </div>
    );
  }

  // (orphaned quiz/summary useEffect moved before early returns — see above)

  // ─── Loading spinners for orphaned pages (while useEffect hasn't run yet) ───
  if (currentPage === 'quiz' && !viewingQuizId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={dir}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (currentPage === 'summary') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={dir}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  // Profile view — includes AppSidebar so the toggle button works
  if (currentPage === 'profile' && profileUserId) {
    const profileNavItems = (() => {
      const items = user.role === 'superadmin' || user.role === 'admin'
        ? adminNavItems
        : user.role === 'teacher'
          ? teacherNavItems
          : studentNavItems;
      return items.map(item => ({ ...item, label: t(item.label) }));
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
      <div className="flex min-h-screen bg-background" dir={dir}>
        <AppHeader
          userName={user.name}
          userId={user.id}
          userRole={user.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
          userGender={user.gender}
          titleId={user.title_id}
          avatarUrl={user.avatar_url ?? undefined}
          onSignOut={() => {
            // Same fix as handleSignOut: setCurrentPage('auth') first, then signOut
            setCurrentPage('auth');
            destroySocket();
            cleanupStatusStore();
            cleanupNotifications();
            // CRITICAL FIX (v3): Directly clear persisted store from localStorage
            // before resetAppStore() to prevent re-hydration of stale state
            try { localStorage.removeItem('attendo-app-store'); } catch {}
            resetAppStore();
            try {
              signOut();
            } catch (err) {
              console.warn('[AppHeader onSignOut] signOut() threw:', err);
            }
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
  // SAFETY: Ensure user is not null before rendering dashboard content.
  // If user becomes null (e.g., auth timeout with persisted session), redirect to auth.
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={dir}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  // (handleSignOut moved before early returns — see above)

  // ─── Dashboard content wrapped in Error Boundary ───
  // CRITICAL FIX: Wrap dashboard in DashboardErrorBoundary to prevent
  // post-login crashes. Without this, any unhandled error in StudentDashboard,
  // TeacherDashboard, or AdminDashboard propagates to the route-level error.tsx,
  // which shows "حدث خطأ غير متوقع" and the user sees the app as "crashed".
  const dashboardContent = (() => {
    // Check if user is banned (but not admin - admins can't be banned)
    const isBannedUser = banInfo && user.role !== 'admin' && user.role !== 'superadmin';

    // Superadmin or Admin dashboard
    if (user.role === 'superadmin' || user.role === 'admin' || currentPage === 'admin-dashboard') {
      return (
        <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
          <AdminDashboard
            profile={user}
            onSignOut={handleSignOut}
          />
        </DashboardErrorBoundary>
      );
    }

    // Teacher dashboard
    if (user.role === 'teacher' || currentPage === 'teacher-dashboard') {
      const teacherContent = (
        <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
          <TeacherDashboard
            profile={user}
            onSignOut={handleSignOut}
          />
        </DashboardErrorBoundary>
      );
      return isBannedUser ? <BannedUserOverlay>{teacherContent}</BannedUserOverlay> : teacherContent;
    }

    // Student dashboard (default)
    const studentContent = (
      <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
        <StudentDashboard
          profile={user}
          onSignOut={handleSignOut}
        />
      </DashboardErrorBoundary>
    );
    return isBannedUser ? <BannedUserOverlay>{studentContent}</BannedUserOverlay> : studentContent;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-50/50 to-sky-50/30" dir={dir}>
      <AppErrorBoundary t={t} dir={dir} onFallbackToLogin={handleSignOut}>
        {dashboardContent}
      </AppErrorBoundary>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
                <GraduationCap className="w-9 h-9 text-white" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
              <span className="text-sm font-medium text-sky-800">...</span>
            </div>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
