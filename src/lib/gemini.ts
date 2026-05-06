/**
 * AI Service — Powered by Google Gemini API
 *
 * Centralized service for AI interactions using Google Generative AI.
 * Uses the GEMINI_API_KEY environment variable.
 *
 * Key features:
 *   - STREAMING by default — prevents timeout on long AI responses
 *   - Two-tier timeout: first-token (15s) + overall (45s)
 *   - Smart model fallback (shorter timeout for fallback models)
 *   - Content truncation to prevent oversized prompts
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

/** Maximum content length to send to the AI (chars). FIX #4: Increased from 20K to 50K.
 *  50K chars ≈ 12.5K tokens. The AI model supports up to 1M token input,
 *  and with streaming + 45s timeout, most 50K char summaries complete in time.
 *  Previous 20K limit was too restrictive for academic documents. */
const MAX_AI_CONTENT_LENGTH = 50000;

/** Overall timeout for AI API calls (milliseconds).
 *  IMPORTANT: Must leave headroom for auth + DB within Vercel's 60s limit.
 *  45s gives us 15s for auth (3-5s) + DB save (2-5s) + network overhead. */
const AI_CALL_TIMEOUT_MS = 45000; // 45 seconds

/** First-token timeout for streaming calls (milliseconds).
 *  If no token arrives within this time, the AI is overloaded or unreachable.
 *  A short first-token timeout provides fast feedback instead of waiting 45s. */
const AI_FIRST_TOKEN_TIMEOUT_MS = 15000; // 15 seconds

/** Timeout for AI client initialization (milliseconds) */
const AI_INIT_TIMEOUT_MS = 10000; // 10 seconds

// -------------------------------------------------------
// Model fallback list
// -------------------------------------------------------
/** Models to try in order. If the first model fails (not found, unavailable),
 *  we automatically fall back to the next one with a SHORTER timeout
 *  (fallback models get less time to avoid exceeding Vercel's 60s limit).
 */
const MODEL_FALLBACK_LIST = [
  process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

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
// Core: Streaming AI call with two-tier timeout
// -------------------------------------------------------

/**
 * Call Gemini using streaming API with two-tier timeout:
 *   1. First-token timeout (15s): If no token arrives, the AI is unreachable
 *   2. Overall timeout (45s): Hard limit to stay within Vercel's 60s
 *
 * Streaming is CRITICAL because:
 *   - Non-streaming `generateContent` must wait for the ENTIRE response
 *   - With streaming, first tokens arrive in 3-8s, confirming the connection works
 *   - If the AI is slow to START, we know in 15s instead of 45s
 *   - Once streaming begins, the response accumulates incrementally
 */
async function streamChat(
  genAI: GoogleGenerativeAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  overallTimeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: options?.temperature ?? 0.4,
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  });

  console.log('[Gemini] Starting STREAM for model:', modelName, '(first-token timeout: 15s, overall:', overallTimeoutMs + 'ms)');

  const startTime = Date.now();

  // Start the streaming call
  const streamResult = await model.generateContentStream(userPrompt);

  // Two-tier timeout: we track both "first token" and "overall" deadlines
  let firstTokenReceived = false;
  let accumulatedText = '';

  // Overall timeout — hard kill everything after this
  const overallDeadline = startTime + overallTimeoutMs;

  try {
    for await (const chunk of streamResult.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          console.log('[Gemini] First token received in', Date.now() - startTime, 'ms from model:', modelName);
        }
        accumulatedText += chunkText;
      }

      // Check overall deadline after each chunk
      if (Date.now() > overallDeadline) {
        console.warn('[Gemini] Overall timeout reached after', Date.now() - startTime, 'ms. Returning partial response (', accumulatedText.length, 'chars)');
        if (accumulatedText.trim().length > 100) {
          // We have a substantial partial response — return it
          return accumulatedText + '\n\n[... تم قطع الاستجابة بسبب انتهاء المهلة ...]';
        }
        throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
      }
    }
  } catch (streamError: unknown) {
    const errMsg = streamError instanceof Error ? streamError.message : String(streamError);

    // If we already accumulated significant text, return it as partial
    if (accumulatedText.trim().length > 100 && !errMsg.includes('انتهت مهلة')) {
      console.warn('[Gemini] Stream error after', Date.now() - startTime, 'ms, returning partial (', accumulatedText.length, 'chars):', errMsg);
      return accumulatedText;
    }

    // If first token never arrived, this is a first-token timeout or connection error
    if (!firstTokenReceived) {
      const elapsed = Date.now() - startTime;
      if (elapsed > AI_FIRST_TOKEN_TIMEOUT_MS) {
        console.warn('[Gemini] First-token timeout (', elapsed, 'ms) for model:', modelName);
        throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
      }
    }

    // Re-throw the original error
    throw streamError;
  }

  if (!accumulatedText || accumulatedText.trim().length === 0) {
    console.error('[Gemini] Empty streaming response from model:', modelName);
    throw new Error('AI returned an empty response');
  }

  console.log('[Gemini] Stream complete from model:', modelName, ', length:', accumulatedText.length, ', time:', Date.now() - startTime, 'ms');
  return accumulatedText;
}

// -------------------------------------------------------
// Non-streaming fallback (for short responses like evaluate)
// -------------------------------------------------------

