'use client';

import { useCallback } from 'react';
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
  ChevronRight,
  ChevronLeft,
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
  const { t } = useTranslations();

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
                  : 'px-4 py-3'
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
                  <span>{t(item.labelKey)}</span>
                  {isActive && item.id !== 'chat' && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="ms-auto h-2 w-2 rounded-full bg-sidebar-primary"
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
  const { t, isRTL, direction } = useTranslations();
  const navItems = customNavItems || (role === 'student' ? studentNavItems : (role === 'admin' || role === 'superadmin') ? [] : teacherNavItems);

  // On tablet, treat sidebar as collapsed (compact icon-only mode) unless explicitly opened
  const collapsed = isTablet ? !sidebarOpen : !sidebarOpen;

  const handleToggle = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [sidebarOpen, setSidebarOpen]);

  // On mobile, use Sheet (drawer)
  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side={isRTL ? 'right' : 'left'} className="w-72 p-0 bg-sidebar border-sidebar-border">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('nav.mainMenu')}</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col overflow-hidden pt-2" dir={direction}>
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
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Fixed sidebar, collapsible - position based on direction
  return (
    <aside
      className={`fixed start-0 top-14 md:top-16 z-50 h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)] border-sidebar-border bg-sidebar shadow-sm transition-all duration-300 ease-in-out ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
    >
      <div className="flex h-full flex-col overflow-hidden" dir={direction}>
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

        {/* Collapse toggle button at bottom */}
        <div className={`shrink-0 border-sidebar-border border-t p-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={handleToggle}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50 transition-all ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {isRTL ? (
              <ChevronLeft className={`h-4 w-4 shrink-0 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
            ) : (
              <ChevronRight className={`h-4 w-4 shrink-0 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
            )}
            {!collapsed && <span>{t('nav.collapseSidebar')}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
