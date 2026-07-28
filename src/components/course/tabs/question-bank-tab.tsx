'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  BookOpen,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Users,
  BarChart3,
  GraduationCap,
  ChevronRight,
  ListChecks,
  Clock,
  Trophy,
  Play,
  ArrowRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';
import type { UserProfile, Subject, QuestionBank, BankQuestion, Quiz, Score } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface QuestionBankTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  subject: Subject;
  teacherName: string;
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
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string, locale: string = 'ar'): string {
  try {
    return new Date(dateStr).toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function questionTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case 'mcq':
      return t('typeMcq');
    case 'boolean':
      return t('typeBoolean');
    case 'completion':
      return t('typeCompletion');
    case 'matching':
      return t('typeMatching');
    default:
      return type;
  }
}

function difficultyLabel(d: string | null | undefined, t: (key: string) => string): string {
  switch (d) {
    case 'easy':
      return t('difficultyEasy');
    case 'medium':
      return t('difficultyMedium');
    case 'hard':
      return t('difficultyHard');
    default:
      return t('difficultyUnspecified');
  }
}

function difficultyColor(d?: string | null): string {
  switch (d) {
    case 'easy':
      return 'bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border-emerald-200 dark:border-emerald-900/60';
    case 'medium':
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/60';
    case 'hard':
      return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-500 border-rose-200 dark:border-rose-900/60';
    default:
      return 'bg-muted/50 text-muted-foreground border-border';
  }
}

