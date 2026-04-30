'use client';

import UserAvatar, { getRoleLabel, getTitleLabel } from '@/components/shared/user-avatar';
import { useAppStore } from '@/stores/app-store';

interface UserLinkProps {
  userId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  role?: string;
  gender?: string | null;
  titleId?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showAvatar?: boolean;
  showRole?: boolean;
  showUsername?: boolean;
  className?: string;
}

function getRoleBadgeColor(role: string): string {
  switch (role) {
    case 'superadmin':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'admin':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
    case 'teacher':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'student':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
}

export default function UserLink({
  userId,
  name,
  username,
  avatarUrl,
  role,
  gender,
  titleId,
  size = 'sm',
  showAvatar = true,
  showRole = true,
  showUsername = false,
  className = '',
}: UserLinkProps) {
  const { openProfile } = useAppStore();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openProfile(userId);
  };

  const roleLabel = role ? getRoleLabel(role, gender, titleId) : null;
  const titleLabel = role === 'teacher' ? getTitleLabel(titleId, gender) : null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 hover:bg-muted/50 rounded-md px-1 py-0.5 -mx-1 -my-0.5 transition-colors cursor-pointer group ${className}`}
      title={`عرض ملف ${name}`}
    >
      {showAvatar && (
        <UserAvatar name={name} avatarUrl={avatarUrl} size={size} />
      )}
      <span className="flex flex-col items-start min-w-0">
        <span className="flex items-center gap-1 truncate max-w-[200px]">
          <span className="text-sm font-medium text-foreground group-hover:text-emerald-600 transition-colors truncate">
            {titleLabel && <span className="text-emerald-600 ml-0.5 text-xs font-normal">{titleLabel}</span>}
            {name}
          </span>
          {showRole && roleLabel && role && (
            <span className={`shrink-0 inline-flex items-center rounded-md px-1.5 py-0 text-[9px] font-bold leading-4 ${getRoleBadgeColor(role)}`}>
              {roleLabel}
            </span>
          )}
        </span>
        {showUsername && username && (
          <span className="text-[10px] text-muted-foreground font-normal truncate max-w-[150px]" dir="ltr">
            @{username}
          </span>
        )}
      </span>
    </button>
  );
}