async function nonStreamChat(
  genAI: GoogleGenerativeAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: options?.temperature ?? 0.4,
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  });

  console.log('[Gemini] Non-stream request to model:', modelName, '(timeout:', timeoutMs + 'ms)');

  const resultPromise = model.generateContent(userPrompt);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي')), timeoutMs)
  );

  const result = await Promise.race([resultPromise, timeoutPromise]);
  const text = result.response.text();

  if (!text || text.trim().length === 0) {
    console.error('[Gemini] Empty response from model:', modelName);
    throw new Error('AI returned an empty response');
  }

  console.log('[Gemini] Response from model:', modelName, ', length:', text.length);
  return text;
}

// -------------------------------------------------------
// Helper: call AI with built-in timeout and retry
// -------------------------------------------------------

interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  /** If true, use non-streaming mode (for very short responses like evaluate) */
  nonStream?: boolean;
}

async function aiChatWithRetry(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions
): Promise<string> {
  const maxRetries = options?.retries ?? 1;
  const timeoutMs = options?.timeoutMs ?? AI_CALL_TIMEOUT_MS;
  const useNonStream = options?.nonStream ?? false;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Gemini] Retry attempt ${attempt}/${maxRetries}`);
        // On retry, reset the client in case it's in a bad state
        _genAI = null;
      }

      const result = await aiChatInternal(systemPrompt, userPrompt, options, timeoutMs, useNonStream);
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

      // Don't retry on timeout — it'll likely timeout again
      if (lastError.message.includes('مهلة') || lastError.message.includes('timeout')) {
        throw lastError;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const backoffMs = Math.min(2000 * Math.pow(2, attempt), 8000);
        console.log(`[Gemini] Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error('فشل الاتصال بالذكاء الاصطناعي بعد عدة محاولات');
}

// -------------------------------------------------------
// Core AI chat function — uses Google Gemini with streaming
// -------------------------------------------------------
async function aiChatInternal(
  systemPrompt: string,
  userPrompt: string,
  options?: AiChatOptions,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
  useNonStream: boolean = false,
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

  // Try each model in the fallback list until one works
  let lastError: Error | null = null;
  const overallStartTime = Date.now();

  for (let modelIndex = 0; modelIndex < MODEL_FALLBACK_LIST.length; modelIndex++) {
    const modelName = MODEL_FALLBACK_LIST[modelIndex];
    const isFirstModel = modelIndex === 0;

    // Calculate remaining time for fallback models
    const elapsedSoFar = Date.now() - overallStartTime;
    const remainingTime = Math.max(timeoutMs - elapsedSoFar, 10000); // minimum 10s for fallback

    // Fallback models get less time (the remaining budget, not the full timeout)
    const modelTimeout = isFirstModel ? timeoutMs : Math.min(remainingTime, 15000);

    // If we've already used up most of the time, don't bother trying another model
    if (!isFirstModel && remainingTime < 10000) {
      console.warn('[Gemini] Not enough time left (', remainingTime, 'ms) to try fallback model:', modelName);
      break;
    }

    try {
      console.log('[Gemini] Trying model:', modelName, '(timeout:', modelTimeout + 'ms)');

      let result: string;
      if (useNonStream) {
        result = await nonStreamChat(genAI, modelName, systemPrompt, userPrompt, options, modelTimeout);
      } else {
        result = await streamChat(genAI, modelName, systemPrompt, userPrompt, options, modelTimeout);
      }

      return result;
    } catch (modelError: unknown) {
      const errMsg = modelError instanceof Error ? modelError.message : String(modelError);
      lastError = modelError instanceof Error ? modelError : new Error(String(modelError));
      console.warn('[Gemini] Model', modelName, 'failed:', errMsg);

      // Reset singleton on auth/connection errors so subsequent calls retry
      if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API_KEY') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT') || errMsg.includes('fetch failed')) {
        _genAI = null;
      }

      // Don't fall back for these errors — they apply to all models
      if (errMsg.includes('429') || errMsg.includes('rate_limit') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        throw new Error('تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة');
      }
      if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API_KEY') || errMsg.includes('API key not valid') || errMsg.includes('Incorrect API key')) {
        throw new Error('خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة');
      }
      if (errMsg.includes('مهلة') || errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT') || errMsg.includes('timed out') || errMsg.includes('ECONNRESET')) {
        // Timeout — don't fall back to another model (it'll likely timeout too)
        throw new Error('انتهت مهلة الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى');
      }

      // For model-specific errors (not found, not available), try the next model
      if (errMsg.includes('not found') || errMsg.includes('not available') || errMsg.includes('model') || errMsg.includes('empty response')) {
        console.warn('[Gemini] Model', modelName, 'unavailable, trying next fallback...');
        continue; // Try the next model in the list
      }

      // For unknown errors, try the next model as a fallback
      console.warn('[Gemini] Unknown error from model', modelName, ', trying next fallback...');
      continue;
    }
  }

  // All models failed
  console.error('[Gemini] All models failed. Last error:', lastError?.message);
  throw lastError || new Error('فشل الاتصال بالذكاء الاصطناعي بعد تجربة جميع النماذج');
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
    { temperature: 0.3, maxTokens: 4096, timeoutMs: AI_CALL_TIMEOUT_MS, retries: 0 }
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
// Fill-in-the-blank evaluation (uses non-streaming for short response)
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
    { temperature: 0.1, maxTokens: 10, timeoutMs: 30000, retries: 1, nonStream: true }
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
