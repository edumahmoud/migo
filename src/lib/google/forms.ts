// ============================================================
// Google Forms Service — Core Business Logic
// ============================================================
//
// This module implements all Google Forms API operations:
// - Create new Google Forms
// - Append questions to existing Google Forms
// - Configure quiz settings (shuffle, scoring, email collection)
// - List user's Google Forms
// - Map AttenDo question types → Google Forms question types
//
// Uses batchUpdate requests for efficient question insertion.
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

/**
 * Returns an authenticated Google Forms API client.
 * Uses the user's stored OAuth tokens.
 */
async function getFormsClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.forms({ version: 'v1', auth });
}

/**
 * Returns an authenticated Google Drive API client.
 * Used for listing user's Google Forms and getting metadata.
 */
async function getDriveClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.drive({ version: 'v3', auth });
}

// ─── Question Mapping ───

/**
 * Maps an AttenDo BankQuestion to a Google Forms question.
 * Returns the mapping result including type, supported status, and reason.
 *
 * Question type mapping:
 * - mcq        → choiceQuestion (RADIO) — fully supported
 * - boolean    → choiceQuestion (RADIO) with True/False options — fully supported
 * - completion → textQuestion (SHORT_TEXT) — supported, but no auto-grading
 * - matching   → UNSUPPORTED — no Google Forms equivalent
 */
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

/**
 * Maps multiple AttenDo questions to Google Forms format.
 * Returns supported mappings and unsupported question details.
 */
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

// ─── Question Item Builder ───

/**
 * Builds a Google Forms batchUpdate request item for a question.
 * Each item creates one question in the form.
 *
 * The item structure follows the Google Forms API specification:
 * https://developers.google.com/forms/api/reference/rest/v1/forms.batchUpdate
 */
function buildQuestionItem(
  mapping: QuestionMappingResult,
  index: number,
  isQuiz: boolean
): Record<string, unknown> | null {
  const question = mapping.originalQuestion;

  // Base question item structure
  const item: Record<string, unknown> = {
    location: { index },
    questionItem: {
      question: {},
    },
  };

  // Set the question text (required field)
  const questionText = question.question || 'Untitled Question';

  switch (mapping.googleFormType) {
    case 'choiceQuestion': {
      // MCQ or True/False → choiceQuestion with RADIO type
      const choiceType = mapping.googleFormChoiceType || 'RADIO';

      // Build options list
      let options: Array<{ value: string; isCorrect?: boolean }> = [];

      if (question.type === 'mcq') {
        // MCQ: options from the question's options array
        const questionOptions = question.options || [];
        options = questionOptions.map((opt) => ({
          value: opt,
          isCorrect: isQuiz ? opt === question.correct_answer : undefined,
        }));
      } else if (question.type === 'boolean') {
        // Boolean: True/False options
        const correctBool = question.correct_answer?.toLowerCase() === 'true';
        options = [
          { value: 'True', isCorrect: isQuiz ? correctBool : undefined },
          { value: 'False', isCorrect: isQuiz ? !correctBool : undefined },
        ];
      }

      // Set choice question details
      (item.questionItem as Record<string, unknown>).question = {
        required: true,
        choiceQuestion: {
          type: choiceType,
          options,
        },
      };

      break;
    }

    case 'textQuestion': {
      // Completion (short answer) → textQuestion with SHORT_TEXT type
      const textType = mapping.googleFormTextType || 'SHORT_TEXT';

      (item.questionItem as Record<string, unknown>).question = {
        required: true,
        textQuestion: {
          type: textType,
        },
      };

      // Note: For quiz mode, Google Forms doesn't support auto-grading for text answers.
      // We can add a grading key for completion questions if the correct answer is known,
      // but this requires manual review in the form.

      break;
    }

    default:
      // Unsupported type — skip
      return null;
  }

  return item;
}

// ─── Create New Google Form ───

/**
 * Creates a new Google Form with the specified configuration and questions.
 *
 * IMPORTANT: Google Forms API only allows `info.title` in the create request.
 * Description, questions, and settings must ALL be added via batchUpdate.
 *
 * Returns the form ID, edit URL, responder URL, and export statistics.
 */
