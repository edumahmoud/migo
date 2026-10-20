'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, FileText, Users, TrendingUp, BookOpen, FolderOpen,
  FileSpreadsheet, Settings, MessageCircle, Bell, Activity, Database,
  Video, ShieldAlert, ListTodo, Calendar as CalendarIcon, Menu, Ban,
  Megaphone, Building2, StickyNote, GraduationCap, Package, UserCog,
  Wallet, Clock, History, DollarSign, Lock,
} from 'lucide-react';
import { Drawer, ScrollArea, Text, Box, NavLink, Badge } from '@mantine/core';
import { useIsMobile, useIsTablet } from '@/hooks/use-mobile';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';
import { useInstitutionStore } from '@/stores/institution-store';
import { useLockedSectionsStore } from '@/stores/locked-sections-store';
import StickyNoteModal from '@/components/shared/sticky-note-modal';

interface AppSidebarProps {
  role: 'student' | 'teacher' | 'admin' | 'superadmin';
  activeSection: string;
  onSectionChange: (section: string) => void;
  customNavItems?: NavItem[];
}

interface NavItem {
  id: string;
  label?: string;
  labelKey?: string;
  icon: React.ReactNode;
}

const studentNavItems: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', labelKey: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'tracking', labelKey: 'nav.studentTracking', icon: <Activity className="h-5 w-5" /> },
  { id: 'chat', labelKey: 'nav.chat', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'teachers', labelKey: 'nav.teachers', icon: <Users className="h-5 w-5" /> },
  { id: 'summaries', labelKey: 'nav.summaries', icon: <FileText className="h-5 w-5" /> },
  { id: 'assignments', labelKey: 'nav.assignments', icon: <FileSpreadsheet className="h-5 w-5" /> },
  { id: 'videos', labelKey: 'nav.videos', icon: <Video className="h-5 w-5" /> },
  { id: 'files', labelKey: 'nav.files', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'todos', labelKey: 'nav.todos', icon: <ListTodo className="h-5 w-5" /> },
  { id: 'calendar', labelKey: 'nav.calendar', icon: <CalendarIcon className="h-5 w-5" /> },
  { id: 'reports', labelKey: 'nav.complaints', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'subscriptionHistory', labelKey: 'nav.subscriptionHistory', icon: <History className="h-5 w-5" /> },
  { id: 'notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

const teacherNavItems: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', labelKey: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'summaries', labelKey: 'nav.summaries', icon: <FileText className="h-5 w-5" /> },
  { id: 'questionBank', labelKey: 'nav.questionBank', icon: <Database className="h-5 w-5" /> },
  { id: 'scormLibrary', labelKey: 'nav.scormLibrary', icon: <Package className="h-5 w-5" /> },
  { id: 'registration', labelKey: 'nav.registration', icon: <UserCog className="h-5 w-5" /> },
  { id: 'financialManagement', labelKey: 'nav.financialManagement', icon: <DollarSign className="h-5 w-5" /> },
  { id: 'pendingOrders', labelKey: 'nav.pendingOrders', icon: <Clock className="h-5 w-5" /> },
  { id: 'chat', labelKey: 'nav.chat', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'students', labelKey: 'nav.students', icon: <Users className="h-5 w-5" /> },
  { id: 'tracking', labelKey: 'nav.tracking', icon: <Activity className="h-5 w-5" /> },
  { id: 'videos', labelKey: 'nav.videos', icon: <Video className="h-5 w-5" /> },
  { id: 'files', labelKey: 'nav.files', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'todos', labelKey: 'nav.todos', icon: <ListTodo className="h-5 w-5" /> },
  { id: 'calendar', labelKey: 'nav.calendar', icon: <CalendarIcon className="h-5 w-5" /> },
  { id: 'reports', labelKey: 'nav.complaints', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'analytics', labelKey: 'nav.analytics', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

function NavItems({
  navItems, activeSection, onSectionChange, collapsed, onNavClick, role,
}: {
  navItems: NavItem[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  collapsed: boolean;
  onNavClick?: () => void;
  role?: string;
}) {
  const { chatUnreadCount, reportsUnreadCount } = useAppStore();
  const { t } = useTranslations();
  const isLocked = useLockedSectionsStore((s) => s.isLocked);

  return (
    <Box>
      {navItems.map((item) => {
        const isActive = activeSection === item.id;
        const locked = isLocked(item.id);
        const label = item.label || t(item.labelKey || '');

        return (
          <NavLink
            key={item.id}
            active={isActive}
            label={collapsed ? '' : label}
            leftSection={(
              <Box style={{ position: 'relative', display: 'inline-flex' }}>
                {item.icon}
                {locked && (
                  <Box
                    style={{
                      position: 'absolute', top: -4, insetInlineEnd: -4,
                      backgroundColor: 'var(--mantine-color-yellow-5)',
                      borderRadius: '50%', width: 12, height: 12,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Lock size={8} color="white" />
                  </Box>
                )}
                {item.id === 'chat' && chatUnreadCount > 0 && (
                  <Badge
                    color="yellow"
                    size="sm"
                    circle
                    style={{ position: 'absolute', top: -6, insetInlineStart: -6, minWidth: 16, height: 16, fontSize: '9px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </Badge>
                )}
                {(item.id === 'reports' || item.id === 'complaints') && reportsUnreadCount > 0 && role !== 'admin' && role !== 'superadmin' && (
                  <Badge
                    color="red"
                    size="sm"
                    circle
                    style={{ position: 'absolute', top: -6, insetInlineStart: -6, minWidth: 16, height: 16, fontSize: '9px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {reportsUnreadCount > 99 ? '99+' : reportsUnreadCount}
                  </Badge>
                )}
              </Box>
            )}
            onClick={() => { onSectionChange(item.id); onNavClick?.(); }}
            style={{
              opacity: locked ? 0.75 : 1,
              minHeight: 44,
              touchTarget: 'manipulation',
            }}
            title={collapsed ? label : undefined}
          />
        );
      })}
    </Box>
  );
}

function SidebarLogo() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  useEffect(() => { if (!loaded) fetchInstitution(); }, [loaded, fetchInstitution]);

  if (institution?.logo_url) {
    return (
      <img
        src={institution.logo_url}
        alt={institution.name}
        style={{ height: 32, width: 32, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <Box
      style={{
        height: 32, width: 32, borderRadius: 12, flexShrink: 0,
        backgroundColor: 'var(--mantine-primary-color-filled)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <GraduationCap size={16} color="white" />
    </Box>
  );
}

function SidebarTitle() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  const { t } = useTranslations();
  useEffect(() => { if (!loaded) fetchInstitution(); }, [loaded, fetchInstitution]);

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Text size="sm" fw={700} c="var(--mantine-primary-color-filled)" truncate style={{ maxWidth: 140 }}>
        {loaded ? (institution?.name || t('common.appName')) : '\u00A0'}
      </Text>
      {loaded && institution?.tagline && (
        <Text size="xs" c="dimmed" truncate style={{ maxWidth: 140, fontSize: '9px' }}>
          {institution.tagline}
        </Text>
      )}
    </Box>
  );
}

export default function AppSidebar({
  role, activeSection, onSectionChange, customNavItems,
}: AppSidebarProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const { user } = useAuthStore();
  const { t, isRTL, direction } = useTranslations();
  const [stickyModalOpen, setStickyModalOpen] = useState(false);
  const navItems = customNavItems || (role === 'student' ? studentNavItems : (role === 'admin' || role === 'superadmin') ? [] : teacherNavItems);
  const collapsed = isTablet ? !sidebarOpen : !sidebarOpen;

  // Mobile: Drawer
  if (isMobile) {
    return (
      <>
        <Drawer
          opened={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          position={isRTL ? 'right' : 'left'}
          size={280}
          padding={0}
          withCloseButton={false}
          styles={{ body: { padding: 0 } }}
        >
          <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }} dir={direction}>
            <Box
              p="sm"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
                borderBottom: '1px solid var(--mantine-color-default-border)', height: 64,
              }}
            >
              <SidebarLogo />
              <SidebarTitle />
            </Box>
            <ScrollArea style={{ flex: 1, minHeight: 0 }}>
              <Box p="sm">
                <NavItems
                  navItems={navItems}
                  activeSection={activeSection}
                  onSectionChange={onSectionChange}
                  collapsed={false}
                  onNavClick={() => setSidebarOpen(false)}
                  role={role}
                />
              </Box>
            </ScrollArea>
            {user && (
              <Box p="sm" style={{ flexShrink: 0, borderTop: '1px solid var(--mantine-color-default-border)', display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={() => { setStickyModalOpen(true); setSidebarOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, borderRadius: 8,
                    padding: '10px 16px', fontSize: 12, fontWeight: 500,
                    color: 'var(--mantine-color-yellow-7)', background: 'none', border: 'none',
                    cursor: 'pointer', flexDirection: isRTL ? 'row-reverse' : 'row',
                  }}
                >
                  <StickyNote size={16} style={{ flexShrink: 0 }} />
                  <span>{t('nav.stickyNotes')}</span>
                </button>
              </Box>
            )}
          </Box>
        </Drawer>
        <StickyNoteModal open={stickyModalOpen} onClose={() => setStickyModalOpen(false)} />
      </>
    );
  }

  // Desktop: Fixed sidebar
  return (
    <aside
      className={`fixed start-0 top-0 z-50 h-screen border-e bg-sidebar shadow-sm transition-all duration-300 ease-in-out ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
      style={{ borderColor: 'var(--mantine-color-default-border)', backgroundColor: 'var(--mantine-color-body)' }}
    >
      <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }} dir={direction}>
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Box p="sm">
            <NavItems
              navItems={navItems}
              activeSection={activeSection}
              onSectionChange={onSectionChange}
              collapsed={collapsed}
              role={role}
            />
          </Box>
        </ScrollArea>

        {user && (
          <Box p="xs" style={{ flexShrink: 0, borderTop: '1px solid var(--mantine-color-default-border)', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setStickyModalOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8,
                padding: '10px 12px', fontSize: 12, fontWeight: 500,
                color: 'var(--mantine-color-yellow-7)', background: 'none', border: 'none',
                cursor: 'pointer', flexDirection: collapsed ? 'column' : (isRTL ? 'row-reverse' : 'row'),
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
              title={collapsed ? t('nav.stickyNotes') : undefined}
            >
              <StickyNote size={16} style={{ flexShrink: 0 }} />
              {!collapsed && <span>{t('nav.stickyNotes')}</span>}
            </button>
          </Box>
        )}

        <StickyNoteModal open={stickyModalOpen} onClose={() => setStickyModalOpen(false)} />
      </Box>
    </aside>
  );
}
