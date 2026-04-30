'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  ClipboardList,
  Users,
  BookOpen,
  Award,
  Plus,
  Upload,
  X,
  Loader2,
  Search,
  Link2,
  ChevronLeft,
  Calendar,
  Hash,
  CheckCircle2,
  Eye,
  Play,
  UserPlus,
  Trash2,
  FileUp,
  Type,
  BookMarked,
  Unlink,
  Folder,
  TrendingUp,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import AppSidebar from '@/components/shared/app-sidebar';
import AppHeader from '@/components/shared/app-header';
import StatCard from '@/components/shared/stat-card';
import SubjectsSection from '@/components/shared/subjects-section';
import PersonalFilesSection from '@/components/shared/personal-files-section';
import AssignmentsSection from '@/components/shared/assignments-section';
import SettingsSection from '@/components/shared/settings-section';
import ChatSection from '@/components/shared/chat-section';
import AnnouncementsBanner from '@/components/shared/announcements-banner';
import NotificationsSection from '@/components/shared/notifications-section';
import CoursePage from '@/components/course/course-page';
import { useAppStore } from '@/stores/app-store';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import type { UserProfile, Summary, Quiz, Score, StudentSection, Subject } from '@/lib/types';
import { STUDENT_SECTION_PATHS, getStudentSectionFromPathname } from '@/lib/navigation-config';
import UserAvatar from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import { SectionErrorBoundary } from '@/components/shared/section-error-boundary';
import { useMountedSections, useNavigationSync } from '@/hooks/use-mounted-sections';
import { cleanupAfterNavigation } from '@/lib/navigation-cleanup';
import AttendanceSection from '@/components/shared/attendance-section';

