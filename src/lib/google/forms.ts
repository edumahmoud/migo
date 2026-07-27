// ============================================================
// Google Forms Service — Core Business Logic
// ============================================================
//
// CRITICAL Google Forms API v1 rules (learned from failures):
//
// 1. forms.create: ONLY info.title — no description, no settings
// 2. createItem structure: { createItem: { item: {...}, location: {...} }
//    NOT: { createItem: { questionItem: {...}, location: {...} }
// 3. Option.isCorrect is READ-ONLY — use grading.correctAnswers instead
// 4. TextQuestion.type is NOT a valid JSON field — send textQuestion: {}
//    (default is SHORT_TEXT; for PARAGRAPH use paragraph: true)
// 5. ChoiceQuestion.type IS valid as string enum ("RADIO", "CHECKBOX", etc.)
// 6. grading requires quiz mode FIRST — split batchUpdate into 2 calls
// 7. Drive API list: must filter trashed=false to exclude deleted forms
//
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

// ─── API Clients ───

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

// ─── Build Item ───
//
// Returns { item, location } separately so the caller wraps them as:
// { createItem: { item: result.item, location: result.location } }

interface BuildItemResult {
  item: Record<string, unknown>;
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
  let questionDetails: Record<string, unknown>;
  let correctAnswers: string[] = [];

  switch (mapping.googleFormType) {
    case 'choiceQuestion': {
      const choiceType = mapping.googleFormChoiceType || 'RADIO';
      let options: Array<{ value: string }> = [];

      if (question.type === 'mcq') {
        options = (question.options || []).map((opt) => ({ value: opt }));
        if (isQuiz && question.correct_answer) {
          correctAnswers = [question.correct_answer];
        }
      } else if (question.type === 'boolean') {
        options = [{ value: 'True' }, { value: 'False' }];
        if (isQuiz && question.correct_answer) {
          correctAnswers = [question.correct_answer.toLowerCase() === 'true' ? 'True' : 'False'];
        }
      }

      // ChoiceQuestion.type IS valid — it's a string enum field
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
      // CRITICAL: TextQuestion does NOT accept a "type" field!
      // Send empty object {} — default is SHORT_TEXT.
      // For PARAGRAPH type, use "paragraph": true instead.
      const isParagraph = mapping.googleFormTextType === 'PARAGRAPH';

      questionDetails = {
        required: true,
        textQuestion: isParagraph ? { paragraph: true } : {},
      };

      // For completion questions in quiz mode with a known correct answer
      if (isQuiz && question.correct_answer) {
        correctAnswers = [question.correct_answer];
      }
      break;
    }

    default:
      return null;
  }

  // Build grading for quiz mode (using correctAnswers, NOT isCorrect on options)
  let grading: Record<string, unknown> | undefined;
  if (isQuiz && correctAnswers.length > 0) {
    grading = {
      pointValue: 1,
      correctAnswers: {
        answers: correctAnswers.map((ans) => ({ value: ans })),
      },
    };
  }

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

  return { item, location: { index } };
}

// ─── Create New Google Form ───

