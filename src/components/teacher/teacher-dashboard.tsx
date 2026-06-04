'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// recharts is imported at top level for now — consider lazy-loading the analytics tab component
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import {
  Users,
  ClipboardList,
  TrendingUp,
  Award,
  BookOpen,
  FolderOpen,
  Copy,
  Search,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  RotateCcw,
  Mail,
  AlertTriangle,
  LayoutGrid,
  List,
  CheckCircle2,
  XCircle,
  UserPlus,
  Trash2,
  Sparkles,
  Link2,
  PenLine,
  ArrowLeftRight,
  ListChecks,
  BarChart3,
  Activity,
  Clock,
  Zap,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { computeAllMetrics, calculatePercentile, getPerformanceLevelConfig, type PerformanceLevel, type StudentPerformanceMetrics } from '@/lib/performance-calculator';
import { useLocaleStore } from '@/i18n/locale-store';
import { Badge } from '@/components/ui/badge';
import { getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import AppSidebar from '@/components/shared/app-sidebar';
import AppHeader from '@/components/shared/app-header';
import MobileBottomNav from '@/components/shared/mobile-bottom-nav';
import SettingsSection from '@/components/shared/settings-section';
import ChatSection from '@/components/shared/chat-section';
import StatCard from '@/components/shared/stat-card';
import SubjectsSection from '@/components/shared/subjects-section';
import PersonalFilesSection from '@/components/shared/personal-files-section';
import NotificationsSection from '@/components/shared/notifications-section';
import AllVideosSection from '@/components/shared/all-videos-section';
import TodoSection from '@/components/shared/todo-section';
import CalendarSection from '@/components/shared/calendar-section';
import CoursePage from '@/components/course/course-page';
import TeacherSummariesSection from '@/components/teacher/teacher-summaries-section';
import TeacherStudentTrackingSection from '@/components/teacher/teacher-student-tracking-section';
import QuestionBankSection from '@/components/teacher/question-bank-section';
import ReportsSection from '@/components/reports/reports-section';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';
import { useAnnouncementBannerStore } from '@/stores/announcement-banner-store';
import { toast } from 'sonner';
import type { UserProfile, Quiz, QuizQuestion, Score, Subject, TeacherSection, UserAnswer } from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface TeacherDashboardProps {
  profile: UserProfile;
  onSignOut: () => void;
}

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

const cardHover = {
  whileHover: { scale: 1.02, y: -2 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function scorePercentage(score: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((score / total) * 100);
}

function pctColorClass(pct: number): string {
  if (pct >= 90) return 'text-teal-700 dark:text-teal-500 bg-teal-100 dark:bg-teal-800/40';
  if (pct >= 75) return 'text-sky-700 dark:text-sky-400 bg-sky-100 dark:bg-sky-800/40';
  if (pct >= 60) return 'text-amber-700 dark:text-amber-500 bg-amber-100 dark:bg-amber-800/40';
  return 'text-rose-700 dark:text-rose-500 bg-rose-100 dark:bg-rose-800/40';
}

// Pie chart colors
const PIE_COLORS = ['#0284c7', '#0d9488', '#f59e0b', '#ef4444'];

function questionTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case 'mcq': return t('quiz.typeMcq');
    case 'boolean': return t('quiz.typeBoolean');
    case 'completion': return t('quiz.typeCompletion');
    case 'matching': return t('quiz.typeMatching');
    default: return type;
  }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function TeacherDashboard({ profile, onSignOut }: TeacherDashboardProps) {
  // ─── i18n ───
  const { t, direction } = useTranslations();
  const locale = useLocaleStore((s) => s.locale);

  // ─── Stores ───
  const { teacherSection: storedTeacherSection, setTeacherSection: storeSetTeacherSection, selectedSubjectId, setSelectedSubjectId, sidebarOpen, setSidebarOpen } = useAppStore();
  const { updateProfile: authUpdateProfile, signOut: authSignOut } = useAuthStore();

  // ─── Announcement banner height (for dynamic margin below header) ───
  const bannerHeight = useAnnouncementBannerStore((s) => s.bannerHeight);

  // ─── Local active section synced with store ───
  const [activeSection, setActiveSection] = useState<TeacherSection>(storedTeacherSection || 'dashboard');

  // Keep local state in sync when store changes (e.g. notification navigation)
  useEffect(() => {
    if (storedTeacherSection && storedTeacherSection !== activeSection) {
      setActiveSection(storedTeacherSection);
    }
  }, [storedTeacherSection, activeSection]);

  // When navigating away from subjects, clear selectedSubjectId
  // Also check storedTeacherSection to avoid race condition (see student-dashboard.tsx for details)
  useEffect(() => {
    if (activeSection !== 'subjects' && storedTeacherSection !== 'subjects' && selectedSubjectId) {
      setSelectedSubjectId(null);
    }
  }, [activeSection, storedTeacherSection, selectedSubjectId, setSelectedSubjectId]);

  // ─── Data state ───
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [teacherSubmissions, setTeacherSubmissions] = useState<{ id: string; assignment_id: string; student_id: string; score: number | null; status: string; submitted_at: string }[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<{ id: string; max_score: number; subject_id: string | null; due_date?: string }[]>([]);
  const [teacherAttendanceSessions, setTeacherAttendanceSessions] = useState<{ id: string; subject_id: string }[]>([]);
  const [teacherAttendanceRecords, setTeacherAttendanceRecords] = useState<{ id: string; session_id: string; student_id: string; attendance_status?: 'present' | 'late' | 'partial' | 'absent' }[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // ─── Students section ───
  const [studentSearch, setStudentSearch] = useState('');
  const [studentViewMode, setStudentViewMode] = useState<'grid' | 'table'>('grid');

  const [selectedStudent, setSelectedStudent] = useState<UserProfile | null>(null);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [resettingStudent, setResettingStudent] = useState(false);

  // ─── Quiz answers review state ───
  const [viewingScore, setViewingScore] = useState<Score | null>(null);
  const [viewingQuiz, setViewingQuiz] = useState<Quiz | null>(null);
  const [aiGradingIdx, setAiGradingIdx] = useState<number | null>(null);
  const [aiGradingResults, setAiGradingResults] = useState<Record<number, { isCorrect: boolean; reasoning?: string }>>({});

  // ─── Pending link requests ───
  const [pendingStudents, setPendingStudents] = useState<UserProfile[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [confirmAcceptAllOpen, setConfirmAcceptAllOpen] = useState(false);
  const [confirmRejectAllOpen, setConfirmRejectAllOpen] = useState(false);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [pendingPanelOpen, setPendingPanelOpen] = useState(false);

  // ─── Send link request to student ───
  const [sendRequestOpen, setSendRequestOpen] = useState(false);
  const [studentEmailInput, setStudentEmailInput] = useState('');
  const [studentPreview, setStudentPreview] = useState<UserProfile | null>(null);
  const [searchingStudent, setSearchingStudent] = useState(false);
  const [sendingRequest, setSendingRequest] = useState(false);

  // ─── Teacher subjects ───
  const [teacherSubjects, setTeacherSubjects] = useState<Subject[]>([]);
  const [teacherFilesCount, setTeacherFilesCount] = useState(0);

  // -------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------
  const fetchStudents = useCallback(async () => {
    // Fetch all student links with status if available
    const { data: allLinks, error: linksError } = await supabase
      .from('teacher_student_links')
      .select('student_id, status')
      .eq('teacher_id', profile.id);

    if (linksError) {
      console.error('Error fetching student links:', linksError);
      return;
    }

    // Check if status column exists in the results
    const hasStatusColumn = allLinks && allLinks.length > 0 && 'status' in allLinks[0];

    if (hasStatusColumn) {
      // New schema: separate by status
      const approvedIds = allLinks.filter((l) => l.status === 'approved').map((l) => l.student_id);
      const pendingIds = allLinks.filter((l) => l.status === 'pending').map((l) => l.student_id);

      // Fetch all student profiles through server-side API (bypasses RLS)
      const allIds = [...approvedIds, ...pendingIds];
      if (allIds.length > 0) {
        try {
          const batchHeaders = await getCachedAuthHeaders();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: batchHeaders,
            body: JSON.stringify({ userIds: allIds }),
          });
          if (res.ok) {
            const { users } = await res.json();
            const userMap = new Map((users as UserProfile[]).map(u => [u.id, u]));
            setStudents(approvedIds.map(id => userMap.get(id)).filter(Boolean) as UserProfile[]);
            setPendingStudents(pendingIds.map(id => userMap.get(id)).filter(Boolean) as UserProfile[]);
          }
        } catch {
          setStudents([]);
          setPendingStudents([]);
        }
      } else {
        setStudents([]);
        setPendingStudents([]);
      }
    } else {
      // Old schema: no status column, treat all as approved
      if (allLinks && allLinks.length > 0) {
        const studentIds = allLinks.map((l) => l.student_id);
        try {
          const batchHeaders = await getCachedAuthHeaders();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: batchHeaders,
            body: JSON.stringify({ userIds: studentIds }),
          });
          if (res.ok) {
            const { users } = await res.json();
            setStudents((users as UserProfile[]) || []);
          }
        } catch {
          setStudents([]);
        }
      } else {
        setStudents([]);
      }
      setPendingStudents([]);
    }
  }, [profile.id]);

  // Refresh students data when navigating to students section
  // This ensures pending link requests are always up-to-date
  useEffect(() => {
    if (activeSection === 'students') {
      fetchStudents();
    }
  }, [activeSection, fetchStudents]);

  const fetchQuizzes = useCallback(async () => {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching quizzes:', error);
    } else {
      setQuizzes((data as Quiz[]) || []);
    }
  }, [profile.id]);

  const fetchScores = useCallback(async () => {
    const { data, error } = await supabase
      .from('scores')
      .select('*')
      .eq('teacher_id', profile.id)
      .order('completed_at', { ascending: false });

    if (error) {
      console.error('Error fetching scores:', error);
    } else {
      setScores((data as Score[]) || []);
    }
  }, [profile.id]);

  const fetchTeacherSubjects = useCallback(async () => {
    // Fetch owned subjects
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('teacher_id', profile.id)
      .order('name');
    let ownedSubjects: Subject[] = [];
    if (!error && data) {
      ownedSubjects = (data as Subject[]).map(s => ({ ...s, is_co_teacher: false }));
    }

    // Fetch co-taught subjects
    let coTaughtSubjects: Subject[] = [];
    try {
      const { data: coTeacherEntries, error: coTeacherError } = await supabase
        .from('subject_teachers')
        .select('subject_id, role, subjects(*)')
        .eq('teacher_id', profile.id)
        .eq('role', 'co_teacher');

      if (!coTeacherError && coTeacherEntries) {
        (coTeacherEntries as Record<string, unknown>[]).forEach((entry) => {
          const subject = entry.subjects as Subject | null;
          if (subject && !ownedSubjects.find(s => s.id === subject.id)) {
            coTaughtSubjects.push({ ...subject, is_co_teacher: true });
          }
        });
      }
    } catch {
      // subject_teachers table may not exist yet — ignore
    }

    setTeacherSubjects([...ownedSubjects, ...coTaughtSubjects]);
  }, [profile.id]);

  const fetchTeacherFilesCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('user_files')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id);
    if (!error && count !== null) {
      setTeacherFilesCount(count);
    }
  }, [profile.id]);

  const fetchTeacherSubmissionsAndAssignments = useCallback(async () => {
    // Fetch assignments created by this teacher
    const { data: assignData, error: assignErr } = await supabase
      .from('assignments')
      .select('id, max_score, subject_id, due_date')
      .eq('teacher_id', profile.id);
    if (!assignErr && assignData) {
      setTeacherAssignments(assignData as { id: string; max_score: number; subject_id: string | null; due_date?: string }[]);
    }

    // Fetch graded submissions for this teacher's assignments
    const assignmentIds = (assignData as { id: string }[] | null)?.map(a => a.id) || [];
    if (assignmentIds.length > 0) {
      const { data: subData, error: subErr } = await supabase
        .from('submissions')
        .select('id, assignment_id, student_id, score, status, submitted_at')
        .in('assignment_id', assignmentIds)
        .in('status', ['graded', 'submitted']);
      if (!subErr && subData) {
        setTeacherSubmissions(subData as { id: string; assignment_id: string; student_id: string; score: number | null; status: string; submitted_at: string }[]);
      }
    }
  }, [profile.id]);

  const fetchTeacherAttendance = useCallback(async () => {
    // Fetch attendance sessions for this teacher's subjects
    const { data: sessionData, error: sessionErr } = await supabase
      .from('attendance_sessions')
      .select('id, subject_id')
      .eq('teacher_id', profile.id);
    if (!sessionErr && sessionData) {
      setTeacherAttendanceSessions(sessionData as { id: string; subject_id: string }[]);

      // Fetch attendance records for those sessions
      const sessionIds = (sessionData as { id: string }[]).map(s => s.id);
      if (sessionIds.length > 0) {
        const { data: recData, error: recErr } = await supabase
          .from('attendance_records')
          .select('id, session_id, student_id, attendance_status')
          .in('session_id', sessionIds);
        if (!recErr && recData) {
          setTeacherAttendanceRecords(recData as { id: string; session_id: string; student_id: string; attendance_status?: 'present' | 'late' | 'partial' | 'absent' }[]);
        }
      }
    }
  }, [profile.id]);

  const fetchAllData = useCallback(async (silent = false) => {
    if (!silent) setLoadingData(true);

    // Start all fetches in parallel but don't await them all before showing UI
    const fetchPromises = [
      fetchStudents(),
      fetchQuizzes(),
      fetchScores(),
      fetchTeacherSubjects(),
      fetchTeacherFilesCount(),
      fetchTeacherSubmissionsAndAssignments(),
      fetchTeacherAttendance(),
    ];

    // Show the dashboard after 3 seconds max, even if some fetches are still running
    const loadingTimeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn('[TeacherDashboard] Progressive loading timeout (3s) — showing available data');
        resolve();
      }, 3000)
    );

    // Wait for either all fetches OR the 3-second timeout
    await Promise.race([
      Promise.allSettled(fetchPromises),
      loadingTimeout,
    ]);

    if (!silent) setLoadingData(false);

    // Continue any still-pending fetches in the background
    Promise.allSettled(fetchPromises).catch(() => {});
  }, [fetchStudents, fetchQuizzes, fetchScores, fetchTeacherSubjects, fetchTeacherFilesCount, fetchTeacherSubmissionsAndAssignments, fetchTeacherAttendance]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // ─── Refresh data when navigating back to the dashboard section ───
  // The initial fetchAllData only runs on mount. When the user navigates
  // away (e.g., to "Subjects") and comes back to "dashboard", the data
  // is stale. This effect triggers a lightweight refresh on section change.
  useEffect(() => {
    if (activeSection === 'dashboard') {
      fetchQuizzes();
      fetchScores();
      fetchTeacherSubjects();
      fetchTeacherSubmissionsAndAssignments();
      fetchTeacherAttendance();
      fetchTeacherFilesCount();
    }
  }, [activeSection, fetchQuizzes, fetchScores, fetchTeacherSubjects, fetchTeacherSubmissionsAndAssignments, fetchTeacherAttendance, fetchTeacherFilesCount]);

  // ─── Auth re-hydration for mobile (fix: no INITIAL_SESSION handling) ───
  useEffect(() => {
    let cancelled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        console.log('[TeacherDashboard] Session ready (event:', event, '), re-fetching data (silent)...');
        fetchAllData(true); // silent — don't show loading spinner
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchAllData]);

  // ─── Note: Visibility change handler removed ───
  // Realtime subscriptions now handle instant state updates automatically.
  // No need to refresh all data when returning to the tab.
  // Fallback polling below catches any missed events if Realtime disconnects.

  // ─── Fallback polling for mobile (fix: Realtime disconnect on mobile) ───
  useEffect(() => {
    const interval = setInterval(() => {
      // Silent refresh — only poll for data, don't show loading spinner
      fetchStudents();
      fetchQuizzes();
      fetchScores();
      fetchTeacherSubjects();
      fetchTeacherSubmissionsAndAssignments();
      fetchTeacherAttendance();
      fetchTeacherFilesCount();
    }, 120000); // 2 minutes
    return () => clearInterval(interval);
  }, [fetchStudents, fetchQuizzes, fetchScores, fetchTeacherSubjects, fetchTeacherSubmissionsAndAssignments, fetchTeacherAttendance, fetchTeacherFilesCount]);

  // ─── Loading timeout safety net ───
  // If loading takes too long (slow session hydration on mobile/PWA),
  // stop showing infinite loading spinner and show content with available data.
  // Reduced from 15s to 8s — the progressive loading in fetchAllData already
  // shows content after 3s, so this is just a hard safety limit.
  useEffect(() => {
    if (!loadingData) return;
    const timeout = setTimeout(() => {
      console.warn('[TeacherDashboard] Loading timeout (8s) — showing available data');
      setLoadingData(false);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [loadingData]);

  // -------------------------------------------------------
  // Realtime subscriptions
  // -------------------------------------------------------
  useEffect(() => {
    const linksChannel = supabase
      .channel('teacher-links-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teacher_student_links', filter: `teacher_id=eq.${profile.id}` },
        () => { fetchStudents(); }
      )
      .subscribe();

    const quizzesChannel = supabase
      .channel('teacher-quizzes-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quizzes', filter: `user_id=eq.${profile.id}` },
        () => { fetchQuizzes(); }
      )
      .subscribe();

    const scoresChannel = supabase
      .channel('teacher-scores-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores', filter: `teacher_id=eq.${profile.id}` },
        () => { fetchScores(); }
      )
      .subscribe();

    // ─── Note: subjects Realtime is handled by SubjectsSection component (surgical updates) ───

    // ─── Realtime: assignments & submissions for instant CRUD updates ───
    const assignmentsChannel = supabase
      .channel('teacher-assignments-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments', filter: `teacher_id=eq.${profile.id}` },
        () => { fetchTeacherSubmissionsAndAssignments(); }
      )
      .subscribe();

    const submissionsChannel = supabase
      .channel('teacher-submissions-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'submissions' },
        () => { fetchTeacherSubmissionsAndAssignments(); }
      )
      .subscribe();

    // ─── Realtime: attendance sessions for live attendance updates ───
    const attendanceChannel = supabase
      .channel('teacher-attendance-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_sessions' },
        () => { fetchTeacherAttendance(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(linksChannel);
      supabase.removeChannel(quizzesChannel);
      supabase.removeChannel(scoresChannel);
      supabase.removeChannel(assignmentsChannel);
      supabase.removeChannel(submissionsChannel);
      supabase.removeChannel(attendanceChannel);
    };
  }, [profile.id, fetchStudents, fetchQuizzes, fetchScores, fetchTeacherSubjects, fetchTeacherSubmissionsAndAssignments, fetchTeacherAttendance]);

  // -------------------------------------------------------
  // Section change handler
  // -------------------------------------------------------
  const handleSectionChange = (section: string) => {
    setActiveSection(section as TeacherSection);
    storeSetTeacherSection(section as TeacherSection);
  };

  // -------------------------------------------------------
  // Computed values
  // -------------------------------------------------------
  // ─── Pre-computed student metrics (single computation) ───
  // Computes ALL student metrics ONCE and reuses for:
  // 1. avgPerformance (dashboard overview)
  // 2. handleExportSummaries (Excel export)
  // This eliminates the previous triple computeAllMetrics() call.
  const allStudentMetrics = useMemo(() => {
    return students.map(student => ({
      student,
      metrics: computeAllMetrics({
        scores: scores.map(s => ({
          score: s.score,
          total: s.total,
          completed_at: s.completed_at,
          student_id: s.student_id,
        })),
        attendanceSessions: teacherAttendanceSessions.map(s => ({ id: s.id })),
        attendanceRecords: teacherAttendanceRecords.map(r => ({
          session_id: r.session_id,
          student_id: r.student_id,
          attendance_status: r.attendance_status,
        })),
        submissions: teacherSubmissions.map(s => ({
          assignment_id: s.assignment_id,
          student_id: s.student_id,
          score: s.score,
          status: s.status,
          submitted_at: s.submitted_at || new Date().toISOString(),
        })),
        assignments: teacherAssignments.map(a => ({
          id: a.id,
          max_score: a.max_score,
          due_date: a.due_date,
        })),
        studentId: student.id,
      }),
    }));
  }, [students, scores, teacherAttendanceSessions, teacherAttendanceRecords, teacherSubmissions, teacherAssignments]);

  // Derived: average performance (from single computation above)
  const avgPerformance = useMemo(() => {
    if (allStudentMetrics.length === 0) return 0;
    const total = allStudentMetrics.reduce((sum, { metrics }) => sum + metrics.overallPerformance, 0);
    return Math.round(total / allStudentMetrics.length);
  }, [allStudentMetrics]);

  // Derived: aggregate stats for dashboard overview (all students combined)
  const aggregateStats = useMemo(() => {
    if (allStudentMetrics.length === 0) {
      return { avgAttendance: 0, avgEfficiency: 0, avgDiscipline: 0, atRiskCount: 0, advancedCount: 0, improvingCount: 0, decliningCount: 0, performanceDistribution: { excellent: 0, veryGood: 0, good: 0, acceptable: 0, weak: 0 } };
    }
    const avgAttendance = Math.round(allStudentMetrics.reduce((sum, { metrics }) => sum + metrics.attendanceScore, 0) / allStudentMetrics.length);
    const avgEfficiency = Math.round(allStudentMetrics.reduce((sum, { metrics }) => sum + metrics.efficiency, 0) / allStudentMetrics.length);
    const avgDiscipline = Math.round(allStudentMetrics.reduce((sum, { metrics }) => sum + metrics.disciplineScore, 0) / allStudentMetrics.length);
    const atRiskCount = allStudentMetrics.filter(({ metrics }) => metrics.riskLevel === 'atRisk' || metrics.riskLevel === 'concern').length;
    const advancedCount = allStudentMetrics.filter(({ metrics }) => metrics.overallPerformance >= 80).length;
    const improvingCount = allStudentMetrics.filter(({ metrics }) => metrics.growthTrend === 'improving').length;
    const decliningCount = allStudentMetrics.filter(({ metrics }) => metrics.growthTrend === 'declining').length;
    const performanceDistribution = {
      excellent: allStudentMetrics.filter(({ metrics }) => metrics.performanceLevel === 'excellent').length,
      veryGood: allStudentMetrics.filter(({ metrics }) => metrics.performanceLevel === 'veryGood').length,
      good: allStudentMetrics.filter(({ metrics }) => metrics.performanceLevel === 'good').length,
      acceptable: allStudentMetrics.filter(({ metrics }) => metrics.performanceLevel === 'acceptable').length,
      weak: allStudentMetrics.filter(({ metrics }) => metrics.performanceLevel === 'weak').length,
    };
    return { avgAttendance, avgEfficiency, avgDiscipline, atRiskCount, advancedCount, improvingCount, decliningCount, performanceDistribution };
  }, [allStudentMetrics]);

  // Derived: Monthly trend data for performance overview area chart
  const monthlyTrendData = useMemo(() => {
    if (scores.length === 0) return [];

    // Group scores by month
    const byMonth = new Map<string, { totalPct: number; count: number; attendanceSum: number; attCount: number }>();

    scores.forEach(s => {
      try {
        const date = new Date(s.completed_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const entry = byMonth.get(key) || { totalPct: 0, count: 0, attendanceSum: 0, attCount: 0 };
        if (s.total > 0) {
          entry.totalPct += (s.score / s.total) * 100;
          entry.count++;
        }
        byMonth.set(key, entry);
      } catch { /* skip invalid dates */ }
    });

    // Add attendance per month
    teacherAttendanceRecords.forEach(r => {
      const session = teacherAttendanceSessions.find(s => s.id === r.session_id);
      if (!session) return;
      // Use a simplified month from session id (fallback to current month)
      const key = (() => {
        // Try to extract date from session - sessions don't have dates, use current data
        return new Date().toISOString().slice(0, 7);
      })();
      const entry = byMonth.get(key) || { totalPct: 0, count: 0, attendanceSum: 0, attCount: 0 };
      const statusVal = r.attendance_status === 'present' ? 100 : r.attendance_status === 'late' ? 75 : r.attendance_status === 'partial' ? 50 : 0;
      entry.attendanceSum += statusVal;
      entry.attCount++;
      byMonth.set(key, entry);
    });

    // Build chart data sorted by month
    const months = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));

    // Take last 12 months max
    const recentMonths = months.slice(-12);

    // Compute overall averages for efficiency & discipline (flat reference lines)
    const avgEff = allStudentMetrics.length > 0
      ? Math.round(allStudentMetrics.reduce((sum, { metrics }) => sum + metrics.efficiency, 0) / allStudentMetrics.length)
      : 0;
    const avgDisc = allStudentMetrics.length > 0
      ? Math.round(allStudentMetrics.reduce((sum, { metrics }) => sum + metrics.disciplineScore, 0) / allStudentMetrics.length)
      : 0;

    return recentMonths.map(([month, data]) => ({
      month,
      performance: data.count > 0 ? Math.round(data.totalPct / data.count) : 0,
      attendance: data.attCount > 0 ? Math.round(data.attendanceSum / data.attCount) : undefined,
      efficiency: avgEff,
      discipline: avgDisc,
    }));
  }, [scores, teacherAttendanceRecords, teacherAttendanceSessions, allStudentMetrics]);

  // Derived: Pie chart data for student level distribution
  const levelPieData = useMemo(() => {
    if (allStudentMetrics.length === 0) return [];
    return [
      { name: locale === 'ar' ? 'ممتاز' : 'Excellent', value: aggregateStats.performanceDistribution.excellent, color: '#10b981' },
      { name: locale === 'ar' ? 'جيد جداً' : 'Very Good', value: aggregateStats.performanceDistribution.veryGood, color: '#0ea5e9' },
      { name: locale === 'ar' ? 'جيد' : 'Good', value: aggregateStats.performanceDistribution.good, color: '#14b8a6' },
      { name: locale === 'ar' ? 'مقبول' : 'Acceptable', value: aggregateStats.performanceDistribution.acceptable, color: '#f59e0b' },
      { name: locale === 'ar' ? 'ضعيف' : 'Weak', value: aggregateStats.performanceDistribution.weak, color: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [allStudentMetrics, aggregateStats, locale]);

  const filteredStudents = students.filter(
    (s) =>
      s.name.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.email.toLowerCase().includes(studentSearch.toLowerCase())
  );

  const getStudentLastScore = (studentId: string): Score | null => {
    const studentScores = scores.filter((s) => s.student_id === studentId);
    return studentScores.length > 0 ? studentScores[0] : null;
  };

  const getStudentScores = (studentId: string): Score[] => {
    return scores.filter((s) => s.student_id === studentId);
  };

  // -------------------------------------------------------
  // Copy teacher code
  // -------------------------------------------------------
  const handleCopyTeacherCode = () => {
    if (profile.teacher_code) {
      navigator.clipboard.writeText(profile.teacher_code);
      toast.success(t('common.copied'));
    }
  };

  // -------------------------------------------------------
  // Excel export: student summaries
  // -------------------------------------------------------
  const handleExportSummaries = async () => {
    try {
      const XLSX = await import('xlsx');
      toast.info(t('common.loading'));

      const studentIds = students.map((s) => s.id);
      const { data: summaries } = await supabase
        .from('summaries')
        .select('*')
        .in('user_id', studentIds);

      const wb = XLSX.utils.book_new();

      // Reuse pre-computed metrics from allStudentMetrics (no recomputation)
      const allOverallScores = allStudentMetrics.map(({ metrics }) => metrics.overallPerformance);

      // Sheet 1: Student overview with full analytics
      const overviewData = allStudentMetrics.map(({ student: s, metrics }) => {
        const percentile = calculatePercentile(metrics.overallPerformance, allOverallScores);
        const sScores = getStudentScores(s.id);
        const lastScore = sScores[0];
        return {
          [t('teacher.excelStudentName')]: s.name,
          [t('teacher.excelEmail')]: s.email,
          [t('teacher.excelQuizCount')]: sScores.length,
          [t('teacher.excelLastResult')]: lastScore ? `${lastScore.score}/${lastScore.total}` : '—',
          'Exam Performance': metrics.examPerformance.toFixed(1),
          'Attendance Score': metrics.attendanceScore.toFixed(1),
          'Assignment Compliance': metrics.assignmentCompliance.toFixed(1),
          'Assignment Quality': metrics.assignmentQuality.toFixed(1),
          'Overall Performance': metrics.overallPerformance.toFixed(1),
          'Classification': metrics.performanceLevel,
          'Efficiency': metrics.efficiency.toFixed(1),
          'Efficiency Level': metrics.efficiencyLevel,
          'Discipline Score': metrics.disciplineScore.toFixed(1),
          'Growth Index': metrics.growthIndex.toFixed(2),
          'Growth Trend': metrics.growthTrend,
          'Risk Level': metrics.riskLevel,
          'Risk Reasons': metrics.riskReasons.join(', '),
          'Ranking (Percentile)': Math.round(percentile),
        };
      });
      const ws1 = XLSX.utils.json_to_sheet(overviewData);
      XLSX.utils.book_append_sheet(wb, ws1, t('teacher.excelOverviewSheet'));

      // Sheet 2: Detailed scores
      const scoresData = scores.map((s) => ({
        [t('teacher.excelStudentName')]: students.find((st) => st.id === s.student_id)?.name || '—',
        [t('teacher.excelQuizTitle')]: s.quiz_title,
        [t('teacher.excelScore')]: `${s.score}/${s.total}`,
        [t('teacher.excelPercentage')]: `${scorePercentage(s.score, s.total)}%`,
        [t('teacher.excelCompletionDate')]: formatDate(s.completed_at),
      }));
      if (scoresData.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(scoresData);
        XLSX.utils.book_append_sheet(wb, ws2, t('teacher.excelDetailedResults'));
      }

      // Sheet 3: Summaries
      if (summaries && summaries.length > 0) {
        const summariesData = summaries.map((sm: { title: string; user_id: string; created_at: string; summary_content: string }) => ({
          [t('teacher.excelSummaryTitle')]: sm.title,
          [t('teacher.excelStudent')]: students.find((st) => st.id === sm.user_id)?.name || '—',
          [t('teacher.excelCreationDate')]: formatDate(sm.created_at),
          [t('teacher.excelContent')]: sm.summary_content?.slice(0, 200) || '',
        }));
        const ws3 = XLSX.utils.json_to_sheet(summariesData);
        XLSX.utils.book_append_sheet(wb, ws3, t('teacher.excelSummariesSheet'));
      }

      XLSX.writeFile(wb, `${t('export.studentSummaries')}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success(t('common.success'));
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  // -------------------------------------------------------
  // Excel export: all analytics data
  // -------------------------------------------------------
  const handleExportAllData = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Sheet 1: Per-quiz stats
      const quizStats = quizzes.map((q) => {
        const qScores = scores.filter((s) => s.quiz_id === q.id);
        const avg = qScores.length > 0
          ? Math.round(qScores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / qScores.length)
          : 0;
        return {
          [t('teacher.excelQuizTitle')]: q.title,
          [t('teacher.excelQuestionCount')]: q.questions?.length || 0,
          [t('teacher.excelStudentCount')]: qScores.length,
          [t('teacher.excelAvgPerformance')]: `${avg}%`,
          [t('teacher.excelCreationDate')]: formatDate(q.created_at),
        };
      });
      const ws1 = XLSX.utils.json_to_sheet(quizStats);
      XLSX.utils.book_append_sheet(wb, ws1, t('teacher.excelQuizStatsSheet'));

      // Sheet 2: Per-question breakdown
      const questionData: Record<string, string | number>[] = [];
      quizzes.forEach((q) => {
        const qScores = scores.filter((s) => s.quiz_id === q.id);
        q.questions?.forEach((question, idx) => {
          // KEY FIX: match by questionIndex (original order), NOT array position — handles shuffled quizzes
          const correctCount = qScores.filter((s) => s.user_answers?.find((a: { questionIndex: number }) => a.questionIndex === idx)?.isCorrect).length;
          questionData.push({
            [t('teacher.excelQuiz')]: q.title,
            [t('teacher.excelQuestionNumber')]: idx + 1,
            [t('teacher.excelQuestionType')]: questionTypeLabel(question.type, t),
            [t('teacher.excelQuestionText')]: question.question,
            [t('teacher.excelCorrectCount')]: correctCount,
            [t('teacher.excelParticipantCount')]: qScores.length,
            [t('teacher.excelCorrectPct')]: qScores.length > 0 ? `${Math.round((correctCount / qScores.length) * 100)}%` : '—',
          });
        });
      });
      if (questionData.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(questionData);
        XLSX.utils.book_append_sheet(wb, ws2, t('teacher.excelQuestionDetailSheet'));
      }

      // Sheet 3: All scores
      const allScores = scores.map((s) => ({
        [t('teacher.excelStudentName')]: students.find((st) => st.id === s.student_id)?.name || '—',
        [t('teacher.excelQuizTitle')]: s.quiz_title,
        [t('teacher.excelScore')]: `${s.score}/${s.total}`,
        [t('teacher.excelPercentage')]: `${scorePercentage(s.score, s.total)}%`,
        [t('teacher.excelCompletionDate')]: formatDate(s.completed_at),
      }));
      if (allScores.length > 0) {
        const ws3 = XLSX.utils.json_to_sheet(allScores);
        XLSX.utils.book_append_sheet(wb, ws3, t('teacher.excelAllResultsSheet'));
      }

      XLSX.writeFile(wb, `${t('export.comprehensiveReport')}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success(t('common.success'));
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  // -------------------------------------------------------
  // Per-quiz Excel download
  // -------------------------------------------------------
  const handleExportQuizData = async (quiz: Quiz) => {
    try {
      const XLSX = await import('xlsx');
      const qScores = scores.filter((s) => s.quiz_id === quiz.id);
      const wb = XLSX.utils.book_new();

      const data = qScores.map((s) => ({
        [t('teacher.excelStudentName')]: students.find((st) => st.id === s.student_id)?.name || '—',
        [t('teacher.excelScore')]: `${s.score}/${s.total}`,
        [t('teacher.excelPercentage')]: `${scorePercentage(s.score, s.total)}%`,
        [t('teacher.excelCompletionDate')]: formatDate(s.completed_at),
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, quiz.title);
      XLSX.writeFile(wb, `${quiz.title}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success(t('common.success'));
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  // -------------------------------------------------------
  // Reset student scores
  // -------------------------------------------------------
  const handleResetStudent = async (studentId: string) => {
    setResettingStudent(true);
    try {
      const { error } = await supabase
        .from('scores')
        .delete()
        .eq('student_id', studentId)
        .eq('teacher_id', profile.id);

      if (error) {
        toast.error(t('common.unexpectedError'));
      } else {
        toast.success(t('common.success'));
        setStudentDetailOpen(false);
        fetchScores();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setResettingStudent(false);
    }
  };

  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

  const handleApproveStudent = async (studentId: string) => {
    setProcessingRequestId(studentId);
    try {
      const response = await fetch('/api/link-teacher-approve', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ action: 'approve', studentId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.unexpectedError'));
      } else {
        toast.success(data.message || t('common.success'));
        fetchStudents();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setProcessingRequestId(null);
    }
  };

  // -------------------------------------------------------
  // Reject student link request (uses server-side API)
  // -------------------------------------------------------
  const handleRejectStudent = async (studentId: string) => {
    setProcessingRequestId(studentId);
    try {
      const response = await fetch('/api/link-teacher-approve', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ action: 'reject', studentId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.unexpectedError'));
      } else {
        toast.success(data.message || t('common.success'));
        fetchStudents();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setProcessingRequestId(null);
    }
  };

  // -------------------------------------------------------
  // Accept all pending link requests (uses server-side API)
  // -------------------------------------------------------
  const handleAcceptAll = async () => {
    setProcessingBulk(true);
    try {
      const response = await fetch('/api/link-teacher-approve', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ action: 'approveAll' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.unexpectedError'));
      } else {
        toast.success(data.message || t('teacher.toastAcceptAllSuccess'));
        setConfirmAcceptAllOpen(false);
        fetchStudents();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setProcessingBulk(false);
    }
  };

  // -------------------------------------------------------
  // Reject all pending link requests (uses server-side API)
  // -------------------------------------------------------
  const handleRejectAll = async () => {
    setProcessingBulk(true);
    try {
      const response = await fetch('/api/link-teacher-approve', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ action: 'rejectAll' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.unexpectedError'));
      } else {
        toast.success(data.message || t('teacher.toastRejectAllSuccess'));
        setConfirmRejectAllOpen(false);
        fetchStudents();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setProcessingBulk(false);
    }
  };

  // -------------------------------------------------------
  // Search student by email for link request
  // -------------------------------------------------------
  const handleSearchStudent = async () => {
    const email = studentEmailInput.trim().toLowerCase();
    if (!email) {
      toast.error(t('auth.email') + ': ' + t('common.required'));
      return;
    }

    setSearchingStudent(true);
    setStudentPreview(null);

    try {
      const response = await fetch('/api/link-teacher-send', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ studentEmail: email, action: 'search' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.notFound'));
        return;
      }

      setStudentPreview(data.student);
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSearchingStudent(false);
    }
  };

  // -------------------------------------------------------
  // Confirm send link request to student
  // -------------------------------------------------------
  const handleConfirmSendRequest = async () => {
    if (!studentPreview) return;

    setSendingRequest(true);

    try {
      const response = await fetch('/api/link-teacher-send', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ studentEmail: studentEmailInput.trim().toLowerCase() }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.unexpectedError'));
        return;
      }

      toast.success(data.message || t('common.success'));
      setStudentEmailInput('');
      setStudentPreview(null);
      setSendRequestOpen(false);

      if (data.autoApproved) {
        fetchStudents();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSendingRequest(false);
    }
  };

  // -------------------------------------------------------
  // Remove student from linked list (uses server-side API)
  // -------------------------------------------------------
  const handleRemoveStudent = async (studentId: string) => {
    setProcessingRequestId(studentId);
    try {
      const response = await fetch('/api/link-teacher-unlink', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ studentId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.unexpectedError'));
      } else {
        toast.success(t('common.success'));
        setStudentDetailOpen(false);
        setSelectedStudent(null);
        fetchStudents();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setProcessingRequestId(null);
    }
  };

  // -------------------------------------------------------
  // Settings handlers
  // -------------------------------------------------------
  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    return authUpdateProfile(updates);
  };

  const handleDeleteAccount = async () => {
    // Get the current session token for authorization
    const deleteHeaders = await getCachedAuthHeaders();
    if (!deleteHeaders['Authorization']) {
      throw new Error(t('teacher.sessionExpired'));
    }

    // Call the server-side API to delete the account from the database
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: deleteHeaders,
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || t('teacher.deleteAccountFailed'));
    }

    // Sign out after successful deletion
    await authSignOut();
  };

  // -------------------------------------------------------
  // Analytics computed data
  // -------------------------------------------------------
  const barChartData = quizzes.map((q) => {
    const qScores = scores.filter((s) => s.quiz_id === q.id);
    const avg = qScores.length > 0
      ? Math.round(qScores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / qScores.length)
      : 0;
    return {
      name: q.title.length > 15 ? q.title.slice(0, 15) + '...' : q.title,
      avg,
    };
  });

  const pieChartData = (() => {
    const excellent = scores.filter((s) => scorePercentage(s.score, s.total) >= 90).length;
    const veryGood = scores.filter((s) => { const p = scorePercentage(s.score, s.total); return p >= 75 && p < 90; }).length;
    const good = scores.filter((s) => { const p = scorePercentage(s.score, s.total); return p >= 60 && p < 75; }).length;
    const weak = scores.filter((s) => scorePercentage(s.score, s.total) < 60).length;
    return [
      { name: t('teacher.excellent'), value: excellent },
      { name: t('teacher.veryGood'), value: veryGood },
      { name: t('teacher.good'), value: good },
      { name: t('teacher.weak'), value: weak },
    ].filter((d) => d.value > 0);
  })();

  // -------------------------------------------------------
  // Render: Header
  // -------------------------------------------------------
  const renderHeader = () => (
    <motion.div
      variants={itemVariants}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
    >
      <div>
        <h2 className="text-2xl font-bold text-foreground">{t('teacher.welcome', { name: formatNameWithTitle(profile.name, profile.role, profile.title_id, profile.gender, t) })}</h2>
        <p className="text-muted-foreground mt-1">{t('teacher.dashboardLabel')}</p>
      </div>
      {profile.teacher_code && (
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleCopyTeacherCode}
          className="flex items-center gap-1.5 rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-900/15 px-3 py-1.5 text-xs font-medium text-sky-800 dark:text-sky-400 shadow-sm transition-colors hover:bg-sky-100 hover:border-sky-300"
          title={t('teacher.clickToCopy')}
        >
          <Copy className="h-3 w-3" />
          <span>{t('teacher.teacherCodeLabel')}</span>
          <span className="font-mono text-xs tracking-wider">{profile.teacher_code}</span>
        </motion.button>
      )}
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Dashboard Section
  // -------------------------------------------------------
  const renderDashboard = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {renderHeader()}

      {/* Stats row */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="relative">
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label={t('teacher.statTotalStudents')}
            value={students.length}
            color="sky"
          />
          {pendingStudents.length > 0 && (
            <button
              onClick={() => setActiveSection('students')}
              className="absolute -top-2 -start-2 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white shadow-sm hover:bg-amber-600 transition-colors"
            >
              <UserPlus className="h-3 w-3" />
              {pendingStudents.length}
            </button>
          )}
        </div>
        <StatCard
          icon={<FolderOpen className="h-5 w-5" />}
          label={t('teacher.statFiles')}
          value={teacherFilesCount}
          color="teal"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t('teacher.statAvgPerformance')}
          value={`${avgPerformance}%`}
          color="amber"
        />
        <StatCard
          icon={<BookOpen className="h-5 w-5" />}
          label={t('teacher.statSubjects')}
          value={teacherSubjects.length}
          color="rose"
        />
      </motion.div>

      {/* Performance Overview & Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Performance Overview — Compact Stat Bar + Charts (2/3) */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden h-full">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-600 to-teal-600 shadow-sm">
                  <TrendingUp className="h-3.5 w-3.5 text-white" />
                </div>
                {t('teacher.performanceOverview')}
              </h3>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => handleSectionChange('tracking')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-l from-sky-600 to-teal-600 text-white text-xs font-medium shadow-md shadow-sky-600/20 hover:shadow-lg hover:shadow-sky-600/30 transition-shadow"
              >
                <Activity className="h-3.5 w-3.5" />
                {t('teacher.detailedAnalysis')}
                <ChevronLeft className="h-3 w-3" />
              </motion.button>
            </div>
            <div className="p-4 space-y-5">
              {allStudentMetrics.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  {t('teacher.noPerformanceData')}
                </div>
              ) : (
                <>
                  {/* ── Compact Stat Bar ── */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40">
                      <Clock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{aggregateStats.avgAttendance}%</span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-500">{locale === 'ar' ? 'الحضور' : 'Attendance'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-900/40">
                      <Zap className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                      <span className="text-xs font-bold text-teal-700 dark:text-teal-400">{aggregateStats.avgEfficiency}%</span>
                      <span className="text-[10px] text-teal-600 dark:text-teal-500">{locale === 'ar' ? 'الكفاءة' : 'Efficiency'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-900/40">
                      <ShieldCheck className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                      <span className="text-xs font-bold text-violet-700 dark:text-violet-400">{aggregateStats.avgDiscipline}%</span>
                      <span className="text-[10px] text-violet-600 dark:text-violet-500">{locale === 'ar' ? 'الانضباط' : 'Discipline'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40">
                      <TrendingUp className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{avgPerformance}%</span>
                      <span className="text-[10px] text-amber-600 dark:text-amber-500">{locale === 'ar' ? 'الأداء' : 'Performance'}</span>
                    </div>
                  </div>

                  {/* ── Enhanced Multi-Metric Area Chart ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-3.5 w-3.5 text-sky-600" />
                      <p className="text-xs font-medium text-foreground">{t('teacher.performanceTrend')}</p>
                    </div>
                    {monthlyTrendData.length < 2 ? (
                      <div className="py-6 text-center text-muted-foreground text-xs">
                        <BarChart3 className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        {t('teacher.noTrendData')}
                      </div>
                    ) : (
                      <div className="h-[200px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={monthlyTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                            <defs>
                              <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="attGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="effGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="discGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                            <XAxis
                              dataKey="month"
                              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                              tickFormatter={(v: string) => v.slice(5)}
                            />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                fontSize: '11px',
                              }}
                              formatter={((value: unknown, name: unknown) => {
                                const nameMap: Record<string, string> = {
                                  performance: locale === 'ar' ? 'الأداء' : 'Performance',
                                  attendance: locale === 'ar' ? 'الحضور' : 'Attendance',
                                  efficiency: locale === 'ar' ? 'الكفاءة' : 'Efficiency',
                                  discipline: locale === 'ar' ? 'الانضباط' : 'Discipline',
                                };
                                return [`${value}%`, nameMap[name as string] || name];
                              }) as never}
                            />
                            <Area
                              type="monotone"
                              dataKey="performance"
                              stroke="#0ea5e9"
                              strokeWidth={2.5}
                              fill="url(#perfGradient)"
                              dot={{ r: 3, fill: '#0ea5e9', strokeWidth: 0 }}
                              activeDot={{ r: 5, stroke: '#0ea5e9', strokeWidth: 2, fill: '#fff' }}
                              name="performance"
                            />
                            <Area
                              type="monotone"
                              dataKey="attendance"
                              stroke="#10b981"
                              strokeWidth={2}
                              fill="url(#attGradient)"
                              dot={{ r: 2.5, fill: '#10b981', strokeWidth: 0 }}
                              activeDot={{ r: 4, stroke: '#10b981', strokeWidth: 2, fill: '#fff' }}
                              name="attendance"
                            />
                            <Area
                              type="monotone"
                              dataKey="efficiency"
                              stroke="#14b8a6"
                              strokeWidth={1.5}
                              strokeDasharray="6 3"
                              fill="url(#effGradient)"
                              dot={false}
                              activeDot={{ r: 3, stroke: '#14b8a6', strokeWidth: 2, fill: '#fff' }}
                              name="efficiency"
                            />
                            <Area
                              type="monotone"
                              dataKey="discipline"
                              stroke="#8b5cf6"
                              strokeWidth={1.5}
                              strokeDasharray="6 3"
                              fill="url(#discGradient)"
                              dot={false}
                              activeDot={{ r: 3, stroke: '#8b5cf6', strokeWidth: 2, fill: '#fff' }}
                              name="discipline"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {monthlyTrendData.length >= 2 && (
                      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-4 rounded-full bg-sky-500" />
                          <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'الأداء' : 'Performance'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-4 rounded-full bg-emerald-500" />
                          <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'الحضور' : 'Attendance'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-0.5 w-4 border-t-2 border-dashed border-teal-500" />
                          <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'الكفاءة' : 'Efficiency'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="h-0.5 w-4 border-t-2 border-dashed border-violet-500" />
                          <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'الانضباط' : 'Discipline'}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Pie Chart: Student Level Distribution ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Award className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-medium text-foreground">{t('teacher.studentLevelDistribution')}</p>
                    </div>
                    {levelPieData.length === 0 ? (
                      <div className="py-6 text-center text-muted-foreground text-xs">
                        <Award className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        {t('teacher.noPerformanceData')}
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row items-center gap-3">
                        <div className="h-[160px] w-[160px] shrink-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={levelPieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={72}
                                paddingAngle={2}
                                dataKey="value"
                                stroke="none"
                              >
                                {levelPieData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'var(--card)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '8px',
                                  fontSize: '11px',
                                }}
                                formatter={((value: unknown, name: unknown) => [`${value} ${locale === 'ar' ? 'طالب' : 'students'}`, name]) as never}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-1">
                          {levelPieData.map((entry) => {
                            const pct = allStudentMetrics.length > 0 ? Math.round((entry.value / allStudentMetrics.length) * 100) : 0;
                            return (
                              <div key={entry.name} className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                                <span className="text-[11px] text-foreground flex-1">{entry.name}</span>
                                <span className="text-[11px] font-bold text-foreground">{entry.value}</span>
                                <span className="text-[10px] text-muted-foreground">({pct}%)</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {/* Right column: Recent Activity (1/3) — matches Performance Overview height */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden h-full flex flex-col">
            <div className="flex items-center justify-between border-b p-4 shrink-0">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-violet-600" />
                {t('teacher.recentActivity')}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {(() => {
                type TeacherActivityItem = {
                  id: string;
                  type: 'course_created' | 'quiz_created' | 'assignment_created' | 'session_created';
                  title: string;
                  subtitle: string;
                  date: string;
                  icon: React.ReactNode;
                };
                const activities: TeacherActivityItem[] = [];

                // Courses created by teacher
                teacherSubjects.forEach((subject) => {
                  activities.push({
                    id: `subject-${subject.id}`,
                    type: 'course_created',
                    title: subject.name,
                    subtitle: locale === 'ar' ? 'إنشاء مقرر' : 'Course Created',
                    date: subject.created_at,
                    icon: <BookOpen className="h-3.5 w-3.5 text-violet-500" />,
                  });
                });

                // Quizzes created by teacher
                quizzes.forEach((quiz) => {
                  activities.push({
                    id: `quiz-${quiz.id}`,
                    type: 'quiz_created',
                    title: quiz.title,
                    subtitle: locale === 'ar' ? 'إنشاء اختبار' : 'Quiz Created',
                    date: quiz.created_at,
                    icon: <ClipboardList className="h-3.5 w-3.5 text-sky-500" />,
                  });
                });

                // Assignments created by teacher
                teacherAssignments.forEach((assignment) => {
                  const sub = teacherSubjects.find(s => s.id === assignment.subject_id);
                  activities.push({
                    id: `assignment-${assignment.id}`,
                    type: 'assignment_created',
                    title: sub ? sub.name : (locale === 'ar' ? 'مهمة' : 'Assignment'),
                    subtitle: locale === 'ar' ? 'إنشاء مهمة' : 'Assignment Created',
                    date: assignment.due_date || '',
                    icon: <Award className="h-3.5 w-3.5 text-amber-500" />,
                  });
                });

                // Attendance sessions created by teacher
                teacherAttendanceSessions.forEach((session) => {
                  const sub = teacherSubjects.find(s => s.id === session.subject_id);
                  activities.push({
                    id: `session-${session.id}`,
                    type: 'session_created',
                    title: sub ? sub.name : (locale === 'ar' ? 'جلسة حضور' : 'Attendance Session'),
                    subtitle: locale === 'ar' ? 'تسجيل حضور' : 'Attendance Session',
                    date: session.id, // sessions may not have a date field, use id as fallback
                    icon: <CheckCircle2 className="h-3.5 w-3.5 text-teal-500" />,
                  });
                });

                // Sort by date descending
                activities.sort((a, b) => {
                  if (!a.date && !b.date) return 0;
                  if (!a.date) return 1;
                  if (!b.date) return -1;
                  return new Date(b.date).getTime() - new Date(a.date).getTime();
                });

                if (activities.length === 0) {
                  return (
                    <div className="py-12 text-center text-muted-foreground text-sm">
                      <ListChecks className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      {t('teacher.noActivities')}
                    </div>
                  );
                }

                return (
                  <div className="divide-y">
                    {activities.slice(0, 12).map((activity) => (
                      <div key={activity.id} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                        <div className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-muted/50">
                          {activity.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{activity.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{activity.subtitle}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Students Section
  // -------------------------------------------------------
  const renderStudents = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{t('teacher.studentsTitle')}</h2>
          <p className="text-muted-foreground mt-1">{t('teacher.registeredStudents', { count: students.length })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pending Link Requests Button */}
          <button
            onClick={() => setPendingPanelOpen(true)}
            className="relative flex items-center gap-2 rounded-xl border border-amber-200/70 dark:border-amber-900/60 bg-gradient-to-b from-amber-50 dark:from-amber-900/20 to-orange-50/50 px-3.5 py-2 text-sm font-medium text-amber-700 dark:text-amber-500 hover:from-amber-100 hover:to-orange-100/60 shadow-sm shadow-amber-100/30 hover:shadow-md hover:shadow-amber-100/40 transition-all duration-200 active:scale-[0.97]"
          >
            <UserPlus className="h-4 w-4" />
            <span>{t('teacher.linkRequests')}</span>
            {pendingStudents.length > 0 ? (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-amber-300/50">
                {pendingStudents.length}
              </span>
            ) : (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-200/80 px-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-500">
                0
              </span>
            )}
          </button>
          <button
            onClick={() => setSendRequestOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-900/15 px-3 py-2 text-sm font-medium text-sky-800 dark:text-sky-400 hover:bg-sky-100 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            {t('teacher.sendRequestToStudent')}
          </button>
          <div className="relative">
            <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder={t('teacher.searchStudent')}
              className="w-full sm:w-48 rounded-lg border bg-background pe-10 ps-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-colors"
              dir={direction}
            />
          </div>
          {/* View toggle */}
          <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
            <button
              onClick={() => setStudentViewMode('grid')}
              className={`flex items-center justify-center h-8 w-8 rounded-md transition-all ${
                studentViewMode === 'grid'
                  ? 'bg-sky-700 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={t('teacher.gridView')}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setStudentViewMode('table')}
              className={`flex items-center justify-center h-8 w-8 rounded-md transition-all ${
                studentViewMode === 'table'
                  ? 'bg-sky-700 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={t('teacher.tableView')}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={handleExportSummaries}
            className="flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 whitespace-nowrap"
          >
            <Download className="h-4 w-4" />
            {t('teacher.exportSummaries')}
          </button>
        </div>
      </motion.div>

      {/* ============================================================ */}
      {/* Centered Modal for Pending Link Requests (same as subjects)  */}
      {/* ============================================================ */}
      <AnimatePresence>
        {pendingPanelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-0 z-40 flex items-center justify-center p-4"
          >
            {/* Soft warm overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: 'none' as const }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 bg-black/15 backdrop-blur-[3px]"
              onClick={() => setPendingPanelOpen(false)}
            />
            {/* Modal */}
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 20, pointerEvents: 'none' as const }}
              transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="relative w-full max-w-md max-h-[85vh] flex flex-col rounded-3xl border border-border/50 bg-background shadow-2xl shadow-black/8 overflow-hidden"
              dir={direction}
            >
              {/* Modal Header - warm gradient */}
              <div className="shrink-0 px-6 pt-6 pb-5 bg-gradient-to-b from-amber-50/60 via-sky-50/30 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-teal-100 shadow-sm shadow-sky-200/50">
                      <UserPlus className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">{t('teacher.linkRequests')}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {pendingStudents.length > 0
                          ? t('teacher.pendingRequestsCount', { count: pendingStudents.length })
                          : t('teacher.noPendingRequests')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingPanelOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/60 dark:hover:bg-muted/60 hover:text-foreground transition-all duration-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* Bulk actions */}
                {pendingStudents.length > 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 }}
                    className="flex items-center gap-2.5 mt-5"
                  >
                    <button
                      onClick={() => setConfirmAcceptAllOpen(true)}
                      disabled={processingBulk}
                      className="flex items-center gap-2 rounded-xl bg-sky-700/90 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-sky-200/50 hover:bg-sky-700 hover:shadow-md hover:shadow-sky-200/60 transition-all duration-200 disabled:opacity-50 disabled:shadow-none"
                    >
                      {processingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {t('common.acceptAll')} ({pendingStudents.length})
                    </button>
                    <button
                      onClick={() => setConfirmRejectAllOpen(true)}
                      disabled={processingBulk}
                      className="flex items-center gap-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-900/20 px-4 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-500 hover:bg-rose-100 hover:border-rose-300 transition-all duration-200 disabled:opacity-50"
                    >
                      {processingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      {t('common.rejectAll')}
                    </button>
                  </motion.div>
                )}
              </div>
              {/* Pending list */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {pendingStudents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-900/20 mb-4">
                      <UserPlus className="h-7 w-7 text-amber-300" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">{t('teacher.noPendingRequestsShort')}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{t('teacher.whenStudentSendsRequest')}</p>
                  </div>
                ) : (
                  pendingStudents.map((student) => (
                    <motion.div
                      key={student.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card/80 p-3.5 shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      <UserLink
                        userId={student.id}
                        name={student.name}
                        avatarUrl={student.avatar_url}
                        role="student"
                        gender={student.gender}
                        size="md"
                        showAvatar={true}
                        showUsername={false}
                        className="flex-1 min-w-0"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleApproveStudent(student.id)}
                          disabled={processingRequestId === student.id || processingBulk}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-50 transition-all duration-200 active:scale-90"
                          title={t('common.accept')}
                        >
                          {processingRequestId === student.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleRejectStudent(student.id)}
                          disabled={processingRequestId === student.id || processingBulk}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-900/20 text-rose-500 hover:bg-rose-100 hover:border-rose-300 disabled:opacity-50 transition-all duration-200 active:scale-90"
                          title={t('common.reject')}
                        >
                          {processingRequestId === student.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Accept All Confirmation Dialog */}
      <AnimatePresence>
        {confirmAcceptAllOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-800/40 mb-4">
                  <CheckCircle2 className="h-7 w-7 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t('teacher.confirmAcceptAllTitle')}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {t('teacher.confirmAcceptAllDesc', { count: pendingStudents.length })}
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleAcceptAll}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
                  >
                    {processingBulk ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : `${t('common.acceptAll')} (${pendingStudents.length})`}
                  </button>
                  <button
                    onClick={() => setConfirmAcceptAllOpen(false)}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject All Confirmation Dialog */}
      <AnimatePresence>
        {confirmRejectAllOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-800/40 mb-4">
                  <AlertTriangle className="h-7 w-7 text-rose-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t('teacher.confirmRejectAllTitle')}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {t('teacher.confirmRejectAllDesc', { count: pendingStudents.length })}
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleRejectAll}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
                  >
                    {processingBulk ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : `${t('common.rejectAll')} (${pendingStudents.length})`}
                  </button>
                  <button
                    onClick={() => setConfirmRejectAllOpen(false)}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* Send Link Request to Student Modal                            */}
      {/* ============================================================ */}
      <AnimatePresence>
        {sendRequestOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => {
              if (!sendingRequest) {
                setSendRequestOpen(false);
                setStudentPreview(null);
                setStudentEmailInput('');
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  if (!sendingRequest) {
                    setSendRequestOpen(false);
                    setStudentPreview(null);
                    setStudentEmailInput('');
                  }
                }}
                className="absolute start-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex flex-col items-center text-center mb-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 mb-3">
                  <UserPlus className="h-6 w-6 text-sky-700 dark:text-sky-400" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{t('teacher.sendLinkRequestTitle')}</h3>
                <p className="text-xs text-muted-foreground mt-1">{t('teacher.sendLinkRequestDesc')}</p>
              </div>

              {!studentPreview ? (
                /* Step 1: Enter email */
                <div className="space-y-4">
                  <div className="relative">
                    <Mail className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="email"
                      value={studentEmailInput}
                      onChange={(e) => setStudentEmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSearchStudent();
                      }}
                      placeholder={t('teacher.studentEmailPlaceholder')}
                      className="w-full rounded-lg border bg-background pe-10 ps-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-colors"
                      dir="ltr"
                    />
                  </div>
                  <button
                    onClick={handleSearchStudent}
                    disabled={searchingStudent || !studentEmailInput.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
                  >
                    {searchingStudent ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('teacher.searchingStudent')}
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        {t('teacher.searchStudentButton')}
                      </>
                    )}
                  </button>
                </div>
              ) : (
                /* Step 2: Preview and confirm */
                <div className="space-y-4">
                  <UserLink
                    userId={studentPreview.id}
                    name={studentPreview.name}
                    avatarUrl={studentPreview.avatar_url}
                    role="student"
                    gender={studentPreview.gender}
                    size="md"
                    showAvatar={true}
                    showUsername={false}
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    {t('teacher.linkRequestNotice')}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleConfirmSendRequest}
                      disabled={sendingRequest}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
                    >
                      {sendingRequest ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('common.sending')}
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          {t('teacher.sendRequestBtn')}
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setStudentPreview(null);
                        setStudentEmailInput('');
                      }}
                      disabled={sendingRequest}
                      className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      {t('common.goBack')}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Student cards / table */}
      {filteredStudents.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 mb-4">
            <Users className="h-8 w-8 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">
            {studentSearch ? t('teacher.noSearchResults') : t('teacher.noRegisteredStudents')}
          </p>
          <p className="text-sm text-muted-foreground">
            {studentSearch ? t('common.tryDifferentSearch') : t('teacher.shareCodeWithStudents')}
          </p>
        </motion.div>
      ) : studentViewMode === 'grid' ? (
        <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudents.map((student) => {
            const lastScore = getStudentLastScore(student.id);
            const pct = lastScore ? scorePercentage(lastScore.score, lastScore.total) : null;
            return (
              <motion.div key={student.id} variants={itemVariants} {...cardHover}>
                <div
                  className="group rounded-xl border bg-card p-3 sm:p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => {
                    setSelectedStudent(student);
                    setStudentDetailOpen(true);
                  }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <UserLink
                      userId={student.id}
                      name={student.name}
                      avatarUrl={student.avatar_url}
                      role="student"
                      gender={student.gender}
                      size="sm"
                      showAvatar={true}
                      showUsername={false}
                      className="flex-1 min-w-0"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{t('teacher.lastResult')}</span>
                    {pct !== null ? (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${pctColorClass(pct)}`}>
                        {pct}%
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('teacher.noResultsShort')}</span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-end font-medium p-3">{t('common.name')}</th>
                    <th className="text-end font-medium p-3 hidden sm:table-cell">{t('common.email')}</th>
                    <th className="text-end font-medium p-3">{t('teacher.lastResult')}</th>
                    <th className="text-end font-medium p-3">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredStudents.map((student) => {
                    const lastScore = getStudentLastScore(student.id);
                    const pct = lastScore ? scorePercentage(lastScore.score, lastScore.total) : null;
                    return (
                      <tr key={student.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <UserLink
                            userId={student.id}
                            name={student.name}
                            avatarUrl={student.avatar_url}
                            role="student"
                            gender={student.gender}
                            size="xs"
                            showAvatar={true}
                            showUsername={false}
                          />
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <span className="text-sm text-muted-foreground truncate max-w-[200px] block">{student.email}</span>
                        </td>
                        <td className="p-3">
                          {pct !== null ? (
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${pctColorClass(pct)}`}>
                              {pct}%
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => {
                              setSelectedStudent(student);
                              setStudentDetailOpen(true);
                            }}
                            className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200 font-medium"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {t('common.view')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Analytics Section
  // -------------------------------------------------------
  const renderAnalytics = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{t('teacher.reportsTitle')}</h2>
          <p className="text-muted-foreground mt-1">{t('teacher.reportsDesc')}</p>
        </div>
        <button
          onClick={handleExportAllData}
          className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
        >
          <Download className="h-4 w-4" />
          {t('teacher.exportAllData')}
        </button>
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Bar chart */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-sky-700 dark:text-sky-400" />
              {t('teacher.avgPerQuiz')}
            </h3>
            {barChartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                {t('teacher.noSufficientData')}
              </div>
            ) : (
              <div className="h-56 sm:h-72 min-h-[250px] overflow-x-auto" dir="ltr">
                <ResponsiveContainer width="100%" height="100%" minWidth={300}>
                  <BarChart data={barChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      angle={-20}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                       
                      formatter={((value: unknown) => [`${value ?? 0}%`, t('teacher.chartPerformanceAvg')]) as never}
                      contentStyle={{ direction: 'rtl', textAlign: 'right' }}
                    />
                    <Bar
                      dataKey="avg"
                      fill="#0284c7"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={50}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </motion.div>

        {/* Pie chart */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Award className="h-4 w-4 text-teal-600" />
              {t('teacher.studentPerformanceDistribution')}
            </h3>
            {pieChartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                {t('teacher.noSufficientData')}
              </div>
            ) : (
              <div className="h-56 sm:h-72 min-h-[250px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, value }) => `${name} (${value})`}
                    >
                      {pieChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ direction: 'rtl', textAlign: 'right' }}
                    />
                    <Legend
                      formatter={((value: unknown) => <span style={{ color: '#374151', fontSize: 12 }}>{String(value)}</span>) as never}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Detailed table per quiz */}
      <motion.div variants={itemVariants}>
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b p-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-teal-600" />
              {t('teacher.quizDetails')}
            </h3>
          </div>
          <div className="overflow-x-auto">
            {quizzes.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                {t('teacher.noQuizzes')}
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-end font-medium p-3">{t('teacher.tableQuizName')}</th>
                    <th className="text-end font-medium p-3">{t('teacher.tableStudentCount')}</th>
                    <th className="text-end font-medium p-3">{t('teacher.tableAvgPerformance')}</th>
                    <th className="text-end font-medium p-3">{t('teacher.tableDownload')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {quizzes.map((quiz) => {
                    const qScores = scores.filter((s) => s.quiz_id === quiz.id);
                    const avg = qScores.length > 0
                      ? Math.round(qScores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / qScores.length)
                      : 0;
                    return (
                      <tr key={quiz.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-800/40">
                              <ClipboardList className="h-4 w-4 text-teal-600" />
                            </div>
                            <span className="text-sm font-medium text-foreground truncate">{quiz.title}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="text-sm text-foreground">{qScores.length}</span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${pctColorClass(avg)}`}>
                            {avg}%
                          </span>
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => handleExportQuizData(quiz)}
                            disabled={qScores.length === 0}
                            className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Excel
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <div className="min-h-screen bg-background" dir={direction}>
      {/* Header */}
      <AppHeader
        userName={profile.name}
        userId={profile.id}
        userRole="teacher"
        userGender={profile.gender}
        titleId={profile.title_id}
        avatarUrl={profile.avatar_url ?? undefined}
        onSignOut={onSignOut}
        onOpenSettings={() => handleSectionChange('settings')}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        sidebarCollapsed={!sidebarOpen}
      />

      {/* Sidebar */}
      <AppSidebar
        role="teacher"
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />

      {/* Main content - dynamic offset for collapsible sidebar */}
      <main
        className={`min-h-screen min-w-0 overflow-x-hidden pt-14 md:pt-16 pb-20 md:pb-0 transition-[margin,padding] duration-300 ease-in-out ${
          sidebarOpen ? 'md:ms-64' : 'md:ms-[68px]'
        }`}
        style={{ marginTop: bannerHeight ? `${bannerHeight}px` : 0 }}
      >
        <div className="mx-auto max-w-6xl p-3 md:px-6 lg:px-8 py-4 md:py-6 space-y-4 min-w-0">
          {loadingData ? (
            <div className="flex flex-col items-center justify-center py-32">
              <Loader2 className="h-10 w-10 animate-spin text-sky-700 dark:text-sky-400 mb-4" />
              <p className="text-muted-foreground text-sm">{t('teacher.loadingData')}</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                {activeSection === 'dashboard' && renderDashboard()}
                {activeSection === 'subjects' && (selectedSubjectId
                  ? <CoursePage profile={profile} role="teacher" />
                  : <SubjectsSection profile={profile} role="teacher" />)}
                {activeSection === 'summaries' && <TeacherSummariesSection profile={profile} />}
                {activeSection === 'questionBank' && <QuestionBankSection profile={profile} onNavigateToCourse={() => handleSectionChange('subjects')} />}
                {activeSection === 'students' && renderStudents()}
                {activeSection === 'files' && <PersonalFilesSection profile={profile} role="teacher" />}
                {activeSection === 'videos' && <AllVideosSection profile={profile} role="teacher" />}
                {activeSection === 'reports' && <ReportsSection profile={profile} role="teacher" />}
                {activeSection === 'todos' && <TodoSection profile={profile} />}
                {activeSection === 'calendar' && <CalendarSection profile={profile} />}
                {activeSection === 'analytics' && renderAnalytics()}
                {activeSection === 'tracking' && <TeacherStudentTrackingSection profile={profile} students={students} scores={scores} quizzes={quizzes} teacherSubmissions={teacherSubmissions} teacherAssignments={teacherAssignments} teacherAttendanceSessions={teacherAttendanceSessions} teacherAttendanceRecords={teacherAttendanceRecords} subjects={teacherSubjects} />}
                {activeSection === 'chat' && <ChatSection profile={profile} role="teacher" />}
                {activeSection === 'settings' && <SettingsSection profile={profile} onUpdateProfile={handleUpdateProfile} onDeleteAccount={handleDeleteAccount} />}
                {activeSection === 'notifications' && <NotificationsSection />}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </main>

      {/* Student detail modal - rendered at top level so it works from any section */}
      <AnimatePresence>
        {studentDetailOpen && selectedStudent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => { if (!resettingStudent) { setStudentDetailOpen(false); setViewingScore(null); setViewingQuiz(null); setAiGradingResults({}); } }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto ${viewingScore ? 'max-w-2xl' : 'max-w-lg'}`}
              dir={direction}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <UserLink
                  userId={selectedStudent.id}
                  name={selectedStudent.name}
                  avatarUrl={selectedStudent.avatar_url}
                  role="student"
                  gender={selectedStudent.gender}
                  size="md"
                  showAvatar={true}
                  showUsername={false}
                />
                <button
                  onClick={() => setStudentDetailOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scores list or Quiz Answers Review */}
              {viewingScore ? (
                <div className="p-5 space-y-3">
                  {/* Back to scores list */}
                  <button
                    onClick={() => { setViewingScore(null); setViewingQuiz(null); setAiGradingResults({}); }}
                    className="flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200 mb-2"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    {t('teacher.backToResults')}
                  </button>

                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardList className="h-4 w-4 text-teal-600" />
                    <p className="text-sm font-semibold text-foreground">{viewingScore.quiz_title}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${pctColorClass(scorePercentage(viewingScore.score, viewingScore.total))}`}>
                      {scorePercentage(viewingScore.score, viewingScore.total)}%
                    </span>
                  </div>

                  {/* Questions review */}
                  <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                    {viewingQuiz?.questions?.map((q: QuizQuestion, idx: number) => {
                      const ans = viewingScore.user_answers?.find((a: UserAnswer) => a.questionIndex === idx);
                      const isCompletion = q.type === 'completion';
                      const aiResult = aiGradingResults[idx];
                      const hasAiResult = aiResult !== undefined;

                      // Type label
                      const typeLabel = questionTypeLabel(q.type, t);
                      const typeIcon = q.type === 'mcq' ? <ListChecks className="h-3 w-3" /> : q.type === 'boolean' ? <CheckCircle2 className="h-3 w-3" /> : q.type === 'completion' ? <PenLine className="h-3 w-3" /> : <ArrowLeftRight className="h-3 w-3" />;

                      return (
                        <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                          {/* Question header */}
                          <div className="flex items-start gap-2">
                            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                              ans?.isCorrect ? 'bg-teal-100 dark:bg-teal-800/40 text-teal-700 dark:text-teal-500' : 'bg-rose-100 dark:bg-rose-800/40 text-rose-700 dark:text-rose-500'
                            }`}>
                              {ans?.isCorrect ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[10px] text-muted-foreground">{t('teacher.questionLabel')} {idx + 1}</span>
                                <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 dark:border-teal-900/60 bg-teal-50 dark:bg-teal-900/20 px-1.5 py-0.5 text-[9px] font-medium text-teal-700 dark:text-teal-500">
                                  {typeIcon}
                                  {typeLabel}
                                </span>
                              </div>
                              <p className="text-xs font-medium text-foreground">{q.question}</p>
                            </div>
                          </div>

                          {/* Answer details */}
                          {q.type === 'matching' && q.pairs ? (
                            <div className="space-y-1.5">
                              <p className="text-[10px] text-muted-foreground">{t('teacher.studentAnswer')}</p>
                              {Object.entries((ans?.answer as Record<string, string>) || {}).map(([k, v]) => {
                                const isPairCorrect = q.pairs?.find(p => p.key === k)?.value === v;
                                return (
                                  <div key={k} className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] ${
                                    isPairCorrect ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-900/60' : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/60'
                                  }`}>
                                    <span className="font-medium">{k}</span>
                                    <Link2 className="h-2.5 w-2.5" />
                                    <span className={isPairCorrect ? 'text-teal-700 font-medium' : 'text-rose-700 font-medium'}>{v}</span>
                                    {isPairCorrect ? <CheckCircle2 className="h-2.5 w-2.5 text-teal-500 ms-auto" /> : <XCircle className="h-2.5 w-2.5 text-rose-500 ms-auto" />}
                                  </div>
                                );
                              })}
                              {!ans?.isCorrect && (
                                <div className="mt-1">
                                  <p className="text-[10px] text-teal-700 font-medium">{t('teacher.correctMatching')}</p>
                                  {q.pairs.map((p) => (
                                    <div key={p.key} className="flex items-center gap-1.5 text-[10px] text-teal-700 px-2 py-0.5">
                                      <span>{p.key}</span> <Link2 className="h-2.5 w-2.5" /> <span>{p.value}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-[10px] text-muted-foreground">
                                {t('teacher.studentAnswer')} <span className="font-medium text-foreground">{String(ans?.answer || '—')}</span>
                              </p>
                              {q.correctAnswer && (
                                <p className="text-[10px] text-teal-700">
                                  {t('teacher.correctAnswerIs')} <span className="font-medium">{q.correctAnswer}</span>
                                </p>
                              )}
                            </div>
                          )}

                          {/* AI Grading button for completion questions */}
                          {isCompletion && (
                            <div className="pt-1 border-t">
                              {!hasAiResult ? (
                                <button
                                  onClick={async () => {
                                    if (aiGradingIdx === idx) return;
                                    setAiGradingIdx(idx);
                                    try {
                                      const studentAnswer = String(ans?.answer || '');
                                      const correctAnswer = q.correctAnswer || '';

                                      // First check exact match
                                      if (studentAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase()) {
                                        setAiGradingResults(prev => ({
                                          ...prev,
                                          [idx]: { isCorrect: true, reasoning: t('teacher.aiMatchExact') }
                                        }));
                                        return;
                                      }

                                      // Call AI evaluate
                                      const evalHeaders = await getCachedAuthHeaders();
                                      const res = await fetch('/api/gemini/evaluate', {
                                        method: 'POST',
                                        headers: evalHeaders,
                                        body: JSON.stringify({
                                          question: q.question,
                                          correctAnswer,
                                          studentAnswer,
                                          detailed: true,
                                        }),
                                      });
                                      const data = await res.json();
                                      if (data.success && data.data) {
                                        setAiGradingResults(prev => ({
                                          ...prev,
                                          [idx]: {
                                            isCorrect: data.data.isCorrect,
                                            reasoning: data.data.reasoning || (data.data.isCorrect
                                              ? t('teacher.aiSeesCorrect')
                                              : t('teacher.aiSeesIncorrect')),
                                          }
                                        }));
                                      } else {
                                        setAiGradingResults(prev => ({
                                          ...prev,
                                          [idx]: { isCorrect: false, reasoning: t('teacher.aiCannotEvaluate') }
                                        }));
                                      }
                                    } catch {
                                      toast.error(t('teacher.toastAiGradingError'));
                                      setAiGradingResults(prev => ({
                                        ...prev,
                                        [idx]: { isCorrect: false, reasoning: t('teacher.connectionError') }
                                      }));
                                    } finally {
                                      setAiGradingIdx(null);
                                    }
                                  }}
                                  disabled={aiGradingIdx !== null}
                                  className="flex items-center gap-1.5 rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-900/15 px-3 py-1.5 text-xs font-medium text-sky-800 dark:text-sky-400 hover:bg-sky-100 hover:border-sky-300 transition-colors disabled:opacity-50"
                                >
                                  {aiGradingIdx === idx ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3 w-3" />
                                  )}
                                  {aiGradingIdx === idx ? t('teacher.aiGradingProgress') : t('teacher.aiGrading')}
                                </button>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${
                                    aiResult.isCorrect ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-900/60 text-teal-700 dark:text-teal-500' : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-500'
                                  }`}>
                                    <Sparkles className="h-3 w-3" />
                                    <span className="font-medium">{aiResult.isCorrect ? t('teacher.aiCorrect') : t('teacher.aiIncorrect')}</span>
                                  </div>
                                  {aiResult.reasoning && (
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">{aiResult.reasoning}</p>
                                  )}
                                  {/* Teacher override */}
                                  <div className="flex items-center gap-2 mt-1">
                                    <button
                                      onClick={() => {
                                        // Override AI: mark as correct
                                        setAiGradingResults(prev => ({
                                          ...prev,
                                          [idx]: { ...prev[idx], isCorrect: true, reasoning: (prev[idx]?.reasoning || '') + ` — ${t('teacher.manuallyAdjustedCorrect')}` }
                                        }));
                                        toast.success(t('teacher.toastAdjustCorrect'));
                                      }}
                                      className="flex items-center gap-1 rounded-md bg-teal-100 dark:bg-teal-800/40 px-2 py-1 text-[10px] font-medium text-teal-700 dark:text-teal-500 hover:bg-teal-200 transition-colors"
                                    >
                                      <CheckCircle2 className="h-2.5 w-2.5" />
                                      {t('teacher.adjustCorrect')}
                                    </button>
                                    <button
                                      onClick={() => {
                                        // Override AI: mark as incorrect
                                        setAiGradingResults(prev => ({
                                          ...prev,
                                          [idx]: { ...prev[idx], isCorrect: false, reasoning: (prev[idx]?.reasoning || '') + ` — ${t('teacher.manuallyAdjustedIncorrect')}` }
                                        }));
                                        toast.success(t('teacher.toastAdjustIncorrect'));
                                      }}
                                      className="flex items-center gap-1 rounded-md bg-rose-100 dark:bg-rose-800/40 px-2 py-1 text-[10px] font-medium text-rose-700 dark:text-rose-500 hover:bg-rose-200 transition-colors"
                                    >
                                      <XCircle className="h-2.5 w-2.5" />
                                      {t('teacher.adjustIncorrect')}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(!viewingQuiz?.questions || viewingQuiz.questions.length === 0) && (
                      <div className="text-center py-6 text-muted-foreground text-xs">
                        {t('teacher.noQuestionDetails')}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-5 space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
                  {getStudentScores(selectedStudent.id).length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      {t('teacher.noResultsForStudent')}
                    </div>
                  ) : (
                    getStudentScores(selectedStudent.id).map((score) => {
                      const pct = scorePercentage(score.score, score.total);
                      return (
                        <div key={score.id} className="flex items-center gap-3 rounded-lg border p-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-900/20">
                            <ClipboardList className="h-4 w-4 text-teal-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{score.quiz_title}</p>
                            <p className="text-xs text-muted-foreground">{score.score}/{score.total} · {formatDate(score.completed_at)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${pctColorClass(pct)}`}>
                              {pct}%
                            </span>
                            <button
                              onClick={() => {
                                setViewingScore(score);
                                const quiz = quizzes.find(q => q.id === score.quiz_id);
                                setViewingQuiz(quiz || null);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:text-sky-700 dark:text-sky-400 transition-colors"
                              title={t('teacher.viewAnswers')}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center gap-3 border-t p-5">
                <button
                  onClick={() => handleResetStudent(selectedStudent.id)}
                  disabled={resettingStudent}
                  className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-rose-700 disabled:opacity-60"
                >
                  {resettingStudent ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  {t('teacher.resetStudent')}
                </button>
                <button
                  onClick={() => setConfirmRemoveOpen(true)}
                  disabled={processingRequestId === selectedStudent.id}
                  className="flex items-center gap-1.5 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-900/20 px-2.5 py-1.5 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-100 hover:border-rose-300 disabled:opacity-60"
                >
                  {processingRequestId === selectedStudent.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  {t('common.remove')}
                </button>
                <button
                  onClick={() => { setStudentDetailOpen(false); setViewingScore(null); setViewingQuiz(null); setAiGradingResults({}); }}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  {t('common.close')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Remove Student Confirmation Dialog - rendered at top level */}
      <AnimatePresence>
        {confirmRemoveOpen && selectedStudent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          >
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setConfirmRemoveOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-800/40 mb-4">
                  <Trash2 className="h-7 w-7 text-rose-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t('teacher.removeStudentTitle')}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {t('teacher.removeStudentDesc', { name: selectedStudent.name })}
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={() => {
                      setConfirmRemoveOpen(false);
                      handleRemoveStudent(selectedStudent.id);
                    }}
                    className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700"
                  >
                    {t('common.delete')}
                  </button>
                  <button
                    onClick={() => setConfirmRemoveOpen(false)}
                    className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        role="teacher"
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
    </div>
  );
}
