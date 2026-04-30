'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Loader2, BookOpen, BrainCircuit, Users, Shield, LayoutDashboard, Settings, Megaphone, Ban, TrendingUp, MessageCircle, Building2, FileText, FolderOpen, FileSpreadsheet, Bell } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore } from '@/stores/status-store';
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
import SummaryView from '@/components/shared/summary-view';
import UserProfilePage from '@/components/shared/user-profile-page';
import AppHeader from '@/components/shared/app-header';
import AppSidebar from '@/components/shared/app-sidebar';
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
  const { currentPage, viewingQuizId, viewingSummaryId, profileUserId, setCurrentPage, reset: resetAppStore, sidebarOpen, setSidebarOpen, setStudentSection, setTeacherSection, setAdminSection, studentSection: storedStudentSection, teacherSection: storedTeacherSection, adminSection: storedAdminSection } = useAppStore();
  const { cleanup: cleanupStatusStore, init: initStatusStore } = useStatusStore();
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const searchParams = useSearchParams();

  // ─── Close sidebar when navigating to quiz/summary views ───
  // These views don't include the sidebar component, so we need to ensure
  // the mobile Sheet (portal) is closed and desktop sidebar state is reset
  // NOTE: Profile page DOES include AppSidebar, so we don't force-close it there
  useEffect(() => {
    if (currentPage === 'quiz' || currentPage === 'summary') {
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
    }
  }, [user, initStatusStore, cleanupStatusStore]);

  // ─── Supabase Configuration Check ───
  // If Supabase is not configured, show a clear error page
  if (!isSupabaseConfigured) {
    return <SupabaseConfigError />;
  }

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
    return <SetupWizard onComplete={handleSetupComplete} onStart={handleWizardStart} onError={handleWizardError} />;
  }

  // Auth pages (login / register)
  if (!user || currentPage === 'auth') {
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
        <main className={`flex-1 pt-14 sm:pt-16 transition-all duration-300 pl-0 ${
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
          resetAppStore();
          setCurrentPage('auth');
          signOut();
        }}
      />
    );
    return isBannedUser ? <BannedUserOverlay>{studentContent}</BannedUserOverlay> : studentContent;
  })();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-emerald-50/30" dir="rtl">
      {dashboardContent}
    </div>
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
