'use client';

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import AppSidebar from '@/components/shared/app-sidebar';
import AppHeader from '@/components/shared/app-header';
import SettingsSection from '@/components/shared/settings-section';
import ChatSection from '@/components/shared/chat-section';
import StatCard from '@/components/shared/stat-card';
import SubjectsSection from '@/components/shared/subjects-section';
import PersonalFilesSection from '@/components/shared/personal-files-section';
import AnnouncementsBanner from '@/components/shared/announcements-banner';
import NotificationsSection from '@/components/shared/notifications-section';
import CoursePage from '@/components/course/course-page';
import { useAppStore } from '@/stores/app-store';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import type { UserProfile, Quiz, Score, Subject, TeacherSection } from '@/lib/types';
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

const cardHover = {
  whileHover: { scale: 1.02, y: -2 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring', stiffness: 400, damping: 25 },
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
  if (pct >= 90) return 'text-emerald-700 bg-emerald-100';
  if (pct >= 75) return 'text-teal-700 bg-teal-100';
  if (pct >= 60) return 'text-amber-700 bg-amber-100';
  return 'text-rose-700 bg-rose-100';
}

// Pie chart colors
const PIE_COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#ef4444'];

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function TeacherDashboard({ profile, onSignOut }: TeacherDashboardProps) {
  // ─── Stores ───
  const { teacherSection: storedTeacherSection, setTeacherSection: storeSetTeacherSection, selectedSubjectId, setSelectedSubjectId, sidebarOpen, setSidebarOpen } = useAppStore();
  const { updateProfile: authUpdateProfile, signOut: authSignOut } = useAuthStore();

  // ─── Local active section synced with store ───
  const [activeSection, setActiveSection] = useState<TeacherSection>(storedTeacherSection || 'dashboard');

  // Keep local state in sync when store changes (e.g. notification navigation)
  useEffect(() => {
    if (storedTeacherSection && storedTeacherSection !== activeSection) {
      setActiveSection(storedTeacherSection);
    }
  }, [storedTeacherSection, activeSection]);

  // When navigating away from subjects, clear selectedSubjectId
  useEffect(() => {
    if (activeSection !== 'subjects' && selectedSubjectId) {
      setSelectedSubjectId(null);
    }
  }, [activeSection, selectedSubjectId, setSelectedSubjectId]);

  // ─── Data state ───
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // ─── Students section ───
  const [studentSearch, setStudentSearch] = useState('');
  const [studentViewMode, setStudentViewMode] = useState<'grid' | 'table'>('grid');
  const [selectedStudent, setSelectedStudent] = useState<UserProfile | null>(null);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [resettingStudent, setResettingStudent] = useState(false);

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
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
            },
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
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
            },
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

  const fetchAllData = useCallback(async () => {
    setLoadingData(true);
    await Promise.all([fetchStudents(), fetchQuizzes(), fetchScores(), fetchTeacherSubjects(), fetchTeacherFilesCount()]);
    setLoadingData(false);
  }, [fetchStudents, fetchQuizzes, fetchScores, fetchTeacherSubjects, fetchTeacherFilesCount]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

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

    return () => {
      supabase.removeChannel(linksChannel);
      supabase.removeChannel(quizzesChannel);
      supabase.removeChannel(scoresChannel);
    };
  }, [profile.id, fetchStudents, fetchQuizzes, fetchScores]);

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
  const avgPerformance = scores.length > 0
    ? Math.round(scores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / scores.length)
    : 0;

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
      toast.success('تم نسخ كود المعلم بنجاح');
    }
  };

  // -------------------------------------------------------
  // Excel export: student summaries
  // -------------------------------------------------------
  const handleExportSummaries = async () => {
    try {
      const XLSX = await import('xlsx');
      toast.info('جاري تحضير البيانات...');

      const studentIds = students.map((s) => s.id);
      const { data: summaries } = await supabase
        .from('summaries')
        .select('*')
        .in('user_id', studentIds);

      const wb = XLSX.utils.book_new();

      // Sheet 1: Student overview
      const overviewData = students.map((s) => {
        const sScores = getStudentScores(s.id);
        const lastScore = sScores[0];
        const avg = sScores.length > 0
          ? Math.round(sScores.reduce((sum, sc) => sum + scorePercentage(sc.score, sc.total), 0) / sScores.length)
          : 0;
        return {
          'اسم الطالب': s.name,
          'البريد الإلكتروني': s.email,
          'عدد الاختبارات': sScores.length,
          'آخر نتيجة': lastScore ? `${lastScore.score}/${lastScore.total}` : '—',
          'متوسط الأداء': `${avg}%`,
        };
      });
      const ws1 = XLSX.utils.json_to_sheet(overviewData);
      XLSX.utils.book_append_sheet(wb, ws1, 'نظرة عامة على الطلاب');

      // Sheet 2: Detailed scores
      const scoresData = scores.map((s) => ({
        'اسم الطالب': students.find((st) => st.id === s.student_id)?.name || '—',
        'عنوان الاختبار': s.quiz_title,
        'الدرجة': `${s.score}/${s.total}`,
        'النسبة': `${scorePercentage(s.score, s.total)}%`,
        'تاريخ الإنجاز': formatDate(s.completed_at),
      }));
      if (scoresData.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(scoresData);
        XLSX.utils.book_append_sheet(wb, ws2, 'النتائج التفصيلية');
      }

      // Sheet 3: Summaries
      if (summaries && summaries.length > 0) {
        const summariesData = summaries.map((sm: { title: string; user_id: string; created_at: string; summary_content: string }) => ({
          'عنوان الملخص': sm.title,
          'الطالب': students.find((st) => st.id === sm.user_id)?.name || '—',
          'تاريخ الإنشاء': formatDate(sm.created_at),
          'المحتوى': sm.summary_content?.slice(0, 200) || '',
        }));
        const ws3 = XLSX.utils.json_to_sheet(summariesData);
        XLSX.utils.book_append_sheet(wb, ws3, 'الملخصات');
      }

      XLSX.writeFile(wb, `ملخصات_الطلاب_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('تم تصدير البيانات بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تصدير البيانات');
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
          'عنوان الاختبار': q.title,
          'عدد الأسئلة': q.questions?.length || 0,
          'عدد الطلاب': qScores.length,
          'متوسط الأداء': `${avg}%`,
          'تاريخ الإنشاء': formatDate(q.created_at),
        };
      });
      const ws1 = XLSX.utils.json_to_sheet(quizStats);
      XLSX.utils.book_append_sheet(wb, ws1, 'إحصائيات الاختبارات');

      // Sheet 2: Per-question breakdown
      const questionData: Record<string, string | number>[] = [];
      quizzes.forEach((q) => {
        const qScores = scores.filter((s) => s.quiz_id === q.id);
        q.questions?.forEach((question, idx) => {
          const correctCount = qScores.filter((s) => s.user_answers?.[idx]?.isCorrect).length;
          questionData.push({
            'الاختبار': q.title,
            'رقم السؤال': idx + 1,
            'نوع السؤال': question.type === 'mcq' ? 'اختيار متعدد' : question.type === 'boolean' ? 'صح/خطأ' : question.type === 'completion' ? 'إكمال' : 'مطابقة',
            'نص السؤال': question.question,
            'عدد الإجابات الصحيحة': correctCount,
            'عدد المشاركين': qScores.length,
            'نسبة الإجابة الصحيحة': qScores.length > 0 ? `${Math.round((correctCount / qScores.length) * 100)}%` : '—',
          });
        });
      });
      if (questionData.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(questionData);
        XLSX.utils.book_append_sheet(wb, ws2, 'تفصيل الأسئلة');
      }

      // Sheet 3: All scores
      const allScores = scores.map((s) => ({
        'اسم الطالب': students.find((st) => st.id === s.student_id)?.name || '—',
        'عنوان الاختبار': s.quiz_title,
        'الدرجة': `${s.score}/${s.total}`,
        'النسبة': `${scorePercentage(s.score, s.total)}%`,
        'تاريخ الإنجاز': formatDate(s.completed_at),
      }));
      if (allScores.length > 0) {
        const ws3 = XLSX.utils.json_to_sheet(allScores);
        XLSX.utils.book_append_sheet(wb, ws3, 'جميع النتائج');
      }

      XLSX.writeFile(wb, `تقرير_شامل_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('تم تصدير التقرير الشامل بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تصدير البيانات');
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
        'اسم الطالب': students.find((st) => st.id === s.student_id)?.name || '—',
        'الدرجة': `${s.score}/${s.total}`,
        'النسبة': `${scorePercentage(s.score, s.total)}%`,
        'تاريخ الإنجاز': formatDate(s.completed_at),
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, quiz.title);
      XLSX.writeFile(wb, `${quiz.title}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('تم تصدير بيانات الاختبار بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء التصدير');
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
        toast.error('حدث خطأ أثناء تصفير حالة الطالب');
      } else {
        toast.success('تم تصفير حالة الطالب بنجاح');
        setStudentDetailOpen(false);
        fetchScores();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setResettingStudent(false);
    }
  };

  // -------------------------------------------------------
  // Approve student link request (uses server-side API)
  // -------------------------------------------------------
  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  const handleApproveStudent = async (studentId: string) => {
    setProcessingRequestId(studentId);
    try {
      const response = await fetch('/api/link-teacher-approve', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'approve', studentId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء قبول الطلب');
      } else {
        toast.success(data.message || 'تم قبول الطالب بنجاح');
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'reject', studentId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء رفض الطلب');
      } else {
        toast.success(data.message || 'تم رفض الطلب');
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'approveAll' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء قبول جميع الطلبات');
      } else {
        toast.success(data.message || `تم قبول جميع الطلبات بنجاح`);
        setConfirmAcceptAllOpen(false);
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'rejectAll' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء رفض جميع الطلبات');
      } else {
        toast.success(data.message || `تم رفض جميع الطلبات`);
        setConfirmRejectAllOpen(false);
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      toast.error('يرجى إدخال البريد الإلكتروني للطالب');
      return;
    }

    setSearchingStudent(true);
    setStudentPreview(null);

    try {
      const response = await fetch('/api/link-teacher-send', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ studentEmail: email, action: 'search' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'لم يتم العثور على طالب بهذا البريد');
        return;
      }

      setStudentPreview(data.student);
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        headers: await getAuthHeaders(),
        body: JSON.stringify({ studentEmail: studentEmailInput.trim().toLowerCase() }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إرسال طلب الارتباط');
        return;
      }

      toast.success(data.message || 'تم إرسال طلب الارتباط بنجاح');
      setStudentEmailInput('');
      setStudentPreview(null);
      setSendRequestOpen(false);

      if (data.autoApproved) {
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        headers: await getAuthHeaders(),
        body: JSON.stringify({ studentId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إزالة الطالب');
      } else {
        toast.success('تم إزالة الطالب بنجاح');
        setStudentDetailOpen(false);
        setSelectedStudent(null);
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('لا يوجد جلسة نشطة');
    }

    // Call the server-side API to delete the account from the database
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشل في حذف الحساب');
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
      { name: 'ممتاز', value: excellent },
      { name: 'جيد جداً', value: veryGood },
      { name: 'جيد', value: good },
      { name: 'ضعيف', value: weak },
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
        <h2 className="text-2xl font-bold text-foreground">أهلاً بك، {formatNameWithTitle(profile.name, profile.role, profile.title_id, profile.gender)}</h2>
        <p className="text-muted-foreground mt-1">لوحة تحكم المعلم</p>
      </div>
      {profile.teacher_code && (
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleCopyTeacherCode}
          className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100 hover:border-emerald-300"
          title="انقر للنسخ"
        >
          <Copy className="h-3 w-3" />
          <span>كود المعلم:</span>
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
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="relative">
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="إجمالي الطلاب"
            value={students.length}
            color="emerald"
          />
          {pendingStudents.length > 0 && (
            <button
              onClick={() => setActiveSection('students')}
              className="absolute -top-2 -left-2 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white shadow-sm hover:bg-amber-600 transition-colors"
            >
              <UserPlus className="h-3 w-3" />
              {pendingStudents.length}
            </button>
          )}
        </div>
        <StatCard
          icon={<FolderOpen className="h-5 w-5" />}
          label="الملفات"
          value={teacherFilesCount}
          color="teal"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="متوسط الأداء"
          value={`${avgPerformance}%`}
          color="amber"
        />
        <StatCard
          icon={<BookOpen className="h-5 w-5" />}
          label="المقررات"
          value={teacherSubjects.length}
          color="rose"
        />
      </motion.div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Student overview table (2/3) */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-600" />
                نظرة عامة على الطلاب
              </h3>
              <button
                onClick={() => setActiveSection('students')}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                عرض الكل
                <ChevronLeft className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto custom-scrollbar">
              {students.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا يوجد طلاب مسجلين بعد
                </div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-right font-medium p-3">اسم الطالب</th>
                      <th className="text-right font-medium p-3">آخر نتيجة</th>
                      <th className="text-right font-medium p-3">تفاصيل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {students.slice(0, 8).map((student) => {
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
                              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              عرض
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Performance alerts (1/3) */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                تنبيهات الأداء
              </h3>
              <button
                onClick={() => setActiveSection('analytics')}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                عرض الكل
                <ChevronLeft className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto custom-scrollbar">
              {scores.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا توجد نتائج بعد
                </div>
              ) : (
                <div className="divide-y">
                  {scores.slice(0, 6).map((score) => {
                    const pct = scorePercentage(score.score, score.total);
                    const student = students.find((s) => s.id === score.student_id);
                    return (
                      <div key={score.id} className="flex items-center gap-3 p-3">
                        <div
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                            pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-teal-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {student?.name || 'طالب'}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {score.quiz_title}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${pctColorClass(pct)}`}>
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
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
          <h2 className="text-2xl font-bold text-foreground">الطلاب</h2>
          <p className="text-muted-foreground mt-1">{students.length} طالب مسجل</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pending Link Requests Button */}
          <button
            onClick={() => setPendingPanelOpen(true)}
            className="relative flex items-center gap-2 rounded-xl border border-amber-200/70 bg-gradient-to-b from-amber-50 to-orange-50/50 px-3.5 py-2 text-sm font-medium text-amber-700 hover:from-amber-100 hover:to-orange-100/60 shadow-sm shadow-amber-100/30 hover:shadow-md hover:shadow-amber-100/40 transition-all duration-200 active:scale-[0.97]"
          >
            <UserPlus className="h-4 w-4" />
            <span>طلبات الارتباط</span>
            {pendingStudents.length > 0 ? (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-amber-300/50">
                {pendingStudents.length}
              </span>
            ) : (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-200/80 px-1.5 text-[10px] font-bold text-amber-600">
                0
              </span>
            )}
          </button>
          <button
            onClick={() => setSendRequestOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            إرسال طلب لطالب
          </button>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="بحث عن طالب..."
              className="w-full sm:w-48 rounded-lg border bg-background pr-10 pl-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
              dir="rtl"
            />
          </div>
          {/* View toggle */}
          <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
            <button
              onClick={() => setStudentViewMode('grid')}
              className={`flex items-center justify-center h-8 w-8 rounded-md transition-all ${
                studentViewMode === 'grid'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="عرض شبكي"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setStudentViewMode('table')}
              className={`flex items-center justify-center h-8 w-8 rounded-md transition-all ${
                studentViewMode === 'table'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="عرض جدول"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={handleExportSummaries}
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            <Download className="h-4 w-4" />
            تصدير الملخصات
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
              dir="rtl"
            >
              {/* Modal Header - warm gradient */}
              <div className="shrink-0 px-6 pt-6 pb-5 bg-gradient-to-b from-amber-50/60 via-emerald-50/30 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 shadow-sm shadow-emerald-200/50">
                      <UserPlus className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">طلبات الارتباط</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {pendingStudents.length > 0
                          ? `${pendingStudents.length} طلب بانتظار المراجعة`
                          : 'لا توجد طلبات معلقة حالياً'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingPanelOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/60 hover:text-foreground transition-all duration-200"
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
                      className="flex items-center gap-2 rounded-xl bg-emerald-600/90 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-emerald-200/50 hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60 transition-all duration-200 disabled:opacity-50 disabled:shadow-none"
                    >
                      {processingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      قبول الكل ({pendingStudents.length})
                    </button>
                    <button
                      onClick={() => setConfirmRejectAllOpen(true)}
                      disabled={processingBulk}
                      className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 hover:border-rose-300 transition-all duration-200 disabled:opacity-50"
                    >
                      {processingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      رفض الكل
                    </button>
                  </motion.div>
                )}
              </div>
              {/* Pending list */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {pendingStudents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 mb-4">
                      <UserPlus className="h-7 w-7 text-amber-300" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">لا توجد طلبات معلقة</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">عندما يرسل طالب طلب ارتباط سيظهر هنا</p>
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
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all duration-200 active:scale-90"
                          title="قبول"
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
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-500 hover:bg-rose-100 hover:border-rose-300 disabled:opacity-50 transition-all duration-200 active:scale-90"
                          title="رفض"
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
              dir="rtl"
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 mb-4">
                  <CheckCircle2 className="h-7 w-7 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">قبول جميع الطلبات</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  هل أنت متأكد من قبول جميع طلبات الارتباط المعلقة ({pendingStudents.length} طلب)؟
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleAcceptAll}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                  >
                    {processingBulk ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : `قبول الكل (${pendingStudents.length})`}
                  </button>
                  <button
                    onClick={() => setConfirmAcceptAllOpen(false)}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors"
                  >
                    إلغاء
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
              dir="rtl"
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 mb-4">
                  <AlertTriangle className="h-7 w-7 text-rose-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">رفض جميع الطلبات</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  هل أنت متأكد من رفض جميع طلبات الارتباط المعلقة ({pendingStudents.length} طلب)؟ لا يمكن التراجع عن هذا الإجراء.
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleRejectAll}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
                  >
                    {processingBulk ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : `رفض الكل (${pendingStudents.length})`}
                  </button>
                  <button
                    onClick={() => setConfirmRejectAllOpen(false)}
                    disabled={processingBulk}
                    className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors"
                  >
                    إلغاء
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
              dir="rtl"
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
                className="absolute left-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex flex-col items-center text-center mb-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 mb-3">
                  <UserPlus className="h-6 w-6 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground">إرسال طلب ارتباط</h3>
                <p className="text-xs text-muted-foreground mt-1">أرسل طلب ربط لطالب عبر بريده الإلكتروني</p>
              </div>

              {!studentPreview ? (
                /* Step 1: Enter email */
                <div className="space-y-4">
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="email"
                      value={studentEmailInput}
                      onChange={(e) => setStudentEmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSearchStudent();
                      }}
                      placeholder="البريد الإلكتروني للطالب"
                      className="w-full rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                      dir="ltr"
                    />
                  </div>
                  <button
                    onClick={handleSearchStudent}
                    disabled={searchingStudent || !studentEmailInput.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                  >
                    {searchingStudent ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري البحث...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        بحث عن الطالب
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
                    سيتم إرسال إشعار للطالب ويمكنه قبول أو رفض طلب الارتباط
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleConfirmSendRequest}
                      disabled={sendingRequest}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      {sendingRequest ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري الإرسال...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          إرسال الطلب
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
                      رجوع
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
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <Users className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">
            {studentSearch ? 'لا توجد نتائج للبحث' : 'لا يوجد طلاب مسجلين'}
          </p>
          <p className="text-sm text-muted-foreground">
            {studentSearch ? 'جرّب البحث بكلمات مختلفة' : 'شارك كود المعلم مع طلابك للتسجيل'}
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
                    <span className="text-xs text-muted-foreground">آخر نتيجة</span>
                    {pct !== null ? (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${pctColorClass(pct)}`}>
                        {pct}%
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">لا توجد نتائج</span>
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
                    <th className="text-right font-medium p-3">الاسم</th>
                    <th className="text-right font-medium p-3 hidden sm:table-cell">البريد الإلكتروني</th>
                    <th className="text-right font-medium p-3">آخر نتيجة</th>
                    <th className="text-right font-medium p-3">إجراءات</th>
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
                            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            عرض
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
          <h2 className="text-2xl font-bold text-foreground">التقارير والإحصائيات</h2>
          <p className="text-muted-foreground mt-1">تحليل شامل لأداء الطلاب والاختبارات</p>
        </div>
        <button
          onClick={handleExportAllData}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
        >
          <Download className="h-4 w-4" />
          تصدير كافة البيانات (Excel)
        </button>
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              متوسط الأداء لكل اختبار
            </h3>
            {barChartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                لا توجد بيانات كافية
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
                      formatter={(value: number) => [`${value}%`, 'متوسط الأداء']}
                      contentStyle={{ direction: 'rtl', textAlign: 'right' }}
                    />
                    <Bar
                      dataKey="avg"
                      fill="#10b981"
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
              توزيع أداء الطلاب
            </h3>
            {pieChartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                لا توجد بيانات كافية
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
                      formatter={(value) => <span style={{ color: '#374151', fontSize: 12 }}>{value}</span>}
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
              تفاصيل الاختبارات
            </h3>
          </div>
          <div className="overflow-x-auto">
            {quizzes.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                لا توجد اختبارات
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-right font-medium p-3">اسم الاختبار</th>
                    <th className="text-right font-medium p-3">عدد الطلاب</th>
                    <th className="text-right font-medium p-3">متوسط الأداء</th>
                    <th className="text-right font-medium p-3">تحميل</th>
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
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100">
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
                            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
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
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <AppHeader
        userName={profile.name}
        userId={profile.id}
        userRole="teacher"
        userGender={profile.gender}
        titleId={profile.title_id}
        avatarUrl={profile.avatar_url}
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
      <main className={`min-h-screen pt-14 sm:pt-16 transition-all duration-300 ${
        sidebarOpen ? 'md:mr-64' : 'md:mr-[68px]'
      }`}>
        <div className="mx-auto max-w-6xl p-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4">
          <AnnouncementsBanner userId={profile.id} />
          {loadingData ? (
            <div className="flex flex-col items-center justify-center py-32">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-600 mb-4" />
              <p className="text-muted-foreground text-sm">جاري تحميل البيانات...</p>
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
                {activeSection === 'students' && renderStudents()}
                {activeSection === 'files' && <PersonalFilesSection profile={profile} role="teacher" />}
                {activeSection === 'analytics' && renderAnalytics()}
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
            onClick={() => { if (!resettingStudent) setStudentDetailOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-2xl border bg-background shadow-xl max-h-[85vh] overflow-y-auto"
              dir="rtl"
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

              {/* Scores list */}
              <div className="p-5 space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
                {getStudentScores(selectedStudent.id).length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    لا توجد نتائج لهذا الطالب
                  </div>
                ) : (
                  getStudentScores(selectedStudent.id).map((score) => {
                    const pct = scorePercentage(score.score, score.total);
                    return (
                      <div key={score.id} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50">
                          <ClipboardList className="h-4 w-4 text-teal-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{score.quiz_title}</p>
                          <p className="text-xs text-muted-foreground">{score.score}/{score.total} · {formatDate(score.completed_at)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${pctColorClass(pct)}`}>
                          {pct}%
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

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
                  تصفير حالة الطالب
                </button>
                <button
                  onClick={() => setConfirmRemoveOpen(true)}
                  disabled={processingRequestId === selectedStudent.id}
                  className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-100 hover:border-rose-300 disabled:opacity-60"
                >
                  {processingRequestId === selectedStudent.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  إزالة
                </button>
                <button
                  onClick={() => setStudentDetailOpen(false)}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  إغلاق
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
              dir="rtl"
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 mb-4">
                  <Trash2 className="h-7 w-7 text-rose-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">إزالة طالب</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  هل أنت متأكد من إزالة الطالب <span className="font-semibold text-foreground">{selectedStudent.name}</span> من قائمة المرتبطين بك؟ سيتم حذف جميع بيانات الارتباط.
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={() => {
                      setConfirmRemoveOpen(false);
                      handleRemoveStudent(selectedStudent.id);
                    }}
                    className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700"
                  >
                    حذف
                  </button>
                  <button
                    onClick={() => setConfirmRemoveOpen(false)}
                    className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
