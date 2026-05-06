/**
 * AI Service — Powered by z-ai-web-dev-sdk (GLM-4-Plus)
 *
 * Centralized service for AI interactions. Uses the Z AI platform
 * (GLM-4-Plus model) as the primary provider, with Groq as fallback.
 *
 * The Groq API key was returning 403 Forbidden, so z-ai-web-dev-sdk
 * is now the reliable primary provider.
 *
 * Used by:
 *   - /api/gemini/summary  → Text/PDF summarization
 *   - /api/gemini/quiz     → Quiz generation from content
 *   - /api/gemini/evaluate → Fill-in-the-blank answer evaluation
 */

import ZAI from 'z-ai-web-dev-sdk';

// -------------------------------------------------------
// Z AI Singleton client (z-ai-web-dev-sdk)
// -------------------------------------------------------
let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZAIClient() {
  if (!_zai) {
    _zai = await ZAI.create();
    console.log('[Z-AI] Client initialized successfully');
  }
  return _zai;
}

// -------------------------------------------------------
// Core AI chat function — uses Z AI (GLM-4-Plus)
// -------------------------------------------------------
async function aiChat(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  let zai;
  try {
    zai = await getZAIClient();
  } catch (initError) {
    console.error('[Z-AI] Client initialization failed:', initError);
    // Reset singleton so next call retries initialization
    _zai = null;
    throw new Error('فشل الاتصال بخدمة الذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
  }

  console.log('[Z-AI] Sending request...');
  let completion;
  try {
    completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options?.temperature ?? 0.4,
      max_tokens: options?.maxTokens ?? 4096,
    });
  } catch (apiError: unknown) {
    console.error('[Z-AI] API call failed:', apiError);
    const errMsg = apiError instanceof Error ? apiError.message : String(apiError);
    // Reset singleton on auth/connection errors so subsequent calls retry
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT') || errMsg.includes('fetch failed')) {
      _zai = null;
    }
    // Re-throw with user-friendly message
    if (errMsg.includes('429') || errMsg.includes('rate_limit') || errMsg.includes('quota')) {
      throw new Error('تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة');
    }
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API key')) {
      throw new Error('خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة');
    }
    throw new Error(`فشل الاتصال بالذكاء الاصطناعي: ${errMsg.substring(0, 150)}`);
  }

  const text = completion?.choices?.[0]?.message?.content;
  if (!text || text.trim().length === 0) {
    console.error('[Z-AI] Empty response received. Completion:', JSON.stringify(completion)?.substring(0, 500));
    throw new Error('AI returned an empty response');
  }

  console.log('[Z-AI] Response received, length:', text.length);
  return text;
}

// -------------------------------------------------------
// Summarization
// -------------------------------------------------------
export async function generateSummary(content: string): Promise<string> {
  return aiChat(
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

  const text = await aiChat(
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

  const text = await aiChat(
    'أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية. ترد بكلمة واحدة فقط: "true" أو "false".',
    `السؤال: ${question}\nالإجابة النموذجية: ${correctAnswer}\nإجابة الطالب: ${studentAnswer}\n\nهل إجابة الطالب صحيحة معنوياً؟`,
    { temperature: 0.1, maxTokens: 10 }
  );

  return text.trim().toLowerCase().includes('true');
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
  return aiChat(
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
}
