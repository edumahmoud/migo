// ============================================================
// Google OAuth Module — Incremental Authorization
// ============================================================
//
// This module handles Google OAuth for the Forms API scope.
// It uses INCREMENTAL AUTHORIZATION — the user never has to
// log in again. If the initial Google sign-in (via Supabase Auth)
// didn't include the Forms API scope, we request it separately.
//
// Architecture:
// 1. Check if stored tokens exist with Forms scope → user is authorized
// 2. If not → generate incremental auth URL → redirect user
// 3. Auth callback captures tokens → store in google_oauth_tokens table
// 4. Use stored tokens for API calls → refresh when expired
//
// NEVER expose tokens to the client. All operations are server-side.
// ============================================================

import { google } from 'googleapis';
import { supabaseServer } from '@/lib/supabase-server';
import { GOOGLE_FORMS_SCOPES } from '@/types/googleForms';
import type { GoogleOAuthTokenRecord, GoogleAuthStatus } from '@/types/googleForms';

// ─── Environment Configuration ───

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

/**
 * Validates that required Google OAuth environment variables are set.
 * Returns true if all are present, false otherwise.
 */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

/**
 * Returns which env vars are missing for debugging.
 */
export function getMissingGoogleOAuthVars(): string[] {
  const missing: string[] = [];
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
  return missing;
}

// ─── OAuth2 Client Factory ───

/**
 * Creates a configured Google OAuth2 client.
 * This is used for both generating auth URLs and making API calls.
 */
export function createOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  if (!isGoogleOAuthConfigured()) {
    throw new Error(
      'Google OAuth is not configured. Missing: ' + getMissingGoogleOAuthVars().join(', ')
    );
  }

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

// ─── Token Management ───

/**
 * Retrieves stored Google OAuth tokens for a user from the database.
 * Returns null if no tokens exist or they're invalid.
 */
export async function getStoredTokens(userId: string): Promise<GoogleOAuthTokenRecord | null> {
  const { data, error } = await supabaseServer
    .from('google_oauth_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    // No tokens stored — user hasn't authorized Forms API yet
    return null;
  }

  return data as GoogleOAuthTokenRecord;
}

/**
 * Stores or updates Google OAuth tokens for a user.
 * Uses upsert (insert or update) since each user has one token record.
 */
