'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
  CalendarCheck,
  BrainCircuit,
  X,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const setStudentSection = useAppStore((s) => s.setStudentSection);
  const setTeacherSection = useAppStore((s) => s.setTeacherSection);
  const setAdminSection = useAppStore((s) => s.setAdminSection);
  const router = useRouter();

  const handleNav = (sectionId: string) => {
    const path = getSectionPath(role, sectionId);

    // IMMEDIATELY update the Zustand store — this is the PRIMARY navigation
    // mechanism. The store change triggers an instant re-render, showing the
    // new section without waiting for usePathname() to update.
    // (In Next.js 16 catch-all routes, usePathname() may not re-render reliably)
    if (role === 'student') setStudentSection(sectionId as any);
    else if (role === 'teacher') setTeacherSection(sectionId as any);
    else setAdminSection(sectionId as any);

    // Close the mobile drawer FIRST (before navigation)
    // This ensures no Radix Dialog artifacts remain
    onNavClick?.();

    // Also navigate via URL (for browser history, address bar, back/forward)
    router.push(path);
  };

  return (
    <ul className="space-y-1">
      {navItems.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <li key={item.id}>
            <button
              onClick={() => handleNav(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                collapsed
                  ? 'justify-center px-2 py-3'
                  : 'px-4 py-3'
              } ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent active:bg-muted/80'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <span
                className={`transition-colors duration-200 shrink-0 relative ${
                  isActive ? 'text-emerald-600' : 'text-muted-foreground'
                }`}
              >
                {item.icon}
                {/* Notification badge on chat icon */}
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
                    <span className="mr-auto h-2 w-2 rounded-full bg-emerald-500" />
                  )}
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// -------------------------------------------------------
// Mobile Drawer — CSS-only, NO Radix UI Dialog
// -------------------------------------------------------
// WHY NOT Radix Sheet?
// Radix UI Dialog adds `inert` attribute to the React root when a
// dialog/sheet opens. This blocks ALL user interaction but NOT CSS :hover.
//
// WHY NO role="dialog" / aria-modal?
// These attributes are INAPPROPRIATE for a navigation sidebar.
// A sidebar is NOT a modal dialog — it doesn't trap focus and
// shouldn't block interaction with the rest of the page.
//
// More critically: on iOS Safari, aria-modal="true" triggers the
// accessibility engine to suppress click events on elements outside
// the dialog. Even after removing the attribute, iOS Safari caches
// the accessibility tree and may continue suppressing clicks.
// The ONLY reliable fix is to NEVER use these attributes on the
// drawer, and to completely unmount drawer elements from the DOM
// when closed (not just hide with CSS).
//
// This custom CSS drawer:
// - Uses CSS transform for slide animation (no JS animation library)
// - Does NOT use role="dialog" or aria-modal (nav sidebar, not modal)
// - Does NOT add `inert` to the page
// - COMPLETELY UNMOUNTS when closed (no DOM residue)
// - Uses `nav` role for semantic HTML
// - Closes on backdrop click and Escape key
// - Zero risk of blocking page interactivity
function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // `mounted` tracks whether the drawer DOM elements should be rendered.
  // When open=true, we mount immediately. When open=false, we keep
  // the elements mounted for the close animation, then unmount after
  // the transition completes (via onTransitionEnd) or after 400ms timeout.
  const [mounted, setMounted] = useState(false);

  // When opening, set mounted immediately during render (before paint)
  if (open && !mounted) {
    setMounted(true);
  }

  // Close on Escape key — only when drawer is open
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  // Safety: force unmount after 400ms when closing
  // (in case onTransitionEnd doesn't fire on some mobile browsers)
  useEffect(() => {
    if (open || !mounted) return;
    const timeout = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(timeout);
  }, [open, mounted]);

  const handleTransitionEnd = () => {
    if (!open && mounted) {
      setMounted(false);
    }
  };

  // When completely unmounted, render nothing
  if (!mounted) return null;

  return (
    <>
      {/* Backdrop overlay — click to close */}
      {/* ONLY in the DOM when drawer is open/closing, never when fully closed */}
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel — slides from right (RTL) */}
      {/* NO role="dialog" or aria-modal — this is a nav sidebar, NOT a modal */}
      <nav
        aria-label="القائمة الرئيسية"
        className={`fixed top-0 right-0 z-50 h-full w-72 bg-background shadow-xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        dir="rtl"
        onTransitionEnd={handleTransitionEnd}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 left-3 rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          aria-label="إغلاق القائمة"
        >
          <X className="h-5 w-5" />
        </button>

        {children}
      </nav>
    </>
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

  // Stable close callback — prevents MobileDrawer useEffect from re-running on every render
  const closeSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);

  // On mobile, use custom CSS drawer (NOT Radix Sheet)
  if (isMobile) {
    return (
      <MobileDrawer open={sidebarOpen} onClose={closeSidebar}>
        <div className="flex h-full flex-col overflow-hidden pt-2" dir="rtl">
          <ScrollArea className="flex-1 min-h-0">
            <nav className="px-3 py-4">
              <NavItems
                navItems={navItems}
                activeSection={activeSection}
                role={role}
                collapsed={false}
                onNavClick={closeSidebar}
              />
            </nav>
          </ScrollArea>
        </div>
      </MobileDrawer>
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
