/**
 * Gemini AI Service
 *
 * Centralized service for Google Gemini API interactions.
 * Used by:
 *   - /api/gemini/summary  → Text/PDF summarization
 *   - /api/gemini/quiz     → Quiz generation from content
 *   - /api/gemini/evaluate → Fill-in-the-blank answer evaluation
 *
 * Model strategy (May 2026):
 *   Primary:  gemini-2.5-flash   → latest, best quality, may have region limits
 *   Fallback: gemini-2.0-flash   → stable, widely available, good free-tier quota
 *   Fallback: gemini-2.0-flash-lite → lighter, separate quota pool
 *
 * Note: gemini-1.5-flash and gemini-1.5-flash-8b are deprecated/removed.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// -------------------------------------------------------
// Singleton client
// -------------------------------------------------------
let _genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables');
    }
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

// -------------------------------------------------------
// Model selection — try primary, fall back to alternatives
// Updated May 2026: removed deprecated 1.5 models, added 2.5
// -------------------------------------------------------
const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];

async function callWithFallback<T>(fn: (modelId: string) => Promise<T>): Promise<T> {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastError: unknown = null;

  for (const modelId of modelsToTry) {
    try {
      console.log(`[Gemini] Trying model: ${modelId}`);
      const result = await fn(modelId);
      console.log(`[Gemini] Success with model: ${modelId}`);
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Gemini] Model ${modelId} failed:`, errMsg.substring(0, 200));
      lastError = err;

      // If it's a rate limit or auth error, try the next model
      // (different models may have separate quota pools)
      if (errMsg.includes('API_KEY') || errMsg.includes('401') || errMsg.includes('403')) {
        // Auth errors won't be fixed by trying a different model
        throw err;
      }

      // 429 / quota errors: try next model (it might have its own quota)
      // "User location not supported": try next model (it might be available)
      // 404 / model not found: try next model
      // Continue trying...
    }
  }

  // All models failed — throw the last error with a helpful message
  const lastErrMsg = lastError instanceof Error ? lastError.message : String(lastError);

  if (lastErrMsg.includes('429') || lastErrMsg.includes('quota') || lastErrMsg.includes('RESOURCE_EXHAUSTED')) {
    throw new Error('تم تجاوز حصة الذكاء الاصطناعي. يرجى تفعيل الفوترة في Google AI Studio أو الانتظار حتى يتم تجديد الحصة');
  }

  if (lastErrMsg.includes('User location is not supported')) {
    throw new Error('خدمة الذكاء الاصطناعي غير متاحة في منطقتك الحالية. يرجى استخدام VPN أو التواصل مع الإدارة');
  }

  throw lastError;
}

// -------------------------------------------------------
// Summarization
// -------------------------------------------------------
export async function generateSummary(content: string): Promise<string> {
  return callWithFallback(async (modelId) => {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: modelId });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `أنت مساعد تعليمي متخصص في تلخيص المحتوى الأكاديمي للطلاب العرب. تقوم بتلخيص المحتوى بأسلوب تعليمي مبسط ومنظم باستخدام نقاط واضحة وعناوين فرعية باللغة العربية.

قم بتلخيص المحتوى التالي بأسلوب تعليمي مبسط لطلاب الجامعات. اجعل التلخيص منظماً باستخدام نقاط واضحة وعناوين فرعية. المحتوى:

${content}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
    });

    const response = result.response;
    const text = response.text();
    if (!text || text.trim().length === 0) {
      throw new Error('Gemini returned an empty summary');
    }
    return text;
  });
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

export async function generateQuiz(content: string): Promise<QuizQuestion[]> {
  return callWithFallback(async (modelId) => {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: modelId });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `أنت مساعد تعليمي متخصص في إنشاء اختبارات تعليمية. تقوم بإنشاء اختبارات شاملة باللغة العربية بتنسيق JSON فقط.

يجب أن يكون الرد بتنسيق JSON فقط ويحتوي على مصفوفة من الكائنات تحت اسم "questions":
- للـ mcq: { "type": "mcq", "question": "...", "options": ["خيار1", "خيار2", "خيار3", "خيار4"], "correctAnswer": "الخيار الصحيح" }
- للـ boolean: { "type": "boolean", "question": "...", "options": ["صح", "خطأ"], "correctAnswer": "صح أو خطأ" }
- للـ completion: { "type": "completion", "question": "سؤال يحتوي على ____", "correctAnswer": "الإجابة النموذجية" }
- للـ matching: { "type": "matching", "question": "عنوان السؤال", "pairs": [{"key": "المصطلح", "value": "التعريف"}] }

أنشئ 6 أسئلة متنوعة تغطي الأنواع الأربعة. تأكد أن الرد JSON صالح فقط بدون أي نص إضافي.

بناءً على المحتوى التالي، قم بإنشاء اختبار شامل مكون من 6 أسئلة متنوعة:

${content}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 4096,
      },
    });

    const response = result.response;
    const text = response.text();
    if (!text || text.trim().length === 0) {
      throw new Error('Gemini returned an empty quiz response');
    }

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

    return questions;
  });
}

// -------------------------------------------------------
// Fill-in-the-blank evaluation
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

  return callWithFallback(async (modelId) => {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: modelId });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية مقارنة بالإجابة النموذجية لسؤال "أكمل". لا تشدد على التطابق الحرفي، ركز على المعنى. ترد بكلمة واحدة فقط: "true" إذا كانت صحيحة، أو "false" إذا كانت خاطئة.

السؤال: ${question}
الإجابة النموذجية: ${correctAnswer}
إجابة الطالب: ${studentAnswer}

هل إجابة الطالب صحيحة معنوياً؟ رد بـ true أو false فقط.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 10,
      },
    });

    const response = result.response;
    const text = response.text().trim().toLowerCase();
    return text.includes('true');
  });
}
