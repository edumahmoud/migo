/**
 * AI Layer — Public API (Backward Compatible)
 *
 * This module re-exports everything from the new AI architecture
 * while maintaining backward compatibility with the old `@/lib/ai` imports.
 *
 * All route files that import from `@/lib/ai` will continue to work
 * without any changes.
 */

// Re-export types
export type { AiErrorCode, AiProviderError as AiProviderErrorType, QuizQuestion } from './types';
export { AiProviderError, isAiError } from './types';

// Re-export unified functions (same signatures as before)
export { generateSummary, refineTranscribedText, generateQuiz, evaluateCompletionAnswer, explainWrongAnswer } from './provider-manager';

// Export new APIs
export { evaluateCompletionDetailed, checkAllProvidersHealth, getAiLogs, getAiStats } from './provider-manager';

// Export cache utilities
export { generateCacheHash, contentHash, clearAllCache, getCacheStats } from './cache';
