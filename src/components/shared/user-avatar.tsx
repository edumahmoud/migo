'use client';

import { useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User } from 'lucide-react';
import { useLocaleStore } from '@/i18n/locale-store';
import { useTranslations } from '@/i18n/use-translations';

// Academic titles for teachers - uses translation keys
const ACADEMIC_TITLE_KEYS = [
  { value: 'teacher', key: 'teacher' },
  { value: 'dr', key: 'doctor' },
  { value: 'instructor', key: 'instructor' },
  { value: 'prof', key: 'professor' },
  { value: 'assoc_prof', key: 'associateProfessor' },
  { value: 'assist_prof', key: 'assistantProfessor' },
  { value: 'lecturer', key: 'lecturer' },
  { value: 'teaching_assist', key: 'teachingAssistant' },
] as const;

export function getAcademicTitles(t: (key: string) => string) {
  return ACADEMIC_TITLE_KEYS.map(item => ({
    value: item.value,
    label: t(`academicTitles.${item.key}`),
    femaleLabel: t(`${item.key === 'teacher' ? 'roles.teacherWithGender.female' : item.value === 'dr' ? 'roles.doctorFemale' : item.value === 'instructor' ? 'titles.instructorFemale' : item.value === 'prof' ? 'roles.professorFemale' : item.value === 'assoc_prof' ? 'roles.associateProfessorFemale' : item.value === 'assist_prof' ? 'roles.assistantProfessorFemale' : item.key === 'lecturer' ? 'roles.lecturerFemale' : item.value === 'teaching_assist' ? 'roles.teachingAssistantFemale' : 'roles.teachingAssistantFemale'}`),
  }));
}

// Keep the old export for backward compatibility
export const ACADEMIC_TITLES = ACADEMIC_TITLE_KEYS;

export function getTitleLabel(titleId?: string | null, gender?: string | null, t?: (key: string) => string): string | null {
  if (!titleId) return null;
  if (!t) return null;
  const titleKey = ACADEMIC_TITLE_KEYS.find(item => item.value === titleId);
  if (!titleKey) return null;
  if (gender === 'female') {
    const femaleKey = titleKey.key === 'teacher' ? 'roles.teacherWithGender.female' 
      : titleKey.key === 'doctor' ? 'roles.doctorFemale' 
      : titleKey.key === 'instructor' ? 'titles.instructorFemale'
      : titleKey.key === 'professor' ? 'roles.professorFemale' 
      : titleKey.key === 'associateProfessor' ? 'roles.associateProfessorFemale' 
      : titleKey.key === 'assistantProfessor' ? 'roles.assistantProfessorFemale'
      : titleKey.key === 'lecturer' ? 'academicTitles.lecturer'
      : 'academicTitles.teachingAssistant';
    return t(femaleKey);
  }
  return t(`academicTitles.${titleKey.key}`);
}

export function getRoleLabel(role: string, gender?: string | null, titleId?: string | null, t?: (key: string) => string): string {
  if (!t) return role;
  const isFemale = gender === 'female';
  if (role === 'student') return isFemale ? t('roles.studentWithGender.female') : t('roles.student');
  if (role === 'superadmin') return t('roles.superadmin');
  if (role === 'admin') return t('roles.supervisor');
  // For teachers, show academic title if available
  const title = getTitleLabel(titleId, gender, t);
  if (title) return title;
  return isFemale ? t('roles.teacherWithGender.female') : t('roles.teacher');
}

/**
 * Format a user's name with their academic title prefix.
 * E.g. "Dr. Ahmed", "Prof. Sarah", "Mohamed" (no title for students)
 */
export function formatNameWithTitle(name: string, role: string | null | undefined, titleId: string | null | undefined, gender: string | null | undefined, t: (key: string) => string): string {
  if (!name) return name;
  // Only teachers have academic titles
  if (role !== 'teacher') return name;
  const title = getTitleLabel(titleId, gender, t);
  if (!title) return name;
  return `${title} ${name}`;
}

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const sizeMap = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
  '2xl': 'h-28 w-28 text-3xl',
};

const iconSizeMap = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
  xl: 'h-8 w-8',
  '2xl': 'h-10 w-10',
};

/**
 * Check if a URL looks like an institution logo URL (not a user avatar).
 * This guards against corrupted avatar_url data in the database where
 * an institution logo URL was accidentally saved as the user's avatar_url.
 */
function isInstitutionLogoUrl(url: string): boolean {
  return url.includes('/institution/logos/') || url.includes('/institution%2Flogos%2F');
}

export default function UserAvatar({ name, avatarUrl, size = 'md', className = '' }: UserAvatarProps) {
  const initials = name
    ? name
        .split(' ')
        .map(w => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '';

  // Add cache-busting to avatar URL — stable per URL change
  // Uses a simple hash of the URL so it only changes when the URL itself changes
  // Also filters out institution logo URLs that may have been corrupted into avatar_url
  const cacheBustedUrl = useMemo(() => {
    if (!avatarUrl) return undefined;
    // Guard: if this URL is actually an institution logo, don't show it as user avatar
    if (isInstitutionLogoUrl(avatarUrl)) return undefined;
    // If URL already has a timestamp-based filename from Supabase Storage (avatar_1234567.jpg),
    // it's already unique — just add a lightweight hash for extra safety
    const hash = avatarUrl.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
    const sep = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${sep}cb=${Math.abs(hash)}`;
  }, [avatarUrl]);

  return (
    <Avatar className={`${sizeMap[size]} border-2 border-sky-200 shrink-0 ${className}`}>
      {cacheBustedUrl && <AvatarImage src={cacheBustedUrl} alt={name} />}
      <AvatarFallback className="bg-gradient-to-br from-sky-100 to-teal-100 dark:from-sky-900/50 dark:to-teal-900/50 text-sky-800 dark:text-sky-400 font-bold select-none">
        {initials || <User className={iconSizeMap[size]} />}
      </AvatarFallback>
    </Avatar>
  );
}
