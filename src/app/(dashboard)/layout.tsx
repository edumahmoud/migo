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
import { cleanupAfterNavigation } from '@/lib/navigation-cleanup';
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
// CLICK FIX (v10): All Radix modal components (Dialog, Sheet,
// AlertDialog, DropdownMenu, ContextMenu) now use modal={false}.
// This prevents Radix's DismissableLayer from setting
// body.style.pointerEvents = "none" and from adding aria-hidden
// to the React root. A periodic safety net cleans up any remaining
// stuck styles.

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

  // Navigation cleanup on pathname change
  useEffect(() => {
    cleanupAfterNavigation();
  }, [pathname]);

  // SAFETY NET: Periodic cleanup of stuck body.style.pointerEvents
  // and stale aria-hidden on the React root.
  // Even with modal={false}, this catches edge cases where:
  //   - A component was rendered with modal={true} explicitly
  //   - The Select component (which is always modal) was used
  //   - A third-party library sets these styles
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const cleanup = () => {
      // Fix stuck body.pointerEvents
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = '';
      }
      // Fix stuck aria-hidden on React root
      const root = document.getElementById('__next') || document.getElementById('root');
      if (root?.getAttribute('aria-hidden') === 'true') {
        root.removeAttribute('aria-hidden');
      }
      if (root?.getAttribute('data-aria-hidden') === 'true') {
        root.removeAttribute('data-aria-hidden');
      }
    };

    // Run immediately
    cleanup();

    // Run every 500ms as safety net
    const interval = setInterval(cleanup, 500);

    return () => clearInterval(interval);
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
