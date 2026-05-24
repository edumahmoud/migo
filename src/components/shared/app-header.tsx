'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap,
  Settings,
  LogOut,
  ChevronDown,
  UserCircle,
} from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { useInstitutionStore } from '@/stores/institution-store';
import { useStatusStore, getStatusColor } from '@/stores/status-store';
import NotificationBell from '@/components/shared/notification-bell';
import UserAvatar from '@/components/shared/user-avatar';
import ThemeToggle from '@/components/shared/theme-toggle';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n/context';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AppHeaderProps {
  userName: string;
  userId: string;
  userRole: 'student' | 'teacher' | 'admin' | 'superadmin';
  userGender?: string | null;
  titleId?: string | null;
  avatarUrl?: string;
  onSignOut: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}

// Academic titles (same as settings-section)
// Labels are i18n keys resolved via t()
const ACADEMIC_TITLES = [
  { value: 'teacher', label: 'titles.teacher', femaleLabel: 'titles.teacherFemale' },
  { value: 'dr', label: 'titles.dr', femaleLabel: 'titles.drFemale' },
  { value: 'prof', label: 'titles.prof', femaleLabel: 'titles.profFemale' },
  { value: 'assoc_prof', label: 'titles.assocProf', femaleLabel: 'titles.assocProfFemale' },
  { value: 'assist_prof', label: 'titles.assistProf', femaleLabel: 'titles.assistProfFemale' },
  { value: 'lecturer', label: 'titles.lecturer', femaleLabel: 'titles.lecturerFemale' },
  { value: 'teaching_assist', label: 'titles.teachingAssist', femaleLabel: 'titles.teachingAssistFemale' },
] as const;

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AppHeader({
  userName,
  userId,
  userRole,
  userGender,
  titleId,
  avatarUrl,
  onSignOut,
  onOpenSettings,
  onToggleSidebar,
  sidebarCollapsed,
}: AppHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openProfile, setReportsUnreadCount } = useAppStore();
  const isAdminRole = userRole === 'admin' || userRole === 'superadmin';
  const { myStatus, init: initStatusStore } = useStatusStore();
  const { t, dir, isRTL } = useI18n();

  // Initialize status store with userId (critical for Supabase Presence)
  useEffect(() => {
    if (userId) {
      initStatusStore(userId);
    }
  }, [initStatusStore, userId]);

  // Pre-fetch reports count for sidebar badge + Realtime subscription for live updates
  // Skip for admin/superadmin — no badge needed on admin interface
  useEffect(() => {
    if (!userId || isAdminRole) return;
    let cancelled = false;

    const fetchCount = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const res = await fetch('/api/reports/count', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await res.json();
        if (result.success && result.data && !cancelled) {
          setReportsUnreadCount(result.data.count);
        }
      } catch { /* non-critical */ }
    };

    // Initial fetch
    fetchCount();

    // Subscribe to reports table changes for live badge updates
    const channel = supabase
      .channel('reports-count-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => {
        if (!cancelled) fetchCount();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId, isAdminRole, setReportsUnreadCount]);

  // Gender-aware role label
  const isFemale = userGender === 'female';
  const roleLabel = userRole === 'student'
    ? (isFemale ? t('roles.studentFemale') : t('roles.student'))
    : userRole === 'superadmin'
      ? (isFemale ? t('roles.superadminFemale') : t('roles.superadmin'))
      : userRole === 'admin'
        ? (isFemale ? t('roles.adminFemale') : t('roles.admin'))
        : (() => {
            // For teachers, show academic title if available, otherwise default to معلم/معلمة
            const effectiveTitleId = titleId || 'teacher';
            const title = ACADEMIC_TITLES.find(at => at.value === effectiveTitleId);
            if (title) {
              return isFemale ? t(title.femaleLabel) : t(title.label);
            }
            return isFemale ? t('titles.teacherFemale') : t('titles.teacher');
          })();

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (
        dropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    // Listen to both mousedown (desktop) and touchstart (mobile) for immediate close
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick as EventListener, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick as EventListener);
    };
  }, [dropdownOpen]);

  return (
    <header className="fixed top-0 end-0 start-0 z-40 h-14 sm:h-16 border-b bg-background/95 backdrop-blur-md shadow-sm dark:bg-card/95 dark:border-border" dir={dir}>
      <div className="flex h-full items-center justify-between px-2 sm:px-5">
        {/* ── Right side: Logo + App name ── */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
          {/* Sidebar toggle */}
          <button
            onClick={onToggleSidebar}
            className="touch-target shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 active:bg-muted/80 hover:text-foreground transition-colors touch-manipulation"
            aria-label={sidebarCollapsed ? t('header.openMenu') : t('header.closeMenu')}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={sidebarCollapsed ? 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5' : 'M3.75 6.75h16.5M3.75 12h6.75m-6.75 5.25h16.5'}
              />
            </svg>
          </button>

          {/* Logo */}
          <HeaderLogo />

          {/* App name */}
          <HeaderTitle />

          {/* Section label - hidden on very small screens */}
          <ActiveSectionLabel role={userRole} />
        </div>

        {/* ── Left side: Notifications + User ── */}
        <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
          {/* Notification Bell */}
          <NotificationBell />

          {/* User area with dropdown */}
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 sm:gap-2.5 rounded-lg px-1.5 sm:px-3 py-1.5 sm:py-2 hover:bg-muted/50 active:bg-muted/80 transition-colors min-w-0 touch-manipulation"
            >
              {/* Avatar + Name — whole area opens dropdown */}
              <div className="hidden sm:flex items-center gap-2 sm:gap-2.5 min-w-0">
                <div className={`flex flex-col min-w-0 items-start`}>
                  <span className="text-sm font-semibold text-foreground truncate max-w-[140px]">
                    {userName}
                  </span>
                  <span className="text-xs text-primary font-medium">
                    {roleLabel}
                  </span>
                </div>
                <div className="relative">
                  <UserAvatar name={userName} avatarUrl={avatarUrl} size="sm" />
                  {/* Status dot on desktop avatar */}
                  <span className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-background ${getStatusColor(myStatus)} ${myStatus === 'online' ? 'animate-pulse' : ''}`} />
                </div>
              </div>
              {/* Mobile: Just avatar with status dot */}
              <div className="sm:hidden relative">
                <UserAvatar name={userName} avatarUrl={avatarUrl} size="sm" />
                <span className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-background ${getStatusColor(myStatus)} ${myStatus === 'online' ? 'animate-pulse' : ''}`} />
              </div>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 hidden sm:block ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown menu */}
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -8, scale: 0.95, pointerEvents: 'none' as const }}
                  animate={{ opacity: 1, y: 0, scale: 1, pointerEvents: 'auto' as const }}
                  exit={{ opacity: 0, pointerEvents: 'none' as const }}
                  transition={{ duration: 0.1 }}
                  className="absolute end-0 top-full mt-2 w-56 rounded-xl border bg-background shadow-lg overflow-hidden z-50"
                  dir={dir}
                >
                  {/* User info in dropdown */}
                  <div className="border-b px-4 py-3 bg-muted/20">
                    <p className="text-sm font-semibold text-foreground truncate">{userName}</p>
                    <p className="text-xs text-primary font-medium mt-0.5">{roleLabel}</p>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        openProfile(userId);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 active:bg-muted/80 transition-colors"
                    >
                      <UserCircle className="h-4 w-4 text-muted-foreground" />
                      {t('header.profile')}
                    </button>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onOpenSettings();
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 active:bg-muted/80 transition-colors"
                    >
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      {t('header.settings')}
                    </button>
                    <ThemeToggle />
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onSignOut();
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 active:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-950/50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      {t('header.signOut')}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}

