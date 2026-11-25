'use client';

import NativeStatusBarTheme from '@/components/auth/native-status-bar-theme';
import React, { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, BookOpen, BrainCircuit, Users, Shield, LayoutDashboard, Settings, TrendingUp, MessageCircle, FileText, FolderOpen, FileSpreadsheet, Bell, Activity, AlertTriangle, RefreshCw, LogOut, Search, Clock, UserCircle, Layers, DollarSign, ShieldAlert } from 'lucide-react';
import SettingsSection from '@/components/shared/settings-section';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useAnnouncementBannerStore } from '@/stores/announcement-banner-store';
import { useStatusStore } from '@/stores/status-store';
import { useNotificationStore } from '@/stores/notification-store';
import { useTranslations } from '@/i18n/use-translations';
import type { AppPage, CourseTab, StudentSection, TeacherSection, AdminSection } from '@/lib/types';
import { setSocketAuth, destroySocket } from '@/lib/socket';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n/context';
import SupabaseConfigError from '@/components/shared/supabase-config-error';
import LoginForm from '@/components/auth/login-form';
import AppVersionLabel from '@/components/auth/app-version-label';
import LearningLoader from '@/components/shared/learning-loader';
import LoginLottie from '@/components/auth/login-lottie';
import BrandingPointerZone from '@/components/auth/branding-pointer-zone';
import FloatingLoginFeatures from '@/components/auth/floating-login-features';
import AuthLanguageToggle from '@/components/auth/auth-language-toggle';
import AppHeader from '@/components/shared/app-header';
import AppSidebar from '@/components/shared/app-sidebar';
import MobileBottomNav from '@/components/shared/mobile-bottom-nav';
import { BrandLogo } from '@/components/shared/brand-logo';
import BannedUserOverlay from '@/components/shared/banned-user-overlay';
import StudentSuspensionOverlay from '@/components/shared/student-suspension-overlay';
import DashboardErrorBoundary from '@/components/shared/dashboard-error-boundary';
import PlatformAnnouncementOverlay, { useLoginAnnouncement, AnnouncementBrandingPanel } from '@/components/shared/platform-announcement-overlay';
import PlatformAnnouncementPopup from '@/components/shared/platform-announcement-popup';
import { useNavigationHistory } from '@/hooks/use-navigation-history';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';

// Code-split heavy screens: a student never downloads the admin/teacher/agent
// bundles, and the login page does not pull in any dashboard code.
function RouteLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
    </div>
  );
}
const RegisterForm = dynamic(() => import('@/components/auth/register-form'), { loading: () => <RouteLoading />, ssr: false });
const ForgotPasswordForm = dynamic(() => import('@/components/auth/forgot-password-form'), { loading: () => <RouteLoading />, ssr: false });
const UpdatePasswordForm = dynamic(() => import('@/components/auth/update-password-form'), { loading: () => <RouteLoading />, ssr: false });
const StudentDashboard = dynamic(() => import('@/components/student/student-dashboard'), { loading: () => <RouteLoading />, ssr: false });
const TeacherDashboard = dynamic(() => import('@/components/teacher/teacher-dashboard'), { loading: () => <RouteLoading />, ssr: false });
const AdminDashboard = dynamic(() => import('@/components/admin/admin-dashboard'), { loading: () => <RouteLoading />, ssr: false });
const AgentPortal = dynamic(() => import('@/components/agent/agent-portal'), { loading: () => <RouteLoading />, ssr: false });
const StudentActivationPage = dynamic(() => import('@/components/auth/student-activation-page'), { loading: () => <RouteLoading />, ssr: false });
const OtpVerificationPage = dynamic(() => import('@/components/auth/otp-verification-page'), { loading: () => <RouteLoading />, ssr: false });
const QuizView = dynamic(() => import('@/components/shared/quiz-view'), { loading: () => <RouteLoading />, ssr: false });
const UserProfilePage = dynamic(() => import('@/components/shared/user-profile-page'), { loading: () => <RouteLoading />, ssr: false });
const SetupWizard = dynamic(() => import('@/components/setup/setup-wizard'), { loading: () => <RouteLoading />, ssr: false });

// ─── AppErrorBoundary: wraps the entire dashboard content area ───
// Separate from DashboardErrorBoundary which wraps individual dashboards.
// This catches errors that might happen at the layout level (sidebar, header, etc.)
//
// FIX (v2): Added auto-recovery (3-second timer) and Zustand store reset
// so transient layout-level errors don't permanently crash the app.
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; onFallbackToLogin?: () => void; labels: { retrying: string; appError: string; unexpectedErrorDesc: string; retry: string; returnToLogin: string } },
  { hasError: boolean; error: Error | null; retryKey: number; retryCount: number; autoRetrying: boolean }
