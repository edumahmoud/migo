// ============================================================
// Google Forms Integration Types
// Strict TypeScript definitions for the entire feature
// ============================================================

import type { BankQuestion } from '@/lib/types';

// ─── Google OAuth Types ───

/** Required Google OAuth scopes for Forms API */
export const GOOGLE_FORMS_SCOPES = [
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

export type GoogleFormsScope = typeof GOOGLE_FORMS_SCOPES[number];

/** OAuth token record stored in google_oauth_tokens table */
export interface GoogleOAuthTokenRecord {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string; // ISO date string
  scope: string;
  created_at: string;
  updated_at: string;
}

/** Status of Google authorization for a user */
export interface GoogleAuthStatus {
  isAuthorized: boolean;
  hasFormsScope: boolean;
  needsIncrementalAuth: boolean;
  configured?: boolean; // Whether Google OAuth env vars are set
  authUrl?: string;
  tokenExpiry?: string;
}

// ─── Google Forms Types ───

/** Google Forms API question item kind */
export type GoogleFormItemKind =
  | 'choiceQuestion'      // Multiple Choice, Dropdown, Checkboxes
  | 'textQuestion'        // Short Answer, Paragraph
  | 'scaleQuestion'       // Scale (1-5, etc.) — not directly mapped
  | 'dateQuestion'        // Date — not directly mapped
  | 'timeQuestion'        // Time — not directly mapped
  | 'fileUploadQuestion'  // File Upload — not supported
  | 'rowQuestion'         // Grid — not directly mapped
  | 'questionGroupItem';  // Question group — not supported

/** Google Forms choice question type */
export type GoogleFormChoiceType =
  | 'RADIO'        // Single select → MCQ, True/False
  | 'CHECKBOX'     // Multi select → Checkboxes
  | 'DROP_DOWN';   // Dropdown

/** Google Forms text question type */
export type GoogleFormTextType =
  | 'SHORT_TEXT'   // Short Answer → Completion
  | 'PARAGRAPH';   // Paragraph (long answer)

/** Mapping result for a single AttenDo question → Google Form question */
export interface QuestionMappingResult {
  originalQuestion: BankQuestion;
  mappingType: 'supported' | 'unsupported' | 'partial';
  googleFormType: GoogleFormItemKind | null;
  googleFormChoiceType?: GoogleFormChoiceType;
  googleFormTextType?: GoogleFormTextType;
  reason?: string; // Why it's unsupported or partially supported
}

// ─── Export Request Types ───

/** Configuration options for the Google Form export */
export interface ExportGoogleFormConfig {
  formTitle: string;
  formDescription?: string;
  createAsQuiz: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  collectEmailAddresses: boolean;
  limitToOrganization: boolean;
  formMode: 'createNew' | 'appendToExisting';
  existingFormId?: string; // Required when formMode === 'appendToExisting'
}

/** The full export request payload sent to the API */
export interface ExportGoogleFormRequest {
  questionIds: string[];
  bankIds?: string[];
  config: ExportGoogleFormConfig;
}

// ─── Export Response Types ───

/** Result of a successful Google Form export */
export interface ExportGoogleFormResult {
  formId: string;
  editUrl: string;
  responderUrl: string;
  questionsExported: number;
  questionsSkipped: number;
  unsupportedQuestions: UnsupportedQuestionInfo[];
}

/** Details about questions that couldn't be mapped */
export interface UnsupportedQuestionInfo {
  questionId: string;
  questionType: string;
  questionText: string;
  reason: string;
}

/** Full API response structure */
export interface ExportGoogleFormResponse {
  success: boolean;
  data?: ExportGoogleFormResult;
  error?: string;
  authRequired?: boolean;
  authUrl?: string;
}

// ─── Google Form List Types ───

/** A Google Form item from the Drive API list */
export interface GoogleFormListItem {
  id: string;
  title: string;
  description?: string;
  createdTime?: string;
  modifiedTime?: string;
  responderUrl?: string;
  editUrl?: string;
}

/** Response from the list Google Forms API */
export interface ListGoogleFormsResponse {
  success: boolean;
  forms?: GoogleFormListItem[];
  error?: string;
  nextPageToken?: string;
  authRequired?: boolean;
  authUrl?: string;
}

// ─── Question Type Mapping ───

/**
 * Maps AttenDo question types to Google Forms question types.
 *
 * Supported mappings:
 * - mcq         → RADIO (Multiple Choice) or CHECKBOX (if multi-answer)
 * - boolean     → RADIO (True/False)
 * - completion  → SHORT_TEXT (Short Answer)
 * - matching    → UNSUPPORTED (no direct Google Forms equivalent)
 *
 * Matching questions are unsupported because Google Forms
 * has no built-in matching/pairs question type.
 */
export const QUESTION_TYPE_MAPPING: Record<
  BankQuestion['type'],
  { kind: GoogleFormItemKind; choiceType?: GoogleFormChoiceType; textType?: GoogleFormTextType; supported: boolean; reason?: string }
> = {
  mcq: {
    kind: 'choiceQuestion',
    choiceType: 'RADIO',
    supported: true,
  },
  boolean: {
    kind: 'choiceQuestion',
    choiceType: 'RADIO',
    supported: true,
    reason: 'Mapped as True/False single-choice question',
  },
  completion: {
    kind: 'textQuestion',
    textType: 'SHORT_TEXT',
    supported: true,
    reason: 'Mapped as short answer question (no auto-grading for text answers)',
  },
  matching: {
    kind: 'questionGroupItem',
    supported: false,
    reason: 'Google Forms has no matching/pairs question type. Exported as unsupported.',
  },
};

// ─── Progress Types ───

/** Export progress state for the UI */
export interface ExportProgress {
  stage: 'idle' | 'authenticating' | 'preparing' | 'creating' | 'inserting' | 'configuring' | 'complete' | 'error';
  currentStep: number;
  totalSteps: number;
  message: string;
}

/** Hook state for Google Forms feature */
export interface UseGoogleFormsState {
  authStatus: GoogleAuthStatus | null;
  isLoadingAuth: boolean;
  isLoadingForms: boolean;
  isExporting: boolean;
  exportProgress: ExportProgress;
  userForms: GoogleFormListItem[];
  exportResult: ExportGoogleFormResult | null;
  error: string | null;
}

// ─── Callback Types ───

/** Callback when the auth callback receives tokens */
export interface GoogleAuthCallbackResult {
  success: boolean;
  error?: string;
}
