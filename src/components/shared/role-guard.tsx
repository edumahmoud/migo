'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { getDefaultPath } from '@/lib/navigation-config';
import { ShieldAlert, Loader2 } from 'lucide-react';
import type { UserRole } from '@/lib/types';

// =====================================================
// RoleGuard — Client-Side Route Protection (Layer 3)
// =====================================================
//
// Defense in Depth:
//   Layer 1 (Edge):       middleware.ts — session + role validation at Edge
//   Layer 2 (API Routes): auth-helpers.ts — authenticateRequest + requireRole
//   Layer 3 (Client):     THIS COMPONENT — client-side redirect on mismatch
//
// IMPORTANT: Frontend protection is NOT sufficient alone.
// It can be bypassed by disabling JavaScript or using browser DevTools.
// That's why we have middleware.ts as the primary enforcement layer.

interface RoleGuardProps {
  /** The roles that are allowed to access this route */
  allowedRoles: UserRole[];
  /** The child components to render if authorized */
  children: React.ReactNode;
}

export default function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirected = useRef(false);

  // ─── Derive guard state from auth state (no setState in effects) ───
  const guardState = useMemo(() => {
    if (!initialized || loading) return 'loading' as const;
    if (!user) return 'loading' as const; // Will be redirected by layout

    const userRole = user.role as UserRole;
    const isAuthorized = allowedRoles.includes(userRole);
    return isAuthorized ? ('authorized' as const) : ('unauthorized' as const);
  }, [user, initialized, loading, allowedRoles]);

  // ─── Handle unauthorized redirect in effect (side effect, no setState) ───
  useEffect(() => {
    if (guardState === 'unauthorized' && !hasRedirected.current) {
      hasRedirected.current = true;
      const userRole = user?.role as UserRole;
      const correctPath = getDefaultPath(userRole as 'student' | 'teacher' | 'admin' | 'superadmin');
      console.warn(
        `[RoleGuard] Unauthorized access attempt: user role='${userRole}', path='${pathname}'. ` +
        `Redirecting to '${correctPath}'`
      );
      router.replace(correctPath);
    }
  }, [guardState, user, pathname, router]);

  // Reset redirect flag when guard state changes
  useEffect(() => {
    if (guardState !== 'unauthorized') {
      hasRedirected.current = false;
    }
  }, [guardState]);

  // ─── Render States ───

  if (guardState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 pointer-events-none" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">جاري التحقق...</span>
          </div>
        </div>
      </div>
    );
  }

  if (guardState === 'unauthorized') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-white to-orange-50 pointer-events-none" dir="rtl">
        <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/30">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-red-700">غير مصرح بالوصول</h2>
          <p className="text-sm text-red-600">
            ليس لديك صلاحية للوصول إلى هذه الصفحة. يتم تحويلك إلى لوحة التحكم الخاصة بك.
          </p>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-red-600" />
            <span className="text-sm font-medium text-red-700">جاري التحويل...</span>
          </div>
        </div>
      </div>
    );
  }

  // Authorized — render children
  return <>{children}</>;
}
