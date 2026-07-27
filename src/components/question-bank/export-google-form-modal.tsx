'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  X,
  ShieldCheck,
  FileText,
  Settings,
  Rocket,
  Link,
  ListFilter,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import { useGoogleForms } from '@/hooks/useGoogleForms';
import { ALL_QUESTION_TYPES, QUESTION_TYPE_MAPPING } from '@/types/googleForms';
import type { ExportGoogleFormConfig } from '@/types/googleForms';
import type { BankQuestion as BankQuestionType } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogScrollArea,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Props ───

interface ExportGoogleFormModalProps {
  open: boolean;
  onClose: () => void;
  selectedQuestionIds: string[];
  selectedBankIds: string[];
  totalQuestionCount: number;
  /** Map of question type → count for the selected questions */
  questionTypeCounts?: Record<string, number>;
}

// ─── Stage enum ───

type ModalStage = 'auth-check' | 'config' | 'progress' | 'success' | 'error';

// ─── Question type labels ───

function getQuestionTypeLabel(type: BankQuestionType['type'], t: (key: string) => string): string {
  switch (type) {
    case 'mcq':
      return t('questionBank.typeMcq') || 'Multiple Choice (MCQ)';
    case 'boolean':
      return t('questionBank.typeBoolean') || 'True/False';
    case 'completion':
      return t('questionBank.typeCompletion') || 'Completion (Short Answer)';
    case 'matching':
      return t('questionBank.typeMatching') || 'Matching';
    default:
      return type;
  }
}

function getGoogleFormTypeLabel(type: BankQuestionType['type']): string {
  const mapping = QUESTION_TYPE_MAPPING[type];
  if (!mapping) return 'Unsupported';
  if (type === 'matching') return 'DROP_DOWN (pairs expanded)';
  if (mapping.kind === 'choiceQuestion') return mapping.choiceType || 'RADIO';
  if (mapping.kind === 'textQuestion') return mapping.textType || 'SHORT_TEXT';
  return mapping.kind;
}

// ─── Google icon SVG ───

function GoogleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.57-3.57C18.46 2.09 15.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// ─── Animation variants ───

const stageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

// ─── Progress stage labels ───

function getProgressStageLabel(stage: string, t: (key: string) => string): string {
  switch (stage) {
    case 'idle': return t('questionBank.googleFormsProgressIdle') || 'Ready';
    case 'authenticating': return t('questionBank.googleFormsProgressAuth') || 'Verifying authorization...';
    case 'preparing': return t('questionBank.googleFormsProgressPreparing') || 'Preparing export...';
    case 'creating': return t('questionBank.googleFormsProgressCreating') || 'Creating form...';
    case 'inserting': return t('questionBank.googleFormsProgressInserting') || 'Inserting questions...';
    case 'configuring': return t('questionBank.googleFormsProgressConfiguring') || 'Configuring settings...';
    case 'complete': return t('questionBank.googleFormsProgressComplete') || 'Export complete!';
    case 'error': return t('questionBank.googleFormsProgressError') || 'Export failed';
    default: return stage;
  }
}

// ─── Main Component ───

