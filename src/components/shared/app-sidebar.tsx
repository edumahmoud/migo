'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  FileText,
  Users,
  TrendingUp,
  BookOpen,
  FolderOpen,
  FileSpreadsheet,
  Settings,
  MessageCircle,
  Bell,
  Activity,
  Database,
  Video,
  ShieldAlert,
  ListTodo,
  Calendar as CalendarIcon,
  BarChart3,
  Menu,
  Ban,
  Megaphone,
  Building2,
  StickyNote,
  GraduationCap,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile, useIsTablet } from '@/hooks/use-mobile';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';
import { useInstitutionStore } from '@/stores/institution-store';
import StickyNoteModal from '@/components/shared/sticky-note-modal';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface AppSidebarProps {
  role: 'student' | 'teacher' | 'admin' | 'superadmin';
  activeSection: string;
  onSectionChange: (section: string) => void;
  customNavItems?: NavItem[];
}

interface NavItem {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
}

// -------------------------------------------------------
// Navigation items per role (using translation keys)
// -------------------------------------------------------
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
  { id: 'notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

const teacherNavItems: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', labelKey: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'summaries', labelKey: 'nav.summaries', icon: <FileText className="h-5 w-5" /> },
  { id: 'questionBank', labelKey: 'nav.questionBank', icon: <Database className="h-5 w-5" /> },
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

// -------------------------------------------------------
// Navigation items content (shared between collapsed/expanded/mobile)
// -------------------------------------------------------
function NavItems({
  navItems,
  activeSection,
  onSectionChange,
  collapsed,
  onNavClick,
  role,
}: {
  navItems: NavItem[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  collapsed: boolean;
  onNavClick?: () => void;
  role?: string;
}) {
  const { chatUnreadCount, reportsUnreadCount } = useAppStore();
  const { t, isRTL } = useTranslations();

  return (
    <ul className="space-y-1">
      {navItems.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <li key={item.id}>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                onSectionChange(item.id);
                onNavClick?.();
              }}
              className={`flex w-full items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                collapsed
                  ? 'justify-center px-2 py-3'
                  : isRTL ? 'flex-row-reverse px-4 py-3' : 'px-4 py-3'
              } ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground border border-sidebar-primary shadow-sm'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground border border-transparent'
              }`}
              title={collapsed ? t(item.labelKey) : undefined}
            >
              <span
                className={`transition-colors duration-200 shrink-0 relative ${
                  isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/60'
                }`}
              >
                {item.icon}
                {/* Notification badge on chat icon */}
                {item.id === 'chat' && chatUnreadCount > 0 && (
                  <span
                    className={`absolute -top-1.5 -start-1.5 flex items-center justify-center rounded-full bg-amber-500 text-white font-bold ${
                      collapsed ? 'h-4 min-w-4 text-[8px] px-0.5' : 'h-5 min-w-5 text-[10px] px-1.5'
                    }`}
                  >
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </span>
                )}
                {/* Badge on reports/complaints icon — hidden for admin/superadmin */}
                {(item.id === 'reports' || item.id === 'complaints') && reportsUnreadCount > 0 && role !== 'admin' && role !== 'superadmin' && (
                  <span
                    className={`absolute -top-1.5 -start-1.5 flex items-center justify-center rounded-full bg-rose-500 text-white font-bold ${
                      collapsed ? 'h-4 min-w-4 text-[8px] px-0.5' : 'h-5 min-w-5 text-[10px] px-1.5'
                    }`}
                  >
                    {reportsUnreadCount > 99 ? '99+' : reportsUnreadCount}
                  </span>
                )}
              </span>
              {!collapsed && (
                <>
                  <span className={isRTL ? 'text-end flex-1' : ''}>{t(item.labelKey)}</span>
                  {isActive && item.id !== 'chat' && (
                    <motion.div
                      layoutId="activeIndicator"
                      className={`${isRTL ? 'me-auto' : 'ms-auto'} h-2 w-2 rounded-full bg-sidebar-primary`}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </>
              )}
            </motion.button>
          </li>
        );
      })}
    </ul>
  );
}

// -------------------------------------------------------
// Sidebar Logo — shows institution logo or default icon
// -------------------------------------------------------
function SidebarLogo() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();

  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  if (institution?.logo_url) {
    return (
      <img
        src={institution.logo_url}
        alt={institution.name}
        className="h-8 w-8 shrink-0 rounded-xl object-cover border border-sidebar-primary/20 shadow-sm"
      />
    );
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary shadow-sm">
      <GraduationCap className="h-4 w-4 text-sidebar-primary-foreground" />
    </div>
  );
}

