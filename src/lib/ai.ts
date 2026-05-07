/**
 * AI Service — Groq Only
 *
 * Centralized AI service using Groq (Llama 3.3 70B) as the sole provider.
 * Groq offers ultra-fast inference via LPU hardware.
 *
 * Provider flow:
 *   Request → Groq → Success ✅ → Return
 *                    ↓ Failure (any error)
 *                Error to user
 *
 * Key features:
 *   - Groq streaming for fast first-token delivery
 *   - Groq non-streaming for short responses (evaluate)
 *   - Content truncation to prevent oversized prompts
 *   - Comprehensive error handling with Arabic user messages
 *   - Circuit breaker to avoid wasting time when Groq is down
 *
 * Used by:
 *   - /api/gemini/summary  → Text/PDF summarization
 *   - /api/gemini/quiz     → Quiz generation from content
 *   - /api/gemini/evaluate → Fill-in-the-blank answer evaluation
 *   - /api/gemini/explain  → Explain wrong answers
 */

import Groq from 'groq-sdk';

// -------------------------------------------------------
// Custom Error Classes for AI Provider Errors
// -------------------------------------------------------

/**
 * Error codes for AI provider errors.
 * These codes allow route handlers to properly classify errors
 * regardless of whether the message is in Arabic or English.
 */
export type AiErrorCode =
  | 'RATE_LIMIT'        // 429 / rate_limit / quota
  | 'AUTH_ERROR'        // 401 / 403 / API_KEY invalid
  | 'TIMEOUT'           // timeout / timed out
  | 'NOT_CONFIGURED'    // API key not set
  | 'MODEL_ERROR'       // model not found / not available
  | 'CONNECTION_ERROR'  // ECONNRESET / socket hang up / aborted
  | 'EMPTY_RESPONSE'    // AI returned empty
  | 'UNKNOWN';          // Unclassified error

/**
 * Custom error class for AI provider errors.
 * Contains both a machine-readable `code` and an Arabic `userMessage`.
 *
 * IMPORTANT: Route handlers should check `error.code` (or use `isAiError()`)
 * instead of pattern-matching on error messages, because messages can be
 * in Arabic and won't match English patterns like "429" or "rate_limit".
 */
export class AiProviderError extends Error {
  code: AiErrorCode;
  userMessage: string;
  provider: 'groq' | 'unknown';

  constructor(code: AiErrorCode, userMessage: string, provider: 'groq' | 'unknown' = 'unknown', originalError?: unknown) {
    super(`[${code}] ${userMessage}`);
    this.name = 'AiProviderError';
    this.code = code;
    this.userMessage = userMessage;
    this.provider = provider;
    // Preserve the original error for debugging
    if (originalError instanceof Error) {
      this.cause = originalError;
    }
  }
}

/** Type guard: check if an error is an AiProviderError */
export function isAiError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError;
}

/**
 * Classify an error from Groq API call into an AiProviderError.
 * This function translates raw API errors (which can be English HTTP errors,
 * SDK-specific messages, or Arabic messages) into structured errors with
 * both a code and a user-friendly Arabic message.
 *
 * ORDER MATTERS: More specific patterns must come before general ones.
 * For example, "rate_limit" must be checked before "model" because
 * Groq rate limit errors can include the word "model".
 */
