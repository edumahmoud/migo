/**
 * AI Layer — OpenRouter Fallback Provider
 *
 * Tertiary provider using OpenRouter for free model access.
 * Used as last resort before graceful failure.
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

// Free models on OpenRouter (no cost)
const OPENROUTER_MODELS = [
  'google/gemma-2-9b-it:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
];
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 45000;
const MAX_AI_CONTENT_LENGTH = 30000; // Free models have smaller context

// -------------------------------------------------------
// OpenRouter Provider Implementation
// -------------------------------------------------------

export class OpenRouterProvider implements AiProvider {
  readonly id: ProviderId = 'openrouter';
  readonly name = 'OpenRouter';

  private getApiKey(): string | null {
    return process.env.OPENROUTER_API_KEY || null;
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    options?: AiChatOptions,
  ): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new AiProviderError('NOT_CONFIGURED', 'OpenRouter API غير مفعّل', 'openrouter');
    }

    const truncatedUser = this.truncateContent(userPrompt);
    const timeoutMs = options?.timeoutMs ?? OPENROUTER_TIMEOUT_MS;

    // Try each model in order until one works
    let lastError: AiProviderError | null = null;

    for (const model of OPENROUTER_MODELS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(OPENROUTER_BASE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://migo.app',
            'X-Title': 'Migo Educational Platform',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: truncatedUser },
            ],
            temperature: options?.temperature ?? 0.4,
            max_tokens: options?.maxTokens ?? 4096,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          const err = this.classifyHttpError(response.status, errorText);
          lastError = err;

          // If rate limited, try next model
          if (response.status === 429) continue;
          // If model not found, try next model
          if (response.status === 404) continue;

          throw err;
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content || '';

        if (!text || text.trim().length === 0) {
          lastError = new AiProviderError('EMPTY_RESPONSE', 'لم يتمكن الذكاء الاصطناعي من إنشاء رد', 'openrouter');
          continue;
        }

        return text;
      } catch (error: unknown) {
        if (isAiError(error)) {
          lastError = error;
          continue;
        }
        lastError = this.classifyError(error);
        continue;
      }
    }

    throw lastError || new AiProviderError('UNKNOWN', 'فشل الاتصال بالذكاء الاصطناعي عبر OpenRouter', 'openrouter');
  }

  private classifyHttpError(status: number, _errorText: string): AiProviderError {
    if (status === 429) {
      return new AiProviderError('RATE_LIMIT', 'تم تجاوز حد الطلبات', 'openrouter');
    }
    if (status === 401 || status === 403) {
      return new AiProviderError('AUTH_ERROR', 'خطأ في تكوين OpenRouter', 'openrouter');
    }
    return new AiProviderError('UNKNOWN', `خطأ في الخادم (${status})`, 'openrouter');
  }

  private classifyError(error: unknown): AiProviderError {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStr = errMsg.toLowerCase();

    if (errStr.includes('abort') || errStr.includes('timeout')) {
      return new AiProviderError('TIMEOUT', 'انتهت مهلة الاتصال', 'openrouter', error);
    }
    if (errStr.includes('econnreset') || errStr.includes('network') || errStr.includes('fetch')) {
      return new AiProviderError('CONNECTION_ERROR', 'خطأ في الاتصال بالخادم', 'openrouter', error);
    }

    return new AiProviderError('UNKNOWN', `حدث خطأ: ${errMsg.substring(0, 100)}`, 'openrouter', error);
  }

  private truncateContent(content: string): string {
    if (content.length <= MAX_AI_CONTENT_LENGTH) return content;
    return content.substring(0, MAX_AI_CONTENT_LENGTH) + '\n\n[... تم تقليص المحتوى ...]';
  }

  async checkHealth(): Promise<ProviderHealth> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return { status: 'not_configured', provider: 'openrouter', error: 'OPENROUTER_API_KEY not set' };
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
        provider: 'openrouter',
        model: OPENROUTER_MODELS[0],
        latencyMs: Date.now() - startTime,
        activeKeys: 1,
        totalKeys: 1,
      };
    } catch (err) {
      return {
        status: 'error',
        provider: 'openrouter',
        model: OPENROUTER_MODELS[0],
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
    // Single key — no rotation needed
  }

  reportKeySuccess(_keyIndex: number): void {
    // No-op
  }
}

export const openrouterProvider = new OpenRouterProvider();
