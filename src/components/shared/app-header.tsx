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
const ACADEMIC_TITLES = [
  { value: 'teacher', label: 'معلم', femaleLabel: 'معلمة' },
  { value: 'dr', label: 'دكتور', femaleLabel: 'دكتورة' },
  { value: 'prof', label: 'أستاذ', femaleLabel: 'أستاذة' },
  { value: 'assoc_prof', label: 'أستاذ مشارك', femaleLabel: 'أستاذة مشاركة' },
  { value: 'assist_prof', label: 'أستاذ مساعد', femaleLabel: 'أستاذة مساعدة' },
  { value: 'lecturer', label: 'محاضر', femaleLabel: 'محاضرة' },
  { value: 'teaching_assist', label: 'معيد', femaleLabel: 'معيدة' },
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
  const { openProfile } = useAppStore();
  const { myStatus, init: initStatusStore } = useStatusStore();

  // Initialize status store
  useEffect(() => {
    initStatusStore();
  }, [initStatusStore]);

  // Gender-aware role label
  const isFemale = userGender === 'female';
  const roleLabel = userRole === 'student'
    ? (isFemale ? 'طالبة' : 'طالب')
    : userRole === 'superadmin'
      ? (isFemale ? 'مديرة المنصة' : 'مدير المنصة')
      : userRole === 'admin'
        ? (isFemale ? 'مشرفة' : 'مشرف')
        : (() => {
            // For teachers, show academic title if available, otherwise default to معلم/معلمة
            const effectiveTitleId = titleId || 'teacher';
            const title = ACADEMIC_TITLES.find(t => t.value === effectiveTitleId);
            if (title) {
              return isFemale ? title.femaleLabel : title.label;
            }
            return isFemale ? 'معلمة' : 'معلم';
          })();

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
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
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  return (
    <header className="fixed top-0 right-0 left-0 z-40 h-14 sm:h-16 border-b bg-background/95 backdrop-blur-md shadow-sm" dir="rtl">
      <div className="flex h-full items-center justify-between px-2 sm:px-5">
        {/* ── Right side: Logo + App name ── */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
          {/* Sidebar toggle */}
          <button
            onClick={onToggleSidebar}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 active:bg-muted/80 hover:text-foreground transition-colors touch-manipulation"
            aria-label={sidebarCollapsed ? 'فتح القائمة' : 'إغلاق القائمة'}
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
                <div className="flex flex-col items-end min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate max-w-[140px]">
                    {userName}
                  </span>
                  <span className="text-xs text-emerald-600 font-medium">
                    {roleLabel}
                  </span>
                </div>
                <div className="relative">
                  <UserAvatar name={userName} avatarUrl={avatarUrl} size="sm" />
                  {/* Status dot on desktop avatar */}
                  <span className={`absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-background ${getStatusColor(myStatus)} ${myStatus === 'online' ? 'animate-pulse' : ''}`} />
                </div>
              </div>
              {/* Mobile: Just avatar with status dot */}
              <div className="sm:hidden relative">
                <UserAvatar name={userName} avatarUrl={avatarUrl} size="sm" />
                <span className={`absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-background ${getStatusColor(myStatus)} ${myStatus === 'online' ? 'animate-pulse' : ''}`} />
              </div>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 hidden sm:block ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown menu */}
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-full mt-2 w-56 rounded-xl border bg-background shadow-lg overflow-hidden z-50"
                  dir="rtl"
                >
                  {/* User info in dropdown */}
                  <div className="border-b px-4 py-3 bg-muted/20">
                    <p className="text-sm font-semibold text-foreground truncate">{userName}</p>
                    <p className="text-xs text-emerald-600 font-medium mt-0.5">{roleLabel}</p>
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
                      الملف الشخصي
                    </button>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onOpenSettings();
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 active:bg-muted/80 transition-colors"
                    >
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      الإعدادات
                    </button>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onSignOut();
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 active:bg-rose-100 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      تسجيل الخروج
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

  const sectionLabels: Record<string, string> = {
    dashboard: 'لوحة التحكم',
    subjects: 'المقررات',
    summaries: 'الملخصات',
    assignments: 'المهام',
    files: 'ملفاتي',
    teachers: 'المعلمون',
    students: 'الطلاب',
    analytics: 'التقارير',
    settings: 'الإعدادات',
    users: 'المستخدمون',
    reports: 'التقارير',
    announcements: 'الإعلانات',
    banned: 'المحظورون',
    institution: 'المؤسسة',
    chat: 'المحادثات',
    notifications: 'الإشعارات',
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
        className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-xl object-cover border border-emerald-200 shadow-sm"
      />
    );
  }

  return (
    <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 shadow-sm">
      <GraduationCap className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
    </div>
  );
}

// -------------------------------------------------------
// Header Title — shows institution name or default "أتيندو"
// -------------------------------------------------------
function HeaderTitle() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();

  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  return (
    <div className="flex flex-col min-w-0">
      <h1 className="text-base sm:text-lg font-bold text-emerald-600 whitespace-nowrap truncate max-w-[180px] sm:max-w-[250px]">
        {loaded ? (institution?.name || 'أتيندو') : '\u00A0'}
      </h1>
      {loaded && institution?.tagline && (
        <span className="text-[10px] sm:text-xs text-emerald-600/60 whitespace-nowrap truncate max-w-[180px] sm:max-w-[250px] -mt-0.5">
          {institution.tagline}
        </span>
      )}
    </div>
  );
}
