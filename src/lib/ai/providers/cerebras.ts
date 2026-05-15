/**
 * AI Layer — Cerebras Fallback Provider
 *
 * Secondary provider using Cerebras API for fast inference.
 * Used as fallback when all Gemini keys are unavailable.
 */

import type {
  AiProvider,
  AiChatOptions,
  ProviderHealth,
  ProviderId,
  AiErrorCode,
} from '../types';
import { AiProviderError, isAiError } from '../types';

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

const CEREBRAS_MODEL = 'llama-3.3-70b';
const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_TIMEOUT_MS = 45000;
const MAX_AI_CONTENT_LENGTH = 50000;

// -------------------------------------------------------
// Cerebras Provider Implementation
// -------------------------------------------------------

export class CerebrasProvider implements AiProvider {
  readonly id: ProviderId = 'cerebras';
  readonly name = 'Cerebras';

  private getApiKey(): string | null {
    return process.env.CEREBRAS_API_KEY || null;
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    options?: AiChatOptions,
  ): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new AiProviderError('NOT_CONFIGURED', 'Cerebras API غير مفعّل', 'cerebras');
    }

    const truncatedUser = this.truncateContent(userPrompt);
    const timeoutMs = options?.timeoutMs ?? CEREBRAS_TIMEOUT_MS;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(CEREBRAS_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: CEREBRAS_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: truncatedUser },
          ],
          temperature: options?.temperature ?? 0.4,
          max_tokens: options?.maxTokens ?? 4096,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw this.classifyHttpError(response.status, errorText);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content || '';

      if (!text || text.trim().length === 0) {
        throw new AiProviderError('EMPTY_RESPONSE', 'لم يتمكن الذكاء الاصطناعي من إنشاء رد', 'cerebras');
      }

      return text;
    } catch (error: unknown) {
      if (isAiError(error)) throw error;
      throw this.classifyError(error);
    }
  }

  private classifyHttpError(status: number, _errorText: string): AiProviderError {
    if (status === 429) {
      return new AiProviderError('RATE_LIMIT', 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة', 'cerebras');
    }
    if (status === 401 || status === 403) {
      return new AiProviderError('AUTH_ERROR', 'خطأ في تكوين خدمة الذكاء الاصطناعي', 'cerebras');
    }
    if (status === 404) {
      return new AiProviderError('MODEL_ERROR', 'نموذج الذكاء الاصطناعي غير متاح حالياً', 'cerebras');
    }
    return new AiProviderError('UNKNOWN', `خطأ في الخادم (${status})`, 'cerebras');
  }

  private classifyError(error: unknown): AiProviderError {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStr = errMsg.toLowerCase();

    if (errStr.includes('abort') || errStr.includes('timeout')) {
      return new AiProviderError('TIMEOUT', 'انتهت مهلة الاتصال بالذكاء الاصطناعي', 'cerebras', error);
    }
    if (errStr.includes('econnreset') || errStr.includes('network') || errStr.includes('fetch')) {
      return new AiProviderError('CONNECTION_ERROR', 'خطأ في الاتصال بالخادم', 'cerebras', error);
    }

    return new AiProviderError('UNKNOWN', `حدث خطأ: ${errMsg.substring(0, 100)}`, 'cerebras', error);
  }

  private truncateContent(content: string): string {
    if (content.length <= MAX_AI_CONTENT_LENGTH) return content;
    return content.substring(0, MAX_AI_CONTENT_LENGTH) + '\n\n[... تم تقليص المحتوى ...]';
  }

  async checkHealth(): Promise<ProviderHealth> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return { status: 'not_configured', provider: 'cerebras', error: 'CEREBRAS_API_KEY not set' };
    }

    try {
      const startTime = Date.now();
      const result = await this.chat(
        'Reply with OK only.',
        'Say OK',
        { maxTokens: 5, temperature: 0, timeoutMs: 10000 },
      );
      return {
        status: result.trim().length > 0 ? 'ok' : 'error',
        provider: 'cerebras',
        model: CEREBRAS_MODEL,
        latencyMs: Date.now() - startTime,
        activeKeys: 1,
        totalKeys: 1,
      };
    } catch (err) {
      return {
        status: 'error',
        provider: 'cerebras',
        model: CEREBRAS_MODEL,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getHealthyKeyCount(): number {
    return this.getApiKey() ? 1 : 0;
  }

  getTotalKeyCount(): number {
    return this.getApiKey() ? 1 : 0;
  }

  reportKeyFailure(_keyIndex: number, _errorCode: AiErrorCode): void {
    // Cerebras has a single key — no rotation needed
  }

  reportKeySuccess(_keyIndex: number): void {
    // No-op
  }
}

export const cerebrasProvider = new CerebrasProvider();
