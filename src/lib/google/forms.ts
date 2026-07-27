// ============================================================
// Google Forms Service — Core Business Logic
// ============================================================
//
// This module implements all Google Forms API operations:
// - Create new Google Forms
// - Append questions to existing Google Forms
// - Configure quiz settings
// - List user's Google Forms
// - Map AttenDo question types → Google Forms question types
//
// CRITICAL: Google Forms API v1 uses proto3 JSON format.
// All property names must be in lowerCamelCase exactly as
// specified in the API reference. The googleapis npm library
// sends requestBody as raw JSON — property names are preserved.
//
// The batchUpdate createItem structure is:
// { createItem: { item: { questionItem: { question: {...} } }, location: { index: N } } }
//
// NOT: { createItem: { questionItem: {...}, location: {...} } }
// The questionItem must be INSIDE item, and location must be
// at the SAME level as item (not inside item).
//
// Implements retry with exponential backoff for API limits.
// NEVER exposes tokens to the client — all calls are server-side.
// ============================================================

import { google } from 'googleapis';
import { getAuthenticatedClient } from './oauth';
import { supabaseServer } from '@/lib/supabase-server';
import { QUESTION_TYPE_MAPPING } from '@/types/googleForms';
import type {
  ExportGoogleFormConfig,
  ExportGoogleFormResult,
  QuestionMappingResult,
  UnsupportedQuestionInfo,
  GoogleFormListItem,
} from '@/types/googleForms';
import type { BankQuestion } from '@/lib/types';

// ─── Google Forms API Client ───

async function getFormsClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.forms({ version: 'v1', auth });
}

async function getDriveClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.drive({ version: 'v3', auth });
}

// ─── Question Mapping ───

export function mapQuestionToGoogleForm(question: BankQuestion): QuestionMappingResult {
  const mapping = QUESTION_TYPE_MAPPING[question.type];

  if (!mapping) {
    return {
      originalQuestion: question,
      mappingType: 'unsupported',
      googleFormType: null,
      reason: `Unknown question type: ${question.type}`,
    };
  }

  return {
    originalQuestion: question,
    mappingType: mapping.supported ? 'supported' : 'unsupported',
    googleFormType: mapping.kind,
    googleFormChoiceType: mapping.choiceType,
    googleFormTextType: mapping.textType,
    reason: mapping.reason,
  };
}

export function mapQuestionsToGoogleForm(
  questions: BankQuestion[]
): { supported: QuestionMappingResult[]; unsupported: UnsupportedQuestionInfo[] } {
  const supported: QuestionMappingResult[] = [];
  const unsupported: UnsupportedQuestionInfo[] = [];

  for (const question of questions) {
    const mapping = mapQuestionToGoogleForm(question);

    if (mapping.mappingType === 'supported' || mapping.mappingType === 'partial') {
      supported.push(mapping);
    } else {
      unsupported.push({
        questionId: question.id,
        questionType: question.type,
        questionText: question.question,
        reason: mapping.reason || 'Unsupported question type',
      });
    }
  }

  return { supported, unsupported };
}

// ─── Build a Google Forms Item (the "item" inside createItem) ───
//
// This builds the ITEM object that wraps questionItem.
// The correct hierarchy for batchUpdate is:
//
//   createItem: {
//     item: {             ← Item wrapper (contains title, description, questionItem)
//       questionItem: {   ← Question type content
//         question: {     ← Question details (choiceQuestion, textQuestion, etc.)
//           ...
//         }
//       }
//     },
//     location: {         ← Where to insert (separate from item)
//       index: N
//     }
//   }

interface BuildItemResult {
  /** The Google Forms Item object containing questionItem */
  item: Record<string, unknown>;
  /** The location where this item should be inserted */
  location: { index: number };
}

function buildItem(
  mapping: QuestionMappingResult,
  index: number,
  isQuiz: boolean,
  shuffleOptions: boolean
): BuildItemResult | null {
  const question = mapping.originalQuestion;
  const questionText = question.question || 'Untitled Question';

  // Build the question details (choiceQuestion or textQuestion)
  let questionDetails: Record<string, unknown>;

  switch (mapping.googleFormType) {
    case 'choiceQuestion': {
      const choiceType = mapping.googleFormChoiceType || 'RADIO';
      let options: Array<Record<string, unknown>> = [];

      if (question.type === 'mcq') {
        const questionOptions = question.options || [];
        options = questionOptions.map((opt) => {
          const optionObj: Record<string, unknown> = { value: opt };
          if (isQuiz && question.correct_answer) {
            optionObj.isCorrect = opt === question.correct_answer;
          }
          return optionObj;
        });
      } else if (question.type === 'boolean') {
        const correctBool = question.correct_answer?.toLowerCase() === 'true';
        options = [
          { value: 'True', ...(isQuiz ? { isCorrect: correctBool } : {}) },
          { value: 'False', ...(isQuiz ? { isCorrect: !correctBool } : {}) },
        ];
      }

      questionDetails = {
        required: true,
        choiceQuestion: {
          type: choiceType,
          options,
          shuffle: shuffleOptions,
        },
      };
      break;
    }

    case 'textQuestion': {
      const textType = mapping.googleFormTextType || 'SHORT_TEXT';
      questionDetails = {
        required: true,
        textQuestion: {
          type: textType,
        },
      };
      break;
    }

    default:
      return null;
  }

  // Build the full item structure:
  // Item { questionItem: { question: { ... } } }
  const item: Record<string, unknown> = {
    title: questionText,
    questionItem: {
      question: questionDetails,
    },
  };

  return {
    item,
    location: { index },
  };
}

