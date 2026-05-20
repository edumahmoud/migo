'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  BookOpen,
  MessageCircle,
  Bell,
  Menu,
  Users,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/stores/app-store';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface MobileBottomNavProps {
  role: 'student' | 'teacher' | 'admin' | 'superadmin';
  activeSection: string;
  onSectionChange: (section: string) => void;
  onToggleSidebar: () => void;
}

interface BottomNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  isMore?: boolean;
}

// -------------------------------------------------------
// Navigation items per role (5 items each)
// -------------------------------------------------------
const studentNavItems: BottomNavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'reports', label: 'الإبلاغات', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'more', label: 'المزيد', icon: <Menu className="h-5 w-5" />, isMore: true },
];

const teacherNavItems: BottomNavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'reports', label: 'الإبلاغات', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'more', label: 'المزيد', icon: <Menu className="h-5 w-5" />, isMore: true },
];

const adminNavItems: BottomNavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'users', label: 'المستخدمون', icon: <Users className="h-5 w-5" /> },
  { id: 'complaints', label: 'الإبلاغات', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'more', label: 'المزيد', icon: <Menu className="h-5 w-5" />, isMore: true },
];

// -------------------------------------------------------
// Main exported component
// -------------------------------------------------------
export default function MobileBottomNav({
  role,
  activeSection,
  onSectionChange,
  onToggleSidebar,
}: MobileBottomNavProps) {
  const isMobile = useIsMobile();
  const { chatUnreadCount, reportsUnreadCount } = useAppStore();

  // Don't render on desktop
  if (!isMobile) return null;

  const navItems =
    role === 'admin' || role === 'superadmin'
      ? adminNavItems
      : role === 'teacher'
        ? teacherNavItems
        : studentNavItems;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur-md border-t border-border dark:bg-card/95 dark:border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      dir="rtl"
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {navItems.map((item) => {
          const isActive = !item.isMore && activeSection === item.id;

          return (
            <BottomNavItemButton
              key={item.id}
              item={item}
              isActive={isActive}
              chatUnreadCount={chatUnreadCount}
              reportsUnreadCount={reportsUnreadCount}
              onSectionChange={onSectionChange}
              onToggleSidebar={onToggleSidebar}
            />
          );
        })}
      </div>
    </nav>
  );
}

// -------------------------------------------------------
// Individual nav item button
// -------------------------------------------------------
function BottomNavItemButton({
  item,
  isActive,
  chatUnreadCount,
  reportsUnreadCount,
  onSectionChange,
  onToggleSidebar,
}: {
  item: BottomNavItem;
  isActive: boolean;
  chatUnreadCount: number;
  reportsUnreadCount: number;
  onSectionChange: (id: string) => void;
  onToggleSidebar: () => void;
}) {
  const handleClick = () => {
    if (item.isMore) {
      onToggleSidebar();
    } else {
      onSectionChange(item.id);
    }
  };

  return (
    <motion.button
      onClick={handleClick}
      className="relative flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1.5 rounded-xl transition-colors duration-200"
      whileTap={{ scale: 0.9 }}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
    >
      {/* Active background highlight */}
      <AnimatePresence mode="wait">
        {isActive && (
          <motion.div
            layoutId="bottomNavActiveBg"
            className="absolute inset-0 rounded-xl bg-primary/10"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        )}
      </AnimatePresence>

      {/* Icon container */}
      <span
        className={`relative z-10 transition-colors duration-200 ${
          isActive ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        {item.icon}

        {/* Chat unread badge */}
        {item.id === 'chat' && chatUnreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-1.5 -start-1.5 flex items-center justify-center rounded-full bg-amber-500 text-white font-bold h-4 min-w-4 text-[9px] px-1 leading-none shadow-sm"
          >
            {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
          </motion.span>
        )}
        {/* Reports unread badge */}
        {(item.id === 'reports' || item.id === 'complaints') && reportsUnreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-1.5 -start-1.5 flex items-center justify-center rounded-full bg-rose-500 text-white font-bold h-4 min-w-4 text-[9px] px-1 leading-none shadow-sm"
          >
            {reportsUnreadCount > 99 ? '99+' : reportsUnreadCount}
          </motion.span>
        )}
      </span>

      {/* Label */}
      <span
        className={`relative z-10 text-[10px] font-medium leading-tight transition-colors duration-200 ${
          isActive ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        {item.label}
      </span>

      {/* Active indicator dot */}
      <AnimatePresence mode="wait">
        {isActive && (
          <motion.div
            layoutId="bottomNavIndicator"
            className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}
