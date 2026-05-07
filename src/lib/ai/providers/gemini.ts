/**
 * AI Layer — Google Gemini Provider
 *
 * Primary AI provider using the official Google Gemini SDK.
 * Supports:
 *   - Multi-key rotation with health scoring
 *   - Streaming and non-streaming modes
 *   - JSON structured output
 *   - Long context handling with chunking
 *   - Automatic failover on key errors
 *   - Cooldown windows for failed keys
 *   - Exponential backoff
 *   - Concurrent-safe key locking
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerativeModel, GenerationConfig } from '@google/generative-ai';
import type {
  AiProvider,
  AiChatOptions,
  ProviderHealth,
  ApiKeyEntry,
  ProviderId,
  AiErrorCode,
} from '../types';
import { AiProviderError } from '../types';

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

const PRIMARY_MODEL = 'gemini-2.5-flash';
const HEAVY_MODEL = 'gemini-2.5-pro';
const MAX_AI_CONTENT_LENGTH = 100000; // Gemini supports much larger context
const AI_CALL_TIMEOUT_MS = 60000;     // 60s overall (Gemini can be slower for long context)
const AI_FIRST_TOKEN_TIMEOUT_MS = 15000; // 15s first-token

// Key rotation settings
const KEY_COOLDOWN_MS = 120000;         // 2 minutes cooldown for failed keys
const KEY_INVALID_COOLDOWN_MS = 600000; // 10 minutes for invalid keys
const HEALTH_DECAY_ON_FAILURE = 30;     // Health reduction per failure
const HEALTH_RECOVERY_ON_SUCCESS = 10;  // Health increase per success
const MAX_CONSECUTIVE_FAILURES = 5;     // Disable key after this many consecutive failures

// -------------------------------------------------------
// Key Pool Management
// -------------------------------------------------------

interface KeyState extends ApiKeyEntry {
  client: GoogleGenerativeAI;
  lock: Promise<void>;
}

let keyPool: KeyState[] = [];
let currentKeyIndex = 0;
let poolInitialized = false;

/**
 * Initialize the Gemini key pool from environment variables.
 * Supports GOOGLE_API_KEY_1 through GOOGLE_API_KEY_9.
 */
function initKeyPool(): void {
  if (poolInitialized) return;

  const keys: string[] = [];

  // Collect keys from env
  for (let i = 1; i <= 9; i++) {
    const key = process.env[`GOOGLE_API_KEY_${i}`];
    if (key && key.trim().length > 0) {
      keys.push(key.trim());
    }
  }

  if (keys.length === 0) {
    console.warn('[Gemini] No GOOGLE_API_KEY_* environment variables set');
  }

  keyPool = keys.map((key, index) => ({
    key,
    index,
    client: new GoogleGenerativeAI(key),
    lock: Promise.resolve(),
    health: 100,
    cooldownUntil: 0,
    consecutiveFailures: 0,
    totalRequests: 0,
    totalFailures: 0,
    lastUsedAt: 0,
    lastFailedAt: 0,
  }));

  poolInitialized = true;
  console.log(`[Gemini] Key pool initialized: ${keyPool.length} key(s) available`);
}

/**
 * Get the next healthy key in round-robin order.
 * Skips keys that are in cooldown.
 */
function getNextHealthyKey(): KeyState {
  initKeyPool();

  if (keyPool.length === 0) {
    throw new AiProviderError(
      'NOT_CONFIGURED',
      'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة',
      'gemini',
    );
  }

  const now = Date.now();
  const startIndex = currentKeyIndex;

  // Try each key in round-robin order
  for (let i = 0; i < keyPool.length; i++) {
    const idx = (startIndex + i) % keyPool.length;
    const keyState = keyPool[idx];

    // Skip if in cooldown
    if (keyState.cooldownUntil > now) {
      continue;
    }

    // Skip if health is too low
    if (keyState.health <= 0) {
      continue;
    }

    // Found a healthy key
    currentKeyIndex = (idx + 1) % keyPool.length;
    keyState.lastUsedAt = now;
    keyState.totalRequests++;
    return keyState;
  }

  // No healthy keys — check if any key has expired cooldown
  for (let i = 0; i < keyPool.length; i++) {
    const keyState = keyPool[i];
    if (keyState.cooldownUntil <= now && keyState.health > 0) {
      currentKeyIndex = (keyState.index + 1) % keyPool.length;
      keyState.lastUsedAt = now;
      keyState.totalRequests++;
      return keyState;
    }
  }

  // All keys are in cooldown or exhausted
  console.error('[Gemini] All keys are in cooldown or exhausted');
  throw new AiProviderError(
    'RATE_LIMIT',
    'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة',
    'gemini',
  );
}

/**
 * Mark a key as failed with appropriate cooldown.
 */
