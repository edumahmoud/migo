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

  // Strategy 3: Check x-user-id header set by middleware
  if (!authUser) {
    const userIdHeader = request.headers.get('x-user-id');
    if (userIdHeader) {
      // Middleware already verified this user - trust the header
      // But still verify the user exists in DB
      try {
        const { data: profile } = await supabaseServer
          .from('users')
          .select('id, email')
          .eq('id', userIdHeader)
          .single();
        if (profile) {
          authUser = { id: profile.id, email: profile.email };
        }
      } catch {
        // User lookup failed
      }
    }
  }

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
    const { data: profile } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    return (profile?.role as UserRole) || null;
  } catch {
    return null;
  }
}

/**
 * Authenticate + verify the user is an admin or superadmin.
 * Always checks the database for the role — never trusts JWT claims alone.
 */
export async function requireAdmin(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authResult;

  const role = await getUserRole(authResult.user.id);
  if (!role || (role !== 'admin' && role !== 'superadmin')) {
    return {
      success: false,
      error: 'غير مصرح بالوصول',
      status: 403,
    };
  }

  return { ...authResult, role };
}

/**
 * Authenticate + verify the user is a superadmin only.
 */
export async function requireSuperAdmin(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authResult;

  const role = await getUserRole(authResult.user.id);
  if (role !== 'superadmin') {
    return {
      success: false,
      error: 'هذا الإجراء يتطلب صلاحيات مدير المنصة فقط',
      status: 403,
    };
  }

  return { ...authResult, role };
}

/**
 * Authenticate + verify the user is a teacher (or admin/superadmin).
 */
export async function requireTeacher(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authResult;

  const role = await getUserRole(authResult.user.id);
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