// ─── Create New Google Form ───

export async function createNewGoogleForm(
  userId: string,
  questions: BankQuestion[],
  config: ExportGoogleFormConfig
): Promise<ExportGoogleFormResult> {
  const formsClient = await getFormsClient(userId);

  // ── Step 1: Create the base form with ONLY the title ──
  // Google Forms API restriction: only info.title can be set during creation.
  const createResponse = await formsClient.forms.create({
    requestBody: {
      info: {
        title: config.formTitle,
      },
    },
  });

  const formId = createResponse.data.formId;
  if (!formId) {
    throw new Error('Google Forms API did not return a formId');
  }

  // ── Step 2: Map questions ──
  const { supported, unsupported } = mapQuestionsToGoogleForm(questions);

  if (supported.length === 0) {
    throw new Error('No supported questions to export. All questions are of unsupported types.');
  }

  // ── Step 3: Build ALL batchUpdate requests ──
  const requests: Array<Record<string, unknown>> = [];

  // 3a: Add description via updateFormInfo (only if provided)
  if (config.formDescription && config.formDescription.trim()) {
    requests.push({
      updateFormInfo: {
        info: {
          title: config.formTitle,
          description: config.formDescription,
        },
        updateMask: 'description',
      },
    });
  }

  // 3b: Set quiz mode if requested
  if (config.createAsQuiz) {
    requests.push({
      updateSettings: {
        settings: {
          quizSettings: {
            isQuiz: true,
          },
        },
        updateMask: 'quizSettings.isQuiz',
      },
    });
  }

  // 3c: Add question items using correct createItem structure
  for (let i = 0; i < supported.length; i++) {
    const result = buildItem(supported[i], i, config.createAsQuiz, config.shuffleOptions);
    if (result) {
      requests.push({
        createItem: {
          item: result.item,
          location: result.location,
        },
      });
    }
  }

  // ── Step 4: Execute batchUpdate with retry ──
  await executeWithRetry(async () => {
    return formsClient.forms.batchUpdate({
      formId,
      requestBody: { requests },
    });
  });

  // ── Step 5: Build result ──
  const editUrl = `https://docs.google.com/forms/d/${formId}/edit`;
  const responderUrl = `https://docs.google.com/forms/d/${formId}/viewform`;

  return {
    formId,
    editUrl,
    responderUrl,
    questionsExported: supported.length,
    questionsSkipped: unsupported.length,
    unsupportedQuestions: unsupported,
  };
}

// ─── Append to Existing Google Form ───

export async function appendToExistingGoogleForm(
  userId: string,
  questions: BankQuestion[],
  config: ExportGoogleFormConfig
): Promise<ExportGoogleFormResult> {
  const formsClient = await getFormsClient(userId);
  const formId = config.existingFormId;

  if (!formId) {
    throw new Error('existingFormId is required when formMode is "appendToExisting"');
  }

  // ── Step 1: Get the existing form to determine current item count ──
  const existingForm = await executeWithRetry(async () => {
    return formsClient.forms.get({ formId });
  });

  const existingItems = existingForm.data.items || [];
  const startIndex = existingItems.length;

  // ── Step 2: Map questions ──
  const { supported, unsupported } = mapQuestionsToGoogleForm(questions);

  if (supported.length === 0) {
    throw new Error('No supported questions to export. All questions are of unsupported types.');
  }

  // ── Step 3: Build batchUpdate requests with correct structure ──
  const requests: Array<Record<string, unknown>> = [];

  for (let i = 0; i < supported.length; i++) {
    const result = buildItem(supported[i], startIndex + i, config.createAsQuiz, config.shuffleOptions);
    if (result) {
      requests.push({
        createItem: {
          item: result.item,
          location: result.location,
        },
      });
    }
  }

  // ── Step 4: Execute batchUpdate ──
  await executeWithRetry(async () => {
    return formsClient.forms.batchUpdate({
      formId,
      requestBody: { requests },
    });
  });

  // ── Step 5: Build result ──
  const editUrl = `https://docs.google.com/forms/d/${formId}/edit`;
  const responderUrl = `https://docs.google.com/forms/d/${formId}/viewform`;

  return {
    formId,
    editUrl,
    responderUrl,
    questionsExported: supported.length,
    questionsSkipped: unsupported.length,
    unsupportedQuestions: unsupported,
  };
}