function classifyAiError(
  error: unknown,
  provider: 'groq',
): AiProviderError {
  const errMsg = error instanceof Error ? error.message : String(error);

  // Rate limit patterns (most specific — check FIRST)
  if (
    errMsg.includes('429') ||
    errMsg.includes('rate_limit') ||
    errMsg.includes('Rate limit') ||
    errMsg.includes('rate limit') ||
    errMsg.includes('RESOURCE_EXHAUSTED') ||
    errMsg.includes('quota') ||
    errMsg.includes('Too many requests')
  ) {
    return new AiProviderError('RATE_LIMIT', 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة', provider, error);
  }

  // Auth/key errors
  if (
    errMsg.includes('401') ||
    errMsg.includes('403') ||
    errMsg.includes('API_KEY') ||
    errMsg.includes('API key not valid') ||
    errMsg.includes('Incorrect API key') ||
    errMsg.includes('invalid x-api-key')
  ) {
    return new AiProviderError('AUTH_ERROR', 'خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة', provider, error);
  }

  // Timeout errors (both English and Arabic)
  if (
    errMsg.includes('timeout') ||
    errMsg.includes('timed out') ||
    errMsg.includes('ETIMEDOUT') ||
    errMsg.includes('مهلة') ||
    errMsg.includes('انتهت مهلة')
  ) {
    return new AiProviderError('TIMEOUT', 'انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى', provider, error);
  }

  // Not configured
  if (errMsg.includes('NOT_CONFIGURED') || errMsg.includes('غير مفعلة') || errMsg.includes('not configured')) {
    return new AiProviderError('NOT_CONFIGURED', 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة', provider, error);
  }

  // Connection errors (check BEFORE model errors — more specific)
  if (
    errMsg.includes('ECONNRESET') ||
    errMsg.includes('socket hang up') ||
    errMsg.includes('aborted') ||
    errMsg.includes('ECONNREFUSED') ||
    errMsg.includes('fetch failed') ||
    errMsg.includes('network') ||
    errMsg.includes('ENOTFOUND')
  ) {
    return new AiProviderError('CONNECTION_ERROR', 'انتهت مهلة الخادم. قد يكون المحتوى كبيراً جداً، جرب تلخيص محتوى أقصر', provider, error);
  }

  // Model errors — SPECIFIC patterns only (avoid catching "model" in rate limit messages)
  if (
    errMsg.includes('model_not_found') ||
    errMsg.includes('Model not found') ||
    errMsg.includes('model not found') ||
    errMsg.includes('does not exist') ||
    errMsg.includes('not available') ||
    errMsg.includes('currently loading') ||
    errMsg.includes('not ready')
  ) {
    return new AiProviderError('MODEL_ERROR', 'نموذج الذكاء الاصطناعي غير متاح حالياً. يرجى المحاولة لاحقاً', provider, error);
  }

  // Empty response
  if (errMsg.includes('empty response') || errMsg.includes('Empty response') || errMsg.includes('Empty streaming response')) {
    return new AiProviderError('EMPTY_RESPONSE', 'لم يتمكن الذكاء الاصطناعي من إنشاء رد. يرجى المحاولة مرة أخرى', provider, error);
  }

  // Unknown
  return new AiProviderError('UNKNOWN', `حدث خطأ أثناء الاتصال بالذكاء الاصطناعي: ${errMsg.substring(0, 150)}`, provider, error);
}

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

/** Maximum content length to send to the AI (chars).
 *  50K chars ≈ 12.5K tokens. Groq (128K context) supports this easily. */
const MAX_AI_CONTENT_LENGTH = 50000;

/** Overall timeout for AI API calls (milliseconds).
 *  IMPORTANT: Must leave headroom for auth + DB within Vercel's 60s limit.
 *  45s gives us 15s for auth (3-5s) + DB save (2-5s) + network overhead. */
const AI_CALL_TIMEOUT_MS = 45000; // 45 seconds

/** First-token timeout for streaming calls (milliseconds).
 *  Groq typically returns first token in <500ms.
 *  10s is a generous first-token timeout. */
const AI_FIRST_TOKEN_TIMEOUT_MS = 10000; // 10 seconds

// -------------------------------------------------------
// Groq Circuit Breaker
// -------------------------------------------------------

/**
 * Circuit breaker for Groq: if Groq fails multiple times in a row,
 * we "open" the circuit and skip Groq entirely for a cooldown period.
 * This prevents wasting time on every request when Groq is down.
 *
 * States:
 *   CLOSED    → Normal operation (try Groq)
 *   OPEN      → Skip Groq entirely (return error immediately)
 *   HALF_OPEN → Try Groq once to see if it's back
 *
 * After COOLDOWN_MS in OPEN state, we try once (HALF_OPEN).
 * If that succeeds, circuit closes. If it fails, circuit stays open.
 */
const CIRCUIT_FAILURE_THRESHOLD = 3;  // Open after 3 consecutive failures
const CIRCUIT_COOLDOWN_MS = 120000;   // 2 minutes cooldown before retrying Groq

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

let circuitState: CircuitState = 'CLOSED';
let circuitFailureCount = 0;
let circuitOpenSince = 0; // timestamp when circuit opened

function isGroqCircuitOpen(): boolean {
  if (circuitState === 'CLOSED') return false;

  if (circuitState === 'OPEN') {
    const elapsed = Date.now() - circuitOpenSince;
    if (elapsed >= CIRCUIT_COOLDOWN_MS) {
      // Cooldown elapsed — try Groq once (HALF_OPEN)
      console.log('[Circuit Breaker] Cooldown elapsed, trying Groq again (HALF_OPEN)');
      circuitState = 'HALF_OPEN';
      return false; // Allow one attempt
    }
    return true; // Still open, skip Groq
  }

  // HALF_OPEN — allow the attempt
  return false;
}

function recordGroqSuccess(): void {
  if (circuitState !== 'CLOSED') {
    console.log('[Circuit Breaker] Groq succeeded! Circuit CLOSED (normal operation)');
  }
  circuitState = 'CLOSED';
  circuitFailureCount = 0;
}

function recordGroqFailure(): void {
  circuitFailureCount++;

  if (circuitState === 'HALF_OPEN') {
    // Groq failed in HALF_OPEN — go back to OPEN
    console.warn('[Circuit Breaker] Groq still failing in HALF_OPEN → back to OPEN');
    circuitState = 'OPEN';
    circuitOpenSince = Date.now();
    return;
  }

  if (circuitFailureCount >= CIRCUIT_FAILURE_THRESHOLD) {
    console.warn(`[Circuit Breaker] Groq failed ${circuitFailureCount} times consecutively → circuit OPEN (skipping Groq for ${CIRCUIT_COOLDOWN_MS / 1000}s)`);
    circuitState = 'OPEN';
    circuitOpenSince = Date.now();
  }
}

// -------------------------------------------------------
// Provider configuration
// -------------------------------------------------------

/** Groq model to use. Llama 3.3 70B has 128K context window —
 *  handles 50K chars easily and produces good Arabic output. */
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// -------------------------------------------------------
// Groq API Key Pool (Round-Robin Rotation)
// -------------------------------------------------------

/**
 * Multiple Groq API keys can be provided to distribute load and avoid rate limits.
 * 
 * Configuration:
 *   GROQ_API_KEY=primary_key              (required, always present)
 *   GROQ_API_KEY_2=second_key             (optional)
 *   GROQ_API_KEY_3=third_key              (optional)
 *   ...up to GROQ_API_KEY_9               (optional)
 * 
 * Keys are rotated in round-robin fashion. Each request uses the next key
 * in the pool. This effectively multiplies the rate limit:
 *   - 1 key  → 30 req/min
 *   - 2 keys → 60 req/min
 *   - 3 keys → 90 req/min
 */
const groqApiKeys: string[] = [];

// Collect all GROQ_API_KEY* env vars
(function initApiKeyPool() {
  // Primary key (always required)
  const primaryKey = process.env.GROQ_API_KEY;
  if (primaryKey) {
    groqApiKeys.push(primaryKey);
  }

  // Additional keys (GROQ_API_KEY_2 through GROQ_API_KEY_9)
  for (let i = 2; i <= 9; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key) {
      groqApiKeys.push(key);
    }
  }

  console.log(`[Groq] API key pool initialized: ${groqApiKeys.length} key(s) available`);
})();

/** Round-robin index for key rotation */
let currentKeyIndex = 0;

/** Get the next API key in the pool (round-robin) */
function getNextApiKey(): string {
  if (groqApiKeys.length === 0) {
    throw new AiProviderError('NOT_CONFIGURED', 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة', 'groq');
  }

  const key = groqApiKeys[currentKeyIndex % groqApiKeys.length];
  currentKeyIndex = (currentKeyIndex + 1) % groqApiKeys.length;
  return key;
}

// -------------------------------------------------------
// Groq Client Pool (one client per API key)
// -------------------------------------------------------

const groqClientPool = new Map<string, Groq>();

function getGroqClient(): Groq {
  const apiKey = getNextApiKey();

  // Check if we already have a client for this key
  const existing = groqClientPool.get(apiKey);
  if (existing) return existing;

  if (!apiKey) {
    console.warn('[Groq] GROQ_API_KEY not set');
    throw new AiProviderError('NOT_CONFIGURED', 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة', 'groq');
  }

  const client = new Groq({ apiKey });
  groqClientPool.set(apiKey, client);
  console.log('[Groq] New client initialized for key index (pool size:', groqClientPool.size, ')');
  return client;
}

// -------------------------------------------------------
// Helper: truncate content to fit within model limits
// -------------------------------------------------------

/**
 * Truncate content to a reasonable size for the AI model.
 * Tries to truncate at paragraph/sentence boundaries to preserve meaning.
 */
function truncateContent(content: string, maxLength: number = MAX_AI_CONTENT_LENGTH): string {
  if (content.length <= maxLength) return content;

  console.warn(`[AI] Content too large (${content.length} chars), truncating to ${maxLength} chars`);

  // Try to truncate at a paragraph boundary
  const truncated = content.substring(0, maxLength);
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxLength * 0.7) {
    return truncated.substring(0, lastParagraph) + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
  }

  // Try to truncate at a sentence boundary
  const lastSentence = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('؟'),
    truncated.lastIndexOf('?'),
  );
  if (lastSentence > maxLength * 0.7) {
    return truncated.substring(0, lastSentence + 1) + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
  }

  return truncated + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
}

// -------------------------------------------------------
// Groq: Streaming chat call
// -------------------------------------------------------

async function groqStreamChat(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  overallTimeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<string> {
  const client = getGroqClient();
  const startTime = Date.now();
  const overallDeadline = startTime + overallTimeoutMs;

  console.log('[Groq] Starting STREAM for model:', GROQ_MODEL, '(timeout:', overallTimeoutMs + 'ms)');

  const stream = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options?.temperature ?? 0.4,
    max_tokens: options?.maxTokens ?? 4096,
    stream: true,
  });

  let firstTokenReceived = false;
  let accumulatedText = '';

  try {
    for await (const chunk of stream) {
      const chunkText = chunk.choices[0]?.delta?.content || '';
      if (chunkText) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          console.log('[Groq] First token received in', Date.now() - startTime, 'ms');
        }
        accumulatedText += chunkText;
      }

      // Check overall deadline after each chunk
      if (Date.now() > overallDeadline) {
        console.warn('[Groq] Overall timeout reached after', Date.now() - startTime, 'ms. Returning partial (', accumulatedText.length, 'chars)');
        if (accumulatedText.trim().length > 100) {
          return accumulatedText + '\n\n[... تم قطع الاستجابة بسبب انتهاء المهلة ...]';
        }
        throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
      }
    }
  } catch (streamError: unknown) {
    const errMsg = streamError instanceof Error ? streamError.message : String(streamError);

    // If we accumulated significant text, return it as partial
    if (accumulatedText.trim().length > 100 && !errMsg.includes('انتهت مهلة')) {
      console.warn('[Groq] Stream error after', Date.now() - startTime, 'ms, returning partial (', accumulatedText.length, 'chars):', errMsg);
      return accumulatedText;
    }

    // If first token never arrived within timeout
    if (!firstTokenReceived) {
      const elapsed = Date.now() - startTime;
      if (elapsed > AI_FIRST_TOKEN_TIMEOUT_MS) {
        console.warn('[Groq] First-token timeout (', elapsed, 'ms)');
        throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
      }
    }

    throw streamError;
  }

  if (!accumulatedText || accumulatedText.trim().length === 0) {
    console.error('[Groq] Empty streaming response');
    throw new Error('AI returned an empty response');
  }

  console.log('[Groq] Stream complete, length:', accumulatedText.length, ', time:', Date.now() - startTime, 'ms');
  return accumulatedText;
}