// -------------------------------------------------------
// Active section label (shows current section name on mobile)
// -------------------------------------------------------
function ActiveSectionLabel({ role }: { role: 'student' | 'teacher' | 'admin' | 'superadmin' }) {
  const { studentSection, teacherSection, adminSection } = useAppStore();
  const { t } = useI18n();

  const sectionLabels: Record<string, string> = {
    dashboard: t('nav.dashboard'),
    subjects: t('nav.subjects'),
    summaries: t('nav.summaries'),
    assignments: t('nav.assignments'),
    files: t('nav.files'),
    teachers: t('nav.teachers'),
    students: t('nav.students'),
    analytics: t('nav.analytics'),
    settings: t('nav.settings'),
    users: t('nav.users'),
    reports: t('nav.reports'),
    announcements: t('nav.announcements'),
    banned: t('nav.banned'),
    institution: t('nav.institution'),
    chat: t('nav.chat'),
    notifications: t('nav.notifications'),
  };

  const activeSection = role === 'student' ? studentSection : role === 'teacher' ? teacherSection : (role === 'admin' || role === 'superadmin') ? adminSection : 'dashboard';
  const label = sectionLabels[activeSection] || '';

  return (
    <>
      <span className="hidden sm:inline text-muted-foreground/40 mx-1">·</span>
      <span className="hidden sm:inline text-xs sm:text-sm font-medium text-muted-foreground truncate">
        {label}
      </span>
    </>
  );
}

// -------------------------------------------------------
// Header Logo — shows institution logo or default icon
// -------------------------------------------------------
function HeaderLogo() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();

  // Fetch institution data on first render
  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  if (institution?.logo_url) {
    return (
      <img
        src={institution.logo_url}
        alt={institution.name}
        className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-xl object-cover border border-primary/20 shadow-sm"
      />
    );
  }

  return (
    <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm">
      <GraduationCap className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
    </div>
  );
}

// -------------------------------------------------------
// Header Title — shows institution name or default "أتيندو"
// -------------------------------------------------------
function HeaderTitle() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  const { t } = useI18n();

  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  return (
    <div className="flex flex-col min-w-0">
      <h1 className="text-base sm:text-lg font-bold text-primary whitespace-nowrap truncate max-w-[180px] sm:max-w-[250px]">
        {loaded ? (institution?.name || t('header.appNameFallback')) : '\u00A0'}
      </h1>
      {loaded && institution?.tagline && (
        <span className="text-[10px] sm:text-xs text-primary/60 whitespace-nowrap truncate max-w-[180px] sm:max-w-[250px] -mt-0.5">
          {institution.tagline}
        </span>
      )}
    </div>
  );
}
