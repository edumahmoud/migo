/**
 * AI Service — Powered by Google Gemini API
 *
 * Centralized service for AI interactions using Google Generative AI.
 * Uses the GEMINI_API_KEY environment variable.
 *
 * Key features:
 *   - Built-in timeout for all AI calls
 *   - Content truncation to prevent oversized prompts
 *   - Automatic retry with exponential backoff
 *   - Comprehensive error handling with Arabic user messages
 *
 * Used by:
 *   - /api/gemini/summary  → Text/PDF summarization
 *   - /api/gemini/quiz     → Quiz generation from content
 *   - /api/gemini/evaluate → Fill-in-the-blank answer evaluation
 *   - /api/gemini/explain  → Explain wrong answers
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

/** Maximum content length to send to the AI (chars). ~30K chars ≈ 8K tokens,
 *  well within Gemini context window. */
const MAX_AI_CONTENT_LENGTH = 30000;

/** Default timeout for AI API calls (milliseconds) */
const AI_CALL_TIMEOUT_MS = 90000; // 90 seconds — Gemini can be slow for large content

/** Timeout for AI client initialization (milliseconds) */
const AI_INIT_TIMEOUT_MS = 10000; // 10 seconds

// -------------------------------------------------------
// Google Gemini Singleton client
// -------------------------------------------------------
let _genAI: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (_genAI) return _genAI;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[Gemini] GEMINI_API_KEY environment variable is not set');
    throw new Error('خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة');
  }

  _genAI = new GoogleGenerativeAI(apiKey);
  console.log('[Gemini] Client initialized successfully');
  return _genAI;
}

// -------------------------------------------------------
// Helper: truncate content to fit within model limits
// -------------------------------------------------------

/**
 * Truncate content to a reasonable size for the AI model.
 * Tries to truncate at paragraph/sentence boundaries to preserve meaning.
 */
function truncateContent(content: string, maxLength: number = MAX_AI_CONTENT_LENGTH): string {
  if (content.length <= maxLength) return content;

  console.warn(`[Gemini] Content too large (${content.length} chars), truncating to ${maxLength} chars`);

  // Try to truncate at a paragraph boundary
  const truncated = content.substring(0, maxLength);
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxLength * 0.7) {
    return truncated.substring(0, lastParagraph) + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
  }

  // Try to truncate at a sentence boundary
  const lastSentence = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('؟'),
    truncated.lastIndexOf('?'),
  );
  if (lastSentence > maxLength * 0.7) {
    return truncated.substring(0, lastSentence + 1) + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
  }

  return truncated + '\n\n[... تم تقليص المحتوى ليتناسب مع حد المعالجة ...]';
}

// -------------------------------------------------------
// Helper: call AI with built-in timeout and retry
// -------------------------------------------------------

interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
}

