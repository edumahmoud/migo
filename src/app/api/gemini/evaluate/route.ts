import { NextRequest, NextResponse } from 'next/server';
import { evaluateCompletionAnswer, isAiError } from '@/lib/ai';

// Allow up to 60 seconds for AI evaluation
export const maxDuration = 60;
export const runtime = 'nodejs';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';

// Lazy-loaded Groq client for detailed evaluation (uses key pool for rotation)
const _groqClientPool = new Map<string, import('groq-sdk').default>();
let _currentKeyIdx = 0;

function getGroqClient() {
  // Collect all available API keys
  const keys: string[] = [];
  const primaryKey = process.env.GROQ_API_KEY;
  if (primaryKey) keys.push(primaryKey);
  for (let i = 2; i <= 9; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key) keys.push(key);
  }

  if (keys.length === 0) return null;

  // Round-robin key selection
  const apiKey = keys[_currentKeyIdx % keys.length];
  _currentKeyIdx = (_currentKeyIdx + 1) % keys.length;

  // Reuse client for this key if available
  const existing = _groqClientPool.get(apiKey);
  if (existing) return existing;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Groq = require('groq-sdk').default;
  const client = new Groq({ apiKey });
  _groqClientPool.set(apiKey, client);
  return client;
}

export async function POST(request: NextRequest) {
  try {
    // Content-Type and size validation
    const validationError = validateRequest(request);
    if (validationError) return validationError;

    // Rate limiting
    const rateLimit = checkRateLimit(request);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    // Authentication — use centralized auth helper
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const body = await request.json();
    const { question, correctAnswer, studentAnswer, detailed } = body;

    if (!question || !correctAnswer || !studentAnswer) {
      return NextResponse.json(
        { success: false, error: 'جميع الحقول مطلوبة' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    if (typeof question !== 'string' || typeof correctAnswer !== 'string' || typeof studentAnswer !== 'string') {
      return NextResponse.json(
        { success: false, error: 'يجب أن تكون جميع الحقول نصية' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Sanitize inputs with reasonable length limits
    const sanitizedQuestion = sanitizeString(question, 2000);
    const sanitizedCorrectAnswer = sanitizeString(correctAnswer, 1000);
    const sanitizedStudentAnswer = sanitizeString(studentAnswer, 1000);

    if (!sanitizedQuestion || !sanitizedCorrectAnswer || !sanitizedStudentAnswer) {
      return NextResponse.json(
        { success: false, error: 'حقول غير صالحة بعد التنظيف' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // First check exact match (case-insensitive)
    if (sanitizedStudentAnswer.toLowerCase().trim() === sanitizedCorrectAnswer.toLowerCase().trim()) {
      return NextResponse.json(
        {
          success: true,
          data: detailed
            ? { isCorrect: true, reasoning: 'الإجابة مطابقة تماماً للإجابة الصحيحة' }
            : { isCorrect: true }
        },
        { headers: rateLimitHeaders }
      );
    }

    // ─── Detailed mode: returns isCorrect + reasoning (for teacher AI grading) ───
    if (detailed) {
      const client = getGroqClient();
      if (!client) {
        // Fallback to standard mode if Groq is not configured
        const isCorrect = await evaluateCompletionAnswer(sanitizedQuestion, sanitizedCorrectAnswer, sanitizedStudentAnswer);
        return NextResponse.json(
          { success: true, data: { isCorrect, reasoning: isCorrect ? 'الذكاء الاصطناعي يرى أن الإجابة صحيحة معنوياً' : 'الذكاء الاصطناعي يرى أن الإجابة غير صحيحة' } },
          { headers: rateLimitHeaders }
        );
      }

      const evalPromise = (async () => {
        const result = await client.chat.completions.create({
          model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية، وتقدم تبريراً موجزاً لإجابتك. يجب أن يكون ردك بتنسيق JSON فقط: {"isCorrect": true/false, "reasoning": "تبرير موجز باللغة العربية"}' },
            { role: 'user', content: `السؤال: ${sanitizedQuestion}\nالإجابة النموذجية: ${sanitizedCorrectAnswer}\nإجابة الطالب: ${sanitizedStudentAnswer}\n\nهل إجابة الطالب صحيحة معنوياً؟ قدم تبريراً موجزاً.` },
          ],
          temperature: 0.1,
          max_tokens: 256,
        });

        const text = result.choices[0]?.message?.content || '';
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
              isCorrect: !!parsed.isCorrect,
              reasoning: String(parsed.reasoning || ''),
            };
          }
        } catch {
          // Fallback: check if text contains true/false
        }
        return {
          isCorrect: text.trim().toLowerCase().includes('true'),
          reasoning: '',
        };
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('انتهت مهلة التقييم')), 30000)
      );

      const result = await Promise.race([evalPromise, timeoutPromise]);

      return NextResponse.json(
        { success: true, data: result },
        { headers: rateLimitHeaders }
      );
    }

    // ─── Standard mode: returns isCorrect only (for student quiz evaluation) ───
    const evalPromise = evaluateCompletionAnswer(
      sanitizedQuestion,
      sanitizedCorrectAnswer,
      sanitizedStudentAnswer
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة التقييم')), 30000)
    );
    const isCorrect = await Promise.race([evalPromise, timeoutPromise]);

    return NextResponse.json(
      { success: true, data: { isCorrect } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Evaluate API] Error:', error);

    // ─── Handle AiProviderError (structured errors from our AI service) ───
    if (isAiError(error)) {
      // On rate limit, fall back to exact match (return false with fallback flag)
      if (error.code === 'RATE_LIMIT') {
        return NextResponse.json(
          { success: true, data: { isCorrect: false, fallback: true } },
          { headers: getRateLimitHeaders(0, 60000) }
        );
      }
      const statusMap: Record<string, number> = {
        'AUTH_ERROR': 503,
        'TIMEOUT': 504,
        'NOT_CONFIGURED': 503,
        'MODEL_ERROR': 503,
        'CONNECTION_ERROR': 504,
        'EMPTY_RESPONSE': 502,
        'UNKNOWN': 500,
      };
      const status = statusMap[error.code] || 500;
      console.error('[Evaluate API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    // Fallback for unstructured errors
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Evaluate API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء تقييم الإجابة');
  }
}
