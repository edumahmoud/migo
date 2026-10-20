'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, BookOpen, MessageCircle, Bell, Menu, Users, FolderOpen, TrendingUp,
} from 'lucide-react';
import { Box, Text, Badge as MBadge } from '@mantine/core';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';

interface MobileBottomNavProps {
  role: 'student' | 'teacher' | 'admin' | 'superadmin';
  activeSection: string;
  onSectionChange: (section: string) => void;
  onToggleSidebar: () => void;
}

interface BottomNavItem {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
  isMore?: boolean;
}

const studentNavItems: BottomNavItem[] = [
  { id: 'subjects', labelKey: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'files', labelKey: 'nav.files', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'more', labelKey: 'nav.more', icon: <Menu className="h-5 w-5" />, isMore: true },
];

const teacherNavItems: BottomNavItem[] = [
  { id: 'subjects', labelKey: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'files', labelKey: 'nav.files', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'more', labelKey: 'nav.more', icon: <Menu className="h-5 w-5" />, isMore: true },
];

const adminNavItems: BottomNavItem[] = [
  { id: 'users', labelKey: 'nav.users', icon: <Users className="h-5 w-5" /> },
  { id: 'notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'reports', labelKey: 'nav.reports', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'more', labelKey: 'nav.more', icon: <Menu className="h-5 w-5" />, isMore: true },
];

export default function MobileBottomNav({
  role, activeSection, onSectionChange, onToggleSidebar,
}: MobileBottomNavProps) {
  const isMobile = useIsMobile();
  const { chatUnreadCount, reportsUnreadCount } = useAppStore();
  const { direction } = useTranslations();

  if (!isMobile) return null;

  const navItems =
    role === 'admin' || role === 'superadmin'
      ? adminNavItems
      : role === 'teacher'
        ? teacherNavItems
        : studentNavItems;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--mantine-color-body) 95%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--mantine-color-default-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      dir={direction}
    >
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          height: 64,
          maxWidth: 512,
          margin: '0 auto',
          padding: '0 4px',
        }}
      >
        {navItems.map((item, index) => {
          const isActive = !item.isMore && activeSection === item.id;
          const isCenter = index === 2;

          return (
            <BottomNavItemButton
              key={item.id}
              item={item}
              isActive={isActive}
              isCenter={isCenter}
              chatUnreadCount={chatUnreadCount}
              reportsUnreadCount={reportsUnreadCount}
              onSectionChange={onSectionChange}
              onToggleSidebar={onToggleSidebar}
              role={role}
            />
          );
        })}
      </Box>
    </nav>
  );
}

function BottomNavItemButton({
  item, isActive, isCenter, chatUnreadCount, reportsUnreadCount,
  onSectionChange, onToggleSidebar, role,
}: {
  item: BottomNavItem;
  isActive: boolean;
  isCenter?: boolean;
  chatUnreadCount: number;
  reportsUnreadCount: number;
  onSectionChange: (id: string) => void;
  onToggleSidebar: () => void;
  role?: string;
}) {
  const { t } = useTranslations();

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
      className="relative flex flex-col items-center flex-1 min-w-0 rounded-xl transition-colors duration-200 gap-0.5 py-1.5"
      whileTap={{ scale: 0.9 }}
      aria-label={t(item.labelKey)}
      aria-current={isActive ? 'page' : undefined}
      style={{ minHeight: 48 }}
    >
      {/* Active background highlight */}
      {!isCenter && (
        <AnimatePresence mode="wait">
          {isActive && (
            <motion.div
              layoutId="bottomNavActiveBg"
              className="absolute inset-0 rounded-xl"
              style={{ backgroundColor: 'color-mix(in srgb, var(--mantine-primary-color-filled) 10%, transparent)' }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
        </AnimatePresence>
      )}

      {/* Center: floating circle icon */}
      {isCenter && (
        <span
          className="absolute -top-6 z-10 flex items-center justify-center h-12 w-12 rounded-full shadow-lg transition-colors duration-200"
          style={{
            backgroundColor: isActive
              ? 'var(--mantine-primary-color-filled)'
              : 'var(--mantine-color-gray-1)',
            color: isActive ? 'white' : 'var(--mantine-color-dimmed)',
          }}
        >
          {item.icon}
        </span>
      )}

      {/* Icon container for non-center items */}
      {!isCenter && (
        <span
          className="relative z-10 transition-colors duration-200"
          style={{
            color: isActive
              ? 'var(--mantine-primary-color-filled)'
              : 'var(--mantine-color-dimmed)',
          }}
        >
          {item.icon}

          {/* Chat unread badge */}
          {item.id === 'chat' && chatUnreadCount > 0 && (
            <span
              className="absolute -top-1.5 -start-1.5 flex items-center justify-center rounded-full text-white font-bold h-4 min-w-4 text-[9px] px-1 leading-none shadow-sm"
              style={{ backgroundColor: 'var(--mantine-color-yellow-5)' }}
            >
              {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
            </span>
          )}
          {/* Reports unread badge */}
          {item.id === 'reports' && reportsUnreadCount > 0 && (
            <span
              className="absolute -top-1.5 -start-1.5 flex items-center justify-center rounded-full text-white font-bold h-4 min-w-4 text-[9px] px-1 leading-none shadow-sm"
              style={{ backgroundColor: 'var(--mantine-color-red-5)' }}
            >
              {reportsUnreadCount > 99 ? '99+' : reportsUnreadCount}
            </span>
          )}
        </span>
      )}

      {/* Center: invisible spacer */}
      {isCenter && <span className="h-5 w-5" aria-hidden="true" />}

      {/* Label */}
      <span
        className="relative z-10 text-[10px] font-medium leading-tight transition-colors duration-200"
        style={{
          color: isActive
            ? 'var(--mantine-primary-color-filled)'
            : 'var(--mantine-color-dimmed)',
        }}
      >
        {t(item.labelKey)}
      </span>

      {/* Active indicator dot */}
      {!isCenter && (
        <AnimatePresence mode="wait">
          {isActive && (
            <motion.div
              layoutId="bottomNavIndicator"
              className="absolute -bottom-0.5 h-1 w-1 rounded-full"
              style={{ backgroundColor: 'var(--mantine-primary-color-filled)' }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
        </AnimatePresence>
      )}
    </motion.button>
  );
}