async function aiChatWithRetry(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions
): Promise<string> {
  const maxRetries = options?.retries ?? 1;
  const timeoutMs = options?.timeoutMs ?? AI_CALL_TIMEOUT_MS;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Gemini] Retry attempt ${attempt}/${maxRetries}`);
        // On retry, reset the client in case it's in a bad state
        _genAI = null;
      }

      const result = await aiChatInternal(systemPrompt, userPrompt, options, timeoutMs);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[Gemini] Attempt ${attempt + 1} failed:`, lastError.message);

      // Don't retry on rate limits or auth errors
      if (
        lastError.message.includes('429') ||
        lastError.message.includes('rate_limit') ||
        lastError.message.includes('RESOURCE_EXHAUSTED') ||
        lastError.message.includes('401') ||
        lastError.message.includes('403') ||
        lastError.message.includes('API key') ||
        lastError.message.includes('API_KEY')
      ) {
        throw lastError;
      }

      // Don't retry on empty response (likely a model issue, not transient)
      if (lastError.message.includes('empty response')) {
        throw lastError;
      }

      // Don't retry on "not configured" errors
      if (lastError.message.includes('غير مفعلة') || lastError.message.includes('not configured')) {
        throw lastError;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const backoffMs = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`[Gemini] Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error('فشل الاتصال بالذكاء الاصطناعي بعد عدة محاولات');
}

// -------------------------------------------------------
// Core AI chat function — uses Google Gemini
// -------------------------------------------------------
async function aiChatInternal(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS
): Promise<string> {
  let genAI;
  try {
    genAI = getGeminiClient();
  } catch (initError) {
    console.error('[Gemini] Client initialization failed:', initError);
    const errMsg = initError instanceof Error ? initError.message : String(initError);
    if (errMsg.includes('غير مفعلة') || errMsg.includes('not configured')) {
      throw new Error('خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة');
    }
    throw new Error('فشل الاتصال بخدمة الذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
  }

  console.log('[Gemini] Sending request... (timeout:', timeoutMs + 'ms)');

  // Use Gemini 1.5 Flash for fast responses (or fallback to gemini-pro)
  const modelName = 'gemini-2.0-flash';
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: options?.temperature ?? 0.4,
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  });

  // Race the API call against a timeout
  const resultPromise = model.generateContent(userPrompt);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي')), timeoutMs)
  );

  let result;
  try {
    result = await Promise.race([resultPromise, timeoutPromise]);
  } catch (apiError: unknown) {
    console.error('[Gemini] API call failed:', apiError);
    const errMsg = apiError instanceof Error ? apiError.message : String(apiError);

    // Reset singleton on auth/connection errors so subsequent calls retry
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API_KEY') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT') || errMsg.includes('fetch failed')) {
      _genAI = null;
    }

    // Re-throw with user-friendly Arabic messages
    if (errMsg.includes('429') || errMsg.includes('rate_limit') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
      throw new Error('تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة');
    }
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API_KEY') || errMsg.includes('API key not valid') || errMsg.includes('Incorrect API key')) {
      throw new Error('خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة');
    }
    if (errMsg.includes('مهلة') || errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT') || errMsg.includes('timed out') || errMsg.includes('ECONNRESET')) {
      throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
    }
    if (errMsg.includes('not found') || errMsg.includes('not available') || errMsg.includes('model')) {
      throw new Error('نموذج الذكاء الاصطناعي غير متاح حالياً. يرجى المحاولة لاحقاً');
    }
    throw new Error(`فشل الاتصال بالذكاء الاصطناعي: ${errMsg.substring(0, 150)}`);
  }

  const response = result.response;
  const text = response.text();

  if (!text || text.trim().length === 0) {
    console.error('[Gemini] Empty response received');
    throw new Error('AI returned an empty response');
  }

  console.log('[Gemini] Response received, length:', text.length);
  return text;
}

// -------------------------------------------------------
// Backward-compatible wrapper
// -------------------------------------------------------
async function aiChat(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  return aiChatWithRetry(systemPrompt, userPrompt, {
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    timeoutMs: AI_CALL_TIMEOUT_MS,
    retries: 1,
  });
}

// -------------------------------------------------------
// Summarization
// -------------------------------------------------------
export async function generateSummary(content: string): Promise<string> {
  // Truncate content if too large for the AI model
  const truncatedContent = truncateContent(content);

  return aiChatWithRetry(
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
    `قم بتلخيص المحتوى التالي بأسلوب تعليمي مبسط ومنظم لطلاب الجامعات. احرص على استخراج جميع المعلومات الهامة بشكل صحيح ودقيق:\n\n${truncatedContent}`,
    { temperature: 0.3, maxTokens: 4096, timeoutMs: AI_CALL_TIMEOUT_MS, retries: 1 }
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

  // Truncate content if too large
  const truncatedContent = truncateContent(content);

  const typeConfig = [];
  if (mcqCount > 0) typeConfig.push(`${mcqCount} اختيار من متعدد (mcq)`);
  if (booleanCount > 0) typeConfig.push(`${booleanCount} صح أو خطأ (boolean)`);
  if (completionCount > 0) typeConfig.push(`${completionCount} أكمل الفراغ (completion)`);
  if (matchingCount > 0) typeConfig.push(`${matchingCount} مطابقة (matching)`);

  const text = await aiChatWithRetry(
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
    `بناءً على المحتوى التالي، قم بإنشاء اختبار شامل مكون من ${totalCount} سؤال بالتوزيع المحدد:\n\n${truncatedContent}`,
    { temperature: 0.5, maxTokens: 4096, timeoutMs: AI_CALL_TIMEOUT_MS, retries: 1 }
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

  const text = await aiChatWithRetry(
    'أنت مصحح اختبارات ذكي. تقرر ما إذا كانت إجابة الطالب صحيحة من الناحية المعنوية. ترد بكلمة واحدة فقط: "true" أو "false".',
    `السؤال: ${question}\nالإجابة النموذجية: ${correctAnswer}\nإجابة الطالب: ${studentAnswer}\n\nهل إجابة الطالب صحيحة معنوياً؟`,
    { temperature: 0.1, maxTokens: 10, timeoutMs: 30000, retries: 1 }
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
  return aiChatWithRetry(
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
    { temperature: 0.4, maxTokens: 512, timeoutMs: 30000, retries: 1 }
  );
}