// -------------------------------------------------------
// Groq: Non-streaming chat call (for short responses)
// -------------------------------------------------------

async function groqNonStreamChat(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<string> {
  const client = getGroqClient();

  console.log('[Groq] Non-stream request to model:', GROQ_MODEL, '(timeout:', timeoutMs + 'ms)');

  const resultPromise = client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options?.temperature ?? 0.4,
    max_tokens: options?.maxTokens ?? 4096,
    stream: false,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي')), timeoutMs)
  );

  const result = await Promise.race([resultPromise, timeoutPromise]);
  const text = result.choices[0]?.message?.content || '';

  if (!text || text.trim().length === 0) {
    console.error('[Groq] Empty response from model:', GROQ_MODEL);
    throw new Error('AI returned an empty response');
  }

  console.log('[Groq] Response length:', text.length);
  return text;
}

// -------------------------------------------------------
// Request Queue — space out Groq API calls to avoid rate limits
// -------------------------------------------------------

/**
 * Simple request queue that ensures a minimum delay between Groq API calls.
 * Groq free tier allows 30 requests/minute and 6,000 tokens/minute.
 * By spacing requests 2.5s apart, we stay well under the limit (24 req/min).
 */
const MIN_REQUEST_INTERVAL_MS = 2500; // 2.5 seconds between requests
let lastRequestTime = 0;
let requestQueue: Promise<string> | null = null;

