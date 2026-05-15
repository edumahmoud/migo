/**
 * AI Layer — Provider Manager
 *
 * Orchestrates all AI providers with:
 *   - Fallback chain: Gemini → Cerebras → OpenRouter → Graceful failure
 *   - Automatic key rotation within Gemini
 *   - Aggressive caching
 *   - Retry logic with exponential backoff
 *   - Full observability logging
 *   - Concurrent-safe operations
 *   - Mobile-friendly error handling
 *
 * This is the single entry point for all AI operations.
 */

import type {
  AiProvider,
  AiChatOptions,
  ProviderHealth,
  ProviderId,
  AiErrorCode,
  AiLogEntry,
  QuizQuestion,
} from './types';
import { AiProviderError, isAiError } from './types';
import { geminiProvider } from './providers/gemini';
import { cerebrasProvider } from './providers/cerebras';
import { openrouterProvider } from './providers/openrouter';
import { getCache, setCache, generateCacheHash, contentHash } from './cache';
import { PROMPT_VERSION } from './prompts';
import {
  SUMMARY_SYSTEM, SUMMARY_USER,
  REFINE_SYSTEM, REFINE_USER,
  QUIZ_SYSTEM, QUIZ_USER,
  EVALUATE_SYSTEM, EVALUATE_USER,
  EVALUATE_DETAILED_SYSTEM, EVALUATE_DETAILED_USER,
  EXPLAIN_SYSTEM, EXPLAIN_USER,
} from './prompts';
import { extractJson, parseQuizResponse, parseEvaluationResponse } from './parser';

// -------------------------------------------------------
// Provider Chain Configuration
// -------------------------------------------------------

/** Fallback chain order — providers are tried in this order */
const PROVIDER_CHAIN: AiProvider[] = [
  geminiProvider,
  cerebrasProvider,
  openrouterProvider,
];

// -------------------------------------------------------
// Observability
// -------------------------------------------------------

const MAX_LOG_ENTRIES = 1000;
const logBuffer: AiLogEntry[] = [];

function log(entry: Omit<AiLogEntry, 'timestamp'>): void {
  const fullEntry: AiLogEntry = { ...entry, timestamp: Date.now() };
  logBuffer.push(fullEntry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
}

/** Get recent AI operation logs */
export function getAiLogs(limit: number = 50): AiLogEntry[] {
  return logBuffer.slice(-limit);
}

/** Get AI system stats */
export function getAiStats(): {
  totalRequests: number;
  totalFailures: number;
  cacheHitRate: number;
  activeProvider: ProviderId;
  providerHealth: Record<string, ProviderHealth>;
} {
  const totalReqs = logBuffer.filter(l => l.success).length + logBuffer.filter(l => !l.success).length;
  const failures = logBuffer.filter(l => !l.success).length;
  const cacheHits = logBuffer.filter(l => l.cacheHit).length;

  return {
    totalRequests: totalReqs,
    totalFailures: failures,
    cacheHitRate: totalReqs > 0 ? cacheHits / totalReqs : 0,
    activeProvider: 'gemini',
    providerHealth: {}, // Populated on demand
  };
}

// -------------------------------------------------------
// Core: Chat with Full Fallback Chain
// -------------------------------------------------------

/**
 * Execute a chat request through the full provider chain.
 *
 * Flow:
 * 1. Check cache → return if hit
 * 2. Try Gemini (with key rotation)
 * 3. If Gemini fails → try Cerebras
 * 4. If Cerebras fails → try OpenRouter
 * 5. If all fail → return graceful error
 */
async function chatWithFallback(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions & { operation?: string },
): Promise<string> {
  const operation = options?.operation || 'unknown';
  const startTime = Date.now();

  // ─── 1. Check cache ───
  const cacheKey = generateCacheHash(
    userPrompt,
    contentHash(systemPrompt + userPrompt),
    PROMPT_VERSION,
    operation,
  );

  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      log({
        provider: cached.provider,
        keyIndex: -1,
        operation,
        cacheHit: true,
        latencyMs: Date.now() - startTime,
        retries: 0,
        success: true,
      });
      return cached.result;
    }
  } catch {
    // Cache lookup failed — continue without cache
  }

  // ─── 2. Try each provider in the fallback chain ───
  let lastError: AiProviderError | null = null;
  const noRetryCodes: AiErrorCode[] = ['NOT_CONFIGURED'];

  for (const provider of PROVIDER_CHAIN) {
    try {
      const result = await chatWithRetry(provider, systemPrompt, userPrompt, options);

      // Cache the result
      try {
        await setCache(cacheKey, result, provider.id);
      } catch {
        // Cache write failed — non-critical
      }

      log({
        provider: provider.id,
        keyIndex: -1,
        operation,
        cacheHit: false,
        latencyMs: Date.now() - startTime,
        retries: 0,
        success: true,
      });

      return result;
    } catch (error: unknown) {
      const classified = isAiError(error)
        ? error as AiProviderError
        : new AiProviderError('UNKNOWN', 'حدث خطأ غير متوقع', provider.id, error);

      lastError = classified;

      log({
        provider: provider.id,
        keyIndex: -1,
        operation,
        cacheHit: false,
        latencyMs: Date.now() - startTime,
        retries: 0,
        errorCode: classified.code,
        success: false,
        rotationReason: `Provider ${provider.id} failed: ${classified.code}`,
      });

      console.warn(
        `[ProviderManager] ${provider.name} failed (${classified.code}), trying next provider...`,
      );

      // If it's a configuration error, no point trying other providers
      // (they might also not be configured)
      if (classified.code === 'NOT_CONFIGURED' && provider.id === 'gemini') {
        // Gemini not configured — try fallbacks
        continue;
      }

      continue;
    }
  }

  // ─── 3. All providers failed — graceful failure ───
  console.error('[ProviderManager] All providers failed');

  // Return a useful error with retry option
  if (lastError) {
    throw new AiProviderError(
      lastError.code,
      `${lastError.userMessage}. يرجى المحاولة مرة أخرى لاحقاً`,
      lastError.provider,
      lastError,
    );
  }

  throw new AiProviderError(
    'UNKNOWN',
    'جميع خدمات الذكاء الاصطناعي غير متاحة حالياً. يرجى المحاولة بعد دقيقة',
    'unknown',
  );
}

