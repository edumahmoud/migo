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
  // Also validate that completion/mcq/boolean questions have a correctAnswer
  return questions.map((q: any) => {
    // Normalize pairs from alternate field names the AI might use
    let pairs = q.pairs || q.matching_pairs || q.matchingPairs || q.pair_list || q.options || undefined;

    // Normalize pair object structure: map alternate key/value names
    if (Array.isArray(pairs) && pairs.length > 0) {
      pairs = pairs.map((p: any) => {
        if (!p || typeof p !== 'object') return null;
        const key = p.key ?? p.term ?? p.left ?? p.word ?? p.concept ?? p.item1 ?? p.a ?? undefined;
        const value = p.value ?? p.definition ?? p.right ?? p.meaning ?? p.description ?? p.item2 ?? p.b ?? undefined;
        if (!key || !value) return null;
        return { key: String(key).trim(), value: String(value).trim() };
      }).filter((p: any): p is { key: string; value: string } => p !== null && p.key !== '' && p.value !== '');
    }

    // If pairs ended up empty/invalid, set to undefined
    if (!Array.isArray(pairs) || pairs.length === 0) {
      pairs = undefined;
    }

    const normalized: any = {
      type: q.type || 'mcq',
      question: q.question || '',
      options: (q.type === 'matching') ? undefined : (q.options || undefined),
      correctAnswer: q.correctAnswer ?? q.correct_answer ?? undefined,
      pairs,
    };

    // Validate: completion, mcq, and boolean questions MUST have a correctAnswer
    // Without it, the student can never answer correctly
    if ((normalized.type === 'completion' || normalized.type === 'mcq' || normalized.type === 'boolean') && !normalized.correctAnswer) {
      console.warn('[Parser] Question missing correctAnswer:', normalized.type, normalized.question?.substring(0, 60));
      // For completion questions, try to extract from the question text if it contains ____
      if (normalized.type === 'completion' && normalized.question?.includes('____')) {
        // AI sometimes puts the answer in parentheses after the blank
        const answerHint = normalized.question.match(/____\s*(?:\(?\s*([^\s()]+)\s*\)?)?\s*$/);
        if (answerHint?.[1]) {
          normalized.correctAnswer = answerHint[1];
          console.warn('[Parser] Recovered correctAnswer from question text:', normalized.correctAnswer);
        }
      }
    }

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