async function waitForRateLimitSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const waitMs = MIN_REQUEST_INTERVAL_MS - elapsed;
    console.log('[Rate Limiter] Waiting', waitMs, 'ms before next Groq request');
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  lastRequestTime = Date.now();
}

// -------------------------------------------------------
// Options interface
// -------------------------------------------------------

interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  /** If true, use non-streaming mode (for very short responses like evaluate) */
  nonStream?: boolean;
}

// -------------------------------------------------------
// Core: Groq call
// -------------------------------------------------------

async function tryGroq(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
  useNonStream: boolean = false,
): Promise<string> {
  // Check circuit breaker first
  if (isGroqCircuitOpen()) {
    console.warn('[Groq] Circuit breaker is OPEN — skipping Groq');
    throw new AiProviderError('CONNECTION_ERROR', 'خدمة الذكاء الاصطناعي غير متاحة حالياً. يرجى المحاولة بعد دقيقتين', 'groq');
  }

  try {
    if (useNonStream) {
      return await groqNonStreamChat(systemPrompt, userPrompt, options, timeoutMs);
    } else {
      return await groqStreamChat(systemPrompt, userPrompt, options, timeoutMs);
    }
  } catch (error: unknown) {
    // If it's already an AiProviderError (e.g., NOT_CONFIGURED), pass it through
    if (isAiError(error)) {
      console.warn('[Groq] AiProviderError:', error.code);
      // Reset all Groq clients on connection errors
      if (error.code === 'CONNECTION_ERROR') {
        groqClientPool.clear();
      }
      throw error;
    }

    // Classify the raw error
    const classified = classifyAiError(error, 'groq');
    console.warn('[Groq] Failed:', classified.code, '-', error instanceof Error ? error.message : String(error));

    // Reset all Groq clients on connection errors
    if (classified.code === 'CONNECTION_ERROR') {
      groqClientPool.clear();
    }

    throw classified;
  }
}

