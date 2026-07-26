// ============================================================
// Google Forms List API Route
// ============================================================
// GET /api/google/forms/list
//
// Lists the user's Google Forms for the "Append to Existing" feature.
// Returns a list of forms the user owns or can edit.
//
// Query params:
//   pageToken?: string — for pagination
//
// Response:
// { success: true, forms: GoogleFormListItem[], nextPageToken?: string }
// OR
// { success: false, error: string, authRequired?: boolean, authUrl?: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { listUserGoogleForms } from '@/lib/google/forms';
import { checkAuthStatus, isGoogleOAuthConfigured } from '@/lib/google/oauth';
import type { ListGoogleFormsResponse } from '@/types/googleForms';

export async function GET(request: NextRequest) {
  // ── Authenticate and verify teacher role ──
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const userId = authResult.user.id;

  try {
    // ── Check if Google OAuth is configured ──
    if (!isGoogleOAuthConfigured()) {
      return NextResponse.json<ListGoogleFormsResponse>({
        success: false,
        error: 'Google Forms integration is not configured.',
      }, { status: 500 });
    }

    // ── Check authorization status ──
    const authStatus = await checkAuthStatus(userId);

    if (!authStatus.isAuthorized || authStatus.needsIncrementalAuth) {
      return NextResponse.json<ListGoogleFormsResponse>({
        success: false,
        error: 'Google Forms API authorization required.',
        authRequired: true,
        authUrl: authStatus.authUrl,
      }, { status: 401 });
    }

    // ── Get page token from query params ──
    const { searchParams } = new URL(request.url);
    const pageToken = searchParams.get('pageToken') || undefined;

    // ── List user's Google Forms ──
    const result = await listUserGoogleForms(userId, pageToken);

    return NextResponse.json<ListGoogleFormsResponse>({
      success: true,
      forms: result.forms,
      nextPageToken: result.nextPageToken,
    });

  } catch (error) {
    console.error('[Google Forms List] Error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';

    if (message.includes('GOOGLE_AUTH_REQUIRED')) {
      const authStatus = await checkAuthStatus(userId);
      return NextResponse.json<ListGoogleFormsResponse>({
        success: false,
        error: 'Google Forms API authorization required',
        authRequired: true,
        authUrl: authStatus.authUrl,
      }, { status: 401 });
    }

    return NextResponse.json<ListGoogleFormsResponse>({
      success: false,
      error: message,
    }, { status: 500 });
  }
}
