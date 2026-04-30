'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { GraduationCap, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useStatusStore } from '@/stores/status-store';
import { setSocketAuth, destroySocket } from '@/lib/socket';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getDefaultPath } from '@/lib/navigation-config';
import SupabaseConfigError from '@/components/shared/supabase-config-error';
import BannedUserOverlay from '@/components/shared/banned-user-overlay';
import RoleGuard from '@/components/shared/role-guard';
import { cleanupAfterNavigation, initNavigationGuard, destroyNavigationGuard } from '@/lib/navigation-cleanup';
import type { UserRole } from '@/lib/types';

// =====================================================
// Dashboard Layout — Protected Route Wrapper
// =====================================================
//
// Defense in Depth:
//   Layer 1 (Edge):       middleware.ts — blocks unauthorized at Edge
//   Layer 2 (API):        auth-helpers.ts — per-endpoint role checks
//   Layer 3 (Client):     RoleGuard component — client-side redirect
//   Layer 4 (This file):  Layout-level auth init + redirect
//
// REBUILD v2: Re-added targeted MutationObserver guard for inert cleanup.
// Even with conditional rendering, Radix Dialog components in sections like
// chat/settings/course can add inert during close animations. The observer
// removes inert when no dialog is genuinely open.

// Map URL prefix → allowed roles
const ROUTE_ROLE_MAP: Record<string, UserRole[]> = {
  '/admin': ['admin', 'superadmin'],
  '/teacher': ['teacher'],
  '/student': ['student'],
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const initialized = useAuthStore((s) => s.initialized);
  const initialize = useAuthStore((s) => s.initialize);
  const banInfo = useAuthStore((s) => s.banInfo);
  const cleanupStatusStore = useStatusStore((s) => s.cleanup);
  const initStatusStore = useStatusStore((s) => s.init);
  const router = useRouter();
  const pathname = usePathname();

  // Only initialize auth if not already done
  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  // Initialize socket and status store
  useEffect(() => {
    if (user) {
      setSocketAuth(user.id, user.name);
      initStatusStore(user.id);
    } else {
      destroySocket();
      cleanupStatusStore();
    }
  }, [user, initStatusStore, cleanupStatusStore]);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (initialized && !user && !loading) {
      router.replace('/');
    }
  }, [initialized, user, loading, router]);

  // Client-Side Role-to-Route Validation
  useEffect(() => {
    if (!initialized || !user || loading) return;

    const userRole = user.role as UserRole;

    for (const [routePrefix, allowedRoles] of Object.entries(ROUTE_ROLE_MAP)) {
      if (pathname.startsWith(routePrefix)) {
        if (!allowedRoles.includes(userRole)) {
          const correctPath = getDefaultPath(userRole as 'student' | 'teacher' | 'admin' | 'superadmin');
          router.replace(correctPath);
          return;
        }
        break;
      }
    }
  }, [initialized, user, loading, pathname, router]);

  // Navigation cleanup: remove inert/body locks on pathname change
  useEffect(() => {
    cleanupAfterNavigation();
  }, [pathname]);

  // MutationObserver guard: removes stale inert attributes when no dialog is open
  useEffect(() => {
    initNavigationGuard();
    return () => {
      destroyNavigationGuard();
    };
  }, []);

  if (!isSupabaseConfigured) {
    return <SupabaseConfigError />;
  }

  if (loading || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 pointer-events-none" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">جاري التحميل...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Determine allowed roles for current route
  let allowedRoles: UserRole[] = ['student', 'teacher', 'admin', 'superadmin'];
  for (const [routePrefix, roles] of Object.entries(ROUTE_ROLE_MAP)) {
    if (pathname.startsWith(routePrefix)) {
      allowedRoles = roles;
      break;
    }
  }

  const isBannedUser = banInfo && user.role !== 'admin' && user.role !== 'superadmin';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-emerald-50/30" dir="rtl">
      <RoleGuard allowedRoles={allowedRoles}>
        {isBannedUser ? <BannedUserOverlay>{children}</BannedUserOverlay> : children}
      </RoleGuard>
    </div>
  );
}
