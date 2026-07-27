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
// CRITICAL NOTES about the Google Forms API:
//
// 1. The createItem structure is:
//    { createItem: { item: { questionItem: {...} }, location: { index } } }
//    NOT: { createItem: { questionItem: {...}, location: {...} } }
//
// 2. Option.isCorrect is READ-ONLY — it cannot be set in batchUpdate.
//    To mark correct answers in quiz mode, use grading.correctAnswers
//    on the Question object instead.
//
// 3. grading can only be set AFTER the form is in quiz mode.
//    So we split batchUpdate into two calls:
//    Call 1: Set quiz mode + add description
//    Call 2: Add question items (grading is valid now)
//

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
  // NOTE: Option.isCorrect is read-only — do NOT include it.
  // For quiz correct answers, we use grading.correctAnswers on the Question.
  let questionDetails: Record<string, unknown>;
  let correctAnswers: string[] = []; // Values of correct options for grading

  switch (mapping.googleFormType) {
    case 'choiceQuestion': {
      const choiceType = mapping.googleFormChoiceType || 'RADIO';

      // Build options — ONLY "value" field, NO "isCorrect" (read-only)
      let options: Array<{ value: string }> = [];

      if (question.type === 'mcq') {
        const questionOptions = question.options || [];
        options = questionOptions.map((opt) => ({ value: opt }));
        // Track the correct answer value for grading
        if (isQuiz && question.correct_answer) {
          correctAnswers = [question.correct_answer];
        }
      } else if (question.type === 'boolean') {
        options = [{ value: 'True' }, { value: 'False' }];
        // Track correct boolean value for grading
        if (isQuiz && question.correct_answer) {
          const correctBool = question.correct_answer.toLowerCase() === 'true';
          correctAnswers = [correctBool ? 'True' : 'False'];
        }
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

      // For text/completion questions in quiz mode, we can set a grading key
      // if the correct answer is known
      if (isQuiz && question.correct_answer) {
        correctAnswers = [question.correct_answer];
      }
      break;
    }

    default:
      return null;
  }

  // Build grading object for quiz mode
  // grading.correctAnswers uses CorrectAnswer objects with "value" field
  let grading: Record<string, unknown> | undefined;
  if (isQuiz && correctAnswers.length > 0) {
    grading = {
      pointValue: 1,
      correctAnswers: {
        answers: correctAnswers.map((ans) => ({ value: ans })),
      },
    };
  }

  // Build the full item structure:
  // Item { questionItem: { question: { ... (with grading if quiz) } } }
  const questionObj: Record<string, unknown> = { ...questionDetails };
  if (grading) {
    questionObj.grading = grading;
  }

  const item: Record<string, unknown> = {
    title: questionText,
    questionItem: {
      question: questionObj,
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

  // ── Step 3: If quiz mode, set it FIRST in a separate batchUpdate ──
  // grading on questions requires the form to already be in quiz mode.
  // We must enable quiz mode BEFORE adding questions with grading.
  if (config.createAsQuiz) {
    const setupRequests: Array<Record<string, unknown>> = [];

    // Add description if provided
    if (config.formDescription && config.formDescription.trim()) {
      setupRequests.push({
        updateFormInfo: {
          info: {
            title: config.formTitle,
            description: config.formDescription,
          },
          updateMask: 'description',
        },
      });
    }

    // Enable quiz mode
    setupRequests.push({
      updateSettings: {
        settings: {
          quizSettings: {
            isQuiz: true,
          },
        },
        updateMask: 'quizSettings.isQuiz',
      },
    });

    await executeWithRetry(async () => {
      return formsClient.forms.batchUpdate({
        formId,
        requestBody: { requests: setupRequests },
      });
    });
  } else if (config.formDescription && config.formDescription.trim()) {
    // Non-quiz mode — just add description
    await executeWithRetry(async () => {
      return formsClient.forms.batchUpdate({
        formId,
        requestBody: {
          requests: [{
            updateFormInfo: {
              info: {
                title: config.formTitle,
                description: config.formDescription,
              },
              updateMask: 'description',
            },
          }],
        },
      });
    });
  }

  // ── Step 4: Add question items ──
  // Now the form is in quiz mode (if requested), so grading is valid.
  const questionRequests: Array<Record<string, unknown>> = [];

  for (let i = 0; i < supported.length; i++) {
    const result = buildItem(supported[i], i, config.createAsQuiz, config.shuffleOptions);
    if (result) {
      questionRequests.push({
        createItem: {
          item: result.item,
          location: result.location,
        },
      });
    }
  }

  await executeWithRetry(async () => {
    return formsClient.forms.batchUpdate({
      formId,
      requestBody: { requests: questionRequests },
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
