'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Loader2, BookOpen, BrainCircuit, Users, Shield } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { SocketProvider, setSocketAuth, destroySocket } from '@/lib/socket';
import LoginForm from '@/components/auth/login-form';
import RegisterForm from '@/components/auth/register-form';
import ForgotPasswordForm from '@/components/auth/forgot-password-form';
import ResetPasswordForm from '@/components/auth/reset-password-form';
import AppHeader from '@/components/shared/app-header';
import SetupWizard from '@/components/setup/setup-wizard';

// Lazy-load heavy dashboard components to reduce initial compile memory
const StudentDashboard = dynamic(() => import('@/components/student/student-dashboard'), { ssr: false });
const TeacherDashboard = dynamic(() => import('@/components/teacher/teacher-dashboard'), { ssr: false });
const AdminDashboard = dynamic(() => import('@/components/admin/admin-dashboard'), { ssr: false });
const QuizView = dynamic(() => import('@/components/shared/quiz-view'), { ssr: false });
const SummaryView = dynamic(() => import('@/components/shared/summary-view'), { ssr: false });
const UserProfilePage = dynamic(() => import('@/components/shared/user-profile-page'), { ssr: false });

type AuthMode = 'login' | 'register' | 'forgot-password' | 'reset-password';

function HomeContent() {
  const { user, loading, initialized, initialize, signOut, sessionKickedMessage } = useAuthStore();
  const { currentPage, viewingQuizId, viewingSummaryId, profileUserId, setCurrentPage, reset: resetAppStore, sidebarOpen, setSidebarOpen } = useAppStore();
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const searchParams = useSearchParams();
  const isRecoveryFlow = useRef(false);

  // ─── Setup Wizard state ───
  const [setupCheckDone, setSetupCheckDone] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [wizardInProgress, setWizardInProgress] = useState(false);

  // Check if the system needs initial setup (no users in DB)
  const checkSetupStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/setup');
      if (res.ok) {
        const data = await res.json();
        if (!data.initialized) {
          setNeedsSetup(true);
        }
      }
    } catch {
      // If the API fails, assume setup is not needed (don't block)
    }
    setSetupCheckDone(true);
  }, []);

  // Handle setup wizard start (wizard is now active, don't interrupt it)
  const handleWizardStart = useCallback(() => {
    setWizardInProgress(true);
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

  // Handle OAuth callback parameters and password reset
  useEffect(() => {
    const authError = searchParams.get('auth_error');
    const newUser = searchParams.get('new_user');
    const mode = searchParams.get('mode');

    if (authError) {
      // Clean the URL
      window.history.replaceState({}, '', '/');
    }

    // Password reset mode - show the new password form
    if (mode === 'reset-password') {
      isRecoveryFlow.current = true;
      setAuthMode('reset-password');
      // Clean the URL after a longer delay to ensure all effects have processed
      setTimeout(() => {
        window.history.replaceState({}, '', '/');
      }, 2000);
      return;
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
  }, [initialize]);

  // Set correct page when user state changes
  useEffect(() => {
    if (!initialized) return;

    // Don't redirect away from the setup wizard while it's in progress
    if (wizardInProgress) return;

    // Don't redirect away from the password reset form
    if (authMode === 'reset-password' || isRecoveryFlow.current) return;

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
    } else {
      setCurrentPage('auth');
    }
  }, [user, initialized, currentPage, setCurrentPage, wizardInProgress, authMode]);

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

  // Initialize shared socket auth when user is available
  useEffect(() => {
    if (user) {
      setSocketAuth(user.id, user.name);
    } else {
      destroySocket();
    }
  }, [user]);

  // Loading state
  if (loading || !initialized || !setupCheckDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50" dir="rtl">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 animate-ping" />
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">جاري التحميل...</span>
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
    return <SetupWizard onComplete={handleSetupComplete} onStart={handleWizardStart} />;
  }

  // Auth pages (login / register / reset-password)
  // Also show auth when in reset-password mode (user has temporary recovery session)
  if (!user || currentPage === 'auth' || authMode === 'reset-password') {
    return (
      <div className="min-h-screen flex flex-col justify-start pt-6 px-4 pb-4 sm:flex sm:items-center sm:justify-center sm:p-4 bg-gradient-to-br from-emerald-600 to-teal-700" dir="rtl">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
          <div className="absolute top-1/4 left-1/4 w-60 h-60 bg-emerald-400/10 rounded-full blur-2xl" />
        </div>

        {/* Feature badges at top - hidden on mobile */}
        <div className="absolute top-8 left-0 right-0 justify-center hidden sm:flex">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="flex items-center gap-4 sm:gap-6 text-white/70 flex-wrap justify-center"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <BrainCircuit className="w-3.5 h-3.5" />
              <span>ذكاء اصطناعي</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <BookOpen className="w-3.5 h-3.5" />
              <span>تلخيص ذكي</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Users className="w-3.5 h-3.5" />
              <span>متابعة الطلاب</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Shield className="w-3.5 h-3.5" />
              <span>آمن وموثوق</span>
            </div>
          </motion.div>
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
            ) : authMode === 'forgot-password' ? (
              <motion.div
                key="forgot-password"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3 }}
              >
                <ForgotPasswordForm onBackToLogin={() => setAuthMode('login')} />
              </motion.div>
            ) : (
              <motion.div
                key="reset-password"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3 }}
              >
                <ResetPasswordForm onComplete={() => setAuthMode('login')} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // Quiz view
  if (currentPage === 'quiz' && viewingQuizId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-teal-50" dir="rtl">
        <QuizView
          quizId={viewingQuizId}
          onBack={() => setCurrentPage(user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' : user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard')}
          profile={user}
        />
      </div>
    );
  }

  // Summary view
  if (currentPage === 'summary' && viewingSummaryId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-teal-50" dir="rtl">
        <SummaryView
          summaryId={viewingSummaryId}
          onBack={() => setCurrentPage(user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' : user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard')}
        />
      </div>
    );
  }

  // Profile view
  if (currentPage === 'profile' && profileUserId) {
    return (
      <SocketProvider>
        <div className="min-h-screen bg-background" dir="rtl">
          <AppHeader
            userName={user.name}
            userId={user.id}
            userRole={user.role as 'student' | 'teacher' | 'admin'}
            userGender={user.gender}
            titleId={user.title_id}
            avatarUrl={user.avatar_url}
            onSignOut={() => {
              destroySocket();
              resetAppStore();
              setCurrentPage('auth');
              signOut();
            }}
            onOpenSettings={() => setCurrentPage(
              user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' :
              user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard'
            )}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            sidebarCollapsed={!sidebarOpen}
          />
          <main className="pt-14 sm:pt-16">
            <UserProfilePage
              userId={profileUserId}
              currentUser={user}
              onBack={() => setCurrentPage(
                user.role === 'superadmin' || user.role === 'admin' ? 'admin-dashboard' :
                user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard'
              )}
            />
          </main>
        </div>
      </SocketProvider>
    );
  }

  // Authenticated content wrapped with SocketProvider
  const dashboardContent = (() => {
    // Superadmin or Admin dashboard
    if (user.role === 'superadmin' || user.role === 'admin' || currentPage === 'admin-dashboard') {
      return (
        <AdminDashboard
          profile={user}
          onSignOut={() => {
            destroySocket();
            resetAppStore();
            setCurrentPage('auth');
            signOut();
          }}
        />
      );
    }

    // Teacher dashboard
    if (user.role === 'teacher' || currentPage === 'teacher-dashboard') {
      return (
        <TeacherDashboard
          profile={user}
          onSignOut={() => {
            destroySocket();
            resetAppStore();
            setCurrentPage('auth');
            signOut();
          }}
        />
      );
    }

    // Student dashboard (default)
    return (
      <StudentDashboard
        profile={user}
        onSignOut={() => {
          destroySocket();
          resetAppStore();
          setCurrentPage('auth');
          signOut();
        }}
      />
    );
  })();

  return (
    <SocketProvider>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-emerald-50/30" dir="rtl">
        {dashboardContent}
      </div>
    </SocketProvider>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50" dir="rtl">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <GraduationCap className="w-9 h-9 text-white" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700">جاري التحميل...</span>
            </div>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
