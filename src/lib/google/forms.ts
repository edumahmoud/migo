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
// MATCHING QUESTION EXPANSION:
// Matching questions are expanded into multiple dropdown questions.
// Each pair (key → value) becomes one DROP_DOWN question:
//   - Title: "[Original Question Title] — [key]"
//   - Options: All values from all pairs (dropdown choices)
//   - Correct answer: The matching value for that key
//   - Question title is bold-style: prefixed with ★ for visual emphasis
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
  ExportedQuestionDetail,
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
  questions: BankQuestion[],
  enabledTypes?: BankQuestion['type'][]
): { supported: QuestionMappingResult[]; unsupported: UnsupportedQuestionInfo[] } {
  const supported: QuestionMappingResult[] = [];
  const unsupported: UnsupportedQuestionInfo[] = [];
  for (const question of questions) {
    // Filter by enabled types if specified
    if (enabledTypes && !enabledTypes.includes(question.type)) {
      unsupported.push({
        questionId: question.id,
        questionType: question.type,
        questionText: question.question,
        reason: `Question type '${question.type}' was excluded from export`,
      });
      continue;
    }

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
    case 'boolean': {
      // correct_answer is stored in Arabic: 'صح' (True) or 'خطأ' (False)
      // Also handle English 'true'/'false' for compatibility
      const ans = question.correct_answer.trim();
      if (ans === 'صح' || ans === 'صواب' || ans.toLowerCase() === 'true') {
        return ['صح'];
      } else {
        return ['خطأ'];
      }
    }
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

// Build a bold-style title for Google Forms
// Google Forms renders question titles in bold by default in the form UI.
// We add a visual prefix ★ to make titles stand out more prominently.
function buildBoldTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim() || 'Untitled Question';
  // Add bold emphasis prefix for better visibility
  return `★ ${trimmed}`;
}

function buildItem(
  mapping: QuestionMappingResult,
  index: number,
  shuffleOptions: boolean
): BuildItemResult | null {
  const question = mapping.originalQuestion;
  const questionText = buildBoldTitle(question.question);
  let questionDetails: Record<string, unknown>;

  switch (mapping.googleFormType) {
    case 'choiceQuestion': {
      const choiceType = mapping.googleFormChoiceType || 'RADIO';
      let options: Array<{ value: string }> = [];

      if (question.type === 'mcq') {
        options = (question.options || []).map((opt) => ({ value: opt }));
      } else if (question.type === 'boolean') {
        // Use Arabic labels matching the database storage format
        options = [{ value: 'صح' }, { value: 'خطأ' }];
      } else if (question.type === 'matching') {
        // Matching questions are handled by buildMatchingPairItems
        return null;
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

  const item: Record<string, unknown> = {
    title: questionText,
    questionItem: {
      question: questionDetails,
    },
  };

  return { item, location: { index } };
}

// ─── Build Matching Pair Items ───
// Each matching question is expanded into multiple DROP_DOWN questions.
// Each pair (key → value) becomes one dropdown question.

interface MatchingPairItem {
  requests: Array<Record<string, unknown>>;  // createItem requests
  gradingRequests: Array<Record<string, unknown>>;  // updateItem grading requests (for quiz mode)
  pairCount: number;  // Number of pairs (items) created
}

function buildMatchingPairItems(
  question: BankQuestion,
  startIndex: number,
  shuffleOptions: boolean,
  isQuiz: boolean,
  pointValue: number = 1
): MatchingPairItem {
  const pairs = question.pairs || [];
  const parentTitle = question.question || 'Matching Question';
  const allRightSides = pairs.map((pair) => pair.value);

  const requests: Array<Record<string, unknown>> = [];
  const gradingRequests: Array<Record<string, unknown>> = [];

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const leftSide = pair.key;
    const rightSide = pair.value;

    // Bold title: ★ [Parent Title] — [Left Side]
    const pairTitle = buildBoldTitle(`${parentTitle} — ${leftSide}`);

    // Create a DROP_DOWN question with all values as options
    const item: Record<string, unknown> = {
      title: pairTitle,
      questionItem: {
        question: {
          required: true,
          choiceQuestion: {
            type: 'DROP_DOWN',
            options: allRightSides.map((rs) => ({ value: rs })),
            shuffle: shuffleOptions,
          },
        },
      },
    };

    requests.push({
      createItem: { item, location: { index: startIndex + i } },
    });

    // Build grading request (for quiz mode, applied AFTER creation via updateItem)
    if (isQuiz && rightSide) {
      gradingRequests.push({
        updateItem: {
          item: {
            questionItem: {
              question: {
                grading: {
                  pointValue,
                  correctAnswers: {
                    answers: [{ value: rightSide }],
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
  }

  return { requests, gradingRequests, pairCount: pairs.length };
}

// ─── Build grading updateItem requests ───
// Called AFTER items are created, to add grading to existing items
// NOTE: Only for non-matching questions. Matching grading is handled separately.

function buildGradingUpdateRequests(
  supported: QuestionMappingResult[],
  startIndex: number,
  isQuiz: boolean,
  matchingOffsetMap: Map<string, number>, // questionId → number of extra items (matching pairs)
  pointValuesByType?: Partial<Record<BankQuestion['type'], number>>
): Array<Record<string, unknown>> {
  if (!isQuiz) return [];

  const requests: Array<Record<string, unknown>> = [];
  let currentIndex = startIndex;

  for (let i = 0; i < supported.length; i++) {
    const question = supported[i].originalQuestion;

    // Skip matching questions — they have their own grading built in buildMatchingPairItems
    if (question.type === 'matching') {
      const pairCount = matchingOffsetMap.get(question.id) || 0;
      currentIndex += pairCount; // Advance index by the number of pairs
      continue;
    }

    const correctAnswers = getCorrectAnswers(question);
    if (correctAnswers.length === 0) {
      currentIndex += 1;
      continue;
    }

    // Use custom point value for this question type, or default 1
    const pointValue = pointValuesByType?.[question.type] ?? 1;

    requests.push({
      updateItem: {
        item: {
          questionItem: {
            question: {
              grading: {
                pointValue,
                correctAnswers: {
                  answers: correctAnswers.map((ans) => ({ value: ans })),
                },
              },
            },
          },
        },
        updateMask: 'questionItem.question.grading',
        location: { index: currentIndex },
      },
    });
    currentIndex += 1;
  }

  return requests;
}

// ─── Build all question items (including matching expansion) ───

interface BuildAllItemsResult {
  questionRequests: Array<Record<string, unknown>>;
  allGradingRequests: Array<Record<string, unknown>>;
  exportedQuestions: ExportedQuestionDetail[];
  totalItemCount: number; // Total number of Google Form items created
  matchingOffsetMap: Map<string, number>; // questionId → pair count
}

function buildAllQuestionItems(
  supported: QuestionMappingResult[],
  startIndex: number,
  config: ExportGoogleFormConfig
): BuildAllItemsResult {
  const questionRequests: Array<Record<string, unknown>> = [];
  const allGradingRequests: Array<Record<string, unknown>> = [];
  const exportedQuestions: ExportedQuestionDetail[] = [];
  const matchingOffsetMap = new Map<string, number>();

  let currentIndex = startIndex;

  for (const mapping of supported) {
    const question = mapping.originalQuestion;

    if (question.type === 'matching') {
      // Expand matching question into multiple dropdown questions
      const matchingPointValue = config.pointValuesByType?.matching ?? 1;
      const pairResult = buildMatchingPairItems(
        question,
        currentIndex,
        config.shuffleOptions,
        config.createAsQuiz,
        matchingPointValue
      );

      questionRequests.push(...pairResult.requests);
      allGradingRequests.push(...pairResult.gradingRequests);
      matchingOffsetMap.set(question.id, pairResult.pairCount);

      // Record exported question detail
      exportedQuestions.push({
        questionId: question.id,
        questionType: 'matching',
        questionTitle: question.question,
        googleFormType: `DROP_DOWN (${pairResult.pairCount} pairs)`,
      });

      currentIndex += pairResult.pairCount;
    } else {
      // Regular question
      const result = buildItem(mapping, currentIndex, config.shuffleOptions);
      if (result) {
        questionRequests.push({
          createItem: { item: result.item, location: result.location },
        });

        const googleFormType = mapping.googleFormType === 'choiceQuestion'
          ? mapping.googleFormChoiceType || 'RADIO'
          : mapping.googleFormTextType || 'SHORT_TEXT';

        exportedQuestions.push({
          questionId: question.id,
          questionType: question.type,
          questionTitle: question.question,
          googleFormType,
        });

        currentIndex += 1;
      }
    }
  }

  // Add grading for non-matching questions
  const regularGrading = buildGradingUpdateRequests(
    supported,
    startIndex,
    config.createAsQuiz,
    matchingOffsetMap,
    config.pointValuesByType
  );
  allGradingRequests.push(...regularGrading);

  return {
    questionRequests,
    allGradingRequests,
    exportedQuestions,
    totalItemCount: currentIndex - startIndex,
    matchingOffsetMap,
  };
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

  // Map questions with type filtering
  const { supported, unsupported } = mapQuestionsToGoogleForm(questions, config.enabledQuestionTypes);
  if (supported.length === 0) {
    throw new Error('No supported questions to export. All questions are of unsupported types or excluded by filter.');
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

  // STEP 3: Create ALL question items (including matching expansion) WITHOUT grading
  const buildResult = buildAllQuestionItems(supported, 0, config);

  if (buildResult.questionRequests.length > 0) {
    await executeWithRetry(async () => {
      return formsClient.forms.batchUpdate({ formId, requestBody: { requests: buildResult.questionRequests } });
    });
  }

  // STEP 4: Add grading via updateItem (only in quiz mode, AFTER items exist)
  if (config.createAsQuiz && buildResult.allGradingRequests.length > 0) {
    await executeWithRetry(async () => {
      return formsClient.forms.batchUpdate({ formId, requestBody: { requests: buildResult.allGradingRequests } });
    });
  }

  // Build result
  return {
    formId,
    editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
    responderUrl: `https://docs.google.com/forms/d/${formId}/viewform`,
    questionsExported: buildResult.totalItemCount,
    questionsSkipped: unsupported.length,
    unsupportedQuestions: unsupported,
    exportedQuestions: buildResult.exportedQuestions,
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

    // Map questions with type filtering
    const { supported, unsupported } = mapQuestionsToGoogleForm(questions, config.enabledQuestionTypes);
    if (supported.length === 0) {
      throw new Error('No supported questions to export. All questions are of unsupported types or excluded by filter.');
    }

    // Step 2: Create ALL question items (including matching expansion) WITHOUT grading
    const buildResult = buildAllQuestionItems(supported, startIndex, config);

    if (buildResult.questionRequests.length > 0) {
      await executeWithRetry(async () => {
        return formsClient.forms.batchUpdate({ formId, requestBody: { requests: buildResult.questionRequests } });
      });
    }

    // Step 3: Add grading via updateItem (if quiz mode and form is already a quiz)
    const isFormQuiz = existingForm.data.settings?.quizSettings?.isQuiz || false;
    if (config.createAsQuiz && isFormQuiz && buildResult.allGradingRequests.length > 0) {
      await executeWithRetry(async () => {
        return formsClient.forms.batchUpdate({ formId, requestBody: { requests: buildResult.allGradingRequests } });
      });
    }

    // Build result
    return {
      formId,
      editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
      responderUrl: `https://docs.google.com/forms/d/${formId}/viewform`,
      questionsExported: buildResult.totalItemCount,
      questionsSkipped: unsupported.length,
      unsupportedQuestions: unsupported,
      exportedQuestions: buildResult.exportedQuestions,
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