// ─── List User's Google Forms ───

export async function listUserGoogleForms(
  userId: string,
  pageToken?: string
): Promise<{ forms: GoogleFormListItem[]; nextPageToken?: string }> {
  const driveClient = await getDriveClient(userId);

  const response = await executeWithRetry(async () => {
    return driveClient.files.list({
      q: "mimeType='application/vnd.google-apps.form'",
      fields: 'files(id,name,description,createdTime,modifiedTime),nextPageToken',
      pageSize: 50,
      pageToken: pageToken || undefined,
      orderBy: 'modifiedTime desc',
    });
  });

  const files = response.data.files || [];
  const forms: GoogleFormListItem[] = files.map((file) => ({
    id: file.id || '',
    title: file.name || '',
    description: file.description || undefined,
    createdTime: file.createdTime || undefined,
    modifiedTime: file.modifiedTime || undefined,
    responderUrl: file.id ? `https://docs.google.com/forms/d/${file.id}/viewform` : undefined,
    editUrl: file.id ? `https://docs.google.com/forms/d/${file.id}/edit` : undefined,
  }));

  return {
    forms,
    nextPageToken: response.data.nextPageToken || undefined,
  };
}

// ─── Retry with Exponential Backoff ───

async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000,
  backoffMultiplier: number = 2
): Promise<T> {
  let delay = initialDelay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const error = err as { code?: number; message?: string; response?: { status?: number } };

      const isRateLimit =
        error.code === 429 ||
        error.response?.status === 429 ||
        (error.message && error.message.includes('rate limit'));

      const isQuota =
        error.code === 403 &&
        error.message &&
        (error.message.includes('quota') || error.message.includes('Quota'));

      const isAuthError =
        error.code === 401 ||
        (error.code === 403 && !isQuota);

      if (isAuthError || attempt === maxRetries - 1) {
        throw err;
      }

      if (isRateLimit || isQuota) {
        console.warn(`[Google Forms API] Rate limited on attempt ${attempt + 1}. Waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, 10000);
      } else {
        console.warn(`[Google Forms API] Transient error on attempt ${attempt + 1}: ${error.message}. Waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, 10000);
      }
    }
  }

  throw new Error('Google Forms API operation failed after maximum retries');
}

// ─── Fetch Questions from Database ──

export async function fetchQuestionsForExport(
  userId: string,
  questionIds: string[],
  bankIds?: string[]
): Promise<BankQuestion[]> {
  if (questionIds.length === 0 && (!bankIds || bankIds.length === 0)) {
    throw new Error('No question IDs or bank IDs provided for export');
  }

  let query = supabaseServer
    .from('bank_questions')
    .select('id, bank_id, type, question, options, correct_answer, pairs, difficulty, category, created_at');

  if (questionIds.length > 0) {
    query = query.in('id', questionIds);
  } else if (bankIds && bankIds.length > 0) {
    query = query.in('bank_id', bankIds);
  }

  const { data: questions, error } = await query.order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch questions: ${error.message}`);
  }

  if (!questions || questions.length === 0) {
    throw new Error('No questions found for the specified IDs or banks');
  }

  // Validate ownership
  if (bankIds && bankIds.length > 0) {
    const { data: banks, error: banksError } = await supabaseServer
      .from('question_banks')
      .select('id, teacher_id')
      .in('id', bankIds);

    if (banksError) {
      throw new Error(`Failed to verify bank ownership: ${banksError.message}`);
    }

    const ownedBankIds = (banks || []).filter(b => b.teacher_id === userId).map(b => b.id);
    const unauthorizedBankIds = bankIds.filter(id => !ownedBankIds.includes(id));

    if (unauthorizedBankIds.length > 0) {
      throw new Error(`You do not have permission to export from banks: ${unauthorizedBankIds.join(', ')}`);
    }
  }

  return questions as BankQuestion[];
}

// ─── Main Export Function ──

export async function exportQuestionsToGoogleForm(
  userId: string,
  questionIds: string[],
  bankIds: string[],
  config: ExportGoogleFormConfig
): Promise<ExportGoogleFormResult> {
  if (!config.formTitle || config.formTitle.trim().length === 0) {
    throw new Error('Form title is required');
  }

  const questions = await fetchQuestionsForExport(userId, questionIds, bankIds);

  if (config.formMode === 'appendToExisting') {
    return appendToExistingGoogleForm(userId, questions, config);
  } else {
    return createNewGoogleForm(userId, questions, config);
  }
}