export async function createNewGoogleForm(
  userId: string,
  questions: BankQuestion[],
  config: ExportGoogleFormConfig
): Promise<ExportGoogleFormResult> {
  const formsClient = await getFormsClient(userId);

  // Step 1: Create form with ONLY title (no description)
  const createResponse = await formsClient.forms.create({
    requestBody: { info: { title: config.formTitle } },
  });

  const formId = createResponse.data.formId;
  if (!formId) {
    throw new Error('Google Forms API did not return a formId');
  }

  // Step 2: Map questions
  const { supported, unsupported } = mapQuestionsToGoogleForm(questions);
  if (supported.length === 0) {
    throw new Error('No supported questions to export. All questions are of unsupported types.');
  }

  // Step 3: Setup call — description + quiz mode (must happen BEFORE questions with grading)
  const setupRequests: Array<Record<string, unknown>> = [];

  if (config.formDescription && config.formDescription.trim()) {
    setupRequests.push({
      updateFormInfo: {
        info: { title: config.formTitle, description: config.formDescription },
        updateMask: 'description',
      },
    });
  }

  if (config.createAsQuiz) {
    setupRequests.push({
      updateSettings: {
        settings: { quizSettings: { isQuiz: true } },
        updateMask: 'quizSettings.isQuiz',
      },
    });
  }

  if (setupRequests.length > 0) {
    await executeWithRetry(async () => {
      return formsClient.forms.batchUpdate({ formId, requestBody: { requests: setupRequests } });
    });
  }

  // Step 4: Add question items (quiz mode is set, so grading is valid)
  const questionRequests: Array<Record<string, unknown>> = [];
  for (let i = 0; i < supported.length; i++) {
    const result = buildItem(supported[i], i, config.createAsQuiz, config.shuffleOptions);
    if (result) {
      questionRequests.push({
        createItem: { item: result.item, location: result.location },
      });
    }
  }

  await executeWithRetry(async () => {
    return formsClient.forms.batchUpdate({ formId, requestBody: { requests: questionRequests } });
  });

  // Step 5: Build result
  return {
    formId,
    editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
    responderUrl: `https://docs.google.com/forms/d/${formId}/viewform`,
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

  // Step 1: Verify the form exists (catch deleted forms)
  try {
    const existingForm = await executeWithRetry(async () => {
      return formsClient.forms.get({ formId });
    });
    const existingItems = existingForm.data.items || [];
    const startIndex = existingItems.length;

    // Step 2: Map questions
    const { supported, unsupported } = mapQuestionsToGoogleForm(questions);
    if (supported.length === 0) {
      throw new Error('No supported questions to export. All questions are of unsupported types.');
    }

    // Step 3: Build and execute batchUpdate
    const requests: Array<Record<string, unknown>> = [];
    for (let i = 0; i < supported.length; i++) {
      const result = buildItem(supported[i], startIndex + i, config.createAsQuiz, config.shuffleOptions);
      if (result) {
        requests.push({
          createItem: { item: result.item, location: result.location },
        });
      }
    }

    await executeWithRetry(async () => {
      return formsClient.forms.batchUpdate({ formId, requestBody: { requests } });
    });

    return {
      formId,
      editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
      responderUrl: `https://docs.google.com/forms/d/${formId}/viewform`,
      questionsExported: supported.length,
      questionsSkipped: unsupported.length,
      unsupportedQuestions: unsupported,
    };
  } catch (err) {
    const error = err as { code?: number; message?: string };
    // If the form was deleted (404), give a clear error message
    if (error.code === 404 || (error.message && error.message.includes('not found'))) {
      throw new Error(
        'The selected Google Form no longer exists. It may have been deleted from your Google account. ' +
        'Please refresh the list and select a different form.'
      );
    }
    throw err;
  }
}

// ─── List User's Google Forms (excluding trashed/deleted) ───

export async function listUserGoogleForms(
  userId: string,
  pageToken?: string
): Promise<{ forms: GoogleFormListItem[]; nextPageToken?: string }> {
  const driveClient = await getDriveClient(userId);

  const response = await executeWithRetry(async () => {
    return driveClient.files.list({
      // Exclude trashed (deleted) forms — they should not appear in the selection list
      q: "mimeType='application/vnd.google-apps.form' and trashed=false",
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

  return { forms, nextPageToken: response.data.nextPageToken || undefined };
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

      const isRateLimit = error.code === 429 || error.response?.status === 429 ||
        (error.message && error.message.includes('rate limit'));
      const isQuota = error.code === 403 && error.message &&
        (error.message.includes('quota') || error.message.includes('Quota'));
      const isAuthError = error.code === 401 || (error.code === 403 && !isQuota);
      const isNotFound = error.code === 404;

      // Don't retry on auth errors, 404, or final attempt
      if (isAuthError || isNotFound || attempt === maxRetries - 1) {
        throw err;
      }

      console.warn(`[Google Forms API] Error on attempt ${attempt + 1}: ${error.message}. Waiting ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffMultiplier, 10000);
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
  if (error) throw new Error(`Failed to fetch questions: ${error.message}`);
  if (!questions || questions.length === 0) throw new Error('No questions found for the specified IDs or banks');

  if (bankIds && bankIds.length > 0) {
    const { data: banks, error: banksError } = await supabaseServer
      .from('question_banks')
      .select('id, teacher_id')
      .in('id', bankIds);
    if (banksError) throw new Error(`Failed to verify bank ownership: ${banksError.message}`);

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
