'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap,
  Settings,
  LogOut,
  ChevronDown,
  WifiOff,
} from 'lucide-react';
import { useSharedSocket, useSocketEvent } from '@/lib/socket';
import { useAppStore } from '@/stores/app-store';
import { useAuthStore } from '@/stores/auth-store';
import NotificationBell from '@/components/shared/notification-bell';
import UserAvatar from '@/components/shared/user-avatar';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AppHeaderProps {
  userName: string;
  userId: string;
  userRole: 'student' | 'teacher' | 'admin';
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
  const { status, isConnected } = useSharedSocket();

  // Gender-aware role label (teachers show their academic title)
  const isFemale = userGender === 'female';
  const roleLabel = userRole === 'student'
    ? (isFemale ? 'طالبة' : 'طالب')
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
          <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 shadow-sm">
            <GraduationCap className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
          </div>

          {/* App name */}
          <h1 className="text-base sm:text-lg font-bold text-emerald-600 whitespace-nowrap">
            أتيندو
          </h1>

          {/* Section label - hidden on very small screens */}
          <ActiveSectionLabel role={userRole} />
        </div>

        {/* ── Left side: Notifications + User ── */}
        <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
          {/* Notification Bell */}
          <NotificationBell />

          {/* Connection status indicator */}
          <ConnectionStatusIndicator status={status} isConnected={isConnected} />

          {/* User area with dropdown */}
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 sm:gap-2.5 rounded-lg px-1.5 sm:px-3 py-1.5 sm:py-2 hover:bg-muted/50 active:bg-muted/80 transition-colors min-w-0 touch-manipulation"
            >
              {/* Avatar + Name — clicking opens profile */}
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); openProfile(userId); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); openProfile(userId); } }}
                className="hidden sm:flex items-center gap-2 sm:gap-2.5 rounded-lg px-1 py-0.5 -mx-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors group/profile min-w-0 cursor-pointer"
              >
                <div className="flex flex-col items-end min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate max-w-[140px] group-hover/profile:text-emerald-600 transition-colors">
                    {userName}
                  </span>
                  <span className="text-xs text-emerald-600 font-medium">
                    {roleLabel}
                  </span>
                </div>
                <UserAvatar name={userName} avatarUrl={avatarUrl} size="sm" />
              </div>
              {/* Mobile: Just avatar */}
              <div className="sm:hidden">
                <UserAvatar name={userName} avatarUrl={avatarUrl} size="sm" />
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
// User status config (mirrors app-sidebar.tsx)
// -------------------------------------------------------
const STATUS_DOT_CONFIG: Record<string, { color: string; pulse: boolean; label: string }> = {
  online: { color: 'bg-emerald-500', pulse: true, label: 'متصل' },
  busy: { color: 'bg-amber-500', pulse: false, label: 'مشغول' },
  away: { color: 'bg-orange-500', pulse: false, label: 'بعيد' },
  invisible: { color: 'bg-gray-400', pulse: false, label: 'غير مرئي' },
  offline: { color: 'bg-gray-400', pulse: false, label: 'غير متصل' },
};

const STATUS_STORAGE_KEY = 'attenddo-user-status';

/** Read the current user status from localStorage (client-side only) */
function getStoredUserStatus(): string {
  if (typeof window === 'undefined') return 'online';
  const saved = localStorage.getItem(STATUS_STORAGE_KEY);
  return saved && STATUS_DOT_CONFIG[saved] ? saved : 'online';
}

// -------------------------------------------------------
// Connection status indicator
// -------------------------------------------------------
function ConnectionStatusIndicator({
  status,
  isConnected,
}: {
  status: 'connected' | 'disconnected' | 'connecting';
  isConnected: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const [userStatus, setUserStatus] = useState<string>(getStoredUserStatus);

  // Listen for status changes via socket (e.g. from settings-section)
  useSocketEvent<{ userId: string; status: string }>('user-status-changed', (data) => {
    if (user && data.userId === user.id) {
      setUserStatus(data.status);
    }
  });

  // Listen for storage events (cross-tab sync)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STATUS_STORAGE_KEY && e.newValue && STATUS_DOT_CONFIG[e.newValue]) {
        setUserStatus(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Also poll localStorage on window focus
  useEffect(() => {
    const handleFocus = () => {
      setUserStatus(getStoredUserStatus());
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  if (status === 'connecting') {
    return (
      <div
        className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md"
        title="جاري الاتصال بالخادم..."
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
        </span>
        <span className="hidden sm:inline text-[10px] text-amber-600 font-medium">جاري الاتصال</span>
      </div>
    );
  }

  if (isConnected) {
    const dotConfig = STATUS_DOT_CONFIG[userStatus] || STATUS_DOT_CONFIG.online;
    return (
      <div
        className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md"
        title={`متصل بالخادم — ${dotConfig.label}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dotConfig.color} ${dotConfig.pulse ? 'animate-pulse' : ''}`} />
        <span className="hidden sm:inline text-[10px] text-emerald-600 font-medium">متصل</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md"
      title="غير متصل بالخادم - يتم التحديث تلقائياً"
    >
      <WifiOff className="h-3.5 w-3.5 text-rose-400" />
      <span className="hidden sm:inline text-[10px] text-rose-500 font-medium">غير متصل</span>
    </div>
  );
}

// -------------------------------------------------------
// Active section label (shows current section name on mobile)
// -------------------------------------------------------
function ActiveSectionLabel({ role }: { role: 'student' | 'teacher' | 'admin' | 'superadmin' }) {
  const { studentSection, teacherSection } = useAppStore();

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
  };

  const activeSection = role === 'student' ? studentSection : role === 'teacher' ? teacherSection : 'dashboard';
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
