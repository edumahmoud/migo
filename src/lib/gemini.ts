/**
 * AI Service — Groq (Primary) + Gemini (Fallback)
 *
 * Centralized AI service with a two-provider architecture:
 *   1. Groq (Llama 3.1 70B) — PRIMARY: ultra-fast inference via LPU hardware
 *   2. Gemini — FALLBACK: used when Groq fails (rate limit, timeout, errors)
 *
 * Provider selection flow:
 *   Request → Groq → Success ✅ → Return
 *                    ↓ Failure (any error)
 *              Gemini → Success ✅ → Return
 *                        ↓ Failure
 *                    Error to user
 *
 * Key features:
 *   - Groq streaming for fast first-token delivery
 *   - Gemini streaming as reliable fallback
 *   - Automatic provider failover on any error
 *   - Content truncation to prevent oversized prompts
 *   - Comprehensive error handling with Arabic user messages
 *
 * Used by:
 *   - /api/gemini/summary  → Text/PDF summarization
 *   - /api/gemini/quiz     → Quiz generation from content
 *   - /api/gemini/evaluate → Fill-in-the-blank answer evaluation
 *   - /api/gemini/explain  → Explain wrong answers
 */

import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// -------------------------------------------------------
// Custom Error Classes for AI Provider Errors
// -------------------------------------------------------

/**
 * Error codes for AI provider errors.
 * These codes allow route handlers to properly classify errors
 * regardless of whether the message is in Arabic or English.
 */
