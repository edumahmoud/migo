/**
 * AI Service — Legacy Compatibility Layer
 *
 * This file re-exports everything from the new AI architecture
 * at /lib/ai/index.ts, maintaining backward compatibility
 * with all existing imports from `@/lib/ai`.
 *
 * All route files can continue using:
 *   import { generateSummary, isAiError } from '@/lib/ai';
 */

export {
  AiProviderError,
  isAiError,
  generateSummary,
  refineTranscribedText,
  generateQuiz,
  evaluateCompletionAnswer,
  explainWrongAnswer,
  evaluateCompletionDetailed,
  checkAllProvidersHealth,
  getAiLogs,
  getAiStats,
} from './ai/index';

export type { AiErrorCode, QuizQuestion } from './ai/types';
