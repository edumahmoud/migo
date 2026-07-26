// ============================================================
// Google Auth Check API Route
// ============================================================
// GET /api/google/auth/check
//
// Checks the user's Google Forms API authorization status.
// Returns whether the user is authorized, needs incremental auth,
// and the auth URL if needed.
//
// Response:
// { success: true, data: GoogleAuthStatus }
// OR
// { success: false, error: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { checkAuthStatus, isGoogleOAuthConfigured } from '@/lib/google/oauth';

export async function GET(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const userId = authResult.user.id;

  try {
    // Check if Google OAuth is configured at all
    if (!isGoogleOAuthConfigured()) {
      return NextResponse.json({
        success: true,
        data: {
          isAuthorized: false,
          hasFormsScope: false,
          needsIncrementalAuth: false,
          configured: false,
        },
      });
    }

    const authStatus = await checkAuthStatus(userId);

    return NextResponse.json({
      success: true,
      data: {
        ...authStatus,
        configured: true,
      },
    });

  } catch (error) {
    console.error('[Google Auth Check] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
