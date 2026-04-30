import type { StudentSection, TeacherSection, AdminSection } from '@/lib/types';

// Section-to-URL mapping for each role
export const STUDENT_SECTION_PATHS: Record<StudentSection, string> = {
  dashboard: '/student',
  subjects: '/student/subjects',
  summaries: '/student/summaries',
  assignments: '/student/assignments',
  files: '/student/files',
  teachers: '/student/teachers',
  chat: '/student/chat',
  settings: '/student/settings',
  notifications: '/student/notifications',
  quizzes: '/student/quizzes',
  attendance: '/student/attendance',
};

export const TEACHER_SECTION_PATHS: Record<TeacherSection, string> = {
  dashboard: '/teacher',
  subjects: '/teacher/subjects',
  students: '/teacher/students',
  files: '/teacher/files',
  assignments: '/teacher/assignments',
  attendance: '/teacher/attendance',
  analytics: '/teacher/analytics',
  chat: '/teacher/chat',
  settings: '/teacher/settings',
  notifications: '/teacher/notifications',
};

export const ADMIN_SECTION_PATHS: Record<AdminSection, string> = {
  dashboard: '/admin',
  users: '/admin/users',
  subjects: '/admin/subjects',
  reports: '/admin/reports',
  announcements: '/admin/announcements',
  banned: '/admin/banned',
  institution: '/admin/institution',
  chat: '/admin/chat',
  settings: '/admin/settings',
};

// Reverse mapping: URL path segment → section name
export const STUDENT_PATH_SECTIONS: Record<string, StudentSection> = Object.fromEntries(
  Object.entries(STUDENT_SECTION_PATHS).map(([section, path]) => {
    const segment = path === '/student' ? '' : path.replace('/student/', '');
    return [segment, section as StudentSection];
  })
);

export const TEACHER_PATH_SECTIONS: Record<string, TeacherSection> = Object.fromEntries(
  Object.entries(TEACHER_SECTION_PATHS).map(([section, path]) => {
    const segment = path === '/teacher' ? '' : path.replace('/teacher/', '');
    return [segment, section as TeacherSection];
  })
);

export const ADMIN_PATH_SECTIONS: Record<string, AdminSection> = Object.fromEntries(
  Object.entries(ADMIN_SECTION_PATHS).map(([section, path]) => {
    const segment = path === '/admin' ? '' : path.replace('/admin/', '');
    return [segment, section as AdminSection];
  })
);

// Helper: get section from URL path segments
export function getStudentSectionFromSlug(slug: string[]): StudentSection {
  if (!slug || slug.length === 0) return 'dashboard';
  const segment = slug[0];
  // Check if it's a subject detail page: /student/subjects/[id]
  if (segment === 'subjects' && slug.length > 1) return 'subjects';
  return STUDENT_PATH_SECTIONS[segment] || 'dashboard';
}

export function getTeacherSectionFromSlug(slug: string[]): TeacherSection {
  if (!slug || slug.length === 0) return 'dashboard';
  const segment = slug[0];
  if (segment === 'subjects' && slug.length > 1) return 'subjects';
  return TEACHER_PATH_SECTIONS[segment] || 'dashboard';
}

export function getAdminSectionFromSlug(slug: string[]): AdminSection {
  if (!slug || slug.length === 0) return 'dashboard';
  const segment = slug[0];
  return ADMIN_PATH_SECTIONS[segment] || 'dashboard';
}

// -------------------------------------------------------
// Pathname-based section derivation (most reliable)
// Uses usePathname() which always updates on client navigation
// -------------------------------------------------------
export function getStudentSectionFromPathname(pathname: string): StudentSection {
  const segment = pathname.replace('/student/', '').replace('/student', '');
  if (!segment) return 'dashboard';
  const firstSegment = segment.split('/')[0];
  return STUDENT_PATH_SECTIONS[firstSegment] || 'dashboard';
}

export function getTeacherSectionFromPathname(pathname: string): TeacherSection {
  const segment = pathname.replace('/teacher/', '').replace('/teacher', '');
  if (!segment) return 'dashboard';
  const firstSegment = segment.split('/')[0];
  return TEACHER_PATH_SECTIONS[firstSegment] || 'dashboard';
}

export function getAdminSectionFromPathname(pathname: string): AdminSection {
  const segment = pathname.replace('/admin/', '').replace('/admin', '');
  if (!segment) return 'dashboard';
  const firstSegment = segment.split('/')[0];
  return ADMIN_PATH_SECTIONS[firstSegment] || 'dashboard';
}

// Helper: get the default dashboard path for a role
export function getDefaultPath(role: 'student' | 'teacher' | 'admin' | 'superadmin'): string {
  if (role === 'student') return '/student';
  if (role === 'teacher') return '/teacher';
  return '/admin'; // admin and superadmin
}

// Section labels (Arabic) - used by header
export const SECTION_LABELS: Record<string, string> = {
  dashboard: 'لوحة التحكم',
  subjects: 'المقررات',
  summaries: 'الملخصات',
  assignments: 'المهام',
  files: 'ملفاتي',
  teachers: 'المعلمون',
  students: 'الطلاب',
  analytics: 'التقارير',
  settings: 'الإعدادات',
  users: 'المستخدمون',
  reports: 'التقارير',
  announcements: 'الإعلانات',
  banned: 'المحظورون',
  institution: 'المؤسسة',
  chat: 'المحادثات',
  notifications: 'الإشعارات',
  quizzes: 'الاختبارات',
  attendance: 'الحضور',
};