// -------------------------------------------------------
// Sidebar Title — shows institution name or default app name
// -------------------------------------------------------
function SidebarTitle() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  const { t } = useTranslations();

  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  return (
    <div className="flex flex-col min-w-0">
      <h1 className="text-sm font-bold text-sidebar-primary whitespace-nowrap truncate max-w-[140px]">
        {loaded ? (institution?.name || t('common.appName')) : '\u00A0'}
      </h1>
      {loaded && institution?.tagline && (
        <span className="text-[9px] text-sidebar-foreground/50 whitespace-nowrap truncate max-w-[140px] -mt-0.5">
          {institution.tagline}
        </span>
      )}
    </div>
  );
}

// -------------------------------------------------------
// Main exported component
// -------------------------------------------------------
export default function AppSidebar({
  role,
  activeSection,
  onSectionChange,
  customNavItems,
}: AppSidebarProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const { user } = useAuthStore();
  const { t, isRTL, direction } = useTranslations();
  const [stickyModalOpen, setStickyModalOpen] = useState(false);
  const navItems = customNavItems || (role === 'student' ? studentNavItems : (role === 'admin' || role === 'superadmin') ? [] : teacherNavItems);

  // On tablet, treat sidebar as collapsed (compact icon-only mode) unless explicitly opened
  const collapsed = isTablet ? !sidebarOpen : !sidebarOpen;

  // On mobile, use Sheet (drawer)
  if (isMobile) {
    return (
      <>
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side={isRTL ? 'right' : 'left'} className="w-72 p-0 bg-sidebar border-sidebar-border">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('nav.mainMenu')}</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col overflow-hidden" dir={direction}>
            {/* Mobile: App branding inside mobile sidebar (desktop shows it in header) */}
            <div className="shrink-0 flex items-center gap-2.5 border-b border-sidebar-border px-3 h-14 md:h-16 md:hidden">
              <SidebarLogo />
              <SidebarTitle />
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <nav className="px-3 py-4 text-sidebar-foreground">
                <NavItems
                  navItems={navItems}
                  activeSection={activeSection}
                  onSectionChange={onSectionChange}
                  collapsed={false}
                  onNavClick={() => setSidebarOpen(false)}
                  role={role}
                />
              </nav>
            </ScrollArea>

            {/* Sticky Notes button - Mobile */}
            {user && (
              <div className="shrink-0 border-sidebar-border border-t p-3">
                <button
                  onClick={() => { setStickyModalOpen(true); setSidebarOpen(false); }}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-all w-full ${isRTL ? 'flex-row-reverse' : ''}`}
                >
                  <StickyNote className="h-4 w-4 shrink-0" />
                  <span>{t('nav.stickyNotes')}</span>
                </button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <StickyNoteModal open={stickyModalOpen} onClose={() => setStickyModalOpen(false)} />
    </>
    );
  }

  // Desktop: Fixed sidebar, full screen height, collapsible
  return (
    <aside
      className={`fixed start-0 top-0 z-50 h-screen border-e border-sidebar-border bg-sidebar shadow-sm transition-all duration-300 ease-in-out ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
    >
      <div className="flex h-full flex-col overflow-hidden" dir={direction}>
        {/* Desktop: No branding in sidebar — logo/title shown in header */}

        {/* Navigation */}
        <ScrollArea className="flex-1 min-h-0">
          <nav className="px-2 sm:px-3 py-3 sm:py-4">
            <NavItems
              navItems={navItems}
              activeSection={activeSection}
              onSectionChange={onSectionChange}
              collapsed={collapsed}
              role={role}
            />
          </nav>
        </ScrollArea>

        {/* Sticky Notes button */}
        {user && (
          <div className={`shrink-0 border-sidebar-border border-t p-2 ${collapsed ? 'flex justify-center' : ''}`}>
            <button
              onClick={() => setStickyModalOpen(true)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-all ${
                collapsed ? 'justify-center' : isRTL ? 'flex-row-reverse' : ''
              }`}
              title={collapsed ? t('nav.stickyNotes') : undefined}
            >
              <StickyNote className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{t('nav.stickyNotes')}</span>}
            </button>
          </div>
        )}

        {/* Sticky Note Modal */}
        <StickyNoteModal open={stickyModalOpen} onClose={() => setStickyModalOpen(false)} />
      </div>
    </aside>
  );
}