// -------------------------------------------------------
// PDF.js worker setup - lazy loaded to avoid server-side DOMMatrix error
// -------------------------------------------------------
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfjsLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  }
  return pdfjsLib;
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface StudentDashboardProps {
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
// Helper: format date to Arabic-friendly string
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

// -------------------------------------------------------
// Helper: calculate score percentage
// -------------------------------------------------------
function scorePercentage(score: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((score / total) * 100);
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function StudentDashboard({ profile, onSignOut }: StudentDashboardProps) {
  // ─── App store ───
  const selectedSubjectId = useAppStore((s) => s.selectedSubjectId);
  const setSelectedSubjectId = useAppStore((s) => s.setSelectedSubjectId);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setStudentSection = useAppStore((s) => s.setStudentSection);
  const storeSection = useAppStore((s) => s.studentSection);

  // ─── Router for URL-based navigation ───
  const router = useRouter();

  // ─── Navigation: usePathname() is the SOLE source of truth for activeSection.
  //    Sidebar clicks call router.push() → URL changes → pathname updates → UI re-renders.
  //    The Zustand store is synced FROM the pathname (not vice versa) so the sidebar
  //    can highlight the correct active item. This eliminates ALL race conditions.
  const pathname = usePathname();
  const pathnameSection = useMemo(() => {
    return getStudentSectionFromPathname(pathname);
  }, [pathname]);

  // Sync pathname → Zustand store (for sidebar highlight only)
  // The return value is ALWAYS pathnameSection (the URL is the source of truth)
  const activeSection: StudentSection = useNavigationSync({
    pathnameSection,
    storeSection,
    setStoreSection: setStudentSection,
  }) as StudentSection;

  // Keep-alive: track which sections have been mounted to prevent remounting
  // activeSection is derived from pathname, so visibility is strictly URL-reactive
  const { isMounted: isSectionMounted } = useMountedSections(activeSection);

  // Data loading flag — used only for dashboard section loading indicator
  const [dataLoaded, setDataLoaded] = useState(false);

  // When navigating away from subjects, clear selectedSubjectId
  useEffect(() => {
    if (activeSection !== 'subjects' && selectedSubjectId) {
      setSelectedSubjectId(null);
    }
  }, [activeSection, selectedSubjectId, setSelectedSubjectId]);

  // ─── MODAL CLEANUP ON NAVIGATION ───
  // When the user navigates to a different section while a modal is open,
  // the modal's fixed-position backdrop stays visible and blocks all clicks.
  // This effect closes ALL modals when the active section changes.
  const prevSectionRef = useRef(activeSection);
  useEffect(() => {
    if (prevSectionRef.current !== activeSection) {
      // Close all modals
      setNewSummaryOpen(false);
      setLinkTeacherOpen(false);
      setTeacherPreview(null);
      setTeacherCode('');
      setIncomingPanelOpen(false);
      setConfirmIncomingAcceptAllOpen(false);
      setConfirmIncomingRejectAllOpen(false);
      setSelectedTeacher(null);
      setUnlinkConfirmOpen(false);
      setSummaryStep('input');

      // Force-cleanup any body locks left by Radix UI / modal libraries
      cleanupAfterNavigation();

      prevSectionRef.current = activeSection;
    }
  }, [activeSection]);

  // ─── Auth store ───
  const { updateProfile: authUpdateProfile, signOut: authSignOut } = useAuthStore();

  // ─── Data state ───
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [linkedTeachers, setLinkedTeachers] = useState<UserProfile[]>([]);
  const [fileCount, setFileCount] = useState(0);

  // ─── New summary modal ───
  const [newSummaryOpen, setNewSummaryOpen] = useState(false);
  const [summaryTitle, setSummaryTitle] = useState('');
  const [summaryInputMode, setSummaryInputMode] = useState<'text' | 'file'>('text');
  const [summaryText, setSummaryText] = useState('');
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const [creatingSummary, setCreatingSummary] = useState(false);
  const [summaryStep, setSummaryStep] = useState<'input' | 'processing'>('input');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Link teacher modal ───
  const [linkTeacherOpen, setLinkTeacherOpen] = useState(false);
  const [teacherCode, setTeacherCode] = useState('');
  const [linkingTeacher, setLinkingTeacher] = useState(false);
  const [teacherPreview, setTeacherPreview] = useState<UserProfile | null>(null);
  const [searchingTeacher, setSearchingTeacher] = useState(false);

  // ─── Deleting summary state ───
  const [deletingSummaryId, setDeletingSummaryId] = useState<string | null>(null);

  // ─── Deleting teacher link ───
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);

  // ─── Pending/rejected teacher link requests ───
  const [pendingLinkTeachers, setPendingLinkTeachers] = useState<UserProfile[]>([]);
  const [rejectedLinkTeachers, setRejectedLinkTeachers] = useState<UserProfile[]>([]);

  // ─── Cancel pending link request ───
  const [cancelingRequestId, setCancelingRequestId] = useState<string | null>(null);

  // ─── Incoming teacher link requests (from notifications) ───
  const [incomingLinkRequests, setIncomingLinkRequests] = useState<{ teacher: UserProfile; notificationId: string }[]>([]);
  const [processingIncomingId, setProcessingIncomingId] = useState<string | null>(null);
  const [processingIncomingBulk, setProcessingIncomingBulk] = useState(false);
  const [confirmIncomingAcceptAllOpen, setConfirmIncomingAcceptAllOpen] = useState(false);
  const [confirmIncomingRejectAllOpen, setConfirmIncomingRejectAllOpen] = useState(false);
  const [incomingPanelOpen, setIncomingPanelOpen] = useState(false);

  // ─── Teacher detail modal ───
  const [selectedTeacher, setSelectedTeacher] = useState<UserProfile | null>(null);
  const [teacherSubjects, setTeacherSubjects] = useState<Subject[]>([]);
  const [loadingTeacherSubjects, setLoadingTeacherSubjects] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);

  // -------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------
  const fetchSummaries = useCallback(async () => {
    const { data, error } = await supabase
      .from('summaries')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching summaries:', error);
    } else {
      setSummaries((data as Summary[]) || []);
    }
  }, [profile.id]);

  const fetchQuizzes = useCallback(async () => {
    // Own quizzes
    const { data: ownQuizzes, error: ownError } = await supabase
      .from('quizzes')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (ownError) {
      console.error('Error fetching own quizzes:', ownError);
    }

    // Teacher-linked quizzes - fetch all links and filter by status if available
    const { data: links } = await supabase
      .from('teacher_student_links')
      .select('teacher_id, status')
      .eq('student_id', profile.id);

    let teacherIds: string[] = [];
    if (links && links.length > 0) {
      // Check if status column exists
      const hasStatus = 'status' in links[0];
      if (hasStatus) {
        // Only include approved links
        teacherIds = links.filter((l) => l.status === 'approved').map((l) => l.teacher_id);
      } else {
        teacherIds = links.map((l) => l.teacher_id);
      }
    }

    let teacherQuizzes: Quiz[] = [];
    if (teacherIds.length > 0) {
      const { data: tQuizzes, error: tError } = await supabase
        .from('quizzes')
        .select('*')
        .in('user_id', teacherIds)
        .order('created_at', { ascending: false });

      if (tError) {
        console.error('Error fetching teacher quizzes:', tError);
      } else {
        teacherQuizzes = (tQuizzes as Quiz[]) || [];
      }
    }

    // Merge and deduplicate
    const allQuizzes = [...(ownQuizzes as Quiz[] || []), ...teacherQuizzes];
    const uniqueMap = new Map<string, Quiz>();
    allQuizzes.forEach((q) => uniqueMap.set(q.id, q));
    setQuizzes(Array.from(uniqueMap.values()));
  }, [profile.id]);

  const fetchScores = useCallback(async () => {
    const { data, error } = await supabase
      .from('scores')
      .select('*')
      .eq('student_id', profile.id)
      .order('completed_at', { ascending: false });

    if (error) {
      console.error('Error fetching scores:', error);
    } else {
      setScores((data as Score[]) || []);
    }
  }, [profile.id]);

  const fetchLinkedTeachers = useCallback(async () => {
    // Try fetching with status filter (new schema)
    const { data: approvedLinks, error: approvedError } = await supabase
      .from('teacher_student_links')
      .select('teacher_id, status')
      .eq('student_id', profile.id);

    if (approvedError) {
      console.error('Error fetching teacher links:', approvedError);
      return;
    }

    // Check if status column exists in the results
    const hasStatusColumn = approvedLinks && approvedLinks.length > 0 && 'status' in approvedLinks[0];

    if (hasStatusColumn) {
      // New schema: filter by status
      const approvedIds = approvedLinks.filter((l) => l.status === 'approved').map((l) => l.teacher_id);
      const pendingIds = approvedLinks.filter((l) => l.status === 'pending').map((l) => l.teacher_id);
      const rejectedIds = approvedLinks.filter((l) => l.status === 'rejected').map((l) => l.teacher_id);

      // Fetch all teacher profiles through server-side API (bypasses RLS)
      const allIds = [...approvedIds, ...pendingIds, ...rejectedIds];
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
            setLinkedTeachers(approvedIds.map(id => userMap.get(id)).filter(Boolean) as UserProfile[]);
            setPendingLinkTeachers(pendingIds.map(id => userMap.get(id)).filter(Boolean) as UserProfile[]);
            setRejectedLinkTeachers(rejectedIds.map(id => userMap.get(id)).filter(Boolean) as UserProfile[]);
          }
        } catch {
          // Fallback: empty results
          setLinkedTeachers([]);
          setPendingLinkTeachers([]);
          setRejectedLinkTeachers([]);
        }
      } else {
        setLinkedTeachers([]);
        setPendingLinkTeachers([]);
        setRejectedLinkTeachers([]);
      }
    } else {
      // Old schema: no status column, treat all as approved
      if (approvedLinks && approvedLinks.length > 0) {
        const teacherIds = approvedLinks.map((l) => l.teacher_id);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ userIds: teacherIds }),
          });
          if (res.ok) {
            const { users } = await res.json();
            setLinkedTeachers((users as UserProfile[]) || []);
          }
        } catch {
          setLinkedTeachers([]);
        }
      } else {
        setLinkedTeachers([]);
      }
      setPendingLinkTeachers([]);
      setRejectedLinkTeachers([]);
    }
  }, [profile.id]);

  const fetchIncomingLinkRequests = useCallback(async () => {
    // Fetch unread link_request notifications
    const { data: notifs, error } = await supabase
      .from('notifications')
      .select('id, link, created_at')
      .eq('user_id', profile.id)
      .eq('type', 'link_request')
      .eq('read', false)
      .order('created_at', { ascending: false });

    if (error || !notifs || notifs.length === 0) {
      setIncomingLinkRequests([]);
      return;
    }

    // Extract teacher IDs from link field (format: "link_request:TEACHER_ID")
    const teacherEntries: { tid: string; nid: string }[] = [];
    for (const n of notifs) {
      const tid = n.link?.replace('link_request:', '');
      if (tid) teacherEntries.push({ tid, nid: n.id });
    }

    if (teacherEntries.length === 0) {
      setIncomingLinkRequests([]);
      return;
    }

    // Fetch teacher profiles
    const teacherIds = teacherEntries.map((e) => e.tid);
    const { data: teachers, error: teachersError } = await supabase
      .from('users')
      .select('*')
      .in('id', teacherIds);

    if (teachersError || !teachers) {
      setIncomingLinkRequests([]);
      return;
    }

    const requests = teacherEntries.map((entry) => ({
      teacher: (teachers as UserProfile[]).find((t) => t.id === entry.tid)!,
      notificationId: entry.nid,
    })).filter((r) => r.teacher);

    setIncomingLinkRequests(requests);
  }, [profile.id]);

  // Refresh teachers data when navigating to teachers section
  // This ensures pending/rejected link requests are always up-to-date
  useEffect(() => {
    if (activeSection === 'teachers') {
      fetchLinkedTeachers();
      fetchIncomingLinkRequests();
    }
  }, [activeSection, fetchLinkedTeachers, fetchIncomingLinkRequests]);

  const fetchFileCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('user_files')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id);
    if (!error && count !== null) {
      setFileCount(count);
    }
  }, [profile.id]);

  // Load all data
  const fetchAllData = useCallback(async () => {
    await Promise.all([fetchSummaries(), fetchQuizzes(), fetchScores(), fetchLinkedTeachers(), fetchIncomingLinkRequests(), fetchFileCount()]);
    setDataLoaded(true);
  }, [fetchSummaries, fetchQuizzes, fetchScores, fetchLinkedTeachers, fetchIncomingLinkRequests, fetchFileCount]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // -------------------------------------------------------
  // Realtime subscriptions
  // -------------------------------------------------------
  useEffect(() => {
    const summariesChannel = supabase
      .channel('summaries-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'summaries', filter: `user_id=eq.${profile.id}` },
        () => { fetchSummaries(); }
      )
      .subscribe();

    const quizzesChannel = supabase
      .channel('quizzes-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quizzes' },
        () => { fetchQuizzes(); }
      )
      .subscribe();

    const scoresChannel = supabase
      .channel('scores-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores', filter: `student_id=eq.${profile.id}` },
        () => { fetchScores(); }
      )
      .subscribe();

    const linksChannel = supabase
      .channel('student-links-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teacher_student_links', filter: `student_id=eq.${profile.id}` },
        () => { fetchLinkedTeachers(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(summariesChannel);
      supabase.removeChannel(quizzesChannel);
      supabase.removeChannel(scoresChannel);
      supabase.removeChannel(linksChannel);
    };
  }, [profile.id, fetchSummaries, fetchQuizzes, fetchScores, fetchLinkedTeachers]);

  // -------------------------------------------------------
  // Section change handler
  // -------------------------------------------------------
  const handleSectionChange = (section: string) => {
    const path = STUDENT_SECTION_PATHS[section as StudentSection] || '/student';
    router.push(path);
  };

  // -------------------------------------------------------
  // PDF text extraction
  // -------------------------------------------------------
  const extractTextFromPDF = async (file: File): Promise<string> => {
    const lib = await getPdfjsLib();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }

    return pages.join('\n\n');
  };

  // -------------------------------------------------------
  // Create summary handler
  // -------------------------------------------------------
  const handleCreateSummary = async () => {
    const title = summaryTitle.trim();
    if (!title) {
      toast.error('يرجى إدخال عنوان الملخص');
      return;
    }

    let content = '';

    if (summaryInputMode === 'file') {
      if (!summaryFile) {
        toast.error('يرجى اختيار ملف PDF');
        return;
      }
      try {
        setSummaryStep('processing');
        content = await extractTextFromPDF(summaryFile);
        if (!content.trim()) {
          toast.error('لم يتم العثور على نص في الملف');
          setSummaryStep('input');
          return;
        }
      } catch (err) {
        console.error('PDF extraction error:', err);
        toast.error('حدث خطأ أثناء قراءة ملف PDF');
        setSummaryStep('input');
        return;
      }
    } else {
      content = summaryText.trim();
      if (!content) {
        toast.error('يرجى إدخال المحتوى أو لصقه');
        return;
      }
    }

    setCreatingSummary(true);

    try {
      // Get auth token for API requests
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      // 1. Generate summary
      const summaryRes = await fetch('/api/gemini/summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });

      const summaryData = await summaryRes.json();
      if (!summaryData.success) {
        throw new Error(summaryData.error || 'فشل في إنشاء الملخص');
      }

      const summaryContent = summaryData.data.summary;

      // 2. Generate quiz
      const quizRes = await fetch('/api/gemini/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });

      const quizData = await quizRes.json();
      let quizQuestions: unknown[] = [];
      if (quizData.success && quizData.data?.questions) {
        quizQuestions = quizData.data.questions;
      }

      // 3. Save summary to supabase
      const { data: insertedSummary, error: summaryError } = await supabase
        .from('summaries')
        .insert({
          user_id: profile.id,
          title,
          original_content: content,
          summary_content: summaryContent,
        })
        .select()
        .single();

      if (summaryError) {
        throw new Error(summaryError.message);
      }

      // 4. Save quiz to supabase (if generated)
      if (quizQuestions.length > 0 && insertedSummary) {
        await supabase.from('quizzes').insert({
          user_id: profile.id,
          title: `اختبار: ${title}`,
          questions: quizQuestions,
          summary_id: insertedSummary.id,
        });
      }

      toast.success('تم إنشاء الملخص والاختبار بنجاح');

      // Reset form
      setSummaryTitle('');
      setSummaryText('');
      setSummaryFile(null);
      setSummaryInputMode('text');
      setNewSummaryOpen(false);

      // Refresh data
      fetchSummaries();
      fetchQuizzes();
    } catch (err) {
      console.error('Create summary error:', err);
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء الملخص');
    } finally {
      setCreatingSummary(false);
      setSummaryStep('input');
    }
  };

  // -------------------------------------------------------
  // Delete summary handler
  // -------------------------------------------------------
  const handleDeleteSummary = async (summaryId: string) => {
    setDeletingSummaryId(summaryId);
    try {
      const { error } = await supabase.from('summaries').delete().eq('id', summaryId);
      if (error) {
        toast.error('حدث خطأ أثناء حذف الملخص');
      } else {
        toast.success('تم حذف الملخص بنجاح');
        fetchSummaries();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setDeletingSummaryId(null);
    }
  };

  // -------------------------------------------------------
  // Link teacher handler (two-step: search then confirm)
  // -------------------------------------------------------
  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  const handleSearchTeacher = async () => {
    const code = teacherCode.trim().toUpperCase();
    if (!code) {
      toast.error('يرجى إدخال رمز المعلم');
      return;
    }

    setSearchingTeacher(true);
    setTeacherPreview(null);

    try {
      const response = await fetch('/api/link-teacher', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ teacherCode: code, action: 'search' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'لم يتم العثور على معلم بهذا الرمز');
        return;
      }

      // Show teacher preview
      setTeacherPreview(data.teacher);
    } catch (err) {
      console.error('[handleSearchTeacher] Unexpected error:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSearchingTeacher(false);
    }
  };

  const handleConfirmLinkTeacher = async () => {
    if (!teacherPreview) return;

    setLinkingTeacher(true);

    try {
      const response = await fetch('/api/link-teacher', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ teacherCode: teacherCode.trim().toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إرسال طلب الارتباط');
        return;
      }

      // Success
      toast.success(data.message || `تم إرسال طلب الارتباط بنجاح. في انتظار موافقة المعلم.`);
      setTeacherCode('');
      setTeacherPreview(null);
      setLinkTeacherOpen(false);
      await fetchLinkedTeachers();
      fetchQuizzes();
    } catch (err) {
      console.error('[handleConfirmLinkTeacher] Unexpected error:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLinkingTeacher(false);
    }
  };

  // -------------------------------------------------------
  // Unlink teacher handler (uses server-side API)
  // -------------------------------------------------------
  const handleUnlinkTeacher = async (teacherId: string) => {
    setDeletingLinkId(teacherId);
    try {
      const response = await fetch('/api/link-teacher-unlink', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ teacherId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إلغاء الربط');
      } else {
        toast.success('تم إلغاء ربط المعلم بنجاح');
        setSelectedTeacher(null);
        setUnlinkConfirmOpen(false);
        fetchLinkedTeachers();
        fetchQuizzes();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setDeletingLinkId(null);
    }
  };

  // -------------------------------------------------------
  // Cancel pending link request handler (uses server-side API)
  // -------------------------------------------------------
  const handleCancelLinkRequest = async (teacherId: string) => {
    setCancelingRequestId(teacherId);
    try {
      const response = await fetch('/api/link-teacher-cancel', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ teacherId, action: 'cancel' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إلغاء الطلب');
      } else {
        toast.success('تم إلغاء طلب الارتباط بنجاح');
        fetchLinkedTeachers();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setCancelingRequestId(null);
    }
  };

  // -------------------------------------------------------
  // Dismiss rejected link request handler (uses server-side API)
  // -------------------------------------------------------
  const handleDismissRejectedLink = async (teacherId: string) => {
    setCancelingRequestId(teacherId);
    try {
      const response = await fetch('/api/link-teacher-cancel', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ teacherId, action: 'dismiss' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إزالة الطلب');
      } else {
        toast.success('تم إزالة الطلب المرفوض');
        fetchLinkedTeachers();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setCancelingRequestId(null);
    }
  };

  // -------------------------------------------------------
  // Accept incoming teacher link request
  // -------------------------------------------------------
  const handleAcceptIncomingRequest = async (teacherId: string, notificationId: string) => {
    setProcessingIncomingId(teacherId);
    try {
      const response = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'approve', teacherId, notificationId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء قبول الطلب');
      } else {
        toast.success(data.message || 'تم قبول المعلم بنجاح');
        fetchIncomingLinkRequests();
        fetchLinkedTeachers();
        fetchQuizzes();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingIncomingId(null);
    }
  };

  // -------------------------------------------------------
  // Reject incoming teacher link request
  // -------------------------------------------------------
  const handleRejectIncomingRequest = async (teacherId: string, notificationId: string) => {
    setProcessingIncomingId(teacherId);
    try {
      const response = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'reject', teacherId, notificationId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء رفض الطلب');
      } else {
        toast.success(data.message || 'تم رفض الطلب');
        fetchIncomingLinkRequests();
        fetchLinkedTeachers();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingIncomingId(null);
    }
  };

  // -------------------------------------------------------
  // Accept ALL incoming teacher link requests
  // -------------------------------------------------------
  const handleAcceptAllIncoming = async () => {
    setProcessingIncomingBulk(true);
    try {
      const response = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approveAll' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء قبول جميع الطلبات');
      } else {
        toast.success(data.message || `تم قبول جميع الطلبات بنجاح`);
        setConfirmIncomingAcceptAllOpen(false);
        fetchIncomingLinkRequests();
        fetchLinkedTeachers();
        fetchQuizzes();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingIncomingBulk(false);
    }
  };

  // -------------------------------------------------------
  // Reject ALL incoming teacher link requests
  // -------------------------------------------------------
  const handleRejectAllIncoming = async () => {
    setProcessingIncomingBulk(true);
    try {
      const response = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rejectAll' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء رفض جميع الطلبات');
      } else {
        toast.success(data.message || `تم رفض جميع الطلبات`);
        setConfirmIncomingRejectAllOpen(false);
        fetchIncomingLinkRequests();
        fetchLinkedTeachers();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingIncomingBulk(false);
    }
  };

  // -------------------------------------------------------
  // Teacher detail click handler
  // -------------------------------------------------------
  const handleTeacherClick = async (teacher: UserProfile) => {
    setSelectedTeacher(teacher);
    setLoadingTeacherSubjects(true);
    try {
      const { data, error } = await supabase
        .from('subjects')
        .select('*')
        .eq('teacher_id', teacher.id);

      if (error) {
        console.error('Error fetching teacher subjects:', error);
        setTeacherSubjects([]);
      } else {
        setTeacherSubjects((data as Subject[]) || []);
      }
    } catch {
      setTeacherSubjects([]);
    } finally {
      setLoadingTeacherSubjects(false);
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
  // Computed: check which quizzes are completed
  // -------------------------------------------------------
  const completedQuizIds = new Set(scores.map((s) => s.quiz_id));

  // -------------------------------------------------------
  // Computed: average performance
  // -------------------------------------------------------
  const avgPerformance = scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / scores.length) : 0;

  // -------------------------------------------------------
  // Render: Dashboard Section
  // -------------------------------------------------------
  const renderDashboard = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h2 className="text-2xl font-bold text-foreground">لوحة التحكم</h2>
        <p className="text-muted-foreground mt-1">مرحباً بك في منصة أتيندو التعليمية</p>
      </motion.div>

      {/* Stats row */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="ملخصات"
          value={summaries.length}
          color="emerald"
        />
        <StatCard
          icon={<Folder className="h-5 w-5" />}
          label="الملفات"
          value={fileCount}
          color="teal"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="متوسط الأداء"
          value={`${avgPerformance}%`}
          color="amber"
        />
      </motion.div>

      {/* Two columns: recent summaries & recent scores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* أحدث الملخصات */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-emerald-600" />
                أحدث الملخصات
              </h3>
              <button
                onClick={() => router.push('/student/summaries')}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                عرض الكل
                <ChevronLeft className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {summaries.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا توجد ملخصات بعد
                </div>
              ) : (
                <div className="divide-y">
                  {summaries.slice(0, 5).map((summary) => (
                    <motion.button
                      key={summary.id}
                      whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
                      onClick={() => router.push(`/summary/${summary.id}`)}
                      className="flex w-full items-start gap-3 p-4 text-right transition-colors"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                        <FileText className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{summary.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {summary.summary_content.slice(0, 80)}...
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">{formatDate(summary.created_at)}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* آخر النتائج */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-600" />
                آخر النتائج
              </h3>
            </div>
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {scores.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا توجد نتائج بعد
                </div>
              ) : (
                <div className="divide-y">
                  {scores.slice(0, 5).map((score) => {
                    const pct = scorePercentage(score.score, score.total);
                    const pctColor =
                      pct >= 80
                        ? 'text-emerald-700 bg-emerald-100'
                        : pct >= 60
                          ? 'text-amber-700 bg-amber-100'
                          : 'text-rose-700 bg-rose-100';
                    return (
                      <div key={score.id} className="flex items-center gap-3 p-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                          <Award className="h-4 w-4 text-amber-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{score.quiz_title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {score.score} / {score.total}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${pctColor}`}>
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
  // Render: Summaries Section
  // -------------------------------------------------------
  const renderSummaries = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">الملخصات</h2>
          <p className="text-muted-foreground mt-1">جميع ملخصاتك الدراسية في مكان واحد</p>
        </div>
        <button
          onClick={() => setNewSummaryOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          ملخص جديد
        </button>
      </motion.div>

      {/* Summaries grid */}
      {summaries.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <FileText className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد ملخصات</p>
          <p className="text-sm text-muted-foreground mb-4">ابدأ بإنشاء ملخصك الأول من محتوى دراسي</p>
          <button
            onClick={() => setNewSummaryOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            إنشاء ملخص
          </button>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summaries.map((summary) => (
            <motion.div key={summary.id} variants={itemVariants} {...cardHover}>
              <div className="group relative rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSummary(summary.id);
                  }}
                  disabled={deletingSummaryId === summary.id}
                  className="absolute top-3 left-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-50 hover:text-rose-600"
                >
                  {deletingSummaryId === summary.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>

                <button
                  onClick={() => router.push(`/summary/${summary.id}`)}
                  className="w-full text-right"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 transition-transform group-hover:scale-110">
                      <FileText className="h-5 w-5 text-emerald-600" />
                    </div>
                    <h3 className="font-semibold text-foreground truncate">{summary.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {summary.summary_content.slice(0, 120)}...
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                    <Calendar className="h-3 w-3" />
                    {formatDate(summary.created_at)}
                  </div>
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* New Summary Modal */}
      <AnimatePresence>
        {newSummaryOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!creatingSummary) setNewSummaryOpen(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <FileText className="h-5 w-5 text-emerald-600" />
                  ملخص جديد
                </h3>
                <button
                  onClick={() => {
                    if (!creatingSummary) setNewSummaryOpen(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-4">
                {/* Title */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">عنوان الملخص</label>
                  <input
                    type="text"
                    value={summaryTitle}
                    onChange={(e) => setSummaryTitle(e.target.value)}
                    placeholder="مثال: ملخص الفصل الثالث - الفيزياء"
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    disabled={creatingSummary}
                    dir="rtl"
                  />
                </div>

                {/* Input mode toggle */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">طريقة الإدخال</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSummaryInputMode('text')}
                      disabled={creatingSummary}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'text'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Type className="h-4 w-4" />
                      لصق نص
                    </button>
                    <button
                      onClick={() => setSummaryInputMode('file')}
                      disabled={creatingSummary}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'file'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Upload className="h-4 w-4" />
                      رفع ملف PDF
                    </button>
                  </div>
                </div>

                {/* Text input */}
                {summaryInputMode === 'text' && (
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      المحتوى
                    </label>
                    <textarea
                      value={summaryText}
                      onChange={(e) => setSummaryText(e.target.value)}
                      placeholder="الصق المحتوى الدراسي هنا..."
                      rows={6}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors resize-none"
                      disabled={creatingSummary}
                      dir="rtl"
                    />
                  </div>
                )}

                {/* File upload */}
                {summaryInputMode === 'file' && (
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      ملف PDF
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setSummaryFile(e.target.files?.[0] || null)}
                      className="hidden"
                      disabled={creatingSummary}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={creatingSummary}
                      className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50/30 p-6 transition-colors hover:border-emerald-400 hover:bg-emerald-50/50"
                    >
                      {summaryFile ? (
                        <>
                          <FileUp className="h-8 w-8 text-emerald-600" />
                          <span className="text-sm font-medium text-emerald-700">{summaryFile.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {(summaryFile.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-emerald-400" />
                          <span className="text-sm text-muted-foreground">اضغط لاختيار ملف PDF</span>
                          <span className="text-xs text-muted-foreground/60">الحد الأقصى 10 MB</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Processing indicator */}
                {summaryStep === 'processing' && creatingSummary && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                      <div>
                        <p className="text-sm font-medium text-emerald-700">جاري استخراج النص من الملف...</p>
                        <p className="text-xs text-emerald-600/70 mt-0.5">يرجى الانتظار</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex items-center gap-3 border-t p-5">
                <button
                  onClick={handleCreateSummary}
                  disabled={creatingSummary}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {creatingSummary ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري الإنشاء...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      إنشاء الملخص
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (!creatingSummary) setNewSummaryOpen(false);
                  }}
                  disabled={creatingSummary}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Quizzes Section
  // -------------------------------------------------------
  const renderQuizzes = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h2 className="text-xl sm:text-2xl font-bold text-foreground">الاختبارات</h2>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">اختباراتك واختبارات المعلمين</p>
      </motion.div>

      {/* Quizzes grid */}
      {quizzes.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-teal-300 bg-teal-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 mb-4">
            <ClipboardList className="h-8 w-8 text-teal-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد اختبارات</p>
          <p className="text-sm text-muted-foreground mb-4">
            أنشئ ملخصاً أولاً وسيتم توليد اختبار تلقائياً
          </p>
          <button
            onClick={() => router.push('/student/summaries')}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
          >
            <FileText className="h-4 w-4" />
            إنشاء ملخص
          </button>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quizzes.map((quiz) => {
            const isCompleted = completedQuizIds.has(quiz.id);
            const score = scores.find((s) => s.quiz_id === quiz.id);
            const pct = score ? scorePercentage(score.score, score.total) : null;

            return (
              <motion.div key={quiz.id} variants={itemVariants} {...cardHover}>
                <div className="group rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-100 transition-transform group-hover:scale-110">
                      <ClipboardList className="h-5 w-5 text-teal-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{quiz.title}</h3>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          {quiz.questions?.length || 0} أسئلة
                        </span>
                        {quiz.duration && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {quiz.duration} دقيقة
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status badge */}
                    {isCompleted && pct !== null && (
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                          pct >= 80
                            ? 'text-emerald-700 bg-emerald-100'
                            : pct >= 60
                              ? 'text-amber-700 bg-amber-100'
                              : 'text-rose-700 bg-rose-100'
                        }`}
                      >
                        {pct}%
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    {isCompleted ? (
                      <button
                        onClick={() => router.push(`/quiz/${quiz.id}`)}
                        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        عرض النتائج
                      </button>
                    ) : (
                      <button
                        onClick={() => router.push(`/quiz/${quiz.id}`)}
                        className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-teal-700"
                      >
                        <Play className="h-3.5 w-3.5" />
                        ابدأ الاختبار
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Teachers Section
  // -------------------------------------------------------
  const renderTeachers = () => {
    const hasAnyTeachers = linkedTeachers.length > 0 || pendingLinkTeachers.length > 0 || rejectedLinkTeachers.length > 0;

    return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">المعلمون</h2>
          <p className="text-muted-foreground mt-1">معلموك المسجلون في المنصة</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Incoming Link Requests Button */}
          <button
            onClick={() => setIncomingPanelOpen(true)}
            className="relative flex items-center gap-2 rounded-xl border border-amber-200/70 bg-gradient-to-b from-amber-50 to-orange-50/50 px-3.5 py-2 text-sm font-medium text-amber-700 hover:from-amber-100 hover:to-orange-100/60 shadow-sm shadow-amber-100/30 hover:shadow-md hover:shadow-amber-100/40 transition-all duration-200 active:scale-[0.97]"
          >
            <UserPlus className="h-4 w-4" />
            <span>طلبات واردة</span>
            {incomingLinkRequests.length > 0 ? (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-amber-300/50">
                {incomingLinkRequests.length}
              </span>
            ) : (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-200/80 px-1.5 text-[10px] font-bold text-amber-600">
                0
              </span>
            )}
          </button>
          <button
            onClick={() => setLinkTeacherOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            <UserPlus className="h-4 w-4" />
            الارتباط بمعلم جديد
          </button>
        </div>
      </motion.div>

      {/* Empty state */}
      {!hasAnyTeachers && (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <Users className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا يوجد معلمون</p>
          <p className="text-sm text-muted-foreground mb-4">
            اربط حسابك مع معلمك باستخدام الرمز الخاص به
          </p>
          <button
            onClick={() => setLinkTeacherOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            <Link2 className="h-4 w-4" />
            الارتباط بمعلم جديد
          </button>
        </motion.div>
      )}

      {/* ============================================================ */}
      {/* Centered Modal for Incoming Link Requests                     */}
      {/* ============================================================ */}
      <AnimatePresence>
        {incomingPanelOpen && (
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
              onClick={() => setIncomingPanelOpen(false)}
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
              {/* Modal Header */}
              <div className="shrink-0 px-6 pt-6 pb-5 bg-gradient-to-b from-amber-50/60 via-emerald-50/30 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 shadow-sm shadow-amber-200/50">
                      <UserPlus className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">طلبات الارتباط الواردة</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {incomingLinkRequests.length > 0
                          ? `${incomingLinkRequests.length} طلب بانتظار المراجعة`
                          : 'لا توجد طلبات واردة حالياً'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIncomingPanelOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/60 hover:text-foreground transition-all duration-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* Bulk actions */}
                {incomingLinkRequests.length > 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 }}
                    className="flex items-center gap-2.5 mt-5"
                  >
                    <button
                      onClick={() => setConfirmIncomingAcceptAllOpen(true)}
                      disabled={processingIncomingBulk}
                      className="flex items-center gap-2 rounded-xl bg-emerald-600/90 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-emerald-200/50 hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60 transition-all duration-200 disabled:opacity-50 disabled:shadow-none"
                    >
                      {processingIncomingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      قبول الكل ({incomingLinkRequests.length})
                    </button>
                    <button
                      onClick={() => setConfirmIncomingRejectAllOpen(true)}
                      disabled={processingIncomingBulk}
                      className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 hover:border-rose-300 transition-all duration-200 disabled:opacity-50"
                    >
                      {processingIncomingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      رفض الكل
                    </button>
                  </motion.div>
                )}
              </div>
              {/* Incoming requests list */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {incomingLinkRequests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 mb-4">
                      <UserPlus className="h-7 w-7 text-amber-300" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">لا توجد طلبات واردة</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">عندما يرسل معلم طلب ارتباط سيظهر هنا</p>
                  </div>
                ) : (
                  incomingLinkRequests.map(({ teacher, notificationId }) => (
                    <motion.div
                      key={teacher.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card/80 p-3.5 shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      <UserLink
                        userId={teacher.id}
                        name={teacher.name}
                        avatarUrl={teacher.avatar_url}
                        role="teacher"
                        gender={teacher.gender}
                        titleId={teacher.title_id}
                        size="md"
                        showAvatar={true}
                        showUsername={false}
                        className="flex-1 min-w-0"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleAcceptIncomingRequest(teacher.id, notificationId)}
                          disabled={processingIncomingId === teacher.id || processingIncomingBulk}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all duration-200 active:scale-90"
                          title="قبول"
                        >
                          {processingIncomingId === teacher.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleRejectIncomingRequest(teacher.id, notificationId)}
                          disabled={processingIncomingId === teacher.id || processingIncomingBulk}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-500 hover:bg-rose-100 hover:border-rose-300 disabled:opacity-50 transition-all duration-200 active:scale-90"
                          title="رفض"
                        >
                          {processingIncomingId === teacher.id ? (
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

      {/* Accept All Incoming Confirmation Dialog */}
      <AnimatePresence>
        {confirmIncomingAcceptAllOpen && (
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
                  هل أنت متأكد من قبول جميع طلبات الارتباط الواردة ({incomingLinkRequests.length} طلب)؟
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleAcceptAllIncoming}
                    disabled={processingIncomingBulk}
                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                  >
                    {processingIncomingBulk ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : `قبول الكل (${incomingLinkRequests.length})`}
                  </button>
                  <button
                    onClick={() => setConfirmIncomingAcceptAllOpen(false)}
                    disabled={processingIncomingBulk}
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

      {/* Reject All Incoming Confirmation Dialog */}
      <AnimatePresence>
        {confirmIncomingRejectAllOpen && (
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
                  هل أنت متأكد من رفض جميع طلبات الارتباط الواردة ({incomingLinkRequests.length} طلب)؟ لا يمكن التراجع عن هذا الإجراء.
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleRejectAllIncoming}
                    disabled={processingIncomingBulk}
                    className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
                  >
                    {processingIncomingBulk ? <Loader2 className="h-4 w-4 animate-spin inline-block" /> : `رفض الكل (${incomingLinkRequests.length})`}
                  </button>
                  <button
                    onClick={() => setConfirmIncomingRejectAllOpen(false)}
                    disabled={processingIncomingBulk}
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

      {/* Pending requests */}
      {pendingLinkTeachers.length > 0 && (
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-amber-200 p-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100">
                <Loader2 className="h-4 w-4 text-amber-600" />
              </div>
              <h3 className="font-semibold text-amber-800">طلبات الارتباط المعلقة</h3>
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800">
                {pendingLinkTeachers.length}
              </span>
            </div>
            <div className="divide-y divide-amber-100">
              {pendingLinkTeachers.map((teacher) => {
                return (
                  <div key={teacher.id} className="flex items-center justify-between p-4">
                    <UserLink
                      userId={teacher.id}
                      name={teacher.name}
                      avatarUrl={teacher.avatar_url}
                      role="teacher"
                      gender={teacher.gender}
                      titleId={teacher.title_id}
                      size="sm"
                      showAvatar={true}
                      showUsername={false}
                    />
                    <button
                      onClick={() => handleCancelLinkRequest(teacher.id)}
                      disabled={cancelingRequestId === teacher.id}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-60"
                    >
                      {cancelingRequestId === teacher.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                      إلغاء الطلب
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* Rejected requests */}
      {rejectedLinkTeachers.length > 0 && (
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-rose-200 p-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100">
                <X className="h-4 w-4 text-rose-600" />
              </div>
              <h3 className="font-semibold text-rose-800">طلبات مرفوضة</h3>
              <span className="rounded-full bg-rose-200 px-2 py-0.5 text-xs font-bold text-rose-800">
                {rejectedLinkTeachers.length}
              </span>
            </div>
            <div className="divide-y divide-rose-100">
              {rejectedLinkTeachers.map((teacher) => {
                return (
                  <div key={teacher.id} className="flex items-center justify-between p-4">
                    <UserLink
                      userId={teacher.id}
                      name={teacher.name}
                      avatarUrl={teacher.avatar_url}
                      role="teacher"
                      gender={teacher.gender}
                      titleId={teacher.title_id}
                      size="sm"
                      showAvatar={true}
                      showUsername={false}
                    />
                    <button
                      onClick={() => handleDismissRejectedLink(teacher.id)}
                      disabled={cancelingRequestId === teacher.id}
                      className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-60"
                    >
                      {cancelingRequestId === teacher.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      إزالة
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* Approved teachers list - grid layout */}
      {linkedTeachers.length > 0 && (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {linkedTeachers.map((teacher) => {
            return (
              <motion.div key={teacher.id} variants={itemVariants}>
                <div
                  className="group w-full flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm hover:shadow-md transition-shadow text-right"
                >
                  <UserLink
                    userId={teacher.id}
                    name={teacher.name}
                    avatarUrl={teacher.avatar_url}
                    role="teacher"
                    gender={teacher.gender}
                    titleId={teacher.title_id}
                    size="sm"
                    showAvatar={true}
                    showUsername={false}
                    className="flex-1 min-w-0"
                  />
                  <button
                    onClick={() => handleTeacherClick(teacher)}
                    className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="تفاصيل المعلم"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Teacher Detail Modal */}
      <AnimatePresence>
        {selectedTeacher && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (deletingLinkId !== selectedTeacher.id) {
                setSelectedTeacher(null);
                setUnlinkConfirmOpen(false);
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Users className="h-5 w-5 text-emerald-600" />
                  بيانات المعلم
                </h3>
                <button
                  onClick={() => {
                    setSelectedTeacher(null);
                    setUnlinkConfirmOpen(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-5">
                {/* Teacher info */}
                <UserLink
                  userId={selectedTeacher.id}
                  name={selectedTeacher.name}
                  avatarUrl={selectedTeacher.avatar_url}
                  role="teacher"
                  gender={selectedTeacher.gender}
                  titleId={selectedTeacher.title_id}
                  size="lg"
                  showAvatar={true}
                  showUsername={false}
                />

                {/* Teacher's subjects */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <BookMarked className="h-4 w-4 text-emerald-600" />
                    المقررات
                  </h4>
                  {loadingTeacherSubjects ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                    </div>
                  ) : teacherSubjects.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/30 p-4 text-center">
                      <p className="text-sm text-muted-foreground">لا توجد مقررات لهذا المعلم</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                      {teacherSubjects.map((subject) => (
                        <div
                          key={subject.id}
                          className="flex items-center gap-3 rounded-lg border bg-card p-3"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                            <BookOpen className="h-4 w-4 text-emerald-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{subject.name}</p>
                            {subject.description && (
                              <p className="text-xs text-muted-foreground line-clamp-1">{subject.description}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Unlink section */}
                <div className="rounded-lg border border-rose-100 bg-rose-50/30 p-3 space-y-2">
                  {!unlinkConfirmOpen ? (
                    <button
                      onClick={() => setUnlinkConfirmOpen(true)}
                      className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-100 hover:border-rose-300 transition-colors"
                    >
                      <Unlink className="h-3 w-3" />
                      إلغاء الربط
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-rose-600 font-medium">
                        هل أنت متأكد؟ لن تتمكن من رؤية اختباراته بعد الآن.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleUnlinkTeacher(selectedTeacher.id)}
                          disabled={deletingLinkId === selectedTeacher.id}
                          className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60 transition-colors"
                        >
                          {deletingLinkId === selectedTeacher.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <Unlink className="h-3 w-3" />
                              تأكيد
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setUnlinkConfirmOpen(false)}
                          disabled={deletingLinkId === selectedTeacher.id}
                          className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors"
                        >
                          تراجع
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Link Teacher Modal */}
      <AnimatePresence>
        {linkTeacherOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!linkingTeacher && !searchingTeacher) {
                setLinkTeacherOpen(false);
                setTeacherPreview(null);
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-emerald-600" />
                  الارتباط بمعلم جديد
                </h3>
                <button
                  onClick={() => {
                    if (!linkingTeacher && !searchingTeacher) {
                      setLinkTeacherOpen(false);
                      setTeacherPreview(null);
                    }
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-4">
                {/* Step 1: Enter teacher code */}
                {!teacherPreview && (
                  <>
                    <div className="flex flex-col items-center gap-3 py-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                        <Search className="h-7 w-7 text-emerald-600" />
                      </div>
                      <p className="text-sm text-muted-foreground text-center">
                        أدخل رمز المعلم الخاص للبحث عنه
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1.5 block">رمز المعلم</label>
                      <input
                        type="text"
                        value={teacherCode}
                        onChange={(e) => {
                          setTeacherCode(e.target.value.toUpperCase());
                          setTeacherPreview(null);
                        }}
                        placeholder="مثال: ABC123"
                        className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-center tracking-widest font-mono"
                        disabled={searchingTeacher}
                        dir="ltr"
                        maxLength={10}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !searchingTeacher && teacherCode.trim()) handleSearchTeacher();
                        }}
                      />
                    </div>
                  </>
                )}

                {/* Step 2: Teacher preview card */}
                {teacherPreview && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                    <UserLink
                      userId={teacherPreview.id}
                      name={teacherPreview.name || 'معلم'}
                      avatarUrl={teacherPreview.avatar_url}
                      role="teacher"
                      gender={teacherPreview.gender}
                      titleId={teacherPreview.title_id}
                      size="md"
                      showAvatar={true}
                      showUsername={false}
                    />
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-100/60 px-3 py-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span className="text-xs text-emerald-700 font-medium">تم العثور على المعلم — اضغط "إرسال طلب" للتأكيد</span>
                    </div>
                    <button
                      onClick={() => {
                        setTeacherPreview(null);
                        setTeacherCode('');
                      }}
                      disabled={linkingTeacher}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                    >
                      تغيير الرمز
                    </button>
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex items-center gap-3 border-t p-5">
                {!teacherPreview ? (
                  <>
                    <button
                      onClick={handleSearchTeacher}
                      disabled={searchingTeacher || !teacherCode.trim()}
                      className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {searchingTeacher ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري البحث...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4" />
                          بحث
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleConfirmLinkTeacher}
                      disabled={linkingTeacher}
                      className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {linkingTeacher ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري إرسال الطلب...
                        </>
                      ) : (
                        <>
                          <Link2 className="h-4 w-4" />
                          إرسال طلب
                        </>
                      )}
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    if (!linkingTeacher && !searchingTeacher) {
                      setLinkTeacherOpen(false);
                      setTeacherPreview(null);
                    }
                  }}
                  disabled={linkingTeacher || searchingTeacher}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Section content
  // -------------------------------------------------------
  const renderSection = () => {
    // Only the dashboard section needs to wait for data
    // Other sections (chat, settings, etc.) load independently
    if (activeSection === 'dashboard' && !dataLoaded) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mb-4" />
          <p className="text-muted-foreground text-sm">جاري تحميل البيانات...</p>
        </div>
      );
    }

    switch (activeSection) {
      case 'dashboard':
        return renderDashboard();
      case 'subjects':
        return selectedSubjectId
          ? <CoursePage profile={profile} role="student" />
          : <SubjectsSection profile={profile} role="student" />;
      case 'summaries':
        return renderSummaries();
      case 'assignments':
        return <AssignmentsSection profile={profile} role="student" />;
      case 'files':
        return <PersonalFilesSection profile={profile} role="student" />;
      case 'teachers':
        return renderTeachers();
      case 'chat':
        return <ChatSection profile={profile} role="student" />;
      case 'settings':
        return <SettingsSection profile={profile} onUpdateProfile={handleUpdateProfile} onDeleteAccount={handleDeleteAccount} />;
      case 'notifications':
        return <NotificationsSection />;
      default:
        return null;
    }
  };

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <AppHeader
        userName={profile.name}
        userId={profile.id}
        userRole="student"
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
        role="student"
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />

      {/* Main Content - dynamic offset for collapsible sidebar */}
      <main className={`min-h-screen pt-14 sm:pt-16 transition-all duration-300 ${
        sidebarOpen ? 'md:mr-64' : 'md:mr-[68px]'
      }`}>
        <div className="p-3 sm:p-6 lg:p-8 space-y-4">
          <AnnouncementsBanner userId={profile.id} />
          <SectionErrorBoundary sectionName={activeSection}>
            <div className="relative">
              {/* Keep-alive: All mounted sections stay in DOM, only active one is visible */}
              {/* This prevents the expensive unmount/remount cycle that caused navigation freezes */}
              {isSectionMounted('dashboard') && (
                <div className={activeSection === 'dashboard' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'dashboard'}>
                  {activeSection === 'dashboard' && !dataLoaded ? (
                    <div className="flex flex-col items-center justify-center py-20">
                      <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mb-4" />
                      <p className="text-muted-foreground text-sm">جاري تحميل البيانات...</p>
                    </div>
                  ) : renderDashboard()}
                </div>
              )}
              {isSectionMounted('subjects') && (
                <div className={activeSection === 'subjects' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'subjects'}>
                  {selectedSubjectId ? (
                    <CoursePage profile={profile} role="student" />
                  ) : (
                    <SubjectsSection profile={profile} role="student" />
                  )}
                </div>
              )}
              {isSectionMounted('summaries') && (
                <div className={activeSection === 'summaries' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'summaries'}>
                  {renderSummaries()}
                </div>
              )}
              {isSectionMounted('assignments') && (
                <div className={activeSection === 'assignments' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'assignments'}>
                  <AssignmentsSection profile={profile} role="student" />
                </div>
              )}
              {isSectionMounted('files') && (
                <div className={activeSection === 'files' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'files'}>
                  <PersonalFilesSection profile={profile} role="student" />
                </div>
              )}
              {isSectionMounted('teachers') && (
                <div className={activeSection === 'teachers' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'teachers'}>
                  {renderTeachers()}
                </div>
              )}
              {isSectionMounted('chat') && (
                <div className={activeSection === 'chat' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'chat'}>
                  <ChatSection profile={profile} role="student" />
                </div>
              )}
              {isSectionMounted('settings') && (
                <div className={activeSection === 'settings' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'settings'}>
                  <SettingsSection profile={profile} onUpdateProfile={handleUpdateProfile} onDeleteAccount={handleDeleteAccount} />
                </div>
              )}
              {isSectionMounted('notifications') && (
                <div className={activeSection === 'notifications' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'notifications'}>
                  <NotificationsSection />
                </div>
              )}
              {isSectionMounted('quizzes') && (
                <div className={activeSection === 'quizzes' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'quizzes'}>
                  {renderQuizzes()}
                </div>
              )}
              {isSectionMounted('attendance') && (
                <div className={activeSection === 'attendance' ? '' : 'hidden'} role="tabpanel" aria-hidden={activeSection !== 'attendance'}>
                  <AttendanceSection profile={profile} role="student" />
                </div>
              )}
            </div>
          </SectionErrorBoundary>
        </div>
      </main>

      {/* Custom scrollbar styles */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: hsl(var(--muted-foreground) / 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: hsl(var(--muted-foreground) / 0.35);
        }
        .line-clamp-1 {
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