export type AiErrorCode =
  | 'RATE_LIMIT'        // 429 / rate_limit / RESOURCE_EXHAUSTED / quota
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
  provider: 'groq' | 'gemini' | 'unknown';

  constructor(code: AiErrorCode, userMessage: string, provider: 'groq' | 'gemini' | 'unknown' = 'unknown', originalError?: unknown) {
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
 * Classify an error from an AI provider API call into an AiProviderError.
 * This function translates raw API errors (which can be English HTTP errors,
 * SDK-specific messages, or Arabic messages) into structured errors with
 * both a code and a user-friendly Arabic message.
 */
function classifyAiError(
  error: unknown,
  provider: 'groq' | 'gemini',
): AiProviderError {
  const errMsg = error instanceof Error ? error.message : String(error);

  // Rate limit patterns (English API errors)
  if (errMsg.includes('429') || errMsg.includes('rate_limit') || errMsg.includes('Rate limit') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
    return new AiProviderError('RATE_LIMIT', 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة', provider, error);
  }

  // Auth/key errors
  if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API_KEY') || errMsg.includes('API key not valid') || errMsg.includes('Incorrect API key')) {
    return new AiProviderError('AUTH_ERROR', 'خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة', provider, error);
  }

  // Timeout errors (both English and Arabic)
  if (errMsg.includes('timeout') || errMsg.includes('timed out') || errMsg.includes('ETIMEDOUT') || errMsg.includes('مهلة') || errMsg.includes('انتهت مهلة')) {
    return new AiProviderError('TIMEOUT', 'انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى', provider, error);
  }

  // Not configured
  if (errMsg.includes('NOT_CONFIGURED') || errMsg.includes('غير مفعلة') || errMsg.includes('not configured')) {
    return new AiProviderError('NOT_CONFIGURED', 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة', provider, error);
  }

  // Model errors
  if (errMsg.includes('not found') || errMsg.includes('not available') || errMsg.includes('model')) {
    return new AiProviderError('MODEL_ERROR', 'نموذج الذكاء الاصطناعي غير متاح حالياً. يرجى المحاولة لاحقاً', provider, error);
  }

  // Connection errors
  if (errMsg.includes('ECONNRESET') || errMsg.includes('socket hang up') || errMsg.includes('aborted') || errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch failed')) {
    return new AiProviderError('CONNECTION_ERROR', 'انتهت مهلة الخادم. قد يكون المحتوى كبيراً جداً، جرب تلخيص محتوى أقصر', provider, error);
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

/** Maximum content length to send to the AI (chars). FIX #4: Increased from 20K to 50K.
 *  50K chars ≈ 12.5K tokens. Both Groq (128K context) and Gemini (1M+) support this. */
const MAX_AI_CONTENT_LENGTH = 50000;

/** Overall timeout for AI API calls (milliseconds).
 *  IMPORTANT: Must leave headroom for auth + DB within Vercel's 60s limit.
 *  45s gives us 15s for auth (3-5s) + DB save (2-5s) + network overhead. */
const AI_CALL_TIMEOUT_MS = 45000; // 45 seconds

/** Groq-specific timeout (milliseconds).
 *  Groq is supposed to be ultra-fast (sub-second first token).
 *  If Groq doesn't respond within 8s, it's likely down or unreachable —
 *  fall back to Gemini quickly instead of waiting the full 45s.
 *  Reduced from 12s to 8s because Groq's LPU hardware responds in <500ms
 *  when healthy — anything over 8s means it's down. */
const GROQ_TIMEOUT_MS = 8000; // 8 seconds

/** First-token timeout for streaming calls (milliseconds).
 *  Groq typically returns first token in <500ms.
 *  Gemini typically returns first token in 3-8s.
 *  15s is a generous first-token timeout. */
const AI_FIRST_TOKEN_TIMEOUT_MS = 15000; // 15 seconds

// -------------------------------------------------------
// Groq Circuit Breaker
// -------------------------------------------------------

/**
 * Circuit breaker for Groq: if Groq fails multiple times in a row,
 * we "open" the circuit and skip Groq entirely for a cooldown period.
 * This prevents wasting 8+ seconds on every request when Groq is down.
 *
 * States:
 *   CLOSED  → Normal operation (try Groq first)
 *   OPEN    → Skip Groq entirely (go straight to Gemini)
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

/** Groq model to use. Llama 3.1 70B has 128K context window —
 *  handles 50K chars easily and produces good Arabic output. */
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';

/** Gemini model fallback list. If the first model fails, try the next. */
const GEMINI_MODEL_FALLBACK_LIST = [
  process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

// -------------------------------------------------------
// Groq Singleton client
// -------------------------------------------------------
let _groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (_groqClient) return _groqClient;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[Groq] GROQ_API_KEY not set — Groq will be skipped');
    throw new AiProviderError('NOT_CONFIGURED', 'Groq غير مفعلة حالياً. يرجى التواصل مع الإدارة', 'groq');
  }

  _groqClient = new Groq({ apiKey });
  console.log('[Groq] Client initialized successfully');
  return _groqClient;
}

// -------------------------------------------------------
// Gemini Singleton client
// -------------------------------------------------------
let _genAI: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (_genAI) return _genAI;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini] GEMINI_API_KEY not set — Gemini will be skipped');
    throw new AiProviderError('NOT_CONFIGURED', 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة', 'gemini');
  }

  _genAI = new GoogleGenerativeAI(apiKey);
  console.log('[Gemini] Client initialized successfully');
  return _genAI;
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
// Gemini: Streaming chat call
// -------------------------------------------------------

async function geminiStreamChat(
  genAI: GoogleGenerativeAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  overallTimeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: options?.temperature ?? 0.4,
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  });

  console.log('[Gemini] Starting STREAM for model:', modelName, '(timeout:', overallTimeoutMs + 'ms)');

  const startTime = Date.now();
  const streamResult = await model.generateContentStream(userPrompt);

  let firstTokenReceived = false;
  let accumulatedText = '';
  const overallDeadline = startTime + overallTimeoutMs;

  try {
    for await (const chunk of streamResult.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          console.log('[Gemini] First token received in', Date.now() - startTime, 'ms from model:', modelName);
        }
        accumulatedText += chunkText;
      }

      if (Date.now() > overallDeadline) {
        console.warn('[Gemini] Overall timeout reached after', Date.now() - startTime, 'ms. Returning partial (', accumulatedText.length, 'chars)');
        if (accumulatedText.trim().length > 100) {
          return accumulatedText + '\n\n[... تم قطع الاستجابة بسبب انتهاء المهلة ...]';
        }
        throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
      }
    }
  } catch (streamError: unknown) {
    const errMsg = streamError instanceof Error ? streamError.message : String(streamError);

    if (accumulatedText.trim().length > 100 && !errMsg.includes('انتهت مهلة')) {
      console.warn('[Gemini] Stream error after', Date.now() - startTime, 'ms, returning partial (', accumulatedText.length, 'chars):', errMsg);
      return accumulatedText;
    }

    if (!firstTokenReceived) {
      const elapsed = Date.now() - startTime;
      if (elapsed > AI_FIRST_TOKEN_TIMEOUT_MS) {
        console.warn('[Gemini] First-token timeout (', elapsed, 'ms) for model:', modelName);
        throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
      }
    }

    throw streamError;
  }

  if (!accumulatedText || accumulatedText.trim().length === 0) {
    console.error('[Gemini] Empty streaming response from model:', modelName);
    throw new Error('AI returned an empty response');
  }

  console.log('[Gemini] Stream complete from model:', modelName, ', length:', accumulatedText.length, ', time:', Date.now() - startTime, 'ms');
  return accumulatedText;
}

