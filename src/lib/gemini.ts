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

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

      // Rate limit / 429 — wait briefly before trying next model (different quota pool)
      if (errMsg.includes('429') || errMsg.includes('rate_limit') || errMsg.includes('Rate limit')) {
        console.log('[Groq] Rate limited, waiting 3s before trying next model...');
        await sleep(3000);
      }

      // 503 / overloaded — wait briefly
      if (errMsg.includes('503') || errMsg.includes('overloaded') || errMsg.includes('service_unavailable')) {
        console.log('[Groq] Service overloaded, waiting 2s before trying next model...');
        await sleep(2000);
      }

      // 404 / model not found — try next model immediately
      // Continue trying...
    }
  }

  // ─── All models failed on first pass — retry ONCE with longer delay ───
  const lastErrMsg = lastError instanceof Error ? lastError.message : String(lastError);
  const isRateLimited = lastErrMsg.includes('429') || lastErrMsg.includes('rate_limit') || lastErrMsg.includes('Rate limit');

  if (isRateLimited) {
    console.log('[Groq] All models rate limited, waiting 10s then retrying...');
    await sleep(10000);

    // Retry with the fastest model (llama-3.1-8b-instant) as it's most likely to succeed
    const retryModel = 'llama-3.1-8b-instant';
    try {
      console.log(`[Groq] Retry with ${retryModel}...`);
      const result = await fn(retryModel);
      console.log(`[Groq] Retry succeeded with ${retryModel}`);
      return result;
    } catch (retryErr) {
      const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      console.warn(`[Groq] Retry also failed:`, retryErrMsg.substring(0, 200));

      if (retryErrMsg.includes('429') || retryErrMsg.includes('rate_limit')) {
        throw new Error('تم تجاوز حصة الذكاء الاصطناعي. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى');
      }
      throw retryErr;
    }
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
      `أنت مساعد تعليمي متخصص في تلخيص المحتوى الأكاديمي للطلاب العرب. تقوم بتلخيص المحتوى بأسلوب تعليمي مبسط ومنظم.

قواعد التلخيص:
1. ابدأ بمقدمة مختصرة توضح الموضوع الرئيسي
2. استخدم عناوين فرعية واضحة مع ترقيم
3. استخدم نقاط مرقمة أو محددة لكل فكرة رئيسية
4. حافظ على المصطلحات العلمية والأكاديمية كما هي بدون ترجمة
5. أبرز المفاهيم الأساسية والتعريفات المهمة بخط عريض
6. رتب المعلومات من الأهم إلى الأقل أهمية
7. لا تضيف معلومات غير موجودة في النص الأصلي
8. احرص على عدم تشويه المعاني أو تحريفها
9. إذا كان النص يحتوي على معادلات أو رموز رياضية، اكتبها بشكل صحيح
10. اجعل التلخيص شاملاً بحيث يغطي جميع الأفكار الرئيسية`,
      `قم بتلخيص المحتوى التالي بأسلوب تعليمي مبسط ومنظم لطلاب الجامعات. احرص على استخراج جميع المعلومات الهامة بشكل صحيح ودقيق:\n\n${content}`,
      { temperature: 0.3, maxTokens: 4096 }
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

export async function generateQuiz(content: string, questionTypes?: { mcq?: number; boolean?: number; completion?: number; matching?: number }): Promise<QuizQuestion[]> {
  return callWithFallback(async (modelId) => {
    // Build question type configuration
    const mcqCount = questionTypes?.mcq ?? 2;
    const booleanCount = questionTypes?.boolean ?? 2;
    const completionCount = questionTypes?.completion ?? 2;
    const matchingCount = questionTypes?.matching ?? 2;
    const totalCount = mcqCount + booleanCount + completionCount + matchingCount;

    const typeConfig = [];
    if (mcqCount > 0) typeConfig.push(`${mcqCount} اختيار من متعدد (mcq)`);
    if (booleanCount > 0) typeConfig.push(`${booleanCount} صح أو خطأ (boolean)`);
    if (completionCount > 0) typeConfig.push(`${completionCount} أكمل الفراغ (completion)`);
    if (matchingCount > 0) typeConfig.push(`${matchingCount} مطابقة (matching)`);

    const text = await groqChat(
      modelId,
      `أنت مساعد تعليمي متخصص في إنشاء اختبارات تعليمية شاملة باللغة العربية. تقوم بإنشاء اختبارات بتنسيق JSON فقط.

يجب أن يكون الرد بتنسيق JSON فقط ويحتوي على مصفوفة من الكائنات تحت اسم "questions":
- للـ mcq: { "type": "mcq", "question": "...", "options": ["خيار1", "خيار2", "خيار3", "خيار4"], "correctAnswer": "الخيار الصحيح" }
- للـ boolean: { "type": "boolean", "question": "...", "options": ["صح", "خطأ"], "correctAnswer": "صح أو خطأ" }
- للـ completion: { "type": "completion", "question": "سؤال يحتوي على ____", "correctAnswer": "الإجابة النموذجية" }
- للـ matching: { "type": "matching", "question": "عنوان السؤال", "pairs": [{"key": "المصطلح", "value": "التعريف"}] }

قواعد إنشاء الأسئلة:
1. أنشئ ${totalCount} سؤال بالتوزيع التالي: ${typeConfig.join('، ')}
2. تأكد أن الأسئلة تغطي مختلف جوانب المحتوى ولا تركز على جزء واحد
3. اجعل الأسئلة واضحة ومحددة بدون غموض
4. في أسئلة MCQ، اجعل الخيارات متقاربة في الصحة لزيادة التحدي
5. في أسئلة Completion، ضع ____ مكان الكلمة أو العبارة المهمة
6. في أسئلة Matching، استخدم 4 أزواج على الأقل
7. تأكد أن جميع الإجابات صحيحة بناءً على المحتوى المقدم
8. احرص على صحة المعلومات العلمية في الأسئلة والإجابات
9. تأكد أن الرد JSON صالح فقط بدون أي نص إضافي
10. لا تكرر نفس السؤال أو نفس فكرة السؤال — كل سؤال يجب أن يكون فريداً ومختلفاً
11. في أسئلة MCQ، لا تكرر نفس الخيار أكثر من مرة — كل خيار يجب أن يكون مختلفاً تماماً
12. في أسئلة Matching، لا تكرر نفس العنصر في key أو value — كل عنصر يجب أن يظهر مرة واحدة فقط`,
      `بناءً على المحتوى التالي، قم بإنشاء اختبار شامل مكون من ${totalCount} سؤال بالتوزيع المحدد:\n\n${content}`,
      { temperature: 0.5, maxTokens: 4096 }
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

    // ─── Deduplicate questions and options ───
    // Remove questions with identical text (case-insensitive)
    const seenQuestions = new Set<string>();
    const dedupedQuestions: QuizQuestion[] = [];

    for (const q of questions) {
      const normalizedQ = q.question.trim().toLowerCase();
      if (seenQuestions.has(normalizedQ)) {
        console.warn('[Quiz] Skipping duplicate question:', q.question);
        continue;
      }
      seenQuestions.add(normalizedQ);

      // For MCQ, deduplicate options
      if (q.type === 'mcq' && q.options) {
        const uniqueOptions = [...new Set(q.options)];
        if (uniqueOptions.length < q.options.length) {
          console.warn('[Quiz] Deduped MCQ options from', q.options.length, 'to', uniqueOptions.length);
        }
        q.options = uniqueOptions;
        // If correctAnswer was removed, skip this question
        if (q.correctAnswer && !uniqueOptions.includes(q.correctAnswer)) {
          console.warn('[Quiz] Skipping question with missing correctAnswer after dedup');
          seenQuestions.delete(normalizedQ);
          continue;
        }
      }

      // For matching, deduplicate keys and values
      if (q.type === 'matching' && q.pairs) {
        const seenKeys = new Set<string>();
        const seenValues = new Set<string>();
        const uniquePairs = q.pairs.filter(p => {
          if (seenKeys.has(p.key) || seenValues.has(p.value)) return false;
          seenKeys.add(p.key);
          seenValues.add(p.value);
          return true;
        });
        if (uniquePairs.length < q.pairs.length) {
          console.warn('[Quiz] Deduped matching pairs from', q.pairs.length, 'to', uniquePairs.length);
        }
        q.pairs = uniquePairs;
        if (q.pairs.length < 2) {
          console.warn('[Quiz] Skipping matching question with too few unique pairs');
          seenQuestions.delete(normalizedQ);
          continue;
        }
      }

      dedupedQuestions.push(q);
    }

    return dedupedQuestions;
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

// -------------------------------------------------------
// Explain wrong answer
// -------------------------------------------------------
export async function explainWrongAnswer(
  question: string,
  correctAnswer: string,
  studentAnswer: string,
  questionType: string
): Promise<string> {
  return callWithFallback(async (modelId) => {
    return groqChat(
      modelId,
      `أنت معلم ذكي ومتمرس. يقوم طالب بالإجابة على سؤال بشكل خاطئ، ومطلوب منك شرح سبب الخطأ وتوضيح الإجابة الصحيحة بأسلوب تعليمي مبسط ومشجع.

قواعد الشرح:
1. ابدأ بذكر أن الإجابة خاطئة بلطف
2. اشرح لماذا إجابة الطالب خاطئة (الفكرة اللي التبست عليه)
3. اشرح الإجابة الصحيحة بالتفصيل مع ذكر السبب
4. استخدم أمثلة أو تشبيهات بسيطة لو مناسب
5. كن مشجعاً ومحفزاً - الهدف التعلم مش التوبيخ
6. اجعل الشرح مختصر (3-5 أسطر) ومفيد`,
      `نوع السؤال: ${questionType}
السؤال: ${question}
الإجابة الصحيحة: ${correctAnswer}
إجابة الطالب: ${studentAnswer}

اشرح سبب الخطأ ووضح الإجابة الصحيحة:`,
      { temperature: 0.4, maxTokens: 512 }
    );
  });
}
