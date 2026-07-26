'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  Plus,
  X,
  Loader2,
  Trash2,
  Pencil,
  ChevronLeft,
  FolderOpen,
  FileText,
  Sparkles,
  CheckCircle2,
  GripVertical,
  Minus,
  BookOpen,
  Search,
  Download,
  Upload,
  ListChecks,
  Filter,
  Check,
  MoreVertical,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import { useAiGenerationStore } from '@/stores/ai-generation-store';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { extractTextFromFile } from '@/lib/pdf-client';
import type { UserProfile, Subject, QuestionBank, BankQuestion, QuizQuestion, SubjectFile } from '@/lib/types';
import { stripFileExtension } from '@/lib/utils';
import { useTranslations } from '@/i18n/use-translations';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import ExportGoogleFormModal from '@/components/question-bank/export-google-form-modal';

// -------------------------------------------------------
// fetchWithRetry — resilient fetch with automatic retry on network errors
// Prevents premature failure when the connection drops temporarily.
// Only gives up after all retries are exhausted or the server returns a definitive error.
// -------------------------------------------------------
async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
  maxRetries: number = 3,
): Promise<Response> {
  const { timeoutMs = 300000, ...fetchOptions } = options; // 5-minute default
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const mergedSignal = AbortSignal.any
    ? AbortSignal.any([controller.signal, fetchOptions.signal].filter(Boolean) as AbortSignal[])
    : fetchOptions.signal || controller.signal;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[QB fetchWithRetry] Retry ${attempt}/${maxRetries} after ${backoffMs}ms — ${url}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
      const res = await fetch(url, { ...fetchOptions, signal: mergedSignal });
      clearTimeout(timeoutId);
      return res;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAbort = lastError.name === 'AbortError';
      if (isAbort && controller.signal.aborted) {
        clearTimeout(timeoutId);
        throw lastError;
      }
      console.warn(`[QB fetchWithRetry] Attempt ${attempt + 1} failed:`, lastError.message);
    }
  }
  clearTimeout(timeoutId);
  throw lastError || new Error('Connection failed after multiple attempts');
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface QuestionBankSectionProps {
  profile: UserProfile;
  onNavigateToCourse?: () => void;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Helper
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function questionTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case 'mcq': return t('quiz.typeMcq');
    case 'boolean': return t('quiz.typeBoolean');
    case 'completion': return t('quiz.typeCompletion');
    case 'matching': return t('quiz.typeMatching');
    default: return type;
  }
}

function difficultyLabel(d: string | null | undefined, t: (key: string) => string): string {
  switch (d) {
    case 'easy': return t('questionBank.difficultyEasy');
    case 'medium': return t('questionBank.difficultyMedium');
    case 'hard': return t('questionBank.difficultyHard');
    default: return t('questionBank.difficultyUnspecified');
  }
}

