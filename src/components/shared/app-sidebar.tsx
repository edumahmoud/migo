'use client';

import { useRouter, usePathname } from 'next/navigation';
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
  Megaphone,
  Ban,
  Building2,
  ClipboardList,
  CalendarCheck,
  BrainCircuit,
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
import {
  STUDENT_SECTION_PATHS,
  TEACHER_SECTION_PATHS,
  ADMIN_SECTION_PATHS,
} from '@/lib/navigation-config';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface AppSidebarProps {
  role: 'student' | 'teacher' | 'admin' | 'superadmin';
  activeSection: string;
  /** @deprecated No longer used - navigation is now URL-based via router.push */
  onSectionChange?: (section: string) => void;
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
  { id: 'chat', label: 'المحادثات', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'teachers', label: 'المعلمون', icon: <Users className="h-5 w-5" /> },
  { id: 'summaries', label: 'الملخصات', icon: <FileText className="h-5 w-5" /> },
  { id: 'quizzes', label: 'الاختبارات', icon: <BrainCircuit className="h-5 w-5" /> },
  { id: 'assignments', label: 'المهام', icon: <FileSpreadsheet className="h-5 w-5" /> },
  { id: 'attendance', label: 'الحضور', icon: <CalendarCheck className="h-5 w-5" /> },
  { id: 'files', label: 'ملفاتي', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-5 w-5" /> },
];

const teacherNavItems: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects', label: 'المقررات', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'chat', label: 'المحادثات', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'students', label: 'الطلاب', icon: <Users className="h-5 w-5" /> },
  { id: 'assignments', label: 'المهام', icon: <FileSpreadsheet className="h-5 w-5" /> },
  { id: 'attendance', label: 'الحضور', icon: <CalendarCheck className="h-5 w-5" /> },
  { id: 'files', label: 'ملفاتي', icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'analytics', label: 'التقارير', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="h-5 w-5" /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-5 w-5" /> },
];

const defaultAdminNavItems: NavItem[] = [
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

// -------------------------------------------------------
// Get the URL path for a given section + role
// -------------------------------------------------------
function getSectionPath(role: 'student' | 'teacher' | 'admin' | 'superadmin', sectionId: string): string {
  if (role === 'student') return STUDENT_SECTION_PATHS[sectionId as keyof typeof STUDENT_SECTION_PATHS] || '/student';
  if (role === 'teacher') return TEACHER_SECTION_PATHS[sectionId as keyof typeof TEACHER_SECTION_PATHS] || '/teacher';
  return ADMIN_SECTION_PATHS[sectionId as keyof typeof ADMIN_SECTION_PATHS] || '/admin';
}

// -------------------------------------------------------
// Navigation items content (shared between collapsed/expanded/mobile)
// -------------------------------------------------------
function NavItems({
  navItems,
  activeSection,
  role,
  collapsed,
  onNavClick,
}: {
  navItems: NavItem[];
  activeSection: string;
  role: 'student' | 'teacher' | 'admin' | 'superadmin';
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  const chatUnreadCount = useAppStore((s) => s.chatUnreadCount);
  const router = useRouter();

  const handleNav = (sectionId: string) => {
    // Navigate via URL — usePathname() is the SOLE source of truth for the UI.
    // The URL change triggers re-render, which updates activeSection from pathname.
    // The Zustand store is synced FROM pathname (not vice versa), eliminating race conditions.
    const path = getSectionPath(role, sectionId);
    router.push(path);

    // Close the mobile sheet
    onNavClick?.();
  };

  return (
    <ul className="space-y-1">
      {navItems.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <li key={item.id}>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleNav(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                collapsed
                  ? 'justify-center px-2 py-3'
                  : 'px-4 py-3'
              } ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <span
                className={`transition-colors duration-200 shrink-0 relative ${
                  isActive ? 'text-emerald-600' : 'text-muted-foreground'
                }`}
              >
                {item.icon}
                {/* Notification badge on chat icon - always visible */}
                {item.id === 'chat' && chatUnreadCount > 0 && (
                  <span
                    className={`absolute -top-1.5 -start-1.5 flex items-center justify-center rounded-full bg-emerald-600 text-white font-bold ${
                      collapsed ? 'h-4 min-w-4 text-[8px] px-0.5' : 'h-5 min-w-5 text-[10px] px-1.5'
                    }`}
                  >
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </span>
                )}
              </span>
              {!collapsed && (
                <>
                  <span>{item.label}</span>
                  {isActive && item.id !== 'chat' && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="mr-auto h-2 w-2 rounded-full bg-emerald-500"
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
  onSectionChange: _onSectionChange,
  customNavItems,
}: AppSidebarProps) {
  const isMobile = useIsMobile();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const navItems = customNavItems || (role === 'student' ? studentNavItems : (role === 'admin' || role === 'superadmin') ? defaultAdminNavItems : teacherNavItems);

  const collapsed = !sidebarOpen;

  const handleToggle = () => {
    setSidebarOpen(!sidebarOpen);
  };

  // On mobile, use Sheet (drawer)
  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="right" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>القائمة الرئيسية</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col overflow-hidden pt-2" dir="rtl">
            <ScrollArea className="flex-1 min-h-0">
              <nav className="px-3 py-4">
                <NavItems
                  navItems={navItems}
                  activeSection={activeSection}
                  role={role}
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
      className={`fixed right-0 top-14 sm:top-16 z-50 h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)] border-l bg-background shadow-sm transition-all duration-300 ease-in-out ${
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
              role={role}
              collapsed={collapsed}
            />
          </nav>
        </ScrollArea>

        {/* Collapse toggle button at bottom */}
        <div className={`shrink-0 border-t p-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={handleToggle}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all ${
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
