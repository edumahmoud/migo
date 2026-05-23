/**
 * AI Layer — Response Parser
 *
 * Handles parsing AI responses, especially JSON extraction
 * and malformed JSON recovery.
 */

/**
 * Extract JSON from an AI response that may contain markdown fences,
 * extra text, or other non-JSON content.
 *
 * Recovery strategies:
 * 1. Try direct JSON.parse
 * 2. Extract content between ```json ... ``` fences
 * 3. Find the outermost { ... } or [ ... ] block
 * 4. Attempt to fix common JSON errors (trailing commas, unquoted keys)
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();

  // Strategy 1: Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to other strategies
  }

  // Strategy 2: Extract from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue to other strategies
    }
  }

  // Strategy 3: Find outermost JSON object or array
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // Try to fix common errors
      const fixed = tryFixJson(objectMatch[0]);
      if (fixed !== null) return fixed as T;
    }
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      const fixed = tryFixJson(arrayMatch[0]);
      if (fixed !== null) return fixed as T;
    }
  }

  throw new Error('فشل في تحليل استجابة الذكاء الاصطناعي');
}

/**
 * Attempt to fix common JSON errors:
 * - Trailing commas before } or ]
 * - Unquoted property names
 * - Single quotes instead of double quotes
 * - Missing quotes around values
 * - Comments (// and /*)
 */
function tryFixJson(jsonStr: string): unknown | null {
  try {
    let fixed = jsonStr;

    // Remove JS-style comments
    fixed = fixed.replace(/\/\/.*$/gm, '');
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove trailing commas before } or ]
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');

    // Replace single quotes with double quotes (careful not to break content)
    // Only replace single quotes that look like they're quoting keys or values
    fixed = fixed.replace(/'([^']*)'(\s*:)/g, '"$1"$2'); // Key quotes
    fixed = fixed.replace(/:\s*'([^']*)'/g, ': "$1"');     // Value quotes

    // Add quotes around unquoted property names
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');

    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

/**
 * Parse quiz JSON from AI response with deduplication.
 *
 * IMPORTANT: Normalizes field names because AI models may return
 * either camelCase (correctAnswer) or snake_case (correct_answer).
 * Without normalization, completion questions lose their correct answer
 * when mapped to bank_questions (which uses correct_answer).
 */
export function parseQuizResponse(text: string): Array<{
  type: 'mcq' | 'boolean' | 'completion' | 'matching';
  question: string;
  options?: string[];
  correctAnswer?: string;
  pairs?: { key: string; value: string }[];
}> {
  const parsed = extractJson<Record<string, unknown>>(text);
  let questions: unknown[];

  if (Array.isArray(parsed)) {
    questions = parsed;
  } else if (parsed.questions && Array.isArray(parsed.questions)) {
    questions = parsed.questions;
  } else if (parsed.data && Array.isArray(parsed.data)) {
    questions = parsed.data;
  } else {
    throw new Error('تنسيق الأسئلة غير صحيح');
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('تنسيق الأسئلة غير صحيح');
  }

  // Normalize each question: map snake_case fields to camelCase
  return questions.map((q: any) => {
    const normalized: any = {
      type: q.type || 'mcq',
      question: q.question || '',
      options: q.options || undefined,
      correctAnswer: q.correctAnswer || q.correct_answer || undefined,
      pairs: q.pairs || undefined,
    };
    return normalized;
  }) as Array<{
    type: 'mcq' | 'boolean' | 'completion' | 'matching';
    question: string;
    options?: string[];
    correctAnswer?: string;
    pairs?: { key: string; value: string }[];
  }>;
}

/**
 * Parse evaluation JSON from AI response.
 */
export function parseEvaluationResponse(text: string): {
  isCorrect: boolean;
  reasoning: string;
} {
  try {
    const parsed = extractJson<{ isCorrect?: boolean; reasoning?: string }>(text);
    return {
      isCorrect: !!parsed.isCorrect,
      reasoning: String(parsed.reasoning || ''),
    };
  } catch {
    // Fallback: check if text contains true/false
    return {
      isCorrect: text.trim().toLowerCase().includes('true'),
      reasoning: '',
    };
  }
}