function difficultyColor(d?: string | null): string {
  switch (d) {
    case 'easy': return 'bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border-emerald-200 dark:border-emerald-900/60';
    case 'medium': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/60';
    case 'hard': return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-500 border-rose-200 dark:border-rose-900/60';
    default: return 'bg-muted/50 text-muted-foreground border-border';
  }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function QuestionBankSection({ profile, onNavigateToCourse }: QuestionBankSectionProps) {
  const { t, direction, locale } = useTranslations();

  // Option letter labels: أ, ب, ج, د... (Arabic) or A, B, C, D... (English)
  const arabicLetters = ['أ','ب','ج','د','هـ','و','ز','ح','ط','ي','ك','ل','م','ن','س','ع','ف','ص','ق','ر','ش','ت','ث','خ','ذ','ض','ظ','غ'];
  const getOptionLabel = (idx: number) => {
    if (locale === 'ar') return arabicLetters[idx] || String(idx + 1);
    return String.fromCharCode(65 + idx);
  };
  const { setSelectedSubjectId, setCourseTab } = useAppStore();

  // ─── Data ───
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState<string>('all');

  // ─── View state ───
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedBank, setSelectedBank] = useState<(QuestionBank & { questions: BankQuestion[] }) | null>(null);

  // ─── Create bank modal ───
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankDescription, setBankDescription] = useState('');
  const [bankSubjectId, setBankSubjectId] = useState('');
  const [creatingBank, setCreatingBank] = useState(false);

  // ─── Add question modal ───
  const [addQuestionModalOpen, setAddQuestionModalOpen] = useState(false);
  const [currentQuestionType, setCurrentQuestionType] = useState<BankQuestion['type']>('mcq');
  const [currentQuestionText, setCurrentQuestionText] = useState('');
  const [mcqOptions, setMcqOptions] = useState(['', '', '', '']);
  const [mcqCorrect, setMcqCorrect] = useState(0);
  const [booleanCorrect, setBooleanCorrect] = useState(true);
  const [completionAnswer, setCompletionAnswer] = useState('');
  const [matchingPairs, setMatchingPairs] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  const [questionDifficulty, setQuestionDifficulty] = useState<'easy' | 'medium' | 'hard' | ''>('');
  const [questionCategory, setQuestionCategory] = useState('');
  const [addingQuestion, setAddingQuestion] = useState(false);

  // ─── AI generation from file ───
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [courseFiles, setCourseFiles] = useState<SubjectFile[]>([]);
  const [selectedCourseFile, setSelectedCourseFile] = useState<SubjectFile | null>(null);
  const [loadingCourseFiles, setLoadingCourseFiles] = useState(false);
  const [generatingFromAi, setGeneratingFromAi] = useState(false);
  const [aiConfigTypes, setAiConfigTypes] = useState({ mcq: 3, boolean: 2, completion: 2, matching: 2 });
  const { activeTask: aiBackgroundTask, startTask: startAiTask, updateStatus: updateAiStatus, completeTask: completeAiTask, cancelTask: cancelAiTask } = useAiGenerationStore();
  const aiAbortRef = useRef<AbortController | null>(null);

  // Restore any persisted generation task on mount
  useEffect(() => {
    useAiGenerationStore.getState().restoreFromStorage();
  }, []);

  const handleCancelAiGeneration = useCallback(() => {
    if (aiAbortRef.current) {
      aiAbortRef.current.abort();
      aiAbortRef.current = null;
    }
    cancelAiTask();
    toast.info(t('questionBank.toastGenerationCancelled'));
  }, [t, cancelAiTask]);

  // ─── Edit bank ───
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editBankName, setEditBankName] = useState('');
  const [editBankDesc, setEditBankDesc] = useState('');
  const [editingBank, setEditingBank] = useState(false);

  // ─── Deleting ───
  const [deletingBankId, setDeletingBankId] = useState<string | null>(null);
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null);

  // ─── Google Forms export modal ───
  const [googleFormsModalOpen, setGoogleFormsModalOpen] = useState(false);

  // -------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------
  const fetchBanks = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/question-bank', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setBanks(data.data);
      }
    } catch (err) {
      console.error('Error fetching banks:', err);
    }
  }, []);

  const fetchSubjects = useCallback(async () => {
    try {
      // Fetch owned subjects
      const { data, error } = await supabase
        .from('subjects')
        .select('*')
        .eq('teacher_id', profile.id)
        .order('name');
      let owned: Subject[] = [];
      if (!error && data) {
        owned = (data as Subject[]).map(s => ({ ...s, is_co_teacher: false }));
      }

      // Fetch co-taught subjects
      let coTaught: Subject[] = [];
      try {
        const { data: coTeacherEntries } = await supabase
          .from('subject_teachers')
          .select('subject_id, role, subjects(*)')
          .eq('teacher_id', profile.id)
          .eq('role', 'co_teacher');
        if (coTeacherEntries) {
          (coTeacherEntries as Record<string, unknown>[]).forEach((entry) => {
            const subject = entry.subjects as Subject | null;
            if (subject && !owned.find(s => s.id === subject.id)) {
              coTaught.push({ ...subject, is_co_teacher: true });
            }
          });
        }
      } catch { /* ignore */ }

      setSubjects([...owned, ...coTaught]);
    } catch (err) {
      console.error('Error fetching subjects:', err);
    }
  }, [profile.id]);

  const fetchAllData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    await Promise.allSettled([fetchBanks(), fetchSubjects()]);
    if (showLoading) setLoading(false);
  }, [fetchBanks, fetchSubjects]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // -------------------------------------------------------
  // Supabase Realtime subscriptions
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`question-bank-files-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'subject_files' }, () => {
        fetchAllData(false);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'subject_files' }, () => {
        fetchAllData(false);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'subject_files' }, () => {
        fetchAllData(false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id, fetchAllData]);

  // -------------------------------------------------------
  // Fetch single bank detail
  // -------------------------------------------------------
  const fetchBankDetail = useCallback(async (bankId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch(`/api/question-bank?bankId=${bankId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSelectedBank(data.data);
      }
    } catch (err) {
      console.error('Error fetching bank detail:', err);
    }
  }, []);

  // -------------------------------------------------------
  // Create bank
  // -------------------------------------------------------
  const handleCreateBank = async () => {
    if (!bankName.trim()) {
      toast.error(t('questionBank.toastEnterBankName'));
      return;
    }
    if (!bankSubjectId) {
      toast.error(t('questionBank.toastSelectSubject'));
      return;
    }

    setCreatingBank(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/question-bank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: bankName.trim(),
          description: bankDescription.trim() || undefined,
          subject_id: bankSubjectId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(t('questionBank.toastBankCreated'));
        setCreateModalOpen(false);
        setBankName('');
        setBankDescription('');
        setBankSubjectId('');
        fetchBanks();
      } else {
        toast.error(data.error || t('questionBank.toastBankCreateError'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setCreatingBank(false);
    }
  };

  // -------------------------------------------------------
  // Delete bank
  // -------------------------------------------------------
  const handleDeleteBank = async (bankId: string) => {
    setDeletingBankId(bankId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch(`/api/question-bank?bankId=${bankId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const data = await res.json();
      if (data.success) {
        toast.success(t('questionBank.toastBankDeleted'));
        fetchBanks();
        if (selectedBank?.id === bankId) {
          setSelectedBank(null);
          setView('list');
        }
      } else {
        toast.error(data.error || t('questionBank.toastBankDeleteError'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setDeletingBankId(null);
    }
  };

  // -------------------------------------------------------
  // Edit bank
  // -------------------------------------------------------
  const handleOpenEditBank = () => {
    if (!selectedBank) return;
    setEditBankName(selectedBank.name);
    setEditBankDesc(selectedBank.description || '');
    setEditModalOpen(true);
  };

  const handleEditBank = async () => {
    if (!editBankName.trim() || !selectedBank) return;
    setEditingBank(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/question-bank', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bankId: selectedBank.id,
          name: editBankName.trim(),
          description: editBankDesc.trim() || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(t('questionBank.toastBankUpdated'));
        setEditModalOpen(false);
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || t('questionBank.toastBankUpdateError'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setEditingBank(false);
    }
  };

  // -------------------------------------------------------
  // Add question to bank
  // -------------------------------------------------------
  const resetQuestionForm = () => {
    setCurrentQuestionText('');
    setMcqOptions(['', '', '', '']);
    setMcqCorrect(0);
    setBooleanCorrect(true);
    setCompletionAnswer('');
    setMatchingPairs([{ key: '', value: '' }]);
    setQuestionDifficulty('');
    setQuestionCategory('');
  };

  const handleAddQuestion = async () => {
    if (!currentQuestionText.trim()) {
      toast.error(t('questionBank.toastEnterQuestionText'));
      return;
    }
    if (!selectedBank) return;

    let questionData: Record<string, unknown>;

    switch (currentQuestionType) {
      case 'mcq': {
        const filledOptions = mcqOptions.filter(o => o.trim());
        if (filledOptions.length < 2) {
          toast.error(t('questionBank.toastEnterTwoOptions'));
          return;
        }
        if (!mcqOptions[mcqCorrect]?.trim()) {
          toast.error(t('questionBank.toastCorrectAnswerEmpty'));
          return;
        }
        questionData = {
          type: 'mcq',
          question: currentQuestionText.trim(),
          options: mcqOptions.map(o => o.trim()),
          correct_answer: mcqOptions[mcqCorrect].trim(),
        };
        break;
      }
      case 'boolean': {
        questionData = {
          type: 'boolean',
          question: currentQuestionText.trim(),
          correct_answer: booleanCorrect ? 'صح' : 'خطأ', // stored in Arabic for data consistency
        };
        break;
      }
      case 'completion': {
        if (!completionAnswer.trim()) {
          toast.error(t('questionBank.toastEnterCorrectAnswer'));
          return;
        }
        questionData = {
          type: 'completion',
          question: currentQuestionText.trim(),
          correct_answer: completionAnswer.trim(),
        };
        break;
      }
      case 'matching': {
        const validPairs = matchingPairs.filter(p => p.key.trim() && p.value.trim());
        if (validPairs.length < 2) {
          toast.error(t('questionBank.toastEnterTwoPairs'));
          return;
        }
        questionData = {
          type: 'matching',
          question: currentQuestionText.trim(),
          pairs: validPairs.map(p => ({ key: p.key.trim(), value: p.value.trim() })),
        };
        break;
      }
      default:
        return;
    }

    if (questionDifficulty) questionData.difficulty = questionDifficulty;
    if (questionCategory.trim()) questionData.category = questionCategory.trim();

    setAddingQuestion(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/question-bank', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bankId: selectedBank.id,
          addQuestions: [questionData],
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(t('questionBank.toastQuestionAdded'));
        setAddQuestionModalOpen(false);
        resetQuestionForm();
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || t('questionBank.toastQuestionAddError'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setAddingQuestion(false);
    }
  };

  // -------------------------------------------------------
  // Delete question from bank
  // -------------------------------------------------------
  const handleDeleteQuestion = async (questionId: string) => {
    if (!selectedBank) return;
    setDeletingQuestionId(questionId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/question-bank', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bankId: selectedBank.id,
          removeQuestionIds: [questionId],
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(t('questionBank.toastQuestionDeleted'));
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || t('questionBank.toastQuestionDeleteError'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setDeletingQuestionId(null);
    }
  };

  // -------------------------------------------------------
  // Load course files for AI generation
  // -------------------------------------------------------
  const loadCourseFiles = useCallback(async (subjectId: string) => {
    if (courseFiles.length > 0) return;
    setLoadingCourseFiles(true);
    try {
      const { data, error } = await supabase
        .from('subject_files')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });
      if (!error && data) {
        const docFiles = (data as SubjectFile[]).filter(f => /\.(pdf|docx?)$/i.test(f.file_name));
        setCourseFiles(docFiles);
      }
    } catch { /* non-critical */ }
    finally { setLoadingCourseFiles(false); }
  }, [courseFiles.length]);

  // -------------------------------------------------------
  // Generate questions from file using AI
  // -------------------------------------------------------
  const handleGenerateFromAiFile = () => {
    if (!selectedCourseFile || !selectedBank) {
      toast.error(t('questionBank.selectFile'));
      return;
    }

    // Capture current state into local variables so they remain available
    // after we close the modal and reset the state
    const capturedFile = selectedCourseFile;
    const capturedBank = selectedBank;
    const capturedConfig = { ...aiConfigTypes };

    // Close the modal immediately — generation runs in the background
    setAiModalOpen(false);
    setSelectedCourseFile(null);
    setCourseFiles([]);

    // Set background task indicator (persisted to localStorage via Zustand store)
    startAiTask(capturedBank.id, capturedBank.name, capturedBank.subject_name);

    // Create a shared AbortController for cancellation support
    const abortController = new AbortController();
    aiAbortRef.current = abortController;

    // Background async generation with cancellation checks
    const generateAsync = async () => {
      const signal = abortController.signal;
      const isAborted = () => signal.aborted;

      try {
        const headers = await getCachedAuthHeaders();

        // ─── Step 1: Extract text from file (multi-strategy with fallbacks) ───
        if (isAborted()) return;
        updateAiStatus('extracting');
        let content: string | null = null;

        // Strategy A: Server-side extraction from URL (most reliable for existing files)
        try {
          const extractController = new AbortController();
          const extractTimeoutId = setTimeout(() => extractController.abort(), 45000);

          const extractRes = await fetchWithRetry('/api/files/extract-pdf-url', {
            method: 'POST',
            headers,
            signal: AbortSignal.any ? AbortSignal.any([extractController.signal, signal]) : extractController.signal,
            timeoutMs: 45000,
            body: JSON.stringify({
              url: capturedFile.file_url,
              fileName: capturedFile.file_name,
            }),
          });

          clearTimeout(extractTimeoutId);

          const extractData = await extractRes.json();
          if (extractRes.ok && extractData.success && extractData.data?.text) {
            content = extractData.data.text;
            console.log('[QB AI] Server-side extraction succeeded, text length:', content!.length);
          }
        } catch (extractErr) {
          if (isAborted()) return;
          console.warn('[QB AI] Server-side extraction failed, trying client-side fallback:', extractErr);
        }

        // Strategy B: Client-side extraction fallback
        if (isAborted()) return;
        if (!content || content.trim().length < 50) {
          try {
            console.log('[QB AI] Attempting client-side extraction fallback...');
            const downloadRes = await fetchWithRetry(capturedFile.file_url, {
              timeoutMs: 30000,
              signal,
            });

            if (downloadRes.ok) {
              const arrayBuffer = await downloadRes.arrayBuffer();
              const extractionTimeoutMs = 30000;
              const extractionPromise = extractTextFromFile(arrayBuffer, capturedFile.file_name);
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), extractionTimeoutMs)
              );

              const result = await Promise.race([extractionPromise, timeoutPromise]);
              content = result.text;
              console.log('[QB AI] Client-side extraction succeeded, text length:', content.length);
            }
          } catch (fallbackErr) {
            if (isAborted()) return;
            console.warn('[QB AI] Client-side extraction also failed:', fallbackErr);
          }
        }

        // Fallback: VLM-based extraction for scanned/image-heavy PDFs
        if (isAborted()) return;
        if (!content || content.trim().length < 50) {
          try {
            console.log('[QB AI] Trying VLM fallback for image-heavy PDF...');
            const vlmController = new AbortController();
            const vlmTimeoutId = setTimeout(() => vlmController.abort(), 55000);

            const vlmRes = await fetchWithRetry('/api/files/extract-pdf-vlm', {
              method: 'POST',
              headers,
              signal: AbortSignal.any ? AbortSignal.any([vlmController.signal, signal]) : vlmController.signal,
              timeoutMs: 55000,
              body: JSON.stringify({
                url: capturedFile.file_url,
                fileName: capturedFile.file_name,
              }),
            });

            clearTimeout(vlmTimeoutId);
            const vlmData = await vlmRes.json();
            if (vlmRes.ok && vlmData.success && vlmData.data?.text && vlmData.data.text.trim().length >= 50) {
              content = vlmData.data.text;
              console.log('[QB AI] VLM extraction succeeded, text length:', content!.length);
            }
          } catch (vlmErr) {
            if (isAborted()) return;
            console.warn('[QB AI] VLM extraction also failed:', vlmErr instanceof Error ? vlmErr.message : vlmErr);
          }
        }

        if (isAborted()) return;
        if (!content || content.trim().length < 50) {
          toast.error(t('questionBank.toastExtractionFailed'));
          return;
        }

        // ─── Step 2: Generate questions using AI ───
        if (isAborted()) return;
        updateAiStatus('generating');

        const quizController = new AbortController();
        const quizTimeoutId = setTimeout(() => quizController.abort(), 120000);

        let quizRes: Response;
        try {
          quizRes = await fetchWithRetry('/api/gemini/quiz', {
            method: 'POST',
            headers,
            signal: AbortSignal.any ? AbortSignal.any([quizController.signal, signal]) : quizController.signal,
            timeoutMs: 120000,
            body: JSON.stringify({
              content,
              questionTypes: capturedConfig,
            }),
          });
        } catch (quizErr) {
          clearTimeout(quizTimeoutId);
          if (isAborted()) return;
          // Error recovery: re-fetch bank detail in case questions were generated but response was lost
          await fetchBankDetail(capturedBank.id);
          fetchBanks();
          throw quizErr;
        }

        clearTimeout(quizTimeoutId);
        if (isAborted()) return;

        const quizData = await quizRes.json();
        if (!quizRes.ok || !quizData.success) {
          toast.error(quizData.error || t('questionBank.toastGenerationFailed'));
          return;
        }

        const questions = quizData.data.questions as QuizQuestion[];
        if (!questions || questions.length === 0) {
          toast.error(t('questionBank.toastNoQuestionsGenerated'));
          return;
        }

        // ─── Step 3: Add questions to the bank via API ───
        if (isAborted()) return;
        updateAiStatus('saving');

        const bankQuestions = questions.map(q => ({
          type: q.type,
          question: q.question,
          options: q.options || null,
          correct_answer: q.correctAnswer ?? null,
          pairs: q.pairs || null,
        }));

        let saveSucceeded = false;
        try {
          const saveRes = await fetchWithRetry('/api/question-bank', {
            method: 'PUT',
            headers,
            signal,
            timeoutMs: 30000,
            body: JSON.stringify({
              bankId: capturedBank.id,
              addQuestions: bankQuestions,
            }),
          });

          const result = await saveRes.json();
          saveSucceeded = result.success === true;
          if (!saveSucceeded) {
            toast.error(result.error || t('questionBank.toastAddQuestionsError'));
          }
        } catch (saveErr) {
          if (isAborted()) return;
          console.warn('[QB AI] Save request failed, attempting recovery:', saveErr);
          // Error recovery: re-fetch bank detail — the save may have succeeded on the server
          // even though the HTTP response was lost (network drop, timeout, etc.)
          await fetchBankDetail(capturedBank.id);
          fetchBanks();
          toast.error(t('questionBank.toastSaveQuestionsError'));
          return;
        }

        if (saveSucceeded) {
          toast.success(t('questionBank.generatedCount', { count: questions.length }));
          fetchBankDetail(capturedBank.id);
          fetchBanks();
        }
      } catch (err) {
        if (isAborted()) return;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('abort') || errMsg.includes('AbortError') || errMsg.includes('TIMEOUT')) {
          toast.error(t('questionBank.toastOperationTimeout'));
          // Recovery: re-fetch in case operation completed on server
          await fetchBankDetail(capturedBank.id);
          fetchBanks();
        } else {
          toast.error(t('questionBank.toastAiGenerateError'));
        }
      } finally {
        if (aiAbortRef.current === abortController) {
          aiAbortRef.current = null;
        }
        completeAiTask();
      }
    };

    generateAsync();
  };

  // -------------------------------------------------------
  // Export bank questions as JSON
  // -------------------------------------------------------
  const handleExportBank = (bank: QuestionBank & { questions?: BankQuestion[] }) => {
    if (!bank.questions || bank.questions.length === 0) {
      toast.error(t('questionBank.noExportQuestions'));
      return;
    }

    const exportData = {
      name: bank.name,
      description: bank.description,
      questions: bank.questions.map(q => ({
        type: q.type,
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        pairs: q.pairs,
        difficulty: q.difficulty,
        category: q.category,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('questionBank.exportFileName', { name: bank.name })}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('questionBank.exportSuccess'));
  };

  // -------------------------------------------------------
  // Import questions from JSON file
  // -------------------------------------------------------
  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedBank) return;
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      if (!imported.questions || !Array.isArray(imported.questions)) {
        toast.error(t('questionBank.importInvalidFormat'));
        return;
      }

      const questions = imported.questions.map((q: Record<string, unknown>) => ({
        type: q.type,
        question: q.question,
        options: q.options || null,
        correct_answer: q.correct_answer || null,
        pairs: q.pairs || null,
        difficulty: q.difficulty || null,
        category: q.category || null,
      }));

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/question-bank', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bankId: selectedBank.id,
          addQuestions: questions,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(t('questionBank.importSuccess', { count: questions.length }));
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || t('common.errorUnexpected'));
      }
    } catch {
      toast.error(t('questionBank.importReadError'));
    }

    // Reset file input
    e.target.value = '';
  };

  // -------------------------------------------------------
  // Open bank detail
  // -------------------------------------------------------
  const handleOpenBank = (bank: QuestionBank) => {
    fetchBankDetail(bank.id);
    setView('detail');
  };

  // -------------------------------------------------------
  // Navigate to course exams tab (for creating quiz from bank)
  // -------------------------------------------------------
  const handleGoToCourse = (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    setCourseTab('exams');
    onNavigateToCourse?.();
  };

  // -------------------------------------------------------
  // Computed: filtered banks
  // -------------------------------------------------------
  const filteredBanks = banks.filter(b => {
    const matchesSearch = !searchQuery.trim() ||
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.description || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesSubject = filterSubjectId === 'all' || b.subject_id === filterSubjectId;

    return matchesSearch && matchesSubject;
  });

  // Group banks by subject
  const groupedBanks = filteredBanks.reduce<Record<string, QuestionBank[]>>((acc, bank) => {
    const key = bank.subject_name || bank.subject_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(bank);
    return acc;
  }, {});

  // -------------------------------------------------------
  // Loading state
  // -------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
      </div>
    );
  }

  // -------------------------------------------------------
  // Render: Question builder form (shared)
  // -------------------------------------------------------
  const renderQuestionBuilder = () => (
    <div className="space-y-4">
      {/* Question type selector */}
      <div>
        <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.questionType')}</label>
        <div className="flex flex-wrap gap-2">
          {[
            { type: 'mcq' as const, label: t('quiz.typeMcq') },
            { type: 'boolean' as const, label: t('quiz.typeBoolean') },
            { type: 'completion' as const, label: t('quiz.typeCompletion') },
            { type: 'matching' as const, label: t('quiz.typeMatching') },
          ].map(opt => (
            <button
              key={opt.type}
              onClick={() => setCurrentQuestionType(opt.type)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                currentQuestionType === opt.type
                  ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15 text-sky-800 dark:text-sky-400'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Question text */}
      <div>
        <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.questionText')}</label>
        <input
          type="text"
          value={currentQuestionText}
          onChange={e => setCurrentQuestionText(e.target.value)}
          placeholder={currentQuestionType === 'completion' ? t('questionBank.completionPlaceholder') : t('questionBank.questionTextPlaceholder')}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
          dir={direction}
        />
      </div>

      {/* MCQ options */}
      {currentQuestionType === 'mcq' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.options')}</label>
          {mcqOptions.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMcqCorrect(idx)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  mcqCorrect === idx ? 'border-sky-600 bg-sky-600 text-white' : 'border-muted-foreground/30 hover:border-sky-400'
                }`}
              >
                {mcqCorrect === idx && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
              <input
                type="text"
                value={opt}
                onChange={e => { const n = [...mcqOptions]; n[idx] = e.target.value; setMcqOptions(n); }}
                placeholder={`${t('questionBank.optionLabel')} ${getOptionLabel(idx)}`}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                dir={direction}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t('questionBank.selectCorrectAnswer')}</p>
        </div>
      )}

      {/* Boolean */}
      {currentQuestionType === 'boolean' && (
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.correctAnswer')}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setBooleanCorrect(true)}
              className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition-all ${
                booleanCorrect ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15 text-sky-800 dark:text-sky-400' : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >{t('quiz.booleanTrue')}</button>
            <button
              onClick={() => setBooleanCorrect(false)}
              className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition-all ${
                !booleanCorrect ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-500' : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >{t('quiz.booleanFalse')}</button>
          </div>
        </div>
      )}

      {/* Completion */}
      {currentQuestionType === 'completion' && (
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.correctAnswer')}</label>
          <input
            type="text"
            value={completionAnswer}
            onChange={e => setCompletionAnswer(e.target.value)}
            placeholder={t('questionBank.correctAnswerPlaceholder')}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir={direction}
          />
        </div>
      )}

      {/* Matching */}
      {currentQuestionType === 'matching' && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.matchingPairs')}</label>
          {matchingPairs.map((pair, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={pair.key}
                onChange={e => { const n = [...matchingPairs]; n[idx] = { ...n[idx], key: e.target.value }; setMatchingPairs(n); }}
                placeholder={t('questionBank.itemPlaceholder')}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                dir={direction}
              />
              <span className="text-muted-foreground text-sm">←</span>
              <input
                type="text"
                value={pair.value}
                onChange={e => { const n = [...matchingPairs]; n[idx] = { ...n[idx], value: e.target.value }; setMatchingPairs(n); }}
                placeholder={t('questionBank.matchPlaceholder')}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                dir={direction}
              />
              {matchingPairs.length > 1 && (
                <button onClick={() => setMatchingPairs(matchingPairs.filter((_, i) => i !== idx))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 transition-colors">
                  <Minus className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setMatchingPairs([...matchingPairs, { key: '', value: '' }])} className="flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            {t('questionBank.addPair')}
          </button>
        </div>
      )}

      {/* Difficulty & Category */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.difficulty')}</label>
          <select
            value={questionDifficulty}
            onChange={e => setQuestionDifficulty(e.target.value as '' | 'easy' | 'medium' | 'hard')}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors appearance-none cursor-pointer"
            dir={direction}
          >
            <option value="">{t('questionBank.difficultyNone')}</option>
            <option value="easy">{t('questionBank.difficultyEasy')}</option>
            <option value="medium">{t('questionBank.difficultyMedium')}</option>
            <option value="hard">{t('questionBank.difficultyHard')}</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.category')}</label>
          <input
            type="text"
            value={questionCategory}
            onChange={e => setQuestionCategory(e.target.value)}
            placeholder={t('questionBank.categoryPlaceholder')}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir={direction}
          />
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------
  // Render: BANK LIST VIEW
  // -------------------------------------------------------
  const renderBankList = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Database className="h-6 w-6 text-sky-700 dark:text-sky-400" />
            {t('nav.questionBank')}
          </h2>
          <p className="text-muted-foreground mt-1">{t('questionBank.manageBanksDesc')}</p>
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
        >
          <Plus className="h-4 w-4" />
          {t('questionBank.createNewBank')}
        </button>
      </motion.div>

      {/* Search & Filter */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('questionBank.searchBanksPlaceholder')}
            className="w-full rounded-lg border bg-background pe-10 ps-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir={direction}
          />
        </div>
        <div className="relative">
          <Filter className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <select
            value={filterSubjectId}
            onChange={e => setFilterSubjectId(e.target.value)}
            className="rounded-lg border bg-background pe-10 ps-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors appearance-none cursor-pointer min-w-[160px]"
            dir={direction}
          >
            <option value="all">{t('questionBank.allSubjects')}</option>
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
              <Database className="h-5 w-5 text-sky-700 dark:text-sky-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{banks.length}</p>
              <p className="text-xs text-muted-foreground">{t('questionBank.banksCount', { count: banks.length })}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
              <ListChecks className="h-5 w-5 text-teal-700 dark:text-teal-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{banks.reduce((sum, b) => sum + (b.question_count || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">{t('questionBank.totalQuestions', { count: banks.reduce((sum, b) => sum + (b.question_count || 0), 0) })}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <BookOpen className="h-5 w-5 text-amber-700 dark:text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{subjects.length}</p>
              <p className="text-xs text-muted-foreground">{t('questionBank.linkedSubject', { count: subjects.length })}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Banks list grouped by subject */}
      {filteredBanks.length === 0 ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50 mb-4">
            <Database className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">{t('questionBank.noBanks')}</p>
          <p className="text-sm text-muted-foreground mb-4">{t('questionBank.noBanksDesc')}</p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
          >
            <Plus className="h-4 w-4" />
            {t('questionBank.createNewBank')}
          </button>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedBanks).map(([subjectName, subjectBanks]) => (
            <motion.div key={subjectName} variants={itemVariants} className="space-y-3">
              <h3 className="text-sm font-bold text-muted-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {subjectName}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {subjectBanks.map(bank => (
                  <motion.div
                    key={bank.id}
                    whileHover={{ scale: 1.01, y: -1 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => handleOpenBank(bank)}
                    className="rounded-xl border bg-card p-4 shadow-sm cursor-pointer hover:border-sky-300 dark:hover:border-sky-700 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-foreground truncate group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
                          {bank.name}
                        </h4>
                        {bank.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{bank.description}</p>
                        )}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteBank(bank.id); }}
                        disabled={deletingBankId === bank.id}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        {deletingBankId === bank.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ListChecks className="h-3 w-3" />
                          {t('questionBank.questionsCount', { count: bank.question_count || 0 })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(bank.created_at)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: BANK DETAIL VIEW
  // -------------------------------------------------------
  const renderBankDetail = () => {
    if (!selectedBank) return null;
    const questions = selectedBank.questions || [];

    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-5">
        {/* Header */}
        <motion.div variants={itemVariants} className="space-y-3">
          {/* Row 1: Back + Title */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setView('list'); setSelectedBank(null); }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-foreground truncate">{selectedBank.name}</h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {t('questionBank.subjectQuestions', { subject: selectedBank.subject_name || '', count: questions.length })}
              </p>
            </div>
          </div>

          {/* Row 2: Action buttons — responsive */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary actions (always visible) */}
            <button
              onClick={() => { setAiModalOpen(true); loadCourseFiles(selectedBank.subject_id); }}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-violet-100 dark:bg-violet-900/15 text-violet-700 dark:text-violet-500 px-2.5 text-xs font-medium hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
              title={t('questionBank.generateFromFileTitle')}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{t('questionBank.generateWithAiShort')}</span>
            </button>
            <button
              onClick={() => setAddQuestionModalOpen(true)}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-sky-700 text-white px-2.5 text-xs font-medium hover:bg-sky-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('questionBank.addQuestion')}
            </button>

            {/* Secondary actions — visible on desktop, dropdown on tablet/mobile */}
            <div className="hidden md:flex items-center gap-1.5">
              <button
                onClick={handleOpenEditBank}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                title={t('common.edit')}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleExportBank(selectedBank as QuestionBank & { questions: BankQuestion[] })}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                title={t('common.export')}
              >
                <Download className="h-4 w-4" />
              </button>
              <label
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
                title={t('questionBank.importJsonTitle')}
              >
                <Upload className="h-4 w-4" />
                <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
              </label>
              <button
                onClick={() => setGoogleFormsModalOpen(true)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 px-2.5 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                title={t('questionBank.googleFormsExportBtn') || 'Export to Google Forms'}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#34A853"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.57-3.57C18.46 2.09 15.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                <span className="hidden lg:inline">Google Forms</span>
              </button>
            </div>

            {/* Mobile: secondary actions in dropdown */}
            <DropdownMenu dir={direction}>
              <DropdownMenuTrigger asChild>
                <button className="md:hidden flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleOpenEditBank}>
                  <Pencil className="h-4 w-4 me-2" />
                  {t('common.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportBank(selectedBank as QuestionBank & { questions: BankQuestion[] })}>
                  <Download className="h-4 w-4 me-2" />
                  {t('common.export')}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <label className="flex cursor-pointer items-center">
                    <Upload className="h-4 w-4 me-2" />
                    {t('questionBank.importJsonTitle')}
                    <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
                  </label>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGoogleFormsModalOpen(true)}>
                  <svg className="h-4 w-4 me-2" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.57-3.57C18.46 2.09 15.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  {t('questionBank.googleFormsExportBtn') || 'Export to Google Forms'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </motion.div>

        {/* Description */}
        {selectedBank.description && (
          <motion.div variants={itemVariants} className="rounded-lg border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">{selectedBank.description}</p>
          </motion.div>
        )}

        {/* Questions list */}
        {questions.length === 0 ? (
          <motion.div variants={itemVariants} className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 mb-3">
              <ListChecks className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">{t('questionBank.noQuestionsYet')}</p>
            <p className="text-xs text-muted-foreground mb-3">{t('questionBank.noQuestionsYetDesc')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setAddQuestionModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('questionBank.addManually')}
              </button>
              <button
                onClick={() => { setAiModalOpen(true); loadCourseFiles(selectedBank.subject_id); }}
                className="flex items-center gap-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/15 text-violet-700 dark:text-violet-500 px-3 py-2 text-xs font-medium hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('questionBank.generateWithAiShort')}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div variants={itemVariants} className="space-y-2">
            {questions.map((q, idx) => (
              <div key={q.id} className="rounded-lg border bg-card p-4 shadow-sm group hover:border-sky-200 dark:hover:border-sky-900/60 transition-all">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400 text-xs font-bold">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-medium text-foreground">{q.question}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60">
                        {questionTypeLabel(q.type, t)}
                      </span>
                      {q.difficulty && (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${difficultyColor(q.difficulty)}`}>
                          {difficultyLabel(q.difficulty, t)}
                        </span>
                      )}
                      {q.category && (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-muted/50 text-muted-foreground border-border">
                          {q.category}
                        </span>
                      )}
                    </div>
                    {/* Show options for MCQ */}
                    {q.type === 'mcq' && q.options && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(q.options as string[]).map((opt, oi) => (
                          <span
                            key={oi}
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] ${
                              opt === q.correct_answer
                                ? 'bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border border-emerald-200 dark:border-emerald-900/60 font-medium'
                                : 'bg-muted/50 text-muted-foreground border border-border'
                            }`}
                          >
                            {opt === q.correct_answer && <Check className="h-2.5 w-2.5 me-0.5" />}
                            {opt}
                          </span>
                        ))}
                      </div>
                    )}
                    {q.type === 'boolean' && q.correct_answer && (
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        q.correct_answer === 'صح'
                          ? 'bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border border-emerald-200 dark:border-emerald-900/60'
                          : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-500 border border-rose-200 dark:border-rose-900/60'
                      }`}>
                        {q.correct_answer}
                      </span>
                    )}
                    {q.type === 'completion' && q.correct_answer && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border border-emerald-200 dark:border-emerald-900/60">
                        {t('questionBank.answerLabel')} {q.correct_answer}
                      </span>
                    )}
                    {q.type === 'matching' && q.pairs && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(q.pairs as { key: string; value: string }[]).map((pair, pi) => (
                          <span key={pi} className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border border-amber-200 dark:border-amber-900/60">
                            {pair.key} ← {pair.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteQuestion(q.id)}
                    disabled={deletingQuestionId === q.id}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    {deletingQuestionId === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* Go to course exams tab */}
        <motion.div variants={itemVariants} className="rounded-lg border bg-sky-50 dark:bg-sky-900/15 border-sky-200 dark:border-sky-900/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-sky-700 dark:text-sky-400" />
              <div>
                <p className="text-sm font-medium text-sky-800 dark:text-sky-400">{t('questionBank.createQuizFromBank')}</p>
                <p className="text-xs text-sky-600 dark:text-sky-400">{t('questionBank.createQuizFromBankDesc')}</p>
              </div>
            </div>
            <button
              onClick={() => handleGoToCourse(selectedBank.subject_id)}
              className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('questionBank.goToCourse')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Create Bank Modal
  // -------------------------------------------------------
  const renderCreateModal = () => (
    <AnimatePresence>
      {createModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!creatingBank) { setCreateModalOpen(false); } }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto"
            dir={direction}
          >
            <div className="flex items-center justify-between border-b p-5 sticky top-0 bg-background z-10">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Database className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                {t('questionBank.createNewBankTitle')}
              </h3>
              <button onClick={() => { if (!creatingBank) setCreateModalOpen(false); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.bankName')} <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  placeholder={t('questionBank.bankNameExample')}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                  dir={direction}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.subjectLabel')} <span className="text-rose-500">*</span></label>
                <select
                  value={bankSubjectId}
                  onChange={e => setBankSubjectId(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors appearance-none cursor-pointer"
                  dir={direction}
                >
                  <option value="">{t('questionBank.selectSubject')}</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.descriptionOptional')}</label>
                <textarea
                  value={bankDescription}
                  onChange={e => setBankDescription(e.target.value)}
                  placeholder={t('questionBank.bankDescriptionPlaceholder')}
                  rows={3}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors resize-none"
                  dir={direction}
                />
              </div>
              <button
                onClick={handleCreateBank}
                disabled={creatingBank || !bankName.trim() || !bankSubjectId}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-700 py-2.5 text-sm font-medium text-white hover:bg-sky-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingBank ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('questionBank.creating')}</> : <><Plus className="h-4 w-4" /> {t('questionBank.create')}</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Add Question Modal
  // -------------------------------------------------------
  const renderAddQuestionModal = () => (
    <AnimatePresence>
      {addQuestionModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!addingQuestion) { setAddQuestionModalOpen(false); resetQuestionForm(); } }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto"
            dir={direction}
          >
            <div className="flex items-center justify-between border-b p-5 sticky top-0 bg-background z-10">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Plus className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                {t('questionBank.addQuestion')}
              </h3>
              <button onClick={() => { if (!addingQuestion) { setAddQuestionModalOpen(false); resetQuestionForm(); } }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              {renderQuestionBuilder()}
              <button
                onClick={handleAddQuestion}
                disabled={addingQuestion}
                className="w-full mt-5 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-sky-300 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-3 text-sm font-medium text-sky-800 dark:text-sky-400 hover:bg-sky-50 hover:border-sky-400 transition-colors disabled:opacity-50"
              >
                {addingQuestion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t('questionBank.addQuestionBtn')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: AI Generation Modal
  // -------------------------------------------------------
  const renderAiModal = () => (
    <AnimatePresence>
      {aiModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { setAiModalOpen(false); setSelectedCourseFile(null); setCourseFiles([]); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto"
            dir={direction}
          >
            <div className="flex items-center justify-between border-b p-5 sticky top-0 bg-background z-10">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-500" />
                {t('questionBank.generateAiTitle')}
              </h3>
              <button onClick={() => { setAiModalOpen(false); setSelectedCourseFile(null); setCourseFiles([]); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Select file */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.selectCourseFileLabel')}</label>
                {loadingCourseFiles ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : courseFiles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center">
                    <FolderOpen className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">{t('questionBank.noPdfWordFiles')}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                    {courseFiles.map(file => (
                      <button
                        key={file.id}
                        onClick={() => setSelectedCourseFile(file)}
                        className={`w-full flex items-center gap-2 rounded-lg border p-2.5 text-end transition-all ${
                          selectedCourseFile?.id === file.id
                            ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground truncate">{stripFileExtension(file.file_name)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Question types config */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">{t('questionBank.questionCountByType')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'mcq' as const, label: t('quiz.typeMcq') },
                    { key: 'boolean' as const, label: t('quiz.typeBoolean') },
                    { key: 'completion' as const, label: t('quiz.typeCompletion') },
                    { key: 'matching' as const, label: t('quiz.typeMatching') },
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between rounded-lg border p-2">
                      <span className="text-xs text-foreground">{item.label}</span>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={aiConfigTypes[item.key]}
                        onChange={e => setAiConfigTypes(prev => ({ ...prev, [item.key]: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-14 rounded border bg-background px-2 py-1 text-xs text-center text-foreground focus:outline-none focus:ring-1 focus:ring-sky-600/30"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerateFromAiFile}
                disabled={!!aiBackgroundTask || !selectedCourseFile}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {aiBackgroundTask ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t('questionBank.generatingQuestions')}</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> {t('questionBank.generateQuestions')}</>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Edit Bank Modal
  // -------------------------------------------------------
  const renderEditModal = () => (
    <AnimatePresence>
      {editModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!editingBank) setEditModalOpen(false); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl"
            dir={direction}
          >
            <div className="flex items-center justify-between border-b p-5">
              <h3 className="text-lg font-bold text-foreground">{t('questionBank.editBank')}</h3>
              <button onClick={() => { if (!editingBank) setEditModalOpen(false); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.editBankName')}</label>
                <input
                  type="text"
                  value={editBankName}
                  onChange={e => setEditBankName(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                  dir={direction}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('questionBank.editBankDesc')}</label>
                <textarea
                  value={editBankDesc}
                  onChange={e => setEditBankDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors resize-none"
                  dir={direction}
                />
              </div>
              <button
                onClick={handleEditBank}
                disabled={editingBank || !editBankName.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-700 py-2.5 text-sm font-medium text-white hover:bg-sky-800 transition-colors disabled:opacity-50"
              >
                {editingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('common.saveChanges')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <div className="space-y-0">
      {/* Background AI generation task indicator — sticky at top */}
      <AnimatePresence>
        {aiBackgroundTask && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="sticky top-0 z-30 overflow-hidden"
          >
            <div className="relative overflow-hidden border border-violet-200 dark:border-violet-800/40 bg-gradient-to-bl from-violet-50 via-white to-violet-50 dark:from-violet-950/30 dark:via-background dark:to-violet-950/30 px-4 py-3 shadow-md backdrop-blur-sm" dir={direction}>
              {/* Animated shimmer background */}
              <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-violet-200/20 dark:via-violet-500/10 to-transparent" />

              <div className="relative space-y-2.5">
                {/* Row 1: Title + Subject + Cancel */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40">
                      <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400 animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-violet-800 dark:text-violet-300 truncate">
                        {t('questionBank.backgroundGenerating', { bankName: aiBackgroundTask.bankName })}
                      </p>
                      {aiBackgroundTask.subjectName && (
                        <p className="text-xs text-violet-600 dark:text-violet-400 truncate">
                          {t('questionBank.subjectNameLabel', { name: aiBackgroundTask.subjectName })}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleCancelAiGeneration}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-200/60 dark:bg-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-rose-200 dark:hover:bg-rose-800/40 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
                    title={t('questionBank.cancelGeneration')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Row 2: Prominent stage name */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wide">
                    {t('questionBank.stageLabel')}
                  </span>
                  <span className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                    {aiBackgroundTask.status === 'extracting' && t('questionBank.stageExtracting')}
                    {aiBackgroundTask.status === 'generating' && t('questionBank.stageGenerating')}
                    {aiBackgroundTask.status === 'saving' && t('questionBank.stageSaving')}
                  </span>
                </div>

                {/* Row 3: Step indicators with progress bar */}
                <div className="space-y-1.5">
                  {/* Step labels */}
                  <div className="flex items-center justify-between gap-2">
                    {[
                      { key: 'extracting', label: t('questionBank.backgroundExtracting') },
                      { key: 'generating', label: t('questionBank.backgroundGeneratingStatus') },
                      { key: 'saving', label: t('questionBank.backgroundSaving') },
                    ].map((step, idx) => {
                      const stepOrder = ['extracting', 'generating', 'saving'];
                      const currentIndex = stepOrder.indexOf(aiBackgroundTask.status);
                      const stepIndex = idx;
                      const isActive = step.key === aiBackgroundTask.status;
                      const isDone = stepIndex < currentIndex;

                      return (
                        <div key={step.key} className="flex items-center gap-1.5 flex-1">
                          <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-300 shrink-0 ${
                            isDone
                              ? 'bg-violet-500 text-white'
                              : isActive
                                ? 'bg-violet-500 text-white ring-2 ring-violet-300 dark:ring-violet-600 ring-offset-1 ring-offset-white dark:ring-offset-background'
                                : 'bg-violet-200 dark:bg-violet-800 text-violet-500 dark:text-violet-400'
                          }`}>
                            {isDone ? '✓' : idx + 1}
                          </div>
                          <span className={`text-[11px] font-medium transition-colors duration-300 truncate ${
                            isDone ? 'text-violet-700 dark:text-violet-300' : isActive ? 'text-violet-700 dark:text-violet-300' : 'text-violet-400 dark:text-violet-500'
                          }`}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Progress bar */}
                  {aiBackgroundTask.status && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-violet-200 dark:bg-violet-900/50">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-l from-violet-500 to-violet-400"
                        initial={{ width: aiBackgroundTask.status === 'extracting' ? '5%' : aiBackgroundTask.status === 'generating' ? '40%' : '80%' }}
                        animate={{
                          width: aiBackgroundTask.status === 'extracting'
                            ? ['5%', '30%', '15%']
                            : aiBackgroundTask.status === 'generating'
                              ? ['40%', '65%', '50%']
                              : ['80%', '95%', '90%'],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {view === 'list' ? renderBankList() : renderBankDetail()}
      {renderCreateModal()}
      {renderAddQuestionModal()}
      {renderAiModal()}
      {renderEditModal()}
      <ExportGoogleFormModal
        open={googleFormsModalOpen}
        onClose={() => setGoogleFormsModalOpen(false)}
        selectedQuestionIds={selectedBank?.questions?.map(q => q.id) || []}
        selectedBankIds={selectedBank ? [selectedBank.id] : []}
        totalQuestionCount={selectedBank?.questions?.length || 0}
      />
    </div>
  );
}