// -------------------------------------------------------
// Core: AI chat (Groq only)
// -------------------------------------------------------

/**
 * Main AI chat function — Groq ONLY.
 *
 * Flow:
 *   1. Check circuit breaker
 *   2. Try Groq with streaming (or non-streaming)
 *   3. If Groq fails → throw error to user
 */
async function aiChat(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
): Promise<string> {
  const overallTimeoutMs = options?.timeoutMs ?? AI_CALL_TIMEOUT_MS;
  const useNonStream = options?.nonStream ?? false;

  // ─── Wait for rate limit slot before calling Groq ───
  await waitForRateLimitSlot();

  // ─── Try Groq ───
  try {
    const result = await tryGroq(systemPrompt, userPrompt, options, overallTimeoutMs, useNonStream);
    recordGroqSuccess();
    return result;
  } catch (groqError: unknown) {
    const groqCode = isAiError(groqError) ? groqError.code : 'UNKNOWN';
    recordGroqFailure();

    console.error('[Groq] Failed, code:', groqCode);
    throw groqError;
  }
}

// -------------------------------------------------------
// Wrapper: AI chat with retry
// -------------------------------------------------------

async function aiChatWithRetry(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions
): Promise<string> {
  const maxRetries = options?.retries ?? 2;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[AI] Retry attempt ${attempt}/${maxRetries}`);
        // Reset clients on retry in case they're in a bad state
        groqClientPool.clear();
      }

      const result = await aiChat(systemPrompt, userPrompt, options);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorCode = isAiError(error) ? error.code : 'UNKNOWN';
      console.error(`[AI] Attempt ${attempt + 1} failed, code: ${errorCode}:`, lastError.message);

      // Don't retry on these error codes — they truly won't change on retry
      // NOTE: RATE_LIMIT is NOT here — rate limits reset after ~60s, so retrying
      // with a longer backoff is worth it (especially with no fallback provider)
      const noRetryCodes: AiErrorCode[] = ['AUTH_ERROR', 'NOT_CONFIGURED'];
      if (noRetryCodes.includes(errorCode as AiErrorCode)) {
        throw lastError;
      }

      // Wait before retrying
      if (attempt < maxRetries) {
        // For rate limits, wait longer (Groq resets every ~60s)
        const backoffMs = errorCode === 'RATE_LIMIT'
          ? Math.min(30000 * Math.pow(2, attempt), 60000) // 30s, 60s for rate limits
          : Math.min(2000 * Math.pow(2, attempt), 8000);   // 2s, 4s for other errors
        console.log(`[AI] Waiting ${backoffMs}ms before retry (code: ${errorCode})...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  // If lastError is an AiProviderError, throw it directly (preserves userMessage)
  if (isAiError(lastError)) {
    throw lastError;
  }
  throw lastError || new AiProviderError('UNKNOWN', 'فشل الاتصال بالذكاء الاصطناعي بعد عدة محاولات', 'unknown');
}