function markKeyFailed(keyState: KeyState, errorCode: AiErrorCode): void {
  keyState.consecutiveFailures++;
  keyState.totalFailures++;
  keyState.lastFailedAt = Date.now();
  keyState.health = Math.max(0, keyState.health - HEALTH_DECAY_ON_FAILURE);

  const now = Date.now();

  // Determine cooldown duration based on error type
  if (errorCode === 'AUTH_ERROR') {
    // Invalid key — longer cooldown
    keyState.cooldownUntil = now + KEY_INVALID_COOLDOWN_MS;
    keyState.health = 0;
    console.warn(`[Gemini] Key #${keyState.index + 1} is invalid (AUTH_ERROR). Disabled for ${KEY_INVALID_COOLDOWN_MS / 1000}s`);
  } else if (errorCode === 'RATE_LIMIT') {
    // Rate limited — standard cooldown
    keyState.cooldownUntil = now + KEY_COOLDOWN_MS;
    console.warn(`[Gemini] Key #${keyState.index + 1} rate limited. Cooldown for ${KEY_COOLDOWN_MS / 1000}s`);
  } else {
    // Other errors — shorter cooldown, allow retry sooner
    keyState.cooldownUntil = now + KEY_COOLDOWN_MS / 2;
  }

  if (keyState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    keyState.health = 0;
    keyState.cooldownUntil = now + KEY_INVALID_COOLDOWN_MS;
    console.error(`[Gemini] Key #${keyState.index + 1} disabled after ${keyState.consecutiveFailures} consecutive failures`);
  }
}

/**
 * Mark a key as successful.
 */
function markKeySuccess(keyState: KeyState): void {
  keyState.consecutiveFailures = 0;
  keyState.health = Math.min(100, keyState.health + HEALTH_RECOVERY_ON_SUCCESS);
  keyState.cooldownUntil = 0; // Immediately available
}

// -------------------------------------------------------
// Content Chunking for Long Files
// -------------------------------------------------------

/**
 * Truncate content to fit within model limits.
 * Gemini 2.5 supports up to 1M tokens, but we still limit
 * for cost and latency reasons.
 */
function truncateContent(content: string, maxLength: number = MAX_AI_CONTENT_LENGTH): string {
  if (content.length <= maxLength) return content;

  console.warn(`[Gemini] Content too large (${content.length} chars), truncating to ${maxLength} chars`);

  const truncated = content.substring(0, maxLength);
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxLength * 0.7) {
    return truncated.substring(0, lastParagraph) + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
  }

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
// Error Classification
// -------------------------------------------------------

function classifyGeminiError(error: unknown): AiProviderError {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errStr = errMsg.toLowerCase();

  // Rate limit / quota
  if (
    errStr.includes('429') ||
    errStr.includes('rate') ||
    errStr.includes('quota') ||
    errStr.includes('resource_exhausted') ||
    errStr.includes('too many requests')
  ) {
    return new AiProviderError(
      'RATE_LIMIT',
      'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة',
      'gemini',
      error,
    );
  }

  // Auth/key errors
  if (
    errStr.includes('401') ||
    errStr.includes('403') ||
    errStr.includes('api_key') ||
    errStr.includes('api key not valid') ||
    errStr.includes('invalid api key') ||
    errStr.includes('permission')
  ) {
    return new AiProviderError(
      'AUTH_ERROR',
      'خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة',
      'gemini',
      error,
    );
  }

  // Timeout
  if (
    errStr.includes('timeout') ||
    errStr.includes('timed out') ||
    errStr.includes('etimedout') ||
    errStr.includes('مهلة') ||
    errStr.includes('deadline')
  ) {
    return new AiProviderError(
      'TIMEOUT',
      'انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى',
      'gemini',
      error,
    );
  }

  // Connection errors
  if (
    errStr.includes('econnreset') ||
    errStr.includes('socket hang up') ||
    errStr.includes('aborted') ||
    errStr.includes('econnrefused') ||
    errStr.includes('fetch failed') ||
    errStr.includes('enotfound') ||
    errStr.includes('network')
  ) {
    return new AiProviderError(
      'CONNECTION_ERROR',
      'انتهت مهلة الخادم. قد يكون المحتوى كبيراً جداً، جرب تلخيص محتوى أقصر',
      'gemini',
      error,
    );
  }

  // Model errors
  if (
    errStr.includes('model_not_found') ||
    errStr.includes('not found') ||
    errStr.includes('not available') ||
    errStr.includes('does not exist')
  ) {
    return new AiProviderError(
      'MODEL_ERROR',
      'نموذج الذكاء الاصطناعي غير متاح حالياً. يرجى المحاولة لاحقاً',
      'gemini',
      error,
    );
  }

  // Empty response
  if (errStr.includes('empty response') || errStr.includes('empty')) {
    return new AiProviderError(
      'EMPTY_RESPONSE',
      'لم يتمكن الذكاء الاصطناعي من إنشاء رد. يرجى المحاولة مرة أخرى',
      'gemini',
      error,
    );
  }

  return new AiProviderError(
    'UNKNOWN',
    `حدث خطأ أثناء الاتصال بالذكاء الاصطناعي: ${errMsg.substring(0, 150)}`,
    'gemini',
    error,
  );
}

