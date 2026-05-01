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
// CLICK FIX (v12): Two concurrent bugs were causing "hover works but clicks don't":
//
// BUG 1: aria-modal="true" and role="dialog" on MobileDrawer were ALWAYS
//   present in the DOM even when the drawer was closed. On iOS Safari, this
//   suppresses click events on elements outside the dialog, even when off-screen.
//   Even removing these attributes dynamically didn't fix it because iOS Safari
//   caches the accessibility tree.
//   FIX: Removed role="dialog" and aria-modal from MobileDrawer ENTIRELY
//   (it's a nav sidebar, not a modal dialog). Also completely UNMOUNT the
//   MobileDrawer from the DOM when closed (not just hide with CSS).
//
// BUG 2: The safety net cleanup was looking for #__next or #root element
//   which DON'T EXIST in Next.js App Router (React renders directly into
//   <body>). So the safety net NEVER cleaned up stuck `inert` attributes!
//   When Dialog/Sheet used modal={true}, Radix set `inert` on body children,
//   and if cleanup didn't complete during navigation, `inert` stayed stuck.
//   FIX: Scan ALL body children for stuck attributes (not just specific IDs).
//   Also use modal={false} on Dialog/Sheet/AlertDialog/Select to prevent
//   `inert` from being set in the first place.

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

  // SAFETY NET: Periodic cleanup + MutationObserver for stuck attributes.
  // In Next.js App Router, there's NO #__next or #root wrapper div — React
  // renders directly into <body>. Previous safety nets looked for these IDs
  // and always returned null, so they NEVER cleaned up anything!
  //
  // With modal={false} on Dialog/Sheet/AlertDialog, Radix shouldn't set these
  // attributes. But this safety net catches any edge case where they get set
  // (e.g., the Select component which is always modal, or a component that
  // explicitly sets modal={true}).
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const isRadixPortal = (el: Element) =>
      el.hasAttribute('data-radix-portal') ||
      el.getAttribute('data-slot')?.includes('portal') ||
      false;

    const isSkippable = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      return tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta';
    };

    const cleanup = () => {
      // Fix stuck body.pointerEvents
      if (document.body.style.pointerEvents === 'none') {
        console.warn('[safety-net] Fixing stuck body.style.pointerEvents = "none"');
        document.body.style.pointerEvents = '';
      }

      // Fix stuck body.overflow (set by MobileDrawer when open)
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = '';
      }

      // Scan ALL children of document.body for stuck attributes
      const bodyChildren = document.body.children;
      for (let i = 0; i < bodyChildren.length; i++) {
        const el = bodyChildren[i] as HTMLElement;
        if (isRadixPortal(el) || isSkippable(el)) continue;

        if (el.hasAttribute('inert')) {
          console.warn('[safety-net] Removing stuck inert from', el.tagName, el.id || el.className?.substring(0, 50));
          el.removeAttribute('inert');
        }
        if (el.getAttribute('aria-hidden') === 'true') {
          console.warn('[safety-net] Removing stuck aria-hidden from', el.tagName, el.id || el.className?.substring(0, 50));
          el.removeAttribute('aria-hidden');
        }
        if (el.getAttribute('data-aria-hidden') === 'true') {
          el.removeAttribute('data-aria-hidden');
        }
      }
    };

    // Run immediately
    cleanup();

    // Run every 300ms as safety net (faster than before for quicker recovery)
    const interval = setInterval(cleanup, 300);

    // ALSO use MutationObserver for REAL-TIME detection of `inert` being added.
    // This catches the attribute the instant it's set, instead of waiting up to 300ms.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const el = mutation.target as HTMLElement;
          if (mutation.attributeName === 'inert' && el.hasAttribute('inert') && !isRadixPortal(el) && !isSkippable(el)) {
            console.warn('[safety-net-observer] Detected inert added to', el.tagName, el.id || el.className?.substring(0, 50));
            // Delay removal slightly to allow Radix's own cleanup a chance
            // (if a Dialog is intentionally being opened, we don't want to fight it)
            setTimeout(() => {
              // Only remove if there's no active open Radix content in the DOM
              const hasOpenDialog = document.querySelector('[data-state="open"][data-radix-dialog-content], [data-state="open"][data-slot="dialog-content"], [data-state="open"][data-slot="sheet-content"], [data-state="open"][data-slot="alert-dialog-content"]');
              if (!hasOpenDialog && el.hasAttribute('inert')) {
                console.warn('[safety-net-observer] Removing stuck inert (no open dialog found)');
                el.removeAttribute('inert');
              }
            }, 100);
          }
          if (mutation.attributeName === 'aria-hidden' && el.getAttribute('aria-hidden') === 'true' && !isRadixPortal(el) && !isSkippable(el)) {
            const hasOpenDialog = document.querySelector('[data-state="open"][data-radix-dialog-content], [data-state="open"][data-slot="dialog-content"], [data-state="open"][data-slot="sheet-content"], [data-state="open"][data-slot="alert-dialog-content"]');
            if (!hasOpenDialog) {
              console.warn('[safety-net-observer] Removing stuck aria-hidden (no open dialog found)');
              el.removeAttribute('aria-hidden');
            }
          }
        }
      }
    });

    // Observe ALL children of body for attribute changes
    observer.observe(document.body, {
      attributes: true,
      subtree: false, // Only direct children of body
      attributeFilter: ['inert', 'aria-hidden'],
    });

    return () => {
      clearInterval(interval);
      observer.disconnect();
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
