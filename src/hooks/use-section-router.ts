'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  STUDENT_SECTION_PATHS,
  TEACHER_SECTION_PATHS,
  ADMIN_SECTION_PATHS,
  getStudentSectionFromSlug,
  getTeacherSectionFromSlug,
  getAdminSectionFromSlug,
  getDefaultPath,
} from '@/lib/navigation-config';
import type { StudentSection, TeacherSection, AdminSection, UserRole } from '@/lib/types';

type AnySection = StudentSection | TeacherSection | AdminSection;

export function useSectionRouter(role: UserRole, slug?: string[]) {
  const router = useRouter();
  const pathname = usePathname();

  // Determine active section from URL
  const activeSection = useMemo(() => {
    if (role === 'student') return getStudentSectionFromSlug(slug || []);
    if (role === 'teacher') return getTeacherSectionFromSlug(slug || []);
    return getAdminSectionFromSlug(slug || []);
  }, [role, slug]);

  // Get the path for a section
  const getSectionPath = useCallback((section: string): string => {
    if (role === 'student') return STUDENT_SECTION_PATHS[section as StudentSection] || '/student';
    if (role === 'teacher') return TEACHER_SECTION_PATHS[section as TeacherSection] || '/teacher';
    return ADMIN_SECTION_PATHS[section as AdminSection] || '/admin';
  }, [role]);

  // Navigate to a section using router.push (adds to history stack)
  const navigateToSection = useCallback((section: string) => {
    const path = getSectionPath(section);
    router.push(path);
  }, [router, getSectionPath]);

  // Navigate to a subject detail page
  const navigateToSubject = useCallback((subjectId: string) => {
    const basePath = role === 'student' ? '/student' : role === 'teacher' ? '/teacher' : '/admin';
    router.push(`${basePath}/subjects/${subjectId}`);
  }, [router, role]);

  // Navigate to quiz view
  const navigateToQuiz = useCallback((quizId: string) => {
    router.push(`/quiz/${quizId}`);
  }, [router]);

  // Navigate to summary view
  const navigateToSummary = useCallback((summaryId: string) => {
    router.push(`/summary/${summaryId}`);
  }, [router]);

  // Navigate to profile view
  const navigateToProfile = useCallback((userId: string) => {
    router.push(`/profile/${userId}`);
  }, [router]);

  // Go back
  const goBack = useCallback(() => {
    router.back();
  }, [router]);

  // Navigate to settings
  const navigateToSettings = useCallback(() => {
    navigateToSection('settings');
  }, [navigateToSection]);

  // Navigate to default dashboard for role
  const navigateToDashboard = useCallback(() => {
    router.push(getDefaultPath(role));
  }, [router, role]);

  return {
    activeSection,
    navigateToSection,
    navigateToSubject,
    navigateToQuiz,
    navigateToSummary,
    navigateToProfile,
    navigateToSettings,
    navigateToDashboard,
    goBack,
    getSectionPath,
  };
}