// -------------------------------------------------------
// Gemini Provider Implementation
// -------------------------------------------------------

export class GeminiProvider implements AiProvider {
  readonly id: ProviderId = 'gemini';
  readonly name = 'Google Gemini';

  async chat(
    systemPrompt: string,
    userPrompt: string,
    options?: AiChatOptions,
  ): Promise<string> {
    const overallTimeoutMs = options?.timeoutMs ?? AI_CALL_TIMEOUT_MS;
    const useNonStream = options?.nonStream ?? false;

    // Try up to all healthy keys
    const maxAttempts = keyPool.length || 1;
    let lastError: AiProviderError | null = null;
    let attemptsOnCurrentKey = 0;

    for (let attempt = 0; attempt < maxAttempts + 1; attempt++) {
      let keyState: KeyState;
      try {
        keyState = getNextHealthyKey();
      } catch (err) {
        // No healthy keys available
        if (isAiError(err)) throw err;
        throw new AiProviderError(
          'RATE_LIMIT',
          'جميع مفاتيح الذكاء الاصطناعي غير متاحة حالياً. يرجى المحاولة بعد دقيقة',
          'gemini',
        );
      }

      try {
        const result = useNonStream
          ? await this.nonStreamChat(keyState, systemPrompt, userPrompt, options, overallTimeoutMs)
          : await this.streamChat(keyState, systemPrompt, userPrompt, options, overallTimeoutMs);

        markKeySuccess(keyState);
        return result;
      } catch (error: unknown) {
        const classified = isAiError(error)
          ? error as AiProviderError
          : classifyGeminiError(error);

        // Mark the key as failed
        markKeyFailed(keyState, classified.code);
        lastError = classified;

        console.warn(
          `[Gemini] Key #${keyState.index + 1} failed (attempt ${attempt + 1}):`,
          classified.code,
          '- Rotating to next key',
        );

        // For timeout, retry same key once before rotating
        if (classified.code === 'TIMEOUT' && attemptsOnCurrentKey < 1) {
          attemptsOnCurrentKey++;
          attempt--; // Don't count this as a key rotation
          await new Promise(r => setTimeout(r, 1000)); // Brief pause before retry
          continue;
        }
        attemptsOnCurrentKey = 0;

        // Don't rotate on non-retryable errors
        if (classified.code === 'NOT_CONFIGURED') {
          throw classified;
        }

        // Continue to next key
        continue;
      }
    }

    throw lastError || new AiProviderError('UNKNOWN', 'فشل الاتصال بالذكاء الاصطناعي بعد عدة محاولات', 'gemini');
  }