> {
  private autoRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  static MAX_AUTO_RETRIES = 1; // Only auto-retry once to prevent infinite loops

  constructor(props: { children: React.ReactNode; onFallbackToLogin?: () => void; labels: { retrying: string; appError: string; unexpectedErrorDesc: string; retry: string; returnToLogin: string } }) {
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
    const labels = this.props.labels;
    if (this.state.hasError) {
      // Auto-recovery spinner
      if (this.state.autoRetrying) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir={document.documentElement.dir as 'rtl' | 'ltr'}>
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <BrandLogo size="lg" />
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-sky-700" />
                <span className="text-sm font-medium text-sky-800">{labels.retrying}</span>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir={document.documentElement.dir as 'rtl' | 'ltr'}>
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-sky-100/50 p-8 text-center max-w-md mx-auto">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-4 ring-amber-100/50">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">{labels.appError}</h1>
            <p className="text-sm text-gray-500 mb-4">{labels.unexpectedErrorDesc}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button onClick={this.handleRetry} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 hover:from-sky-800 hover:to-teal-700 w-full sm:w-auto">
                <RefreshCw className="h-4 w-4" />
                {labels.retry}
              </button>
              {this.props.onFallbackToLogin && (
                <button onClick={this.props.onFallbackToLogin} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white dark:bg-card border border-gray-200 dark:border-border px-6 py-2.5 text-sm font-semibold text-gray-700 dark:text-foreground shadow-sm hover:bg-gray-50 dark:hover:bg-muted/50 w-full sm:w-auto">
                  <LogOut className="h-4 w-4" />
                  {labels.returnToLogin}
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

// Logical location mirrored onto the browser history so the system back
// button steps back through screens instead of exiting the app.
interface NavSnapshotFields {
  page: AppPage;
  studentSection: StudentSection;
  teacherSection: TeacherSection;
  adminSection: AdminSection;
  agentSection: string;
  quizId: string | null;
  quizReviewMode: boolean;
  summaryId: string | null;
  prevStudentSection: StudentSection | null;
  subjectId: string | null;
  courseTab: CourseTab;
  videoId: string | null;
  studentId: string | null;
  profileUserId: string | null;
}

function HomeContent() {
  const { user, loading, initialized, initialize, signOut, sessionKickedMessage, banInfo, passwordRecoveryMode, clearPasswordRecovery } = useAuthStore();
  const { currentPage, viewingQuizId, viewingSummaryId, profileUserId, setCurrentPage, setViewingQuizId, setViewingSummaryId, setQuizReviewMode, reset: resetAppStore, sidebarOpen, setSidebarOpen, setStudentSection, setTeacherSection, setAdminSection, studentSection: storedStudentSection, teacherSection: storedTeacherSection, adminSection: storedAdminSection, quizReviewMode, previousStudentSection, selectedSubjectId, courseTab, selectedVideoId, selectedStudentId } = useAppStore();
  // v113: agent portal section state
  const [agentSection, setAgentSection] = useState<string>('search');
  // v132: agent's allowed_sections (fetched from /api/agent/me).
  //   null  → all 9 sections allowed (default for legacy agents)
  //   [...] → only those sections appear in the sidebar
  //   []    → only profile appears
  // The sidebar is built dynamically from this + AGENT_SECTION_DEFS.
  const [agentAllowedSections, setAgentAllowedSections] = useState<string[] | null | undefined>(undefined);
  const { cleanup: cleanupStatusStore, init: initStatusStore } = useStatusStore();
  const { cleanup: cleanupNotifications } = useNotificationStore();
  const profileBannerHeight = useAnnouncementBannerStore((s) => s.bannerHeight);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const searchParams = useSearchParams();
  const { t, isRTL, direction } = useTranslations();

  // ─── System back button: step back through screens instead of exiting ───
  // The whole app lives on one URL, so Android/PWA back would close the app.
  // Mirror the logical location (page, role section, quiz/summary/video
  // views, profile) onto the browser history; a system back restores the
  // previous location, and at the root a "press back again to exit" toast
  // is shown instead of exiting.
  const navSnapshot = useMemo(() => {
    if (!user) return null;
    const fields: NavSnapshotFields = {
      page: currentPage,
      studentSection: storedStudentSection,
      teacherSection: storedTeacherSection,
      adminSection: storedAdminSection,
      agentSection,
      quizId: viewingQuizId,
      quizReviewMode,
      summaryId: viewingSummaryId,
      prevStudentSection: previousStudentSection,
      subjectId: selectedSubjectId,
      courseTab,
      videoId: selectedVideoId,
      studentId: selectedStudentId,
      profileUserId,
    };
    return JSON.stringify(fields);
  }, [user, currentPage, storedStudentSection, storedTeacherSection, storedAdminSection, agentSection, viewingQuizId, quizReviewMode, viewingSummaryId, previousStudentSection, selectedSubjectId, courseTab, selectedVideoId, selectedStudentId, profileUserId]);

  const handleNavRestore = useCallback((serialized: string) => {
    try {
      const snap = JSON.parse(serialized) as NavSnapshotFields;
      useAppStore.setState({
        currentPage: snap.page,
        studentSection: snap.studentSection,
        teacherSection: snap.teacherSection,
        adminSection: snap.adminSection,
        viewingQuizId: snap.quizId,
        quizReviewMode: snap.quizReviewMode,
        viewingSummaryId: snap.summaryId,
        previousStudentSection: snap.prevStudentSection,
        selectedSubjectId: snap.subjectId,
        courseTab: snap.courseTab,
        selectedVideoId: snap.videoId,
        selectedStudentId: snap.studentId,
        profileUserId: snap.profileUserId,
      });
      if (typeof snap.agentSection === 'string') {
        setAgentSection(snap.agentSection);
      }
    } catch {
      // Malformed snapshot — ignore.
    }
  }, []);

  const handleExitWarning = useCallback(() => {
    toast(t('common.pressBackAgainToExit'));
  }, [t]);

  useNavigationHistory({
    enabled: initialized && !!user && currentPage !== 'auth',
    snapshot: navSnapshot,
    onRestore: handleNavRestore,
    onExitWarning: handleExitWarning,
  });

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
  const [hasPersistedSession, setHasPersistedSession] = useState(() => {
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

  // After a real sign-out the "persisted session" flag must not keep the full-screen loader up forever.
  // It only exists to avoid a login flash while a stored session is being restored on startup.
  useEffect(() => {
    if (!hasPersistedSession || !initialized || user) return;
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().user) setHasPersistedSession(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [hasPersistedSession, initialized, user]);
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
    // Reset institution store so it re-fetches fresh data after setup
    // Without this, the store's `loaded: true` flag prevents re-fetching
    import('@/stores/institution-store').then(({ useInstitutionStore }) => {
      useInstitutionStore.getState().reset();
    }).catch(() => { /* non-critical */ });
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
      const accountStatus = (user as { account_status?: string }).account_status;
      const userPhone = (user as { phone?: string | null }).phone;
      const phoneVerified = (user as { phone_verified?: boolean }).phone_verified;

      // ─── ALWAYS check account_status for students, even if currentPage
      // is already 'student-dashboard' (from localStorage). ───
      // FIX: After logout + refresh, the stored currentPage='student-dashboard'
      // was used directly without re-checking account_status. This caused
      // students with account_status='pending' to see the full StudentDashboard
      // instead of the StudentActivationPage.
      if (user.role === 'student' && accountStatus === 'pending') {
        if (currentPage !== 'student-dashboard') {
          setCurrentPage('student-dashboard');  // dashboard switch renders ActivationPage
        }
      } else if (currentPage === 'auth') {
        // v73 resilient routing: pending_verification OR (pending + phone +
        // !phone_verified) → student dashboard (which renders OtpVerificationPage
        // in the dashboard switch below).
        const needsOtp =
          user.role === 'student' &&
          (accountStatus === 'pending_verification' ||
            (accountStatus === 'pending' && !!userPhone && phoneVerified === false));

        if (needsOtp) {
          setCurrentPage('student-dashboard');
        } else {
          setCurrentPage(
            user.role === 'superadmin' || user.role === 'admin'
              ? 'admin-dashboard'
              : user.role === 'teacher'
                ? 'teacher-dashboard'
                : user.role === 'registration_agent'
                  ? 'agent-portal'
                  : 'student-dashboard'
          );
        }
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

  // v132: Fetch the agent's allowed_sections when the user is a
  // registration_agent. The sidebar is built dynamically from this.
  // We fetch once on mount (or when user.role becomes 'registration_agent').
  useEffect(() => {
    if (user?.role !== 'registration_agent') {
      setAgentAllowedSections(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getCachedAuthHeaders } = await import('@/lib/client-auth');
        const res = await fetch('/api/agent/me', { headers: await getCachedAuthHeaders() });
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setAgentAllowedSections(json.agent?.allowed_sections ?? null);
        } else {
          // On error, default to "all sections" so the agent isn't locked out.
          setAgentAllowedSections(null);
        }
      } catch {
        if (!cancelled) setAgentAllowedSections(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.role]);

  // v132: If the current agentSection is NOT in the allowed list (and
  // it's not 'profile'/'settings' which are always allowed), reset to
  // the first allowed section. This handles the case where the teacher
  // revokes a section while the agent is viewing it.
  useEffect(() => {
    if (user?.role !== 'registration_agent') return;
    if (agentAllowedSections === undefined) return; // still loading
    if (agentSection === 'profile' || agentSection === 'settings') return;
    // Backward-compat: 'pending' is an alias for 'pendingOrders'.
    const normalized = agentSection === 'pending' ? 'pendingOrders' : agentSection;
    if (agentAllowedSections === null) return; // null = all allowed
    if (!agentAllowedSections.includes(normalized)) {
      const firstAllowed = agentAllowedSections[0] ?? 'profile';
      setAgentSection(firstAllowed);
    }
  }, [user?.role, agentAllowedSections, agentSection]);

  // v132: Build the agent sidebar nav items dynamically from
  // agentAllowedSections. `profile` is ALWAYS present (it's the
  // agent's own profile, not a teacher permission). `settings` is
  // added only when the user is on the profile/settings variant.
  const agentNavItems = useMemo(() => {
    const ALL_AGENT_SECTIONS: Array<{ id: string; label: string; icon: React.ReactNode }> = [
      { id: 'search', label: t('nav.searchStudent'), icon: <Search className="h-5 w-5" /> },
      { id: 'pendingOrders', label: t('nav.pendingOrders'), icon: <Clock className="h-5 w-5" /> },
      { id: 'dashboard', label: t('nav.home'), icon: <LayoutDashboard className="h-5 w-5" /> },
      { id: 'subjects', label: t('nav.subjects'), icon: <BookOpen className="h-5 w-5" /> },
      { id: 'students', label: t('nav.students'), icon: <Users className="h-5 w-5" /> },
      { id: 'tracking', label: t('nav.tracking'), icon: <Activity className="h-5 w-5" /> },
      { id: 'financialManagement', label: t('nav.financialManagement'), icon: <DollarSign className="h-5 w-5" /> },
      { id: 'calendar', label: t('nav.calendar'), icon: <Clock className="h-5 w-5" /> },
      { id: 'reports', label: t('nav.reports'), icon: <ShieldAlert className="h-5 w-5" /> },
    ];
    const filtered = agentAllowedSections === undefined
      ? ALL_AGENT_SECTIONS  // still loading — show all to avoid flicker
      : agentAllowedSections === null
        ? ALL_AGENT_SECTIONS  // null = all allowed
        : ALL_AGENT_SECTIONS.filter(s => agentAllowedSections.includes(s.id));
    return [
      ...filtered,
      { id: 'profile', label: t('nav.profile'), icon: <UserCircle className="h-5 w-5" /> },
    ];
  }, [agentAllowedSections, t]);

  // ─── Payment callback (UX only) ───
  // When the student returns from Paymob's hosted checkout, the backend
  // constructs the URL with `?payment_callback=success` (or `=cancelled`)
  // (see src/app/api/student/orders/[id]/pay/route.ts → redirectUrl,
  //  and Paymob's redirection_url after checkout).
  //
  // This is a UX acknowledgement ONLY. The authoritative payment
  // confirmation still flows: Paymob → /api/payment/webhook (HMAC-verified)
  // → activate_subscription_after_payment RPC. We do NOT:
  //   - Trust this query param as proof of payment
  //   - Mark any order as paid from the client
  //   - Call the activation RPC from the client
  //   - Create a payment record from the client
  //
  // We DO:
  //   - Show a toast: "Returned from gateway, payment is being confirmed."
  //     (NOT a success claim — the actual confirmation happens async via webhook)
  //   - Strip the query param from the URL (clean browser history, prevent re-trigger)
  //   - The Supabase Realtime subscription on the orders table
  //     (already set up in StudentActivationPage) picks up the
  //     status change automatically when the webhook completes.
  //   - ALSO: call /api/student/orders/verify-after-redirect to
  //     manually verify the payment via Paymob's transaction API
  //     and activate the subscription immediately (fallback if the
  //     webhook didn't fire).
  useEffect(() => {
    const paymentCallback = searchParams.get('payment_callback');
    if (paymentCallback === 'success' || paymentCallback === 'cancelled') {
      // v122 FIX: Clean the URL IMMEDIATELY (before any async work) so the
      // browser address bar shows the original app URL, not Paymob's redirect
      // URL with all its params (id, hmac, order_id, etc.).
      // We capture ALL Paymob params FIRST (for the verify-after-redirect
      // call below), THEN clean the URL.
      const allParams: Record<string, string> = {};
      const urlForCapture = new URL(window.location.href);
      urlForCapture.searchParams.forEach((value, key) => {
        allParams[key] = value;
      });
      // Re-add payment_callback (it's part of the HMAC signature)
      allParams.payment_callback = paymentCallback;

      // NOW clean the URL — replace with just the origin + pathname (no params)
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);

      import('sonner').then(({ toast }) => {
        if (paymentCallback === 'success') {
          // Informational message — NOT a success claim. The actual
          // confirmation happens asynchronously via the webhook.
          toast.info(t('student.payment.callbackReturningTitle'), {
            description: t('student.payment.callbackReturningDesc'),
            duration: 6000,
          });
        } else {
          // cancelled
          toast.info(t('student.payment.cancel'), {
            description: t('student.payment.paymentCancelledDesc'),
            duration: 5000,
          });
        }
      });

      // If success → call the verify-after-redirect endpoint to
      // manually verify the payment via Paymob and activate the
      // subscription immediately. This is a fallback for when the
      // webhook doesn't fire (common in sandbox/test mode).
      if (paymentCallback === 'success') {
        // Try to extract the transaction ID from multiple possible param names
        const transactionId = allParams.id
          || allParams.txn_id
          || allParams.transaction_id
          || allParams.txn;
        const orderId = allParams.order_id
          || allParams.orderid
          || allParams.orderId;
        const merchantOrderId = allParams.merchant_order_id
          || allParams.merchant_order_id_v2
          || allParams.merchant_order_id_z2
          || allParams.merchantOrderId
          || allParams.merchant_order_id_alias;

        console.info('[payment-callback] URL params received from Paymob redirect:', {
          allParams,
          transactionId,
          orderId,
          merchantOrderId,
        });

        // Send ALL params to the backend (the backend will try
        // multiple strategies to verify the payment)
        const callVerify = async (attempt: number) => {
          console.info(`[payment-callback] calling verify-after-redirect (attempt ${attempt})`);
          try {
            const { getCachedAuthHeaders } = await import('@/lib/client-auth');
            const headers = await getCachedAuthHeaders();
            const res = await fetch('/api/student/orders/verify-after-redirect', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify({
                transactionId,
                orderId,
                merchantOrderId,
                urlParams: allParams,
              }),
            });
            const json = await res.json();
            console.info(`[payment-callback] verify-after-redirect response (attempt ${attempt}):`, json);

            if (json.success) {
              const { toast } = await import('sonner');
              toast.success(json.message || t('nav.subscriptionActivated'), {
                duration: 4000,
              });
              // v122: URL is already clean (cleaned above). Just reload.
              window.location.reload();
              return true;
            }

            // If pending, retry after 3s (up to 10 attempts = 30s total)
            if (json.pending && attempt < 10) {
              console.info(`[payment-callback] transaction still pending — retrying in 3s (attempt ${attempt})`);
              setTimeout(() => callVerify(attempt + 1), 3000);
              return false;
            }

            // Show error to user — but also try to refresh in case
            // the webhook arrived in the meantime
            const { toast } = await import('sonner');
            toast.error(json.error || t('nav.autoVerifyFailed'), {
              duration: 8000,
            });
            // Refresh after 3s so any pending webhook result shows up
            setTimeout(() => window.location.reload(), 3000);
            return false;
          } catch (err) {
            console.error('[payment-callback] failed to call verify-after-redirect', err);
            // Retry on network error
            if (attempt < 10) {
              setTimeout(() => callVerify(attempt + 1), 3000);
            }
            return false;
          }
        };

        // Start the verification (with small initial delay to give
        // Paymob time to finalize the transaction in their system)
        setTimeout(() => callVerify(1), 2000);
      }
    }
  }, [searchParams, t]);

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
  const handleSignOut = useCallback(async () => {
    // 1. Immediately switch UI to auth page (instant feedback)
    setHasPersistedSession(false); // explicit sign-out: never show the restore loader
    setCurrentPage('auth');
    // 2. Clean up websocket, status store, notifications
    destroySocket();
    cleanupStatusStore();
    cleanupNotifications();
    // 3. Clear persisted app state from localStorage
    try { localStorage.removeItem('attendo-app-store'); } catch {}
    resetAppStore();
    // 4. AWAIT signOut — clears the Supabase session cookie.
    //    WITHOUT await, the cookie persists → on refresh the user is
    //    re-hydrated from the cookie → still logged in → sees dashboard.
    try {
      await signOut();
    } catch (err) {
      console.warn('[handleSignOut] signOut() threw, but UI is already on auth page:', err);
      // Even if signOut fails, force-clear the session by redirecting
      if (typeof window !== 'undefined') {
        window.location.href = '/?auth_error=' + encodeURIComponent(t('auth.logoutSuccess'));
      }
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
  // 2. Setup check isn't done yet — ALWAYS wait for this before showing auth page!
  //    We must know if there are users in the DB before deciding between
  //    setup wizard (no users) or login page (has users).
  //    Previously, persisted sessions skipped this check, which could flash
  //    the login page even when no users exist (fresh install after logout).
  const showFullLoading = (loading || !initialized) && !hasPersistedSession;
  if (showFullLoading || !setupCheckDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={direction}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <LearningLoader />
          </div>
          <div className="flex items-center gap-2" role="status" aria-live="polite">
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
  // CRITICAL: If needsSetup is true, ALWAYS show the wizard, even if a user
  // session exists (e.g., from another tab). The setup wizard must complete
  // before anyone can log in.
  if (needsSetup) {
    return <SetupWizard onComplete={handleSetupComplete} onStart={handleWizardStart} onError={handleWizardError} />;
  }

  // Auth pages (login / register)
  // FIX: Don't show auth page during session recovery (hasPersistedSession).
  // When refreshing, user starts as null while the session is being hydrated.
  // If we have a persisted session, show a loading spinner instead of the login page
  // to prevent the jarring flash of login → dashboard.
  if ((!user && hasPersistedSession) || (loading && hasPersistedSession && !initialized)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={direction}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <LearningLoader />
          </div>
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user || currentPage === 'auth') {
    return (
      <PlatformAnnouncementOverlay>
        <AuthPageContent
          direction={direction}
          isRTL={isRTL}
          authMode={authMode}
          setAuthMode={setAuthMode}
          clearPasswordRecovery={clearPasswordRecovery}
          t={t}
        />
      </PlatformAnnouncementOverlay>
    );
  }

  // Quiz view — wrapped in AppErrorBoundary to prevent full app crash
  // Previously, QuizView was rendered OUTSIDE any error boundary, so any
  // unhandled error in the quiz (e.g., bad quiz data, Supabase failure)
  // would crash the entire app with no recovery.
  if (currentPage === 'quiz' && viewingQuizId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 via-slate-50 to-teal-50/30" dir={direction}>
        <AppErrorBoundary onFallbackToLogin={() => {
          setViewingQuizId(null);
          setCurrentPage('auth');
        }} labels={{
          retrying: t('common.retrying'),
          appError: t('common.appError'),
          unexpectedErrorDesc: t('common.unexpectedErrorDesc'),
          retry: t('common.retry'),
          returnToLogin: t('common.returnToLogin'),
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={direction}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <LearningLoader />
          </div>
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (currentPage === 'summary') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={direction}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <LearningLoader />
          </div>
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
          </div>
        </div>
      </div>
    );
  }

  // Profile view — includes AppSidebar so the toggle button works
  if (currentPage === 'profile' && profileUserId) {
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
      <div className="flex min-h-screen bg-background" dir={direction}>
        <AppHeader
          userName={user.name}
          userId={user.id}
          userRole={user.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
          userGender={user.gender}
          titleId={user.title_id}
          avatarUrl={user.avatar_url ?? undefined}
onSignOut={async () => {
            // Same fix as handleSignOut: setCurrentPage('auth') first, then signOut
            setHasPersistedSession(false);
            setCurrentPage('auth');
            destroySocket();
            cleanupStatusStore();
            cleanupNotifications();
            // CRITICAL FIX (v3): Directly clear persisted store from localStorage
            // before resetAppStore() to prevent re-hydration of stale state
            try { localStorage.removeItem('attendo-app-store'); } catch {}
            resetAppStore();
            try {
              await signOut();
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
        />
        <main
          className={`flex-1 pt-14 sm:pt-16 pb-20 md:pb-0 transition-[margin,padding] duration-300 ease-in-out ${isRTL ? '' : ''} ${
            sidebarOpen ? 'md:ps-64' : 'md:ps-[68px]'
          }`}
          style={{ marginTop: profileBannerHeight ? `${profileBannerHeight}px` : 0 }}
        >
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={direction}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <LearningLoader />
          </div>
          <div className="flex items-center gap-2" role="status" aria-live="polite">
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
  // which shows an error message and the user sees the app as "crashed".
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

    // Registration agent — portal with sidebar showing agent-specific sections.
    if (user.role === 'registration_agent') {
      // v116: 'profile' section reuses the existing user-profile-page
      // (the same one used by students/teachers/admins). Other sections
      // (search/pending/teacherView) are handled by AgentPortal.
      if (agentSection === 'profile' || agentSection === 'settings') {
        return (
          <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
            <div className="min-h-screen bg-gradient-to-b from-sky-50 via-slate-50 to-teal-50/30">
              <AppHeader
                userName={user.name}
                userId={user.id}
                userRole={user.role}
                userGender={user.gender}
                titleId={user.title_id}
                avatarUrl={user.avatar_url ?? undefined}
                onSignOut={handleSignOut}
                onOpenSettings={() => setAgentSection('settings')}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                sidebarCollapsed={!sidebarOpen}
              />
              <AppSidebar
                role={'admin' as 'student' | 'teacher' | 'admin'}
                activeSection={agentSection}
                onSectionChange={(s: string) => setAgentSection(s)}
                customNavItems={[
                  ...agentNavItems,
                  { id: 'settings', label: t('nav.settings'), icon: <Settings className="h-5 w-5" /> },
                ]}
              />
              <main
                className={`flex-1 min-w-0 overflow-x-hidden pt-14 md:pt-16 pb-20 md:pb-4 transition-[margin,padding] duration-300 ease-in-out ${
                  sidebarOpen ? 'md:ps-64' : 'md:ps-[68px]'
                }`}
              >
                {agentSection === 'profile' ? (
                  <UserProfilePage
                    userId={user.id}
                    currentUser={user}
                    onBack={() => setAgentSection('search')}
                  />
                ) : (
                  <SettingsSection
                    profile={user}
                    onUpdateProfile={async (updates) => {
                      const { error } = await useAuthStore.getState().updateProfile(updates);
                      return { error: error ? String(error) : null };
                    }}
                    onDeleteAccount={async () => {
                      await useAuthStore.getState().signOut();
                      window.location.href = '/';
                    }}
                  />
                )}
              </main>
            </div>
          </DashboardErrorBoundary>
        );
      }
      return (
        <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
          <div className="min-h-screen bg-gradient-to-b from-sky-50 via-slate-50 to-teal-50/30">
            <AppHeader
              userName={user.name}
              userId={user.id}
              userRole={user.role}
              userGender={user.gender}
              titleId={user.title_id}
              avatarUrl={user.avatar_url ?? undefined}
              onSignOut={handleSignOut}
              onOpenSettings={() => setAgentSection('settings')}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              sidebarCollapsed={!sidebarOpen}
            />
            <AppSidebar
              role={'admin' as 'student' | 'teacher' | 'admin'}
              activeSection={agentSection}
              onSectionChange={(s: string) => setAgentSection(s)}
              customNavItems={agentNavItems}
            />
            <main
              className={`flex-1 min-w-0 overflow-x-hidden pt-14 md:pt-16 pb-20 md:pb-4 transition-[margin,padding] duration-300 ease-in-out ${
                sidebarOpen ? 'md:ps-64' : 'md:ps-[68px]'
              }`}
            >
              <AgentPortal activeSection={agentSection} onSectionChange={setAgentSection} />
            </main>
          </div>
        </DashboardErrorBoundary>
      );
    }

    // Student dashboard (default) — but pending_verification students see the OTP page,
    // and pending students see the activation page.
    //
    // RESILIENT ROUTING (v73 partial-apply safe):
    //   - 'pending_verification'         → OTP page (preferred v73 path)
    //   - 'pending' + phone + !verified  → OTP page (degraded: v73 CHECK widening
    //                                     didn't apply; v68 trigger set 'pending'
    //                                     instead. Still needs OTP.)
    //   - 'pending' + (no phone OR phone_verified=true) → Activation page
    if (user.role === 'student') {
      const status = (user as { account_status?: string }).account_status;
      const phone = (user as { phone?: string | null }).phone;
      const phoneVerified = (user as { phone_verified?: boolean }).phone_verified;
      const needsOtp =
        status === 'pending_verification' ||
        (status === 'pending' && !!phone && phoneVerified === false);

      if (needsOtp) {
        return (
          <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
            <OtpVerificationPage />
          </DashboardErrorBoundary>
        );
      }
      if (status === 'pending') {
        return (
          <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
            <StudentActivationPage />
          </DashboardErrorBoundary>
        );
      }
    }

    const studentContent = (
      <DashboardErrorBoundary onFallbackToLogin={handleSignOut}>
        <StudentSuspensionOverlay>
          <StudentDashboard
            profile={user}
            onSignOut={handleSignOut}
          />
        </StudentSuspensionOverlay>
      </DashboardErrorBoundary>
    );
    return isBannedUser ? <BannedUserOverlay>{studentContent}</BannedUserOverlay> : studentContent;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-50/50 to-sky-50/30" dir={direction}>
      <AppErrorBoundary onFallbackToLogin={handleSignOut} labels={{
        retrying: t('common.retrying'),
        appError: t('common.appError'),
        unexpectedErrorDesc: t('common.unexpectedErrorDesc'),
        retry: t('common.retry'),
        returnToLogin: t('common.returnToLogin'),
      }}>
        {dashboardContent}
      </AppErrorBoundary>
      <PlatformAnnouncementPopup userId={user?.id} />
    </div>
  );
}

// ─── Suspense fallback component ───
// -------------------------------------------------------
// Auth Page with Announcement support
// Uses useLoginAnnouncement() to show announcement in the
// branding panel area instead of the default branding
// -------------------------------------------------------
function AuthPageContent({
  direction,
  isRTL,
  authMode,
  setAuthMode,
  clearPasswordRecovery,
  t,
}: {
  direction: string;
  isRTL: boolean;
  authMode: 'login' | 'register' | 'forgot-password' | 'update-password';
  setAuthMode: (mode: 'login' | 'register' | 'forgot-password' | 'update-password') => void;
  clearPasswordRecovery: () => void;
  t: (key: string) => string;
}) {
  const { announcement } = useLoginAnnouncement();
  // Only use the branding panel for fullscreen display size
  // For banner/popup, the overlay component handles rendering as overlays
  const hasFullscreenAnnouncement = !!announcement && (announcement.display_size === 'fullscreen' || !announcement.display_size);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" dir={direction}>
      {/* ── Left Panel: Announcement OR Branding ── */}
      <div className={`hidden lg:flex lg:w-1/2 xl:w-[55%] relative overflow-hidden lg:sticky lg:top-0 lg:h-screen lg:self-start ${hasFullscreenAnnouncement ? '' : 'bg-gradient-to-br from-sky-700 via-sky-800 to-teal-700'}`}>
        {hasFullscreenAnnouncement ? (
          /* Show announcement in the branding panel area (fullscreen mode) */
          <AnnouncementBrandingPanel />
        ) : (
          /* Default branding panel */
          <BrandingPointerZone className="absolute inset-0 flex">
            {/* Background decoration */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute -top-40 -start-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
              <div className="absolute -bottom-40 -end-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
              <div className="absolute top-1/3 left-1/3 w-72 h-72 bg-teal-400/10 rounded-full blur-3xl" />
              <div className="absolute bottom-1/4 right-1/4 w-56 h-56 bg-sky-400/10 rounded-full blur-2xl" />
              {/* Pattern overlay */}
              <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col justify-center items-center px-8 xl:px-12 py-8 w-full">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' as const }}
                className="text-center w-full max-w-xl"
              >
                <div className="flex flex-col items-center gap-3 mb-7">
                <LoginLottie className="w-48 h-48 xl:w-56 xl:h-56 shrink-0 select-none" />
                <div className="min-w-0 w-full max-w-lg">
                <h2 className="text-2xl xl:text-3xl font-bold text-white mb-4 leading-tight">
                  {t('common.smartPlatform')}
                </h2>
                <p className="text-base text-sky-100/80 leading-relaxed">
                  {t('common.smartPlatformDesc')}
                </p>
                </div>
                </div>

                <FloatingLoginFeatures items={[
                  { title: t('features.ai'), desc: t('features.aiAnalysis') },
                  { title: t('features.smartSummary'), desc: t('features.fromAnySource') },
                  { title: t('features.studentTracking'), desc: t('features.reportsAndStats') },
                  { title: t('features.secureAndTrusted'), desc: t('features.dataProtection') },
                ]} />
              </motion.div>
            </div>
          </BrandingPointerZone>
        )}
      </div>

      {/* ── Auth Form Panel ── */}
      <div className="auth-form-panel relative flex-1 flex flex-col justify-start pt-0 px-0 pb-0 lg:pt-8 lg:justify-center lg:items-center lg:p-8 bg-gradient-to-b from-slate-50 via-white to-sky-50/30">
        <NativeStatusBarTheme />
        {/* Mobile header band: short brand-coloured band, the form card overlaps it (desktop: transparent wrapper) */}
        <div data-mode={authMode} className="auth-mobile-hero relative flex flex-col max-lg:px-4 max-lg:pt-3 max-lg:pb-14 max-lg:overflow-hidden max-lg:bg-gradient-to-br max-lg:from-teal-600 max-lg:to-sky-700 lg:contents">
          <div aria-hidden className="pointer-events-none absolute -top-8 -start-6 h-28 w-28 rounded-full bg-amber-300/30 lg:hidden" />
          <div aria-hidden className="pointer-events-none absolute -bottom-8 -end-6 h-32 w-32 rounded-full bg-emerald-300/30 lg:hidden" />
          <div aria-hidden className="pointer-events-none absolute top-4 end-1/3 h-16 w-16 rounded-full bg-white/10 lg:hidden" />
          {/* Language toggle (login / register) */}
          <div className="relative z-20 mx-auto flex w-full max-w-md justify-end lg:absolute lg:end-3 lg:top-3 lg:m-0 lg:w-auto lg:max-w-none">
            <AuthLanguageToggle />
          </div>
          {/* Tagline + feature chips live inside the band (mobile only) */}
          {!hasFullscreenAnnouncement && (
            <div className="auth-hero-text relative z-10 mx-auto mt-2 w-full max-w-md text-center lg:hidden">
              <h2 className="text-lg font-bold leading-tight text-white">{t('common.smartPlatform')}</h2>
              <p className={`mt-1 text-[11px] leading-relaxed text-white/80 line-clamp-2`}>{t('common.smartPlatformDesc')}</p>
              <div className={`mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-white/90`}>
                <span className="flex items-center gap-1 text-[11px] font-medium"><BrainCircuit className="h-3 w-3" />{t('features.ai')}</span>
                <span className="flex items-center gap-1 text-[11px] font-medium"><BookOpen className="h-3 w-3" />{t('features.smartSummary')}</span>
                <span className="flex items-center gap-1 text-[11px] font-medium"><Users className="h-3 w-3" />{t('features.studentTracking')}</span>
                <span className="flex items-center gap-1 text-[11px] font-medium"><Shield className="h-3 w-3" />{t('features.secureAndTrusted')}</span>
              </div>
            </div>
          )}
        </div>
        {hasFullscreenAnnouncement && (
          <div className="auth-mobile-intro lg:hidden w-full max-w-md mx-auto mt-4 px-4">
            <AnnouncementBrandingPanel />
          </div>
        )}

        {/* Auth form with mode toggle */}
        <div data-mode={authMode} className={`auth-sheet relative z-10 w-full max-w-md mx-auto max-lg:max-w-none max-lg:flex-1 max-lg:flex max-lg:flex-col max-lg:bg-white max-lg:dark:bg-card max-lg:rounded-t-[2rem] max-lg:shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] max-lg:px-0 max-lg:pt-2 max-lg:pb-4 max-lg:[&_[data-slot=card]]:bg-transparent max-lg:[&_[data-slot=card]]:shadow-none max-lg:[&_[data-slot=card]]:rounded-none ${hasFullscreenAnnouncement ? 'max-lg:mt-4' : 'max-lg:-mt-8'}`}>
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
          <div className="mt-auto px-4 pt-4 lg:hidden"><AppVersionLabel /></div>
        </div>
        <div className="hidden w-full max-w-md mx-auto lg:mt-5 lg:block">
          <AppVersionLabel />
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  const { t, direction } = useTranslations();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50/30" dir={direction}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <LearningLoader />
        </div>
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
          <span className="text-sm font-medium text-sky-800">{t('common.loading')}</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <HomeContent />
    </Suspense>
  );
}
