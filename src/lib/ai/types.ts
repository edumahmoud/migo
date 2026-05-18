/**
 * AI Layer — Type Definitions
 *
 * Central type definitions for the multi-provider AI system.
 * All providers implement the same AiProvider interface,
 * enabling transparent failover and key rotation.
 */

// -------------------------------------------------------
// Error Types
// -------------------------------------------------------

/**
 * Error codes for AI provider errors.
 * These codes allow route handlers to properly classify errors
 * regardless of whether the message is in Arabic or English.
 */
export type AiErrorCode =
  | 'RATE_LIMIT'        // 429 / rate_limit / quota / RESOURCE_EXHAUSTED
  | 'AUTH_ERROR'        // 401 / 403 / API_KEY invalid
  | 'TIMEOUT'           // timeout / timed out
  | 'NOT_CONFIGURED'    // API key not set
  | 'MODEL_ERROR'       // model not found / not available
  | 'CONNECTION_ERROR'  // ECONNRESET / socket hang up / aborted
  | 'EMPTY_RESPONSE'    // AI returned empty
  | 'MALFORMED_JSON'    // JSON parse failed (recoverable)
  | 'UNKNOWN';          // Unclassified error

/** Provider identifiers used in error tracking and observability */
export type ProviderId = 'gemini' | 'cerebras' | 'openrouter' | 'unknown';

/**
 * Custom error class for AI provider errors.
 * Contains both a machine-readable `code` and an Arabic `userMessage`.
 */
export class AiProviderError extends Error {
  code: AiErrorCode;
  userMessage: string;
  provider: ProviderId;

  constructor(
    code: AiErrorCode,
    userMessage: string,
    provider: ProviderId = 'unknown',
    originalError?: unknown,
  ) {
    super(`[${code}] ${userMessage}`);
    this.name = 'AiProviderError';
    this.code = code;
    this.userMessage = userMessage;
    this.provider = provider;
    if (originalError instanceof Error) {
      this.cause = originalError;
    }
  }
}

/** Type guard: check if an error is an AiProviderError */
export function isAiError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError;
}

// -------------------------------------------------------
// Provider Interface
// -------------------------------------------------------

/** Options for an AI chat request */
export interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  /** If true, use non-streaming mode (for very short responses like evaluate) */
  nonStream?: boolean;
  /** Request a JSON structured output */
  jsonMode?: boolean;
  /** Use heavy model (e.g., gemini-2.5-pro) instead of fast model */
  useHeavyModel?: boolean;
  /** Cache key hint for the caching layer */
  cacheKeyHint?: string;
}

/** Result of a provider health check */
export interface ProviderHealth {
  status: 'ok' | 'error' | 'not_configured' | 'degraded';
  provider: ProviderId;
  model?: string;
  error?: string;
  latencyMs?: number;
  activeKeys?: number;
  totalKeys?: number;
}

/** A single API key with its health metadata */
export interface ApiKeyEntry {
  key: string;
  index: number;
  health: number;         // 0–100 score
  cooldownUntil: number;  // timestamp when cooldown ends (0 = available)
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
  lastUsedAt: number;
  lastFailedAt: number;
}

/** Provider interface that all AI providers must implement */
export interface AiProvider {
  readonly id: ProviderId;
  readonly name: string;

  /** Send a chat request (streaming or non-streaming) */
  chat(
    systemPrompt: string,
    userPrompt: string,
    options?: AiChatOptions,
  ): Promise<string>;

  /** Health check */
  checkHealth(): Promise<ProviderHealth>;

  /** Get number of healthy/available keys */
  getHealthyKeyCount(): number;

  /** Get total number of keys (including cooling-down) */
  getTotalKeyCount(): number;

  /** Mark a key as failed (triggers cooldown) */
  reportKeyFailure(keyIndex: number, errorCode: AiErrorCode): void;

  /** Mark current operation as successful (resets key health) */
  reportKeySuccess(keyIndex: number): void;
}

// -------------------------------------------------------
// Quiz Types
// -------------------------------------------------------

export interface QuizQuestion {
  type: 'mcq' | 'boolean' | 'completion' | 'matching';
  question: string;
  options?: string[];
  correctAnswer?: string;
  pairs?: { key: string; value: string }[];
}

// -------------------------------------------------------
// Cache Types
// -------------------------------------------------------

export interface CacheEntry {
  hash: string;
  result: string;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  provider: ProviderId;
}

// -------------------------------------------------------
// Observability Types
// -------------------------------------------------------

export interface AiLogEntry {
  timestamp: number;
  provider: ProviderId;
  keyIndex: number;
  operation: string;
  cacheHit: boolean;
  latencyMs: number;
  tokenUsage?: number;
  retries: number;
  rotationReason?: string;
  errorCode?: AiErrorCode;
  success: boolean;
}

// -------------------------------------------------------
// Unified AI Service Interface
// -------------------------------------------------------

export interface AiService {
  generateSummary(content: string): Promise<string>;
  refineTranscribedText(content: string): Promise<string>;
  generateQuiz(content: string, questionTypes?: {
    mcq?: number;
    boolean?: number;
    completion?: number;
    matching?: number;
  }): Promise<QuizQuestion[]>;
  evaluateCompletionAnswer(
    question: string,
    correctAnswer: string,
    studentAnswer: string,
  ): Promise<boolean>;
  explainWrongAnswer(
    question: string,
    correctAnswer: string,
    studentAnswer: string,
    questionType: string,
    studentName?: string,
  ): Promise<string>;
}