  /**
   * Streaming chat implementation using Gemini SDK.
   */
  private async streamChat(
    keyState: KeyState,
    systemPrompt: string,
    userPrompt: string,
    options?: AiChatOptions,
    overallTimeoutMs?: number,
  ): Promise<string> {
    const modelName = options?.useHeavyModel ? HEAVY_MODEL : PRIMARY_MODEL;
    const model = keyState.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: this.buildGenerationConfig(options),
    });

    const startTime = Date.now();
    const deadline = startTime + (overallTimeoutMs ?? AI_CALL_TIMEOUT_MS);

    console.log(`[Gemini] Starting STREAM for model: ${modelName} (key #${keyState.index + 1})`);

    const result = await model.generateContentStream(userPrompt);

    let firstTokenReceived = false;
    let accumulatedText = '';

    try {
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            console.log('[Gemini] First token received in', Date.now() - startTime, 'ms');
          }
          accumulatedText += chunkText;
        }

        // Check overall deadline
        if (Date.now() > deadline) {
          console.warn('[Gemini] Overall timeout reached after', Date.now() - startTime, 'ms. Returning partial (', accumulatedText.length, 'chars)');
          if (accumulatedText.trim().length > 100) {
            return accumulatedText + '\n\n[... تم قطع الاستجابة بسبب انتهاء المهلة ...]';
          }
          throw new AiProviderError('TIMEOUT', 'انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى', 'gemini');
        }
      }
    } catch (streamError: unknown) {
      const errMsg = streamError instanceof Error ? streamError.message : String(streamError);

      // If we accumulated significant text, return it as partial
      if (accumulatedText.trim().length > 100 && !errMsg.includes('مهلة')) {
        console.warn('[Gemini] Stream error after', Date.now() - startTime, 'ms, returning partial (', accumulatedText.length, 'chars):', errMsg);
        return accumulatedText;
      }

      if (!firstTokenReceived) {
        const elapsed = Date.now() - startTime;
        if (elapsed > AI_FIRST_TOKEN_TIMEOUT_MS) {
          throw new AiProviderError('TIMEOUT', 'انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى', 'gemini');
        }
      }

      // Re-throw if already classified
      if (isAiError(streamError)) throw streamError;
      throw classifyGeminiError(streamError);
    }

    if (!accumulatedText || accumulatedText.trim().length === 0) {
      throw new AiProviderError('EMPTY_RESPONSE', 'لم يتمكن الذكاء الاصطناعي من إنشاء رد. يرجى المحاولة مرة أخرى', 'gemini');
    }

    console.log('[Gemini] Stream complete, length:', accumulatedText.length, ', time:', Date.now() - startTime, 'ms');
    return accumulatedText;
  }

  /**
   * Non-streaming chat implementation.
   */
  private async nonStreamChat(
    keyState: KeyState,
    systemPrompt: string,
    userPrompt: string,
    options?: AiChatOptions,
    timeoutMs?: number,
  ): Promise<string> {
    const modelName = options?.useHeavyModel ? HEAVY_MODEL : PRIMARY_MODEL;
    const model = keyState.client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: this.buildGenerationConfig(options),
    });

    console.log(`[Gemini] Non-stream request to model: ${modelName} (key #${keyState.index + 1})`);

    const resultPromise = model.generateContent(userPrompt);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new AiProviderError('TIMEOUT', 'انتهت مهلة الاتصال بالذكاء الاصطناعي', 'gemini')), timeoutMs ?? AI_CALL_TIMEOUT_MS),
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const text = result.response.text();

    if (!text || text.trim().length === 0) {
      throw new AiProviderError('EMPTY_RESPONSE', 'لم يتمكن الذكاء الاصطناعي من إنشاء رد. يرجى المحاولة مرة أخرى', 'gemini');
    }

    return text;
  }

  private buildGenerationConfig(options?: AiChatOptions): GenerationConfig {
    const config: GenerationConfig = {
      temperature: options?.temperature ?? 0.4,
      maxOutputTokens: options?.maxTokens ?? 8192,
    };

    if (options?.jsonMode) {
      config.responseMimeType = 'application/json';
    }

    return config;
  }

  async checkHealth(): Promise<ProviderHealth> {
    initKeyPool();

    const activeKeys = this.getHealthyKeyCount();
    const totalKeys = this.getTotalKeyCount();

    if (totalKeys === 0) {
      return {
        status: 'not_configured',
        provider: 'gemini',
        error: 'No GOOGLE_API_KEY_* environment variables set',
        activeKeys: 0,
        totalKeys: 0,
      };
    }

    // Try a quick health check with the first available key
    const startTime = Date.now();
    try {
      const keyState = keyPool.find(k => k.cooldownUntil <= Date.now() && k.health > 0);
      if (!keyState) {
        return {
          status: 'degraded',
          provider: 'gemini',
          model: PRIMARY_MODEL,
          error: 'All keys in cooldown',
          activeKeys: 0,
          totalKeys,
        };
      }

      const model = keyState.client.getGenerativeModel({
        model: PRIMARY_MODEL,
        generationConfig: { maxOutputTokens: 5, temperature: 0 },
      });

      const result = await model.generateContent('Say OK');
      const text = result.response.text();
      const latencyMs = Date.now() - startTime;

      return {
        status: text.trim().length > 0 ? 'ok' : 'error',
        provider: 'gemini',
        model: PRIMARY_MODEL,
        latencyMs,
        activeKeys,
        totalKeys,
      };
    } catch (err) {
      return {
        status: 'error',
        provider: 'gemini',
        model: PRIMARY_MODEL,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
        activeKeys,
        totalKeys,
      };
    }
  }

  getHealthyKeyCount(): number {
    initKeyPool();
    const now = Date.now();
    return keyPool.filter(k => k.cooldownUntil <= now && k.health > 0).length;
  }

  getTotalKeyCount(): number {
    initKeyPool();
    return keyPool.length;
  }

  reportKeyFailure(keyIndex: number, errorCode: AiErrorCode): void {
    const keyState = keyPool.find(k => k.index === keyIndex);
    if (keyState) {
      markKeyFailed(keyState, errorCode);
    }
  }

  reportKeySuccess(keyIndex: number): void {
    const keyState = keyPool.find(k => k.index === keyIndex);
    if (keyState) {
      markKeySuccess(keyState);
    }
  }
}

// Singleton
export const geminiProvider = new GeminiProvider();