export default function ExportGoogleFormModal({
  open,
  onClose,
  selectedQuestionIds,
  selectedBankIds,
  totalQuestionCount,
  questionTypeCounts,
}: ExportGoogleFormModalProps) {
  const { t, direction } = useTranslations();
  const {
    authStatus,
    isLoadingAuth,
    isLoadingForms,
    isExporting,
    exportProgress,
    userForms,
    exportResult,
    error,
    authJustCompleted,
    checkAuth,
    loadUserForms,
    exportToGoogleForm,
    startIncrementalAuth,
    reset,
  } = useGoogleForms();

  // ─── Local form state ───

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [createAsQuiz, setCreateAsQuiz] = useState(false);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [collectEmailAddresses, setCollectEmailAddresses] = useState(false);
  const [formMode, setFormMode] = useState<'createNew' | 'appendToExisting'>('createNew');
  const [existingFormId, setExistingFormId] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // ─── Question type selection state ───
  // Default: all types enabled
  const [enabledQuestionTypes, setEnabledQuestionTypes] = useState<BankQuestionType['type'][]>(
    [...ALL_QUESTION_TYPES]
  );

  // ─── Point values per question type (default = 1 for each) ───

  const [pointValuesByType, setPointValuesByType] = useState<Partial<Record<BankQuestionType['type'], number>>>({
    mcq: 1,
    boolean: 1,
    completion: 1,
    matching: 1,
  });

  const handlePointValueChange = useCallback((type: BankQuestionType['type'], value: string) => {
    const num = parseInt(value, 10);
    if (num > 0 && num <= 100) {
      setPointValuesByType(prev => ({ ...prev, [type]: num }));
    }
  }, []);

  // ─── Count of questions that will be exported (based on type filter) ───

  const filteredQuestionCount = useMemo(() => {
    if (!questionTypeCounts) return totalQuestionCount;
    let count = 0;
    for (const type of enabledQuestionTypes) {
      count += questionTypeCounts[type] || 0;
    }
    return count;
  }, [questionTypeCounts, enabledQuestionTypes, totalQuestionCount]);

  // ─── Show success toast when auth just completed ───

  useEffect(() => {
    if (authJustCompleted && open) {
      toast.success(t('questionBank.googleFormsAuthSuccess') || 'Google Forms authorization successful!');
    }
  }, [authJustCompleted, open, t]);

  // ─── Determine current stage (derived from hook state) ───

  const currentStage: ModalStage = useMemo(() => {
    if (exportResult) return 'success';
    if (isExporting) return 'progress';
    if (error) return 'error';
    if (authStatus?.isAuthorized && authStatus?.hasFormsScope) return 'config';
    return 'auth-check';
  }, [exportResult, isExporting, error, authStatus]);

  // ─── Reset on close ───

  const handleClose = useCallback(() => {
    reset();
    setFormTitle('');
    setFormDescription('');
    setCreateAsQuiz(false);
    setShuffleQuestions(false);
    setShuffleOptions(false);
    setCollectEmailAddresses(false);
    setFormMode('createNew');
    setExistingFormId('');
    setCopiedLink(false);
    setEnabledQuestionTypes([...ALL_QUESTION_TYPES]);
    setPointValuesByType({ mcq: 1, boolean: 1, completion: 1, matching: 1 });
    onClose();
  }, [reset, onClose]);

  // ─── Handle question type toggle ───

  const handleToggleQuestionType = useCallback((type: BankQuestionType['type'], checked: boolean) => {
    if (checked) {
      setEnabledQuestionTypes(prev => [...prev, type]);
    } else {
      setEnabledQuestionTypes(prev => prev.filter(t => t !== type));
    }
  }, []);

  // ─── Load user forms when append mode selected ───

  useEffect(() => {
    if (formMode === 'appendToExisting' && currentStage === 'config' && userForms.length === 0 && !isLoadingForms) {
      loadUserForms();
    }
  }, [formMode, currentStage, userForms.length, isLoadingForms, loadUserForms]);

  // ─── Handle export ───

  const handleExport = useCallback(async () => {
    if (!formTitle.trim()) {
      toast.error(t('questionBank.googleFormsTitleRequired') || 'Form title is required');
      return;
    }

    if (formMode === 'appendToExisting' && !existingFormId) {
      toast.error(t('questionBank.googleFormsSelectExisting') || 'Select an existing form');
      return;
    }

    if (enabledQuestionTypes.length === 0) {
      toast.error(t('questionBank.googleFormsNoTypesSelected') || 'Select at least one question type');
      return;
    }

    const config: ExportGoogleFormConfig = {
      formTitle: formTitle.trim(),
      formDescription: formDescription.trim() || undefined,
      createAsQuiz,
      shuffleQuestions,
      shuffleOptions,
      collectEmailAddresses,
      limitToOrganization: false,
      formMode,
      existingFormId: formMode === 'appendToExisting' ? existingFormId : undefined,
      enabledQuestionTypes,
      pointValuesByType: createAsQuiz ? pointValuesByType : undefined,
    };

    await exportToGoogleForm(selectedQuestionIds, selectedBankIds, config);
  }, [
    formTitle, formDescription, createAsQuiz, shuffleQuestions, shuffleOptions,
    collectEmailAddresses, formMode, existingFormId, enabledQuestionTypes,
    pointValuesByType, selectedQuestionIds, selectedBankIds, exportToGoogleForm, t,
  ]);

  // ─── Handle retry ───

  const handleRetryAuth = useCallback(async () => {
    reset();
    await checkAuth();
  }, [reset, checkAuth]);

  // ─── Handle copy link ───

  const handleCopyLink = useCallback(async () => {
    if (!exportResult?.responderUrl) return;
    try {
      await navigator.clipboard.writeText(exportResult.responderUrl);
      setCopiedLink(true);
      toast.success(t('questionBank.googleFormsLinkCopied') || 'Link copied!');
      setTimeout(() => setCopiedLink(false), 3000);
    } catch {
      toast.error(t('questionBank.googleFormsCopyFailed') || 'Failed to copy link');
    }
  }, [exportResult, t]);

  // ─── Progress percentage ───

  const progressPercent = exportProgress.stage === 'idle'
    ? 0
    : exportProgress.stage === 'complete'
      ? 100
      : exportProgress.stage === 'error'
        ? 0
        : Math.round((exportProgress.currentStep / exportProgress.totalSteps) * 100);

  // ─── Render stages ───

  const renderAuthCheckStage = () => (
    <motion.div
      key="auth-check"
      variants={stageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col items-center text-center py-8 space-y-5"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30">
        <ShieldCheck className="h-8 w-8 text-sky-700 dark:text-sky-400" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h3 className="text-lg font-semibold text-foreground">
          {t('questionBank.googleFormsAuthTitle') || 'Google Forms Authorization'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('questionBank.googleFormsAuthDesc') || 'You need to authorize access to Google Forms API before exporting. This allows AttenDo to create and configure forms on your behalf.'}
        </p>
      </div>
      {isLoadingAuth ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('questionBank.googleFormsCheckingAuth') || 'Checking authorization...'}
        </div>
      ) : authStatus?.configured === false ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-900/15 p-4 text-sm text-amber-700 dark:text-amber-400 max-w-sm">
          {t('questionBank.googleFormsNotConfigured') || 'Google Forms integration is not configured. Please set up Google OAuth credentials in the admin settings.'}
        </div>
      ) : (
        <Button
          onClick={startIncrementalAuth}
          className="gap-2 bg-sky-700 hover:bg-sky-800 text-white"
        >
          <GoogleIcon className="h-4 w-4" />
          {t('questionBank.googleFormsAuthorize') || 'Authorize Google Forms'}
        </Button>
      )}
    </motion.div>
  );

  const renderConfigStage = () => (
    <motion.div
      key="config"
      variants={stageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="space-y-5"
    >
      {/* Question count info */}
      <div className="rounded-lg border bg-sky-50 dark:bg-sky-900/15 border-sky-200 dark:border-sky-900/60 p-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-sky-700 dark:text-sky-400" />
          <span className="text-sm font-medium text-sky-800 dark:text-sky-400">
            {t('questionBank.googleFormsQuestionCount') || 'Questions to export'}
            : {filteredQuestionCount} / {totalQuestionCount}
          </span>
        </div>
      </div>

      {/* Question Type Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-foreground flex items-center gap-2" dir={direction}>
          <ListFilter className="h-4 w-4" />
          {t('questionBank.googleFormsQuestionTypeFilter') || 'Select Question Types to Export'}
        </Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {ALL_QUESTION_TYPES.map((type) => {
            const count = questionTypeCounts?.[type] || 0;
            const mapping = QUESTION_TYPE_MAPPING[type];
            const isSupported = mapping?.supported;
            const googleFormLabel = getGoogleFormTypeLabel(type);
            const isChecked = enabledQuestionTypes.includes(type);
            const pointValue = pointValuesByType[type] ?? 1;

            return (
              <div
                key={type}
                className={`flex items-start gap-2.5 p-3 rounded-lg border transition-colors ${
                  isChecked
                    ? 'border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-900/15'
                    : 'border-border bg-background'
                }`}
              >
                <Checkbox
                  id={`type-${type}`}
                  checked={isChecked}
                  onCheckedChange={(checked) => handleToggleQuestionType(type, checked === true)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <Label htmlFor={`type-${type}`} className="text-sm font-semibold cursor-pointer" dir={direction}>
                    {getQuestionTypeLabel(type, t)}
                  </Label>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant="secondary" className="text-xs h-5 px-1.5">
                      {count} {t('questionBank.googleFormsQuestionCountUnit') || 'questions'}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      → {googleFormLabel}
                    </span>
                  </div>
                  {type === 'matching' && isSupported && (
                    <p className="text-xs text-sky-700 dark:text-sky-400 mt-1">
                      {t('questionBank.googleFormsMatchingConverted') || 'Each pair becomes a dropdown question'}
                    </p>
                  )}
                  {!isSupported && (
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                      {mapping?.reason}
                    </p>
                  )}
                  {/* Point value input (only visible when quiz mode + type is checked) */}
                  {isChecked && createAsQuiz && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Label htmlFor={`points-${type}`} className="text-xs text-muted-foreground whitespace-nowrap" dir={direction}>
                        {t('questionBank.googleFormsPointValue') || 'Points'}:
                      </Label>
                      <Input
                        id={`points-${type}`}
                        type="number"
                        min={1}
                        max={100}
                        value={pointValue}
                        onChange={(e) => handlePointValueChange(type, e.target.value)}
                        className="h-6 w-16 text-xs px-1.5 py-0"
                        dir="ltr"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {enabledQuestionTypes.length === 0 && (
          <p className="text-xs text-rose-600 dark:text-rose-500 mt-1">
            {t('questionBank.googleFormsNoTypesSelected') || 'Select at least one question type to export'}
          </p>
        )}
      </div>

      {/* Form Title */}
      <div className="space-y-1.5">
        <Label dir={direction}>
          {t('questionBank.googleFormsFormTitle') || 'Form Title'}
          <span className="text-rose-500 ms-1">*</span>
        </Label>
        <Input
          value={formTitle}
          onChange={(e) => setFormTitle(e.target.value)}
          placeholder={t('questionBank.googleFormsFormTitlePlaceholder') || 'Enter form title'}
          dir={direction}
        />
      </div>

      {/* Form Description */}
      <div className="space-y-1.5">
        <Label dir={direction}>
          {t('questionBank.googleFormsFormDescription') || 'Form Description (optional)'}
        </Label>
        <Textarea
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
          placeholder={t('questionBank.googleFormsFormDescriptionPlaceholder') || 'Enter form description'}
          rows={3}
          dir={direction}
        />
      </div>

      {/* Options checkboxes */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-foreground" dir={direction}>
          {t('questionBank.googleFormsOptions') || 'Form Options'}
        </Label>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="createAsQuiz"
              checked={createAsQuiz}
              onCheckedChange={(checked) => setCreateAsQuiz(checked === true)}
            />
            <Label htmlFor="createAsQuiz" className="text-sm cursor-pointer" dir={direction}>
              {t('questionBank.googleFormsCreateAsQuiz') || 'Create as Quiz (graded)'}
            </Label>
          </div>
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="shuffleQuestions"
              checked={shuffleQuestions}
              onCheckedChange={(checked) => setShuffleQuestions(checked === true)}
            />
            <Label htmlFor="shuffleQuestions" className="text-sm cursor-pointer" dir={direction}>
              {t('questionBank.googleFormsShuffleQuestions') || 'Shuffle Questions'}
            </Label>
          </div>
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="shuffleOptions"
              checked={shuffleOptions}
              onCheckedChange={(checked) => setShuffleOptions(checked === true)}
            />
            <Label htmlFor="shuffleOptions" className="text-sm cursor-pointer" dir={direction}>
              {t('questionBank.googleFormsShuffleOptions') || 'Shuffle Options'}
            </Label>
          </div>
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="collectEmail"
              checked={collectEmailAddresses}
              onCheckedChange={(checked) => setCollectEmailAddresses(checked === true)}
            />
            <Label htmlFor="collectEmail" className="text-sm cursor-pointer" dir={direction}>
              {t('questionBank.googleFormsCollectEmail') || 'Collect Email Addresses'}
            </Label>
          </div>
        </div>
      </div>

      {/* Form Mode radio */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-foreground" dir={direction}>
          {t('questionBank.googleFormsMode') || 'Export Mode'}
        </Label>
        <RadioGroup
          value={formMode}
          onValueChange={(value) => setFormMode(value as 'createNew' | 'appendToExisting')}
          dir={direction}
        >
          <div className="flex items-center gap-2.5">
            <RadioGroupItem value="createNew" id="createNew" />
            <Label htmlFor="createNew" className="text-sm cursor-pointer" dir={direction}>
              {t('questionBank.googleFormsCreateNew') || 'Create New Google Form'}
            </Label>
          </div>
          <div className="flex items-center gap-2.5">
            <RadioGroupItem value="appendToExisting" id="appendToExisting" />
            <Label htmlFor="appendToExisting" className="text-sm cursor-pointer" dir={direction}>
              {t('questionBank.googleFormsAppend') || 'Append to Existing Google Form'}
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Existing form select */}
      <AnimatePresence>
        {formMode === 'appendToExisting' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-1.5 overflow-hidden"
          >
            <Label dir={direction}>
              {t('questionBank.googleFormsSelectForm') || 'Select Existing Form'}
              <span className="text-rose-500 ms-1">*</span>
            </Label>
            {isLoadingForms ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('questionBank.googleFormsLoadingForms') || 'Loading your forms...'}
              </div>
            ) : userForms.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {t('questionBank.googleFormsNoForms') || 'No Google Forms found'}
              </div>
            ) : (
              <Select value={existingFormId} onValueChange={setExistingFormId} dir={direction}>
                <SelectTrigger className="w-full" dir={direction}>
                  <SelectValue placeholder={t('questionBank.googleFormsSelectFormPlaceholder') || 'Choose a form'} />
                </SelectTrigger>
                <SelectContent dir={direction}>
                  {userForms.map((form) => (
                    <SelectItem key={form.id} value={form.id}>
                      {form.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  const renderProgressStage = () => (
    <motion.div
      key="progress"
      variants={stageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col items-center text-center py-8 space-y-6"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30">
        <Rocket className="h-8 w-8 text-sky-700 dark:text-sky-400 animate-pulse" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h3 className="text-lg font-semibold text-foreground">
          {t('questionBank.googleFormsExporting') || 'Exporting to Google Forms...'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {getProgressStageLabel(exportProgress.stage, t)}
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2">
        <Progress value={progressPercent} className="h-2.5" />
        <p className="text-xs text-muted-foreground text-center">
          {exportProgress.currentStep} / {exportProgress.totalSteps}
          — {exportProgress.message || getProgressStageLabel(exportProgress.stage, t)}
        </p>
      </div>
    </motion.div>
  );

  const renderSuccessStage = () => (
    <motion.div
      key="success"
      variants={stageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col items-center text-center py-6 space-y-5"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
        <CheckCircle2 className="h-8 w-8 text-emerald-700 dark:text-emerald-500" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h3 className="text-lg font-semibold text-foreground">
          {t('questionBank.googleFormsExportSuccess') || 'Export Successful!'}
        </h3>
        <div className="flex items-center justify-center gap-4 text-sm">
          <span className="text-emerald-700 dark:text-emerald-500 font-medium">
            {t('questionBank.googleFormsExported') || 'Exported'}: {exportResult?.questionsExported ?? 0}
          </span>
          {(exportResult?.questionsSkipped ?? 0) > 0 && (
            <span className="text-amber-600 dark:text-amber-500 font-medium">
              {t('questionBank.googleFormsSkipped') || 'Skipped'}: {exportResult?.questionsSkipped ?? 0}
            </span>
          )}
        </div>
      </div>

      {/* Exported questions list with bold titles */}
      {exportResult?.exportedQuestions && exportResult.exportedQuestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-900/15 p-3"
        >
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-sky-700 dark:text-sky-400" />
            <span className="text-sm font-semibold text-sky-700 dark:text-sky-400">
              {t('questionBank.googleFormsExportedQuestionsList') || 'Exported Questions'}
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1.5 custom-scrollbar">
            {exportResult.exportedQuestions.map((q, idx) => (
              <div key={`${q.questionId}-${idx}`} className="text-xs flex items-start gap-1.5">
                <span className="text-muted-foreground min-w-[16px]">{idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sky-800 dark:text-sky-300 truncate block">
                    {q.questionTitle || 'Untitled'}
                  </span>
                  <span className="text-muted-foreground">
                    {getQuestionTypeLabel(q.questionType, t)} → {q.googleFormType}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Unsupported questions warning */}
      {exportResult?.unsupportedQuestions && exportResult.unsupportedQuestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-900/15 p-3"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-500">
              {t('questionBank.googleFormsUnsupportedWarning') || 'Some Questions Were Skipped'}
            </span>
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1.5 custom-scrollbar">
            {exportResult.unsupportedQuestions.map((q) => (
              <div key={q.questionId} className="text-xs text-amber-800 dark:text-amber-400">
                <span className="font-bold">{q.questionType}</span>
                {': '}
                <span className="truncate">{q.reason}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {exportResult?.editUrl && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open(exportResult.editUrl, '_blank')}
          >
            <ExternalLink className="h-4 w-4" />
            {t('questionBank.googleFormsOpenForm') || 'Open Form'}
          </Button>
        )}
        {exportResult?.responderUrl && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleCopyLink}
          >
            {copiedLink ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copiedLink
              ? (t('questionBank.googleFormsCopied') || 'Copied!')
              : (t('questionBank.googleFormsCopyLink') || 'Copy Link')}
          </Button>
        )}
      </div>
    </motion.div>
  );

  const renderErrorStage = () => (
    <motion.div
      key="error"
      variants={stageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col items-center text-center py-8 space-y-5"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
        <AlertCircle className="h-8 w-8 text-rose-700 dark:text-rose-500" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h3 className="text-lg font-semibold text-foreground">
          {t('questionBank.googleFormsExportError') || 'Export Failed'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {error || t('questionBank.googleFormsExportErrorDesc') || 'An error occurred during export'}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        {authStatus?.needsIncrementalAuth && (
          <Button
            onClick={startIncrementalAuth}
            className="gap-2 bg-sky-700 hover:bg-sky-800 text-white"
          >
            <GoogleIcon className="h-4 w-4" />
            {t('questionBank.googleFormsAuthorize') || 'Authorize Google Forms'}
          </Button>
        )}
        {!authStatus?.needsIncrementalAuth && (
          <Button
            onClick={handleRetryAuth}
            variant="outline"
            className="gap-2"
          >
            <Link className="h-4 w-4" />
            {t('questionBank.googleFormsRetry') || 'Retry'}
          </Button>
        )}
      </div>
    </motion.div>
  );

  // ─── Determine which stage to render ───

  const renderCurrentStage = () => {
    switch (currentStage) {
      case 'auth-check':
        if (isLoadingAuth) return renderAuthCheckStage();
        if (!authStatus?.isAuthorized || !authStatus?.hasFormsScope) return renderAuthCheckStage();
        return renderConfigStage();
      case 'config':
        return renderConfigStage();
      case 'progress':
        return renderProgressStage();
      case 'success':
        return renderSuccessStage();
      case 'error':
        return renderErrorStage();
      default:
        return renderAuthCheckStage();
    }
  };

  // ─── Determine footer buttons ───

  const renderFooterButtons = () => {
    if (currentStage === 'progress') {
      return null;
    }

    if (currentStage === 'success') {
      return (
        <Button onClick={handleClose} variant="outline">
          {t('common.close') || 'Close'}
        </Button>
      );
    }

    if (currentStage === 'error') {
      return (
        <Button onClick={handleClose} variant="outline">
          {t('common.close') || 'Close'}
        </Button>
      );
    }

    if (currentStage === 'config') {
      return (
        <div className="flex items-center gap-2 sm:justify-end">
          <Button onClick={handleClose} variant="outline" disabled={isExporting}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button
            onClick={handleExport}
            disabled={!formTitle.trim() || isExporting || enabledQuestionTypes.length === 0 || (formMode === 'appendToExisting' && !existingFormId)}
            className="gap-2 bg-sky-700 hover:bg-sky-800 text-white"
          >
            <GoogleIcon className="h-4 w-4" />
            {t('questionBank.googleFormsExportBtn') || 'Export to Google Forms'}
          </Button>
        </div>
      );
    }

    return (
      <Button onClick={handleClose} variant="outline">
        {t('common.cancel') || 'Cancel'}
      </Button>
    );
  };

  // ─── Main render ───

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent
        className="sm:max-w-lg max-h-[85dvh]"
        showCloseButton={currentStage !== 'progress'}
        dir={direction}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GoogleIcon className="h-5 w-5" />
            {t('questionBank.googleFormsModalTitle') || 'Export to Google Forms'}
          </DialogTitle>
          <DialogDescription>
            {currentStage === 'auth-check'
              ? (t('questionBank.googleFormsModalDescAuth') || 'Authorize Google Forms to begin exporting')
              : currentStage === 'config'
                ? (t('questionBank.googleFormsModalDescConfig') || 'Configure your Google Form export settings')
                : currentStage === 'progress'
                  ? (t('questionBank.googleFormsModalDescProgress') || 'Please wait while your form is being created')
                  : currentStage === 'success'
                    ? (t('questionBank.googleFormsModalDescSuccess') || 'Your questions have been exported successfully')
                    : (t('questionBank.googleFormsModalDescError') || 'Something went wrong')}
          </DialogDescription>
        </DialogHeader>

        <DialogScrollArea>
          <AnimatePresence mode="wait">
            {renderCurrentStage()}
          </AnimatePresence>
        </DialogScrollArea>

        {renderFooterButtons() && (
          <DialogFooter>
            {renderFooterButtons()}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
