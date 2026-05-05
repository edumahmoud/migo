/**
 * Gemini AI Service
 *
 * Centralized service for Google Gemini API interactions.
 * Used by:
 *   - /api/gemini/summary  → Text/PDF summarization
 *   - /api/gemini/quiz     → Quiz generation from content
 *   - /api/gemini/evaluate → Fill-in-the-blank answer evaluation
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
// Model selection — use Gemini 2.0 Flash for speed + cost
// -------------------------------------------------------
const MODEL_ID = 'gemini-2.0-flash';

// -------------------------------------------------------
// Summarization
// -------------------------------------------------------
export async function generateSummary(content: string): Promise<string> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: MODEL_ID });

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
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: MODEL_ID });

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
      responseMimeType: 'application/json',
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

  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: MODEL_ID });

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
}
