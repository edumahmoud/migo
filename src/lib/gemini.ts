/**
 * AI Service — Powered by Groq
 *
 * Centralized service for AI interactions using Groq's ultra-fast inference.
 * Used by:
 *   - /api/gemini/summary  → Text/PDF summarization
 *   - /api/gemini/quiz     → Quiz generation from content
 *   - /api/gemini/evaluate → Fill-in-the-blank answer evaluation
 *
 * Model strategy:
 *   Primary:  llama-3.3-70b-versatile → best quality for Arabic
 *   Fallback: qwen/qwen3-32b          → excellent understanding & writing
 *   Fallback: llama-3.1-8b-instant    → ultra-fast, lightweight
 *
 * Groq is 10-100x faster than Gemini/OpenAI for inference, making it ideal
 * for real-time educational tools like summarization and quiz generation.
 */

import Groq from 'groq-sdk';

// -------------------------------------------------------
// Singleton client
// -------------------------------------------------------
let _groq: Groq | null = null;

function getClient(): Groq {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not configured in environment variables');
    }
    _groq = new Groq({ apiKey });
  }
  return _groq;
}

// -------------------------------------------------------
// Model selection — try primary, fall back to alternatives
// -------------------------------------------------------
const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODELS = ['qwen/qwen3-32b', 'llama-3.1-8b-instant'];

async function callWithFallback<T>(fn: (modelId: string) => Promise<T>): Promise<T> {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastError: unknown = null;

  for (const modelId of modelsToTry) {
    try {
      console.log(`[Groq] Trying model: ${modelId}`);
      const result = await fn(modelId);
      console.log(`[Groq] Success with model: ${modelId}`);
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Groq] Model ${modelId} failed:`, errMsg.substring(0, 200));
      lastError = err;

      // Auth errors won't be fixed by trying a different model
      if (errMsg.includes('401') || errMsg.includes('invalid_api_key') || errMsg.includes('Incorrect API key')) {
        throw err;
      }

      // 403 Forbidden — account issue, won't be fixed by model change
      if (errMsg.includes('403') && !errMsg.includes('model')) {
        throw err;
      }

      // Rate limit / 429 — try next model (different quota pool)
      // 404 / model not found — try next model
      // 503 / overloaded — try next model
      // Continue trying...
    }
  }

  // All models failed — throw the last error with a helpful message
  const lastErrMsg = lastError instanceof Error ? lastError.message : String(lastError);

  if (lastErrMsg.includes('429') || lastErrMsg.includes('rate_limit') || lastErrMsg.includes('Rate limit')) {
    throw new Error('تم تجاوز حصة الذكاء الاصطناعي. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى');
  }

  if (lastErrMsg.includes('403') || lastErrMsg.includes('Forbidden')) {
    throw new Error('مفتاح API غير صالح أو الحساب معطل. يرجى التواصل مع الإدارة');
  }

  if (lastErrMsg.includes('insufficient_quota') || lastErrMsg.includes('billing')) {
    throw new Error('حصة الذكاء الاصطناعي نفدت. يرجى التواصل مع الإدارة لتحديث الباقة');
  }

  throw lastError;
}

// -------------------------------------------------------
// Helper: Call Groq Chat API with a system + user prompt
// -------------------------------------------------------
async function groqChat(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const groq = getClient();
  const completion = await groq.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options?.temperature ?? 0.4,
    max_tokens: options?.maxTokens ?? 4096,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text || text.trim().length === 0) {
    throw new Error('AI returned an empty response');
  }
  return text;
}

// -------------------------------------------------------
// Summarization
// -------------------------------------------------------
export async function generateSummary(content: string): Promise<string> {
  return callWithFallback(async (modelId) => {
    return groqChat(
      modelId,
      'أنت مساعد تعليمي متخصص في تلخيص المحتوى الأكاديمي للطلاب العرب. تقوم بتلخيص المحتوى بأسلوب تعليمي مبسط ومنظم باستخدام نقاط واضحة وعناوين فرعية باللغة العربية. اجعل التلخيص منظماً باستخدام نقاط واضحة وعناوين فرعية.',
      `قم بتلخيص المحتوى التالي بأسلوب تعليمي مبسط لطلاب الجامعات:\n\n${content}`,
      { temperature: 0.4, maxTokens: 4096 }
    );
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
    const text = await groqChat(
      modelId,
      `أنت مساعد تعليمي متخصص في إنشاء اختبارات تعليمية. تقوم بإنشاء اختبارات شاملة باللغة العربية بتنسيق JSON فقط.

يجب أن يكون الرد بتنسيق JSON فقط ويحتوي على مصفوفة من الكائنات تحت اسم "questions":
- للـ mcq: { "type": "mcq", "question": "...", "options": ["خيار1", "خيار2", "خيار3", "خيار4"], "correctAnswer": "الخيار الصحيح" }
- للـ boolean: { "type": "boolean", "question": "...", "options": ["صح", "خطأ"], "correctAnswer": "صح أو خطأ" }
- للـ completion: { "type": "completion", "question": "سؤال يحتوي على ____", "correctAnswer": "الإجابة النموذجية" }
- للـ matching: { "type": "matching", "question": "عنوان السؤال", "pairs": [{"key": "المصطلح", "value": "التعريف"}] }

أنشئ 6 أسئلة متنوعة تغطي الأنواع الأربعة. تأكد أن الرد JSON صالح فقط بدون أي نص إضافي.`,
      `بناءً على المحتوى التالي، قم بإنشاء اختبار شامل مكون من 6 أسئلة متنوعة:\n\n${content}`,
      { temperature: 0.6, maxTokens: 4096 }
    );

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
    const text = await groqChat(
      modelId,
      'أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية. ترد بكلمة واحدة فقط: "true" أو "false".',
      `السؤال: ${question}\nالإجابة النموذجية: ${correctAnswer}\nإجابة الطالب: ${studentAnswer}\n\nهل إجابة الطالب صحيحة معنوياً؟`,
      { temperature: 0.1, maxTokens: 10 }
    );

    return text.trim().toLowerCase().includes('true');
  });
}
