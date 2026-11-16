import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: On Vercel Hobby plan, maxDuration is capped at 60s.
export const maxDuration = 60;
export const runtime = 'nodejs';
import { generateQuiz, isAiError } from '@/lib/ai';
import type { QuizGenerationOptions, QuizMixCounts } from '@/lib/ai/types';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/gemini/quiz
 *
 * Generate a quiz from content with optional configuration.
 *
 * Body: {
 *   content: string,
 *   questionTypes?: { mcq?: number, boolean?: number, completion?: number, matching?: number },
 *   totalQuestions?: number,
 *   difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard' | 'mixed',   // v136
 *   contentScope?: 'file_only' | 'beyond_file',                        // v136 (beyond only applies to hard/very_hard)
 *   mixCounts?: { easy?, medium?, hard?, very_hard? },                 // v136 — required for 'mixed' (teacher-controlled)
 *   bankId?: string,                                                    // v136 — pulls bank questions as dedup guard
 * }
 */

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'very_hard', 'mixed'];
const VALID_SCOPES = ['file_only', 'beyond_file'];

function parseMixCounts(raw: unknown): QuizMixCounts | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const clamp = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(30, Math.floor(n))) : undefined;
  const easy = clamp(r.easy);
  const medium = clamp(r.medium);
  const hard = clamp(r.hard);
  const very_hard = clamp(r.very_hard);
  const counts: QuizMixCounts = {};
  if (easy !== undefined) counts.easy = easy;
  if (medium !== undefined) counts.medium = medium;
  if (hard !== undefined) counts.hard = hard;
  if (very_hard !== undefined) counts.very_hard = very_hard;
  return Object.keys(counts).length > 0 ? counts : undefined;
}
export async function POST(request: NextRequest) {
  try {
    const validationError = validateRequest(request, { largeBody: true });
    if (validationError) return validationError;

    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Fetch user name for personalized AI responses
    let studentName: string | undefined;
    try {
      const { data: profile } = await supabaseServer
        .from('users')
        .select('name')
        .eq('id', authResult.user.id)
        .single();
      studentName = profile?.name || undefined;
    } catch {
      // Name lookup failed — will use default in AI prompt
    }

    const rateLimit = checkRateLimit(request, authResult.success ? authResult.user.id : undefined);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    const body = await request.json();
    const rawContent = body.content;
    const questionTypes = body.questionTypes as { mcq?: number; boolean?: number; completion?: number; matching?: number } | undefined;

    // ─── v136: difficulty strategy params (validated + scope enforcement) ───
    const difficulty: string | undefined = VALID_DIFFICULTIES.includes(body.difficulty) ? body.difficulty : undefined;
    let contentScope: string | undefined = VALID_SCOPES.includes(body.contentScope) ? body.contentScope : undefined;
    // HARD RULE: beyond-file is restricted to hard/very_hard — downgrade silently otherwise
    if (contentScope === 'beyond_file' && (difficulty === 'easy' || difficulty === 'medium')) {
      console.log('[Quiz API] beyond_file rejected for difficulty "' + difficulty + '" — forcing file_only');
      contentScope = 'file_only';
    }
    const mixCounts = parseMixCounts(body.mixCounts);
    const bankId: string | undefined = typeof body.bankId === 'string' && body.bankId.length > 0 ? body.bankId : undefined;

    // ─── v136: dedup guard — pull the bank's existing questions into the prompt ───
    let existingQuestions: string[] | undefined;
    if (bankId) {
      try {
        const { data: bank } = await supabaseServer
          .from('question_banks')
          .select('id, teacher_id, subject_id')
          .eq('id', bankId)
          .single();

        if (bank) {
          // Access: bank owner or co-teacher of the subject
          let hasAccess = bank.teacher_id === authResult.user.id;
          if (!hasAccess) {
            const { data: coTeacher } = await supabaseServer
              .from('subject_teachers')
              .select('id')
              .eq('subject_id', bank.subject_id)
              .eq('teacher_id', authResult.user.id)
              .single();
            hasAccess = !!coTeacher;
          }

          if (hasAccess) {
            const { data: bankQuestions } = await supabaseServer
              .from('bank_questions')
              .select('question')
              .eq('bank_id', bankId)
              .order('created_at', { ascending: false })
              .limit(60);
            existingQuestions = (bankQuestions || []).map((q: { question: string }) => q.question);
          } else {
            console.warn('[Quiz API] bankId provided but user has no access — ignoring dedup guard');
          }
        }
      } catch (bankErr) {
        // Dedup guard is best-effort — never block generation on it
        console.warn('[Quiz API] Failed to load bank questions for dedup guard:', bankErr instanceof Error ? bankErr.message : bankErr);
      }
    }

    const generationOptions: QuizGenerationOptions | undefined =
      difficulty || contentScope || mixCounts || existingQuestions
        ? {
            difficulty: difficulty as QuizGenerationOptions['difficulty'],
            contentScope: contentScope as QuizGenerationOptions['contentScope'],
            mixCounts,
            existingQuestions,
          }
        : undefined;

    if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى مطلوب' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const sanitizedContent = sanitizeString(rawContent, 50000);
    if (sanitizedContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى غير صالح بعد التنظيف' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Generate quiz using AI (Gemini) with fallback chain
    // The AI layer now manages its own global timeout budget across the fallback chain.
    // No duplicate route-level timeout — the provider-manager handles it internally.
    console.log('[Quiz API] Generating quiz for user:', authResult.user.id, 'config:', questionTypes, 'difficulty:', difficulty || 'default(mixed)', 'scope:', contentScope || 'default');
    const questions = await generateQuiz(sanitizedContent, questionTypes, studentName, generationOptions);
    console.log('[Quiz API] Quiz generated successfully, questions:', questions.length);

    return NextResponse.json(
      { success: true, data: { questions } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Quiz API] Error:', error);

    // ─── Handle AiProviderError (structured errors from our AI service) ───
    if (isAiError(error)) {
      const statusMap: Record<string, number> = {
        'RATE_LIMIT': 429,
        'AUTH_ERROR': 503,
        'TIMEOUT': 504,
        'NOT_CONFIGURED': 503,
        'MODEL_ERROR': 503,
        'CONNECTION_ERROR': 504,
        'EMPTY_RESPONSE': 502,
        'UNKNOWN': 500,
      };
      const status = statusMap[error.code] || 500;
      console.error('[Quiz API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    // Fallback for unstructured errors
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Quiz API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء إنشاء الاختبار');
  }
}
