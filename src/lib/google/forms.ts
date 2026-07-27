// ============================================================
// Google Forms Service — Core Business Logic
// ============================================================
//
// CRITICAL Google Forms API v1 rules (all learned from failures):
//
// 1. forms.create: ONLY info.title — no description, no settings
// 2. createItem: { createItem: { item: {...}, location: {...} }
//    NOT: { createItem: { questionItem, location } } — item wrapper required
// 3. Option.isCorrect: READ-ONLY — use grading.correctAnswers instead
// 4. TextQuestion.type: NOT valid JSON — send {} or { paragraph: true }
// 5. ChoiceQuestion.type: IS valid (string enum "RADIO" etc.)
// 6. grading in createItem: NOT ALLOWED — even if quiz mode is set
//    grading requires an EXISTING item — must use updateItem after creation
// 7. Must enable quiz mode BEFORE setting grading (via updateItem)
// 8. Drive API list: filter trashed=false for deleted forms
//
// THE 3-STEP APPROACH FOR QUIZ MODE:
// Step 1: batchUpdate — enable quiz + add description
// Step 2: batchUpdate — create ALL question items WITHOUT grading
// Step 3: batchUpdate — update each item with grading via updateItem
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

// ─── Get correct answers for a question (used for grading) ───

function getCorrectAnswers(question: BankQuestion): string[] {
  if (!question.correct_answer) return [];

  switch (question.type) {
    case 'mcq':
      return [question.correct_answer];
    case 'boolean':
      return [question.correct_answer.toLowerCase() === 'true' ? 'True' : 'False'];
    case 'completion':
      return [question.correct_answer];
    default:
      return [];
  }
}

// ─── Build Item (WITHOUT grading — grading must be added via updateItem) ───

interface BuildItemResult {
  item: Record<string, unknown>;
  location: { index: number };
}

