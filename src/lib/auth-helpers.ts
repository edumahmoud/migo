// =====================================================
// Shared Authentication & Authorization Helpers
// =====================================================
// This module provides reusable auth utilities for all API routes.
// It consolidates the 3+ different auth patterns that were previously
// duplicated across routes into a single, consistent, and secure approach.
//
// Security Architecture (Defense in Depth):
//   Layer 1 (Edge):       middleware.ts — session + role validation at Edge
//   Layer 2 (API Routes): THIS FILE — authenticateRequest + requireRole
//   Layer 3 (Client):     RoleGuard component — client-side redirect
//
// IMPORTANT CHANGES (Security Hardening):
//   - REMOVED x-user-id header trust (Strategy 3) — headers can be spoofed
//   - Added requireRole() for per-endpoint role-based access control
//   - getUserRole() always queries the DATABASE as source of truth

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
 * 
 * Uses TWO strategies (in order of preference):
 * 1. Bearer token in Authorization header (from client-side fetch)
 * 2. Cookie-based auth (from browser cookies set by middleware/session)
 * 
 * SECURITY NOTE: The previous Strategy 3 (x-user-id header) has been REMOVED.
 * Custom headers like x-user-id can be set by anyone and are NOT a secure
 * way to identify users. Only Supabase-verified tokens/cookies are trusted.
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

  // ❌ REMOVED: Strategy 3 (x-user-id header trust)
  // Previously accepted an x-user-id header and looked up the user in DB.
  // This was insecure because:
  //   - Any client can set custom headers
  //   - Even verifying the user exists in DB doesn't prove the REQUESTER is that user
  //   - This bypassed proper authentication entirely
  // If you need middleware-verified user info, use cookies (Strategy 2) which
  // are set by Supabase after proper token verification.

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
 * 
 * ALWAYS queries the database for the authoritative role.
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
 * Authenticate + verify the user has a specific role.
 * This is the primary function for role-based API endpoint protection.
 * 
 * Usage:
 *   const authResult = await requireRole(request, ['admin', 'superadmin']);
 *   if (!authResult.success) return authErrorResponse(authResult);
 *   // authResult.user.id is guaranteed to have one of the specified roles
 * 
 * Always checks the DATABASE for the role — never trusts JWT claims alone.
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: UserRole[]
): Promise<AuthResponse & { role?: UserRole }> {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authResult;

  const role = await getUserRole(authResult.user.id);
  if (!role || !allowedRoles.includes(role)) {
    return {
      success: false,
      error: 'غير مصرح بالوصول',
      status: 403,
    };
  }

  return { ...authResult, role };
}

/**
 * Authenticate + verify the user is an admin or superadmin.
 * Always checks the database for the role — never trusts JWT claims alone.
 */
export async function requireAdmin(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  return requireRole(request, ['admin', 'superadmin']);
}

/**
 * Authenticate + verify the user is a superadmin only.
 */
export async function requireSuperAdmin(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  return requireRole(request, ['superadmin']);
}

/**
 * Authenticate + verify the user is a teacher (or admin/superadmin).
 */
export async function requireTeacher(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  return requireRole(request, ['teacher', 'admin', 'superadmin']);
}

/**
 * Authenticate + verify the user is a student (or any higher role).
 * Useful for endpoints that students access directly.
 */
export async function requireStudent(request: NextRequest): Promise<AuthResponse & { role?: UserRole }> {
  return requireRole(request, ['student', 'teacher', 'admin', 'superadmin']);
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