// -------------------------------------------------------
// Gemini: Non-streaming chat call
// -------------------------------------------------------

async function geminiNonStreamChat(
  genAI: GoogleGenerativeAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: options?.temperature ?? 0.4,
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  });

  console.log('[Gemini] Non-stream request to model:', modelName, '(timeout:', timeoutMs + 'ms)');

  const resultPromise = model.generateContent(userPrompt);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي')), timeoutMs)
  );

  const result = await Promise.race([resultPromise, timeoutPromise]);
  const text = result.response.text();

  if (!text || text.trim().length === 0) {
    console.error('[Gemini] Empty response from model:', modelName);
    throw new Error('AI returned an empty response');
  }

  console.log('[Gemini] Response from model:', modelName, ', length:', text.length);
  return text;
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
// Core: Groq call (primary provider)
// -------------------------------------------------------

async function tryGroq(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
  useNonStream: boolean = false,
): Promise<string> {
  try {
    if (useNonStream) {
      return await groqNonStreamChat(systemPrompt, userPrompt, options, timeoutMs);
    } else {
      return await groqStreamChat(systemPrompt, userPrompt, options, timeoutMs);
    }
  } catch (error: unknown) {
    // If it's already an AiProviderError (e.g., NOT_CONFIGURED), pass it through
    if (isAiError(error)) {
      console.warn('[Groq] AiProviderError:', error.code, '— falling back to Gemini');
      // Reset Groq client on connection errors
      if (error.code === 'CONNECTION_ERROR') {
        _groqClient = null;
      }
      throw error;
    }

    // Classify the raw error
    const classified = classifyAiError(error, 'groq');
    console.warn('[Groq] Failed:', classified.code, '-', error instanceof Error ? error.message : String(error), '— falling back to Gemini');

    // Reset Groq client on connection errors
    if (classified.code === 'CONNECTION_ERROR') {
      _groqClient = null;
    }

    throw classified;
  }
}

// -------------------------------------------------------
// Core: Gemini call (fallback provider)
// -------------------------------------------------------