export async function storeTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiryDate: number, // Unix timestamp in ms
  scope: string
): Promise<GoogleOAuthTokenRecord> {
  const expiryIso = new Date(expiryDate).toISOString();

  const { data, error } = await supabaseServer
    .from('google_oauth_tokens')
    .upsert(
      {
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expiry: expiryIso,
        scope,
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to store Google OAuth tokens: ${error?.message || 'Unknown error'}`);
  }

  return data as GoogleOAuthTokenRecord;
}

/**
 * Refreshes an expired Google access token using the stored refresh token.
 * Updates the stored tokens after refresh.
 * Returns the refreshed token record.
 *
 * Implements retry with exponential backoff for transient failures.
 */
export async function refreshExpiredTokens(
  userId: string,
  tokenRecord: GoogleOAuthTokenRecord
): Promise<GoogleOAuthTokenRecord> {
  const oauth2Client = createOAuth2Client();

  // Set credentials from stored tokens
  oauth2Client.setCredentials({
    access_token: tokenRecord.access_token,
    refresh_token: tokenRecord.refresh_token,
    expiry_date: new Date(tokenRecord.token_expiry).getTime(),
  });

  // Attempt refresh with exponential backoff
  const maxRetries = 3;
  let retryDelay = 1000; // Start with 1s

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('Refresh succeeded but no access_token returned');
      }

      // Store the refreshed tokens
      const refreshedRecord = await storeTokens(
        userId,
        credentials.access_token,
        credentials.refresh_token || tokenRecord.refresh_token, // Keep old refresh_token if not returned
        credentials.expiry_date || Date.now() + 3600000, // Default 1hr expiry
        credentials.scope || tokenRecord.scope
      );

      return refreshedRecord;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown refresh error';
      console.error(`[Google OAuth] Refresh attempt ${attempt + 1} failed:`, errorMessage);

      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay *= 2; // Exponential backoff
      } else {
        throw new Error(`Google OAuth token refresh failed after ${maxRetries} attempts: ${errorMessage}`);
      }
    }
  }

  // Should not reach here, but TypeScript needs it
  throw new Error('Google OAuth token refresh failed unexpectedly');
}

/**
 * Gets valid (non-expired) Google OAuth tokens for a user.
 * If tokens are expired, refreshes them automatically.
 * If no tokens exist, returns null.
 */
export async function getValidTokens(userId: string): Promise<GoogleOAuthTokenRecord | null> {
  const tokenRecord = await getStoredTokens(userId);

  if (!tokenRecord) {
    return null; // User hasn't authorized yet
  }

  // Check if token is expired (with 5-minute buffer)
  const expiryTime = new Date(tokenRecord.token_expiry).getTime();
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiryTime - bufferMs <= now) {
    // Token is expired or about to expire — refresh it
    try {
      return await refreshExpiredTokens(userId, tokenRecord);
    } catch (err) {
      console.error('[Google OAuth] Failed to refresh expired tokens:', err);
      // If refresh fails, the refresh token might be revoked
      // Delete the stored tokens so user can re-authorize
      await supabaseServer
        .from('google_oauth_tokens')
        .delete()
        .eq('user_id', userId);
      return null;
    }
  }

  return tokenRecord;
}

// ─── Authorization Check ───

/**
 * Checks if a user has authorized Google Forms API access.
 * Returns the authorization status including whether incremental auth is needed.
 */
export async function checkAuthStatus(userId: string): Promise<GoogleAuthStatus> {
  // First check if OAuth is configured at all
  if (!isGoogleOAuthConfigured()) {
    return {
      isAuthorized: false,
      hasFormsScope: false,
      needsIncrementalAuth: false, // Can't do anything without env vars
    };
  }

  const tokenRecord = await getValidTokens(userId);

  if (!tokenRecord) {
    // No tokens stored → need incremental auth
    return {
      isAuthorized: false,
      hasFormsScope: false,
      needsIncrementalAuth: true,
      authUrl: generateIncrementalAuthUrl(userId),
    };
  }

  // Check if the stored scope includes Forms API scopes
  const storedScopes = tokenRecord.scope.split(' ');
  const requiredScopes = Array.from(GOOGLE_FORMS_SCOPES);
  const hasFormsScope = requiredScopes.some(required =>
    storedScopes.some(stored => stored.startsWith(required))
  );

  if (!hasFormsScope) {
    // Tokens exist but don't include Forms scope → need incremental auth
    return {
      isAuthorized: false,
      hasFormsScope: false,
      needsIncrementalAuth: true,
      authUrl: generateIncrementalAuthUrl(userId),
      tokenExpiry: tokenRecord.token_expiry,
    };
  }

  return {
    isAuthorized: true,
    hasFormsScope: true,
    needsIncrementalAuth: false,
    tokenExpiry: tokenRecord.token_expiry,
  };
}

// ─── Incremental Authorization ───

/**
 * Generates a Google OAuth authorization URL with the Forms API scope.
 * This is for INCREMENTAL AUTHORIZATION — the user is already logged in
 * via Supabase Auth, so we only request the additional Forms API scope.
 *
 * The URL includes a state parameter with the user ID so we can
 * identify the user when the callback is received.
 */
export function generateIncrementalAuthUrl(userId: string): string {
  const oauth2Client = createOAuth2Client();

  // Use 'consent' prompt to ensure we get a refresh token
  // even if the user previously granted some scopes
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: Array.from(GOOGLE_FORMS_SCOPES),
    state: userId, // Pass user ID in state for callback verification
  });

  return authUrl;
}

/**
 * Handles the OAuth callback after incremental authorization.
 * Exchanges the authorization code for tokens and stores them.
 *
 * This is called from the API route that receives the callback redirect.
 */
export async function handleAuthCallback(
  authCode: string,
  userId: string
): Promise<GoogleOAuthTokenRecord> {
  const oauth2Client = createOAuth2Client();

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(authCode);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(
      'Google OAuth callback failed: missing access_token or refresh_token. ' +
      'This may happen if the user did not complete the consent flow.'
    );
  }

  // Store the tokens
  const tokenRecord = await storeTokens(
    userId,
    tokens.access_token,
    tokens.refresh_token,
    tokens.expiry_date || Date.now() + 3600000,
    tokens.scope || Array.from(GOOGLE_FORMS_SCOPES).join(' ')
  );

  return tokenRecord;
}

// ─── Authenticated OAuth2 Client ───

/**
 * Returns an authenticated OAuth2 client for making Google API calls.
 * Automatically refreshes expired tokens.
 * Throws if the user hasn't authorized Forms API access.
 */
export async function getAuthenticatedClient(userId: string): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const tokenRecord = await getValidTokens(userId);

  if (!tokenRecord) {
    throw new Error('GOOGLE_AUTH_REQUIRED: User has not authorized Google Forms API access');
  }

  // Verify the token has Forms scope
  const storedScopes = tokenRecord.scope.split(' ');
  const hasFormsScope = Array.from(GOOGLE_FORMS_SCOPES).some(required =>
    storedScopes.some(stored => stored.startsWith(required))
  );

  if (!hasFormsScope) {
    throw new Error('GOOGLE_AUTH_REQUIRED: User has not granted Forms API scope');
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokenRecord.access_token,
    refresh_token: tokenRecord.refresh_token,
    expiry_date: new Date(tokenRecord.token_expiry).getTime(),
  });

  return oauth2Client;
}
