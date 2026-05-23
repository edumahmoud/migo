'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// xlsx is dynamically imported in handleExportQuizResults to reduce initial bundle size
import {
  ClipboardList,
  Loader2,
  Trash2,
  Play,
  Calendar,
  Clock,
  Trophy,
  Eye,
  EyeOff,
  RotateCcw,
  Shuffle,
  Eye as EyeIcon,
  Settings,

  Pencil,
  Plus,
  X,
  CheckCircle2,
  GripVertical,
  Minus,
  Download,
  Users,
  AlertTriangle,
  Database,
  Copy,
  FileText,
  FolderOpen,
  Sparkles,
  ListChecks,
  Type,
  Link2,
  BookOpen,
  Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/app-store';
import type { UserProfile, Subject, Quiz, QuizQuestion, Score, SubjectFile, QuestionBank, BankQuestion } from '@/lib/types';
import QuizSettingsModal from '@/components/shared/quiz-settings-modal';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface ExamsTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  subject: Subject;
  teacherName: string;
}

// -------------------------------------------------------
// Sub-tab type
// -------------------------------------------------------
type ExamSubTab = 'active' | 'finished';

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function scorePercentage(score: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((score / total) * 100);
}

// -------------------------------------------------------
// Countdown timer for scheduled quizzes
// -------------------------------------------------------
function QuizCountdown({ scheduledDate, scheduledTime }: { scheduledDate: string; scheduledTime?: string }) {
  const [remaining, setRemaining] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const target = new Date(`${scheduledDate}T${scheduledTime || '00:00'}`);
    if (isNaN(target.getTime())) return;

    const tick = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) {
        setStarted(true);
        setRemaining(null);
        return;
      }
      setStarted(false);
      setRemaining({
        d: Math.floor(diff / 86_400_000),
        h: Math.floor((diff % 86_400_000) / 3_600_000),
        m: Math.floor((diff % 3_600_000) / 60_000),
        s: Math.floor((diff % 60_000) / 1_000),
      });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [scheduledDate, scheduledTime]);

  if (started) {
    return (
      <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800">
        <Play className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
        <span className="text-xs font-bold text-sky-700 dark:text-sky-300">متاح الآن</span>
      </div>
    );
  }

  if (!remaining) return null;

  const parts: string[] = [];
  if (remaining.d > 0) parts.push(`${remaining.d} يوم`);
  if (remaining.h > 0 || remaining.d > 0) parts.push(`${remaining.h} ساعة`);
  if (remaining.m > 0 || remaining.h > 0 || remaining.d > 0) parts.push(`${remaining.m} دقيقة`);
  parts.push(`${remaining.s} ثانية`);

  return (
    <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
      <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 animate-pulse" />
      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
        يبدأ بعد: {parts.join(' و ')}
      </span>
    </div>
  );
}

/**
 * Determines if a quiz belongs in the "finished" tab.
 * A quiz is considered finished if:
 * 1. The explicit `is_finished` flag is set, OR
 * 2. The quiz's scheduled date/time has passed AND the teacher has not set is_finished=false explicitly
 * This ensures expired quizzes automatically move to the finished tab
 * while still allowing teachers to manually control the state.
 */
function isQuizFinished(quiz: Quiz): boolean {
  if (!quiz) return false;
  if (quiz.is_finished) return true;
  // Auto-classify expired quizzes (scheduled date has passed) as finished
  if (quiz.scheduled_date && !quiz.is_finished) {
    try {
      const scheduledDate = new Date(`${quiz.scheduled_date}T${quiz.scheduled_time || '23:59'}`);
      if (!isNaN(scheduledDate.getTime()) && scheduledDate < new Date()) return true;
    } catch { /* invalid date — treat as not finished */ }
  }
  return false;
}

/**
 * Determines if a quiz's scheduled date/time has passed.
 * Used ONLY for display badges, not for tab classification.
 */
