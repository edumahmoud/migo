// =====================================================
// Shared Authentication & Authorization Helpers
// =====================================================
// This module provides reusable auth utilities for all API routes.
// It consolidates the 3+ different auth patterns that were previously
// duplicated across routes into a single, consistent, and secure approach.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import type { UserRole } from '@/lib/types';

// ─── Types ───

export interface AuthResult {
  success: true;
  user: {
    id: string;
    email?: string;
    app_metadata?: Record<string, unknown>;
  };
}

export interface AuthError {
  success: false;
  error: string;
  status: number;
}

export type AuthResponse = AuthResult | AuthError;

// ─── Core Auth Functions ───

/**
 * Authenticate a request by verifying the user's identity.
 * Checks Bearer token first, then falls back to cookie-based auth.
 * 
 * This should be the SINGLE auth pattern used across all API routes.
 */
export async function authenticateRequest(request: NextRequest): Promise<AuthResponse> {
  let authUser: AuthResult['user'] | null = null;

  // Strategy 1: Bearer token in Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const { data: { user }, error } = await supabaseServer.auth.getUser(token);
      if (!error && user) {
        authUser = user;
      }
    } catch {
      // Token verification failed, try cookie auth
    }
  }

  // Strategy 2: Cookie-based auth (from middleware or direct session)
  if (!authUser) {
    try {
      const serverClient = await getSupabaseServerClient();
      const { data: { user }, error } = await serverClient.auth.getUser();
      if (!error && user) {
        authUser = user;
      }
    } catch {
      // Cookie auth failed
    }
  }

  // NOTE: Strategy 3 (x-user-id header trust) was REMOVED for security.
  // A client could set the x-user-id header to any user's ID and impersonate them.
  // There was no HMAC or signature to prove the header was set by trusted middleware.
  // If middleware-based auth is needed in the future, it must use signed tokens.

  if (!authUser) {
    return {
      success: false,
      error: 'يرجى تسجيل الدخول أولاً',
      status: 401,
    };
  }

  return {
    success: true,
    user: authUser,
  };
}

/**
 * Get the user's role from the database (source of truth).
 * Does NOT trust user_metadata or app_metadata from JWT claims alone,
 * as those can be stale or (for user_metadata) user-modifiable.
 */
export async function getUserRole(userId: string): Promise<UserRole | null> {
  try {
    const { data: profile, error } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    if (error) {
      console.error('[Auth] getUserRole DB error:', error.message);
    }
    return (profile?.role as UserRole) || null;
  } catch (err) {
    console.error('[Auth] getUserRole exception:', err);
    return null;
  }
}

/**
 * Authenticate + verify the user is an admin or superadmin.
 * Checks the database for the role first, then falls back to app_metadata
 * for the superadmin case (handles CHECK constraint issue).
 */
export async function requireAdmin(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authResult;

  const role = await getUserRole(authResult.user.id);
  if (role === 'admin' || role === 'superadmin') {
    return { ...authResult, role };
  }

  // Check app_metadata for superadmin fallback (handles CHECK constraint issue)
  const appRole = authResult.user.app_metadata?.role as UserRole | undefined;
  if (appRole === 'superadmin') {
    return { ...authResult, role: 'superadmin' };
  }

  return {
    success: false,
    error: 'غير مصرح بالوصول',
    status: 403,
  };
}

/**
 * Authenticate + verify the user is a superadmin only.
 * Checks the DB role first (primary source of truth).
 * If DB says not superadmin, also checks app_metadata.role as a fallback.
 * This handles the case where the DB CHECK constraint blocks 'superadmin'
 * but app_metadata has been set correctly via the admin API.
 */
export async function requireSuperAdmin(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authResult;

  const role = await getUserRole(authResult.user.id);

  if (role === 'superadmin') {
    return { ...authResult, role };
  }

  // DB role is not 'superadmin' — check app_metadata as fallback.
  // This handles the case where the CHECK constraint prevents storing 'superadmin'
  // in the DB but app_metadata was set correctly via supabaseServer.auth.admin.updateUserById().
  const appRole = authResult.user.app_metadata?.role as UserRole | undefined;
  if (appRole === 'superadmin') {
    console.warn(`[Auth] requireSuperAdmin: DB role='${role}' but app_metadata.role='superadmin' — allowing via app_metadata`);
    return { ...authResult, role: 'superadmin' };
  }

  return {
    success: false,
    error: 'هذا الإجراء يتطلب صلاحيات مدير المنصة فقط',
    status: 403,
  };
}

/**
 * Authenticate + verify the user is a teacher (or admin/superadmin).
 */
export async function requireTeacher(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authResult;

  const role = await getUserRole(authResult.user.id);
  console.log('[Auth] requireTeacher check:', { userId: authResult.user.id, role, hasRole: !!role });
  if (!role || (role !== 'teacher' && role !== 'admin' && role !== 'superadmin')) {
    return {
      success: false,
      error: 'هذا الإجراء متاح للمعلمين فقط',
      status: 403,
    };
  }

  return { ...authResult, role };
}

/**
 * Create a standardized auth error response.
 */
export function authErrorResponse(authResult: AuthError): NextResponse {
  return NextResponse.json(
    { success: false, error: authResult.error },
    { status: authResult.status }
  );
}

/**
 * Verify that the authenticated user matches the requested userId.
 * Prevents users from performing actions on behalf of other users.
 */
export function verifyOwnership(authUserId: string, requestedUserId: string): AuthError | null {
  if (authUserId !== requestedUserId) {
    return {
      success: false,
      error: 'غير مصرح بتعديل بيانات مستخدم آخر',
      status: 403,
    };
  }
  return null;
}
