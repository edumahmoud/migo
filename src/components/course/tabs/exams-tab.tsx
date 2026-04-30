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
  Share2,
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import type { UserProfile, Subject, Quiz, QuizQuestion, Score } from '@/lib/types';

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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
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

/**
 * Determines if a quiz belongs in the "finished" tab.
 * Only uses the explicit `is_finished` flag from the database.
 * Date-based auto-finish is NOT used for tab classification
 * because it causes newly created quizzes with past dates to
 * immediately appear as finished.
 */
function isQuizFinished(quiz: Quiz): boolean {
  return !!quiz.is_finished;
}

/**
 * Determines if a quiz's scheduled date/time has passed.
 * Used ONLY for display badges, not for tab classification.
 */
function isQuizExpired(quiz: Quiz): boolean {
  if (!quiz.scheduled_date) return false;
  const scheduledDate = new Date(`${quiz.scheduled_date}T${quiz.scheduled_time || '23:59'}`);
  return scheduledDate < new Date();
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function ExamsTab({ profile, role, subjectId }: ExamsTabProps) {
  const router = useRouter();

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
  const [savingQuiz, setSavingQuiz] = useState(false);

  // ─── Share modal ───
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareQuiz, setShareQuiz] = useState<Quiz | null>(null);

  // ─── Delete quiz ───
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ─── Quiz toggles ───
  const [togglingQuizId, setTogglingQuizId] = useState<string | null>(null);

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

      // Process quizzes
      const { data, error } = quizzesResult;
      if (error) {
        console.error('Error fetching quizzes:', error);
      } else {
        setQuizzes((data as Quiz[]) || []);
      }

      // Process scores
      setScores((scoresResult.data as Score[]) || []);

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
    }, 15000); // 15 second timeout
    
    try {
      const quizData: Record<string, unknown> = {
        title: quizTitle.trim(),
        questions: quizQuestions,
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

        const { error } = await supabase.from('quizzes').insert(quizData);

        if (error) {
          console.error('Error creating quiz:', error);
          // Check if is_finished column is missing
          if (error.message?.includes('is_finished') || error.code === '42703') {
            // Try again without is_finished
            const { is_finished, ...dataWithoutFinished } = quizData as Record<string, unknown> & { is_finished?: unknown };
            const { error: retryError } = await supabase.from('quizzes').insert(dataWithoutFinished);
            
            if (retryError) {
              toast.error(`حدث خطأ أثناء إنشاء الاختبار: ${retryError.message}`);
            } else {
              toast.success('تم إنشاء الاختبار بنجاح');
              setQuizModalOpen(false);
              resetQuizForm();
              fetchData();
            }
          } else {
            toast.error(`حدث خطأ أثناء إنشاء الاختبار: ${error.message}`);
          }
        } else {
          toast.success('تم إنشاء الاختبار بنجاح');
          setQuizModalOpen(false);
          resetQuizForm();
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
  // Delete quiz
  // -------------------------------------------------------
  const handleDelete = async (quizId: string) => {
    setDeletingId(quizId);
    try {
      const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
      if (error) toast.error('حدث خطأ أثناء حذف الاختبار');
      else { toast.success('تم حذف الاختبار'); fetchData(); }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      const { error } = await supabase
        .from('quizzes')
        .update({ is_finished: !currentlyFinished })
        .eq('id', quiz.id);
      if (error) {
        console.error('Error toggling quiz finished state:', error);
        toast.error('حدث خطأ أثناء تحديث حالة الاختبار');
      } else {
        toast.success(currentlyFinished ? 'تم إعادة تفعيل الاختبار' : 'تم إنهاء الاختبار');
        fetchData();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setTogglingQuizId(null);
    }
  };

  // -------------------------------------------------------
  // Share quiz
  // -------------------------------------------------------
  const handleShareQuiz = (quiz: Quiz) => {
    setShareQuiz(quiz);
    setShareModalOpen(true);
  };

  const handleCopyShareLink = () => {
    if (shareQuiz) {
      const link = `${window.location.origin}/quiz/${shareQuiz.id}`;
      navigator.clipboard.writeText(link);
      toast.success('تم نسخ رابط المشاركة');
    }
  };

  const handleNativeShare = async () => {
    if (shareQuiz && navigator.share) {
      try {
        await navigator.share({
          title: shareQuiz.title,
          text: `اختبار: ${shareQuiz.title}`,
          url: `${window.location.origin}/quiz/${shareQuiz.id}`,
        });
      } catch {
        // User cancelled or share failed
      }
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
    if (isQuizFinished(quiz)) return 'finished';
    if (isQuizExpired(quiz)) return 'expired';
    if (quiz.scheduled_date) {
      const scheduledDate = new Date(`${quiz.scheduled_date}T${quiz.scheduled_time || '00:00'}`);
      const now = new Date();
      if (scheduledDate > now) return 'scheduled';
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
          <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
            <Clock className="h-2.5 w-2.5 ml-1" />
            مجدول
          </Badge>
        );
      case 'active':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
            <Play className="h-2.5 w-2.5 ml-1" />
            متاح
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="text-teal-700 border-teal-300 bg-teal-50 text-[10px]">
            <Trophy className="h-2.5 w-2.5 ml-1" />
            مكتمل
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50 text-[10px]">
            <Clock className="h-2.5 w-2.5 ml-1" />
            انتهى الوقت
          </Badge>
        );
      case 'finished':
        return (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">
            <ClipboardList className="h-2.5 w-2.5 ml-1" />
            منتهي
          </Badge>
        );
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
        <Plus className="h-4 w-4 text-emerald-600" />
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
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
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
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-muted-foreground/30 hover:border-emerald-400'
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
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
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
                  ? 'border-rose-500 bg-rose-50 text-rose-700'
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
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
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
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
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
        className="flex items-center gap-2 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50/30 px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400 transition-colors w-full justify-center"
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
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
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
            <div className="flex items-center justify-between border-b p-5 sticky top-0 bg-background z-10">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-emerald-600" />
                {editingQuiz ? 'تعديل الاختبار' : 'إنشاء اختبار جديد'}
              </h3>
              <button
                onClick={() => { if (!savingQuiz) { setQuizModalOpen(false); resetQuizForm(); } }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
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
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                  disabled={savingQuiz}
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
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    disabled={savingQuiz}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">التاريخ (اختياري)</label>
                  <input
                    type="date"
                    value={quizDate}
                    onChange={(e) => setQuizDate(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    disabled={savingQuiz}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوقت (اختياري)</label>
                  <input
                    type="time"
                    value={quizTime}
                    onChange={(e) => setQuizTime(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    disabled={savingQuiz}
                  />
                </div>
              </div>

              {renderQuestionBuilder()}
              {renderQuestionsList()}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t p-5 sticky bottom-0 bg-background">
              <button
                onClick={handleSaveQuiz}
                disabled={savingQuiz || !quizTitle.trim() || quizQuestions.length === 0}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingQuiz ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الحفظ...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {editingQuiz ? 'حفظ التعديلات' : 'إنشاء الاختبار'}
                  </>
                )}
              </button>
              <button
                onClick={() => { if (!savingQuiz) { setQuizModalOpen(false); resetQuizForm(); } }}
                disabled={savingQuiz}
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
  // Render: Share modal
  // -------------------------------------------------------
  const renderShareModal = () => (
    <AnimatePresence>
      {shareModalOpen && shareQuiz && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShareModalOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto"
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b p-5">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Share2 className="h-5 w-5 text-emerald-600" />
                مشاركة الاختبار
              </h3>
              <button
                onClick={() => setShareModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-muted-foreground">
                شارك هذا الرابط مع طلابك للانضمام إلى الاختبار
              </p>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/quiz/${shareQuiz.id}`}
                  className="flex-1 bg-transparent text-sm text-foreground outline-none font-mono"
                  dir="ltr"
                />
                <button
                  onClick={handleCopyShareLink}
                  className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  نسخ
                </button>
              </div>
              {typeof navigator.share === 'function' && (
                <button
                  onClick={handleNativeShare}
                  className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors w-full justify-center"
                >
                  <Share2 className="h-4 w-4" />
                  مشاركة عبر التطبيقات
                </button>
              )}
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
        <div className="group relative rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-all">
          {/* Top-right action buttons (teacher) */}
          <div className="absolute top-3 left-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Edit */}
            <button
              onClick={() => handleEditQuiz(quiz)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
              title="تعديل"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {/* Delete */}
            <button
              onClick={() => handleDelete(quiz.id)}
              disabled={deletingId === quiz.id}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors"
              title="حذف"
            >
              {deletingId === quiz.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <ClipboardList className="h-5 w-5 text-emerald-600" />
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
                <Trophy className="h-3.5 w-3.5 text-amber-600" />
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
                <EyeOff className="h-3.5 w-3.5 text-amber-600" />
              ) : (
                <Eye className="h-3.5 w-3.5 text-emerald-600" />
              )}
              <span className={quiz.show_results === false ? 'text-amber-600' : 'text-emerald-600'}>
                {quiz.show_results === false ? 'النتائج مخفية' : 'إظهار النتائج'}
              </span>
            </button>
            <button
              onClick={() => handleToggleQuizSetting(quiz.id, 'allow_retake', quiz.allow_retake || false)}
              disabled={togglingQuizId === quiz.id}
              className="flex items-center gap-1.5 transition-colors"
            >
              {quiz.allow_retake ? (
                <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className={quiz.allow_retake ? 'text-emerald-600' : 'text-muted-foreground'}>
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
                  ? 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                  : 'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100'
              }`}
            >
              {isFinishedTab ? 'إعادة تفعيل' : 'إنهاء الاختبار'}
            </button>

            {/* Share */}
            <button
              onClick={() => handleShareQuiz(quiz)}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors"
            >
              <Share2 className="h-3.5 w-3.5" />
              مشاركة
            </button>

            {/* Export results (finished tab only) */}
            {isFinishedTab && qScores.length > 0 && (
              <button
                onClick={() => handleExportQuizResults(quiz)}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-teal-700 border-teal-200 bg-teal-50 hover:bg-teal-100 transition-colors"
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <ClipboardList className="h-5 w-5 text-emerald-600" />
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
                scorePct !== null && scorePct >= 80 ? 'text-emerald-600' :
                scorePct !== null && scorePct >= 60 ? 'text-amber-600' : 'text-rose-600'
              }`} />
              <span className="text-sm font-medium text-foreground">
                {myScore.score} / {myScore.total}
              </span>
              {scorePct !== null && (
                <span className={`text-xs font-bold ${
                  scorePct >= 80 ? 'text-emerald-700' :
                  scorePct >= 60 ? 'text-amber-700' : 'text-rose-700'
                }`}>
                  {scorePct}%
                </span>
              )}
            </div>
          )}

          {/* Date */}
          {quiz.scheduled_date && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
              <Calendar className="h-3 w-3" />
              {formatDate(quiz.scheduled_date)}
              {quiz.scheduled_time && <span>{quiz.scheduled_time}</span>}
            </div>
          )}

          {/* Duration */}
          {quiz.duration && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3" />
              {quiz.duration} دقيقة
            </div>
          )}

          {/* Active: Take quiz button (student) */}
          {!isFinishedTab && !myScore && (
            <button
              onClick={() => router.push(`/quiz/${quiz.id}`)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 mt-3 w-full justify-center"
            >
              <Play className="h-3.5 w-3.5" />
              بدء الاختبار
            </button>
          )}

          {/* View quiz (student completed / finished) */}
          {myScore && (
            <button
              onClick={() => router.push(`/quiz/${quiz.id}`)}
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
                  ? 'bg-emerald-600 text-white shadow-sm'
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
                  ? 'bg-emerald-600 text-white shadow-sm'
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
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
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
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : subTab === 'active' ? (
        // ─── Active tab ───
        activeQuizzes.length === 0 ? (
          <motion.div
            variants={itemVariants}
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
              <ClipboardList className="h-8 w-8 text-emerald-600" />
            </div>
            <p className="text-lg font-semibold text-foreground mb-1">لا توجد اختبارات نشطة</p>
            <p className="text-sm text-muted-foreground">
              {role === 'teacher' ? 'ابدأ بإنشاء اختبار جديد لطلابك' : 'لم يتم إضافة اختبارات نشطة بعد'}
            </p>
            {role === 'teacher' && (
              <button
                onClick={handleOpenCreateModal}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 mt-4"
              >
                <Plus className="h-4 w-4" />
                إنشاء اختبار
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
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
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      {/* Share modal */}
      {renderShareModal()}
    </motion.div>
  );
}