// -------------------------------------------------------
// Summarization
// -------------------------------------------------------
export async function generateSummary(content: string): Promise<string> {
  // Truncate content if too large for the AI model
  const truncatedContent = truncateContent(content);

  return aiChatWithRetry(
    `أنت مساعد تعليمي متخصص في تلخيص المحتوى الأكاديمي للطلاب العرب. تقوم بتلخيص المحتوى بأسلوب تعليمي مبسط ومنظم.

قواعد التلخيص:
1. ابدأ بمقدمة مختصرة توضح الموضوع الرئيسي
2. استخدم عناوين فرعية واضحة مع ترقيم
3. استخدم نقاط مرقمة أو محددة لكل فكرة رئيسية
4. حافظ على المصطلحات العلمية والأكاديمية كما هي بدون ترجمة
5. أبرز المفاهيم الأساسية والتعريفات المهمة بخط عريض
6. رتب المعلومات من الأهم إلى الأقل أهمية
7. لا تضيف معلومات غير موجودة في النص الأصلي
8. احرص على عدم تشويه المعاني أو تحريفها
9. إذا كان النص يحتوي على معادلات أو رموز رياضية، اكتبها بشكل صحيح
10. اجعل التلخيص شاملاً بحيث يغطي جميع الأفكار الرئيسية`,
    `قم بتلخيص المحتوى التالي بأسلوب تعليمي مبسط ومنظم لطلاب الجامعات. احرص على استخراج جميع المعلومات الهامة بشكل صحيح ودقيق:\n\n${truncatedContent}`,
    { temperature: 0.3, maxTokens: 4096, timeoutMs: AI_CALL_TIMEOUT_MS, retries: 0 }
  );
}

