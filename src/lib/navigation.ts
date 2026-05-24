// =====================================================
// Shared Navigation Configuration
// Single source of truth for all navigation items
// =====================================================

import {
  LayoutDashboard,
  Users,
  BookOpen,
  FileText,
  FileSpreadsheet,
  FolderOpen,
  TrendingUp,
  MessageCircle,
  Settings,
  Bell,
  Ban,
  Megaphone,
  Building2,
  Database,
  ShieldAlert,
} from 'lucide-react';
import type { StudentSection, TeacherSection, AdminSection } from '@/lib/types';

export interface NavItem<T extends string = string> {
  id: T;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  superadminOnly?: boolean;
}

// -------------------------------------------------------
// Student navigation items
// Matches: app-sidebar.tsx, page.tsx
// -------------------------------------------------------
export const studentNavItems: NavItem<StudentSection>[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'subjects', labelKey: 'nav.subjects', icon: BookOpen },
  { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle },
  { id: 'teachers', labelKey: 'nav.teachers', icon: Users },
  { id: 'summaries', labelKey: 'nav.summaries', icon: FileText },
  { id: 'assignments', labelKey: 'nav.assignments', icon: FileSpreadsheet },
  { id: 'files', labelKey: 'nav.files', icon: FolderOpen },
  { id: 'reports', labelKey: 'nav.complaints', icon: ShieldAlert },
  { id: 'notifications', labelKey: 'nav.notifications', icon: Bell },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
];

// -------------------------------------------------------
// Teacher navigation items
// Matches: app-sidebar.tsx, page.tsx
// -------------------------------------------------------
export const teacherNavItems: NavItem<TeacherSection>[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'subjects', labelKey: 'nav.subjects', icon: BookOpen },
  { id: 'questionBank', labelKey: 'nav.questionBank', icon: Database },
  { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle },
  { id: 'students', labelKey: 'nav.students', icon: Users },
  { id: 'files', labelKey: 'nav.files', icon: FolderOpen },
  { id: 'reports', labelKey: 'nav.complaints', icon: ShieldAlert },
  { id: 'analytics', labelKey: 'nav.analytics', icon: TrendingUp },
  { id: 'notifications', labelKey: 'nav.notifications', icon: Bell },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
];

// -------------------------------------------------------
// Admin navigation items
// Matches: admin-dashboard.tsx, page.tsx
// -------------------------------------------------------
export const adminNavItems: NavItem<AdminSection>[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'users', labelKey: 'nav.users', icon: Users },
  { id: 'subjects', labelKey: 'nav.subjects', icon: BookOpen },
  { id: 'announcements', labelKey: 'nav.announcements', icon: Megaphone },
  { id: 'banned', labelKey: 'nav.banned', icon: Ban },
  { id: 'complaints', labelKey: 'nav.complaints', icon: ShieldAlert },
  { id: 'reports', labelKey: 'nav.reports', icon: TrendingUp },
  { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
  { id: 'institution', labelKey: 'nav.institution', icon: Building2, superadminOnly: true },
];

// -------------------------------------------------------
// Role-based lookup
// -------------------------------------------------------
export function getNavItemsForRole(role: string) {
  switch (role) {
    case 'admin':
    case 'superadmin':
      return adminNavItems;
    case 'teacher':
      return teacherNavItems;
    case 'student':
    default:
      return studentNavItems;
  }
}