function correctRateColor(rate: number): string {
  if (rate >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function correctRateBg(rate: number): string {
  if (rate >= 70) return 'bg-emerald-100 dark:bg-emerald-900/15';
  if (rate >= 40) return 'bg-amber-100 dark:bg-amber-900/30';
  return 'bg-rose-100 dark:bg-rose-900/30';
}

// -------------------------------------------------------
// Practice state types
// -------------------------------------------------------
interface PracticeAnswer {
  questionId: string;
  isCorrect: boolean;
  selectedAnswer: string;
  correctAnswer: string;
}

type PracticePhase = 'bank-list' | 'bank-detail' | 'practice-active' | 'practice-result' | 'practice-review';

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function QuestionBankTab({ profile, role, subjectId, subject, teacherName }: QuestionBankTabProps) {
  const { t, direction, locale } = useTranslations();
  const isRTL = direction === 'rtl';
  const BackIcon = isRTL ? ChevronRight : ChevronLeft;

  // Arabic letters for option labels
  const arabicLetters = ['أ','ب','ج','د','هـ','و','ز','ح','ط','ي','ك','ل','م','ن','س','ع','ف','ص','ق','ر','ش','ت','ث','خ','ذ','ض','ظ','غ'];
  const getOptionLabel = (idx: number) => {
    if (locale === 'ar') return arabicLetters[idx] || String(idx + 1);
    return String.fromCharCode(65 + idx);
  };

  // ─── Data ───
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [bankQuestions, setBankQuestions] = useState<Record<string, BankQuestion[]>>({});
  const [relatedQuizzes, setRelatedQuizzes] = useState<Quiz[]>([]);
  const [relatedScores, setRelatedScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── View state ───
  const [phase, setPhase] = useState<PracticePhase>('bank-list');
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);

  // ─── Practice state ───
  const [practiceAnswers, setPracticeAnswers] = useState<PracticeAnswer[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  // ─── Fetch data ───
  const fetchBanks = useCallback(async () => {
    setLoading(true);
    try {
      const { data: banksData, error: banksError } = await supabase
        .from('question_banks')
        .select('*')
        .eq('subject_id', subjectId);

      if (banksError) throw banksError;
      const fetchedBanks: QuestionBank[] = (banksData || []) as QuestionBank[];

      setBanks(fetchedBanks);

      if (fetchedBanks.length > 0) {
        const bankIds = fetchedBanks.map(b => b.id);

        const { data: questionsData, error: questionsError } = await supabase
          .from('bank_questions')
          .select('*')
          .in('bank_id', bankIds);

        if (questionsError) throw questionsError;

        const questionsMap: Record<string, BankQuestion[]> = {};
        for (const q of (questionsData || []) as BankQuestion[]) {
          if (!questionsMap[q.bank_id]) questionsMap[q.bank_id] = [];
          questionsMap[q.bank_id].push(q);
        }

        // Attach question_count to banks
        for (const bank of fetchedBanks) {
          bank.question_count = questionsMap[bank.id]?.length || 0;
        }

        setBankQuestions(questionsMap);
        setBanks(fetchedBanks);
      }

      // Fetch related quizzes & scores for teacher stats
      if (role === 'teacher') {
        const { data: quizzesData, error: quizzesError } = await supabase
          .from('quizzes')
          .select('*')
          .eq('subject_id', subjectId);

        if (quizzesError) throw quizzesError;
        const quizzes = (quizzesData || []) as Quiz[];
        setRelatedQuizzes(quizzes);

        if (quizzes.length > 0) {
          const quizIds = quizzes.map(q => q.id);
          const { data: scoresData, error: scoresError } = await supabase
            .from('scores')
            .select('*')
            .in('quiz_id', quizIds);

          if (scoresError) throw scoresError;
          setRelatedScores((scoresData || []) as Score[]);
        }
      }
    } catch (err) {
      console.error('[QuestionBankTab] Fetch error:', err);
      toast.error(t('toastBankCreateError') || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [subjectId, role, t]);

  useEffect(() => {
    fetchBanks();
  }, [fetchBanks]);

  // ─── Computed values ───
  const selectedBank = selectedBankId ? banks.find(b => b.id === selectedBankId) : null;
  const selectedBankQuestions = selectedBankId ? bankQuestions[selectedBankId] || [] : [];

  // Difficulty breakdown for a bank
  const getDifficultyBreakdown = (bankId: string) => {
    const questions = bankQuestions[bankId] || [];
    const easy = questions.filter(q => q.difficulty === 'easy').length;
    const medium = questions.filter(q => q.difficulty === 'medium').length;
    const hard = questions.filter(q => q.difficulty === 'hard').length;
    const unspecified = questions.length - easy - medium - hard;
    return { easy, medium, hard, unspecified, total: questions.length };
  };

  // Quiz stats helper
  const getQuizStats = (quizId: string) => {
    const scoresForQuiz = relatedScores.filter(s => s.quiz_id === quizId);
    const participantCount = scoresForQuiz.length;
    const avgScore = participantCount > 0
      ? scoresForQuiz.reduce((acc, s) => acc + (s.score / s.total) * 100, 0) / participantCount
      : 0;
    return { participantCount, avgScore: Math.round(avgScore) };
  };

  // Per-question correct rate from scores
  const getQuestionCorrectRate = (questionIndex: number, quiz: Quiz) => {
    const scoresForQuiz = relatedScores.filter(s => s.quiz_id === quiz.id);
    if (scoresForQuiz.length === 0) return 0;
    let correctCount = 0;
    for (const score of scoresForQuiz) {
      const answer = score.user_answers?.[questionIndex];
      if (answer && answer.isCorrect) correctCount++;
    }
    return Math.round((correctCount / scoresForQuiz.length) * 100);
  };

  // ─── Practice helpers ───
  const startPractice = (bankId: string) => {
    setSelectedBankId(bankId);
    setPracticeAnswers([]);
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setShowFeedback(false);
    setPhase('practice-active');
  };

  const handlePracticeAnswer = () => {
    if (!selectedOption || !selectedBankId) return;
    const questions = bankQuestions[selectedBankId] || [];
    const question = questions[currentQuestionIndex];
    if (!question) return;

    let isCorrect = false;
    let correctAnswer = '';

    switch (question.type) {
      case 'mcq':
        correctAnswer = question.correct_answer || '';
        isCorrect = selectedOption === correctAnswer;
        break;
      case 'boolean':
        correctAnswer = question.correct_answer || '';
        isCorrect = selectedOption === correctAnswer;
        break;
      case 'completion':
        correctAnswer = question.correct_answer || '';
        isCorrect = selectedOption.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
        break;
      case 'matching': {
        // For matching, compare key-value pairs
        const pairs = question.pairs || [];
        const selectedPairs = JSON.parse(selectedOption) as Record<string, string>;
        const correctPairs: Record<string, string> = {};
        for (const pair of pairs) correctPairs[pair.key] = pair.value;
        isCorrect = Object.keys(correctPairs).every(key => selectedPairs[key] === correctPairs[key]);
        correctAnswer = pairs.map(p => `${p.key} → ${p.value}`).join(', ');
        break;
      }
    }

    setPracticeAnswers(prev => [...prev, {
      questionId: question.id,
      isCorrect,
      selectedAnswer: selectedOption,
      correctAnswer,
    }]);
    setShowFeedback(true);
  };

  const handleNextQuestion = () => {
    const questions = bankQuestions[selectedBankId!] || [];
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedOption(null);
      setShowFeedback(false);
    } else {
      setPhase('practice-result');
    }
  };

  const practiceCorrectCount = practiceAnswers.filter(a => a.isCorrect).length;
  const practiceWrongCount = practiceAnswers.length - practiceCorrectCount;
  const practicePercentage = practiceAnswers.length > 0
    ? Math.round((practiceCorrectCount / practiceAnswers.length) * 100)
    : 0;

  // ─── Render: Loading ───
  if (loading) {
    return (
      <div dir={direction} className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-10 w-10 animate-spin text-sky-700" />
        <p className="mt-4 text-sm text-muted-foreground">{t('noBanks') || 'Loading...'}</p>
      </div>
    );
  }

  // ─── Render: No banks ───
  if (banks.length === 0 && phase === 'bank-list') {
    return (
      <div dir={direction} className="flex flex-col items-center justify-center py-16">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <Database className="h-16 w-16 text-muted-foreground/40" />
        </motion.div>
        <h3 className="mt-4 text-lg font-semibold text-sky-800 dark:text-sky-300">
          {t('noBanksForSubject')}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-md text-center">
          {t('noBanksForSubjectDesc')}
        </p>
      </div>
    );
  }

  // ─── Render: Student Practice Active ───
  if (role === 'student' && phase === 'practice-active' && selectedBankId) {
    const questions = bankQuestions[selectedBankId] || [];
    const question = questions[currentQuestionIndex];

    if (!question) {
      return (
        <div dir={direction} className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">No questions available</p>
        </div>
      );
    }

    return (
      <motion.div
        dir={direction}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col gap-4"
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPhase('bank-detail');
              setSelectedOption(null);
              setShowFeedback(false);
            }}
          >
            <BackIcon className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-sky-800 dark:text-sky-300">
              {selectedBank?.name}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('practiceMode')} — {currentQuestionIndex + 1} / {questions.length}
            </p>
          </div>
          <Progress
            value={(currentQuestionIndex / questions.length) * 100}
            className="h-2 w-24"
          />
        </div>

        {/* Question Card */}
        <Card className="border rounded-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={difficultyColor(question.difficulty)}>
                {difficultyLabel(question.difficulty, t)}
              </Badge>
              <Badge variant="outline" className="bg-sky-100 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60">
                {questionTypeLabel(question.type, t)}
              </Badge>
              {question.category && (
                <Badge variant="outline" className="bg-muted/50 text-muted-foreground">
                  {question.category}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <p className="text-base font-medium leading-relaxed mb-4">{question.question}</p>

            {/* MCQ Options */}
            {question.type === 'mcq' && question.options && (
              <div className="flex flex-col gap-2">
                {question.options.map((option, idx) => {
                  const label = getOptionLabel(idx);
                  const isSelected = selectedOption === option;
                  const isCorrectOption = question.correct_answer === option;
                  const showCorrectHighlight = showFeedback && isCorrectOption;

                  return (
                    <button
                      key={idx}
                      disabled={showFeedback}
                      onClick={() => !showFeedback && setSelectedOption(option)}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-sm transition-all
                        ${showFeedback
                          ? showCorrectHighlight
                            ? 'bg-emerald-100 dark:bg-emerald-900/15 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400'
                            : isSelected && !isCorrectOption
                              ? 'bg-rose-100 dark:bg-rose-900/15 border-rose-400 dark:border-rose-600 text-rose-700 dark:text-rose-400'
                              : 'bg-muted/30 border-border text-muted-foreground'
                          : isSelected
                            ? 'bg-sky-100 dark:bg-sky-900/15 border-sky-400 dark:border-sky-600 text-sky-700 dark:text-sky-400'
                            : 'bg-muted/30 border-border hover:bg-muted/50'
                        }`}
                    >
                      <span className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold
                        ${showFeedback && showCorrectHighlight
                          ? 'bg-emerald-500 text-white'
                          : showFeedback && isSelected && !isCorrectOption
                            ? 'bg-rose-500 text-white'
                            : isSelected
                              ? 'bg-sky-700 text-white'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {showFeedback && showCorrectHighlight ? <CheckCircle2 className="h-4 w-4" /> : showFeedback && isSelected && !isCorrectOption ? <XCircle className="h-4 w-4" /> : label}
                      </span>
                      <span className="flex-1">{option}</span>
                      {showFeedback && showCorrectHighlight && (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      )}
                      {showFeedback && isSelected && !isCorrectOption && (
                        <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Boolean Options */}
            {question.type === 'boolean' && (
              <div className="flex flex-col gap-2">
                {['true', 'false'].map((option) => {
                  const displayText = option === 'true' ? (locale === 'ar' ? 'صحيح' : 'True') : (locale === 'ar' ? 'خطأ' : 'False');
                  const isSelected = selectedOption === option;
                  const isCorrectOption = question.correct_answer === option;
                  const showCorrectHighlight = showFeedback && isCorrectOption;

                  return (
                    <button
                      key={option}
                      disabled={showFeedback}
                      onClick={() => !showFeedback && setSelectedOption(option)}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-sm transition-all
                        ${showFeedback
                          ? showCorrectHighlight
                            ? 'bg-emerald-100 dark:bg-emerald-900/15 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400'
                            : isSelected && !isCorrectOption
                              ? 'bg-rose-100 dark:bg-rose-900/15 border-rose-400 dark:border-rose-600 text-rose-700 dark:text-rose-400'
                              : 'bg-muted/30 border-border text-muted-foreground'
                          : isSelected
                            ? 'bg-sky-100 dark:bg-sky-900/15 border-sky-400 dark:border-sky-600 text-sky-700 dark:text-sky-400'
                            : 'bg-muted/30 border-border hover:bg-muted/50'
                        }`}
                    >
                      {showFeedback && showCorrectHighlight && <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
                      {showFeedback && isSelected && !isCorrectOption && <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />}
                      <span className="font-medium">{displayText}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Completion Input */}
            {question.type === 'completion' && (
              <div className="flex flex-col gap-2">
                {!showFeedback ? (
                  <input
                    type="text"
                    value={selectedOption || ''}
                    onChange={(e) => setSelectedOption(e.target.value)}
                    placeholder={t('completionPlaceholder')}
                    className="w-full p-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                ) : (
                  <div className={`p-3 rounded-lg border text-sm
                    ${practiceAnswers[currentQuestionIndex]?.isCorrect
                      ? 'bg-emerald-100 dark:bg-emerald-900/15 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400'
                      : 'bg-rose-100 dark:bg-rose-900/15 border-rose-400 dark:border-rose-600 text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    <p className="font-medium">
                      {practiceAnswers[currentQuestionIndex]?.isCorrect
                        ? <span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> {t('practiceCorrect')}</span>
                        : <span className="flex items-center gap-2"><XCircle className="h-5 w-5" /> {t('practiceWrong')}</span>
                      }
                    </p>
                    {!practiceAnswers[currentQuestionIndex]?.isCorrect && (
                      <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                        {t('correctAnswer')}: {question.correct_answer}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Matching */}
            {question.type === 'matching' && question.pairs && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">{t('matchingPairs')}</p>
                <div className="flex flex-col gap-2">
                  {question.pairs.map((pair, idx) => {
                    const currentSelected = selectedOption
                      ? JSON.parse(selectedOption) as Record<string, string>
                      : {};
                    const userValue = currentSelected[pair.key] || '';

                    return (
                      <div key={idx} className="flex items-center gap-3">
                        <span className="flex-shrink-0 font-medium text-sm bg-muted/50 px-3 py-2 rounded-lg border min-w-[120px]">
                          {pair.key}
                        </span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        {!showFeedback ? (
                          <input
                            type="text"
                            placeholder={t('matchPlaceholder')}
                            value={userValue}
                            onChange={(e) => {
                              const updated = { ...currentSelected, [pair.key]: e.target.value };
                              setSelectedOption(JSON.stringify(updated));
                            }}
                            className="flex-1 p-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        ) : (
                          <span className={`flex-1 p-2 rounded-lg border text-sm
                            ${userValue.trim().toLowerCase() === pair.value.trim().toLowerCase()
                              ? 'bg-emerald-100 dark:bg-emerald-900/15 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400'
                              : 'bg-rose-100 dark:bg-rose-900/15 border-rose-400 dark:border-rose-600 text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {userValue || '—'}
                            {userValue.trim().toLowerCase() !== pair.value.trim().toLowerCase() && (
                              <span className="ml-2 text-emerald-700 dark:text-emerald-400 font-medium">({pair.value})</span>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 mt-4">
              {!showFeedback ? (
                <Button
                  onClick={handlePracticeAnswer}
                  disabled={!selectedOption}
                  className="bg-sky-700 hover:bg-sky-800 text-white"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {t('startPractice')}
                </Button>
              ) : (
                <Button
                  onClick={handleNextQuestion}
                  className="bg-sky-700 hover:bg-sky-800 text-white"
                >
                  {currentQuestionIndex < questions.length - 1 ? (
                    <>
                      <ArrowRight className="h-4 w-4 mr-2" />
                      {t('practiceNext')}
                    </>
                  ) : (
                    <>
                      <Trophy className="h-4 w-4 mr-2" />
                      {t('practiceFinish')}
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // ─── Render: Practice Result ───
  if (role === 'student' && phase === 'practice-result') {
    return (
      <motion.div
        dir={direction}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-6 items-center justify-center py-8"
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200 }}
        >
          <div className="h-20 w-20 rounded-full bg-sky-100 dark:bg-sky-900/15 flex items-center justify-center">
            <Trophy className="h-10 w-10 text-sky-700 dark:text-sky-400" />
          </div>
        </motion.div>

        <div className="text-center">
          <h2 className="text-xl font-bold text-sky-800 dark:text-sky-300">
            {t('practiceCompleted')}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('practiceCompletedDesc')
              .replace('{correct}', String(practiceCorrectCount))
              .replace('{total}', String(practiceAnswers.length))}
          </p>
        </div>

        {/* Score Breakdown */}
        <Card className="w-full max-w-sm border rounded-lg">
          <CardContent className="p-6">
            <div className="flex flex-col gap-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-sky-800 dark:text-sky-300">{practicePercentage}%</p>
                <p className="text-xs text-muted-foreground">{t('practiceScore')}</p>
              </div>
              <Progress value={practicePercentage} className="h-3" />
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span className="text-sm font-medium">{t('practiceCorrect')}: {practiceCorrectCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-rose-600" />
                  <span className="text-sm font-medium">{t('practiceWrong')}: {practiceWrongCount}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <Button
            onClick={() => setPhase('practice-review')}
            variant="outline"
            className="border-sky-200 dark:border-sky-900/60 text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/15"
          >
            <Eye className="h-4 w-4 mr-2" />
            {t('practiceReview')}
          </Button>
          <Button
            onClick={() => startPractice(selectedBankId!)}
            className="bg-sky-700 hover:bg-sky-800 text-white"
          >
            <Play className="h-4 w-4 mr-2" />
            {t('practiceRetry')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setPhase('bank-detail')}
          >
            <BackIcon className="h-4 w-4 mr-2" />
            {t('practiceBackToBank')}
          </Button>
        </div>
      </motion.div>
    );
  }

  // ─── Render: Practice Review ───
  if (role === 'student' && phase === 'practice-review' && selectedBankId) {
    const questions = bankQuestions[selectedBankId] || [];

    return (
      <motion.div
        dir={direction}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col gap-4"
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setPhase('practice-result')}>
            <BackIcon className="h-4 w-4" />
          </Button>
          <h3 className="text-base font-semibold text-sky-800 dark:text-sky-300">
            {t('practiceReview')} — {selectedBank?.name}
          </h3>
        </div>

        {/* Questions Review List */}
        <AnimatePresence>
          <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
            {questions.map((question, idx) => {
              const answer = practiceAnswers[idx];
              if (!answer) return null;

              return (
                <motion.div key={question.id} variants={itemVariants}>
                  <Card className={`border rounded-lg ${answer.isCorrect ? 'border-emerald-300 dark:border-emerald-700' : 'border-rose-300 dark:border-rose-700'}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={difficultyColor(question.difficulty)}>
                          {difficultyLabel(question.difficulty, t)}
                        </Badge>
                        <Badge variant="outline" className="bg-sky-100 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60">
                          {questionTypeLabel(question.type, t)}
                        </Badge>
                        {answer.isCorrect ? (
                          <Badge className="bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border-emerald-200 dark:border-emerald-900/60">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> {t('practiceCorrect')}
                          </Badge>
                        ) : (
                          <Badge className="bg-rose-100 dark:bg-rose-900/15 text-rose-700 dark:text-rose-500 border-rose-200 dark:border-rose-900/60">
                            <XCircle className="h-3 w-3 mr-1" /> {t('practiceWrong')}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-2">
                      <p className="text-sm font-medium mb-2">{question.question}</p>
                      {!answer.isCorrect && (
                        <div className="text-xs mt-2 space-y-1">
                          {question.type === 'mcq' && (
                            <>
                              <p className="text-rose-700 dark:text-rose-400">
                                {locale === 'ar' ? 'إجابتك' : 'Your answer'}: {answer.selectedAnswer}
                              </p>
                              <p className="text-emerald-700 dark:text-emerald-400">
                                {t('correctAnswer')}: {answer.correctAnswer}
                              </p>
                            </>
                          )}
                          {question.type === 'boolean' && (
                            <>
                              <p className="text-rose-700 dark:text-rose-400">
                                {locale === 'ar' ? 'إجابتك' : 'Your answer'}: {answer.selectedAnswer === 'true' ? (locale === 'ar' ? 'صحيح' : 'True') : (locale === 'ar' ? 'خطأ' : 'False')}
                              </p>
                              <p className="text-emerald-700 dark:text-emerald-400">
                                {t('correctAnswer')}: {answer.correctAnswer === 'true' ? (locale === 'ar' ? 'صحيح' : 'True') : (locale === 'ar' ? 'خطأ' : 'False')}
                              </p>
                            </>
                          )}
                          {(question.type === 'completion' || question.type === 'matching') && (
                            <p className="text-emerald-700 dark:text-emerald-400">
                              {t('correctAnswer')}: {answer.correctAnswer}
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </AnimatePresence>

        <div className="flex gap-3 mt-4">
          <Button onClick={() => startPractice(selectedBankId!)} className="bg-sky-700 hover:bg-sky-800 text-white">
            <Play className="h-4 w-4 mr-2" />
            {t('practiceRetry')}
          </Button>
          <Button variant="ghost" onClick={() => setPhase('bank-detail')}>
            <BackIcon className="h-4 w-4 mr-2" />
            {t('practiceBackToBank')}
          </Button>
        </div>
      </motion.div>
    );
  }

  // ─── Render: Bank Detail View ───
  if (phase === 'bank-detail' && selectedBank) {
    const breakdown = getDifficultyBreakdown(selectedBank.id);
    const questions = selectedBankQuestions;

    return (
      <motion.div
        dir={direction}
        initial={{ opacity: 0, x: isRTL ? -20 : 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-col gap-4"
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setPhase('bank-list'); setSelectedBankId(null); }}>
            <BackIcon className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-sky-800 dark:text-sky-300">{selectedBank.name}</h3>
            {selectedBank.description && (
              <p className="text-sm text-muted-foreground mt-1">{selectedBank.description}</p>
            )}
          </div>
        </div>

        {/* Stats Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="bg-sky-100 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60">
            <ListChecks className="h-3 w-3 mr-1" />
            {questions.length} {t('bankQuestionsCount')}
          </Badge>
          {breakdown.easy > 0 && (
            <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border-emerald-200 dark:border-emerald-900/60">
              {t('difficultyEasy')}: {breakdown.easy}
            </Badge>
          )}
          {breakdown.medium > 0 && (
            <Badge variant="outline" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/60">
              {t('difficultyMedium')}: {breakdown.medium}
            </Badge>
          )}
          {breakdown.hard > 0 && (
            <Badge variant="outline" className="bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-500 border-rose-200 dark:border-rose-900/60">
              {t('difficultyHard')}: {breakdown.hard}
            </Badge>
          )}
        </div>

        {/* Difficulty Progress Bar */}
        {questions.length > 0 && (
          <Card className="border rounded-lg">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                <span className="text-sm font-medium">{t('questionCountByType')}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-muted flex">
                {breakdown.easy > 0 && (
                  <div className="bg-emerald-500 h-full" style={{ width: `${(breakdown.easy / breakdown.total) * 100}%` }} />
                )}
                {breakdown.medium > 0 && (
                  <div className="bg-amber-500 h-full" style={{ width: `${(breakdown.medium / breakdown.total) * 100}%` }} />
                )}
                {breakdown.hard > 0 && (
                  <div className="bg-rose-500 h-full" style={{ width: `${(breakdown.hard / breakdown.total) * 100}%` }} />
                )}
                {breakdown.unspecified > 0 && (
                  <div className="bg-muted-foreground/30 h-full" style={{ width: `${(breakdown.unspecified / breakdown.total) * 100}%` }} />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Student: Start Practice Button */}
        {role === 'student' && questions.length > 0 && (
          <Card className="border rounded-lg bg-sky-50 dark:bg-sky-900/5 border-sky-200 dark:border-sky-900/60">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-sky-100 dark:bg-sky-900/15 flex items-center justify-center flex-shrink-0">
                <Play className="h-5 w-5 text-sky-700 dark:text-sky-400" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-sky-800 dark:text-sky-300">{t('practiceMode')}</h4>
                <p className="text-xs text-muted-foreground">{t('practiceDesc')}</p>
              </div>
              <Button onClick={() => startPractice(selectedBank.id)} className="bg-sky-700 hover:bg-sky-800 text-white">
                <Play className="h-4 w-4 mr-2" />
                {t('startPractice')}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Questions List */}
        {questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">{t('noQuestionsYet')}</p>
          </div>
        ) : (
          <AnimatePresence>
            <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
              {questions.map((question, idx) => (
                <motion.div key={question.id} variants={itemVariants}>
                  <Card className="border rounded-lg hover:shadow-sm transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                        <Badge variant="outline" className={difficultyColor(question.difficulty)}>
                          {difficultyLabel(question.difficulty, t)}
                        </Badge>
                        <Badge variant="outline" className="bg-sky-100 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60">
                          {questionTypeLabel(question.type, t)}
                        </Badge>
                        {question.category && (
                          <Badge variant="outline" className="bg-muted/50 text-muted-foreground">
                            {question.category}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-2">
                      <p className="text-sm font-medium leading-relaxed">{question.question}</p>

                      {/* MCQ preview */}
                      {question.type === 'mcq' && question.options && (
                        <div className="flex flex-col gap-1 mt-2">
                          {question.options.map((opt, oi) => (
                            <div key={oi} className={`flex items-center gap-2 text-xs
                              ${question.correct_answer === opt ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}
                            `}>
                              <span className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px]
                                ${question.correct_answer === opt ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'}
                              `}>
                                {question.correct_answer === opt ? '✓' : getOptionLabel(oi)}
                              </span>
                              {opt}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Boolean preview */}
                      {question.type === 'boolean' && (
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className={question.correct_answer === 'true' ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}>
                            {locale === 'ar' ? 'صحيح' : 'True'}
                          </span>
                          <span className="text-muted-foreground">/</span>
                          <span className={question.correct_answer === 'false' ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}>
                            {locale === 'ar' ? 'خطأ' : 'False'}
                          </span>
                        </div>
                      )}

                      {/* Completion preview */}
                      {question.type === 'completion' && question.correct_answer && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">
                          {t('correctAnswer')}: {role === 'teacher' ? question.correct_answer : '•••'}
                        </p>
                      )}

                      {/* Matching preview */}
                      {question.type === 'matching' && question.pairs && (
                        <div className="flex flex-col gap-1 mt-2">
                          {question.pairs.map((pair, pi) => (
                            <div key={pi} className="flex items-center gap-2 text-xs">
                              <span className="font-medium">{pair.key}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span className={role === 'teacher' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                                {role === 'teacher' ? pair.value : '•••'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
        )}

        {/* Teacher: Related Quizzes Stats */}
        {role === 'teacher' && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-3">
              <GraduationCap className="h-5 w-5 text-sky-700 dark:text-sky-400" />
              <h4 className="text-sm font-semibold text-sky-800 dark:text-sky-300">{t('relatedQuizzes')}</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-3">{t('relatedQuizzesDesc')}</p>

            {relatedQuizzes.length === 0 ? (
              <Card className="border rounded-lg bg-muted/30">
                <CardContent className="p-4 flex flex-col items-center justify-center text-center">
                  <Users className="h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-sm font-medium text-muted-foreground">{t('noRelatedQuizzes')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('noRelatedQuizzesDesc')}</p>
                </CardContent>
              </Card>
            ) : (
              <AnimatePresence>
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="flex flex-col gap-3 max-h-96 overflow-y-auto">
                  {relatedQuizzes.map((quiz) => {
                    const stats = getQuizStats(quiz.id);

                    return (
                      <motion.div key={quiz.id} variants={itemVariants}>
                        <Card className="border rounded-lg">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div className="flex-1 min-w-0">
                                <h5 className="text-sm font-semibold truncate">{quiz.title}</h5>
                                <div className="flex items-center gap-2 mt-1">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">{formatDate(quiz.created_at, locale)}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="flex items-center gap-1">
                                  <Users className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                                  <span className="text-xs font-medium">{stats.participantCount} {t('participants')}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                                  <span className="text-xs font-medium">{stats.avgScore}% {t('averageScore')}</span>
                                </div>
                              </div>
                            </div>

                            {/* Question Difficulty Analysis */}
                            {quiz.questions && quiz.questions.length > 0 && stats.participantCount > 0 && (
                              <div className="mt-3 pt-3 border-t border-border">
                                <div className="flex items-center gap-2 mb-2">
                                  <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                                  <span className="text-xs font-semibold text-sky-800 dark:text-sky-300">
                                    {t('questionDifficultyAnalysis')}
                                  </span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  {quiz.questions.map((q, qi) => {
                                    const rate = getQuestionCorrectRate(qi, quiz);
                                    return (
                                      <div key={qi} className={`flex items-center justify-between gap-2 p-2 rounded-md ${correctRateBg(rate)}`}>
                                        <span className="text-xs truncate max-w-[60%]">{q.question}</span>
                                        <span className={`text-xs font-bold ${correctRateColor(rate)}`}>
                                          {t('questionCorrectRate')}: {rate}%
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  // ─── Render: Bank List View ───
  return (
    <motion.div
      dir={direction}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Database className="h-5 w-5 text-sky-700 dark:text-sky-400" />
        <h3 className="text-lg font-semibold text-sky-800 dark:text-sky-300">
          {t('questionBank')}
        </h3>
        <Badge variant="outline" className="bg-sky-100 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60">
          {banks.length} {t('banksCount').replace('{count}', String(banks.length))}
        </Badge>
      </div>

      {/* Bank Cards */}
      <AnimatePresence>
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {banks.map((bank) => {
            const breakdown = getDifficultyBreakdown(bank.id);
            const questionCount = bankQuestions[bank.id]?.length || bank.question_count || 0;

            return (
              <motion.div key={bank.id} variants={itemVariants}>
                <Card
                  className="border rounded-lg cursor-pointer hover:shadow-md transition-all hover:border-sky-300 dark:hover:border-sky-700"
                  onClick={() => { setSelectedBankId(bank.id); setPhase('bank-detail'); }}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-sky-100 dark:bg-sky-900/15 flex items-center justify-center flex-shrink-0">
                          <BookOpen className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                        </div>
                        <h4 className="text-sm font-semibold text-sky-800 dark:text-sky-300 truncate">{bank.name}</h4>
                      </div>
                      <Badge variant="outline" className="bg-sky-100 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60 flex-shrink-0">
                        <ListChecks className="h-3 w-3 mr-1" />
                        {questionCount} {t('bankQuestionsCount')}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {bank.description && (
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{bank.description}</p>
                    )}

                    {/* Difficulty breakdown */}
                    {questionCount > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        {breakdown.easy > 0 && (
                          <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-500 border-emerald-200 dark:border-emerald-900/60 text-[10px]">
                            {t('difficultyEasy')}: {breakdown.easy}
                          </Badge>
                        )}
                        {breakdown.medium > 0 && (
                          <Badge variant="outline" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/60 text-[10px]">
                            {t('difficultyMedium')}: {breakdown.medium}
                          </Badge>
                        )}
                        {breakdown.hard > 0 && (
                          <Badge variant="outline" className="bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-500 border-rose-200 dark:border-rose-900/60 text-[10px]">
                            {t('difficultyHard')}: {breakdown.hard}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Student: Quick Practice */}
                    {role === 'student' && questionCount > 0 && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                        <Play className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                        <span className="text-xs text-sky-700 dark:text-sky-400 font-medium">{t('practiceMode')}</span>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                      <span className="text-xs text-muted-foreground">{formatDate(bank.created_at, locale)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/15 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBankId(bank.id);
                          if (role === 'student') {
                            startPractice(bank.id);
                          } else {
                            setPhase('bank-detail');
                          }
                        }}
                      >
                        {role === 'student' ? (
                          <>
                            <Play className="h-3 w-3 mr-1" />
                            {t('startPractice')}
                          </>
                        ) : (
                          <>
                            <Eye className="h-3 w-3 mr-1" />
                            {t('viewBank')}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
