'use client';

import { useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User } from 'lucide-react';
import { useLocaleStore } from '@/i18n/locale-store';

// Academic titles for teachers - bilingual
const ACADEMIC_TITLES_AR = [
  { value: 'teacher', label: 'معلم', femaleLabel: 'معلمة' },
  { value: 'dr', label: 'دكتور', femaleLabel: 'دكتورة' },
  { value: 'prof', label: 'أستاذ', femaleLabel: 'أستاذة' },
  { value: 'assoc_prof', label: 'أستاذ مشارك', femaleLabel: 'أستاذة مشاركة' },
  { value: 'assist_prof', label: 'أستاذ مساعد', femaleLabel: 'أستاذة مساعدة' },
  { value: 'lecturer', label: 'محاضر', femaleLabel: 'محاضرة' },
  { value: 'teaching_assist', label: 'معيد', femaleLabel: 'معيدة' },
] as const;

const ACADEMIC_TITLES_EN = [
  { value: 'teacher', label: 'Teacher', femaleLabel: 'Teacher' },
  { value: 'dr', label: 'Dr.', femaleLabel: 'Dr.' },
  { value: 'prof', label: 'Prof.', femaleLabel: 'Prof.' },
  { value: 'assoc_prof', label: 'Assoc. Prof.', femaleLabel: 'Assoc. Prof.' },
  { value: 'assist_prof', label: 'Asst. Prof.', femaleLabel: 'Asst. Prof.' },
  { value: 'lecturer', label: 'Lecturer', femaleLabel: 'Lecturer' },
  { value: 'teaching_assist', label: 'Teaching Asst.', femaleLabel: 'Teaching Asst.' },
] as const;

export function getAcademicTitles() {
  const locale = useLocaleStore.getState().locale;
  return locale === 'ar' ? ACADEMIC_TITLES_AR : ACADEMIC_TITLES_EN;
}

// Keep the old export for backward compatibility, defaults to Arabic
export const ACADEMIC_TITLES = ACADEMIC_TITLES_AR;

export function getTitleLabel(titleId?: string | null, gender?: string | null): string | null {
  if (!titleId) return null;
  const locale = useLocaleStore.getState().locale;
  const titles = locale === 'ar' ? ACADEMIC_TITLES_AR : ACADEMIC_TITLES_EN;
  const title = titles.find(t => t.value === titleId);
  if (!title) return null;
  return gender === 'female' ? t(title.femaleLabel) : t(title.label);
}

export function getRoleLabel(role: string, gender?: string | null, titleId?: string | null): string {
  const locale = useLocaleStore.getState().locale;
  const isAr = locale === 'ar';
  const isFemale = gender === 'female';
  if (role === 'student') return isAr ? (isFemale ? 'طالبة' : 'طالب') : 'Student';
  if (role === 'superadmin') return isAr ? (isFemale ? 'مديرة المنصة' : 'مدير المنصة') : 'Platform Admin';
  if (role === 'admin') return isAr ? (isFemale ? 'مشرفة' : 'مشرف') : 'Supervisor';
  // For teachers, show academic title if available
  const title = getTitleLabel(titleId, gender);
  if (title) return title;
  return isAr ? (isFemale ? 'معلمة' : 'معلم') : 'Teacher';
}

/**
 * Format a user's name with their academic title prefix.
 * E.g. "دكتور أحمد", "أستاذة سارة", "محمد" (no title for students)
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
      <AvatarFallback className="bg-gradient-to-br from-sky-100 to-teal-100 dark:from-sky-900/50 dark:to-teal-900/50 text-sky-800 dark:text-sky-200 font-bold select-none">
        {initials || <User className={iconSizeMap[size]} />}
      </AvatarFallback>
    </Avatar>
  );
}
