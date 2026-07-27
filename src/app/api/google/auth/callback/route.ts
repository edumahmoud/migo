// ============================================================
// Google Auth Callback API Route
// ============================================================
// GET /api/google/auth/callback
//
// Handles the OAuth callback after incremental authorization.
// Google redirects here after the user grants Forms API scope.
//
// Query params (from Google OAuth):
//   code: string — Authorization code to exchange for tokens
//   state: string — User ID (passed in the auth URL)
//   error?: string — Error if authorization failed
//
// After successful token exchange:
// 1. Stores tokens in google_oauth_tokens table
// 2. Redirects to the question bank page with success message
//
// If authorization fails:
// Redirects to question bank page with error message
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleAuthCallback, isGoogleOAuthConfigured } from '@/lib/google/oauth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // ── Check for OAuth error (user denied access) ──
    const oauthError = searchParams.get('error');
    if (oauthError) {
      console.error('[Google Auth Callback] OAuth error:', oauthError);
      // Redirect back to the app with error message
      return NextResponse.redirect(
        new URL(`/?google_auth_error=${encodeURIComponent(oauthError)}`, request.url)
      );
    }

    // ── Get authorization code and state (user ID) ──
    const authCode = searchParams.get('code');
    const userId = searchParams.get('state');

    if (!authCode || !userId) {
      console.error('[Google Auth Callback] Missing code or state parameter');
      return NextResponse.redirect(
        new URL('/?google_auth_error=missing_params', request.url)
      );
    }

    // ── Check if Google OAuth is configured ──
    if (!isGoogleOAuthConfigured()) {
      console.error('[Google Auth Callback] Google OAuth not configured');
      return NextResponse.redirect(
        new URL('/?google_auth_error=not_configured', request.url)
      );
    }

    // ── Exchange authorization code for tokens ──
    const tokenRecord = await handleAuthCallback(authCode, userId);

    console.info('[Google Auth Callback] Tokens stored successfully for user:', userId);

    // ── Redirect back to the app with success ──
    return NextResponse.redirect(
      new URL('/?google_auth_success=true', request.url)
    );

  } catch (error) {
    console.error('[Google Auth Callback] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/?google_auth_error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
