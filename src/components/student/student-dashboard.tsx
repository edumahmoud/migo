'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  ChevronRight,
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
  FolderOpen,
  TrendingUp,
  XCircle,
  AlertTriangle,
  ListChecks,
  File,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { waitForSession as waitForSessionShared, getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import AppSidebar from '@/components/shared/app-sidebar';
import AppHeader from '@/components/shared/app-header';
import MobileBottomNav from '@/components/shared/mobile-bottom-nav';
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
import type { UserProfile, Summary, Quiz, Score, StudentSection, Subject, UserFile, Submission, Assignment } from '@/lib/types';
import { extractPdfTextClient, extractTextFromFile } from '@/lib/pdf-client';
import { useIsMobile } from '@/hooks/use-mobile';
import UserAvatar from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import SummaryView from '@/components/shared/summary-view';
import StudentTrackingSection from '@/components/student/student-tracking-section';

// -------------------------------------------------------
// Summary background processing type
// -------------------------------------------------------
interface PendingSummary {
  id: string;
  title: string;
  mode: 'text' | 'file' | 'transcribe' | 'existing';
  status: 'extracting' | 'summarizing' | 'saving' | 'cancelled';
  startedAt: number;
  abortController: AbortController;
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

const cardHover = {
  whileHover: { scale: 1.02, y: -2 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
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
  const { studentSection: storedStudentSection, setStudentSection: storeSetStudentSection, setViewingQuizId, setViewingSummaryId, viewingSummaryId, selectedSubjectId, setSelectedSubjectId, sidebarOpen, setSidebarOpen } = useAppStore();

  // ─── Local active section synced with store ───
  const [activeSection, setActiveSection] = useState<StudentSection>(storedStudentSection || 'dashboard');

  // Keep local state in sync when store changes (e.g. notification navigation)
  useEffect(() => {
    if (storedStudentSection && storedStudentSection !== activeSection) {
      setActiveSection(storedStudentSection);
    }
  }, [storedStudentSection, activeSection]);

  // When navigating away from subjects, clear selectedSubjectId
  useEffect(() => {
    if (activeSection !== 'subjects' && selectedSubjectId) {
      setSelectedSubjectId(null);
    }
  }, [activeSection, selectedSubjectId, setSelectedSubjectId]);

  // ─── Auth store ───
  const { updateProfile: authUpdateProfile, signOut: authSignOut } = useAuthStore();

  // ─── Data state ───
  // RADICAL FIX: Initialize summaries from localStorage cache SYNCHRONOUSLY.
  // This eliminates the flash of empty content on page refresh.
  // Previously, useState([]) started empty and cache was loaded in useEffect (after render),
  // causing a visible flicker and a window where concurrent fetches could wipe data.
  const [summaries, setSummaries] = useState<Summary[]>(() => {
    try {
      const cached = localStorage.getItem(`summaries_${profile.id}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log('[Init] Loaded', parsed.length, 'summaries from localStorage cache (synchronous)');
          return parsed;
        }
      }
    } catch { /* ignore corrupted cache */ }
    return [];
  });
  // Ref to track current summaries for protection against wiping on refresh
  const summariesRef = useRef<Summary[]>(summaries); // Initialize with cached data

  // ─── FIX #1: Fetch queue (replaces simple mutex) ───
  // Instead of skipping duplicate fetch requests, we queue them.
  // When a fetch is already in progress, we record that a re-fetch is needed
  // and execute it after the current one finishes. This prevents data loss
  // from dropped fetches during race conditions (e.g., auth event + mount).
  const fetchInProgressRef = useRef(false);
  const fetchQueuedRef = useRef(false);

  // ─── FIX #2: Fetch generation counter ───
  // Each fetch gets a monotonically increasing generation number.
  // safeSetSummaries only accepts results from the LATEST generation,
  // so stale results from older fetches can't overwrite newer data.
  // This also allows newer empty lists to replace older non-empty data.
  const fetchGenerationRef = useRef(0);

  // Track recently deleted summary IDs to filter stale re-fetch results
  const recentlyDeletedSummaryIdsRef = useRef<Set<string>>(new Set());

  // Track recently added summary IDs to protect optimistic updates from being overwritten
  // by a stale fetchSummaries result that hasn't picked up the new summary yet.
  // Entries auto-expire after 15 seconds (enough for DB propagation + Realtime).
  const recentlyAddedSummaryIdsRef = useRef<Map<string, number>>(new Map());

  // ─── FIX #8: Fallback polling for auto-update ───
  // Poll every 60s as a fallback for Realtime disconnections
  const POLL_INTERVAL_MS = 60000;
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<{ id: string; session_id: string; student_id: string; checked_in_at: string }[]>([]);
  const [attendanceSessions, setAttendanceSessions] = useState<{ id: string; subject_id: string; status: string }[]>([]);
  const [linkedTeachers, setLinkedTeachers] = useState<UserProfile[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [loadingData, setLoadingData] = useState(true);

  // ─── New summary modal ───
  const [newSummaryOpen, setNewSummaryOpen] = useState(false);
  const [summaryTitle, setSummaryTitle] = useState('');
  const [summaryInputMode, setSummaryInputMode] = useState<'text' | 'file' | 'transcribe' | 'existing'>('text');
  const [summaryText, setSummaryText] = useState('');
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const [summaryFileBuffer, setSummaryFileBuffer] = useState<ArrayBuffer | null>(null);
  const [summaryFileName, setSummaryFileName] = useState<string>('');
  const [creatingSummary, setCreatingSummary] = useState(false);
  const [summaryStep, setSummaryStep] = useState<'input' | 'processing'>('input');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Mobile detection ───
  const isMobile = useIsMobile();

  // ─── File input handler: pre-read file into ArrayBuffer immediately ───
  // On mobile browsers, File objects can become invalid when the <input>
  // element is unmounted (e.g. modal closes) or when the user switches tabs.
  // By reading the ArrayBuffer immediately in the onChange handler, we
  // ensure the file data is captured in memory regardless of what happens
  // to the File reference later.
  const handleSummaryFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSummaryFile(null);
      setSummaryFileBuffer(null);
      setSummaryFileName('');
      return;
    }
    setSummaryFile(file);
    setSummaryFileName(file.name);
    // Enforce file size limit (10MB) immediately
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('حجم الملف يتجاوز الحد الأقصى (10 MB). يرجى اختيار ملف أصغر');
      setSummaryFile(null);
      setSummaryFileBuffer(null);
      setSummaryFileName('');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      setSummaryFileBuffer(buffer);
      console.log('[Summary] Pre-read file data in onChange, size:', buffer.byteLength, 'bytes');
    } catch (err) {
      console.error('[Summary] Failed to pre-read file in onChange:', err);
      // Don't block — the file object is still available as fallback
      setSummaryFileBuffer(null);
    }
  }, []);

  // ─── Existing files state (for 'existing' mode) ───
  const [existingFiles, setExistingFiles] = useState<UserFile[]>([]);
  const [selectedExistingFile, setSelectedExistingFile] = useState<UserFile | null>(null);
  const [loadingExistingFiles, setLoadingExistingFiles] = useState(false);
  const [existingFileTranscribe, setExistingFileTranscribe] = useState(false); // true = transcribe only, false = summarize

  // ─── Link teacher modal ───
  const [linkTeacherOpen, setLinkTeacherOpen] = useState(false);
  const [teacherCode, setTeacherCode] = useState('');
  const [linkingTeacher, setLinkingTeacher] = useState(false);
  const [teacherPreview, setTeacherPreview] = useState<UserProfile | null>(null);
  const [searchingTeacher, setSearchingTeacher] = useState(false);

  // ─── Deleting summary state ───
  const [deletingSummaryId, setDeletingSummaryId] = useState<string | null>(null);

  // ─── Background summary processing state ───
  const [pendingSummaries, setPendingSummaries] = useState<PendingSummary[]>([]);

  // ─── Auto-cleanup for stale pending summaries (Bug Fix #3) ───
  // If a pending summary has been in progress for more than 5 minutes
  // (mobile connections can be slow for PDF extraction + AI),
  // something went wrong — abort it and show an error.
  useEffect(() => {
    if (pendingSummaries.length === 0) return;
    const staleThreshold = 5 * 60 * 1000; // 5 minutes (increased for mobile)
    const interval = setInterval(() => {
      setPendingSummaries(prev => {
        const now = Date.now();
        const stillValid = prev.filter(ps => {
          const isStale = now - ps.startedAt > staleThreshold;
          if (isStale && ps.status !== 'cancelled') {
            console.warn('[Summary] Auto-cleanup: removing stale pending summary:', ps.title);
            // Abort the fetch if still in progress
            try { ps.abortController.abort(); } catch { /* ignore */ }
            toast.error(`انتهت مهلة إنشاء ملخص "${ps.title}". يرجى المحاولة مرة أخرى`, { duration: 8000, id: `stale-${ps.id}` });
            return false;
          }
          return ps.status !== 'cancelled';
        });
        return stillValid;
      });
    }, 15000); // Check every 15 seconds
    return () => clearInterval(interval);
  }, [pendingSummaries.length]);

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

  // ─── Quiz config modal ───
  const [quizConfigOpen, setQuizConfigOpen] = useState(false);
  const [quizConfigSummaryId, setQuizConfigSummaryId] = useState<string | null>(null);
  const [quizConfigSummaryTitle, setQuizConfigSummaryTitle] = useState('');
  const [quizConfigTypes, setQuizConfigTypes] = useState({ mcq: 2, boolean: 2, completion: 2, matching: 2 });
  const [quizAnswerMode, setQuizAnswerMode] = useState<'during' | 'after'>('after');
  const [quizAllowRetake, setQuizAllowRetake] = useState(true);
  const [quizShuffleQuestions, setQuizShuffleQuestions] = useState(true);
  const [creatingQuizFromSummary, setCreatingQuizFromSummary] = useState(false);

  // ─── Teacher detail modal ───
  const [selectedTeacher, setSelectedTeacher] = useState<UserProfile | null>(null);
  const [teacherSubjects, setTeacherSubjects] = useState<Subject[]>([]);
  const [loadingTeacherSubjects, setLoadingTeacherSubjects] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);

  // Keep summariesRef in sync with summaries state
  useEffect(() => {
    summariesRef.current = summaries;
  }, [summaries]);

  /**
   * FIX #2: Safe setter with generation-aware empty list acceptance.
   *
   * Previous version NEVER allowed empty data to replace existing data.
   * This caused a bug: when a user legitimately deletes all their summaries,
   * a stale fetch result (non-empty, from before the delete) could arrive
   * AFTER the legitimate empty result, re-adding the deleted summaries.
   *
   * New approach: Use a fetch generation counter. Each fetch increments the
   * generation. safeSetSummaries only accepts results from the CURRENT
   * generation (or higher). This means:
   *   - Stale results from older fetches are always rejected
   *   - A newer empty list CAN replace older non-empty data (legitimate delete-all)
   *   - A stale non-empty list CANNOT replace a newer empty list
   *
   * The `force` parameter bypasses generation checks for user-initiated actions.
   */
  const safeSetSummaries = useCallback((newSummaries: Summary[], generation: number, force: boolean = false) => {
    if (!force) {
      // Reject stale results from older fetch generations
      if (generation < fetchGenerationRef.current) {
        console.warn('[safeSetSummaries] REJECTED stale result (gen', generation, '< current', fetchGenerationRef.current, ') — keeping existing data');
        return;
      }
      // Accept newer results (even empty) since they come from a more recent fetch
      // This fixes the case where a user deletes all summaries and the empty
      // result should be accepted, but also prevents old fetches from overwriting
      console.log('[safeSetSummaries] Accepting result from gen', generation, '(current:', fetchGenerationRef.current, '), count:', newSummaries.length);
    }
    // Update the generation ref to the latest accepted generation
    if (generation > fetchGenerationRef.current) {
      fetchGenerationRef.current = generation;
    }
    if (newSummaries.length > 0) {
      // Cache to localStorage on every successful non-empty update
      try {
        localStorage.setItem(`summaries_${profile.id}`, JSON.stringify(newSummaries));
        localStorage.setItem(`summaries_${profile.id}_ts`, String(Date.now()));
      } catch { /* localStorage might be unavailable */ }
    } else {
      // Clear cache when summaries become empty (legitimate delete-all or fresh empty result)
      try {
        localStorage.removeItem(`summaries_${profile.id}`);
        localStorage.removeItem(`summaries_${profile.id}_ts`);
      } catch { /* ignore */ }
    }
    // Filter out recently deleted IDs before setting state
    let filtered = newSummaries.filter(s => !recentlyDeletedSummaryIdsRef.current.has(s.id));

    // ─── Protect recently added summaries from being overwritten by stale fetches ───
    // When we do an optimistic update after creating a summary, the next fetchSummaries()
    // may return data that doesn't include the new summary yet (DB propagation delay).
    // We preserve recently added summaries by merging them into the fetched result.
    const now = Date.now();
    const PROTECTION_DURATION_MS = 15000; // 15 seconds — enough for DB propagation + Realtime
    if (recentlyAddedSummaryIdsRef.current.size > 0) {
      const fetchedIds = new Set(filtered.map(s => s.id));
      const currentSummaries = summariesRef.current;
      for (const [id, addedAt] of recentlyAddedSummaryIdsRef.current) {
        // Only protect if within the protection window and not already in the fetched result
        if (now - addedAt < PROTECTION_DURATION_MS && !fetchedIds.has(id)) {
          const existingInLocal = currentSummaries.find(s => s.id === id);
          if (existingInLocal) {
            console.log('[safeSetSummaries] Preserving recently added summary:', id);
            filtered = [existingInLocal, ...filtered];
          }
        } else if (now - addedAt >= PROTECTION_DURATION_MS) {
          // Expired — clean up
          recentlyAddedSummaryIdsRef.current.delete(id);
        }
      }
    }

    setSummaries(filtered);
  }, [profile.id]);

  // -------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------
  /**
   * Wait for a valid Supabase auth session with exponential backoff.
   * On mobile, session hydration from localStorage can be slow (1-5s),
   * so we need multiple retries before giving up.
   * Uses the shared utility from @/lib/client-auth for consistency across all components.
   */
  const waitForSession = useCallback(async (maxWaitMs = 8000): Promise<string> => {
    return waitForSessionShared(maxWaitMs);
  }, []);

  /**
   * Load summaries from localStorage cache as a fallback.
   * Cache is considered valid for up to 1 hour.
   * NOTE: Since we now use lazy initialization in useState, this is only
   * needed as a fallback for error paths, not for initial mount.
   */
  const loadSummariesFromCache = useCallback(() => {
    try {
      const cached = localStorage.getItem(`summaries_${profile.id}`);
      const cacheTs = localStorage.getItem(`summaries_${profile.id}_ts`);
      if (cached) {
        const age = cacheTs ? Date.now() - parseInt(cacheTs) : Infinity;
        if (age < 3600000) { // less than 1 hour old
          const parsed = JSON.parse(cached) as Summary[];
          if (parsed.length > 0) {
            console.log('[loadSummariesFromCache] Loaded', parsed.length, 'summaries from cache (age:', Math.round(age / 1000), 's)');
            safeSetSummaries(parsed, 0, true); // force=true for cache load (generation=0, bypasses stale check)
            return;
          }
        }
      }
      console.warn('[loadSummariesFromCache] No valid cache found');
    } catch {
      // localStorage unavailable or corrupted
    }
  }, [profile.id, safeSetSummaries]);

  const fetchSummaries = useCallback(async () => {
    // ─── FIX #1: Fetch queue instead of simple mutex ───
    // On page refresh, fetchSummaries can be called simultaneously from:
    //   1. fetchAllData() useEffect
    //   2. Auth INITIAL_SESSION event listener
    // With a simple mutex, the second call was just skipped (data lost).
    // Now we QUEUE it: after the current fetch finishes, if a re-fetch was
    // requested, we run it again to pick up the latest data.
    if (fetchInProgressRef.current) {
      console.warn('[fetchSummaries] Fetch already in progress, QUEUEING a re-fetch');
      fetchQueuedRef.current = true;
      return;
    }
    fetchInProgressRef.current = true;

    // ─── FIX #2: Assign a generation to this fetch ───
    const thisGeneration = ++fetchGenerationRef.current;

    try {
      // Wait for auth session with progressive backoff (critical on mobile)
      const token = await waitForSession(8000);

      const res = await fetch('/api/summaries', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (res.ok) {
        const { data } = await res.json();
        const fetched = (data as Summary[]) || [];
        // safeSetSummaries checks generation before accepting
        safeSetSummaries(fetched, thisGeneration);
      } else {
        // API error (401, 500, etc.) — try direct Supabase query as fallback
        console.warn('[fetchSummaries] API returned', res.status, '— trying direct query...');
        try {
          const { data, error } = await supabase
            .from('summaries')
            .select('*')
            .eq('user_id', profile.id)
            .order('created_at', { ascending: false });
          if (!error && data) {
            const fetched = (data as Summary[]) || [];
            safeSetSummaries(fetched, thisGeneration);
          } else {
            loadSummariesFromCache();
          }
        } catch {
          loadSummariesFromCache();
        }
      }
    } catch (err) {
      console.error('[fetchSummaries] Error:', err);
      // Last resort: try direct Supabase query
      try {
        const { data, error } = await supabase
          .from('summaries')
          .select('*')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false });
        if (!error && data) {
          const fetched = (data as Summary[]) || [];
          safeSetSummaries(fetched, thisGeneration);
        } else {
          loadSummariesFromCache();
        }
      } catch {
        loadSummariesFromCache();
      }
    } finally {
      fetchInProgressRef.current = false;

      // ─── FIX #1: Process queued fetch ───
      // If another fetch was queued while we were running, execute it now.
      // Use setTimeout to avoid stack overflow and let the UI update first.
      if (fetchQueuedRef.current) {
        fetchQueuedRef.current = false;
        console.log('[fetchSummaries] Processing queued re-fetch');
        setTimeout(() => fetchSummaries(), 100);
      }
    }
  }, [profile.id, waitForSession, safeSetSummaries, loadSummariesFromCache]);

  const fetchQuizzes = useCallback(async () => {
    // Run own quizzes and teacher links queries in parallel
    const [ownResult, linksResult] = await Promise.all([
      supabase
        .from('quizzes')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('teacher_student_links')
        .select('teacher_id, status')
        .eq('student_id', profile.id),
    ]);

    const ownQuizzes = ownResult.data as Quiz[] || [];
    if (ownResult.error) {
      console.error('Error fetching own quizzes:', ownResult.error);
    }

    let teacherIds: string[] = [];
    if (linksResult.data && linksResult.data.length > 0) {
      const hasStatus = 'status' in linksResult.data[0];
      if (hasStatus) {
        teacherIds = linksResult.data.filter((l) => l.status === 'approved').map((l) => l.teacher_id);
      } else {
        teacherIds = linksResult.data.map((l) => l.teacher_id);
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
    const allQuizzes = [...ownQuizzes, ...teacherQuizzes];
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
          const batchToken = await waitForSession(5000);
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(batchToken ? { 'Authorization': `Bearer ${batchToken}` } : {}),
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
          const batchToken2 = await waitForSession(5000);
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(batchToken2 ? { 'Authorization': `Bearer ${batchToken2}` } : {}),
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

  // Fetch graded submissions and their assignments for performance calculation
  const fetchSubmissionsAndAssignments = useCallback(async () => {
    try {
      // Fetch graded submissions for this student
      const { data: subData, error: subError } = await supabase
        .from('submissions')
        .select('id, assignment_id, student_id, score, status, submitted_at, graded_at')
        .eq('student_id', profile.id)
        .eq('status', 'graded');
      if (!subError && subData) {
        setSubmissions(subData as Submission[]);
        // Get unique assignment IDs
        const assignmentIds = [...new Set(subData.map((s: Submission) => s.assignment_id))];
        if (assignmentIds.length > 0) {
          const { data: assignData, error: assignError } = await supabase
            .from('assignments')
            .select('id, subject_id, teacher_id, title, max_score, show_grade')
            .in('id', assignmentIds);
          if (!assignError && assignData) {
            setAssignments(assignData as Assignment[]);
          }
        }
      }
    } catch (err) {
      console.warn('[fetchSubmissionsAndAssignments] Error:', err);
    }
  }, [profile.id]);

  // Fetch attendance data for performance calculation
  const fetchAttendance = useCallback(async () => {
    try {
      // Get all attendance sessions for subjects the student is enrolled in
      const { data: enrollments } = await supabase
        .from('subject_students')
        .select('subject_id')
        .eq('student_id', profile.id);
      if (enrollments && enrollments.length > 0) {
        const subjectIds = enrollments.map(e => e.subject_id);
        const { data: sessions, error: sessError } = await supabase
          .from('attendance_sessions')
          .select('id, subject_id, status')
          .in('subject_id', subjectIds);
        if (!sessError && sessions) {
          setAttendanceSessions(sessions);
          // Get student's attendance records
          if (sessions.length > 0) {
            const sessionIds = sessions.map(s => s.id);
            const { data: records, error: recError } = await supabase
              .from('attendance_records')
              .select('id, session_id, student_id, checked_in_at')
              .eq('student_id', profile.id)
              .in('session_id', sessionIds);
            if (!recError && records) {
              setAttendanceRecords(records);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[fetchAttendance] Error:', err);
    }
  }, [profile.id]);

  // Load all data — PROGRESSIVE: show content as each fetch completes
  // Instead of blocking the entire UI on all 8 parallel requests,
  // we set loading false after a short delay (3s) or when critical data is ready.
  const fetchAllData = useCallback(async (silent = false) => {
    if (!silent) setLoadingData(true);

    // Start all fetches in parallel but don't await them all before showing UI
    const fetchPromises = [
      fetchSummaries(),
      fetchQuizzes(),
      fetchScores(),
      fetchLinkedTeachers(),
      fetchIncomingLinkRequests(),
      fetchFileCount(),
      fetchSubmissionsAndAssignments(),
      fetchAttendance(),
    ];

    // Show the dashboard after 3 seconds max, even if some fetches are still running
    const loadingTimeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn('[StudentDashboard] Progressive loading timeout (3s) — showing available data');
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
    // (they will update state when they complete)
    Promise.allSettled(fetchPromises).catch(() => {});
  }, [fetchSummaries, fetchQuizzes, fetchScores, fetchLinkedTeachers, fetchIncomingLinkRequests, fetchFileCount, fetchSubmissionsAndAssignments, fetchAttendance]);

  // RADICAL FIX: Removed the separate loadSummariesFromCache useEffect.
  // Cache is now loaded SYNCHRONOUSLY in useState initializer — no more flicker.
  // The fetchAllData useEffect handles server-side validation.

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // ─── Refresh data when navigating back to the dashboard section ───
  // The initial fetchAllData only runs on mount. When the user navigates
  // away (e.g., to "Subjects") and comes back to "dashboard", the data
  // is stale. This effect triggers a lightweight refresh on section change.
  useEffect(() => {
    if (activeSection === 'dashboard') {
      fetchSummaries();
      fetchQuizzes();
      fetchScores();
      fetchSubmissionsAndAssignments();
      fetchAttendance();
      fetchFileCount();
    }
  }, [activeSection, fetchSummaries, fetchQuizzes, fetchScores, fetchSubmissionsAndAssignments, fetchAttendance, fetchFileCount]);

  // ─── Recover pending summaries from sessionStorage (mobile refresh recovery) ───
  // On mobile, when the user refreshes the page while a summary is being created,
  // the in-memory pending state is lost. This effect checks sessionStorage for
  // any pending summaries that were being processed and shows a notification.
  // The actual summary creation continues on the server side — we just need to
  // poll for the result.
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('pendingSummaries') || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 minutes
        const recent = stored.filter((p: { id: string; title: string; startedAt: number }) => 
          now - p.startedAt < maxAge
        );
        if (recent.length > 0) {
          toast.info(`جاري التحقق من ${recent.length} ملخص قيد الإنشاء...`, { duration: 5000 });
          // Clear the stored pending summaries since we've acknowledged them
          sessionStorage.removeItem('pendingSummaries');
          // Re-fetch summaries to check if they've been created on the server
          setTimeout(() => fetchSummaries(), 3000);
        }
      }
    } catch { /* ignore corrupted sessionStorage */ }
  }, [fetchSummaries]);

  // ─── Loading timeout safety net ───
  // If loading takes too long (slow session hydration on mobile/PWA),
  // fall back to cached data and stop showing infinite loading spinner.
  // Reduced from 15s to 8s — the progressive loading in fetchAllData already
  // shows content after 3s, so this is just a hard safety limit.
  useEffect(() => {
    if (!loadingData) return;
    const timeout = setTimeout(() => {
      console.warn('[StudentDashboard] Loading timeout (8s) — falling back to cache');
      loadSummariesFromCache();
      setLoadingData(false);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [loadingData, loadSummariesFromCache]);

  // ─── Re-fetch summaries when auth session becomes available ───
  // On mobile, session hydration can be slow, so we listen for auth state changes
  // and retry fetching if we didn't have a token on the first attempt.
  // CRITICAL: INITIAL_SESSION fires on page refresh when session is re-hydrated.
  // Without handling it, summaries disappear after refresh on mobile.
  useEffect(() => {
    let cancelled = false;
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return;
      // INITIAL_SESSION: fires on page refresh when persisted session is loaded
      // SIGNED_IN: fires after explicit sign-in
      // TOKEN_REFRESHED: fires when the JWT is refreshed
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.access_token) {
        console.log('[Auth] Event:', event, '— re-fetching summaries...');
        fetchSummaries();
      }
    });
    return () => {
      cancelled = true;
      authListener?.subscription?.unsubscribe();
    };
  }, [fetchSummaries]);

  // -------------------------------------------------------
  // Realtime subscriptions
  // -------------------------------------------------------
  useEffect(() => {
    // ─── FIX #6: Local upsert instead of full refetch on Realtime ───
    // Previously, every Realtime event triggered a full `fetchSummaries()`.
    // This caused unnecessary network requests and potential race conditions.
    // Now we update local state directly based on the event payload,
    // and only do a full refetch if we detect a gap (missing data).
    const summariesChannel = supabase
      .channel('summaries-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'summaries', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          const newRecord = payload.new as Summary | null;
          const oldRecord = payload.old as { id: string } | null;

          if (eventType === 'INSERT' && newRecord) {
            // Add the new summary to local state (avoid duplicates)
            setSummaries(prev => {
              const exists = prev.some(s => s.id === newRecord.id);
              if (exists) return prev;
              const updated = [newRecord as Summary, ...prev];
              // Cache the updated list
              try {
                localStorage.setItem(`summaries_${profile.id}`, JSON.stringify(updated));
                localStorage.setItem(`summaries_${profile.id}_ts`, String(Date.now()));
              } catch { /* ignore */ }
              return updated;
            });
            // Clear the protection for this summary since it's now confirmed in DB
            recentlyAddedSummaryIdsRef.current.delete(newRecord.id);
          } else if (eventType === 'UPDATE' && newRecord) {
            // Update the existing summary in local state
            setSummaries(prev => {
              const updated = prev.map(s => s.id === newRecord.id ? (newRecord as Summary) : s);
              try {
                localStorage.setItem(`summaries_${profile.id}`, JSON.stringify(updated));
                localStorage.setItem(`summaries_${profile.id}_ts`, String(Date.now()));
              } catch { /* ignore */ }
              return updated;
            });
          } else if (eventType === 'DELETE' && oldRecord) {
            // Remove the summary from local state
            setSummaries(prev => {
              const updated = prev.filter(s => s.id !== oldRecord.id);
              try {
                if (updated.length > 0) {
                  localStorage.setItem(`summaries_${profile.id}`, JSON.stringify(updated));
                  localStorage.setItem(`summaries_${profile.id}_ts`, String(Date.now()));
                } else {
                  localStorage.removeItem(`summaries_${profile.id}`);
                  localStorage.removeItem(`summaries_${profile.id}_ts`);
                }
              } catch { /* ignore */ }
              return updated;
            });
          } else {
            // Unknown event type — fall back to full refetch
            console.warn('[Realtime] Unknown summaries event, falling back to full refetch');
            fetchSummaries();
          }
        }
      )
      .subscribe();

    const quizzesChannel = supabase
      .channel('quizzes-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quizzes', filter: `user_id=eq.${profile.id}` },
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

    // ─── Realtime: assignments & submissions for instant CRUD updates ───
    const assignmentsChannel = supabase
      .channel('student-assignments-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments' },
        () => { fetchSubmissionsAndAssignments(); }
      )
      .subscribe();

    const submissionsChannel = supabase
      .channel('student-submissions-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'submissions', filter: `student_id=eq.${profile.id}` },
        () => { fetchSubmissionsAndAssignments(); }
      )
      .subscribe();

    // ─── Realtime: attendance sessions for live attendance updates ───
    const attendanceChannel = supabase
      .channel('student-attendance-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_sessions' },
        () => { fetchAttendance(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(summariesChannel);
      supabase.removeChannel(quizzesChannel);
      supabase.removeChannel(scoresChannel);
      supabase.removeChannel(linksChannel);
      supabase.removeChannel(assignmentsChannel);
      supabase.removeChannel(submissionsChannel);
      supabase.removeChannel(attendanceChannel);
    };
  }, [profile.id, fetchSummaries, fetchQuizzes, fetchScores, fetchLinkedTeachers, fetchSubmissionsAndAssignments, fetchAttendance]);

  // ─── FIX #8: Fallback polling for auto-update ───
  // Supabase Realtime can silently disconnect (network issues, WebSocket drops).
  // This polling mechanism ensures summaries stay up-to-date even if Realtime fails.
  // We poll every POLL_INTERVAL_MS (60s) only when the dashboard is visible.
  // Note: Visibility change handler removed — Realtime subscriptions now handle
  // instant state updates automatically. No need to refresh all data when returning to the tab.
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const doPoll = () => {
      // Only poll if the page is visible (don't waste resources in background tabs)
      if (document.visibilityState === 'visible') {
        console.log('[Poll] Fallback polling: refreshing summaries');
        fetchSummaries();
      }
    };

    // Start polling after initial data load completes
    if (!loadingData) {
      pollTimer = setInterval(doPoll, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [fetchSummaries, loadingData]);

  // -------------------------------------------------------
  // Section change handler
  // -------------------------------------------------------
  const handleSectionChange = (section: string) => {
    // If viewing a summary and user navigates via sidebar,
    // clear the summary view so the new section is shown.
    // This also applies when clicking "summaries" — the user wants the list, not the detail.
    if (viewingSummaryId) {
      setViewingSummaryId(null);
    }
    setActiveSection(section as StudentSection);
    storeSetStudentSection(section as StudentSection);
  };

  // -------------------------------------------------------
  // Remove pending summary from tracker
  // -------------------------------------------------------
  const removePendingSummary = (id: string) => {
    setPendingSummaries(prev => prev.filter(s => s.id !== id));
  };

  // -------------------------------------------------------
  // Cancel a pending summary (abort fetch + remove tracker)
  // -------------------------------------------------------
  const cancelPendingSummary = (id: string) => {
    setPendingSummaries(prev => prev.map(s => {
      if (s.id === id) {
        s.abortController.abort();
        return { ...s, status: 'cancelled' as const };
      }
      return s;
    }));
    // Remove after a brief delay so the user sees the "cancelled" state
    setTimeout(() => removePendingSummary(id), 800);
  };

  // -------------------------------------------------------
  // Create summary handler — runs in background
  // The user can close the modal and navigate freely.
  // A small banner shows progress at the top of the summaries section.
  // -------------------------------------------------------
  const handleCreateSummary = async () => {
    const title = summaryTitle.trim();
    if (!title) {
      toast.error('يرجى إدخال عنوان الملخص');
      return;
    }

    // For text mode, validate content upfront
    if (summaryInputMode === 'text') {
      if (!summaryText.trim()) {
        toast.error('يرجى إدخال المحتوى أو لصقه');
        return;
      }
    } else if (summaryInputMode === 'file' || summaryInputMode === 'transcribe') {
      if (!summaryFile) {
        toast.error('يرجى اختيار ملف PDF أو Word');
        return;
      }
    } else if (summaryInputMode === 'existing') {
      if (!selectedExistingFile) {
        toast.error('يرجى اختيار ملف من ملفاتك');
        return;
      }
    }

    // ───────────────────────────────────────────────────────
    // CRITICAL: Snapshot state values into local constants BEFORE
    // resetting form state. The processInBackground function runs
    // asynchronously after setState calls. While React batching
    // preserves values in the current render's closure, snapshotting
    // makes the code robust against future React changes and makes
    // the intent explicit.
    // ───────────────────────────────────────────────────────
    const inputMode = summaryInputMode;
    const capturedFile = summaryFile;
    const capturedText = summaryText.trim();
    const capturedFileBuffer = summaryFileBuffer;
    const capturedFileName = summaryFileName || capturedFile?.name || '';

    // ───────────────────────────────────────────────────────
    // MOBILE FIX: Use pre-read ArrayBuffer from onChange handler.
    // The file data was already read into memory when the user
    // selected the file (in handleSummaryFileChange). This avoids
    // the issue where File objects become invalid on mobile when
    // the <input> element is unmounted from the DOM (modal closes).
    //
    // If the buffer wasn't pre-read (unlikely), fall back to
    // reading from the File object now, before the modal closes.
    // ───────────────────────────────────────────────────────
    let preReadFileData: ArrayBuffer | null = capturedFileBuffer;
    if ((inputMode === 'file' || inputMode === 'transcribe') && capturedFile && !preReadFileData) {
      // Fallback: try to read now if we didn't get the buffer earlier
      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      if (capturedFile.size > MAX_FILE_SIZE) {
        toast.error('حجم الملف يتجاوز الحد الأقصى (10 MB). يرجى اختيار ملف أصغر');
        return;
      }
      try {
        preReadFileData = await capturedFile.arrayBuffer();
        console.log('[Summary] Fallback pre-read file data, size:', preReadFileData.byteLength, 'bytes');
      } catch (readErr) {
        console.error('[Summary] Failed to pre-read file data:', readErr);
        toast.error('فشل في قراءة الملف. يرجى إعادة اختيار الملف والمحاولة مرة أخرى');
        return;
      }
    }

    // ─── For 'existing' mode, capture the selected file info ───
    const capturedExistingFile = inputMode === 'existing' ? selectedExistingFile : null;
    const capturedExistingFileTranscribe = existingFileTranscribe;

    // Create a pending summary tracker with AbortController for cancellation
    const pendingId = `pending-${Date.now()}`;
    const abortController = new AbortController();
    const pending: PendingSummary = {
      id: pendingId,
      title,
      mode: inputMode,
      status: 'extracting',
      startedAt: Date.now(),
      abortController,
    };
    setPendingSummaries(prev => [...prev, pending]);

    // Persist to sessionStorage so we can recover on mobile page refresh
    try {
      const pendingMeta = { id: pendingId, title, mode: inputMode, startedAt: Date.now() };
      const existing = JSON.parse(sessionStorage.getItem('pendingSummaries') || '[]');
      existing.push(pendingMeta);
      sessionStorage.setItem('pendingSummaries', JSON.stringify(existing));
    } catch { /* ignore */ }

    // Reset form & close modal immediately
    // Safe to close now — file data is already in memory (preReadFileData)
    setSummaryTitle('');
    setSummaryText('');
    setSummaryFile(null);
    setSummaryFileBuffer(null);
    setSummaryFileName('');
    setSummaryInputMode('text');
    setNewSummaryOpen(false);
    setSummaryStep('input');
    setCreatingSummary(false);
    setSelectedExistingFile(null);
    setExistingFileTranscribe(false);

    toast.info(inputMode === 'transcribe'
      ? 'جاري استخراج النص من الملف في الخلفية...'
      : inputMode === 'existing'
        ? (capturedExistingFileTranscribe
          ? 'جاري استخراج النص من الملف المحدد في الخلفية...'
          : 'جاري استخراج النص وتلخيص الملف المحدد في الخلفية...')
        : inputMode === 'file'
          ? 'جاري استخراج النص وتوليد الملخص في الخلفية...'
          : 'جاري توليد الملخص في الخلفية...'
    );

    // Run the rest in the background (no await — fire and track)
    const processInBackground = async () => {
      // ─── Client-side timeout for the entire process ───
      // Server now uses streaming AI (45s max) + short DB timeout (5s).
      // With streaming, first token arrives in 3-8s, and most responses
      // complete within 30-40s. On mobile, PDF extraction can add 5-15s.
      // The 90s client timeout gives mobile users enough time for:
      //   - Session hydration (up to 15s on slow mobile)
      //   - PDF text extraction in browser (5-15s)
      //   - Server AI processing (30-45s)
      //   - Network latency on mobile (5-10s)
      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const clientTimeoutMs = isMobile ? 90000 : 65000; // 90s mobile, 65s desktop
      const clientTimeoutId = setTimeout(() => {
        if (!abortController.signal.aborted) {
          console.warn(`[Summary] Client-side timeout (${clientTimeoutMs}ms) — aborting...`);
          abortController.abort();
        }
      }, clientTimeoutMs);

      try {
        // Get auth token with robust retry (mobile session hydration can be slow)
        // Increased timeout for mobile: 15s instead of 10s
        const token = await waitForSession(isMobile ? 15000 : 10000);

        if (!token) {
          throw new Error('انتهت جلسة تسجيل الدخول. يرجى تسجيل الدخول مرة أخرى');
        }

        let originalContent = '';
        let summaryContent = '';
        let savedSummaryId = '';
        let sourceFileType: 'pdf' | 'docx' | null = null;

        // Step 1: Get content (text or extract from PDF/DOCX)
        if ((inputMode === 'file' || inputMode === 'transcribe') && (preReadFileData || capturedFile)) {
          setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'extracting' } : s));

          // ─── PDF/DOCX EXTRACTION STRATEGY (FIXED) ───
          // On MOBILE: Client-side extraction FIRST using preReadFileData.
          // The file data is already in memory as an ArrayBuffer, so client-side
          // extraction is fast and reliable. Worker is disabled on mobile.
          // Server-side extraction is the FALLBACK (not primary) because:
          //   1. FormData with file data may fail on mobile PWA
          //   2. Vercel serverless cold starts add latency
          //   3. pdfjs-dist may fail to load on Vercel
          //
          // On DESKTOP: Same — client-side first, server-side as fallback.
          let extractionSucceeded = false;

          // ─── PRIMARY: Client-side extraction using pre-read data ───
          // This is the MOST RELIABLE method because:
          //   - File data is already in memory (preReadFileData)
          //   - No network request needed
          //   - No FormData construction
          //   - Worker is disabled on mobile (fake worker mode)
          {
            const pdfSource = preReadFileData || capturedFile!;
            console.log('[Summary] Trying CLIENT-SIDE extraction first', isMobile ? '(mobile mode)' : '(desktop mode)', 'file:', capturedFileName);

            // Race the extraction against a 30-second timeout to prevent indefinite hangs
            const extractionTimeoutMs = 30000;
            const extractionPromise = extractTextFromFile(pdfSource, capturedFileName);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), extractionTimeoutMs)
            );

            try {
              const pdfResult = await Promise.race([extractionPromise, timeoutPromise]);
              originalContent = pdfResult.text;
              sourceFileType = pdfResult.sourceFileType || null;
              console.log('[Summary] Client-side extraction succeeded, length:', originalContent.length, 'pages:', pdfResult.pages, 'type:', sourceFileType);
              extractionSucceeded = true;
            } catch (pdfErr) {
              const errMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
              console.warn('[Summary] Client-side extraction failed:', errMsg, '— trying server-side fallback');
            }
          }

          // ─── FALLBACK: Server-side extraction ───
          // Only used if client-side extraction fails.
          // Sends the pre-read ArrayBuffer as a Blob via FormData.
          if (!extractionSucceeded) {
            try {
              const sourceBuffer = preReadFileData || (capturedFile ? await capturedFile.arrayBuffer() : null);
              // Note: capturedFile.arrayBuffer() may fail on mobile if File ref is invalid,
              // but preReadFileData should always be available from the onChange pre-read.
              if (!sourceBuffer) {
                throw new Error('لم يتم العثور على بيانات الملف');
              }

              console.log('[Summary] Trying SERVER-SIDE extraction as fallback');

              // Detect file type from filename for sourceFileType tracking
              if (!sourceFileType && capturedFileName) {
                sourceFileType = /\.(docx|doc)$/i.test(capturedFileName) ? 'docx' : 'pdf';
              }

              // Send with correct MIME type so the server can handle both PDF and DOCX
              try {
                const isDocx = sourceFileType === 'docx';
                const mimeType = isDocx
                  ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  : 'application/pdf';
                const fileName = isDocx ? 'document.docx' : 'document.pdf';
                const fileBlob = new Blob([sourceBuffer], { type: mimeType });
                const extractFormData = new FormData();
                extractFormData.append('file', fileBlob, fileName);

                const extractController = new AbortController();
                const extractTimeoutId = setTimeout(() => extractController.abort(), 30000);

                const extractRes = await fetch('/api/files/extract-pdf', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                  },
                  body: extractFormData,
                  signal: extractController.signal,
                });

                clearTimeout(extractTimeoutId);

                const extractData = await extractRes.json();
                console.log('[Summary] Server extract-pdf response:', extractRes.status, extractData.success ? 'success' : extractData.error);

                if (extractRes.ok && extractData.success && extractData.data?.text) {
                  originalContent = extractData.data.text;
                  sourceFileType = extractData.data.sourceFileType || sourceFileType;
                  console.log('[Summary] Server extraction succeeded, length:', originalContent.length, 'type:', sourceFileType, 'pages:', extractData.data.pages);
                  extractionSucceeded = true;
                } else {
                  console.warn('[Summary] Server extraction failed:', extractData.error);
                }
              } catch (directErr) {
                console.warn('[Summary] Server extraction error:', directErr instanceof Error ? directErr.message : directErr);
              }
            } catch (serverErr) {
              const errMsg = serverErr instanceof Error ? serverErr.message : String(serverErr);
              console.warn('[Summary] Server extraction fallback error:', errMsg);
            }
          }

          if (!extractionSucceeded) {
            throw new Error('فشل في استخراج النص من الملف. يرجى المحاولة مرة أخرى');
          }

          if (!originalContent.trim()) {
            throw new Error('لم يتم العثور على نص في الملف. تأكد أن الملف ليس ممسوحاً ضوئياً');
          }

          if (inputMode === 'transcribe') {
            // ─── Transcribe mode: Save extracted text directly WITHOUT summarization ───
            // The summary_content is the same as original_content (just the extracted text)
            summaryContent = originalContent;
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'saving' } : s));

            // Save directly to database (no AI call needed)
            // Use waitForSession to ensure valid token on mobile PWA
            const saveToken = token || await waitForSession(15000);
            const saveRes = await fetch('/api/summaries', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(saveToken ? { 'Authorization': `Bearer ${saveToken}` } : {}),
              },
              body: JSON.stringify({
                title,
                original_content: originalContent,
                summary_content: originalContent,
                subject_id: selectedSubjectId || null,
                transcribe_only: true,
                source_file_type: sourceFileType,
              }),
              signal: abortController.signal,
            });

            const saveData = await saveRes.json();
            if (saveRes.ok && saveData.success && saveData.data?.id) {
              savedSummaryId = saveData.data.id;
              console.log('[Transcribe] Saved directly, id:', savedSummaryId);
            } else {
              console.warn('[Transcribe] Direct save failed, will use local state:', saveData.error);
            }
          } else {
            // ─── File mode: Extract text then summarize with AI ───
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'summarizing' } : s));

            console.log('[Summary] Sending extracted text to API, length:', originalContent.length);
            const summaryRes = await fetch('/api/gemini/summary', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ content: originalContent, title, subject_id: selectedSubjectId || null, source_file_type: sourceFileType }),
              signal: abortController.signal,
            });

            const summaryData = await summaryRes.json();
            console.log('[Summary] API response:', summaryRes.status, summaryData.success ? 'success' : summaryData.error, 'saved:', summaryData.data?.saved);

            if (!summaryRes.ok || !summaryData.success) {
              throw new Error(summaryData.error || `فشل الاتصال بالخادم (حالة ${summaryRes.status})`);
            }

            summaryContent = summaryData.data?.summary || '';
            savedSummaryId = summaryData.data?.summaryId || '';

            if (!summaryData.data?.saved || !summaryData.data?.summaryId) {
              console.warn('[Summary] Server did not save summary immediately (background save in progress). Waiting for Realtime/polling to pick it up.');
            }
          }
        } else if (inputMode === 'existing' && capturedExistingFile) {
          // ─── Existing file mode: Extract text from a file already in the user's account ───
          //
          // EXTRACTION STRATEGY (FIXED):
          // PRIMARY: Server-side extraction via /api/files/extract-pdf-url
          //   - Downloads from Supabase Storage server-to-server (no CORS issues)
          //   - Uses service role key (no auth header issues)
          //   - Supports both PDF and DOCX
          //   - Most reliable on mobile
          //
          // FALLBACK: Client-side extraction (fetch + pdfjs/mammoth)
          //   - Only used if server-side fails
          //   - May fail on mobile due to CORS, worker issues, etc.
          setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'extracting' } : s));

          // Detect file type for sourceFileType tracking
          if (!sourceFileType && capturedExistingFile.file_name) {
            sourceFileType = /\.(docx|doc)$/i.test(capturedExistingFile.file_name) ? 'docx' : 'pdf';
          }

          let extractionSucceeded = false;

          // ─── PRIMARY: Server-side extraction via /api/files/extract-pdf-url ───
          // This is the most reliable method for existing files because:
          //   1. Server downloads from Supabase Storage using service role key
          //   2. No CORS issues (server-to-server)
          //   3. No client-side worker issues on mobile
          //   4. Supports both PDF and DOCX
          try {
            console.log('[Summary] Trying SERVER-SIDE extraction for existing file (primary method)');

            const extractController = new AbortController();
            const extractTimeoutId = setTimeout(() => extractController.abort(), 45000);

            const extractRes = await fetch('/api/files/extract-pdf-url', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                url: capturedExistingFile.file_url,
                fileName: capturedExistingFile.file_name,
              }),
              signal: extractController.signal,
            });

            clearTimeout(extractTimeoutId);

            const extractData = await extractRes.json();
            console.log('[Summary] Server extract-pdf-url response:', extractRes.status, extractData.success ? 'success' : extractData.error);

            if (extractRes.ok && extractData.success && extractData.data?.text) {
              originalContent = extractData.data.text;
              sourceFileType = extractData.data.sourceFileType || sourceFileType;
              console.log('[Summary] Server-side extraction succeeded, length:', originalContent.length, 'type:', sourceFileType);
              extractionSucceeded = true;
            } else {
              console.warn('[Summary] Server extraction failed:', extractData.error);
            }
          } catch (serverErr) {
            const errMsg = serverErr instanceof Error ? serverErr.message : String(serverErr);
            console.warn('[Summary] Server-side extraction error:', errMsg, '— trying client-side fallback');
          }

          // ─── FALLBACK: Client-side extraction ───
          // Only used if server-side extraction fails.
          // Fetches the file from its storage URL and extracts text in the browser.
          if (!extractionSucceeded) {
            try {
              console.log('[Summary] Trying CLIENT-SIDE extraction as fallback');

              const fileRes = await fetch(capturedExistingFile.file_url, { signal: abortController.signal });
              if (!fileRes.ok) {
                throw new Error('فشل في تحميل الملف من التخزين');
              }
              const arrayBuffer = await fileRes.arrayBuffer();
              console.log('[Summary] Fetched existing file (client-side), size:', arrayBuffer.byteLength, 'bytes, name:', capturedExistingFile.file_name);

              const extractionTimeoutMs = 30000;
              const extractionPromise = extractTextFromFile(arrayBuffer, capturedExistingFile.file_name);
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), extractionTimeoutMs)
              );

              const result = await Promise.race([extractionPromise, timeoutPromise]);
              originalContent = result.text;
              sourceFileType = result.sourceFileType || sourceFileType;
              console.log('[Summary] Client-side extraction succeeded, length:', originalContent.length, 'type:', sourceFileType);
              extractionSucceeded = true;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.error('[Summary] Client-side extraction also failed:', errMsg);
            }
          }

          if (!extractionSucceeded) {
            throw new Error('فشل في استخراج النص من الملف. يرجى المحاولة مرة أخرى');
          }

          if (!originalContent.trim()) {
            throw new Error('لم يتم العثور على نص في الملف. تأكد أن الملف ليس ممسوحاً ضوئياً');
          }

          // ─── Decide: transcribe-only or AI summarize? ───
          if (capturedExistingFileTranscribe) {
            // Transcribe mode: Save extracted text directly WITHOUT summarization
            summaryContent = originalContent;
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'saving' } : s));

            const saveToken = token || await waitForSession(15000);
            const saveRes = await fetch('/api/summaries', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(saveToken ? { 'Authorization': `Bearer ${saveToken}` } : {}),
              },
              body: JSON.stringify({
                title,
                original_content: originalContent,
                summary_content: originalContent,
                subject_id: selectedSubjectId || null,
                transcribe_only: true,
                source_file_type: sourceFileType,
              }),
              signal: abortController.signal,
            });

            const saveData = await saveRes.json();
            if (saveRes.ok && saveData.success && saveData.data?.id) {
              savedSummaryId = saveData.data.id;
              console.log('[Transcribe Existing] Saved directly, id:', savedSummaryId);
            } else {
              console.warn('[Transcribe Existing] Direct save failed, will use local state:', saveData.error);
            }
          } else {
            // Summarize mode: Send extracted text to AI for summarization
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'summarizing' } : s));

            console.log('[Summary] Sending existing file text to API, length:', originalContent.length);
            const summaryRes = await fetch('/api/gemini/summary', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ content: originalContent, title, subject_id: selectedSubjectId || null, source_file_type: sourceFileType }),
              signal: abortController.signal,
            });

            const summaryData = await summaryRes.json();

            if (!summaryRes.ok || !summaryData.success) {
              throw new Error(summaryData.error || `فشل الاتصال بالخادم (حالة ${summaryRes.status})`);
            }

            summaryContent = summaryData.data?.summary || '';
            savedSummaryId = summaryData.data?.summaryId || '';

            if (!summaryData.data?.saved || !summaryData.data?.summaryId) {
              console.warn('[Summary] Server did not save summary immediately (background save in progress).');
            }
          }
        } else {
          // Text mode
          originalContent = capturedText;

          setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'summarizing' } : s));

          console.log('[Summary] Sending text to API, length:', originalContent.length);
          const summaryRes = await fetch('/api/gemini/summary', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ content: originalContent, title, subject_id: selectedSubjectId || null }),
            signal: abortController.signal,
          });

          const summaryData = await summaryRes.json();
          console.log('[Summary] API response:', summaryRes.status, summaryData.success ? 'success' : summaryData.error, 'saved:', summaryData.data?.saved);

          if (!summaryRes.ok || !summaryData.success) {
            throw new Error(summaryData.error || `فشل الاتصال بالخادم (حالة ${summaryRes.status})`);
          }

          summaryContent = summaryData.data?.summary || '';
          savedSummaryId = summaryData.data?.summaryId || '';

          if (!summaryData.data?.saved || !summaryData.data?.summaryId) {
            console.warn('[Summary] Server did not save summary immediately (background save in progress). Waiting for Realtime/polling to pick it up.');
          }
        }

        if (!summaryContent) {
          throw new Error(inputMode === 'transcribe'
            ? 'لم يتم استخراج نص من الملف'
            : 'لم يتم إنشاء محتوى الملخص — رد الذكاء الاصطناعي فارغ');
        }

        if (savedSummaryId) {
          console.log('[Summary] Saved successfully, id:', savedSummaryId);
        } else {
          // ─── CLIENT-SIDE RETRY: Save via /api/summaries POST ───
          // The server may not have saved (DB timeout, Vercel termination, etc.)
          // We retry saving via the /api/summaries endpoint which is simpler
          // and more likely to succeed since it doesn't involve AI processing.
          console.warn('[Summary] No summaryId from server — attempting client-side save via /api/summaries');
          try {
            const retryToken = token || await waitForSession(15000);
            const retryRes = await fetch('/api/summaries', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(retryToken ? { 'Authorization': `Bearer ${retryToken}` } : {}),
              },
              body: JSON.stringify({
                title,
                original_content: originalContent,
                summary_content: summaryContent,
                subject_id: selectedSubjectId || null,
                source_file_type: sourceFileType,
                transcribe_only: inputMode === 'transcribe',
              }),
              signal: abortController.signal,
            });
            const retryData = await retryRes.json();
            if (retryRes.ok && retryData.success && retryData.data?.id) {
              savedSummaryId = retryData.data.id;
              console.log('[Summary] Client-side save succeeded, id:', savedSummaryId);
            } else {
              console.warn('[Summary] Client-side save also failed:', retryData.error);
            }
          } catch (retryErr) {
            console.warn('[Summary] Client-side save error:', retryErr instanceof Error ? retryErr.message : retryErr);
          }
        }

        // Add summary to local state IMMEDIATELY so it shows even before Realtime/polling
        const newSummary: Summary = {
          id: savedSummaryId || `temp-${Date.now()}`,
          user_id: profile.id,
          title,
          original_content: originalContent,
          summary_content: summaryContent,
          subject_id: selectedSubjectId || null,
          source_file_type: sourceFileType,
          created_at: new Date().toISOString(),
        };
        // Use safeSetSummaries with force=true for optimistic local update
        const updatedSummaries = [newSummary, ...summariesRef.current.filter(s => s.id !== savedSummaryId && !s.id.startsWith('temp-'))];
        safeSetSummaries(updatedSummaries, 0, true);

        // Protect this optimistic update from being overwritten by a stale fetchSummaries result
        const optimisticId = newSummary.id;
        recentlyAddedSummaryIdsRef.current.set(optimisticId, Date.now());

        // Generate quiz in background (non-blocking) — delay 5s to let things settle
        // Skip quiz generation for transcribe-only mode (no AI summarization = no quiz)
        if (savedSummaryId && inputMode !== 'transcribe') {
          setTimeout(() => {
            generateQuizInBackground(token, originalContent, title, savedSummaryId, pendingId);
          }, 5000);
        }

        toast.success(inputMode === 'transcribe'
          ? `تم تفريغ نص "${title}" بنجاح`
          : `تم إنشاء ملخص "${title}" بنجاح`
        );
        // Delay fetchSummaries to avoid race condition with optimistic update
        // The optimistic update above uses generation=0, but fetchSummaries
        // increments the generation counter. If we call fetchSummaries immediately,
        // the server data (which may not include the new summary yet) overwrites
        // the optimistic update. Waiting 5s gives the DB time to propagate.
        // The recentlyAddedSummaryIdsRef also protects the new summary during this window.
        setTimeout(() => fetchSummaries(), 5000);
      } catch (err) {
        console.error('[Summary] Background error:', err);

        if (err instanceof DOMException && err.name === 'AbortError') {
          // Client timeout fired — show timeout error message
          // (Manual cancellation doesn't show a toast — the cancel handler
          // already shows "cancelled" state before removing the pending item)
          toast.error('انتهت مهلة إنشاء الملخص. يرجى المحاولة مرة أخرى', { duration: 8000, id: 'summary-error' });
        } else if (err instanceof Error) {
          toast.error(err.message, { duration: 8000, id: 'summary-error' });
        } else {
          toast.error(`فشل إنشاء ملخص "${title}"`, { duration: 8000, id: 'summary-error' });
        }
      } finally {
        clearTimeout(clientTimeoutId);
        removePendingSummary(pendingId);
        // Clean up sessionStorage
        try {
          const existing = JSON.parse(sessionStorage.getItem('pendingSummaries') || '[]');
          const updated = existing.filter((p: { id: string }) => p.id !== pendingId);
          sessionStorage.setItem('pendingSummaries', JSON.stringify(updated));
        } catch { /* ignore */ }
      }
    };

    // Fire and forget — runs in background
    // CRITICAL: Add .catch() safety net so unhandled rejections never leave
    // the pending summary stuck in the UI forever (Bug Fix #1)
    processInBackground().catch((err) => {
      console.error('[Summary] UNHANDLED processInBackground error:', err);
      removePendingSummary(pendingId);
      toast.error(`حدث خطأ غير متوقع أثناء إنشاء ملخص "${title}"`, { duration: 8000, id: 'summary-error' });
    });
  };

  // -------------------------------------------------------
  // Generate quiz in background (completely non-blocking)
  // -------------------------------------------------------
  const generateQuizInBackground = async (token: string, content: string, title: string, summaryId: string, pendingId: string) => {
    try {
      const quizRes = await fetch('/api/gemini/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });

      const quizData = await quizRes.json();
      if (quizData.success && quizData.data?.questions) {
        // Use server-side API to save quiz (bypasses RLS)
        const saveRes = await fetch('/api/quizzes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: `اختبار: ${title}`,
            questions: quizData.data.questions,
            summaryId,
          }),
        });
        if (saveRes.ok) {
          fetchQuizzes();
          toast.success(`تم إنشاء اختبار لملخص "${title}"`);
        } else {
          // Fallback: try client-side insert
          console.warn('[Quiz] Server save failed, trying client-side...');
          const { error } = await supabase.from('quizzes').insert({
            user_id: profile.id,
            title: `اختبار: ${title}`,
            questions: quizData.data.questions,
            summary_id: summaryId,
          });
          if (!error) {
            fetchQuizzes();
            toast.success(`تم إنشاء اختبار لملخص "${title}"`);
          }
        }
      }
    } catch (quizErr) {
      console.warn('Quiz generation failed (non-critical):', quizErr);
    }
  };

  // -------------------------------------------------------
  // Delete summary handler
  // -------------------------------------------------------
  const handleDeleteSummary = async (summaryId: string) => {
    setDeletingSummaryId(summaryId);
    try {
      // Use server-side API to delete (bypasses RLS issues)
      const deleteToken = await waitForSession(15000);
      const res = await fetch('/api/summaries', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(deleteToken ? { 'Authorization': `Bearer ${deleteToken}` } : {}),
        },
        body: JSON.stringify({ summaryId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('تم حذف الملخص بنجاح');
        // Add to recently deleted set to prevent stale re-fetch from re-adding it
        recentlyDeletedSummaryIdsRef.current.add(summaryId);
        setTimeout(() => recentlyDeletedSummaryIdsRef.current.delete(summaryId), 10000);
        // RADICAL FIX: Update local state directly instead of re-fetching.
        // Re-fetching after delete can cause race conditions where the API
        // returns stale data (before the delete is committed), re-adding
        // the deleted summary to the UI temporarily.
        const remaining = summaries.filter(s => s.id !== summaryId);
        safeSetSummaries(remaining, 0, remaining.length === 0); // force=true if all deleted
      } else {
        // Fallback to direct Supabase delete
        const { error } = await supabase.from('summaries').delete().eq('id', summaryId);
        if (error) {
          toast.error(data.error || 'حدث خطأ أثناء حذف الملخص');
        } else {
          toast.success('تم حذف الملخص بنجاح');
          recentlyDeletedSummaryIdsRef.current.add(summaryId);
          setTimeout(() => recentlyDeletedSummaryIdsRef.current.delete(summaryId), 10000);
          const remaining = summaries.filter(s => s.id !== summaryId);
          safeSetSummaries(remaining, 0, remaining.length === 0);
        }
      }
    } catch {
      // Fallback to direct Supabase delete
      try {
        const { error } = await supabase.from('summaries').delete().eq('id', summaryId);
        if (error) {
          toast.error('حدث خطأ أثناء حذف الملخص');
        } else {
          toast.success('تم حذف الملخص بنجاح');
          recentlyDeletedSummaryIdsRef.current.add(summaryId);
          setTimeout(() => recentlyDeletedSummaryIdsRef.current.delete(summaryId), 10000);
          const remaining = summaries.filter(s => s.id !== summaryId);
          safeSetSummaries(remaining, 0, remaining.length === 0);
        }
      } catch {
        toast.error('حدث خطأ غير متوقع');
      }
    } finally {
      setDeletingSummaryId(null);
    }
  };

  // -------------------------------------------------------
  // Create quiz from summary (with config modal)
  // -------------------------------------------------------
  const handleCreateQuizFromSummary = async () => {
    if (!quizConfigSummaryId) return;

    const totalQ = quizConfigTypes.mcq + quizConfigTypes.boolean + quizConfigTypes.completion + quizConfigTypes.matching;
    if (totalQ === 0) {
      toast.error('يرجى اختيار نوع سؤال واحد على الأقل');
      return;
    }

    setCreatingQuizFromSummary(true);
    try {
      // 1. Get the summary content
      const quizToken = await waitForSession(15000);

      const summaryRes = await fetch('/api/summaries', {
        headers: quizToken ? { 'Authorization': `Bearer ${quizToken}` } : {},
      });
      let content = '';
      if (summaryRes.ok) {
        const { data } = await summaryRes.json();
        const found = (data as Summary[])?.find((s) => s.id === quizConfigSummaryId);
        if (found) {
          content = found.summary_content || found.original_content || '';
        }
      }

      if (!content) {
        // Fallback to local state
        const localSummary = summaries.find((s) => s.id === quizConfigSummaryId);
        content = localSummary?.summary_content || localSummary?.original_content || '';
      }

      if (!content) {
        toast.error('لم يتم العثور على محتوى الملخص');
        return;
      }

      // 2. Call quiz generation API with config
      const quizRes = await fetch('/api/gemini/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${quizToken}`,
        },
        body: JSON.stringify({ content, questionTypes: quizConfigTypes }),
      });
      const quizData = await quizRes.json();

      if (!quizRes.ok || !quizData.success) {
        toast.error(quizData.error || 'فشل إنشاء الاختبار');
        return;
      }

      // 3. Save the quiz
      const saveRes = await fetch('/api/quizzes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${quizToken}`,
        },
        body: JSON.stringify({
          title: `اختبار: ${quizConfigSummaryTitle}`,
          questions: quizData.data.questions,
          summaryId: quizConfigSummaryId,
          show_results: quizAnswerMode === 'after' ? false : true,
          allow_retake: quizAllowRetake,
          shuffle_questions: quizShuffleQuestions,
        }),
      });

      if (saveRes.ok) {
        toast.success('تم إنشاء الاختبار بنجاح');
        fetchQuizzes();
        setQuizConfigOpen(false);
        setQuizConfigSummaryId(null);
      } else {
        // Fallback: try client-side insert
        const { error } = await supabase.from('quizzes').insert({
          user_id: profile.id,
          title: `اختبار: ${quizConfigSummaryTitle}`,
          questions: quizData.data.questions,
          summary_id: quizConfigSummaryId,
          show_results: quizAnswerMode === 'after' ? false : true,
          allow_retake: quizAllowRetake,
          shuffle_questions: quizShuffleQuestions,
        });
        if (!error) {
          toast.success('تم إنشاء الاختبار بنجاح');
          fetchQuizzes();
          setQuizConfigOpen(false);
          setQuizConfigSummaryId(null);
        } else {
          toast.error('فشل حفظ الاختبار');
        }
      }
    } catch {
      toast.error('حدث خطأ أثناء إنشاء الاختبار');
    } finally {
      setCreatingQuizFromSummary(false);
    }
  };

  // -------------------------------------------------------
  // Link teacher handler (two-step: search then confirm)
  // -------------------------------------------------------
  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

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
        headers: await getCachedAuthHeaders(),
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
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ teacherCode: teacherCode.trim().toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إرسال طلب الارتباط');
        return;
      }

      // Success
      toast.success(data.message || `تم إرسال طلب الارتباط بنجاح. في انتظار موافقة المعلم.`);

      // Optimistically add the teacher to local state so it appears immediately
      if (teacherPreview) {
        setLinkedTeachers(prev => [...prev, teacherPreview]);
      }

      setTeacherCode('');
      setTeacherPreview(null);
      setLinkTeacherOpen(false);

      // Also re-fetch after a delay to get accurate data from server
      setTimeout(() => { fetchLinkedTeachers(); fetchQuizzes(); }, 1000);
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
        headers: await getCachedAuthHeaders(),
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
        headers: await getCachedAuthHeaders(),
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
        headers: await getCachedAuthHeaders(),
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
        headers: await getCachedAuthHeaders(),
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
        headers: await getCachedAuthHeaders(),
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
    const deleteAccountToken = await waitForSession(15000);
    if (!deleteAccountToken) {
      throw new Error('لا يوجد جلسة نشطة');
    }

    // Call the server-side API to delete the account from the database
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deleteAccountToken}`,
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
  // ─── Composite performance average ───
  // Combines: quiz scores (40%), assignment grades (30%), attendance (30%)
  // Each component is calculated as a percentage (0-100), then weighted.
  const avgPerformance = (() => {
    const components: { value: number; weight: number }[] = [];

    // Quiz scores component (40% weight)
    if (scores.length > 0) {
      const quizAvg = scores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / scores.length;
      components.push({ value: quizAvg, weight: 40 });
    }

    // Assignment grades component (30% weight)
    const gradedSubmissions = submissions.filter(s => s.score !== null && s.score !== undefined);
    if (gradedSubmissions.length > 0) {
      const assignAvgs = gradedSubmissions.map(sub => {
        const assignment = assignments.find(a => a.id === sub.assignment_id);
        if (assignment && assignment.max_score > 0) {
          return (sub.score! / assignment.max_score) * 100;
        }
        return 0;
      });
      const assignAvg = assignAvgs.reduce((sum, v) => sum + v, 0) / assignAvgs.length;
      components.push({ value: assignAvg, weight: 30 });
    }

    // Attendance component (30% weight)
    if (attendanceSessions.length > 0) {
      const attendedSessionIds = new Set(attendanceRecords.map(r => r.session_id));
      const attendancePct = (attendedSessionIds.size / attendanceSessions.length) * 100;
      components.push({ value: attendancePct, weight: 30 });
    }

    // Calculate weighted average
    if (components.length === 0) return 0;

    // Re-normalize weights when some components are missing
    const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
    return Math.round(components.reduce((sum, c) => sum + (c.value * c.weight), 0) / totalWeight);
  })();

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
          color="sky"
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
                <BookOpen className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                أحدث الملخصات
              </h3>
              <button
                onClick={() => setActiveSection('summaries')}
                className="text-xs text-sky-700 dark:text-sky-300 hover:text-sky-800 font-medium flex items-center gap-1"
              >
                عرض الكل
                <ChevronLeft className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {/* Pending summaries banner */}
              {pendingSummaries.length > 0 && (
                <div className="p-3 border-b bg-sky-50/50 dark:bg-sky-950/30">
                  {pendingSummaries.map(ps => (
                    <div key={ps.id} className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200 py-1">
                      {ps.status !== 'cancelled' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-rose-400" />
                      )}
                      <span className="font-medium">{ps.title}</span>
                      <span className="text-sky-600/70 dark:text-sky-400">
                        {ps.status === 'extracting' && (ps.mode === 'transcribe' ? '• استخراج النص (تفريغ)...' : '• استخراج النص...')}
                        {ps.status === 'summarizing' && '• توليد الملخص...'}
                        {ps.status === 'saving' && '• حفظ...'}
                        {ps.status === 'cancelled' && '• تم الإلغاء'}
                      </span>
                      {ps.status !== 'cancelled' && ps.status !== 'saving' && (
                        <button
                          onClick={() => cancelPendingSummary(ps.id)}
                          className="ms-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 transition-colors"
                        >
                          <XCircle className="h-3 w-3" />
                          إلغاء
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {summaries.length === 0 && pendingSummaries.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا توجد ملخصات بعد
                </div>
              ) : (
                <div className="divide-y">
                  {summaries.slice(0, 5).map((summary) => (
                    <motion.button
                      key={summary.id}
                      whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
                      onClick={() => setViewingSummaryId(summary.id)}
                      className="flex w-full items-start gap-3 p-4 text-right transition-colors"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                        <FileText className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{summary.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {summary.summary_content?.slice(0, 80) || summary.original_content?.slice(0, 80) || ''}...
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
                <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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
                        ? 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/30'
                        : pct >= 60
                          ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50'
                          : 'text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/50';
                    return (
                      <div key={score.id} className="flex items-center gap-3 p-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/30">
                          <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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
          className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
        >
          <Plus className="h-4 w-4" />
          ملخص جديد
        </button>
      </motion.div>

      {/* Pending summaries progress */}
      {pendingSummaries.length > 0 && (
        <motion.div variants={itemVariants} className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="h-4 w-4 animate-spin text-sky-700 dark:text-sky-300" />
            <span className="text-sm font-medium text-sky-800 dark:text-sky-200">
              جاري إنشاء {pendingSummaries.length} ملخص...
            </span>
          </div>
          {pendingSummaries.map(ps => (
            <div key={ps.id} className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200 py-1 ms-6">
              <span className="font-medium">{ps.title}</span>
              <span className="text-sky-600/70 dark:text-sky-400">
                {ps.status === 'extracting' && (ps.mode === 'transcribe' ? '• استخراج النص (تفريغ)...' : '• استخراج النص...')}
                {ps.status === 'summarizing' && '• توليد الملخص...'}
                {ps.status === 'saving' && '• حفظ...'}
                {ps.status === 'cancelled' && '• تم الإلغاء'}
              </span>
              {ps.status !== 'cancelled' && ps.status !== 'saving' && (
                <button
                  onClick={() => cancelPendingSummary(ps.id)}
                  className="ms-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 transition-colors"
                  title="إلغاء"
                >
                  <XCircle className="h-3 w-3" />
                  إلغاء
                </button>
              )}
            </div>
          ))}
        </motion.div>
      )}

      {/* Summaries grid */}
      {summaries.length === 0 && pendingSummaries.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <FileText className="h-8 w-8 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد ملخصات</p>
          <p className="text-sm text-muted-foreground mb-4">ابدأ بإنشاء ملخصك الأول من محتوى دراسي</p>
          <button
            onClick={() => setNewSummaryOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-800"
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
                {/* Delete button — always visible on mobile, hover-only on desktop */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSummary(summary.id);
                  }}
                  disabled={deletingSummaryId === summary.id}
                  className="absolute top-3 left-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-rose-50 hover:text-rose-600"
                >
                  {deletingSummaryId === summary.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>

                {/* Create Quiz button — always visible on mobile, hover-only on desktop */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuizConfigSummaryId(summary.id);
                    setQuizConfigSummaryTitle(summary.title);
                    setQuizConfigTypes({ mcq: 2, boolean: 2, completion: 2, matching: 2 });
                    setQuizAnswerMode('after');
                    setQuizConfigOpen(true);
                  }}
                  className="absolute top-3 left-12 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-teal-50 hover:text-teal-600"
                  title="إنشاء اختبار"
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                </button>

                <button
                  onClick={() => setViewingSummaryId(summary.id)}
                  className="w-full text-right"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50 transition-transform group-hover:scale-110">
                      <FileText className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                    </div>
                    <h3 className="font-semibold text-foreground truncate">{summary.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {summary.summary_content?.slice(0, 120) || summary.original_content?.slice(0, 120) || ''}...
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

      {/* Quiz Config Modal */}
      <AnimatePresence>
        {quizConfigOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setQuizConfigOpen(false)}
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
                  <ClipboardList className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  إنشاء اختبار
                </h3>
                <button
                  onClick={() => setQuizConfigOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-5">
                {/* Summary title */}
                <div className="rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-100 p-3">
                  <p className="text-xs text-teal-600 dark:text-teal-400 mb-1">الملخص</p>
                  <p className="text-sm font-medium text-teal-800 truncate">{quizConfigSummaryTitle}</p>
                </div>

                {/* Question types */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">أنواع الأسئلة وعددها</label>
                  {([
                    { key: 'mcq' as const, label: 'اختيار من متعدد', icon: <ListChecks className="h-4 w-4" /> },
                    { key: 'boolean' as const, label: 'صح أو خطأ', icon: <CheckCircle2 className="h-4 w-4" /> },
                    { key: 'completion' as const, label: 'أكمل الجملة', icon: <Type className="h-4 w-4" /> },
                    { key: 'matching' as const, label: 'توصيل', icon: <Link2 className="h-4 w-4" /> },
                  ]).map((qt) => (
                    <div key={qt.key} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {qt.icon}
                        {qt.label}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setQuizConfigTypes(prev => ({ ...prev, [qt.key]: Math.max(0, prev[qt.key] - 1) }))}
                          className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted transition-colors"
                        >
                          -
                        </button>
                        <span className="w-8 text-center text-sm font-bold text-foreground">{quizConfigTypes[qt.key]}</span>
                        <button
                          onClick={() => setQuizConfigTypes(prev => ({ ...prev, [qt.key]: Math.min(10, prev[qt.key] + 1) }))}
                          className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Answer display mode */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">عرض الإجابات</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setQuizAnswerMode('after')}
                      className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                        quizAnswerMode === 'after'
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      بعد الاختبار
                    </button>
                    <button
                      onClick={() => setQuizAnswerMode('during')}
                      className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                        quizAnswerMode === 'during'
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      أثناء الاختبار
                    </button>
                  </div>
                </div>

                {/* Retake & Shuffle toggles */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">إعدادات إضافية</label>
                  <div className="flex items-center justify-between rounded-lg border bg-card p-3">
                    <span className="text-sm font-medium text-foreground">السماح بإعادة الاختبار</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={quizAllowRetake}
                      onClick={() => setQuizAllowRetake(!quizAllowRetake)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 ${
                        quizAllowRetake ? 'bg-teal-600' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                          quizAllowRetake ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-card p-3">
                    <span className="text-sm font-medium text-foreground">ترتيب عشوائي للأسئلة</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={quizShuffleQuestions}
                      onClick={() => setQuizShuffleQuestions(!quizShuffleQuestions)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 ${
                        quizShuffleQuestions ? 'bg-teal-600' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                          quizShuffleQuestions ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Create button */}
                <button
                  onClick={handleCreateQuizFromSummary}
                  disabled={creatingQuizFromSummary || (quizConfigTypes.mcq + quizConfigTypes.boolean + quizConfigTypes.completion + quizConfigTypes.matching === 0)}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creatingQuizFromSummary ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري الإنشاء...
                    </>
                  ) : (
                    <>
                      <ClipboardList className="h-4 w-4" />
                      إنشاء الاختبار
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Summary Modal */}
      <AnimatePresence>
        {newSummaryOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setNewSummaryOpen(false)}
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
                  <FileText className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                  ملخص جديد
                </h3>
                <button
                  onClick={() => setNewSummaryOpen(false)}
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
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-colors"
                    dir="rtl"
                  />
                </div>

                {/* Input mode toggle */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">طريقة الإدخال</label>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => setSummaryInputMode('text')}

                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'text'
                          ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Type className="h-4 w-4" />
                      لصق نص
                    </button>
                    {/* File upload mode - available on all devices */}
                    <button
                      onClick={() => setSummaryInputMode('file')}

                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'file'
                          ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Upload className="h-4 w-4" />
                      رفع ملف + تلخيص
                    </button>
                    {/* Transcribe mode - now available on mobile too */}
                    <button
                      onClick={() => setSummaryInputMode('transcribe')}

                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'transcribe'
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <BookOpen className="h-4 w-4" />
                      تفريغ فقط
                    </button>
                    {/* Existing files mode - now available on mobile too */}
                    <button
                      onClick={() => {
                        setSummaryInputMode('existing');
                        // Fetch user's document files
                        if (existingFiles.length === 0) {
                          setLoadingExistingFiles(true);
                          supabase
                            .from('user_files')
                            .select('*')
                            .eq('user_id', profile.id)
                            .order('created_at', { ascending: false })
                            .then(({ data, error }) => {
                              if (!error && data) {
                                // Filter to only supported document files (PDF, Word)
                                const docFiles = (data as UserFile[]).filter(f =>
                                  /\.(pdf|docx?)$/i.test(f.file_name)
                                );
                                setExistingFiles(docFiles);
                              }
                              setLoadingExistingFiles(false);
                            });
                        }
                      }}

                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'existing'
                          ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <FolderOpen className="h-4 w-4" />
                      ملفاتي
                    </button>
                  </div>
                  {summaryInputMode === 'transcribe' && (
                    <p className="text-xs text-teal-600/80 dark:text-teal-400 mt-2">
                      سيتم استخراج النص من ملف PDF أو Word فقط دون تلخيص
                    </p>
                  )}
                  {summaryInputMode === 'existing' && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-sky-600/80 dark:text-sky-400">
                        اختر ملفاً من ملفاتك المرفوعة مسبقاً
                      </p>
                      {/* Sub-toggle: Summarize vs Transcribe */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExistingFileTranscribe(false)}
                          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                            !existingFileTranscribe
                              ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300'
                              : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          تلخيص بالذكاء الاصطناعي
                        </button>
                        <button
                          type="button"
                          onClick={() => setExistingFileTranscribe(true)}
                          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                            existingFileTranscribe
                              ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                              : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          <BookOpen className="h-3 w-3" />
                          تفريغ النص فقط
                        </button>
                      </div>
                      {existingFileTranscribe && (
                        <p className="text-xs text-teal-600/70 dark:text-teal-400">
                          سيتم استخراج النص من الملف فقط دون تلخيص
                        </p>
                      )}
                    </div>
                  )}
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
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-colors resize-none"
  
                      dir="rtl"
                    />
                  </div>
                )}

                {/* File upload - shown for both 'file' and 'transcribe' modes */}
                {(summaryInputMode === 'file' || summaryInputMode === 'transcribe') && (
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      ملف PDF أو Word
                    </label>
                    <p className="text-xs text-muted-foreground/70 mb-2">
                      {summaryInputMode === 'transcribe'
                        ? 'سيتم استخراج النص من الملف فقط دون تلخيص'
                        : 'سيتم استخراج النص من الملف تلقائياً ثم تلخيصه بالذكاء الاصطناعي'
                      }
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.doc"
                      onChange={handleSummaryFileChange}
                      className="hidden"

                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}

                      className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
                        summaryInputMode === 'transcribe'
                          ? 'border-teal-300 bg-teal-50/30 dark:bg-teal-950/30 hover:border-teal-400 hover:bg-teal-50/50'
                          : 'border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 hover:border-sky-400 hover:bg-sky-50/50'
                      }`}
                    >
                      {summaryFile ? (
                        <>
                          <FileUp className={`h-8 w-8 ${summaryInputMode === 'transcribe' ? 'text-teal-600 dark:text-teal-400' : 'text-sky-700 dark:text-sky-300'}`} />
                          <span className={`text-sm font-medium ${summaryInputMode === 'transcribe' ? 'text-teal-700 dark:text-teal-300' : 'text-sky-800 dark:text-sky-200'}`}>{summaryFile.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {(summaryFile.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </>
                      ) : (
                        <>
                          <Upload className={`h-8 w-8 ${summaryInputMode === 'transcribe' ? 'text-teal-400' : 'text-sky-400'}`} />
                          <span className="text-sm text-muted-foreground">اضغط لاختيار ملف PDF أو Word</span>
                          <span className="text-xs text-muted-foreground/60">الحد الأقصى 10 MB</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Existing files selection - shown for 'existing' mode */}
                {summaryInputMode === 'existing' && (
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      اختر ملفاً من ملفاتك
                    </label>
                    {loadingExistingFiles ? (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-sky-600 dark:text-sky-400" />
                        <span className="text-sm text-muted-foreground">جاري تحميل الملفات...</span>
                      </div>
                    ) : existingFiles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-lg border-2 border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30">
                        <FolderOpen className="h-8 w-8 text-sky-400" />
                        <span className="text-sm text-muted-foreground">لا توجد ملفات مستندية مرفوعة</span>
                        <span className="text-xs text-muted-foreground/60">ارفع ملفات PDF أو Word من قسم الملفات</span>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2">
                        {existingFiles.map((file) => {
                          const isPdf = /\.pdf$/i.test(file.file_name);
                          const isDocx = /\.docx?$/i.test(file.file_name);
                          return (
                            <button
                              key={file.id}
                              onClick={() => setSelectedExistingFile(file)}
                              className={`flex items-center gap-3 w-full rounded-lg border p-3 text-right transition-all ${
                                selectedExistingFile?.id === file.id
                                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30'
                                  : 'border-border hover:bg-muted/50'
                              }`}
                            >
                              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                isPdf ? 'bg-rose-100 dark:bg-rose-900/50' : 'bg-blue-100 dark:bg-blue-900/50'
                              }`}>
                                {isPdf ? (
                                  <FileText className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                                ) : (
                                  <File className="h-4 w-4 text-blue-600" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                  <span>{isPdf ? 'PDF' : isDocx ? 'Word' : 'مستند'}</span>
                                  <span className="text-muted-foreground/40">•</span>
                                  <span>{(file.file_size / 1024).toFixed(0)} KB</span>
                                  <span className="text-muted-foreground/40">•</span>
                                  <span>{formatDate(file.created_at)}</span>
                                </div>
                              </div>
                              {selectedExistingFile?.id === file.id && (
                                <CheckCircle2 className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Processing indicator - removed, processing happens in background */}
              </div>

              {/* Modal footer */}
              <div className="flex items-center gap-3 border-t p-5">
                <button
                  onClick={handleCreateSummary}
                  disabled={creatingSummary || (summaryInputMode === 'existing' && !selectedExistingFile)}
                  className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    summaryInputMode === 'transcribe' ? 'bg-teal-600 hover:bg-teal-700' :
                    summaryInputMode === 'existing' ? (existingFileTranscribe ? 'bg-teal-600 hover:bg-teal-700' : 'bg-sky-600 hover:bg-sky-700') :
                    'bg-sky-700 hover:bg-sky-800'
                  }`}
                >
                  <>
                    {summaryInputMode === 'transcribe' ? <BookOpen className="h-4 w-4" /> :
                     summaryInputMode === 'existing' ? (existingFileTranscribe ? <BookOpen className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />) :
                     <CheckCircle2 className="h-4 w-4" />}
                    {summaryInputMode === 'transcribe' ? 'تفريغ النص' :
                     summaryInputMode === 'existing' ? (existingFileTranscribe ? 'تفريغ النص' : 'تلخيص الملف') :
                     'إنشاء الملخص'}
                  </>
                </button>
                <button
                  onClick={() => {
                    setNewSummaryOpen(false);
                  }}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
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
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-teal-300 bg-teal-50/30 dark:bg-teal-950/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50 mb-4">
            <ClipboardList className="h-8 w-8 text-teal-600 dark:text-teal-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد اختبارات</p>
          <p className="text-sm text-muted-foreground mb-4">
            أنشئ ملخصاً أولاً وسيتم توليد اختبار تلقائياً
          </p>
          <button
            onClick={() => setActiveSection('summaries')}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
          >
            <FileText className="h-4 w-4" />
            إنشاء ملخص
          </button>
        </motion.div>
      ) : (
        (() => {
          // Separate quizzes: active (not completed OR retakeable) vs finished (completed + not retakeable)
          const activeQuizzes = quizzes.filter(q => {
            const completed = completedQuizIds.has(q.id);
            return !completed || q.allow_retake !== false;
          });
          const finishedQuizzes = quizzes.filter(q => {
            const completed = completedQuizIds.has(q.id);
            return completed && q.allow_retake === false;
          });

          return (
            <>
              {/* Active quizzes */}
              {activeQuizzes.length > 0 && (
                <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeQuizzes.map((quiz) => {
                    const isCompleted = completedQuizIds.has(quiz.id);
                    const score = scores.find((s) => s.quiz_id === quiz.id);
                    const pct = score ? scorePercentage(score.score, score.total) : null;

                    return (
                      <motion.div key={quiz.id} variants={itemVariants} {...cardHover}>
                        <div className="group rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow relative">
                          {/* Completed badge */}
                          {isCompleted && (
                            <span className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-teal-100 dark:bg-teal-900/50 px-2 py-0.5 text-[10px] font-bold text-teal-700 dark:text-teal-300">
                              <CheckCircle2 className="h-3 w-3" />
                              مكتمل
                            </span>
                          )}
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50 transition-transform group-hover:scale-110">
                              <ClipboardList className="h-5 w-5 text-teal-600 dark:text-teal-400" />
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

                            {/* Score badge */}
                            {isCompleted && pct !== null && (
                              <span
                                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                                  pct >= 80
                                    ? 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/30'
                                    : pct >= 60
                                      ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50'
                                      : 'text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/50'
                                }`}
                              >
                                {pct}%
                              </span>
                            )}
                          </div>

                          <div className="mt-4 flex items-center gap-2">
                            {isCompleted ? (
                              <>
                                <button
                                  onClick={() => setViewingQuizId(quiz.id)}
                                  className="flex items-center gap-2 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-1.5 text-xs font-medium text-sky-800 dark:text-sky-200 transition-colors hover:bg-sky-100"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  عرض النتائج
                                </button>
                                {quiz.allow_retake !== false && (
                                  <button
                                    onClick={() => setViewingQuizId(quiz.id)}
                                    className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-teal-700"
                                  >
                                    <Play className="h-3.5 w-3.5" />
                                    إعادة الاختبار
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={() => setViewingQuizId(quiz.id)}
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

              {/* Finished / completed non-retakeable quizzes */}
              {finishedQuizzes.length > 0 && (
                <>
                  <motion.div variants={itemVariants} className="mt-8">
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                      اختبارات منتهية
                    </h3>
                    <p className="text-sm text-muted-foreground mt-0.5">اختبارات مكتملة لا يمكن إعادتها</p>
                  </motion.div>
                  <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {finishedQuizzes.map((quiz) => {
                      const score = scores.find((s) => s.quiz_id === quiz.id);
                      const pct = score ? scorePercentage(score.score, score.total) : null;

                      return (
                        <motion.div key={quiz.id} variants={itemVariants}>
                          <div className="group rounded-xl border border-muted bg-card/60 p-5 shadow-sm opacity-80 relative">
                            <span className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3" />
                              مكتمل
                            </span>
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                                <ClipboardList className="h-5 w-5 text-muted-foreground" />
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
                              {pct !== null && (
                                <span
                                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                                    pct >= 80
                                      ? 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/30'
                                      : pct >= 60
                                        ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50'
                                        : 'text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/50'
                                  }`}
                                >
                                  {pct}%
                                </span>
                              )}
                            </div>
                            <div className="mt-4 flex items-center gap-2">
                              <button
                                onClick={() => setViewingQuizId(quiz.id)}
                                className="flex items-center gap-2 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-1.5 text-xs font-medium text-sky-800 dark:text-sky-200 transition-colors hover:bg-sky-100"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                عرض النتائج
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </>
          );
        })()
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
            className="relative flex items-center gap-2 rounded-xl border border-amber-200/70 dark:border-amber-800 bg-gradient-to-b from-amber-50 to-orange-50/50 px-3.5 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 hover:from-amber-100 hover:to-orange-100/60 shadow-sm shadow-amber-100/30 hover:shadow-md hover:shadow-amber-100/40 transition-all duration-200 active:scale-[0.97]"
          >
            <UserPlus className="h-4 w-4" />
            <span>طلبات واردة</span>
            {incomingLinkRequests.length > 0 ? (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-amber-300/50">
                {incomingLinkRequests.length}
              </span>
            ) : (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-200/80 px-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                0
              </span>
            )}
          </button>
          <button
            onClick={() => setLinkTeacherOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
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
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <Users className="h-8 w-8 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا يوجد معلمون</p>
          <p className="text-sm text-muted-foreground mb-4">
            اربط حسابك مع معلمك باستخدام الرمز الخاص به
          </p>
          <button
            onClick={() => setLinkTeacherOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-800"
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
              <div className="shrink-0 px-6 pt-6 pb-5 bg-gradient-to-b from-amber-50/60 via-sky-50/30 to-transparent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 shadow-sm shadow-amber-200/50">
                      <UserPlus className="h-5 w-5 text-amber-600 dark:text-amber-400" />
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
                      className="flex items-center gap-2 rounded-xl bg-sky-700/90 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-sky-200/50 hover:bg-sky-700 hover:shadow-md hover:shadow-sky-200/60 transition-all duration-200 disabled:opacity-50 disabled:shadow-none"
                    >
                      {processingIncomingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      قبول الكل ({incomingLinkRequests.length})
                    </button>
                    <button
                      onClick={() => setConfirmIncomingRejectAllOpen(true)}
                      disabled={processingIncomingBulk}
                      className="flex items-center gap-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/30 px-4 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 hover:border-rose-300 transition-all duration-200 disabled:opacity-50"
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
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/30 mb-4">
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
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-50 transition-all duration-200 active:scale-90"
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
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-500 hover:bg-rose-100 hover:border-rose-300 disabled:opacity-50 transition-all duration-200 active:scale-90"
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
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 mb-4">
                  <CheckCircle2 className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">قبول جميع الطلبات</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  هل أنت متأكد من قبول جميع طلبات الارتباط الواردة ({incomingLinkRequests.length} طلب)؟
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleAcceptAllIncoming}
                    disabled={processingIncomingBulk}
                    className="flex-1 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
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
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/50 mb-4">
                  <AlertTriangle className="h-7 w-7 text-rose-600 dark:text-rose-400" />
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
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-amber-200 dark:border-amber-800 p-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                <Loader2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="font-semibold text-amber-800 dark:text-amber-200">طلبات الارتباط المعلقة</h3>
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800 dark:text-amber-200">
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
                      className="flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition-colors disabled:opacity-60"
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
          <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/30 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-rose-200 dark:border-rose-800 p-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/50">
                <X className="h-4 w-4 text-rose-600 dark:text-rose-400" />
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
                      className="flex items-center gap-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition-colors disabled:opacity-60"
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
                  <Users className="h-5 w-5 text-sky-700 dark:text-sky-300" />
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
                    <BookMarked className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                    المقررات
                  </h4>
                  {loadingTeacherSubjects ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-6 w-6 animate-spin text-sky-700 dark:text-sky-300" />
                    </div>
                  ) : teacherSubjects.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-sky-200 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 p-4 text-center">
                      <p className="text-sm text-muted-foreground">لا توجد مقررات لهذا المعلم</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                      {teacherSubjects.map((subject) => (
                        <div
                          key={subject.id}
                          className="flex items-center gap-3 rounded-lg border bg-card p-3"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                            <BookOpen className="h-4 w-4 text-sky-700 dark:text-sky-300" />
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
                <div className="rounded-lg border border-rose-100 bg-rose-50/30 dark:bg-rose-950/30 p-3 space-y-2">
                  {!unlinkConfirmOpen ? (
                    <button
                      onClick={() => setUnlinkConfirmOpen(true)}
                      className="flex items-center gap-1.5 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-100 hover:border-rose-300 transition-colors"
                    >
                      <Unlink className="h-3 w-3" />
                      إلغاء الربط
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
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
                  <UserPlus className="h-5 w-5 text-sky-700 dark:text-sky-300" />
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
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50">
                        <Search className="h-7 w-7 text-sky-700 dark:text-sky-300" />
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
                        className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-colors text-center tracking-widest font-mono"
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
                  <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/30 p-4 space-y-3">
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
                    <div className="flex items-center gap-2 rounded-lg bg-sky-100/60 dark:bg-sky-900/50 px-3 py-2">
                      <CheckCircle2 className="h-4 w-4 text-sky-700 dark:text-sky-300 shrink-0" />
                      <span className="text-xs text-sky-800 dark:text-sky-200 font-medium">تم العثور على المعلم — اضغط "إرسال طلب" للتأكيد</span>
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
                      className="flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60 disabled:cursor-not-allowed"
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
                      className="flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60 disabled:cursor-not-allowed"
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
    // If viewing a summary, render SummaryView inside the dashboard layout
    // This keeps the sidebar and header visible on mobile
    if (viewingSummaryId) {
      return (
        <SummaryView
          summaryId={viewingSummaryId}
          onBack={() => setViewingSummaryId(null)}
          onViewQuiz={(quizId) => setViewingQuizId(quizId)}
        />
      );
    }

    if (loadingData) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300 mb-4" />
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
      case 'tracking':
        return (
          <StudentTrackingSection
            profileId={profile.id}
            attendanceRecords={attendanceRecords}
            attendanceSessions={attendanceSessions}
            quizzes={quizzes}
            scores={scores}
            submissions={submissions}
            assignments={assignments}
          />
        );
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
        avatarUrl={profile.avatar_url ?? undefined}
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
      <main className={`min-h-screen pt-14 sm:pt-16 pb-20 md:pb-0 transition-all duration-300 ${
        sidebarOpen ? 'md:ms-64' : 'md:ms-[68px]'
      }`}>
        <div className="p-3 sm:p-6 lg:p-8 space-y-4">
          <AnnouncementsBanner userId={profile.id} />
          <AnimatePresence mode="wait">
            <motion.div
              key={viewingSummaryId ? `summary-${viewingSummaryId}` : activeSection}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {renderSection()}
            </motion.div>
          </AnimatePresence>
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

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        role="student"
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
    </div>
  );
}
