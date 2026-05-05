'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  RotateCcw,
  Eye,
  Home,
  Loader2,
  Link2,
  Trophy,
  ListChecks,
  PenLine,
  ArrowLeftRight,
  Lightbulb,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { UserProfile, Quiz, QuizQuestion, UserAnswer } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface QuizViewProps {
  quizId: string;
  onBack: () => void;
  profile: UserProfile;
}

// -------------------------------------------------------
// Question type labels
// -------------------------------------------------------
const typeLabels: Record<QuizQuestion['type'], string> = {
  mcq: 'اختيار من متعدد',
  boolean: 'صح أو خطأ',
  completion: 'أكمل الجملة',
  matching: 'توصيل',
};

const typeIcons: Record<QuizQuestion['type'], React.ReactNode> = {
  mcq: <ListChecks className="h-3.5 w-3.5" />,
  boolean: <CheckCircle2 className="h-3.5 w-3.5" />,
  completion: <PenLine className="h-3.5 w-3.5" />,
  matching: <ArrowLeftRight className="h-3.5 w-3.5" />,
};

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const pageVariants = {
  hidden: { opacity: 0, x: 30 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
  exit: { opacity: 0, x: -30, transition: { duration: 0.25, ease: 'easeIn' } },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function QuizView({ quizId, onBack, profile }: QuizViewProps) {
  // ─── App store ───
  const { setCurrentPage } = useAppStore();

  // ─── Quiz state ───
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Quiz taking state ───
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [completionInput, setCompletionInput] = useState('');
  const [evaluatingCompletion, setEvaluatingCompletion] = useState(false);

  // ─── Matching state ───
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<Record<string, string>>({});
  const [matchingFeedback, setMatchingFeedback] = useState<'correct' | 'incorrect' | null>(null);

  // ─── Results state ───
  const [showResults, setShowResults] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [savingScore, setSavingScore] = useState(false);
  const [alreadyTaken, setAlreadyTaken] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);

  // ─── Explain wrong answer state ───
  const [explainingIdx, setExplainingIdx] = useState<number | null>(null);
  const [explanations, setExplanations] = useState<Record<number, string>>({});

  // -------------------------------------------------------
  // Fetch quiz
  // -------------------------------------------------------
  const fetchQuiz = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('quizzes')
        .select('*')
        .eq('id', quizId)
        .single();

      if (fetchError || !data) {
        setError('لم يتم العثور على الاختبار');
        return;
      }

      const quizData = data as Quiz;
      if (!quizData.questions || quizData.questions.length === 0) {
        setError('لا توجد أسئلة في هذا الاختبار');
        return;
      }

      setQuiz(quizData);

      // Check if student already completed this quiz
      const { data: existingScore } = await supabase
        .from('scores')
        .select('id')
        .eq('student_id', profile.id)
        .eq('quiz_id', quizId)
        .maybeSingle();

      if (existingScore) {
        // Student already took this quiz
        if (quizData.allow_retake) {
          setQuizCompleted(true);
          // Allow retake - student can still take it
        } else {
          setAlreadyTaken(true);
          return;
        }
      }
    } catch {
      setError('حدث خطأ أثناء تحميل الاختبار');
    } finally {
      setLoading(false);
    }
  }, [quizId, profile.id]);

  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]);

  // -------------------------------------------------------
  // Current question
  // -------------------------------------------------------
  const currentQuestion: QuizQuestion | null = quiz?.questions?.[currentIdx] ?? null;
  const totalQuestions = quiz?.questions?.length ?? 0;
  const progressPct = totalQuestions > 0 ? ((currentIdx + 1) / totalQuestions) * 100 : 0;

  // -------------------------------------------------------
  // Reset question state
  // -------------------------------------------------------
  const resetQuestionState = useCallback(() => {
    setAnswered(false);
    setIsCorrect(false);
    setSelectedOption(null);
    setCompletionInput('');
    setEvaluatingCompletion(false);
    setSelectedKey(null);
    setSelectedValue(null);
    setMatchedPairs({});
    setMatchingFeedback(null);
  }, []);

  // -------------------------------------------------------
  // Handle MCQ answer
  // -------------------------------------------------------
  const handleMCQAnswer = (option: string) => {
    if (answered) return;
    setSelectedOption(option);
    const correct = option === currentQuestion?.correctAnswer;
    setIsCorrect(correct);
    setAnswered(true);
  };

  // -------------------------------------------------------
  // Handle Boolean answer
  // -------------------------------------------------------
  const handleBooleanAnswer = (answer: string) => {
    if (answered) return;
    setSelectedOption(answer);
    const correct = answer === currentQuestion?.correctAnswer;
    setIsCorrect(correct);
    setAnswered(true);
  };

  // -------------------------------------------------------
  // Handle Completion answer
  // -------------------------------------------------------
  const handleCompletionCheck = async () => {
    if (answered || !completionInput.trim()) {
      if (!completionInput.trim()) {
        toast.error('يرجى إدخال إجابة');
      }
      return;
    }

    setEvaluatingCompletion(true);

    try {
      // First check exact match
      const studentAnswer = completionInput.trim();
      const correctAnswer = currentQuestion?.correctAnswer?.trim() || '';

      if (studentAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
        setIsCorrect(true);
        setAnswered(true);
        setEvaluatingCompletion(false);
        return;
      }

      // Call API for semantic evaluation
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/gemini/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: currentQuestion?.question,
          correctAnswer: currentQuestion?.correctAnswer,
          studentAnswer,
        }),
      });

      const data = await res.json();
      if (data.success && data.data) {
        setIsCorrect(data.data.isCorrect);
      } else {
        setIsCorrect(false);
      }
      setAnswered(true);
    } catch {
      toast.error('حدث خطأ أثناء تقييم الإجابة');
      setIsCorrect(false);
      setAnswered(true);
    } finally {
      setEvaluatingCompletion(false);
    }
  };

  // -------------------------------------------------------
  // Handle Matching
  // -------------------------------------------------------
  const handleMatchingSelect = (side: 'key' | 'value', item: string) => {
    if (answered) return;

    if (side === 'key') {
      // If already matched, remove
      if (matchedPairs[item]) {
        const newPairs = { ...matchedPairs };
        delete newPairs[item];
        setMatchedPairs(newPairs);
        return;
      }
      setSelectedKey(item);
    } else {
      setSelectedValue(item);
    }
  };

  // When both key and value selected, create pair
  useEffect(() => {
    if (selectedKey && selectedValue) {
      setMatchedPairs((prev) => ({ ...prev, [selectedKey]: selectedValue }));
      setSelectedKey(null);
      setSelectedValue(null);
    }
  }, [selectedKey, selectedValue]);

  const handleMatchingCheck = () => {
    if (answered) return;

    if (!currentQuestion?.pairs) return;

    // Check if all pairs are matched
    const totalPairs = currentQuestion.pairs.length;
    if (Object.keys(matchedPairs).length < totalPairs) {
      toast.error('يرجى توصيل جميع العناصر أولاً');
      return;
    }

    // All-or-nothing: check all pairs
    const allCorrect = currentQuestion.pairs.every(
      (pair) => matchedPairs[pair.key] === pair.value
    );

    setIsCorrect(allCorrect);
    setMatchingFeedback(allCorrect ? 'correct' : 'incorrect');
    setAnswered(true);
  };

  const removeMatchedPair = (key: string) => {
    if (answered) return;
    const newPairs = { ...matchedPairs };
    delete newPairs[key];
    setMatchedPairs(newPairs);
  };

  // -------------------------------------------------------
  // Next question / Finish
  // -------------------------------------------------------
  const handleNext = () => {
    if (!currentQuestion) return;

    // Save answer
    let answerValue: string | Record<string, string> = '';
    if (currentQuestion.type === 'matching') {
      answerValue = matchedPairs;
    } else if (currentQuestion.type === 'completion') {
      answerValue = completionInput.trim();
    } else {
      answerValue = selectedOption || '';
    }

    const newAnswer: UserAnswer = {
      questionIndex: currentIdx,
      type: currentQuestion.type,
      answer: answerValue,
      isCorrect,
    };

    setUserAnswers((prev) => [...prev, newAnswer]);

    // Next question or finish
    if (currentIdx < totalQuestions - 1) {
      resetQuestionState();
      setCurrentIdx((prev) => prev + 1);
    } else {
      // Calculate final score and show results
      const finalAnswers = [...userAnswers, newAnswer];
      const finalScore = finalAnswers.filter((a) => a.isCorrect).length;
      saveScore(finalScore, finalAnswers);
      setShowResults(true);
    }
  };

  // -------------------------------------------------------
  // Save score to supabase
  // -------------------------------------------------------
  const saveScore = async (finalScore: number, finalAnswers: UserAnswer[]) => {
    if (!quiz) return;

    setSavingScore(true);
    try {
      // Save score
      const { error: scoreError } = await supabase.from('scores').insert({
        student_id: profile.id,
        teacher_id: quiz.user_id,
        quiz_id: quizId,
        quiz_title: quiz.title,
        score: finalScore,
        total: totalQuestions,
        user_answers: finalAnswers,
      });

      if (scoreError) {
        console.error('Error saving score:', scoreError);
      }

      // Handle teacher linking if student is not linked to the quiz creator
      if (quiz.user_id !== profile.id) {
        const { data: existingLink } = await supabase
          .from('teacher_student_links')
          .select('id, status')
          .eq('teacher_id', quiz.user_id)
          .eq('student_id', profile.id)
          .maybeSingle();

        if (!existingLink) {
          // Auto-link with approved status since student completed teacher's quiz
          await supabase.from('teacher_student_links').insert({
            teacher_id: quiz.user_id,
            student_id: profile.id,
            status: 'approved',
          });
        } else if (existingLink.status === 'pending') {
          // Auto-approve if they have a pending request (they just completed the quiz)
          await supabase
            .from('teacher_student_links')
            .update({ status: 'approved' })
            .eq('teacher_id', quiz.user_id)
            .eq('student_id', profile.id);
        }
      }
    } catch (err) {
      console.error('Error saving score:', err);
    } finally {
      setSavingScore(false);
    }
  };

  // -------------------------------------------------------
  // Retry quiz
  // -------------------------------------------------------
  const handleRetry = () => {
    resetQuestionState();
    setCurrentIdx(0);
    setUserAnswers([]);
    setShowResults(false);
    setShowReview(false);
  };

  // -------------------------------------------------------
  // Loading state
  // -------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" dir="rtl">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
        <p className="text-muted-foreground text-sm">جاري تحميل الاختبار...</p>
      </div>
    );
  }

  // -------------------------------------------------------
  // Error state
  // -------------------------------------------------------
  if (error || !quiz) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4" dir="rtl">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <XCircle className="h-8 w-8 text-rose-600" />
        </div>
        <p className="text-lg font-semibold text-foreground">{error || 'حدث خطأ غير متوقع'}</p>
        <Button
          onClick={onBack}
          variant="outline"
          className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        >
          <ChevronLeft className="h-4 w-4" />
          العودة
        </Button>
      </div>
    );
  }

  // -------------------------------------------------------
  // Already taken state
  // -------------------------------------------------------
  if (alreadyTaken) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4" dir="rtl">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <CheckCircle2 className="h-8 w-8 text-amber-600" />
        </div>
        <p className="text-lg font-semibold text-foreground">لقد أكملت هذا الاختبار بالفعل</p>
        <p className="text-sm text-muted-foreground">لا يمكنك إعادة هذا الاختبار</p>
        <Button
          onClick={onBack}
          variant="outline"
          className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        >
          <ChevronLeft className="h-4 w-4" />
          العودة للرئيسية
        </Button>
      </div>
    );
  }

  // -------------------------------------------------------
  // Results screen
  // -------------------------------------------------------
  if (showResults) {
    // If show_results is false, show submission confirmation instead of score
    if (quiz.show_results === false) {
      return (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="mx-auto max-w-2xl space-y-4 sm:space-y-6 p-3 sm:p-8"
          dir="rtl"
        >
          <motion.div variants={fadeInUp} className="flex flex-col items-center gap-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
              className="flex h-32 w-32 items-center justify-center rounded-full bg-emerald-100 ring-8 ring-emerald-200 shadow-lg"
            >
              <div className="text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 mb-1" />
              </div>
            </motion.div>

            <motion.div variants={fadeInUp} className="text-center">
              <h2 className="text-2xl font-bold text-foreground">تم إرسال إجاباتك</h2>
              <p className="text-muted-foreground mt-2 max-w-md">
                ستظهر النتائج بعد أن يقرر المعلم إظهارها
              </p>
            </motion.div>
          </motion.div>

          <motion.div variants={fadeInUp} className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              onClick={onBack}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Home className="h-4 w-4" />
              العودة للرئيسية
            </Button>
          </motion.div>
        </motion.div>
      );
    }

    const finalScore = userAnswers.filter((a) => a.isCorrect).length;
    const percentage = totalQuestions > 0 ? Math.round((finalScore / totalQuestions) * 100) : 0;
    const scoreColor =
      percentage >= 80
        ? 'text-emerald-700'
        : percentage >= 60
          ? 'text-amber-600'
          : 'text-rose-600';
    const scoreBg =
      percentage >= 80
        ? 'bg-emerald-100'
        : percentage >= 60
          ? 'bg-amber-100'
          : 'bg-rose-100';
    const scoreRing =
      percentage >= 80
        ? 'ring-emerald-200'
        : percentage >= 60
          ? 'ring-amber-200'
          : 'ring-rose-200';

    return (
      <motion.div
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
        className="mx-auto max-w-2xl space-y-4 sm:space-y-6 p-3 sm:p-8"
        dir="rtl"
      >
        {/* Score display */}
        <motion.div variants={fadeInUp} className="flex flex-col items-center gap-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
            className={`flex h-24 w-24 sm:h-32 sm:w-32 items-center justify-center rounded-full ${scoreBg} ring-8 ${scoreRing} shadow-lg`}
          >
            <div className="text-center">
              <Trophy className={`mx-auto h-8 w-8 ${scoreColor} mb-1`} />
              <span className={`text-2xl sm:text-3xl font-bold ${scoreColor}`}>{percentage}%</span>
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="text-center">
            <h2 className="text-2xl font-bold text-foreground">نتيجة الاختبار</h2>
            <p className="text-muted-foreground mt-1">{quiz.title}</p>
          </motion.div>

          <motion.div
            variants={fadeInUp}
            className={`rounded-2xl border-2 px-8 py-4 ${scoreBg} ${scoreRing.replace('ring', 'border')}`}
          >
            <span className={`text-4xl font-bold ${scoreColor}`}>
              {finalScore}
            </span>
            <span className="text-xl text-muted-foreground"> / {totalQuestions}</span>
          </motion.div>
        </motion.div>

        {/* Action buttons */}
        <motion.div variants={fadeInUp} className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={() => setShowReview(true)}
            variant="outline"
            className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          >
            <Eye className="h-4 w-4" />
            مراجعة الإجابات
          </Button>
          <Button
            onClick={handleRetry}
            variant="outline"
            className="gap-2 border-teal-300 text-teal-700 hover:bg-teal-50"
            style={{ display: quiz.allow_retake ? undefined : 'none' }}
          >
            <RotateCcw className="h-4 w-4" />
            إعادة الاختبار
          </Button>
          <Button
            onClick={onBack}
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Home className="h-4 w-4" />
            العودة للرئيسية
          </Button>
        </motion.div>

        {/* Review section */}
        <AnimatePresence>
          {showReview && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4 overflow-hidden"
            >
              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Eye className="h-5 w-5 text-emerald-600" />
                  مراجعة الإجابات
                </h3>
                {quiz.questions.map((q, idx) => {
                  const ans = userAnswers.find((a) => a.questionIndex === idx);
                  return (
                    <ReviewQuestionCard
                      key={idx}
                      question={q}
                      index={idx}
                      userAnswer={ans || null}
                    />
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  // -------------------------------------------------------
  // Quiz taking screen
  // -------------------------------------------------------
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
      className="mx-auto max-w-2xl space-y-4 sm:space-y-6 p-3 sm:p-6"
      dir="rtl"
    >
      {/* Header */}
      <motion.div variants={fadeInUp} className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-foreground truncate">{quiz.title}</h2>
            <p className="text-xs text-muted-foreground">
              السؤال {currentIdx + 1} من {totalQuestions}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <Progress value={progressPct} className="h-2.5 bg-emerald-100 [&>div]:bg-emerald-600" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{currentIdx + 1}</span>
            <span>{totalQuestions}</span>
          </div>
        </div>
      </motion.div>

      {/* Question card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIdx}
          variants={pageVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {currentQuestion && (
            <Card className="border-emerald-200 bg-white shadow-sm">
              <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-5">
                {/* Type badge + question */}
                <div className="space-y-3">
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-emerald-300 bg-emerald-50 text-emerald-700 text-xs"
                  >
                    {typeIcons[currentQuestion.type]}
                    {typeLabels[currentQuestion.type]}
                  </Badge>
                  <h3 className="text-base font-semibold text-foreground leading-relaxed">
                    {currentQuestion.question}
                  </h3>
                </div>

                {/* Question type content */}
                {currentQuestion.type === 'mcq' && (
                  <MCQQuestion
                    question={currentQuestion}
                    answered={answered}
                    isCorrect={isCorrect}
                    selectedOption={selectedOption}
                    onAnswer={handleMCQAnswer}
                  />
                )}

                {currentQuestion.type === 'boolean' && (
                  <BooleanQuestion
                    question={currentQuestion}
                    answered={answered}
                    isCorrect={isCorrect}
                    selectedOption={selectedOption}
                    onAnswer={handleBooleanAnswer}
                  />
                )}

                {currentQuestion.type === 'completion' && (
                  <CompletionQuestion
                    question={currentQuestion}
                    answered={answered}
                    isCorrect={isCorrect}
                    inputValue={completionInput}
                    onInputChange={setCompletionInput}
                    onCheck={handleCompletionCheck}
                    evaluating={evaluatingCompletion}
                  />
                )}

                {currentQuestion.type === 'matching' && (
                  <MatchingQuestion
                    question={currentQuestion}
                    answered={answered}
                    isCorrect={isCorrect}
                    matchedPairs={matchedPairs}
                    selectedKey={selectedKey}
                    selectedValue={selectedValue}
                    onSelect={handleMatchingSelect}
                    onRemovePair={removeMatchedPair}
                    onCheck={handleMatchingCheck}
                    feedback={matchingFeedback}
                  />
                )}

                {/* Feedback indicator */}
                {answered && (
                  <>
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex items-center gap-2 rounded-lg p-3 ${
                        isCorrect
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {isCorrect ? (
                        <>
                          <CheckCircle2 className="h-5 w-5 shrink-0" />
                          <span className="text-sm font-medium">إجابة صحيحة!</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-5 w-5 shrink-0" />
                          <span className="text-sm font-medium">إجابة خاطئة</span>
                          {currentQuestion.type !== 'matching' && currentQuestion.correctAnswer && (
                            <span className="block text-sm text-rose-600 mt-1">
                              الإجابة الصحيحة: {currentQuestion.correctAnswer}
                            </span>
                          )}
                        </>
                      )}
                    </motion.div>

                    {/* Explain wrong answer button */}
                    {answered && !isCorrect && (
                      <>
                        <button
                          onClick={async () => {
                            if (explainingIdx === currentIdx) return;
                            setExplainingIdx(currentIdx);
                            try {
                              const { data: { session } } = await supabase.auth.getSession();
                              const token = session?.access_token || '';
                              const answerStr = currentQuestion.type === 'matching' ? JSON.stringify(matchedPairs) : (currentQuestion.type === 'completion' ? completionInput : selectedOption || '');
                              const res = await fetch('/api/gemini/explain', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                                body: JSON.stringify({ question: currentQuestion.question, correctAnswer: currentQuestion.correctAnswer || '', studentAnswer: answerStr, questionType: currentQuestion.type }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                setExplanations(prev => ({ ...prev, [currentIdx]: data.data.explanation }));
                              }
                            } catch { toast.error('حدث خطأ'); }
                            finally { setExplainingIdx(null); }
                          }}
                          className="mt-2 flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:underline"
                        >
                          {explainingIdx === currentIdx ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                          لماذا خطأ؟
                        </button>
                        {explanations[currentIdx] && (
                          <div className="mt-2 rounded-lg bg-rose-50/50 border border-rose-100 p-3 text-sm text-rose-800 leading-relaxed">
                            {explanations[currentIdx]}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                {/* Next / Finish button */}
                {answered && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-start"
                  >
                    <Button
                      onClick={handleNext}
                      className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      {currentIdx < totalQuestions - 1 ? (
                        <>
                          السؤال التالي
                          <ArrowRight className="h-4 w-4" />
                        </>
                      ) : (
                        <>
                          إنهاء الاختبار
                          <Trophy className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </motion.div>
                )}
              </CardContent>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// =====================================================
// Sub-components for question types
// =====================================================

// -------------------------------------------------------
// MCQ Question
// -------------------------------------------------------
interface MCQQuestionProps {
  question: QuizQuestion;
  answered: boolean;
  isCorrect: boolean;
  selectedOption: string | null;
  onAnswer: (option: string) => void;
}

function MCQQuestion({ question, answered, isCorrect, selectedOption, onAnswer }: MCQQuestionProps) {
  if (!question.options) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {question.options.map((option, idx) => {
        const isSelected = selectedOption === option;
        const isCorrectOption = option === question.correctAnswer;

        let btnClass =
          'rounded-xl border-2 p-3 sm:p-4 text-sm font-medium transition-all text-right flex items-center gap-3';

        if (answered) {
          if (isCorrectOption) {
            btnClass += ' border-emerald-500 bg-emerald-50 text-emerald-700';
          } else if (isSelected && !isCorrect) {
            btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
          } else {
            btnClass += ' border-border bg-muted/30 text-muted-foreground';
          }
        } else {
          btnClass +=
            ' border-emerald-200 bg-white text-foreground hover:border-emerald-400 hover:bg-emerald-50/50 cursor-pointer';
        }

        return (
          <motion.button
            key={idx}
            whileHover={!answered ? { scale: 1.02 } : undefined}
            whileTap={!answered ? { scale: 0.98 } : undefined}
            onClick={() => onAnswer(option)}
            disabled={answered}
            className={btnClass}
          >
            {/* Option letter */}
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                answered && isCorrectOption
                  ? 'bg-emerald-600 text-white'
                  : answered && isSelected && !isCorrect
                    ? 'bg-rose-600 text-white'
                    : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {String.fromCharCode(1571 + idx)}
            </span>

            <span className="flex-1">{option}</span>

            {/* Feedback icon */}
            {answered && isCorrectOption && (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            )}
            {answered && isSelected && !isCorrect && (
              <XCircle className="h-5 w-5 shrink-0 text-rose-600" />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------
// Boolean Question
// -------------------------------------------------------
interface BooleanQuestionProps {
  question: QuizQuestion;
  answered: boolean;
  isCorrect: boolean;
  selectedOption: string | null;
  onAnswer: (answer: string) => void;
}

function BooleanQuestion({
  question,
  answered,
  isCorrect,
  selectedOption,
  onAnswer,
}: BooleanQuestionProps) {
  const options = [
    { label: 'صح', value: 'صح', icon: <CheckCircle2 className="h-5 w-5" /> },
    { label: 'خطأ', value: 'خطأ', icon: <XCircle className="h-5 w-5" /> },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      {options.map((opt) => {
        const isSelected = selectedOption === opt.value;
        const isCorrectOption = opt.value === question.correctAnswer;

        let btnClass =
          'flex flex-col items-center gap-2 rounded-xl border-2 p-4 sm:p-6 text-sm sm:text-base font-bold transition-all';

        if (answered) {
          if (isCorrectOption) {
            btnClass += ' border-emerald-500 bg-emerald-50 text-emerald-700';
          } else if (isSelected && !isCorrect) {
            btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
          } else {
            btnClass += ' border-border bg-muted/30 text-muted-foreground';
          }
        } else {
          btnClass +=
            ' border-emerald-200 bg-white text-foreground hover:border-emerald-400 hover:bg-emerald-50/50 cursor-pointer';
        }

        return (
          <motion.button
            key={opt.value}
            whileHover={!answered ? { scale: 1.03 } : undefined}
            whileTap={!answered ? { scale: 0.97 } : undefined}
            onClick={() => onAnswer(opt.value)}
            disabled={answered}
            className={btnClass}
          >
            {opt.icon}
            {opt.label}
            {answered && isCorrectOption && (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            {answered && isSelected && !isCorrect && (
              <XCircle className="h-4 w-4 text-rose-600" />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------
// Completion Question
// -------------------------------------------------------
interface CompletionQuestionProps {
  question: QuizQuestion;
  answered: boolean;
  isCorrect: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onCheck: () => void;
  evaluating: boolean;
}

function CompletionQuestion({
  question,
  answered,
  isCorrect,
  inputValue,
  onInputChange,
  onCheck,
  evaluating,
}: CompletionQuestionProps) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Input
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="اكتب إجابتك هنا..."
          disabled={answered || evaluating}
          className="h-12 text-base border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500/20"
          dir="rtl"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !answered && !evaluating) {
              onCheck();
            }
          }}
        />
      </div>
      {!answered && (
        <Button
          onClick={onCheck}
          disabled={evaluating || !inputValue.trim()}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {evaluating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحقق...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              تحقق من الإجابة
            </>
          )}
        </Button>
      )}
    </div>
  );
}

// -------------------------------------------------------
// Matching Question
// -------------------------------------------------------
interface MatchingQuestionProps {
  question: QuizQuestion;
  answered: boolean;
  isCorrect: boolean;
  matchedPairs: Record<string, string>;
  selectedKey: string | null;
  selectedValue: string | null;
  onSelect: (side: 'key' | 'value', item: string) => void;
  onRemovePair: (key: string) => void;
  onCheck: () => void;
  feedback: 'correct' | 'incorrect' | null;
}

function MatchingQuestion({
  question,
  answered,
  isCorrect,
  matchedPairs,
  selectedKey,
  selectedValue,
  onSelect,
  onRemovePair,
  onCheck,
  feedback,
}: MatchingQuestionProps) {
  if (!question.pairs) return null;

  const keys = question.pairs.map((p) => p.key);
  const values = question.pairs.map((p) => p.value);

  // Track which values are already matched
  const matchedValuesSet = new Set(Object.values(matchedPairs));
  const matchedKeysSet = new Set(Object.keys(matchedPairs));

  return (
    <div className="space-y-4">
      {/* Two columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Keys column */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-emerald-700 text-center mb-2">القائمة أ</p>
          {keys.map((key) => {
            const isMatched = matchedKeysSet.has(key);
            const isSelected = selectedKey === key;

            let btnClass =
              'w-full rounded-lg border-2 p-3 text-sm font-medium transition-all text-center';

            if (answered) {
              const correctValue = question.pairs?.find((p) => p.key === key)?.value;
              const userValue = matchedPairs[key];
              if (userValue === correctValue) {
                btnClass += ' border-emerald-500 bg-emerald-50 text-emerald-700';
              } else {
                btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
              }
            } else if (isMatched) {
              btnClass += ' border-teal-400 bg-teal-50 text-teal-700';
            } else if (isSelected) {
              btnClass += ' border-emerald-500 bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300';
            } else {
              btnClass +=
                ' border-emerald-200 bg-white text-foreground hover:border-emerald-400 cursor-pointer';
            }

            return (
              <motion.button
                key={key}
                whileHover={!answered && !isMatched ? { scale: 1.02 } : undefined}
                whileTap={!answered && !isMatched ? { scale: 0.98 } : undefined}
                onClick={() => onSelect('key', key)}
                disabled={answered}
                className={btnClass}
              >
                {key}
              </motion.button>
            );
          })}
        </div>

        {/* Values column */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-teal-700 text-center mb-2">القائمة ب</p>
          {values.map((value) => {
            const isMatched = matchedValuesSet.has(value);
            const isSelected = selectedValue === value;

            let btnClass =
              'w-full rounded-lg border-2 p-3 text-sm font-medium transition-all text-center';

            if (answered) {
              // Find which key matches this value correctly
              const correctKey = question.pairs?.find((p) => p.value === value)?.key;
              const userKey = Object.entries(matchedPairs).find(
                ([, v]) => v === value
              )?.[0];
              if (userKey === correctKey) {
                btnClass += ' border-emerald-500 bg-emerald-50 text-emerald-700';
              } else {
                btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
              }
            } else if (isMatched) {
              btnClass += ' border-teal-400 bg-teal-50 text-teal-700';
            } else if (isSelected) {
              btnClass += ' border-teal-500 bg-teal-100 text-teal-700 ring-2 ring-teal-300';
            } else {
              btnClass +=
                ' border-teal-200 bg-white text-foreground hover:border-teal-400 cursor-pointer';
            }

            return (
              <motion.button
                key={value}
                whileHover={!answered && !isMatched ? { scale: 1.02 } : undefined}
                whileTap={!answered && !isMatched ? { scale: 0.98 } : undefined}
                onClick={() => onSelect('value', value)}
                disabled={answered}
                className={btnClass}
              >
                {value}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Matched pairs display */}
      {Object.keys(matchedPairs).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">التوصيلات:</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(matchedPairs).map(([key, value]) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700"
              >
                <span>{key}</span>
                <Link2 className="h-3 w-3" />
                <span>{value}</span>
                {!answered && (
                  <button
                    onClick={() => onRemovePair(key)}
                    className="mr-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-200 hover:bg-rose-200 text-emerald-700 hover:text-rose-700 transition-colors"
                  >
                    <XCircle className="h-3 w-3" />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Check button */}
      {!answered && (
        <Button
          onClick={onCheck}
          disabled={Object.keys(matchedPairs).length < (question.pairs?.length || 0)}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <ArrowLeftRight className="h-4 w-4" />
          تحقق من التوصيل
        </Button>
      )}

      {/* Show correct pairs on wrong answer */}
      {answered && !isCorrect && question.pairs && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"
        >
          <p className="text-xs font-semibold text-emerald-700 mb-2">التوصيل الصحيح:</p>
          <div className="flex flex-wrap gap-2">
            {question.pairs.map((pair) => (
              <span
                key={pair.key}
                className="flex items-center gap-1 rounded-full bg-white border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700"
              >
                {pair.key}
                <Link2 className="h-3 w-3" />
                {pair.value}
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// -------------------------------------------------------
// Review Question Card
// -------------------------------------------------------
interface ReviewQuestionCardProps {
  question: QuizQuestion;
  index: number;
  userAnswer: UserAnswer | null;
}

function ReviewQuestionCard({ question, index, userAnswer }: ReviewQuestionCardProps) {
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-xl border bg-card p-4 mb-3 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            userAnswer?.isCorrect
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-rose-100 text-rose-700'
          }`}
        >
          {userAnswer?.isCorrect ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">سؤال {index + 1}</span>
            <Badge variant="outline" className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700">
              {typeLabels[question.type]}
            </Badge>
          </div>
          <p className="text-sm font-medium text-foreground">{question.question}</p>

          {/* Show answer details based on type */}
          {question.type === 'matching' && question.pairs ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                إجابتك:
                {Object.entries((userAnswer?.answer as Record<string, string>) || {}).map(
                  ([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1 mx-1 text-xs">
                      {k} <Link2 className="h-2.5 w-2.5" /> {v}
                    </span>
                  )
                )}
              </p>
              <p className="text-xs text-emerald-700">
                الصحيح:
                {question.pairs.map((p) => (
                  <span key={p.key} className="inline-flex items-center gap-1 mx-1">
                    {p.key} <Link2 className="h-2.5 w-2.5" /> {p.value}
                  </span>
                ))}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                إجابتك: <span className="font-medium">{String(userAnswer?.answer || '—')}</span>
              </p>
              {question.correctAnswer && (
                <p className="text-xs text-emerald-700">
                  الإجابة الصحيحة: <span className="font-medium">{question.correctAnswer}</span>
                </p>
              )}
            </div>
          )}

          {/* Explain wrong answer button */}
          {userAnswer && !userAnswer.isCorrect && (
            <>
              <button
                onClick={async () => {
                  if (explaining) return;
                  setExplaining(true);
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const token = session?.access_token || '';
                    const answerStr = question.type === 'matching'
                      ? JSON.stringify(userAnswer.answer)
                      : String(userAnswer.answer || '');
                    const res = await fetch('/api/gemini/explain', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                      body: JSON.stringify({
                        question: question.question,
                        correctAnswer: question.correctAnswer || '',
                        studentAnswer: answerStr,
                        questionType: question.type,
                      }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setExplanation(data.data.explanation);
                    }
                  } catch {
                    toast.error('حدث خطأ');
                  } finally {
                    setExplaining(false);
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:underline"
              >
                {explaining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                لماذا خطأ؟
              </button>
              {explanation && (
                <div className="mt-2 rounded-lg bg-rose-50/50 border border-rose-100 p-3 text-sm text-rose-800 leading-relaxed">
                  {explanation}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