// -------------------------------------------------------
// Retry Logic with Exponential Backoff
// -------------------------------------------------------

async function chatWithRetry(
  provider: AiProvider,
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
): Promise<string> {
  const maxRetries = options?.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[ProviderManager] Retry attempt ${attempt}/${maxRetries} on ${provider.name}`);
      }

      const result = await provider.chat(systemPrompt, userPrompt, options);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorCode = isAiError(error) ? error.code : 'UNKNOWN';

      console.warn(
        `[ProviderManager] ${provider.name} attempt ${attempt + 1} failed (${errorCode}):`,
        lastError.message,
      );

      // Don't retry on these codes
      const noRetryCodes: AiErrorCode[] = ['AUTH_ERROR', 'NOT_CONFIGURED'];
      if (noRetryCodes.includes(errorCode as AiErrorCode)) {
        throw lastError;
      }

      // Wait before retrying with exponential backoff
      if (attempt < maxRetries) {
        const backoffMs = errorCode === 'RATE_LIMIT'
          ? Math.min(5000 * Math.pow(2, attempt), 30000)  // 5s, 10s for rate limits
          : Math.min(1000 * Math.pow(2, attempt), 8000);  // 1s, 2s for other errors
        console.log(`[ProviderManager] Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  if (isAiError(lastError)) {
    throw lastError;
  }
  throw lastError || new AiProviderError('UNKNOWN', 'فشل الاتصال بالذكاء الاصطناعي بعد عدة محاولات', provider.id);
}

// -------------------------------------------------------
// Content Truncation Helper
// -------------------------------------------------------

const MAX_AI_CONTENT_LENGTH = 100000;

function truncateContent(content: string, maxLength: number = MAX_AI_CONTENT_LENGTH): string {
  if (content.length <= maxLength) return content;

  console.warn(`[AI] Content too large (${content.length} chars), truncating to ${maxLength} chars`);
  const truncated = content.substring(0, maxLength);
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxLength * 0.7) {
    return truncated.substring(0, lastParagraph) + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
  }
  return truncated + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
}

// -------------------------------------------------------
// Public API — Unified Interface
// -------------------------------------------------------

/**
 * Generate a summary of the given content.
 * Uses Gemini with fallback chain and caching.
 */
export async function generateSummary(content: string): Promise<string> {
  const truncatedContent = truncateContent(content);

  return chatWithFallback(
    SUMMARY_SYSTEM,
    SUMMARY_USER(truncatedContent),
    { temperature: 0.3, maxTokens: 8192, retries: 1, operation: 'summary' },
  );
}

