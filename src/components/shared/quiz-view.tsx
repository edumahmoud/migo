'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
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
  Clock,
  AlertTriangle,
  Save,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { UserProfile, Quiz, QuizQuestion, UserAnswer, Score } from '@/lib/types';

// -------------------------------------------------------
// Quiz Progress Persistence (localStorage)
// -------------------------------------------------------
interface QuizProgress {
  userAnswers: UserAnswer[];
  currentIdx: number;
  shuffledOrder: number[];
  startedAt: number; // timestamp when quiz was first started
  updatedAt: number; // timestamp of last save
}

const PROGRESS_KEY = (quizId: string) => `quiz-progress-${quizId}`;

function saveProgress(quizId: string, progress: QuizProgress): void {
  try {
    progress.updatedAt = Date.now();
    localStorage.setItem(PROGRESS_KEY(quizId), JSON.stringify(progress));
  } catch {
    // localStorage might be full or unavailable
  }
}

function loadProgress(quizId: string): QuizProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY(quizId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuizProgress;
    // Validate structure
    if (!Array.isArray(parsed.userAnswers) || typeof parsed.currentIdx !== 'number' || !Array.isArray(parsed.shuffledOrder)) {
      localStorage.removeItem(PROGRESS_KEY(quizId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearProgress(quizId: string): void {
  try {
    localStorage.removeItem(PROGRESS_KEY(quizId));
  } catch {
    // ignore
  }
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface QuizViewProps {
  quizId: string;
  onBack: () => void;
  profile: UserProfile;
  /** If true, skip the quiz-taking flow and show results + review from saved score */
  reviewMode?: boolean;
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
  hidden: { opacity: 0, x: -30 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
  exit: { opacity: 0, x: 30, transition: { duration: 0.25, ease: 'easeIn' as const } },
};

const fadeInUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function QuizView({ quizId, onBack, profile, reviewMode }: QuizViewProps) {
  // ─── App store ───
  const { setCurrentPage } = useAppStore();

  // ─── Quiz state ───
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Track whether we already have valid data to avoid unnecessary loading resets on mobile.
  // When returning from background, INITIAL_SESSION fires and previously would
  // reset the page to loading — causing the "infinity loading" crash.
  const hasValidDataRef = useRef(false);

  // ─── Quiz taking state ───
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [progressRestored, setProgressRestored] = useState(false);
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

  // ─── Shuffle question order state (Feature 8) ───
  const [shuffledOrder, setShuffledOrder] = useState<number[]>([]);

  // ─── Track which question is being AI-evaluated (prevent race condition) ───
  const evaluatingQuestionIdxRef = useRef<number | null>(null);

  // ─── Timer state ───
  const [timeLeft, setTimeLeft] = useState<number | null>(null); // seconds remaining
  const [timerWarning, setTimerWarning] = useState(false);

  // -------------------------------------------------------
  // Fetch quiz
  // -------------------------------------------------------
  const fetchQuiz = useCallback(async () => {
    // Only show loading spinner if we don't already have data.
    // This prevents the page from collapsing to a loading state on mobile
    // when the auth state change triggers a re-fetch after returning from background.
    if (!hasValidDataRef.current) {
      setLoading(true);
    }
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('quizzes')
        .select('*')
        .eq('id', quizId)
        .single();

      if (fetchError || !data) {
        // If we already have data, don't overwrite with error
        if (!hasValidDataRef.current) {
          setError('لم يتم العثور على الاختبار');
        }
        return;
      }

      const quizData = data as Quiz;
      if (!quizData.questions || quizData.questions.length === 0) {
        if (!hasValidDataRef.current) {
          setError('لا توجد أسئلة في هذا الاختبار');
        }
        return;
      }

      setQuiz(quizData);
      hasValidDataRef.current = true;

      // ─── Review mode: load saved score and show results + review directly ───
      if (reviewMode) {
        // Reset any state from a previous (non-review) fetch that would block the review UI
        setAlreadyTaken(false);
        setQuizCompleted(false);

        const { data: savedScore } = await supabase
          .from('scores')
          .select('*')
          .eq('student_id', profile.id)
          .eq('quiz_id', quizId)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (savedScore) {
          const scoreData = savedScore as Score;
          // Restore user answers from the saved score
          if (scoreData.user_answers && Array.isArray(scoreData.user_answers)) {
            setUserAnswers(scoreData.user_answers as UserAnswer[]);
          }
          setShowResults(true);
          setShowReview(true); // Auto-open review section
          return; // Skip the quiz-taking flow entirely
        }
        // No saved score found in review mode — fall through to normal flow
        // (edge case: score was deleted but review was requested)
      }

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
      if (!hasValidDataRef.current) {
        setError('حدث خطأ أثناء تحميل الاختبار');
      }
    } finally {
      setLoading(false);
    }
  }, [quizId, profile.id, reviewMode]);

  // ─── Review mode: ensure score is loaded when quiz + reviewMode are both ready ───
  // This is a safety net that handles the case where fetchQuiz completes but
  // the review mode score loading didn't trigger (e.g., due to timing issues).
  // It only runs once when both quiz data and reviewMode are available.
  const reviewLoadedRef = useRef(false);
  // Reset review loaded flag when quizId changes
  useEffect(() => {
    reviewLoadedRef.current = false;
  }, [quizId]);
  useEffect(() => {
    if (!reviewMode || !quiz || !profile.id || reviewLoadedRef.current) return;
    reviewLoadedRef.current = true;

    // Clear any blocking state from a non-review fetch
    setAlreadyTaken(false);
    setQuizCompleted(false);

    // If we already have results showing, no need to reload
    if (showResults) return;

    console.log('[QuizView] Review mode safety net: loading saved score');
    (async () => {
      try {
        const { data: savedScore } = await supabase
          .from('scores')
          .select('*')
          .eq('student_id', profile.id)
          .eq('quiz_id', quiz.id)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (savedScore) {
          const scoreData = savedScore as Score;
          if (scoreData.user_answers && Array.isArray(scoreData.user_answers)) {
            setUserAnswers(scoreData.user_answers as UserAnswer[]);
          }
          setShowResults(true);
          setShowReview(true);
        } else {
          // No score found — student hasn't taken the quiz
          // Just show the quiz normally (they can take it)
          console.warn('[QuizView] Review mode: no saved score found, showing quiz normally');
        }
      } catch (err) {
        console.error('[QuizView] Review mode: failed to load score:', err);
      }
    })();
  }, [reviewMode, quiz, profile.id, showResults]);

  // ─── Auth re-hydration for mobile ───
  // CRITICAL: Only reset to loading if we don't already have data.
  // On mobile, returning from background triggers INITIAL_SESSION, which previously
  // reset the page to loading — causing the "infinity loading" crash.
  useEffect(() => {
    let cancelled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        setAuthReady(true);
        // Only reset to loading if we don't have data yet
        if (!hasValidDataRef.current) {
          setError(null);
          setLoading(true);
        }
        // Always re-fetch in background to refresh data
        fetchQuiz();
      }
    });

    // Also check current session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        setAuthReady(true);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchQuiz]);

  // ─── Loading timeout for mobile ───
  // IMPORTANT: Removed aggressive 30s timeout. The server handles its own timeouts.
  // We use a 5-minute safety net only to prevent truly stuck states.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      console.warn('[QuizView] Loading timeout (5min safety net) — forcing error state');
      setLoading(false);
      setError('انتهت مهلة تحميل الاختبار. يرجى المحاولة مرة أخرى');
    }, 300000); // 5 minutes — safety net only
    return () => clearTimeout(timer);
  }, [loading]);

  // ─── Anti-screenshot & screen recording protection ───
  // NOTE: We do NOT use navigator.mediaDevices.getDisplayMedia() for detection
  // because it triggers a browser permission popup every time — very disruptive.
  // Instead, we rely on keyboard shortcut blocking and visibility change detection.
  // IMPORTANT: We do NOT use window.blur/focus events because they are too aggressive
  // and can trigger browser popups or cause visual glitches on page load.
  useEffect(() => {
    // Track whether protection is ready (delay to avoid triggering on page load)
    let protectionReady = false;
    const readyTimer = setTimeout(() => { protectionReady = true; }, 2000);

    // Blur page content when tab becomes hidden (user switched apps)
    const handleVisibilityChange = () => {
      if (!protectionReady) return;
      if (document.visibilityState === 'hidden') {
        document.body.classList.add('quiz-protected');
      } else {
        document.body.classList.remove('quiz-protected');
      }
    };

    // Block common screenshot shortcuts (PrintScreen, Ctrl+Shift+S, etc.)
    const handleKeyDown = (e: KeyboardEvent) => {
      // PrintScreen key
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        navigator.clipboard?.writeText('').catch(() => {});
        toast.warning('تم تعطيل لقطة الشاشة أثناء الاختبار');
        return;
      }
      // Windows: Win+Shift+S
      if (e.metaKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        toast.warning('تم تعطيل لقطة الشاشة أثناء الاختبار');
        return;
      }
      // Mac: Cmd+Shift+3 or Cmd+Shift+4 or Cmd+Shift+5
      if (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        toast.warning('تم تعطيل لقطة الشاشة أثناء الاختبار');
        return;
      }
      // Ctrl+P (print)
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        return;
      }
    };

    // Prevent right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      clearTimeout(readyTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.body.classList.remove('quiz-protected', 'quiz-capture-detected');
    };
  }, []);

  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]);

  // ─── Shuffle questions on first load (Feature 8) — with progress restore ───
  useEffect(() => {
    if (!quiz?.questions?.length) return;
    if (shuffledOrder.length > 0) return;

    // Try to restore saved progress first
    const saved = loadProgress(quizId);
    if (saved && saved.shuffledOrder.length === quiz.questions.length) {
      // Restore progress from localStorage
      setShuffledOrder(saved.shuffledOrder);
      setCurrentIdx(saved.currentIdx);
      setUserAnswers(saved.userAnswers);
      setProgressRestored(true);
      // Auto-dismiss the restored indicator after 4 seconds
      setTimeout(() => setProgressRestored(false), 4000);
      return;
    }

    // No saved progress — generate new shuffle
    const indices = Array.from({ length: quiz.questions.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setShuffledOrder(indices);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz]);

  // ─── Load saved answer when navigating between questions ───
  useEffect(() => {
    if (!quiz) return;
    const originalIdx = shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx;
    const savedAnswer = userAnswers.find(a => a.questionIndex === originalIdx);
    const q = quiz.questions?.[originalIdx];
    if (!q) return;

    if (savedAnswer) {
      setAnswered(true);
      setIsCorrect(savedAnswer.isCorrect);
      if (q.type === 'mcq' || q.type === 'boolean') {
        setSelectedOption(savedAnswer.answer as string);
        setCompletionInput('');
        setMatchedPairs({});
      } else if (q.type === 'completion') {
        setCompletionInput(savedAnswer.answer as string);
        setSelectedOption(null);
        setMatchedPairs({});
      } else if (q.type === 'matching') {
        setMatchedPairs(savedAnswer.answer as Record<string, string>);
        setMatchingFeedback(savedAnswer.isCorrect ? 'correct' : 'incorrect');
        setSelectedOption(null);
        setCompletionInput('');
      }
      setEvaluatingCompletion(false);
      setSelectedKey(null);
      setSelectedValue(null);
    } else {
      resetQuestionState();
    }
  // Only trigger on currentIdx change, not userAnswers changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  // ─── Timer countdown ───
  // Starts when quiz is loaded and has a duration.
  // Persists start time in sessionStorage so refresh doesn't reset the timer.
  useEffect(() => {
    if (!quiz?.duration || showResults || alreadyTaken) return;

    const storageKey = `quiz-start-${quizId}`;
    const durationSec = quiz.duration * 60; // convert minutes to seconds

    // Get or set the start time
    let startTime: number;
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      startTime = parseInt(stored, 10);
    } else {
      startTime = Date.now();
      sessionStorage.setItem(storageKey, startTime.toString());
    }

    // Calculate remaining time
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, durationSec - elapsed);
    setTimeLeft(remaining);

    if (remaining <= 0) {
      // Time already expired
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [quiz?.duration, quizId, showResults, alreadyTaken]);

  // ─── Auto-submit when time runs out ───
  useEffect(() => {
    if (timeLeft === 0 && !showResults && !alreadyTaken) {
      toast.error('انتهى وقت الاختبار!');
      // Use a direct approach instead of handleFinishQuiz to avoid stale closure
      if (!quiz) return;

      const allAnswers = [...userAnswers];
      const autoOriginalIdx = shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx;
      if (currentQuestion && !allAnswers.find(a => a.questionIndex === autoOriginalIdx)) {
        let answerValue: string | Record<string, string> = '';
        if (currentQuestion.type === 'matching') {
          answerValue = matchedPairs;
        } else if (currentQuestion.type === 'completion') {
          answerValue = completionInput.trim();
        } else {
          answerValue = selectedOption || '';
        }
        // For completion questions not yet evaluated by AI, apply benefit-of-doubt
        // instead of marking wrong when the timer runs out mid-evaluation
        let autoIsCorrect = isCorrect;
        if (currentQuestion.type === 'completion' && !answered && answerValue) {
          const correctAns = currentQuestion.correctAnswer?.trim() || '';
          const sLen = String(answerValue).replace(/\s/g, '').length;
          const cLen = correctAns.replace(/\s/g, '').length;
          const ratio = cLen > 0 ? Math.min(sLen, cLen) / Math.max(sLen, cLen) : 0;
          autoIsCorrect = sLen >= 2 && ratio >= 0.5;
        }
        allAnswers.push({
          questionIndex: autoOriginalIdx,
          type: currentQuestion.type,
          answer: answerValue,
          isCorrect: autoIsCorrect,
        });
      }
      for (let i = 0; i < (quiz.questions?.length || 0); i++) {
        if (!allAnswers.find(a => a.questionIndex === i)) {
          const q = quiz.questions[i];
          allAnswers.push({ questionIndex: i, type: q.type, answer: '', isCorrect: false });
        }
      }
      allAnswers.sort((a, b) => a.questionIndex - b.questionIndex);
      const finalScore = allAnswers.filter(a => a.isCorrect).length;
      setUserAnswers(allAnswers);
      saveScore(finalScore, allAnswers);
      setShowResults(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  // ─── Timer warning ───
  useEffect(() => {
    if (timeLeft !== null && timeLeft <= 60 && timeLeft > 0) {
      setTimerWarning(true);
    } else {
      setTimerWarning(false);
    }
  }, [timeLeft]);

  // ─── Clear timer storage on finish ───
  useEffect(() => {
    if (showResults) {
      sessionStorage.removeItem(`quiz-start-${quizId}`);
      // Clear saved progress when quiz is completed
      clearProgress(quizId);
    }
  }, [showResults, quizId]);

  // ─── Auto-save quiz progress to localStorage ───
  // Saves on every answer change and question navigation so progress
  // is never lost even if the browser crashes or the user navigates away.
  useEffect(() => {
    if (!quiz || showResults || alreadyTaken || shuffledOrder.length === 0) return;

    const existingProgress = loadProgress(quizId);
    const startedAt = existingProgress?.startedAt || Date.now();

    saveProgress(quizId, {
      userAnswers,
      currentIdx,
      shuffledOrder,
      startedAt,
      updatedAt: Date.now(),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAnswers, currentIdx, shuffledOrder]);

  // -------------------------------------------------------
  // Current question
  // -------------------------------------------------------
  const currentQuestion: QuizQuestion | null = quiz?.questions?.[shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx] ?? null;
  const totalQuestions = quiz?.questions?.length ?? 0;
  const progressPct = totalQuestions > 0 ? ((currentIdx + 1) / totalQuestions) * 100 : 0;

  // -------------------------------------------------------
  // Load saved answer for a question (when navigating back)
  // -------------------------------------------------------
  const loadSavedAnswer = useCallback((idx: number) => {
    const originalIdx = shuffledOrder.length > 0 ? shuffledOrder[idx] : idx;
    const savedAnswer = userAnswers.find(a => a.questionIndex === originalIdx);
    const q = quiz?.questions?.[originalIdx];
    if (!q) return;

    if (savedAnswer) {
      setAnswered(true);
      setIsCorrect(savedAnswer.isCorrect);
      if (q.type === 'mcq' || q.type === 'boolean') {
        setSelectedOption(savedAnswer.answer as string);
      } else if (q.type === 'completion') {
        setCompletionInput(savedAnswer.answer as string);
      } else if (q.type === 'matching') {
        setMatchedPairs(savedAnswer.answer as Record<string, string>);
        setMatchingFeedback(savedAnswer.isCorrect ? 'correct' : 'incorrect');
      }
    } else {
      // No saved answer — reset state
      setAnswered(false);
      setIsCorrect(false);
      setSelectedOption(null);
      setCompletionInput('');
      setEvaluatingCompletion(false);
      setSelectedKey(null);
      setSelectedValue(null);
      setMatchedPairs({});
      setMatchingFeedback(null);
    }
  }, [userAnswers, quiz, shuffledOrder]);

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

    // Track which question is being evaluated to prevent race condition
    const evaluatingIdx = shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx;
    evaluatingQuestionIdxRef.current = evaluatingIdx;

    setEvaluatingCompletion(true);

    try {
      // First check exact match
      const studentAnswer = completionInput.trim();
      const correctAnswer = currentQuestion?.correctAnswer?.trim() || '';

      const studentLower = studentAnswer.toLowerCase();
      const correctLower = correctAnswer.toLowerCase();

      if (studentLower === correctLower) {
        setIsCorrect(true);
        setAnswered(true);
        setEvaluatingCompletion(false);
        return;
      }

      // ─── Arabic text normalization ───
      // Remove diacritics (tashkeel), normalize alef variants, normalize taa marbuta
      const normalizeArabic = (s: string) =>
        s.replace(/[\u064B-\u065F\u0670]/g, '')   // remove fatha, damma, kasra, shadda, sukun, etc.
         .replace(/[أإآٱ]/g, 'ا')                  // normalize alef variants → bare alef
         .replace(/ة/g, 'ه')                        // taa marbuta → haa
         .replace(/ى/g, 'ي');                       // alef maqsura → yaa

      // ─── Flexible local matching (before AI call) ───
      // Normalize: remove hyphens, spaces, common suffixes, AND Arabic variations
      const normalize = (s: string) =>
        normalizeArabic(s)
         .toLowerCase()
         .replace(/[-_\s]/g, '')    // remove hyphens, underscores, spaces
         .replace(/ing$/, '')        // strip -ing suffix (wireframing → wirefram)
         .replace(/tion$/, '')       // strip -tion suffix (compilation → compila)
         .replace(/ment$/, '')       // strip -ment suffix
         .replace(/ness$/, '')       // strip -ness suffix
         .replace(/able$/, '')       // strip -able suffix
         .replace(/ible$/, '');      // strip -ible suffix

      const studentNorm = normalize(studentAnswer);
      const correctNorm = normalize(correctAnswer);

      if (studentNorm === correctNorm && studentNorm.length >= 3) {
        setIsCorrect(true);
        setAnswered(true);
        setEvaluatingCompletion(false);
        return;
      }

      // Also check if one contains the other (e.g., "test" in "testing")
      if (
        (studentNorm.length >= 4 && correctNorm.includes(studentNorm)) ||
        (correctNorm.length >= 4 && studentNorm.includes(correctNorm))
      ) {
        // Only accept if length difference is small (< 40%) to avoid false positives
        const lenDiff = Math.abs(studentNorm.length - correctNorm.length);
        const maxLen = Math.max(studentNorm.length, correctNorm.length);
        if (maxLen > 0 && lenDiff / maxLen < 0.4) {
          setIsCorrect(true);
          setAnswered(true);
          setEvaluatingCompletion(false);
          return;
        }
      }

      // ─── Arabic-English cross-language matching ───
      // Check Arabic-normalized forms against each other (handles diacritics, alef variants)
      const studentArNorm = normalizeArabic(studentAnswer).trim();
      const correctArNorm = normalizeArabic(correctAnswer).trim();
      if (studentArNorm === correctArNorm && studentArNorm.length >= 2) {
        setIsCorrect(true);
        setAnswered(true);
        setEvaluatingCompletion(false);
        return;
      }

      // ─── Call API for semantic evaluation with retry ───
      let aiResult: boolean | null = null;
      let lastError: string | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const headers = await getCachedAuthHeaders();
          const res = await fetch('/api/gemini/evaluate', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              question: currentQuestion?.question,
              correctAnswer: currentQuestion?.correctAnswer,
              studentAnswer,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.data) {
              // If server returned a fallback (e.g., rate-limited), don't trust isCorrect
              // Let it fall through to benefit-of-doubt logic instead
              if (data.data.fallback) {
                aiResult = null;
              } else {
                aiResult = data.data.isCorrect;
                break;
              }
            } else if (res.status !== 429) {
              // Non-retryable API error (validation, etc.) — don't retry
              break;
            }
          }

          if (res.status === 429) {
            // Rate limited — wait and retry
            lastError = 'طلبات كثيرة، جاري إعادة المحاولة...';
            if (attempt < 2) await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
            continue;
          }

          // Other server errors — retry with backoff
          lastError = 'خطأ في الاتصال، جاري إعادة المحاولة...';
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        } catch (fetchErr) {
          lastError = 'خطأ في الاتصال، جاري إعادة المحاولة...';
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }

      // Guard: if user navigated away during AI evaluation, don't apply result to wrong question
      if (evaluatingQuestionIdxRef.current !== evaluatingIdx) {
        setEvaluatingCompletion(false);
        return;
      }

      if (aiResult !== null) {
        // AI evaluation succeeded
        setIsCorrect(aiResult);
      } else {
        // AI evaluation failed after all retries
        // Give benefit of doubt: if the student wrote something substantial
        // and it's not obviously wrong, mark as correct to avoid unfair penalty
        // This prevents students from being penalized when the AI service is down
        const studentLen = studentAnswer.replace(/\s/g, '').length;
        const correctLen = correctAnswer.replace(/\s/g, '').length;
        const lenRatio = correctLen > 0 ? Math.min(studentLen, correctLen) / Math.max(studentLen, correctLen) : 0;

        // If answer length is similar (within 50%) and non-trivial, give benefit of doubt
        if (studentLen >= 2 && lenRatio >= 0.5) {
          setIsCorrect(true);
          toast.info('تعذّر التحقق بالذكاء الاصطناعي، تم اعتماد الإجابة');
        } else {
          setIsCorrect(false);
          if (lastError) toast.error(lastError);
        }
      }
      setAnswered(true);
    } catch {
      toast.error('حدث خطأ أثناء تقييم الإجابة');
      setIsCorrect(false);
      setAnswered(true);
    } finally {
      setEvaluatingCompletion(false);
      evaluatingQuestionIdxRef.current = null;
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
      questionIndex: shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx,
      type: currentQuestion.type,
      answer: answerValue,
      isCorrect,
    };

    setUserAnswers((prev) => {
      const filtered = prev.filter(a => a.questionIndex !== newAnswer.questionIndex);
      return [...filtered, newAnswer];
    });

    // Next question or finish
    if (currentIdx < totalQuestions - 1) {
      setCurrentIdx((prev) => prev + 1);
      // Load the next question's saved state or reset
      const nextOriginalIdx = shuffledOrder.length > 0 ? shuffledOrder[currentIdx + 1] : currentIdx + 1;
      const nextSaved = userAnswers.find(a => a.questionIndex === nextOriginalIdx);
      if (!nextSaved) {
        resetQuestionState();
      }
      // Will be handled by useEffect on currentIdx change
    } else {
      // Calculate final score and show results
      const finalAnswers = [...userAnswers.filter(a => a.questionIndex !== newAnswer.questionIndex), newAnswer];
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
        // FIX: Notify user about save failure instead of silent loss
        toast.error('فشل حفظ النتيجة', {
          description: 'تم إكمال الاختبار ولكن حدث خطأ في حفظ النتيجة. يرجى المحاولة مرة أخرى.',
          duration: 8000,
          action: {
            label: 'إعادة المحاولة',
            onClick: () => saveScore(finalScore, finalAnswers),
          },
        });
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
  // Finish quiz (auto-submit when time runs out)
  // -------------------------------------------------------
  const handleFinishQuiz = useCallback(() => {
    if (!quiz || showResults) return;

    // Build answers for all questions including the current one
    const allAnswers = [...userAnswers];

    // Add current question answer if not already saved
    const finishOriginalIdx = shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx;
    if (currentQuestion && !allAnswers.find(a => a.questionIndex === finishOriginalIdx)) {
      let answerValue: string | Record<string, string> = '';
      if (currentQuestion.type === 'matching') {
        answerValue = matchedPairs;
      } else if (currentQuestion.type === 'completion') {
        answerValue = completionInput.trim();
      } else {
        answerValue = selectedOption || '';
      }

      allAnswers.push({
        questionIndex: finishOriginalIdx,
        type: currentQuestion.type,
        answer: answerValue,
        isCorrect,
      });
    }

    // Fill in empty answers for any unanswered questions
    for (let i = 0; i < totalQuestions; i++) {
      if (!allAnswers.find(a => a.questionIndex === i)) {
        const q = quiz.questions[i];
        allAnswers.push({
          questionIndex: i,
          type: q.type,
          answer: '',
          isCorrect: false,
        });
      }
    }

    // Sort by question index
    allAnswers.sort((a, b) => a.questionIndex - b.questionIndex);

    const finalScore = allAnswers.filter(a => a.isCorrect).length;
    setUserAnswers(allAnswers);
    saveScore(finalScore, allAnswers);
    setShowResults(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, userAnswers, currentIdx, currentQuestion, isCorrect, matchedPairs, completionInput, selectedOption, totalQuestions, showResults, shuffledOrder]);

  // -------------------------------------------------------
  // Retry quiz
  // -------------------------------------------------------
  const handleRetry = () => {
    resetQuestionState();
    setCurrentIdx(0);
    setUserAnswers([]);
    setShowResults(false);
    setShowReview(false);
    // Clear timer and saved progress so it restarts on retry
    sessionStorage.removeItem(`quiz-start-${quizId}`);
    clearProgress(quizId);
    setTimeLeft(null);
    // Re-shuffle questions on retry (Feature 8)
    if (quiz?.questions?.length) {
      const indices = Array.from({ length: quiz.questions.length }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      setShuffledOrder(indices);
    }
  };

  // -------------------------------------------------------
  // Change answer (Feature 7)
  // -------------------------------------------------------
  const handleChangeAnswer = () => {
    const originalIdx = shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx;
    // Remove old answer from userAnswers
    setUserAnswers((prev) => prev.filter(a => a.questionIndex !== originalIdx));
    // Reset question state to allow re-answering
    resetQuestionState();
  };

  // -------------------------------------------------------
  // Error state — only show when loading is done AND there's an error
  // -------------------------------------------------------
  if (!loading && (error || !quiz)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4" dir="rtl">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <XCircle className="h-8 w-8 text-rose-600" />
        </div>
        <p className="text-lg font-semibold text-foreground">{error || 'حدث خطأ غير متوقع'}</p>
        <div className="flex gap-2">
          <Button
            onClick={() => { setError(null); hasValidDataRef.current = false; fetchQuiz(); }}
            variant="outline"
            className="gap-2 border-sky-300 text-sky-800 hover:bg-sky-50"
          >
            <RotateCcw className="h-4 w-4" />
            إعادة المحاولة
          </Button>
          <Button
            onClick={onBack}
            variant="outline"
            className="gap-2 border-sky-300 text-sky-800 hover:bg-sky-50"
          >
            <ChevronRight className="h-4 w-4" />
            العودة
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------
  // Already taken state — but review mode takes priority
  // -------------------------------------------------------
  if (alreadyTaken && !reviewMode) {
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
          className="gap-2 border-sky-300 text-sky-800 hover:bg-sky-50"
        >
          <ChevronRight className="h-4 w-4" />
          العودة للرئيسية
        </Button>
      </div>
    );
  }

  // -------------------------------------------------------
  // Results screen
  // -------------------------------------------------------
  if (showResults) {
    const finalScore = userAnswers.filter((a) => a.isCorrect).length;
    const percentage = totalQuestions > 0 ? Math.round((finalScore / totalQuestions) * 100) : 0;
    const scoreColor =
      percentage >= 80
        ? 'text-sky-800'
        : percentage >= 60
          ? 'text-amber-600'
          : 'text-rose-600';
    const scoreBg =
      percentage >= 80
        ? 'bg-sky-100'
        : percentage >= 60
          ? 'bg-amber-100'
          : 'bg-rose-100';
    const scoreRing =
      percentage >= 80
        ? 'ring-sky-200'
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
            <p className="text-muted-foreground mt-1">{quiz?.title}</p>
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
          {!showReview && (
          <Button
            onClick={() => setShowReview(true)}
            variant="outline"
            className="gap-2 border-sky-300 text-sky-800 hover:bg-sky-50"
          >
            <Eye className="h-4 w-4" />
            مراجعة الإجابات
          </Button>
          )}
          {!reviewMode && (
          <Button
            onClick={handleRetry}
            variant="outline"
            className="gap-2 border-teal-300 text-teal-700 hover:bg-teal-50"
            style={{ display: quiz?.allow_retake ? undefined : 'none' }}
          >
            <RotateCcw className="h-4 w-4" />
            إعادة الاختبار
          </Button>
          )}
          <Button
            onClick={onBack}
            className="gap-2 bg-sky-700 text-white hover:bg-sky-800"
          >
            <ChevronRight className="h-4 w-4" />
            {reviewMode ? 'العودة' : 'العودة للرئيسية'}
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
                  <Eye className="h-5 w-5 text-sky-700" />
                  مراجعة الإجابات
                </h3>
                {quiz?.questions?.map((q, idx) => {
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
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 text-sky-800 hover:bg-sky-50 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            {loading ? (
              <>
                <div className="h-5 w-32 animate-pulse rounded bg-sky-100" />
                <div className="mt-1.5 h-3 w-20 animate-pulse rounded bg-sky-50" />
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-foreground truncate">{quiz?.title}</h2>
                <p className="text-xs text-muted-foreground">
                  السؤال {currentIdx + 1} من {totalQuestions}
                </p>
              </>
            )}
          </div>
          {/* Timer display */}
          {timeLeft !== null && !showResults && (
            <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold tabular-nums transition-all ${
              timerWarning
                ? 'bg-rose-100 text-rose-700 animate-pulse'
                : timeLeft <= 300
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-sky-100 text-sky-800'
            }`}>
              <Clock className="h-4 w-4" />
              {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <Progress value={progressPct} className="h-2.5 bg-sky-100 [&>div]:bg-sky-700" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{currentIdx + 1}</span>
            <span>{totalQuestions}</span>
          </div>
        </div>

        {/* Progress restored indicator + answered count */}
        <AnimatePresence>
          {progressRestored && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700"
            >
              <Save className="h-3.5 w-3.5" />
              <span>تم استعادة تقدمك المحفوظ — {userAnswers.length} {userAnswers.length === 1 ? 'إجابة' : 'إجابات'} من {totalQuestions}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-save indicator */}
        {userAnswers.length > 0 && !progressRestored && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Save className="h-3 w-3" />
            <span>تم حفظ {userAnswers.length} من {totalQuestions}</span>
          </div>
        )}
      </motion.div>

      {/* Question card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={loading ? 'loading' : currentIdx}
          variants={pageVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {loading ? (
            <Card className="border-sky-200 bg-white shadow-sm">
              <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-5">
                <div className="space-y-3">
                  <div className="h-5 w-28 animate-pulse rounded bg-sky-100" />
                  <div className="h-4 w-full animate-pulse rounded bg-sky-50" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-sky-50" />
                </div>
                <div className="space-y-3 pt-2">
                  <div className="h-12 w-full animate-pulse rounded-xl bg-sky-50" />
                  <div className="h-12 w-full animate-pulse rounded-xl bg-sky-50" />
                  <div className="h-12 w-full animate-pulse rounded-xl bg-sky-50" />
                </div>
              </CardContent>
            </Card>
          ) : currentQuestion ? (
            <Card className="border-sky-200 bg-white shadow-sm">
              <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-5">
                {/* Type badge + question */}
                <div className="space-y-3">
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-sky-300 bg-sky-50 text-sky-800 text-xs"
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
                    showCorrectness={quiz?.show_results !== false}
                  />
                )}

                {currentQuestion.type === 'boolean' && (
                  <BooleanQuestion
                    question={currentQuestion}
                    answered={answered}
                    isCorrect={isCorrect}
                    selectedOption={selectedOption}
                    onAnswer={handleBooleanAnswer}
                    showCorrectness={quiz?.show_results !== false}
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

                {/* Feedback indicator — only show during quiz if show_results is true */}
                {answered && quiz?.show_results !== false && (
                  <>
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex items-center gap-2 rounded-lg p-3 ${
                        isCorrect
                          ? 'bg-sky-50 text-sky-800'
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
                          {currentQuestion.type === 'matching' && currentQuestion.pairs ? (
                            <span className="block text-sm text-rose-600 mt-1">
                              الإجابة الصحيحة: {currentQuestion.pairs.map(p => `${p.key} ↔ ${p.value}`).join(' ، ')}
                            </span>
                          ) : currentQuestion.correctAnswer ? (
                            <span className="block text-sm text-rose-600 mt-1">
                              الإجابة الصحيحة: {currentQuestion.correctAnswer}
                            </span>
                          ) : null}
                        </>
                      )}
                    </motion.div>
                  </>
                )}

                {/* Navigation buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Previous button — RTL: ChevronRight points to the start */}
                  {currentIdx > 0 && (
                    <Button
                      onClick={() => {
                        // Save current answer before navigating back
                        if (answered && currentQuestion) {
                          const prevOriginalIdx = shuffledOrder.length > 0 ? shuffledOrder[currentIdx] : currentIdx;
                          const alreadySaved = userAnswers.find(a => a.questionIndex === prevOriginalIdx);
                          if (!alreadySaved) {
                            let answerValue: string | Record<string, string> = '';
                            if (currentQuestion.type === 'matching') answerValue = matchedPairs;
                            else if (currentQuestion.type === 'completion') answerValue = completionInput.trim();
                            else answerValue = selectedOption || '';
                            setUserAnswers(prev => [...prev.filter(a => a.questionIndex !== prevOriginalIdx), {
                              questionIndex: prevOriginalIdx,
                              type: currentQuestion.type,
                              answer: answerValue,
                              isCorrect,
                            }]);
                          }
                        }
                        setCurrentIdx(prev => prev - 1);
                      }}
                      variant="outline"
                      className="gap-1.5 border-sky-300 text-sky-800 hover:bg-sky-50 text-xs sm:text-sm"
                    >
                      <ChevronRight className="h-4 w-4" />
                      <span className="hidden sm:inline">السؤال السابق</span>
                      <span className="sm:hidden">السابق</span>
                    </Button>
                  )}

                  {/* Change answer button (Feature 7) */}
                  {answered && (
                    <Button
                      onClick={handleChangeAnswer}
                      variant="outline"
                      className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 text-xs sm:text-sm"
                    >
                      <PenLine className="h-4 w-4" />
                      <span className="hidden sm:inline">تغيير الإجابة</span>
                      <span className="sm:hidden">تعديل</span>
                    </Button>
                  )}

                  {/* Next / Finish button */}
                  {answered && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mr-auto"
                    >
                      <Button
                        onClick={handleNext}
                        className="gap-1.5 bg-sky-700 text-white hover:bg-sky-800 text-xs sm:text-sm"
                      >
                        {currentIdx < totalQuestions - 1 ? (
                          <>
                            <span className="hidden sm:inline">السؤال التالي</span>
                            <span className="sm:hidden">التالي</span>
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
                </div>
              </CardContent>
            </Card>
          ) : null}
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
  showCorrectness: boolean;
}

function MCQQuestion({ question, answered, isCorrect, selectedOption, onAnswer, showCorrectness }: MCQQuestionProps) {
  if (!question.options) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {question.options.map((option, idx) => {
        const isSelected = selectedOption === option;
        const isCorrectOption = option === question.correctAnswer;

        let btnClass =
          'rounded-xl border-2 p-3 sm:p-4 text-sm font-medium transition-all text-right flex items-center gap-3';

        if (answered) {
          if (showCorrectness) {
            // Show correct/incorrect colors
            if (isCorrectOption) {
              btnClass += ' border-sky-600 bg-sky-50 text-sky-800';
            } else if (isSelected && !isCorrect) {
              btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
            } else {
              btnClass += ' border-border bg-muted/30 text-muted-foreground';
            }
          } else {
            // Hide correctness — just show selected state
            if (isSelected) {
              btnClass += ' border-teal-500 bg-teal-50 text-teal-700';
            } else {
              btnClass += ' border-border bg-muted/30 text-muted-foreground';
            }
          }
        } else {
          btnClass +=
            ' border-sky-200 bg-white text-foreground hover:border-sky-400 hover:bg-sky-50/50 cursor-pointer';
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
                showCorrectness && answered && isCorrectOption
                  ? 'bg-sky-700 text-white'
                  : showCorrectness && answered && isSelected && !isCorrect
                    ? 'bg-rose-600 text-white'
                    : answered && isSelected
                      ? 'bg-teal-600 text-white'
                      : 'bg-sky-100 text-sky-800'
              }`}
            >
              {String.fromCharCode(1571 + idx)}
            </span>

            <span className="flex-1">{option}</span>

            {/* Feedback icon — only when showing correctness */}
            {showCorrectness && answered && isCorrectOption && (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-700" />
            )}
            {showCorrectness && answered && isSelected && !isCorrect && (
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
  showCorrectness: boolean;
}

function BooleanQuestion({
  question,
  answered,
  isCorrect,
  selectedOption,
  onAnswer,
  showCorrectness,
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
          if (showCorrectness) {
            if (isCorrectOption) {
              btnClass += ' border-sky-600 bg-sky-50 text-sky-800';
            } else if (isSelected && !isCorrect) {
              btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
            } else {
              btnClass += ' border-border bg-muted/30 text-muted-foreground';
            }
          } else {
            if (isSelected) {
              btnClass += ' border-teal-500 bg-teal-50 text-teal-700';
            } else {
              btnClass += ' border-border bg-muted/30 text-muted-foreground';
            }
          }
        } else {
          btnClass +=
            ' border-sky-200 bg-white text-foreground hover:border-sky-400 hover:bg-sky-50/50 cursor-pointer';
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
            {showCorrectness && answered && isCorrectOption && (
              <CheckCircle2 className="h-4 w-4 text-sky-700" />
            )}
            {showCorrectness && answered && isSelected && !isCorrect && (
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
          className="h-12 text-base border-sky-200 focus:border-sky-600 focus:ring-sky-600/20"
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
          className="gap-2 bg-sky-700 text-white hover:bg-sky-800"
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

// Pair colors for visual connection
const PAIR_COLORS = [
  { bg: 'bg-sky-100', border: 'border-sky-400', text: 'text-sky-800', badge: 'bg-sky-600', ring: 'ring-sky-300' },
  { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-700', badge: 'bg-teal-500', ring: 'ring-teal-300' },
  { bg: 'bg-amber-100', border: 'border-amber-400', text: 'text-amber-700', badge: 'bg-amber-500', ring: 'ring-amber-300' },
  { bg: 'bg-rose-100', border: 'border-rose-400', text: 'text-rose-700', badge: 'bg-rose-500', ring: 'ring-rose-300' },
  { bg: 'bg-sky-100', border: 'border-sky-400', text: 'text-sky-800', badge: 'bg-sky-600', ring: 'ring-sky-300' },
  { bg: 'bg-cyan-100', border: 'border-cyan-400', text: 'text-cyan-700', badge: 'bg-cyan-500', ring: 'ring-cyan-300' },
];

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
  // Shuffle values so they don't appear in the same order as keys
  // Uses Fisher-Yates shuffle — ensures the order is DIFFERENT from the original
  const values = useMemo(() => {
    if (!question.pairs) return [];
    const original = question.pairs.map((p) => p.value);
    if (original.length <= 1) return original;

    // Shuffle until the order is different from the original
    let shuffled: string[];
    let attempts = 0;
    do {
      shuffled = [...original];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      attempts++;
    } while (
      shuffled.every((v, i) => v === original[i]) && attempts < 10
    );

    return shuffled;
  }, [question.pairs]);

  if (!question.pairs) return null;

  const keys = question.pairs.map((p) => p.key);

  // Track which values/keys are already matched
  const matchedValuesSet = new Set(Object.values(matchedPairs));
  const matchedKeysSet = new Set(Object.keys(matchedPairs));

  // Get pair number for a key (for numbered badges)
  const getPairNumber = (key: string): number => {
    const keyIndex = keys.indexOf(key);
    return keyIndex + 1;
  };

  // Get color for a matched pair
  const getPairColor = (key: string) => {
    const pairKeys = Object.keys(matchedPairs);
    const idx = pairKeys.indexOf(key);
    return PAIR_COLORS[idx % PAIR_COLORS.length];
  };

  // Get pair number for a value (find which key it's matched to)
  const getValuePairNumber = (value: string): number | null => {
    const entry = Object.entries(matchedPairs).find(([, v]) => v === value);
    if (!entry) return null;
    return getPairNumber(entry[0]);
  };

  const allPairsMatched = Object.keys(matchedPairs).length >= (question.pairs?.length || 0);

  return (
    <div className="space-y-5">
      {/* Instructions */}
      {!answered && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          <span>اختر عنصراً من القائمة أ ثم عنصراً من القائمة ب للتوصيل بينهما</span>
        </div>
      )}

      {/* Two columns layout */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        {/* Keys column (القائمة أ) */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <div className="h-1.5 w-1.5 rounded-full bg-sky-600" />
            <p className="text-xs font-bold text-sky-800">القائمة أ</p>
          </div>
          {keys.map((key) => {
            const isMatched = matchedKeysSet.has(key);
            const isSelected = selectedKey === key;
            const pairNum = getPairNumber(key);
            const color = isMatched ? getPairColor(key) : null;

            let btnClass =
              'w-full rounded-xl border-2 p-2.5 sm:p-3 text-sm font-medium transition-all text-center relative';

            if (answered) {
              const correctValue = question.pairs?.find((p) => p.key === key)?.value;
              const userValue = matchedPairs[key];
              const isPairCorrect = userValue === correctValue;
              if (isPairCorrect) {
                btnClass += ' border-sky-600 bg-sky-50 text-sky-800';
              } else {
                btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
              }
            } else if (isMatched && color) {
              btnClass += ` ${color.border} ${color.bg} ${color.text}`;
            } else if (isSelected) {
              btnClass += ' border-sky-600 bg-sky-100 text-sky-800 ring-2 ring-sky-300';
            } else {
              btnClass +=
                ' border-sky-200 bg-white text-foreground hover:border-sky-400 hover:bg-sky-50/50 cursor-pointer';
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
                {/* Numbered badge */}
                <span className={`absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ${
                  answered
                    ? matchedPairs[key] === question.pairs?.find((p) => p.key === key)?.value
                      ? 'bg-sky-600'
                      : 'bg-rose-500'
                    : isMatched && color
                      ? color.badge
                      : 'bg-sky-400'
                }`}>
                  {pairNum}
                </span>
                <span className="block mt-1 leading-relaxed">{key}</span>
                {/* Connection indicator when matched */}
                {!answered && isMatched && color && (
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-full ${color.bg} ${color.border} border px-2 py-0.5 text-[10px] ${color.text}`}>
                    <Link2 className="h-2.5 w-2.5" />
                    {matchedPairs[key]}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemovePair(key); }}
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-rose-200 hover:text-rose-600 transition-colors"
                    >
                      <XCircle className="h-2.5 w-2.5" />
                    </button>
                  </span>
                )}
                {/* Answered: show connection status */}
                {answered && matchedPairs[key] && (
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                    matchedPairs[key] === question.pairs?.find((p) => p.key === key)?.value
                      ? 'bg-sky-200 text-sky-800'
                      : 'bg-rose-200 text-rose-700'
                  }`}>
                    {matchedPairs[key] === question.pairs?.find((p) => p.key === key)?.value
                      ? <CheckCircle2 className="h-2.5 w-2.5" />
                      : <XCircle className="h-2.5 w-2.5" />}
                    {matchedPairs[key]}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        {/* Values column (القائمة ب) */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <div className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            <p className="text-xs font-bold text-teal-700">القائمة ب</p>
          </div>
          {values.map((value) => {
            const isMatched = matchedValuesSet.has(value);
            const isSelected = selectedValue === value;
            const pairNum = getValuePairNumber(value);
            const matchedKey = Object.entries(matchedPairs).find(([, v]) => v === value)?.[0];
            const color = matchedKey ? getPairColor(matchedKey) : null;

            let btnClass =
              'w-full rounded-xl border-2 p-2.5 sm:p-3 text-sm font-medium transition-all text-center relative';

            if (answered) {
              const correctKey = question.pairs?.find((p) => p.value === value)?.key;
              const userKey = Object.entries(matchedPairs).find(
                ([, v]) => v === value
              )?.[0];
              const isPairCorrect = userKey === correctKey;
              if (isPairCorrect) {
                btnClass += ' border-sky-600 bg-sky-50 text-sky-800';
              } else {
                btnClass += ' border-rose-500 bg-rose-50 text-rose-700';
              }
            } else if (isMatched && color) {
              btnClass += ` ${color.border} ${color.bg} ${color.text}`;
            } else if (isSelected) {
              btnClass += ' border-teal-500 bg-teal-100 text-teal-700 ring-2 ring-teal-300';
            } else {
              btnClass +=
                ' border-teal-200 bg-white text-foreground hover:border-teal-400 hover:bg-teal-50/50 cursor-pointer';
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
                {/* Numbered badge showing which pair it's connected to */}
                {pairNum !== null && (
                  <span className={`absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ${
                    answered
                      ? (() => {
                          const correctKey = question.pairs?.find((p) => p.value === value)?.key;
                          const userKey = Object.entries(matchedPairs).find(([, v]) => v === value)?.[0];
                          return userKey === correctKey ? 'bg-sky-600' : 'bg-rose-500';
                        })()
                      : color
                        ? color.badge
                        : 'bg-teal-400'
                  }`}>
                    {pairNum}
                  </span>
                )}
                <span className="block leading-relaxed">{value}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Matched pairs summary display */}
      {Object.keys(matchedPairs).length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">التوصيلات ({Object.keys(matchedPairs).length}/{question.pairs?.length || 0})</p>
            {!answered && allPairsMatched && (
              <span className="text-[10px] font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">جميع العناصر متصلة ✓</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(matchedPairs).map(([key, value], idx) => {
              const color = PAIR_COLORS[idx % PAIR_COLORS.length];
              const pairNum = keys.indexOf(key) + 1;
              const isPairCorrect = answered && question.pairs?.find((p) => p.key === key)?.value === value;
              const isPairWrong = answered && question.pairs?.find((p) => p.key === key)?.value !== value;

              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                    isPairCorrect
                      ? 'bg-sky-50 border-sky-300 text-sky-800'
                      : isPairWrong
                        ? 'bg-rose-50 border-rose-300 text-rose-700'
                        : `${color.bg} ${color.border} ${color.text}`
                  }`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ${
                    isPairCorrect ? 'bg-sky-600' : isPairWrong ? 'bg-rose-500' : color.badge
                  }`}>
                    {pairNum}
                  </span>
                  <span className="truncate max-w-[80px]">{key}</span>
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[80px]">{value}</span>
                  {!answered && (
                    <button
                      onClick={() => onRemovePair(key)}
                      className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-rose-200 hover:text-rose-700 transition-colors"
                    >
                      <XCircle className="h-3 w-3" />
                    </button>
                  )}
                  {answered && (isPairCorrect ? <CheckCircle2 className="h-3 w-3 text-sky-600" /> : isPairWrong ? <XCircle className="h-3 w-3 text-rose-500" /> : null)}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Check button - more prominent */}
      {!answered && (
        <Button
          onClick={onCheck}
          disabled={!allPairsMatched}
          className="gap-2 bg-sky-700 text-white hover:bg-sky-800 w-full sm:w-auto px-6 py-2.5 text-sm font-semibold"
        >
          <ArrowLeftRight className="h-4 w-4" />
          {allPairsMatched ? 'تحقق من التوصيل' : `توصيل (${Object.keys(matchedPairs).length}/${question.pairs?.length || 0})`}
        </Button>
      )}

      {/* Show correct pairs on wrong answer - improved */}
      {answered && !isCorrect && question.pairs && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-sky-200 bg-sky-50 p-4"
        >
          <p className="text-xs font-bold text-sky-800 mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            التوصيل الصحيح:
          </p>
          <div className="space-y-2">
            {question.pairs.map((pair, idx) => (
              <div
                key={pair.key}
                className="flex items-center gap-2 rounded-lg bg-white border border-sky-200 px-3 py-2"
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${PAIR_COLORS[idx % PAIR_COLORS.length].badge}`}>
                  {idx + 1}
                </span>
                <span className="text-xs font-medium text-foreground">{pair.key}</span>
                <Link2 className="h-3 w-3 text-sky-600 shrink-0" />
                <span className="text-xs font-medium text-sky-800">{pair.value}</span>
              </div>
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
              ? 'bg-sky-100 text-sky-800'
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
            <Badge variant="outline" className="text-[10px] border-sky-300 bg-sky-50 text-sky-800">
              {typeLabels[question.type]}
            </Badge>
          </div>
          <p className="text-sm font-medium text-foreground">{question.question}</p>

          {/* Show answer details based on type */}
          {question.type === 'matching' && question.pairs ? (
            <div className="space-y-3">
              {/* User's matching */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">إجابتك:</p>
                <div className="space-y-1.5">
                  {Object.entries((userAnswer?.answer as Record<string, string>) || {}).map(
                    ([k, v], idx) => {
                      const isPairCorrect = question.pairs?.find(p => p.key === k)?.value === v;
                      return (
                        <div key={k} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                          isPairCorrect ? 'bg-sky-50 border border-sky-200' : 'bg-rose-50 border border-rose-200'
                        }`}>
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ${
                            isPairCorrect ? 'bg-sky-600' : 'bg-rose-500'
                          }`}>
                            {idx + 1}
                          </span>
                          <span className="font-medium">{k}</span>
                          <Link2 className="h-3 w-3 shrink-0" />
                          <span className={isPairCorrect ? 'text-sky-800 font-medium' : 'text-rose-700 font-medium'}>{v}</span>
                          {isPairCorrect ? <CheckCircle2 className="h-3 w-3 text-sky-600 ms-auto" /> : <XCircle className="h-3 w-3 text-rose-500 ms-auto" />}
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
              {/* Correct matching */}
              {!userAnswer?.isCorrect && (
                <div>
                  <p className="text-xs font-medium text-sky-800 mb-1.5">التوصيل الصحيح:</p>
                  <div className="space-y-1.5">
                    {question.pairs.map((p, idx) => (
                      <div key={p.key} className="flex items-center gap-2 rounded-lg bg-white border border-sky-200 px-2.5 py-1.5 text-xs">
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ${PAIR_COLORS[idx % PAIR_COLORS.length].badge}`}>
                          {idx + 1}
                        </span>
                        <span className="font-medium">{p.key}</span>
                        <Link2 className="h-3 w-3 text-sky-600 shrink-0" />
                        <span className="text-sky-800 font-medium">{p.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                إجابتك: <span className="font-medium">{String(userAnswer?.answer || '—')}</span>
              </p>
              {question.correctAnswer && (
                <p className="text-xs text-sky-800">
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
                    const answerStr = question.type === 'matching'
                      ? JSON.stringify(userAnswer.answer)
                      : String(userAnswer.answer || '');

                    // Build correctAnswer — for matching, derive from pairs
                    let correctAnswerStr = question.correctAnswer || '';
                    if (question.type === 'matching' && question.pairs && question.pairs.length > 0) {
                      correctAnswerStr = question.pairs
                        .map(p => `${p.key} → ${p.value}`)
                        .join('، ');
                    }

                    // Use getCachedAuthHeaders for reliable mobile auth + retry with backoff
                    let res: Response | null = null;
                    let lastError: string | null = null;
                    for (let attempt = 0; attempt < 3; attempt++) {
                      try {
                        const headers = await getCachedAuthHeaders();
                        res = await fetch('/api/gemini/explain', {
                          method: 'POST',
                          headers,
                          body: JSON.stringify({
                            question: question.question,
                            correctAnswer: correctAnswerStr,
                            studentAnswer: answerStr,
                            questionType: question.type,
                          }),
                        });
                        if (res.ok || res.status === 400) break;
                        if (res.status === 429) {
                          const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10) * 1000;
                          lastError = 'طلبات كثيرة، جاري إعادة المحاولة...';
                          if (attempt < 2) await new Promise(r => setTimeout(r, Math.min(retryAfter, 5000 * (attempt + 1))));
                          continue;
                        }
                        break;
                      } catch (fetchErr) {
                        lastError = 'خطأ في الاتصال، جاري إعادة المحاولة...';
                        if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                        continue;
                      }
                    }

                    if (!res) {
                      toast.error(lastError || 'فشل الاتصال بالخادم');
                      return;
                    }

                    const data = await res.json();
                    if (data.success && data.data?.explanation) {
                      setExplanation(data.data.explanation);
                    } else if (res.status === 429) {
                      toast.error('طلبات كثيرة جداً. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى');
                    } else {
                      toast.error(data.error || 'فشل الحصول على الشرح');
                    }
                  } catch {
                    toast.error('حدث خطأ أثناء الحصول على الشرح');
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