// -------------------------------------------------------
// Refine/format transcribed (OCR-extracted) text
// -------------------------------------------------------
export async function refineTranscribedText(content: string): Promise<string> {
  const truncatedContent = truncateContent(content);

  return aiChatWithRetry(
    `أنت مساعد تعليمي متخصص في تنقيح وتنسيق النصوص المستخرجة من المستندات (PDF أو Word) للطلاب العرب. النص المقدم تم استخراجه آلياً وقد يحتوي على أخطاء.

قواعد التنقيح والتنسيق:
1. أصلح أخطاء التعرف البصري (OCR) مثل الأحرف المتداخلة أو المتكررة
2. نظم الفقرات والعناوين بشكل منطقي ومنظم
3. أضف عناوين فرعية مناسبة حيث يلزم (بخط عريض ##)
4. أزل النصوص المكررة (التي ظهرت بالخطأ مرتين)
5. حافظ على جميع المحتوى الأصلي — لا تحذف أي معلومة
6. صوب الأخطاء الإملائية الواضحة الناتجة عن الاستخراج الآلي
7. اجعل التنسيق سهل القراءة باستخدام القوائم والفقرات المنظمة
8. حافظ على المصطلحات العلمية والأكاديمية كما هي
9. لا تضيف معلومات غير موجودة في النص الأصلي
10. احرص على عدم تشويه المعاني أو تحريفها
11. إذا كان النص يحتوي على معادلات أو رموز رياضية، اكتبها بشكل صحيح`,
    `قم بتنقيح وتنسيق النص المستخرج التالي. أصلح الأخطاء ونظم الفقرات مع الحفاظ على جميع المحتوى الأصلي:\n\n${truncatedContent}`,
    { temperature: 0.2, maxTokens: 4096, timeoutMs: AI_CALL_TIMEOUT_MS, retries: 0 }
  );
}

// -------------------------------------------------------
// Quiz generation
// -------------------------------------------------------
export interface QuizQuestion {
  type: 'mcq' | 'boolean' | 'completion' | 'matching';
  question: string;
  options?: string[];
  correctAnswer?: string;
  pairs?: { key: string; value: string }[];
}

export async function generateQuiz(content: string, questionTypes?: { mcq?: number; boolean?: number; completion?: number; matching?: number }): Promise<QuizQuestion[]> {
  const mcqCount = questionTypes?.mcq ?? 2;
  const booleanCount = questionTypes?.boolean ?? 2;
  const completionCount = questionTypes?.completion ?? 2;
  const matchingCount = questionTypes?.matching ?? 2;
  const totalCount = mcqCount + booleanCount + completionCount + matchingCount;

  // Truncate content if too large
  const truncatedContent = truncateContent(content);

  const typeConfig = [];
  if (mcqCount > 0) typeConfig.push(`${mcqCount} اختيار من متعدد (mcq)`);
  if (booleanCount > 0) typeConfig.push(`${booleanCount} صح أو خطأ (boolean)`);
  if (completionCount > 0) typeConfig.push(`${completionCount} أكمل الفراغ (completion)`);
  if (matchingCount > 0) typeConfig.push(`${matchingCount} مطابقة (matching)`);

  const text = await aiChatWithRetry(
    `أنت مساعد تعليمي متخصص في إنشاء اختبارات تعليمية شاملة باللغة العربية. تقوم بإنشاء اختبارات بتنسيق JSON فقط.

يجب أن يكون الرد بتنسيق JSON فقط ويحتوي على مصفوفة من الكائنات تحت اسم "questions":
- للـ mcq: { "type": "mcq", "question": "...", "options": ["خيار1", "خيار2", "خيار3", "خيار4"], "correctAnswer": "الخيار الصحيح" }
- للـ boolean: { "type": "boolean", "question": "...", "options": ["صح", "خطأ"], "correctAnswer": "صح أو خطأ" }
- للـ completion: { "type": "completion", "question": "سؤال يحتوي على ____", "correctAnswer": "الإجابة النموذجية" }
- للـ matching: { "type": "matching", "question": "عنوان السؤال", "pairs": [{"key": "المصطلح", "value": "التعريف"}] }

قواعد إنشاء الأسئلة:
1. أنشئ ${totalCount} سؤال بالتوزيع التالي: ${typeConfig.join('، ')}
2. تأكد أن الأسئلة تغطي مختلف جوانب المحتوى ولا تركز على جزء واحد
3. اجعل الأسئلة واضحة ومحددة بدون غموض
4. في أسئلة MCQ، اجعل الخيارات متقاربة في الصحة لزيادة التحدي
5. في أسئلة Completion، ضع ____ مكان الكلمة أو العبارة المهمة
6. في أسئلة Matching، استخدم 4 أزواج على الأقل
7. تأكد أن جميع الإجابات صحيحة بناءً على المحتوى المقدم
8. احرص على صحة المعلومات العلمية في الأسئلة والإجابات
9. تأكد أن الرد JSON صالح فقط بدون أي نص إضافي
10. لا تكرر نفس السؤال أو نفس فكرة السؤال — كل سؤال يجب أن يكون فريداً ومختلفاً
11. في أسئلة MCQ، لا تكرر نفس الخيار أكثر من مرة — كل خيار يجب أن يكون مختلفاً تماماً
12. في أسئلة Matching، لا تكرر نفس العنصر في key أو value — كل عنصر يجب أن يظهر مرة واحدة فقط`,
    `بناءً على المحتوى التالي، قم بإنشاء اختبار شامل مكون من ${totalCount} سؤال بالتوزيع المحدد:\n\n${truncatedContent}`,
    { temperature: 0.5, maxTokens: 4096, timeoutMs: AI_CALL_TIMEOUT_MS, retries: 1 }
  );

  // Parse JSON from response
  let questions: QuizQuestion[];
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      questions = parsed.questions || parsed;
    } else {
      questions = JSON.parse(text);
    }
  } catch {
    throw new Error('فشل في تحليل استجابة الذكاء الاصطناعي');
  }

  if (!Array.isArray(questions)) {
    throw new Error('تنسيق الأسئلة غير صحيح');
  }

  // ─── Deduplicate questions and options ───
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
      if (uniquePairs.length < q.pairs.length) {
        console.warn('[Quiz] Deduped matching pairs from', q.pairs.length, 'to', uniquePairs.length);
      }
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