function buildItem(
  mapping: QuestionMappingResult,
  index: number,
  shuffleOptions: boolean
): BuildItemResult | null {
  const question = mapping.originalQuestion;
  const questionText = question.question || 'Untitled Question';
  let questionDetails: Record<string, unknown>;

  switch (mapping.googleFormType) {
    case 'choiceQuestion': {
      const choiceType = mapping.googleFormChoiceType || 'RADIO';
      let options: Array<{ value: string }> = [];

      if (question.type === 'mcq') {
        options = (question.options || []).map((opt) => ({ value: opt }));
      } else if (question.type === 'boolean') {
        options = [{ value: 'True' }, { value: 'False' }];
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
      // TextQuestion: NO "type" field — send {} for SHORT_TEXT, { paragraph: true } for PARAGRAPH
      const isParagraph = mapping.googleFormTextType === 'PARAGRAPH';
      questionDetails = {
        required: true,
        textQuestion: isParagraph ? { paragraph: true } : {},
      };
      break;
    }

    default:
      return null;
  }

  // NO grading here — it must be set via updateItem AFTER creation
  const item: Record<string, unknown> = {
    title: questionText,
    questionItem: {
      question: questionDetails,
    },
  };

  return { item, location: { index } };
}

// ─── Build grading updateItem requests ───
// Called AFTER items are created, to add grading to existing items

function buildGradingUpdateRequests(
  supported: QuestionMappingResult[],
  startIndex: number, // 0 for new forms, existingItems.length for append
  isQuiz: boolean
): Array<Record<string, unknown>> {
  if (!isQuiz) return [];

  const requests: Array<Record<string, unknown>> = [];

  for (let i = 0; i < supported.length; i++) {
    const question = supported[i].originalQuestion;
    const correctAnswers = getCorrectAnswers(question);

    if (correctAnswers.length === 0) continue; // No correct answer — skip grading

    requests.push({
      updateItem: {
        item: {
          questionItem: {
            question: {
              grading: {
                pointValue: 1,
                correctAnswers: {
                  answers: correctAnswers.map((ans) => ({ value: ans })),
                },
              },
            },
          },
        },
        updateMask: 'questionItem.question.grading',
        location: { index: startIndex + i },
      },
    });
  }

  return requests;
}

// ─── Create New Google Form ───

export async function createNewGoogleForm(
  userId: string,
  questions: BankQuestion[],
  config: ExportGoogleFormConfig
): Promise<ExportGoogleFormResult> {
  const formsClient = await getFormsClient(userId);

  // STEP 1: Create form with ONLY title
  const createResponse = await formsClient.forms.create({
    requestBody: { info: { title: config.formTitle } },
  });

  const formId = createResponse.data.formId;
  if (!formId) throw new Error('Google Forms API did not return a formId');

  // Map questions
  const { supported, unsupported } = mapQuestionsToGoogleForm(questions);
  if (supported.length === 0) {
    throw new Error('No supported questions to export. All questions are of unsupported types.');
  }

  // STEP 2: Setup — description + quiz mode (must happen BEFORE adding grading)
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

  // STEP 3: Create question items WITHOUT grading
  const questionRequests: Array<Record<string, unknown>> = [];
  for (let i = 0; i < supported.length; i++) {
    const result = buildItem(supported[i], i, config.shuffleOptions);
    if (result) {
      questionRequests.push({
        createItem: { item: result.item, location: result.location },
      });
    }
  }

  await executeWithRetry(async () => {
    return formsClient.forms.batchUpdate({ formId, requestBody: { requests: questionRequests } });
  });

  // STEP 4: Add grading via updateItem (only in quiz mode, AFTER items exist)
  if (config.createAsQuiz) {
    const gradingRequests = buildGradingUpdateRequests(supported, 0, true);
    if (gradingRequests.length > 0) {
      await executeWithRetry(async () => {
        return formsClient.forms.batchUpdate({ formId, requestBody: { requests: gradingRequests } });
      });
    }
  }

  // Build result
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
  if (!formId) throw new Error('existingFormId is required when formMode is "appendToExisting"');

  try {
    // Step 1: Get existing form (also validates it still exists)
    const existingForm = await executeWithRetry(async () => {
      return formsClient.forms.get({ formId });
    });
    const existingItems = existingForm.data.items || [];
    const startIndex = existingItems.length;

    // Map questions
    const { supported, unsupported } = mapQuestionsToGoogleForm(questions);
    if (supported.length === 0) {
      throw new Error('No supported questions to export. All questions are of unsupported types.');
    }

    // Step 2: Create question items WITHOUT grading
    const questionRequests: Array<Record<string, unknown>> = [];
    for (let i = 0; i < supported.length; i++) {
      const result = buildItem(supported[i], startIndex + i, config.shuffleOptions);
      if (result) {
        questionRequests.push({
          createItem: { item: result.item, location: result.location },
        });
      }
    }

    await executeWithRetry(async () => {
      return formsClient.forms.batchUpdate({ formId, requestBody: { requests: questionRequests } });
    });

    // Step 3: Add grading via updateItem (if quiz mode and form is already a quiz)
    // Check if the existing form has quiz settings
    const isFormQuiz = existingForm.data.settings?.quizSettings?.isQuiz || false;
    if (config.createAsQuiz && isFormQuiz) {
      const gradingRequests = buildGradingUpdateRequests(supported, startIndex, true);
      if (gradingRequests.length > 0) {
        await executeWithRetry(async () => {
          return formsClient.forms.batchUpdate({ formId, requestBody: { requests: gradingRequests } });
        });
      }
    }

    // Build result
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
    if (error.code === 404 || (error.message && error.message.includes('not found'))) {
      throw new Error(
        'The selected Google Form no longer exists. It may have been deleted. Please refresh the list and select a different form.'
      );
    }
    throw err;
  }
}

// ─── List User's Google Forms (excluding deleted/trashed) ───

export async function listUserGoogleForms(
  userId: string,
  pageToken?: string
): Promise<{ forms: GoogleFormListItem[]; nextPageToken?: string }> {
  const driveClient = await getDriveClient(userId);

  const response = await executeWithRetry(async () => {
    return driveClient.files.list({
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

      if (isAuthError || isNotFound || attempt === maxRetries - 1) throw err;

      console.warn(`[Google Forms API] Error attempt ${attempt + 1}: ${error.message}. Waiting ${delay}ms...`);
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

  if (questionIds.length > 0) query = query.in('id', questionIds);
  else if (bankIds && bankIds.length > 0) query = query.in('bank_id', bankIds);

  const { data: questions, error } = await query.order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch questions: ${error.message}`);
  if (!questions || questions.length === 0) throw new Error('No questions found');

  if (bankIds && bankIds.length > 0) {
    const { data: banks, error: banksError } = await supabaseServer
      .from('question_banks').select('id, teacher_id').in('id', bankIds);
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