function isQuizExpired(quiz: Quiz): boolean {
  if (!quiz || !quiz.scheduled_date) return false;
  try {
    const scheduledDate = new Date(`${quiz.scheduled_date}T${quiz.scheduled_time || '23:59'}`);
    if (isNaN(scheduledDate.getTime())) return false;
    return scheduledDate < new Date();
  } catch { return false; }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function ExamsTab({ profile, role, subjectId }: ExamsTabProps) {
  const { setViewingQuizId } = useAppStore();

  // ─── Sub-tab ───
  const [subTab, setSubTab] = useState<ExamSubTab>('active');


  // ─── Data ───
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [subjectStudents, setSubjectStudents] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Create / Edit quiz modal ───
  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [quizInputMode, setQuizInputMode] = useState<'manual' | 'ai-file' | 'bank'>('manual');
  const [quizTitle, setQuizTitle] = useState('');
  const [quizDuration, setQuizDuration] = useState('');
  const [quizDate, setQuizDate] = useState('');
  const [quizTime, setQuizTime] = useState('');
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionType, setCurrentQuestionType] = useState<QuizQuestion['type']>('mcq');
  const [currentQuestionText, setCurrentQuestionText] = useState('');
  const [mcqOptions, setMcqOptions] = useState(['', '', '', '']);
  const [mcqCorrect, setMcqCorrect] = useState(0);
  const [booleanCorrect, setBooleanCorrect] = useState(true);
  const [completionAnswer, setCompletionAnswer] = useState('');
  const [matchingPairs, setMatchingPairs] = useState<{ key: string; value: string }[]>([
    { key: '', value: '' },
  ]);
  // ─── Quiz settings in creation form ───
  const [quizShowResults, setQuizShowResults] = useState(true);
  const [quizAllowRetake, setQuizAllowRetake] = useState(true);
  const [quizShuffleQuestions, setQuizShuffleQuestions] = useState(true);

  const [savingQuiz, setSavingQuiz] = useState(false);

  // ─── AI quiz from file ───
  const [courseFiles, setCourseFiles] = useState<SubjectFile[]>([]);
  const [selectedCourseFile, setSelectedCourseFile] = useState<SubjectFile | null>(null);
  const [loadingCourseFiles, setLoadingCourseFiles] = useState(false);
  const [generatingFromAi, setGeneratingFromAi] = useState(false);
  const [aiQuizConfigTypes, setAiQuizConfigTypes] = useState({ mcq: 3, boolean: 2, completion: 2, matching: 2 });

  // ─── Import from bank ───
  const [subjectBanks, setSubjectBanks] = useState<QuestionBank[]>([]);
  const [selectedBank, setSelectedBank] = useState<QuestionBank | null>(null);
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [selectedBankQuestionIds, setSelectedBankQuestionIds] = useState<Set<string>>(new Set());
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [importingFromBank, setImportingFromBank] = useState(false);

  // ─── Delete quiz ───
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteQuizConfirmId, setDeleteQuizConfirmId] = useState<string | null>(null);

  // ─── Quiz toggles ───
  const [togglingQuizId, setTogglingQuizId] = useState<string | null>(null);

  // ─── Quiz settings modal ───
  const [settingsQuiz, setSettingsQuiz] = useState<Quiz | null>(null);

  // -------------------------------------------------------
  // Fetch quizzes and scores
  // -------------------------------------------------------
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch quizzes and scores in parallel
      const quizzesPromise = supabase
        .from('quizzes')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });

      const scoresPromise = role === 'student'
        ? supabase.from('scores').select('*').eq('student_id', profile.id)
        : supabase.from('scores').select('*').eq('teacher_id', profile.id);

      const studentsPromise = role === 'teacher'
        ? supabase.from('subject_students').select('student_id').eq('subject_id', subjectId)
        : Promise.resolve({ data: [], error: null });

      const [quizzesResult, scoresResult, studentsResult] = await Promise.all([
        quizzesPromise,
        scoresPromise,
        studentsPromise,
      ]);

      // Process quizzes — defensively ensure questions is always an array
      const { data, error } = quizzesResult;
      if (error) {
        console.error('Error fetching quizzes:', error);
      } else {
        const rawQuizzes = (data as Quiz[]) || [];
        // Ensure each quiz has a valid questions array (JSONB may come back as string or null)
        const safeQuizzes = rawQuizzes.map(q => ({
          ...q,
          questions: Array.isArray(q.questions) ? q.questions : [],
        }));
        setQuizzes(safeQuizzes);
      }

      // Process scores — defensively handle null/undefined
      const rawScores = (scoresResult.data as Score[]) || [];
      const safeScores = rawScores.map(s => ({
        ...s,
        user_answers: Array.isArray(s.user_answers) ? s.user_answers : [],
      }));
      setScores(safeScores);

      // Process subject students for teacher
      if (role === 'teacher' && studentsResult.data && studentsResult.data.length > 0) {
        const studentIds = (studentsResult.data as { student_id: string }[]).map((l) => l.student_id);
        const { data: studentProfiles } = await supabase
          .from('users')
          .select('*')
          .in('id', studentIds);
        setSubjectStudents((studentProfiles as UserProfile[]) || []);
      } else {
        setSubjectStudents([]);
      }
    } catch (err) {
      console.error('Fetch data error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId, profile.id, role]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // -------------------------------------------------------
  // Question builder helpers
  // -------------------------------------------------------
  const resetQuestionForm = () => {
    setCurrentQuestionText('');
    setMcqOptions(['', '', '', '']);
    setMcqCorrect(0);
    setBooleanCorrect(true);
    setCompletionAnswer('');
    setMatchingPairs([{ key: '', value: '' }]);
  };

  const resetQuizForm = () => {
    setQuizTitle('');
    setQuizDuration('');
    setQuizDate('');
    setQuizTime('');
    setQuizQuestions([]);
    setEditingQuiz(null);
    setQuizInputMode('manual');
    setSelectedCourseFile(null);
    setGeneratingFromAi(false);
    setSelectedBank(null);
    setBankQuestions([]);
    setSelectedBankQuestionIds(new Set());
    setSubjectBanks([]);
    setQuizShowResults(true);
    setQuizAllowRetake(true);
    setQuizShuffleQuestions(true);
    resetQuestionForm();
  };

  const handleAddQuestion = () => {
    if (!currentQuestionText.trim()) {
      toast.error('يرجى إدخال نص السؤال');
      return;
    }

    let question: QuizQuestion;

    switch (currentQuestionType) {
      case 'mcq': {
        const filledOptions = mcqOptions.filter((o) => o.trim());
        if (filledOptions.length < 2) {
          toast.error('يرجى إدخال خيارين على الأقل');
          return;
        }
        if (!mcqOptions[mcqCorrect]?.trim()) {
          toast.error('يرجى التأكد من أن الإجابة الصحيحة ليست فارغة');
          return;
        }
        question = {
          type: 'mcq',
          question: currentQuestionText.trim(),
          options: mcqOptions.map((o) => o.trim()),
          correctAnswer: mcqOptions[mcqCorrect].trim(),
        };
        break;
      }
      case 'boolean': {
        question = {
          type: 'boolean',
          question: currentQuestionText.trim(),
          correctAnswer: booleanCorrect ? 'صح' : 'خطأ',
        };
        break;
      }
      case 'completion': {
        if (!completionAnswer.trim()) {
          toast.error('يرجى إدخال الإجابة الصحيحة');
          return;
        }
        question = {
          type: 'completion',
          question: currentQuestionText.trim(),
          correctAnswer: completionAnswer.trim(),
        };
        break;
      }
      case 'matching': {
        const validPairs = matchingPairs.filter((p) => p.key.trim() && p.value.trim());
        if (validPairs.length < 2) {
          toast.error('يرجى إدخال زوجين على الأقل');
          return;
        }
        question = {
          type: 'matching',
          question: currentQuestionText.trim(),
          pairs: validPairs.map((p) => ({ key: p.key.trim(), value: p.value.trim() })),
        };
        break;
      }
      default:
        return;
    }

    setQuizQuestions([...quizQuestions, question]);
    resetQuestionForm();
    toast.success('تم إضافة السؤال بنجاح');
  };

  const handleRemoveQuestion = (index: number) => {
    setQuizQuestions(quizQuestions.filter((_, i) => i !== index));
  };

  // -------------------------------------------------------
  // Create / Update quiz
  // -------------------------------------------------------
  const handleSaveQuiz = async () => {
    if (!quizTitle.trim()) {
      toast.error('يرجى إدخال عنوان الاختبار');
      return;
    }
    if (quizQuestions.length === 0) {
      toast.error('يرجى إضافة سؤال واحد على الأقل');
      return;
    }

    setSavingQuiz(true);

    // Safety timeout: ensure savingQuiz is reset even if something goes wrong
    const safetyTimeout = setTimeout(() => {
      setSavingQuiz(false);
      toast.error('انتهت مهلة الحفظ. يرجى المحاولة مرة أخرى.');
    }, 30000); // 30 second timeout (AI generation may take longer)
    
    try {
      const quizData: Record<string, unknown> = {
        title: quizTitle.trim(),
        questions: quizQuestions,
        show_results: quizShowResults,
        allow_retake: quizAllowRetake,
        // NOTE: shuffle_questions is NOT a DB column — stored client-side only
      };

      if (quizDuration.trim()) {
        quizData.duration = parseInt(quizDuration, 10);
      } else {
        quizData.duration = null;
      }
      if (quizDate.trim()) {
        quizData.scheduled_date = quizDate;
      } else {
        quizData.scheduled_date = null;
      }
      if (quizTime.trim()) {
        quizData.scheduled_time = quizTime;
      } else {
        quizData.scheduled_time = null;
      }

      if (editingQuiz) {
        // Update existing quiz — preserve is_finished state
        quizData.is_finished = editingQuiz.is_finished ?? false;

        const { error } = await supabase
          .from('quizzes')
          .update(quizData)
          .eq('id', editingQuiz.id);

        if (error) {
          console.error('Error updating quiz:', error);
          // Check if is_finished column is missing
          if (error.message?.includes('is_finished') || error.code === '42703') {
            // Try again without is_finished
            const { is_finished, ...dataWithoutFinished } = quizData as Record<string, unknown> & { is_finished?: unknown };
            const { error: retryError } = await supabase
              .from('quizzes')
              .update(dataWithoutFinished)
              .eq('id', editingQuiz.id);
            
            if (retryError) {
              toast.error(`حدث خطأ أثناء تحديث الاختبار: ${retryError.message}`);
            } else {
              toast.success('تم تحديث الاختبار بنجاح');
              setQuizModalOpen(false);
              resetQuizForm();
              fetchData();
            }
          } else {
            toast.error(`حدث خطأ أثناء تحديث الاختبار: ${error.message}`);
          }
        } else {
          toast.success('تم تحديث الاختبار بنجاح');
          setQuizModalOpen(false);
          resetQuizForm();
          fetchData();
        }
      } else {
        // Create new quiz
        quizData.user_id = profile.id;
        quizData.subject_id = subjectId;
        quizData.is_finished = false; // Explicitly set to ensure it appears in active tab

        // Optimistic: add to local state immediately for instant appearance
        const tempId = `temp-${Date.now()}`;
        const optimisticQuiz = {
          ...quizData,
          id: tempId,
          created_at: new Date().toISOString(),
        } as Quiz;
        setQuizzes(prev => [optimisticQuiz, ...prev]);
        setQuizModalOpen(false);
        resetQuizForm();
        toast.success('تم إنشاء الاختبار بنجاح');

        // Save to server in background
        try {
          const { error } = await supabase.from('quizzes').insert(quizData).select();
          if (error) {
            // Check if is_finished column is missing
            if (error.message?.includes('is_finished') || error.code === '42703') {
              const { is_finished, ...dataWithoutFinished } = quizData as Record<string, unknown> & { is_finished?: unknown };
              const { error: retryError } = await supabase.from('quizzes').insert(dataWithoutFinished).select();
              if (retryError) {
                toast.error(`حدث خطأ أثناء حفظ الاختبار: ${retryError.message}`);
                // Revert: remove the optimistic entry and refetch
                setQuizzes(prev => prev.filter(q => q.id !== tempId));
                fetchData();
              } else {
                // Replace temp with real data
                fetchData();
              }
            } else {
              toast.error(`حدث خطأ أثناء حفظ الاختبار: ${error.message}`);
              setQuizzes(prev => prev.filter(q => q.id !== tempId));
              fetchData();
            }
          } else {
            // Replace temp with real data from server
            fetchData();
          }
        } catch {
          // Revert on unexpected error
          setQuizzes(prev => prev.filter(q => q.id !== tempId));
          fetchData();
        }
      }
    } catch (err) {
      console.error('Save quiz catch error:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      clearTimeout(safetyTimeout);
      setSavingQuiz(false);
    }
  };

  // -------------------------------------------------------
  // Open edit modal
  // -------------------------------------------------------
  const handleEditQuiz = (quiz: Quiz) => {
    setEditingQuiz(quiz);
    setQuizTitle(quiz.title);
    setQuizDuration(quiz.duration?.toString() || '');
    setQuizDate(quiz.scheduled_date || '');
    setQuizTime(quiz.scheduled_time || '');
    setQuizQuestions([...(quiz.questions || [])]);
    setQuizShowResults(quiz.show_results ?? true);
    setQuizAllowRetake(quiz.allow_retake ?? true);
    setQuizShuffleQuestions(quiz.shuffle_questions ?? true);
    resetQuestionForm();
    setQuizModalOpen(true);
  };

  // -------------------------------------------------------
  // Open create modal
  // -------------------------------------------------------
  const handleOpenCreateModal = () => {
    resetQuizForm();
    setQuizModalOpen(true);
  };

  // -------------------------------------------------------
  // Load course files for AI quiz generation
  // -------------------------------------------------------
  const loadCourseFiles = useCallback(async () => {
    if (courseFiles.length > 0) return; // Already loaded
    setLoadingCourseFiles(true);
    try {
      const { data, error } = await supabase
        .from('subject_files')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });
      if (!error && data) {
        // Filter to document files only (PDF/Word)
        const docFiles = (data as SubjectFile[]).filter(f =>
          /\.(pdf|docx?)$/i.test(f.file_name)
        );
        setCourseFiles(docFiles);
      }
    } catch {
      // Non-critical
    } finally {
      setLoadingCourseFiles(false);
    }
  }, [subjectId, courseFiles.length]);

  // -------------------------------------------------------
  // Generate quiz from file using AI
  // -------------------------------------------------------
  const handleGenerateFromAiFile = async () => {
    if (!selectedCourseFile) {
      toast.error('يرجى اختيار ملف');
      return;
    }

    setGeneratingFromAi(true);
    try {
      // Step 1: Extract text from the file
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const extractRes = await fetch('/api/files/extract-pdf-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          url: selectedCourseFile.file_url,
          fileName: selectedCourseFile.file_name,
        }),
      });

      const extractData = await extractRes.json();
      if (!extractRes.ok || !extractData.success) {
        toast.error(extractData.error || 'فشل استخراج النص من الملف');
        setGeneratingFromAi(false);
        return;
      }

      const content = extractData.data.text;
      if (!content || content.trim().length < 50) {
        toast.error('المحتوى المستخرج قصير جداً لإنشاء اختبار');
        setGeneratingFromAi(false);
        return;
      }

      // Step 2: Generate quiz questions using AI
      const quizRes = await fetch('/api/gemini/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          content,
          questionTypes: aiQuizConfigTypes,
        }),
      });

      const quizData = await quizRes.json();
      if (!quizRes.ok || !quizData.success) {
        toast.error(quizData.error || 'فشل إنشاء الأسئلة');
        setGeneratingFromAi(false);
        return;
      }

      // Step 3: Populate the quiz form with generated questions
      const questions = quizData.data.questions as QuizQuestion[];
      if (!questions || questions.length === 0) {
        toast.error('لم يتم إنشاء أي أسئلة');
        setGeneratingFromAi(false);
        return;
      }

      setQuizQuestions(questions);
      // Auto-set title if empty
      if (!quizTitle.trim()) {
        const baseName = selectedCourseFile.file_name.replace(/\.[^.]+$/, '');
        setQuizTitle(`اختبار: ${baseName}`);
      }
      toast.success(`تم إنشاء ${questions.length} سؤال بنجاح`);
    } catch {
      toast.error('حدث خطأ أثناء إنشاء الاختبار من الملف');
    } finally {
      setGeneratingFromAi(false);
    }
  };

  // -------------------------------------------------------
  // Load question banks for this subject
  // -------------------------------------------------------
  const loadSubjectBanks = useCallback(async () => {
    if (subjectBanks.length > 0) return; // Already loaded
    setLoadingBanks(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch(`/api/question-bank?subjectId=${subjectId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSubjectBanks(data.data);
      }
    } catch {
      // Non-critical
    } finally {
      setLoadingBanks(false);
    }
  }, [subjectId, subjectBanks.length]);

  // -------------------------------------------------------
  // Load questions from a selected bank
  // -------------------------------------------------------
  const handleSelectBank = async (bank: QuestionBank) => {
    setSelectedBank(bank);
    setBankQuestions([]);
    setSelectedBankQuestionIds(new Set());
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch(`/api/question-bank?bankId=${bank.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && data.data.questions) {
        setBankQuestions(data.data.questions);
        // Pre-select all questions
        setSelectedBankQuestionIds(new Set(data.data.questions.map((q: BankQuestion) => q.id)));
      }
    } catch {
      toast.error('حدث خطأ أثناء تحميل أسئلة البنك');
    }
  };

  // -------------------------------------------------------
  // Import selected questions from bank to quiz
  // -------------------------------------------------------
  const handleImportFromBank = () => {
    if (!selectedBank || selectedBankQuestionIds.size === 0) {
      toast.error('يرجى اختيار سؤال واحد على الأقل');
      return;
    }

    const selectedQuestions = bankQuestions
      .filter(q => selectedBankQuestionIds.has(q.id))
      .map(q => {
        // Convert BankQuestion to QuizQuestion format
        const quizQ: QuizQuestion = {
          type: q.type,
          question: q.question,
        };
        if (q.type === 'mcq') {
          quizQ.options = (q.options as string[]) || [];
          quizQ.correctAnswer = q.correct_answer || '';
        } else if (q.type === 'boolean') {
          quizQ.correctAnswer = q.correct_answer || 'صح';
        } else if (q.type === 'completion') {
          quizQ.correctAnswer = q.correct_answer || '';
        } else if (q.type === 'matching') {
          quizQ.pairs = (q.pairs as { key: string; value: string }[]) || [];
        }
        return quizQ;
      });

    setQuizQuestions([...quizQuestions, ...selectedQuestions]);
    // Auto-set title if empty
    if (!quizTitle.trim()) {
      setQuizTitle(`اختبار: ${selectedBank.name}`);
    }
    toast.success(`تم استيراد ${selectedQuestions.length} سؤال من بنك الأسئلة`);
    // Reset bank state
    setSelectedBank(null);
    setBankQuestions([]);
    setSelectedBankQuestionIds(new Set());
    // Switch to manual mode to show imported questions
    setQuizInputMode('manual');
  };

  // -------------------------------------------------------
  // Toggle a bank question selection
  // -------------------------------------------------------
  const toggleBankQuestion = (qId: string) => {
    setSelectedBankQuestionIds(prev => {
      const next = new Set(prev);
      if (next.has(qId)) {
        next.delete(qId);
      } else {
        next.add(qId);
      }
      return next;
    });
  };

  // -------------------------------------------------------
  // Delete quiz
  // -------------------------------------------------------
  const handleDelete = async (quizId: string) => {
    // Optimistic: remove from local state immediately
    const previousQuizzes = quizzes;
    setQuizzes(prev => prev.filter(q => q.id !== quizId));
    setDeletingId(quizId);
    try {
      const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
      if (error) {
        toast.error('حدث خطأ أثناء حذف الاختبار');
        setQuizzes(previousQuizzes); // Revert on failure
      } else {
        toast.success('تم حذف الاختبار');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
      setQuizzes(previousQuizzes); // Revert on failure
    } finally {
      setDeletingId(null);
    }
  };

  // -------------------------------------------------------
  // Toggle quiz settings
  // -------------------------------------------------------
  const handleToggleQuizSetting = async (quizId: string, field: 'show_results' | 'allow_retake', currentValue: boolean) => {
    setTogglingQuizId(quizId);
    try {
      const { error } = await supabase
        .from('quizzes')
        .update({ [field]: !currentValue })
        .eq('id', quizId);
      if (error) {
        toast.error('حدث خطأ أثناء تحديث الإعداد');
      } else {
        toast.success(field === 'show_results'
          ? (!currentValue ? 'تم تفعيل إظهار النتائج' : 'تم إيقاف إظهار النتائج')
          : (!currentValue ? 'تم تفعيل إعادة الاختبار' : 'تم إيقاف إعادة الاختبار')
        );
        fetchData();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setTogglingQuizId(null);
    }
  };

  // -------------------------------------------------------
  // Toggle is_finished
  // -------------------------------------------------------
  const handleToggleFinished = async (quiz: Quiz) => {
    setTogglingQuizId(quiz.id);
    const currentlyFinished = isQuizFinished(quiz);
    try {
      const updateData: Record<string, unknown> = {
        is_finished: !currentlyFinished,
      };

      // When reactivating a quiz (moving from finished to active),
      // also clear the scheduled date/time so it doesn't auto-classify as finished again
      if (currentlyFinished) {
        updateData.scheduled_date = null;
        updateData.scheduled_time = null;
      }

      const { error } = await supabase
        .from('quizzes')
        .update(updateData)
        .eq('id', quiz.id);
      if (error) {
        console.error('Error toggling quiz finished state:', error);
        toast.error('حدث خطأ أثناء تحديث حالة الاختبار');
      } else {
        toast.success(currentlyFinished ? 'تم إعادة تفعيل الاختبار ونقله إلى النشطة' : 'تم إنهاء الاختبار');
        fetchData();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setTogglingQuizId(null);
    }
  };



  // -------------------------------------------------------
  // Export quiz results (Excel)
  // -------------------------------------------------------
  const handleExportQuizResults = async (quiz: Quiz) => {
    try {
      const XLSX = await import('xlsx');
      const qScores = scores.filter((s) => s.quiz_id === quiz.id);
      if (qScores.length === 0) {
        toast.error('لا توجد نتائج للتصدير');
        return;
      }
      const wb = XLSX.utils.book_new();
      const data = qScores.map((s) => ({
        'اسم الطالب': subjectStudents.find((st) => st.id === s.student_id)?.name || '—',
        'الدرجة': `${s.score}/${s.total}`,
        'النسبة': `${scorePercentage(s.score, s.total)}%`,
        'تاريخ الإنجاز': formatDate(s.completed_at),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, quiz.title);
      XLSX.writeFile(wb, `${quiz.title}_نتائج_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('تم تصدير نتائج الاختبار بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء التصدير');
    }
  };

  // -------------------------------------------------------
  // Get quiz status
  // -------------------------------------------------------
  const getQuizStatus = (quiz: Quiz): 'scheduled' | 'active' | 'completed' | 'expired' | 'finished' => {
    if (!quiz) return 'active';
    if (isQuizFinished(quiz)) return 'finished';
    if (isQuizExpired(quiz)) return 'expired';
    if (quiz.scheduled_date) {
      try {
        const scheduledDate = new Date(`${quiz.scheduled_date}T${quiz.scheduled_time || '00:00'}`);
        const now = new Date();
        if (!isNaN(scheduledDate.getTime()) && scheduledDate > now) return 'scheduled';
      } catch { /* invalid date — skip */ }
    }
    // Check if student completed
    const completed = scores.find((s) => s.quiz_id === quiz.id);
    if (completed) return 'completed';
    return 'active';
  };

  // -------------------------------------------------------
  // Status badge
  // -------------------------------------------------------
  const getStatusBadge = (status: 'scheduled' | 'active' | 'completed' | 'expired' | 'finished') => {
    switch (status) {
      case 'scheduled':
        return (
          <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-[10px]">
            <Clock className="h-2.5 w-2.5 me-1" />
            مجدول
          </Badge>
        );
      case 'active':
        return (
          <Badge className="bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800 text-[10px]">
            <Play className="h-2.5 w-2.5 me-1" />
            متاح
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="text-teal-700 dark:text-teal-300 border-teal-300 bg-teal-50 dark:bg-teal-950/30 text-[10px]">
            <Trophy className="h-2.5 w-2.5 me-1" />
            مكتمل
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50 dark:bg-orange-950/30 text-[10px]">
            <Clock className="h-2.5 w-2.5 me-1" />
            انتهى الوقت
          </Badge>
        );
      case 'finished':
        return (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">
            <ClipboardList className="h-2.5 w-2.5 me-1" />
            منتهي
          </Badge>
        );
      default:
        return null;
    }
  };

  // -------------------------------------------------------
  // Computed: split quizzes into active and finished
  // -------------------------------------------------------
  const activeQuizzes = quizzes.filter((q) => !isQuizFinished(q));
  const finishedQuizzes = quizzes.filter((q) => isQuizFinished(q));

  // -------------------------------------------------------
  // Render: Question builder (shared between create & edit)
  // -------------------------------------------------------
  const renderQuestionBuilder = () => (
    <div className="border-t pt-5">
      <h4 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
        <Plus className="h-4 w-4 text-sky-700 dark:text-sky-300" />
        إضافة سؤال
      </h4>

      {/* Question type selector */}
      <div className="mb-4">
        <label className="text-sm font-medium text-foreground mb-1.5 block">نوع السؤال</label>
        <div className="flex flex-wrap gap-2">
          {[
            { type: 'mcq' as const, label: 'اختيار متعدد' },
            { type: 'boolean' as const, label: 'صح/خطأ' },
            { type: 'completion' as const, label: 'إكمال' },
            { type: 'matching' as const, label: 'مطابقة' },
          ].map((opt) => (
            <button
              key={opt.type}
              onClick={() => setCurrentQuestionType(opt.type)}
              disabled={savingQuiz}
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
      <div className="mb-4">
        <label className="text-sm font-medium text-foreground mb-1.5 block">نص السؤال</label>
        <input
          type="text"
          value={currentQuestionText}
          onChange={(e) => setCurrentQuestionText(e.target.value)}
          placeholder={
            currentQuestionType === 'completion'
              ? 'أدخل النص مع ____ مكان الفراغ'
              : 'أدخل نص السؤال'
          }
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
          disabled={savingQuiz}
          dir="rtl"
        />
      </div>

      {/* MCQ options */}
      {currentQuestionType === 'mcq' && (
        <div className="space-y-2 mb-4">
          <label className="text-sm font-medium text-foreground mb-1.5 block">الخيارات</label>
          {mcqOptions.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMcqCorrect(idx)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  mcqCorrect === idx
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-muted-foreground/30 hover:border-sky-400'
                }`}
              >
                {mcqCorrect === idx && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
              <input
                type="text"
                value={opt}
                onChange={(e) => {
                  const newOpts = [...mcqOptions];
                  newOpts[idx] = e.target.value;
                  setMcqOptions(newOpts);
                }}
                placeholder={`الخيار ${idx + 1}`}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                disabled={savingQuiz}
                dir="rtl"
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">اضغط على الدائرة لتحديد الإجابة الصحيحة</p>
        </div>
      )}

      {/* Boolean */}
      {currentQuestionType === 'boolean' && (
        <div className="mb-4">
          <label className="text-sm font-medium text-foreground mb-1.5 block">الإجابة الصحيحة</label>
          <div className="flex gap-2">
            <button
              onClick={() => setBooleanCorrect(true)}
              disabled={savingQuiz}
              className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition-all ${
                booleanCorrect
                  ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              صح
            </button>
            <button
              onClick={() => setBooleanCorrect(false)}
              disabled={savingQuiz}
              className={`rounded-lg border px-5 py-2.5 text-sm font-medium transition-all ${
                !booleanCorrect
                  ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              خطأ
            </button>
          </div>
        </div>
      )}

      {/* Completion */}
      {currentQuestionType === 'completion' && (
        <div className="mb-4">
          <label className="text-sm font-medium text-foreground mb-1.5 block">الإجابة الصحيحة</label>
          <input
            type="text"
            value={completionAnswer}
            onChange={(e) => setCompletionAnswer(e.target.value)}
            placeholder="أدخل الإجابة الصحيحة للفراغ"
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            disabled={savingQuiz}
            dir="rtl"
          />
        </div>
      )}

      {/* Matching */}
      {currentQuestionType === 'matching' && (
        <div className="space-y-3 mb-4">
          <label className="text-sm font-medium text-foreground mb-1.5 block">أزواج المطابقة</label>
          {matchingPairs.map((pair, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={pair.key}
                onChange={(e) => {
                  const newPairs = [...matchingPairs];
                  newPairs[idx] = { ...newPairs[idx], key: e.target.value };
                  setMatchingPairs(newPairs);
                }}
                placeholder="العنصر"
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                disabled={savingQuiz}
                dir="rtl"
              />
              <span className="text-muted-foreground text-sm">←</span>
              <input
                type="text"
                value={pair.value}
                onChange={(e) => {
                  const newPairs = [...matchingPairs];
                  newPairs[idx] = { ...newPairs[idx], value: e.target.value };
                  setMatchingPairs(newPairs);
                }}
                placeholder="المطابق"
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                disabled={savingQuiz}
                dir="rtl"
              />
              {matchingPairs.length > 1 && (
                <button
                  onClick={() => {
                    setMatchingPairs(matchingPairs.filter((_, i) => i !== idx));
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 transition-colors"
                  disabled={savingQuiz}
                >
                  <Minus className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setMatchingPairs([...matchingPairs, { key: '', value: '' }])}
            disabled={savingQuiz}
            className="flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-300 hover:text-sky-800 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            إضافة زوج آخر
          </button>
        </div>
      )}

      {/* Add question button */}
      <button
        onClick={handleAddQuestion}
        disabled={savingQuiz}
        className="flex items-center gap-2 rounded-lg border-2 border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 px-4 py-3 text-sm font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-50 hover:border-sky-400 transition-colors w-full justify-center"
      >
        <Plus className="h-4 w-4" />
        إضافة سؤال
      </button>
    </div>
  );

  // -------------------------------------------------------
  // Render: Added questions list
  // -------------------------------------------------------
  const renderQuestionsList = () => {
    if (quizQuestions.length === 0) return null;
    return (
      <div className="border-t pt-5">
        <h4 className="text-sm font-bold text-foreground mb-3">
          الأسئلة المضافة ({quizQuestions.length})
        </h4>
        <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
          {quizQuestions.map((q, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 text-xs font-bold">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{q.question}</p>
                <p className="text-xs text-muted-foreground">
                  {q.type === 'mcq' ? 'اختيار متعدد' : q.type === 'boolean' ? 'صح/خطأ' : q.type === 'completion' ? 'إكمال' : 'مطابقة'}
                </p>
              </div>
              <button
                onClick={() => handleRemoveQuestion(idx)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 transition-colors"
                disabled={savingQuiz}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Create/Edit Quiz Modal
  // -------------------------------------------------------
  const renderQuizModal = () => (
    <AnimatePresence>
      {quizModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!savingQuiz) { setQuizModalOpen(false); resetQuizForm(); } }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-4 sm:p-5 sticky top-0 bg-background z-10">
              <h3 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2 min-w-0 truncate">
                <ClipboardList className="h-5 w-5 text-sky-700 dark:text-sky-300 shrink-0" />
                <span className="truncate">{editingQuiz ? 'تعديل الاختبار' : 'إنشاء اختبار جديد'}</span>
              </h3>
              <button
                onClick={() => { if (!savingQuiz) { setQuizModalOpen(false); resetQuizForm(); } }}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 touch-manipulation"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-5">
              {/* Title */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">عنوان الاختبار</label>
                <input
                  type="text"
                  value={quizTitle}
                  onChange={(e) => setQuizTitle(e.target.value)}
                  placeholder="مثال: اختبار الفصل الثاني - الرياضيات"
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                  disabled={savingQuiz || generatingFromAi}
                  dir="rtl"
                />
              </div>

              {/* Duration & date/time */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">المدة (دقيقة)</label>
                  <input
                    type="number"
                    value={quizDuration}
                    onChange={(e) => setQuizDuration(e.target.value)}
                    placeholder="30"
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    disabled={savingQuiz || generatingFromAi}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">التاريخ (اختياري)</label>
                  <input
                    type="date"
                    value={quizDate}
                    onChange={(e) => setQuizDate(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    disabled={savingQuiz || generatingFromAi}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوقت (اختياري)</label>
                  <input
                    type="time"
                    value={quizTime}
                    onChange={(e) => setQuizTime(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    disabled={savingQuiz || generatingFromAi}
                  />
                </div>
              </div>

              {/* ─── Quiz Settings Toggles ─── */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                  <span className="text-sm font-semibold text-foreground">إعدادات الاختبار</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* Show Results */}
                  <button
                    type="button"
                    onClick={() => setQuizShowResults(!quizShowResults)}
                    disabled={savingQuiz || generatingFromAi}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-all text-right ${
                      quizShowResults
                        ? 'border-teal-400 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <EyeIcon className="h-4 w-4 shrink-0" />
                    <span className="truncate">عرض النتائج</span>
                  </button>
                  {/* Allow Retake */}
                  <button
                    type="button"
                    onClick={() => setQuizAllowRetake(!quizAllowRetake)}
                    disabled={savingQuiz || generatingFromAi}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-all text-right ${
                      quizAllowRetake
                        ? 'border-teal-400 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <RotateCcw className="h-4 w-4 shrink-0" />
                    <span className="truncate">إعادة الاختبار</span>
                  </button>
                  {/* Shuffle Questions */}
                  <button
                    type="button"
                    onClick={() => setQuizShuffleQuestions(!quizShuffleQuestions)}
                    disabled={savingQuiz || generatingFromAi}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-all text-right ${
                      quizShuffleQuestions
                        ? 'border-teal-400 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <Shuffle className="h-4 w-4 shrink-0" />
                    <span className="truncate">ترتيب عشوائي</span>
                  </button>
                </div>
              </div>

              {/* ─── Quiz Input Mode Toggle (only for new quizzes, not editing) ─── */}
              {!editingQuiz && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">طريقة الإنشاء</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setQuizInputMode('manual')}
                      disabled={savingQuiz || generatingFromAi}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        quizInputMode === 'manual'
                          ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Pencil className="h-4 w-4" />
                      إدخال يدوي
                    </button>
                    <button
                      onClick={() => {
                        setQuizInputMode('ai-file');
                        loadCourseFiles();
                      }}
                      disabled={savingQuiz || generatingFromAi}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        quizInputMode === 'ai-file'
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Sparkles className="h-4 w-4" />
                      من ملف المقرر
                    </button>
                    <button
                      onClick={() => {
                        setQuizInputMode('bank');
                        loadSubjectBanks();
                      }}
                      disabled={savingQuiz || generatingFromAi}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        quizInputMode === 'bank'
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Database className="h-4 w-4" />
                      من بنك الأسئلة
                    </button>
                  </div>
                </div>
              )}

              {/* ─── AI File Quiz Generation Section ─── */}
              {quizInputMode === 'ai-file' && !editingQuiz && (
                <div className="space-y-4 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/20 p-4">
                  {/* Section header */}
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50">
                      <Sparkles className="h-4 w-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-teal-700 dark:text-teal-300">إنشاء اختبار من ملف</p>
                      <p className="text-xs text-teal-600/70">اختر ملفاً من ملفات المقرر لإنشاء اختبار تلقائي بالذكاء الاصطناعي</p>
                    </div>
                  </div>

                  {/* Question types config */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">أنواع الأسئلة وعددها</label>
                    {([
                      { key: 'mcq' as const, label: 'اختيار من متعدد', icon: <ListChecks className="h-4 w-4" /> },
                      { key: 'boolean' as const, label: 'صح أو خطأ', icon: <CheckCircle2 className="h-4 w-4" /> },
                      { key: 'completion' as const, label: 'أكمل الجملة', icon: <Type className="h-4 w-4" /> },
                      { key: 'matching' as const, label: 'توصيل', icon: <Link2 className="h-4 w-4" /> },
                    ]).map((qt) => (
                      <div key={qt.key} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2.5">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          {qt.icon}
                          {qt.label}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setAiQuizConfigTypes(prev => ({ ...prev, [qt.key]: Math.max(0, prev[qt.key] - 1) }))}
                            disabled={generatingFromAi}
                            className="flex h-6 w-6 items-center justify-center rounded border text-muted-foreground hover:bg-muted transition-colors text-xs"
                          >
                            -
                          </button>
                          <span className="w-6 text-center text-sm font-bold text-foreground">{aiQuizConfigTypes[qt.key]}</span>
                          <button
                            onClick={() => setAiQuizConfigTypes(prev => ({ ...prev, [qt.key]: prev[qt.key] + 1 }))}
                            disabled={generatingFromAi}
                            className="flex h-6 w-6 items-center justify-center rounded border text-muted-foreground hover:bg-muted transition-colors text-xs"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Course files selection */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">اختر ملفاً من ملفات المقرر</label>
                    {loadingCourseFiles ? (
                      <div className="flex items-center justify-center py-6 gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
                        <span className="text-sm text-muted-foreground">جاري تحميل الملفات...</span>
                      </div>
                    ) : courseFiles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-6 gap-2 rounded-lg border-2 border-dashed border-teal-300 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/30">
                        <FolderOpen className="h-8 w-8 text-teal-400" />
                        <span className="text-sm text-muted-foreground">لا توجد ملفات مستندية في المقرر</span>
                        <span className="text-xs text-muted-foreground/60">ارفع ملفات PDF أو Word من تبويب الملفات</span>
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-2">
                        {courseFiles.map((file) => {
                          const isPdf = /\.pdf$/i.test(file.file_name);
                          return (
                            <button
                              key={file.id}
                              onClick={() => setSelectedCourseFile(file)}
                              disabled={generatingFromAi}
                              className={`flex items-center gap-3 w-full rounded-lg border p-3 text-right transition-all ${
                                selectedCourseFile?.id === file.id
                                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                                  : 'border-border hover:bg-muted/50'
                              }`}
                            >
                              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                isPdf ? 'bg-rose-100 dark:bg-rose-900/50' : 'bg-blue-100 dark:bg-blue-900/50'
                              }`}>
                                {isPdf ? (
                                  <FileText className="h-4 w-4 text-rose-600" />
                                ) : (
                                  <FileText className="h-4 w-4 text-blue-600" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                  <span>{isPdf ? 'PDF' : 'Word'}</span>
                                  <span className="text-muted-foreground/40">•</span>
                                  <span>{(file.file_size / 1024).toFixed(0)} KB</span>
                                </div>
                              </div>
                              {selectedCourseFile?.id === file.id && (
                                <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Generate button */}
                  <button
                    onClick={handleGenerateFromAiFile}
                    disabled={generatingFromAi || !selectedCourseFile}
                    className="flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed w-full justify-center"
                  >
                    {generatingFromAi ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري إنشاء الأسئلة...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        إنشاء أسئلة من الملف
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* ─── Import from Bank Section ─── */}
              {quizInputMode === 'bank' && !editingQuiz && (
                <div className="space-y-4 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/20 p-4">
                  {/* Section header */}
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/50">
                      <Database className="h-4 w-4 text-violet-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-violet-700 dark:text-violet-300">استيراد من بنك الأسئلة</p>
                      <p className="text-xs text-violet-600/70">اختر بنك أسئلة من مقررك واستورد الأسئلة للاختبار</p>
                    </div>
                  </div>

                  {/* Bank selection */}
                  {loadingBanks ? (
                    <div className="flex items-center justify-center py-6 gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
                      <span className="text-sm text-muted-foreground">جاري تحميل بنوك الأسئلة...</span>
                    </div>
                  ) : subjectBanks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 gap-2 rounded-lg border-2 border-dashed border-violet-300 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/30">
                      <Database className="h-8 w-8 text-violet-400" />
                      <span className="text-sm text-muted-foreground">لا توجد بنوك أسئلة في هذا المقرر</span>
                      <span className="text-xs text-muted-foreground/60">أنشئ بنك أسئلة من قسم بنك الأسئلة في القائمة</span>
                    </div>
                  ) : !selectedBank ? (
                    <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-2">
                      {subjectBanks.map((bank) => (
                        <button
                          key={bank.id}
                          onClick={() => handleSelectBank(bank)}
                          disabled={importingFromBank}
                          className={`flex items-center gap-3 w-full rounded-lg border p-3 text-right transition-all ${
                            'border-border hover:bg-violet-50 dark:hover:bg-violet-950/20'
                          }`}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/50">
                            <BookOpen className="h-4 w-4 text-violet-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{bank.name}</p>
                            <p className="text-xs text-muted-foreground">{bank.question_count || 0} سؤال</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    /* Selected bank — show questions for selection */
                    <div className="space-y-3">
                      {/* Bank header with back button */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setSelectedBank(null); setBankQuestions([]); setSelectedBankQuestionIds(new Set()); }}
                          disabled={importingFromBank}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-sm font-medium text-foreground">{selectedBank.name}</span>
                        <span className="text-xs text-muted-foreground">({bankQuestions.length} سؤال)</span>
                        <button
                          onClick={() => {
                            if (selectedBankQuestionIds.size === bankQuestions.length) {
                              setSelectedBankQuestionIds(new Set());
                            } else {
                              setSelectedBankQuestionIds(new Set(bankQuestions.map(q => q.id)));
                            }
                          }}
                          className="ms-auto text-xs text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          {selectedBankQuestionIds.size === bankQuestions.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                        </button>
                      </div>

                      {/* Questions list with checkboxes */}
                      {bankQuestions.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-foreground">لا توجد أسئلة في هذا البنك</div>
                      ) : (
                        <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1.5">
                          {bankQuestions.map((q) => {
                            const isSelected = selectedBankQuestionIds.has(q.id);
                            return (
                              <button
                                key={q.id}
                                onClick={() => toggleBankQuestion(q.id)}
                                disabled={importingFromBank}
                                className={`w-full flex items-start gap-2.5 rounded-lg border p-2.5 text-right transition-all ${
                                  isSelected
                                    ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30'
                                    : 'border-border hover:bg-muted/50'
                                }`}
                              >
                                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors mt-0.5 ${
                                  isSelected
                                    ? 'border-violet-600 bg-violet-600 text-white'
                                    : 'border-muted-foreground/30'
                                }`}>
                                  {isSelected && <Check className="h-3 w-3" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-foreground line-clamp-2">{q.question}</p>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                      {q.type === 'mcq' ? 'اختيار متعدد' : q.type === 'boolean' ? 'صح/خطأ' : q.type === 'completion' ? 'إكمال' : 'مطابقة'}
                                    </span>
                                    {q.difficulty && (
                                      <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                        {q.difficulty === 'easy' ? 'سهل' : q.difficulty === 'medium' ? 'متوسط' : 'صعب'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Import button */}
                      <button
                        onClick={handleImportFromBank}
                        disabled={importingFromBank || selectedBankQuestionIds.size === 0}
                        className="flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed w-full justify-center"
                      >
                        {importingFromBank ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            جاري الاستيراد...
                          </>
                        ) : (
                          <>
                            <Database className="h-4 w-4" />
                            استيراد {selectedBankQuestionIds.size} سؤال
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Manual Question Builder (always show when editing, or in manual mode, or after AI generation to add more) ─── */}
              {(quizInputMode === 'manual' || editingQuiz || quizQuestions.length > 0) && renderQuestionBuilder()}
              {renderQuestionsList()}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t p-5 sticky bottom-0 bg-background">
              <button
                onClick={handleSaveQuiz}
                disabled={savingQuiz || generatingFromAi || !quizTitle.trim() || quizQuestions.length === 0}
                className="flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingQuiz ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الحفظ...
                  </>
                ) : generatingFromAi ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري إنشاء الأسئلة...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {editingQuiz ? 'حفظ التعديلات' : 'إنشاء الاختبار'}
                  </>
                )}
              </button>
              <button
                onClick={() => { if (!savingQuiz && !generatingFromAi) { setQuizModalOpen(false); resetQuizForm(); } }}
                disabled={savingQuiz || generatingFromAi}
                className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                إلغاء
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );



  // -------------------------------------------------------
  // Render: Teacher quiz card
  // -------------------------------------------------------
  const renderTeacherQuizCard = (quiz: Quiz, isFinishedTab: boolean) => {
    const qScores = scores.filter((s) => s.quiz_id === quiz.id);
    const avgScore = qScores.length > 0
      ? Math.round(qScores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / qScores.length)
      : 0;

    return (
      <motion.div key={quiz.id} variants={itemVariants}>
        <div className="group relative rounded-xl border bg-card p-4 sm:p-5 shadow-sm hover:shadow-md transition-all">
          {/* Teacher action buttons — prominent on mobile, hover-reveal on desktop */}
          <div className="flex items-center gap-2 mb-3 sm:absolute sm:top-3 sm:left-3 sm:mb-0 sm:gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            {/* Settings */}
            <button
              onClick={() => setSettingsQuiz(quiz)}
              className="flex items-center gap-1.5 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-950/50 transition-colors sm:border-0 sm:bg-transparent sm:dark:bg-transparent sm:px-0 sm:py-0 sm:h-7 sm:w-7 sm:justify-center sm:rounded-md sm:text-muted-foreground sm:hover:bg-teal-50 sm:dark:hover:bg-teal-50 sm:hover:text-teal-600 sm:text-sm sm:font-normal"
              title="إعدادات"
            >
              <Settings className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              <span className="sm:hidden">إعدادات</span>
            </button>
            {/* Edit */}
            <button
              onClick={() => handleEditQuiz(quiz)}
              className="flex items-center gap-1.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/50 transition-colors sm:border-0 sm:bg-transparent sm:dark:bg-transparent sm:px-0 sm:py-0 sm:h-7 sm:w-7 sm:justify-center sm:rounded-md sm:text-muted-foreground sm:hover:bg-sky-50 sm:dark:hover:bg-sky-50 sm:hover:text-sky-700 sm:text-sm sm:font-normal"
              title="تعديل"
            >
              <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              <span className="sm:hidden">تعديل</span>
            </button>
            {/* Delete */}
            <button
              onClick={() => setDeleteQuizConfirmId(quiz.id)}
              disabled={deletingId === quiz.id}
              className="flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-50 sm:border-0 sm:bg-transparent sm:dark:bg-transparent sm:px-0 sm:py-0 sm:h-7 sm:w-7 sm:justify-center sm:rounded-md sm:text-muted-foreground sm:hover:bg-rose-50 sm:dark:hover:bg-rose-50 sm:hover:text-rose-600 sm:text-sm sm:font-normal"
              title="حذف"
            >
              {deletingId === quiz.id ? (
                <Loader2 className="h-4 w-4 animate-spin sm:h-3.5 sm:w-3.5" />
              ) : (
                <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              )}
              <span className="sm:hidden">حذف</span>
            </button>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
              <ClipboardList className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-foreground truncate">{quiz.title}</h4>
              <div className="flex items-center gap-2 mt-0.5">
                {getStatusBadge(getQuizStatus(quiz))}
                {quiz.questions && (
                  <span className="text-xs text-muted-foreground">{quiz.questions.length} سؤال</span>
                )}
              </div>
            </div>
          </div>

          {/* Quiz info */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
            {quiz.duration && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {quiz.duration} دقيقة
              </span>
            )}
            {quiz.scheduled_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(quiz.scheduled_date)}
                {quiz.scheduled_time && <span> {quiz.scheduled_time}</span>}
              </span>
            )}
          </div>

          {/* Finished tab: show results summary */}
          {isFinishedTab && qScores.length > 0 && (
            <div className="flex items-center gap-3 mb-3 p-2.5 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{qScores.length} مشارك</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-medium text-foreground">متوسط: {avgScore}%</span>
              </div>
            </div>
          )}

          {/* Quiz settings toggles */}
          <div className="flex items-center gap-3 text-xs mb-3">
            <button
              onClick={() => handleToggleQuizSetting(quiz.id, 'show_results', quiz.show_results !== false)}
              disabled={togglingQuizId === quiz.id}
              className="flex items-center gap-1.5 transition-colors"
            >
              {togglingQuizId === quiz.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : quiz.show_results === false ? (
                <EyeOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              ) : (
                <Eye className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
              )}
              <span className={quiz.show_results === false ? 'text-amber-600 dark:text-amber-400' : 'text-sky-700 dark:text-sky-300'}>
                {quiz.show_results === false ? 'النتائج مخفية' : 'إظهار النتائج'}
              </span>
            </button>
            <button
              onClick={() => handleToggleQuizSetting(quiz.id, 'allow_retake', quiz.allow_retake || false)}
              disabled={togglingQuizId === quiz.id}
              className="flex items-center gap-1.5 transition-colors"
            >
              {quiz.allow_retake ? (
                <RotateCcw className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className={quiz.allow_retake ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground'}>
                {quiz.allow_retake ? 'إعادة مسموحة' : 'بدون إعادة'}
              </span>
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-3 border-t">
            {/* Toggle finished */}
            <button
              onClick={() => handleToggleFinished(quiz)}
              disabled={togglingQuizId === quiz.id}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                isFinishedTab
                  ? 'text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 hover:bg-sky-100'
                  : 'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100'
              }`}
            >
              {isFinishedTab ? 'إعادة تفعيل' : 'إنهاء الاختبار'}
            </button>

            {/* Export results (finished tab only) */}
            {isFinishedTab && qScores.length > 0 && (
              <button
                onClick={() => handleExportQuizResults(quiz)}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 hover:bg-teal-100 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                تصدير النتائج
              </button>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Student quiz card
  // -------------------------------------------------------
  const renderStudentQuizCard = (quiz: Quiz, isFinishedTab: boolean) => {
    const myScore = scores.find((s) => s.quiz_id === quiz.id);
    const scorePct = myScore ? scorePercentage(myScore.score, myScore.total) : null;

    return (
      <motion.div key={quiz.id} variants={itemVariants}>
        <div className="group relative rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
              <ClipboardList className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-foreground truncate">{quiz.title}</h4>
              <div className="flex items-center gap-2 mt-0.5">
                {getStatusBadge(getQuizStatus(quiz))}
                {quiz.questions && (
                  <span className="text-xs text-muted-foreground">{quiz.questions.length} سؤال</span>
                )}
              </div>
            </div>
          </div>

          {/* Score */}
          {myScore && (
            <div className="flex items-center gap-2 mt-2 p-2.5 rounded-lg bg-muted/50">
              <Trophy className={`h-4 w-4 ${
                scorePct !== null && scorePct >= 80 ? 'text-sky-700 dark:text-sky-300' :
                scorePct !== null && scorePct >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
              }`} />
              <span className="text-sm font-medium text-foreground">
                {myScore.score} / {myScore.total}
              </span>
              {scorePct !== null && (
                <span className={`text-xs font-bold ${
                  scorePct >= 80 ? 'text-sky-800 dark:text-sky-200' :
                  scorePct >= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'
                }`}>
                  {scorePct}%
                </span>
              )}
            </div>
          )}

          {/* Date & Time */}
          {quiz.scheduled_date && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
              <Calendar className="h-3 w-3" />
              <span>{formatDate(quiz.scheduled_date)}</span>
              {quiz.scheduled_time && <span className="font-medium">- {quiz.scheduled_time}</span>}
            </div>
          )}

          {/* Duration */}
          {quiz.duration && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3" />
              {quiz.duration} دقيقة
            </div>
          )}

          {/* Countdown timer for scheduled quizzes */}
          {quiz.scheduled_date && getQuizStatus(quiz) === 'scheduled' && (
            <QuizCountdown scheduledDate={quiz.scheduled_date} scheduledTime={quiz.scheduled_time} />
          )}

          {/* Active: Take quiz button (student) */}
          {!isFinishedTab && !myScore && getQuizStatus(quiz) !== 'scheduled' && (
            <button
              onClick={() => setViewingQuizId(quiz.id)}
              className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-sky-800 mt-3 w-full justify-center"
            >
              <Play className="h-3.5 w-3.5" />
              بدء الاختبار
            </button>
          )}

          {/* View quiz (student completed / finished) */}
          {myScore && (
            <button
              onClick={() => setViewingQuizId(quiz.id, true)}
              className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors mt-3 w-full justify-center"
            >
              <Eye className="h-3.5 w-3.5" />
              مراجعة الاختبار
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header with sub-tab switcher */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground">الاختبارات</h3>
          <p className="text-muted-foreground text-sm mt-1">{quizzes.length} اختبار</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Sub-tab switcher */}
          <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
            <button
              onClick={() => setSubTab('active')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                subTab === 'active'
                  ? 'bg-sky-700 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Play className="h-3 w-3" />
              نشطة
            </button>
            <button
              onClick={() => setSubTab('finished')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                subTab === 'finished'
                  ? 'bg-sky-700 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ClipboardList className="h-3 w-3" />
              منتهية
            </button>
          </div>

          {/* Create quiz button (teacher only) */}
          {role === 'teacher' && (
            <button
              onClick={handleOpenCreateModal}
              className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
            >
              <Plus className="h-4 w-4" />
              إنشاء اختبار
            </button>
          )}
        </div>
      </motion.div>

      {/* Quiz list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : subTab === 'active' ? (
        // ─── Active tab ───
        activeQuizzes.length === 0 ? (
          <motion.div
            variants={itemVariants}
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
              <ClipboardList className="h-8 w-8 text-sky-700 dark:text-sky-300" />
            </div>
            <p className="text-lg font-semibold text-foreground mb-1">لا توجد اختبارات نشطة</p>
            <p className="text-sm text-muted-foreground">
              {role === 'teacher' ? 'ابدأ بإنشاء اختبار جديد لطلابك' : 'لم يتم إضافة اختبارات نشطة بعد'}
            </p>
            {role === 'teacher' && (
              <button
                onClick={handleOpenCreateModal}
                className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-800 mt-4"
              >
                <Plus className="h-4 w-4" />
                إنشاء اختبار
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {activeQuizzes.map((quiz) =>
              role === 'teacher'
                ? renderTeacherQuizCard(quiz, false)
                : renderStudentQuizCard(quiz, false)
            )}
          </motion.div>
        )
      ) : (
        // ─── Finished tab ───
        finishedQuizzes.length === 0 ? (
          <motion.div
            variants={itemVariants}
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted-100 mb-4">
              <ClipboardList className="h-8 w-8 text-muted-400" />
            </div>
            <p className="text-lg font-semibold text-foreground mb-1">لا توجد اختبارات منتهية</p>
            <p className="text-sm text-muted-foreground">
              {role === 'teacher' ? 'الاختبارات المنتهية ستظهر هنا مع نتائجها' : 'الاختبارات المكتملة ستظهر هنا'}
            </p>
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {finishedQuizzes.map((quiz) =>
              role === 'teacher'
                ? renderTeacherQuizCard(quiz, true)
                : renderStudentQuizCard(quiz, true)
            )}
          </motion.div>
        )
      )}

      {/* Create/Edit quiz modal */}
      {renderQuizModal()}

      {/* Quiz Settings Modal */}
      {settingsQuiz && (
        <QuizSettingsModal
          quiz={settingsQuiz}
          open={!!settingsQuiz}
          onClose={() => setSettingsQuiz(null)}
          onUpdate={(updates) => {
            // Update local quiz data with the new settings
            setQuizzes(prev => prev.map(q => q.id === settingsQuiz.id ? { ...q, ...updates } : q));
            setSettingsQuiz(null);
          }}
        />
      )}

      {/* Delete Quiz Confirmation Dialog */}
      <AlertDialog open={!!deleteQuizConfirmId} onOpenChange={(open) => { if (!open) setDeleteQuizConfirmId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الاختبار</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا الاختبار؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteQuizConfirmId) handleDelete(deleteQuizConfirmId);
                setDeleteQuizConfirmId(null);
              }}
              disabled={!!deletingId}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </motion.div>
  );
}
