// ============================================================
// Google Forms Export API Route
// ============================================================
// POST /api/google/forms/export
//
// Exports selected questions from question banks to a Google Form.
// Requires Google Forms API authorization (incremental auth).
//
// Request body:
// {
//   questionIds: string[],
//   bankIds?: string[],
//   config: {
//     formTitle: string,
//     formDescription?: string,
//     createAsQuiz: boolean,
//     shuffleQuestions: boolean,
//     shuffleOptions: boolean,
//     collectEmailAddresses: boolean,
//     limitToOrganization: boolean,
//     formMode: 'createNew' | 'appendToExisting',
//     existingFormId?: string
//   }
// }
//
// Response:
// { success: true, data: ExportGoogleFormResult }
// OR
// { success: false, error: string, authRequired?: boolean, authUrl?: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse, requireTeacher } from '@/lib/auth-helpers';
import { exportQuestionsToGoogleForm } from '@/lib/google/forms';
import { checkAuthStatus, isGoogleOAuthConfigured } from '@/lib/google/oauth';
import type { ExportGoogleFormConfig, ExportGoogleFormResponse } from '@/types/googleForms';

export async function POST(request: NextRequest) {
  // ── Step 1: Authenticate and verify teacher role ──
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const userId = authResult.user.id;

  try {
    // ── Step 2: Check if Google OAuth is configured ──
    if (!isGoogleOAuthConfigured()) {
      return NextResponse.json<ExportGoogleFormResponse>({
        success: false,
        error: 'Google Forms integration is not configured. Please set up Google OAuth credentials.',
      }, { status: 500 });
    }

    // ── Step 3: Check authorization status ──
    const authStatus = await checkAuthStatus(userId);

    if (!authStatus.isAuthorized || authStatus.needsIncrementalAuth) {
      // User needs to authorize Google Forms API access
      return NextResponse.json<ExportGoogleFormResponse>({
        success: false,
        error: 'Google Forms API authorization required. Please grant access to continue.',
        authRequired: true,
        authUrl: authStatus.authUrl,
      }, { status: 401 });
    }

    // ── Step 4: Parse request body ──
    const body = await request.json();
    const { questionIds, bankIds, config } = body as {
      questionIds?: string[];
      bankIds?: string[];
      config: ExportGoogleFormConfig;
    };

    // Validate required fields
    if (!config || !config.formTitle) {
      return NextResponse.json<ExportGoogleFormResponse>({
        success: false,
        error: 'Form title is required',
      }, { status: 400 });
    }

    if (!questionIds || questionIds.length === 0) {
      if (!bankIds || bankIds.length === 0) {
        return NextResponse.json<ExportGoogleFormResponse>({
          success: false,
          error: 'At least one question ID or bank ID is required',
        }, { status: 400 });
      }
    }

    if (config.formMode === 'appendToExisting' && !config.existingFormId) {
      return NextResponse.json<ExportGoogleFormResponse>({
        success: false,
        error: 'Existing form ID is required when appending to a form',
      }, { status: 400 });
    }

    // ── Step 5: Execute export ──
    const result = await exportQuestionsToGoogleForm(
      userId,
      questionIds || [],
      bankIds || [],
      config
    );

    return NextResponse.json<ExportGoogleFormResponse>({
      success: true,
      data: result,
    });

  } catch (error) {
    console.error('[Google Forms Export] Error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';

    // Check if this is an auth-required error
    if (message.includes('GOOGLE_AUTH_REQUIRED')) {
      const authStatus = await checkAuthStatus(userId);
      return NextResponse.json<ExportGoogleFormResponse>({
        success: false,
        error: 'Google Forms API authorization required',
        authRequired: true,
        authUrl: authStatus.authUrl,
      }, { status: 401 });
    }

    return NextResponse.json<ExportGoogleFormResponse>({
      success: false,
      error: message,
    }, { status: 500 });
  }
}