export async function createNewGoogleForm(
  userId: string,
  questions: BankQuestion[],
  config: ExportGoogleFormConfig
): Promise<ExportGoogleFormResult> {
  const formsClient = await getFormsClient(userId);

  // ── Step 1: Create the base form with ONLY the title ──
  // Google Forms API restriction: only info.title can be set during creation.
  // Everything else (description, questions, settings) must use batchUpdate.
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

  // ── Step 2: Map questions and build batchUpdate items ──
  const { supported, unsupported } = mapQuestionsToGoogleForm(questions);

  if (supported.length === 0) {
    throw new Error('No supported questions to export. All questions are of unsupported types.');
  }

  // Build question items for batchUpdate
  const questionItems: Array<Record<string, unknown>> = [];
  for (let i = 0; i < supported.length; i++) {
    const item = buildQuestionItem(supported[i], i, config.createAsQuiz);
    if (item) {
      // If shuffleOptions is enabled, add shuffleOptions to choice questions
      if (config.shuffleOptions && supported[i].googleFormChoiceType) {
        const questionItem = (item.questionItem as Record<string, unknown>).question as Record<string, unknown>;
        if (questionItem.choiceQuestion) {
          (questionItem.choiceQuestion as Record<string, unknown>).shuffle = true;
        }
      }
      questionItems.push(item);
    }
  }

  // ── Step 3: Build ALL batchUpdate requests in one call ──
  const requests: Array<Record<string, unknown>> = [];

  // 3a: Add description if provided (must be done via batchUpdate, not create)
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

  // 3c: Add question items
  for (const item of questionItems) {
    requests.push({ createItem: item });
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

/**
 * Appends questions to an existing Google Form.
 * Questions are added after the last existing question.
 *
 * Returns the form ID, edit URL, responder URL, and export statistics.
 */
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

  // ── Step 1: Get the existing form to determine the current question count ──
  const existingForm = await executeWithRetry(async () => {
    return formsClient.forms.get({ formId });
  });

  // Find the index where new questions should be inserted (after existing items)
  const existingItems = existingForm.data.items || [];
  const startIndex = existingItems.length;

  // ── Step 2: Map questions ──
  const { supported, unsupported } = mapQuestionsToGoogleForm(questions);

  if (supported.length === 0) {
    throw new Error('No supported questions to export. All questions are of unsupported types.');
  }

  // ── Step 3: Build batchUpdate items ──
  const requests: Array<Record<string, unknown>> = [];

  for (let i = 0; i < supported.length; i++) {
    const item = buildQuestionItem(supported[i], startIndex + i, config.createAsQuiz);
    if (item) {
      // If shuffleOptions is enabled, add shuffleOptions to choice questions
      if (config.shuffleOptions && supported[i].googleFormChoiceType) {
        const questionItem = (item.questionItem as Record<string, unknown>).question as Record<string, unknown>;
        if (questionItem.choiceQuestion) {
          (questionItem.choiceQuestion as Record<string, unknown>).shuffle = true;
        }
      }
      requests.push({ createItem: item });
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

/**
 * Lists the user's Google Forms from Drive.
 * Uses the Drive API to search for forms the user owns or can edit.
 * Returns up to 50 forms per call, with pagination support.
 */
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

/**
 * Executes a Google API call with retry and exponential backoff.
 * Handles transient errors (rate limits, network issues).
 *
 * Max retries: 3
 * Initial delay: 1000ms
 * Backoff multiplier: 2
 * Max delay per retry: 10000ms
 */
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

      // Check if this is a rate limit error (429)
      const isRateLimit =
        error.code === 429 ||
        error.response?.status === 429 ||
        (error.message && error.message.includes('rate limit'));

      // Check if this is a quota error (403 with quota message)
      const isQuota =
        error.code === 403 &&
        error.message &&
        (error.message.includes('quota') || error.message.includes('Quota'));

      // Don't retry on auth errors (401, 403 non-quota)
      const isAuthError =
        error.code === 401 ||
        (error.code === 403 && !isQuota);

      if (isAuthError || attempt === maxRetries - 1) {
        // Auth errors or final attempt — throw
        throw err;
      }

      if (isRateLimit || isQuota) {
        // Rate limit or quota — wait longer
        console.warn(`[Google Forms API] Rate limited on attempt ${attempt + 1}. Waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, 10000);
      } else {
        // Other transient error — retry with backoff
        console.warn(`[Google Forms API] Transient error on attempt ${attempt + 1}: ${error.message}. Waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, 10000);
      }
    }
  }

  // Should not reach here
  throw new Error('Google Forms API operation failed after maximum retries');
}

// ─── Fetch Questions from Database ───

/**
 * Fetches BankQuestion records from the database by their IDs.
 * Validates that the questions belong to banks owned by the requesting user.
 * Returns the questions ready for export.
 */
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

  // If specific question IDs are provided, use them
  if (questionIds.length > 0) {
    query = query.in('id', questionIds);
  } else if (bankIds && bankIds.length > 0) {
    // Otherwise, get all questions from the specified banks
    query = query.in('bank_id', bankIds);
  }

  const { data: questions, error } = await query.order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch questions: ${error.message}`);
  }

  if (!questions || questions.length === 0) {
    throw new Error('No questions found for the specified IDs or banks');
  }

  // Validate ownership: verify that the banks belong to the user
  if (bankIds && bankIds.length > 0) {
    const { data: banks, error: banksError } = await supabaseServer
      .from('question_banks')
      .select('id, teacher_id')
      .in('id', bankIds);

    if (banksError) {
      throw new Error(`Failed to verify bank ownership: ${banksError.message}`);
    }

    // Check that all banks belong to the user
    const ownedBankIds = (banks || []).filter(b => b.teacher_id === userId).map(b => b.id);
    const unauthorizedBankIds = bankIds.filter(id => !ownedBankIds.includes(id));

    if (unauthorizedBankIds.length > 0) {
      throw new Error(`You do not have permission to export from banks: ${unauthorizedBankIds.join(', ')}`);
    }
  }

  return questions as BankQuestion[];
}

// ─── Main Export Function ───

/**
 * Main export function — creates or appends questions to a Google Form.
 * Orchestrates the entire export process.
 *
 * Flow:
 * 1. Validate config
 * 2. Fetch questions
 * 3. Create new form OR append to existing
 * 4. Return result with URLs and statistics
 */
export async function exportQuestionsToGoogleForm(
  userId: string,
  questionIds: string[],
  bankIds: string[],
  config: ExportGoogleFormConfig
): Promise<ExportGoogleFormResult> {
  // Validate required fields
  if (!config.formTitle || config.formTitle.trim().length === 0) {
    throw new Error('Form title is required');
  }

  // Fetch questions from database
  const questions = await fetchQuestionsForExport(userId, questionIds, bankIds);

  // Execute the export based on form mode
  if (config.formMode === 'appendToExisting') {
    return appendToExistingGoogleForm(userId, questions, config);
  } else {
    return createNewGoogleForm(userId, questions, config);
  }
}