async function tryGemini(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
  useNonStream: boolean = false,
): Promise<string> {
  let genAI: GoogleGenerativeAI;
  try {
    genAI = getGeminiClient();
  } catch (initError) {
    // initError is already an AiProviderError from getGeminiClient
    if (isAiError(initError)) {
      throw initError;
    }
    throw new AiProviderError('NOT_CONFIGURED', 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة', 'gemini', initError);
  }

  // Try each Gemini model in the fallback list
  let lastError: AiProviderError | null = null;
  const overallStartTime = Date.now();

  for (let modelIndex = 0; modelIndex < GEMINI_MODEL_FALLBACK_LIST.length; modelIndex++) {
    const modelName = GEMINI_MODEL_FALLBACK_LIST[modelIndex];
    const isFirstModel = modelIndex === 0;

    const elapsedSoFar = Date.now() - overallStartTime;
    const remainingTime = Math.max(timeoutMs - elapsedSoFar, 10000);
    const modelTimeout = isFirstModel ? timeoutMs : Math.min(remainingTime, 15000);

    if (!isFirstModel && remainingTime < 10000) {
      console.warn('[Gemini] Not enough time left (', remainingTime, 'ms) to try fallback model:', modelName);
      break;
    }

    try {
      console.log('[Gemini] Trying model:', modelName, '(timeout:', modelTimeout + 'ms)');

      let result: string;
      if (useNonStream) {
        result = await geminiNonStreamChat(genAI, modelName, systemPrompt, userPrompt, options, modelTimeout);
      } else {
        result = await geminiStreamChat(genAI, modelName, systemPrompt, userPrompt, options, modelTimeout);
      }

      return result;
    } catch (modelError: unknown) {
      // Classify the error using our centralized classifier
      const classified = isAiError(modelError) ? modelError : classifyAiError(modelError, 'gemini');
      lastError = classified;
      console.warn('[Gemini] Model', modelName, 'failed:', classified.code, '-', classified.userMessage);

      // Reset singleton on auth/connection errors
      if (classified.code === 'AUTH_ERROR' || classified.code === 'CONNECTION_ERROR') {
        _genAI = null;
      }

      // Don't fall back to other models for these errors — they apply to all models
      if (classified.code === 'RATE_LIMIT' || classified.code === 'AUTH_ERROR' || classified.code === 'TIMEOUT' || classified.code === 'NOT_CONFIGURED') {
        throw classified;
      }

      // For model-specific errors (MODEL_ERROR, EMPTY_RESPONSE, UNKNOWN), try the next model
      console.warn('[Gemini] Model', modelName, 'unavailable, trying next fallback...');
      continue;
    }
  }

  console.error('[Gemini] All models failed. Last error:', lastError?.message);
  throw lastError || new AiProviderError('UNKNOWN', 'فشل الاتصال بالذكاء الاصطناعي بعد تجربة جميع النماذج', 'gemini');
}

// -------------------------------------------------------
// Core: AI chat with provider failover (Groq → Gemini)
// -------------------------------------------------------

/**
 * Main AI chat function — Groq ONLY (Gemini disabled).
 *
 * Flow:
 *   1. Try Groq directly with full timeout
 *   2. If Groq fails → throw error to user
 *
 * Gemini is completely disabled. No fallback.
 * If Groq is rate-limited or down, the user gets an error immediately.
 */
async function aiChatWithFailover(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
): Promise<string> {
  const overallTimeoutMs = options?.timeoutMs ?? AI_CALL_TIMEOUT_MS;
  const useNonStream = options?.nonStream ?? false;
  const startTime = Date.now();

  // ─── Try Groq ONLY — no Gemini fallback ───
  try {
    const result = await tryGroq(systemPrompt, userPrompt, options, overallTimeoutMs, useNonStream);
    recordGroqSuccess();
    return result;
  } catch (groqError: unknown) {
    const groqCode = isAiError(groqError) ? groqError.code : 'UNKNOWN';
    recordGroqFailure();

    console.error('[Groq] Failed after', Date.now() - startTime, 'ms, code:', groqCode);
    throw groqError;
  }
}

// -------------------------------------------------------
// Wrapper: AI chat with retry + failover
// -------------------------------------------------------

async function aiChatWithRetry(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions
): Promise<string> {
  const maxRetries = options?.retries ?? 1;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[AI] Retry attempt ${attempt}/${maxRetries}`);
        // Reset clients on retry in case they're in a bad state
        _groqClient = null;
        _genAI = null;
      }

      const result = await aiChatWithFailover(systemPrompt, userPrompt, options);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorCode = isAiError(error) ? error.code : 'UNKNOWN';
      console.error(`[AI] Attempt ${attempt + 1} failed, code: ${errorCode}:`, lastError.message);

      // Don't retry on these error codes — they won't change on retry
      const noRetryCodes: AiErrorCode[] = ['RATE_LIMIT', 'AUTH_ERROR', 'NOT_CONFIGURED', 'TIMEOUT', 'EMPTY_RESPONSE'];
      if (noRetryCodes.includes(errorCode as AiErrorCode)) {
        throw lastError;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const backoffMs = Math.min(2000 * Math.pow(2, attempt), 8000);
        console.log(`[AI] Waiting ${backoffMs}ms before retry...`);
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
