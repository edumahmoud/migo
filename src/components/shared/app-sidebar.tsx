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
  MessageCircle,
  Bell,
  Activity,
  Database,
  Video,
  ShieldAlert,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppStore } from '@/stores/app-store';

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
  label: string;
  icon: React.ReactNode;
}

// -------------------------------------------------------
// Navigation items per role
// -------------------------------------------------------
const studentNavItems: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'tracking', label: 'تتبع الطالب', icon: <Activity className="h-5 w-5" /> },
  { id: 'chat', label: 'المحادثات', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'teachers', label: 'المعلمون', icon: <Users className="h-5 w-5" /> },
  { id: 'summaries', label: 'الملخصات', icon: <FileText className="h-5 w-5" /> },
  { id: 'assignments', label: 'المهام', icon: <FileSpreadsheet className="h-5 w-5" /> },
  { id: 'videos', label: 'الفيديوهات', icon: <Video className="h-5 w-5" /> },
  { id: 'files', label: 'ملفاتي', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-5 w-5" /> },
];

const teacherNavItems: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'summaries', label: 'الملخصات', icon: <FileText className="h-5 w-5" /> },
  { id: 'questionBank', label: 'بنك الأسئلة', icon: <Database className="h-5 w-5" /> },
  { id: 'chat', label: 'المحادثات', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'students', label: 'الطلاب', icon: <Users className="h-5 w-5" /> },
  { id: 'tracking', label: 'تتبع الطلاب', icon: <Activity className="h-5 w-5" /> },
  { id: 'videos', label: 'الفيديوهات', icon: <Video className="h-5 w-5" /> },
  { id: 'files', label: 'ملفاتي', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'reports', label: 'الإبلاغات', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'analytics', label: 'التقارير', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-5 w-5" /> },
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
}: {
  navItems: NavItem[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  const { chatUnreadCount, reportsUnreadCount } = useAppStore();

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
              title={collapsed ? item.label : undefined}
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
                {/* Badge on reports icon */}
                {item.id === 'reports' && reportsUnreadCount > 0 && (
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
                  <span>{item.label}</span>
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
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const navItems = customNavItems || (role === 'student' ? studentNavItems : (role === 'admin' || role === 'superadmin') ? [] : teacherNavItems);

  const collapsed = !sidebarOpen;

  const handleToggle = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [sidebarOpen, setSidebarOpen]);

  // On mobile, use Sheet (drawer)
  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="right" className="w-72 p-0 bg-sidebar border-sidebar-border">
          <SheetHeader className="sr-only">
            <SheetTitle>القائمة الرئيسية</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col overflow-hidden pt-2" dir="rtl">
            <ScrollArea className="flex-1 min-h-0">
              <nav className="px-3 py-4 text-sidebar-foreground">
                <NavItems
                  navItems={navItems}
                  activeSection={activeSection}
                  onSectionChange={onSectionChange}
                  collapsed={false}
                  onNavClick={() => setSidebarOpen(false)}
                />
              </nav>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Fixed right sidebar (RTL), collapsible
  return (
    <aside
      className={`fixed right-0 top-14 sm:top-16 z-50 h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)] border-sidebar-border bg-sidebar shadow-sm transition-all duration-300 ease-in-out ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
    >
      <div className="flex h-full flex-col overflow-hidden" dir="rtl">
        {/* Navigation */}
        <ScrollArea className="flex-1 min-h-0">
          <nav className="px-2 sm:px-3 py-3 sm:py-4">
            <NavItems
              navItems={navItems}
              activeSection={activeSection}
              onSectionChange={onSectionChange}
              collapsed={collapsed}
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
            <ChevronRight className={`h-4 w-4 shrink-0 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
            {!collapsed && <span>طي القائمة</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