/**
 * Refine/format transcribed (OCR-extracted) text.
 */
export async function refineTranscribedText(content: string): Promise<string> {
  const truncatedContent = truncateContent(content);

  return chatWithFallback(
    REFINE_SYSTEM,
    REFINE_USER(truncatedContent),
    { temperature: 0.2, maxTokens: 8192, retries: 1, operation: 'refine' },
  );
}

/**
 * Generate a quiz from content.
 * Returns parsed and deduplicated questions.
 */
export async function generateQuiz(
  content: string,
  questionTypes?: { mcq?: number; boolean?: number; completion?: number; matching?: number },
): Promise<QuizQuestion[]> {
  const mcqCount = questionTypes?.mcq ?? 2;
  const booleanCount = questionTypes?.boolean ?? 2;
  const completionCount = questionTypes?.completion ?? 2;
  const matchingCount = questionTypes?.matching ?? 2;
  const totalCount = mcqCount + booleanCount + completionCount + matchingCount;

  const truncatedContent = truncateContent(content);

  const typeConfig: string[] = [];
  if (mcqCount > 0) typeConfig.push(`${mcqCount} اختيار من متعدد (mcq)`);
  if (booleanCount > 0) typeConfig.push(`${booleanCount} صح أو خطأ (boolean)`);
  if (completionCount > 0) typeConfig.push(`${completionCount} أكمل الفراغ (completion)`);
  if (matchingCount > 0) typeConfig.push(`${matchingCount} مطابقة (matching)`);

  const text = await chatWithFallback(
    QUIZ_SYSTEM(totalCount, typeConfig),
    QUIZ_USER(truncatedContent, totalCount),
    { temperature: 0.5, maxTokens: 8192, retries: 1, jsonMode: true, operation: 'quiz' },
  );

  // Parse and validate quiz response
  let questions: QuizQuestion[];
  try {
    questions = parseQuizResponse(text);
  } catch {
    throw new AiProviderError('MALFORMED_JSON', 'فشل في تحليل استجابة الذكاء الاصطناعي. يرجى المحاولة مرة أخرى', 'unknown');
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new AiProviderError('MALFORMED_JSON', 'تنسيق الأسئلة غير صحيح. يرجى المحاولة مرة أخرى', 'unknown');
  }

  // Deduplicate questions and options
  const deduped = deduplicateQuestions(questions);

  // Trim questions to match the requested count per type.
  // The AI may generate more questions than requested, so we take only
  // the requested number for each type (preserving order).
  const requestedCounts: Record<string, number> = {};
  if (mcqCount > 0) requestedCounts['mcq'] = mcqCount;
  if (booleanCount > 0) requestedCounts['boolean'] = booleanCount;
  if (completionCount > 0) requestedCounts['completion'] = completionCount;
  if (matchingCount > 0) requestedCounts['matching'] = matchingCount;

  const typeCounters: Record<string, number> = { mcq: 0, boolean: 0, completion: 0, matching: 0 };
  const trimmed: QuizQuestion[] = [];

  for (const q of deduped) {
    const maxAllowed = requestedCounts[q.type] ?? 0;
    if (maxAllowed > 0 && typeCounters[q.type] < maxAllowed) {
      trimmed.push(q);
      typeCounters[q.type]++;
    }
  }

  // If trimming removed all questions (unlikely), fall back to deduped list
  if (trimmed.length === 0 && deduped.length > 0) {
    console.warn('[Quiz] Trimming removed all questions, falling back to deduped list');
    return deduped;
  }

  if (trimmed.length < totalCount) {
    console.warn(`[Quiz] Generated ${trimmed.length} questions, requested ${totalCount}`);
  }

  return trimmed;
}

/**
 * Evaluate a fill-in-the-blank answer.
 * Returns true if the student's answer is semantically correct.
 */
export async function evaluateCompletionAnswer(
  question: string,
  correctAnswer: string,
  studentAnswer: string,
): Promise<boolean> {
  // First check for exact match (case-insensitive)
  if (studentAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim()) {
    return true;
  }

  const text = await chatWithFallback(
    EVALUATE_SYSTEM,
    EVALUATE_USER(question, correctAnswer, studentAnswer),
    { temperature: 0.1, maxTokens: 10, timeoutMs: 30000, retries: 1, nonStream: true, operation: 'evaluate' },
  );

  return text.trim().toLowerCase().includes('true');
}

