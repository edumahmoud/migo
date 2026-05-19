'use client';

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { extractTextFromFile } from '@/lib/pdf-client';
import type { UserProfile, Subject, QuestionBank, BankQuestion, QuizQuestion, SubjectFile } from '@/lib/types';

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
  throw lastError || new Error('فشل الاتصال بعد عدة محاولات');
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface QuestionBankSectionProps {
  profile: UserProfile;
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

function questionTypeLabel(type: string): string {
  switch (type) {
    case 'mcq': return 'اختيار متعدد';
    case 'boolean': return 'صح/خطأ';
    case 'completion': return 'إكمال';
    case 'matching': return 'مطابقة';
    default: return type;
  }
}

function difficultyLabel(d?: string | null): string {
  switch (d) {
    case 'easy': return 'سهل';
    case 'medium': return 'متوسط';
    case 'hard': return 'صعب';
    default: return 'غير محدد';
  }
}

function difficultyColor(d?: string | null): string {
  switch (d) {
    case 'easy': return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'medium': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'hard': return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    default: return 'bg-muted/50 text-muted-foreground border-border';
  }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function QuestionBankSection({ profile }: QuestionBankSectionProps) {
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

  // ─── Edit bank ───
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editBankName, setEditBankName] = useState('');
  const [editBankDesc, setEditBankDesc] = useState('');
  const [editingBank, setEditingBank] = useState(false);

  // ─── Deleting ───
  const [deletingBankId, setDeletingBankId] = useState<string | null>(null);
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null);

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

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([fetchBanks(), fetchSubjects()]);
    setLoading(false);
  }, [fetchBanks, fetchSubjects]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

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
      toast.error('يرجى إدخال اسم بنك الأسئلة');
      return;
    }
    if (!bankSubjectId) {
      toast.error('يرجى اختيار المقرر');
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
        toast.success('تم إنشاء بنك الأسئلة بنجاح');
        setCreateModalOpen(false);
        setBankName('');
        setBankDescription('');
        setBankSubjectId('');
        fetchBanks();
      } else {
        toast.error(data.error || 'حدث خطأ أثناء إنشاء بنك الأسئلة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        toast.success('تم حذف بنك الأسئلة بنجاح');
        fetchBanks();
        if (selectedBank?.id === bankId) {
          setSelectedBank(null);
          setView('list');
        }
      } else {
        toast.error(data.error || 'حدث خطأ أثناء حذف بنك الأسئلة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        toast.success('تم تحديث بنك الأسئلة بنجاح');
        setEditModalOpen(false);
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || 'حدث خطأ أثناء التحديث');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      toast.error('يرجى إدخال نص السؤال');
      return;
    }
    if (!selectedBank) return;

    let questionData: Record<string, unknown>;

    switch (currentQuestionType) {
      case 'mcq': {
        const filledOptions = mcqOptions.filter(o => o.trim());
        if (filledOptions.length < 2) {
          toast.error('يرجى إدخال خيارين على الأقل');
          return;
        }
        if (!mcqOptions[mcqCorrect]?.trim()) {
          toast.error('يرجى التأكد من أن الإجابة الصحيحة ليست فارغة');
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
          correct_answer: booleanCorrect ? 'صح' : 'خطأ',
        };
        break;
      }
      case 'completion': {
        if (!completionAnswer.trim()) {
          toast.error('يرجى إدخال الإجابة الصحيحة');
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
          toast.error('يرجى إدخال زوجين على الأقل');
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
        toast.success('تم إضافة السؤال بنجاح');
        setAddQuestionModalOpen(false);
        resetQuestionForm();
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || 'حدث خطأ أثناء إضافة السؤال');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        toast.success('تم حذف السؤال بنجاح');
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || 'حدث خطأ أثناء حذف السؤال');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
  const handleGenerateFromAiFile = async () => {
    if (!selectedCourseFile || !selectedBank) {
      toast.error('يرجى اختيار ملف');
      return;
    }

    setGeneratingFromAi(true);
    try {
      const headers = await getCachedAuthHeaders();
      const token = headers['Authorization']?.replace('Bearer ', '') || '';

      // ─── Step 1: Extract text from file (multi-strategy with fallbacks) ───
      let content: string | null = null;

      // Strategy A: Server-side extraction from URL (most reliable for existing files)
      try {
        const extractController = new AbortController();
        const extractTimeoutId = setTimeout(() => extractController.abort(), 45000);

        const extractRes = await fetchWithRetry('/api/files/extract-pdf-url', {
          method: 'POST',
          headers,
          signal: extractController.signal,
          timeoutMs: 45000,
          body: JSON.stringify({
            url: selectedCourseFile.file_url,
            fileName: selectedCourseFile.file_name,
          }),
        });

        clearTimeout(extractTimeoutId);

        const extractData = await extractRes.json();
        if (extractRes.ok && extractData.success && extractData.data?.text) {
          content = extractData.data.text;
          console.log('[QB AI] Server-side extraction succeeded, text length:', content!.length);
        }
      } catch (extractErr) {
        console.warn('[QB AI] Server-side extraction failed, trying client-side fallback:', extractErr);
      }

      // Strategy B: Client-side extraction fallback
      // If server-side failed, download the file and extract on the client
      if (!content || content.trim().length < 50) {
        try {
          console.log('[QB AI] Attempting client-side extraction fallback...');
          const downloadRes = await fetchWithRetry(selectedCourseFile.file_url, {
            timeoutMs: 30000,
          });

          if (downloadRes.ok) {
            const arrayBuffer = await downloadRes.arrayBuffer();
            const extractionTimeoutMs = 30000;
            const extractionPromise = extractTextFromFile(arrayBuffer, selectedCourseFile.file_name);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), extractionTimeoutMs)
            );

            const result = await Promise.race([extractionPromise, timeoutPromise]);
            content = result.text;
            console.log('[QB AI] Client-side extraction succeeded, text length:', content.length);
          }
        } catch (fallbackErr) {
          console.warn('[QB AI] Client-side extraction also failed:', fallbackErr);
        }
      }

      if (!content || content.trim().length < 50) {
        toast.error('فشل استخراج النص من الملف. تأكد أن الملف ليس ممسوحاً ضوئياً أو محمياً');
        setGeneratingFromAi(false);
        return;
      }

      // ─── Step 2: Generate questions using AI ───
      const quizController = new AbortController();
      const quizTimeoutId = setTimeout(() => quizController.abort(), 120000);

      let quizRes: Response;
      try {
        quizRes = await fetchWithRetry('/api/gemini/quiz', {
          method: 'POST',
          headers,
          signal: quizController.signal,
          timeoutMs: 120000,
          body: JSON.stringify({
            content,
            questionTypes: aiConfigTypes,
          }),
        });
      } catch (quizErr) {
        clearTimeout(quizTimeoutId);
        // Error recovery: re-fetch bank detail in case questions were generated but response was lost
        await fetchBankDetail(selectedBank.id);
        throw quizErr;
      }

      clearTimeout(quizTimeoutId);

      const quizData = await quizRes.json();
      if (!quizRes.ok || !quizData.success) {
        toast.error(quizData.error || 'فشل إنشاء الأسئلة');
        setGeneratingFromAi(false);
        return;
      }

      const questions = quizData.data.questions as QuizQuestion[];
      if (!questions || questions.length === 0) {
        toast.error('لم يتم إنشاء أي أسئلة');
        setGeneratingFromAi(false);
        return;
      }

      // ─── Step 3: Add questions to the bank via API ───
      const bankQuestions = questions.map(q => ({
        type: q.type,
        question: q.question,
        options: q.options || null,
        correct_answer: q.correctAnswer || null,
        pairs: q.pairs || null,
      }));

      let saveSucceeded = false;
      try {
        const saveRes = await fetchWithRetry('/api/question-bank', {
          method: 'PUT',
          headers,
          timeoutMs: 30000,
          body: JSON.stringify({
            bankId: selectedBank.id,
            addQuestions: bankQuestions,
          }),
        });

        const result = await saveRes.json();
        saveSucceeded = result.success === true;
        if (!saveSucceeded) {
          toast.error(result.error || 'حدث خطأ أثناء إضافة الأسئلة');
        }
      } catch (saveErr) {
        console.warn('[QB AI] Save request failed, attempting recovery:', saveErr);
        // Error recovery: re-fetch bank detail — the save may have succeeded on the server
        // even though the HTTP response was lost (network drop, timeout, etc.)
        await fetchBankDetail(selectedBank.id);
        toast.error('حدث خطأ أثناء حفظ الأسئلة. قد تكون تم إضافتها — يرجى التحقق من البنك');
        setGeneratingFromAi(false);
        return;
      }

      if (saveSucceeded) {
        toast.success(`تم إنشاء ${questions.length} سؤال وإضافتهم للبنك بنجاح`);
        setAiModalOpen(false);
        setSelectedCourseFile(null);
        setCourseFiles([]);
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('abort') || errMsg.includes('AbortError') || errMsg.includes('TIMEOUT')) {
        toast.error('انتهت مهلة العملية. يرجى المحاولة مرة أخرى');
        // Recovery: re-fetch in case operation completed on server
        if (selectedBank) await fetchBankDetail(selectedBank.id);
      } else {
        toast.error('حدث خطأ أثناء إنشاء الأسئلة من الملف');
      }
    } finally {
      setGeneratingFromAi(false);
    }
  };

  // -------------------------------------------------------
  // Export bank questions as JSON
  // -------------------------------------------------------
  const handleExportBank = (bank: QuestionBank & { questions?: BankQuestion[] }) => {
    if (!bank.questions || bank.questions.length === 0) {
      toast.error('لا توجد أسئلة للتصدير');
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
    a.download = `${bank.name}_أسئلة.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('تم تصدير الأسئلة بنجاح');
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
        toast.error('صيغة الملف غير صحيحة');
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
        toast.success(`تم استيراد ${questions.length} سؤال بنجاح`);
        fetchBankDetail(selectedBank.id);
        fetchBanks();
      } else {
        toast.error(data.error || 'حدث خطأ أثناء الاستيراد');
      }
    } catch {
      toast.error('حدث خطأ أثناء قراءة الملف. تأكد من صيغة JSON');
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
        <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
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
        <label className="text-sm font-medium text-foreground mb-1.5 block">نوع السؤال</label>
        <div className="flex flex-wrap gap-2">
          {[
            { type: 'mcq' as const, label: 'اختيار متعدد' },
            { type: 'boolean' as const, label: 'صح/خطأ' },
            { type: 'completion' as const, label: 'إكمال' },
            { type: 'matching' as const, label: 'مطابقة' },
          ].map(opt => (
            <button
              key={opt.type}
              onClick={() => setCurrentQuestionType(opt.type)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                currentQuestionType === opt.type
                  ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
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
        <label className="text-sm font-medium text-foreground mb-1.5 block">نص السؤال</label>
        <input
          type="text"
          value={currentQuestionText}
          onChange={e => setCurrentQuestionText(e.target.value)}
          placeholder={currentQuestionType === 'completion' ? 'أدخل النص مع ____ مكان الفراغ' : 'أدخل نص السؤال'}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
          dir="rtl"
        />
      </div>

      {/* MCQ options */}
      {currentQuestionType === 'mcq' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground mb-1.5 block">الخيارات</label>
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
                placeholder={`الخيار ${idx + 1}`}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                dir="rtl"
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">اضغط على الدائرة لتحديد الإجابة الصحيحة</p>
        </div>
      )}

      {/* Boolean */}
      {currentQuestionType === 'boolean' && (
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">الإجابة الصحيحة</label>
          <div className="flex gap-2">
            <button
              onClick={() => setBooleanCorrect(true)}
              className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition-all ${
                booleanCorrect ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200' : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >صح</button>
            <button
              onClick={() => setBooleanCorrect(false)}
              className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition-all ${
                !booleanCorrect ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300' : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >خطأ</button>
          </div>
        </div>
      )}

      {/* Completion */}
      {currentQuestionType === 'completion' && (
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">الإجابة الصحيحة</label>
          <input
            type="text"
            value={completionAnswer}
            onChange={e => setCompletionAnswer(e.target.value)}
            placeholder="أدخل الإجابة الصحيحة للفراغ"
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir="rtl"
          />
        </div>
      )}

      {/* Matching */}
      {currentQuestionType === 'matching' && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground mb-1.5 block">أزواج المطابقة</label>
          {matchingPairs.map((pair, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={pair.key}
                onChange={e => { const n = [...matchingPairs]; n[idx] = { ...n[idx], key: e.target.value }; setMatchingPairs(n); }}
                placeholder="العنصر"
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                dir="rtl"
              />
              <span className="text-muted-foreground text-sm">←</span>
              <input
                type="text"
                value={pair.value}
                onChange={e => { const n = [...matchingPairs]; n[idx] = { ...n[idx], value: e.target.value }; setMatchingPairs(n); }}
                placeholder="المطابق"
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                dir="rtl"
              />
              {matchingPairs.length > 1 && (
                <button onClick={() => setMatchingPairs(matchingPairs.filter((_, i) => i !== idx))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 transition-colors">
                  <Minus className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setMatchingPairs([...matchingPairs, { key: '', value: '' }])} className="flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-300 hover:text-sky-800 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            إضافة زوج آخر
          </button>
        </div>
      )}

      {/* Difficulty & Category */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">الصعوبة</label>
          <select
            value={questionDifficulty}
            onChange={e => setQuestionDifficulty(e.target.value as '' | 'easy' | 'medium' | 'hard')}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors appearance-none cursor-pointer"
            dir="rtl"
          >
            <option value="">بدون تحديد</option>
            <option value="easy">سهل</option>
            <option value="medium">متوسط</option>
            <option value="hard">صعب</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">التصنيف</label>
          <input
            type="text"
            value={questionCategory}
            onChange={e => setQuestionCategory(e.target.value)}
            placeholder="مثال: الفصل الأول"
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir="rtl"
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
            <Database className="h-6 w-6 text-sky-700 dark:text-sky-300" />
            بنك الأسئلة
          </h2>
          <p className="text-muted-foreground mt-1">إدارة بنوك الأسئلة المرتبطة بالمقررات</p>
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
        >
          <Plus className="h-4 w-4" />
          إنشاء بنك جديد
        </button>
      </motion.div>

      {/* Search & Filter */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="بحث في بنوك الأسئلة..."
            className="w-full rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir="rtl"
          />
        </div>
        <div className="relative">
          <Filter className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <select
            value={filterSubjectId}
            onChange={e => setFilterSubjectId(e.target.value)}
            className="rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors appearance-none cursor-pointer min-w-[160px]"
            dir="rtl"
          >
            <option value="all">جميع المقررات</option>
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
              <Database className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{banks.length}</p>
              <p className="text-xs text-muted-foreground">بنك أسئلة</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
              <ListChecks className="h-5 w-5 text-teal-700 dark:text-teal-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{banks.reduce((sum, b) => sum + (b.question_count || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">إجمالي الأسئلة</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <BookOpen className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{subjects.length}</p>
              <p className="text-xs text-muted-foreground">مقرر مرتبط</p>
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
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد بنوك أسئلة</p>
          <p className="text-sm text-muted-foreground mb-4">ابدأ بإنشاء بنك أسئلة مرتبط بأحد مقرراتك</p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
          >
            <Plus className="h-4 w-4" />
            إنشاء بنك جديد
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        {deletingBankId === bank.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ListChecks className="h-3 w-3" />
                          {bank.question_count || 0} سؤال
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
        <motion.div variants={itemVariants} className="flex items-center gap-3">
          <button
            onClick={() => { setView('list'); setSelectedBank(null); }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-foreground truncate">{selectedBank.name}</h2>
            <p className="text-sm text-muted-foreground">
              {selectedBank.subject_name} · {questions.length} سؤال
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenEditBank}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              title="تعديل"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleExportBank(selectedBank as QuestionBank & { questions: BankQuestion[] })}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              title="تصدير"
            >
              <Download className="h-4 w-4" />
            </button>
            <label
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
              title="استيراد أسئلة من ملف JSON"
            >
              <Upload className="h-4 w-4" />
              <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            </label>
            <button
              onClick={() => { setAiModalOpen(true); loadCourseFiles(selectedBank.subject_id); }}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2.5 text-xs font-medium hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
              title="إنشاء أسئلة من ملف المقرر"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">إنشاء بالذكاء</span>
            </button>
            <button
              onClick={() => setAddQuestionModalOpen(true)}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-sky-700 text-white px-2.5 text-xs font-medium hover:bg-sky-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة سؤال
            </button>
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
            <p className="text-sm font-semibold text-foreground mb-1">لا توجد أسئلة بعد</p>
            <p className="text-xs text-muted-foreground mb-3">أضف أسئلة يدوياً أو أنشئها من ملفات المقرر بالذكاء الاصطناعي</p>
            <div className="flex gap-2">
              <button
                onClick={() => setAddQuestionModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة يدوية
              </button>
              <button
                onClick={() => { setAiModalOpen(true); loadCourseFiles(selectedBank.subject_id); }}
                className="flex items-center gap-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-3 py-2 text-xs font-medium hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                إنشاء بالذكاء
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div variants={itemVariants} className="space-y-2">
            {questions.map((q, idx) => (
              <div key={q.id} className="rounded-lg border bg-card p-4 shadow-sm group hover:border-sky-200 dark:hover:border-sky-800 transition-all">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 text-xs font-bold">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-medium text-foreground">{q.question}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800">
                        {questionTypeLabel(q.type)}
                      </span>
                      {q.difficulty && (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${difficultyColor(q.difficulty)}`}>
                          {difficultyLabel(q.difficulty)}
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
                                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-medium'
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
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                      }`}>
                        {q.correct_answer}
                      </span>
                    )}
                    {q.type === 'completion' && q.correct_answer && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        الإجابة: {q.correct_answer}
                      </span>
                    )}
                    {q.type === 'matching' && q.pairs && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(q.pairs as { key: string; value: string }[]).map((pair, pi) => (
                          <span key={pi} className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            {pair.key} ← {pair.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteQuestion(q.id)}
                    disabled={deletingQuestionId === q.id}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    {deletingQuestionId === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* Go to course exams tab */}
        <motion.div variants={itemVariants} className="rounded-lg border bg-sky-50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              <div>
                <p className="text-sm font-medium text-sky-800 dark:text-sky-200">إنشاء اختبار من هذا البنك</p>
                <p className="text-xs text-sky-600 dark:text-sky-400">انتقل لصفحة الاختبارات في المقرر لاستيراد الأسئلة</p>
              </div>
            </div>
            <button
              onClick={() => handleGoToCourse(selectedBank.subject_id)}
              className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              الذهاب للمقرر
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
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b p-5 sticky top-0 bg-background z-10">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Database className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                إنشاء بنك أسئلة جديد
              </h3>
              <button onClick={() => { if (!creatingBank) setCreateModalOpen(false); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">اسم بنك الأسئلة <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  placeholder="مثال: أسئلة الفصل الأول"
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                  dir="rtl"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">المقرر <span className="text-rose-500">*</span></label>
                <select
                  value={bankSubjectId}
                  onChange={e => setBankSubjectId(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors appearance-none cursor-pointer"
                  dir="rtl"
                >
                  <option value="">اختر المقرر</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف (اختياري)</label>
                <textarea
                  value={bankDescription}
                  onChange={e => setBankDescription(e.target.value)}
                  placeholder="وصف اختياري لبنك الأسئلة..."
                  rows={3}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors resize-none"
                  dir="rtl"
                />
              </div>
              <button
                onClick={handleCreateBank}
                disabled={creatingBank || !bankName.trim() || !bankSubjectId}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-700 py-2.5 text-sm font-medium text-white hover:bg-sky-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingBank ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري الإنشاء...</> : <><Plus className="h-4 w-4" /> إنشاء البنك</>}
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
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b p-5 sticky top-0 bg-background z-10">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Plus className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                إضافة سؤال
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
                className="w-full mt-5 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-3 text-sm font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-50 hover:border-sky-400 transition-colors disabled:opacity-50"
              >
                {addingQuestion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                إضافة السؤال
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
          onClick={() => { if (!generatingFromAi) { setAiModalOpen(false); setSelectedCourseFile(null); setCourseFiles([]); } }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto"
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b p-5 sticky top-0 bg-background z-10">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                إنشاء أسئلة بالذكاء الاصطناعي
              </h3>
              <button onClick={() => { if (!generatingFromAi) { setAiModalOpen(false); setSelectedCourseFile(null); setCourseFiles([]); } }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Select file */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">اختر ملف من مقرراتك</label>
                {loadingCourseFiles ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : courseFiles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center">
                    <FolderOpen className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">لا توجد ملفات (PDF/Word) في هذا المقرر</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                    {courseFiles.map(file => (
                      <button
                        key={file.id}
                        onClick={() => setSelectedCourseFile(file)}
                        className={`w-full flex items-center gap-2 rounded-lg border p-2.5 text-right transition-all ${
                          selectedCourseFile?.id === file.id
                            ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground truncate">{file.file_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Question types config */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">عدد الأسئلة حسب النوع</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'mcq' as const, label: 'اختيار متعدد' },
                    { key: 'boolean' as const, label: 'صح/خطأ' },
                    { key: 'completion' as const, label: 'إكمال' },
                    { key: 'matching' as const, label: 'مطابقة' },
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
                disabled={generatingFromAi || !selectedCourseFile}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generatingFromAi ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> جاري إنشاء الأسئلة...</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> إنشاء الأسئلة</>
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
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b p-5">
              <h3 className="text-lg font-bold text-foreground">تعديل بنك الأسئلة</h3>
              <button onClick={() => { if (!editingBank) setEditModalOpen(false); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">اسم بنك الأسئلة</label>
                <input
                  type="text"
                  value={editBankName}
                  onChange={e => setEditBankName(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                  dir="rtl"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف</label>
                <textarea
                  value={editBankDesc}
                  onChange={e => setEditBankDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors resize-none"
                  dir="rtl"
                />
              </div>
              <button
                onClick={handleEditBank}
                disabled={editingBank || !editBankName.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-700 py-2.5 text-sm font-medium text-white hover:bg-sky-800 transition-colors disabled:opacity-50"
              >
                {editingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                حفظ التعديلات
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
      {view === 'list' ? renderBankList() : renderBankDetail()}
      {renderCreateModal()}
      {renderAddQuestionModal()}
      {renderAiModal()}
      {renderEditModal()}
    </div>
  );
}