// -------------------------------------------------------
// Fill-in-the-blank evaluation (uses non-streaming for short response)
// -------------------------------------------------------
export async function evaluateCompletionAnswer(
  question: string,
  correctAnswer: string,
  studentAnswer: string
): Promise<boolean> {
  // First check for exact match (case-insensitive)
  if (studentAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim()) {
    return true;
  }

  const text = await aiChatWithRetry(
    'أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية. ترد بكلمة واحدة فقط: "true" أو "false".',
    `السؤال: ${question}\nالإجابة النموذجية: ${correctAnswer}\nإجابة الطالب: ${studentAnswer}\n\nهل إجابة الطالب صحيحة معنوياً؟`,
    { temperature: 0.1, maxTokens: 10, timeoutMs: 30000, retries: 1, nonStream: true }
  );

  return text.trim().toLowerCase().includes('true');
}

// -------------------------------------------------------
// Explain wrong answer
// -------------------------------------------------------
export async function explainWrongAnswer(
  question: string,
  correctAnswer: string,
  studentAnswer: string,
  questionType: string
): Promise<string> {
  return aiChatWithRetry(
    `أنت معلم ذكي ومتمرس. يقوم طالب بالإجابة على سؤال بشكل خاطئ، ومطلوب منك شرح سبب الخطأ وتوضيح الإجابة الصحيحة بأسلوب تعليمي مبسط ومشجع.

قواعد الشرح:
1. ابدأ بذكر أن الإجابة خاطئة بلطف
2. اشرح لماذا إجابة الطالب خاطئة (الفكرة اللي التبست عليه)
3. اشرح الإجابة الصحيحة بالتفصيل مع ذكر السبب
4. استخدم أمثلة أو تشبيهات بسيطة لو مناسب
5. كن مشجعاً ومحفزاً - الهدف التعلم مش التوبيخ
6. اجعل الشرح مختصر (3-5 أسطر) ومفيد`,
    `نوع السؤال: ${questionType}
السؤال: ${question}
الإجابة الصحيحة: ${correctAnswer}
إجابة الطالب: ${studentAnswer}

اشرح سبب الخطأ ووضح الإجابة الصحيحة:`,
    { temperature: 0.4, maxTokens: 512, timeoutMs: 30000, retries: 1 }
  );
}
