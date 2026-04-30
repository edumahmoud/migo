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
} from 'lucide-react';
import type { StudentSection, TeacherSection, AdminSection } from '@/lib/types';

export interface NavItem<T extends string = string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  superadminOnly?: boolean;
}

// -------------------------------------------------------
// Student navigation items
// Matches: app-sidebar.tsx, page.tsx
// -------------------------------------------------------
export const studentNavItems: NavItem<StudentSection>[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'subjects', label: 'المقررات', icon: BookOpen },
  { id: 'chat', label: 'المحادثات', icon: MessageCircle },
  { id: 'teachers', label: 'المعلمون', icon: Users },
  { id: 'summaries', label: 'الملخصات', icon: FileText },
  { id: 'assignments', label: 'المهام', icon: FileSpreadsheet },
  { id: 'files', label: 'ملفاتي', icon: FolderOpen },
  { id: 'notifications', label: 'الإشعارات', icon: Bell },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

// -------------------------------------------------------
// Teacher navigation items
// Matches: app-sidebar.tsx, page.tsx
// -------------------------------------------------------
export const teacherNavItems: NavItem<TeacherSection>[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'subjects', label: 'المقررات', icon: BookOpen },
  { id: 'chat', label: 'المحادثات', icon: MessageCircle },
  { id: 'students', label: 'الطلاب', icon: Users },
  { id: 'files', label: 'ملفاتي', icon: FolderOpen },
  { id: 'analytics', label: 'التقارير', icon: TrendingUp },
  { id: 'notifications', label: 'الإشعارات', icon: Bell },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

// -------------------------------------------------------
// Admin navigation items
// Matches: admin-dashboard.tsx, page.tsx
// -------------------------------------------------------
export const adminNavItems: NavItem<AdminSection>[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'users', label: 'المستخدمون', icon: Users },
  { id: 'subjects', label: 'المقررات', icon: BookOpen },
  { id: 'announcements', label: 'الإعلانات', icon: Megaphone },
  { id: 'banned', label: 'المحظورون', icon: Ban },
  { id: 'reports', label: 'التقارير', icon: TrendingUp },
  { id: 'chat', label: 'المحادثات', icon: MessageCircle },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
  { id: 'institution', label: 'المؤسسة', icon: Building2, superadminOnly: true },
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