/**
 * Evaluate with detailed reasoning (for teacher AI grading).
 * Returns isCorrect + reasoning JSON.
 */
export async function evaluateCompletionDetailed(
  question: string,
  correctAnswer: string,
  studentAnswer: string,
): Promise<{ isCorrect: boolean; reasoning: string }> {
  const text = await chatWithFallback(
    EVALUATE_DETAILED_SYSTEM,
    EVALUATE_DETAILED_USER(question, correctAnswer, studentAnswer),
    { temperature: 0.1, maxTokens: 256, timeoutMs: 30000, retries: 1, nonStream: true, jsonMode: true, operation: 'evaluate_detailed' },
  );

  return parseEvaluationResponse(text);
}

/**
 * Explain why a student's answer is wrong.
 * Returns a pedagogical explanation in Arabic.
 */
export async function explainWrongAnswer(
  question: string,
  correctAnswer: string,
  studentAnswer: string,
  questionType: string,
): Promise<string> {
  return chatWithFallback(
    EXPLAIN_SYSTEM,
    EXPLAIN_USER(questionType, question, correctAnswer, studentAnswer),
    { temperature: 0.4, maxTokens: 512, timeoutMs: 30000, retries: 1, operation: 'explain' },
  );
}

// -------------------------------------------------------
// Health Check
// -------------------------------------------------------

/**
 * Check health of all AI providers.
 */
export async function checkAllProvidersHealth(): Promise<{
  status: 'ok' | 'error' | 'degraded';
  provider: string;
  providers: Record<string, ProviderHealth>;
  summary: string;
}> {
  const providers: Record<string, ProviderHealth> = {};

  for (const provider of PROVIDER_CHAIN) {
    try {
      providers[provider.id] = await provider.checkHealth();
    } catch (err) {
      providers[provider.id] = {
        status: 'error',
        provider: provider.id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Determine overall status
  const geminiOk = providers.gemini?.status === 'ok';
  const anyOk = Object.values(providers).some(p => p.status === 'ok');

  let overallStatus: 'ok' | 'error' | 'degraded';
  if (geminiOk) {
    overallStatus = 'ok';
  } else if (anyOk) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'error';
  }

  return {
    status: overallStatus,
    provider: 'multi',
    providers,
    summary: geminiOk
      ? 'Gemini is healthy'
      : anyOk
        ? 'Gemini unavailable — using fallback provider(s)'
        : 'All AI providers are unavailable',
  };
}

// -------------------------------------------------------
// Deduplication Helper
// -------------------------------------------------------

function deduplicateQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  const seenQuestions = new Set<string>();
  const dedupedQuestions: QuizQuestion[] = [];

  for (const q of questions) {
    const normalizedQ = q.question.trim().toLowerCase();
    if (seenQuestions.has(normalizedQ)) {
      console.warn('[Quiz] Skipping duplicate question:', q.question);
      continue;
    }
    seenQuestions.add(normalizedQ);

    // For MCQ, deduplicate options
    if (q.type === 'mcq' && q.options) {
      const uniqueOptions = [...new Set(q.options)];
      if (uniqueOptions.length < q.options.length) {
        console.warn('[Quiz] Deduped MCQ options from', q.options.length, 'to', uniqueOptions.length);
      }
      q.options = uniqueOptions;
      if (q.correctAnswer && !uniqueOptions.includes(q.correctAnswer)) {
        console.warn('[Quiz] Skipping question with missing correctAnswer after dedup');
        seenQuestions.delete(normalizedQ);
        continue;
      }
    }

    // For matching, deduplicate keys and values
    if (q.type === 'matching' && q.pairs) {
      const seenKeys = new Set<string>();
      const seenValues = new Set<string>();
      const uniquePairs = q.pairs.filter(p => {
        if (seenKeys.has(p.key) || seenValues.has(p.value)) return false;
        seenKeys.add(p.key);
        seenValues.add(p.value);
        return true;
      });
      q.pairs = uniquePairs;
      if (q.pairs.length < 2) {
        console.warn('[Quiz] Skipping matching question with too few unique pairs');
        seenQuestions.delete(normalizedQ);
        continue;
      }
    }

    dedupedQuestions.push(q);
  }

  return dedupedQuestions;
}
