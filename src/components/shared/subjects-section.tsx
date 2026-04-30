'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Plus,
  X,
  Loader2,
  Hash,
  Copy,
  Check,
  Sparkles,
  Calendar,
  User,
  UserPlus,
  Clock,
  XCircle,
  LogOut,
  UserCog,
  Shield,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/app-store';
import type { UserProfile, Subject } from '@/lib/types';
import { formatNameWithTitle } from '@/components/shared/user-avatar';

// -------------------------------------------------------
// Auth helpers
// -------------------------------------------------------

/** Check if a Supabase error is likely caused by an expired/invalid auth session (RLS failure) */
function isAuthError(error: { code?: string; message?: string; details?: string }): boolean {
  const msg = (error.message || '').toLowerCase();
  const code = error.code || '';
  return (
    code === '42501' ||
    msg.includes('row-level security') ||
    msg.includes('policy') ||
    msg.includes('jwt') ||
    msg.includes('token') ||
    msg.includes('unauthorized')
  );
}

/** Try to refresh the Supabase session. Returns true if session was refreshed successfully. */
async function tryRefreshSession(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.refreshSession();
    return !error;
  } catch {
    return false;
  }
}

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

const SUBJECT_COLORS = [
  '#10b981', '#14b8a6', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

/** Generate a 6-character alphanumeric join code (uppercase + digits) */
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/O/0/1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------

interface SubjectsSectionProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

const modalOverlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const modalContentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.15 },
  },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------

export default function SubjectsSection({ profile, role }: SubjectsSectionProps) {
  // ─── App store ───
  const { setSelectedSubjectId: setStoreSelectedSubjectId } = useAppStore();

  // ─── Data state ───
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});

  // ─── Copy code state ───
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // ─── Enrollment status map (student only) ───
  const [enrollmentStatuses, setEnrollmentStatuses] = useState<Record<string, string>>({});

  // ─── Create subject modal ───
  const [createSubjectOpen, setCreateSubjectOpen] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectDesc, setNewSubjectDesc] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);
  const [newSubjectLevel, setNewSubjectLevel] = useState('');
  const [newSubjectSubLevel, setNewSubjectSubLevel] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);

  // ─── Join by code modal (student only) ───
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joiningSubject, setJoiningSubject] = useState(false);
  const [subjectPreview, setSubjectPreview] = useState<{ id: string; name: string; description?: string; color: string; teacher_name?: string } | null>(null);
  const [searchingSubject, setSearchingSubject] = useState(false);

  // ─── Cancel / Leave loading state ───
  const [leavingSubjectId, setLeavingSubjectId] = useState<string | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState<{ subjectId: string; subjectName: string } | null>(null);

  // ─── Refs for stable real-time callbacks ───
  const fetchSubjectsRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // -------------------------------------------------------
  // Fetch teacher names (student only, non-blocking)
  // -------------------------------------------------------
  const fetchTeacherNames = useCallback(async (subjectsList: Subject[]) => {
    if (role !== 'student') return;
    try {
      const teacherIds = [...new Set(subjectsList.map((s) => s.teacher_id).filter(Boolean))];
      if (teacherIds.length > 0) {
        const { data: teachers, error: tError } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .in('id', teacherIds);
        if (tError) {
          console.error('Error fetching teacher names:', tError.message);
          return;
        }
        if (teachers) {
          const nameMap: Record<string, string> = {};
          (teachers as { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }[]).forEach((t) => {
            nameMap[t.id] = formatNameWithTitle(t.name, t.role, t.title_id, t.gender);
          });
          setTeacherNames(nameMap);
        }
      }
    } catch (err) {
      console.error('Fetch teacher names error:', err);
    }
  }, [role]);

  // -------------------------------------------------------
  // Fetch subjects — OPTIMIZED: no getSession() call, direct query
  // -------------------------------------------------------
  const fetchSubjects = useCallback(async () => {
    setLoadingSubjects(true);
    try {
      if (role === 'teacher') {
        // Fetch owned subjects
        const { data: ownedData, error: ownedError } = await supabase
          .from('subjects')
          .select('*')
          .eq('teacher_id', profile.id)
          .order('created_at', { ascending: false });

        let ownedSubjects: Subject[] = [];
        if (ownedError) {
          console.error('Error fetching owned subjects:', ownedError.message, ownedError.code, ownedError.details);
          if (isAuthError(ownedError)) {
            const refreshed = await tryRefreshSession();
            if (refreshed) {
              const retry = await supabase
                .from('subjects')
                .select('*')
                .eq('teacher_id', profile.id)
                .order('created_at', { ascending: false });
              if (!retry.error) ownedSubjects = (retry.data as Subject[]) || [];
            }
          }
        } else {
          ownedSubjects = (ownedData as Subject[]) || [];
        }

        // Mark owned subjects
        ownedSubjects = ownedSubjects.map(s => ({ ...s, is_co_teacher: false }));

        // Fetch co-taught subjects from subject_teachers
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

        // Combine and sort: owned first, then co-taught
        const allSubjects = [...ownedSubjects, ...coTaughtSubjects];
        setSubjects(allSubjects);
      } else {
        // Student: single join query — also fetch enrollment status
        const { data, error } = await supabase
          .from('subject_students')
          .select('subject_id, status, subjects(*)')
          .eq('student_id', profile.id);

        if (error) {
          console.error('Error fetching enrolled subjects:', error.message, error.code);
        } else if (data && data.length > 0) {
          // Build enrollment status map
          const statusMap: Record<string, string> = {};
          const subjectsList: Subject[] = [];

          (data as Record<string, unknown>[]).forEach((e) => {
            const subject = e.subjects as Subject | null;
            if (subject) {
              subjectsList.push(subject);
              // status might be undefined if column doesn't exist yet
              statusMap[subject.id] = (e.status as string) || 'approved';
            }
          });

          setSubjects(subjectsList);
          setEnrollmentStatuses(statusMap);
          // Fetch teacher names separately (non-blocking)
          fetchTeacherNames(subjectsList);
        } else {
          setSubjects([]);
          setEnrollmentStatuses({});
        }
      }
    } catch (err) {
      console.error('Fetch subjects error:', err);
    } finally {
      setLoadingSubjects(false);
    }
  }, [profile.id, role, fetchTeacherNames]);

  // ─── Keep ref updated for stable real-time callbacks ───
  useEffect(() => {
    fetchSubjectsRef.current = fetchSubjects;
  }, [fetchSubjects]);

  // -------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------
  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  // -------------------------------------------------------
  // Real-time subscription for subjects (teacher only)
  // -------------------------------------------------------
  useEffect(() => {
    if (role !== 'teacher') return;

    const channel = supabase
      .channel(`subjects-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'subjects',
          filter: `teacher_id=eq.${profile.id}`,
        },
        () => {
          fetchSubjectsRef.current?.();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id, role]);

  // -------------------------------------------------------
  // Copy join code to clipboard
  // -------------------------------------------------------
  const handleCopyCode = useCallback((code: string, subjectId: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCodeId(subjectId);
      toast.success('تم نسخ كود الانضمام');
      setTimeout(() => setCopiedCodeId(null), 2000);
    });
  }, []);

  // -------------------------------------------------------
  // Create subject — OPTIMIZED: no getSession(), no redundant fetch
  // -------------------------------------------------------
  const handleCreateSubject = async () => {
    const name = newSubjectName.trim();
    if (!name) {
      toast.error('يرجى إدخال اسم المقرر');
      return;
    }
    setCreatingSubject(true);
    try {
      const joinCode = generateJoinCode();

      let { data, error } = await supabase
        .from('subjects')
        .insert({
          teacher_id: profile.id,
          name,
          description: newSubjectDesc.trim() || null,
          color: newSubjectColor,
          join_code: joinCode,
          level: newSubjectLevel || null,
          sub_level: newSubjectSubLevel || null,
        })
        .select()
        .single();

      // If RLS/auth error, try refreshing the session and retry once
      if (error && isAuthError(error)) {
        console.warn('Auth error creating subject, refreshing session...');
        const refreshed = await tryRefreshSession();
        if (refreshed) {
          const retry = await supabase
            .from('subjects')
            .insert({
              teacher_id: profile.id,
              name,
              description: newSubjectDesc.trim() || null,
              color: newSubjectColor,
              join_code: joinCode,
              level: newSubjectLevel || null,
              sub_level: newSubjectSubLevel || null,
            })
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (error) {
        console.error('Create subject error:', error.message, error.code, error.details, error.hint);
        if (isAuthError(error)) {
          toast.error('خطأ في الصلاحيات. يرجى تسجيل الخروج ثم الدخول مرة أخرى');
        } else if (error.code === '23503') {
          toast.error('خطأ في بيانات المستخدم. يرجى تحديث الصفحة والمحاولة مرة أخرى');
        } else {
          toast.error('حدث خطأ أثناء إنشاء المقرر');
        }
      } else {
        toast.success('تم إنشاء المقرر بنجاح');
        setCreateSubjectOpen(false);
        setNewSubjectName('');
        setNewSubjectDesc('');
        setNewSubjectColor(SUBJECT_COLORS[0]);
        setNewSubjectLevel('');
        setNewSubjectSubLevel('');

        // Optimistic update — real-time subscription will sync if needed
        if (data) {
          setSubjects((prev) => [data as Subject, ...prev]);
        }
      }
    } catch (err) {
      console.error('Create subject catch error:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setCreatingSubject(false);
    }
  };

  // -------------------------------------------------------
  // Join subject by code - Step 1: Search for subject
  // -------------------------------------------------------
  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  const handleSearchSubject = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      toast.error('يرجى إدخال كود الانضمام');
      return;
    }
    setSearchingSubject(true);
    setSubjectPreview(null);

    try {
      const response = await fetch('/api/join-subject', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ joinCode: code, action: 'search' }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'لم يتم العثور على مقرر بهذا الكود');
        return;
      }

      // Show subject preview
      setSubjectPreview(data.subject);
    } catch (err) {
      console.error('[handleSearchSubject] Unexpected error:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSearchingSubject(false);
    }
  };

  // -------------------------------------------------------
  // Join subject by code - Step 2: Confirm enrollment
  // -------------------------------------------------------
  const handleConfirmJoinSubject = async () => {
    if (!subjectPreview) return;
    setJoiningSubject(true);

    try {
      const response = await fetch('/api/join-subject', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ joinCode: joinCodeInput.trim().toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء طلب الانضمام');
        return;
      }

      toast.success(data.message || 'تم إرسال طلب الانضمام بنجاح');
      setJoinCodeOpen(false);
      setJoinCodeInput('');
      setSubjectPreview(null);
      fetchSubjects();
    } catch (err) {
      console.error('[handleConfirmJoinSubject] Unexpected error:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setJoiningSubject(false);
    }
  };

  // -------------------------------------------------------
  // Cancel / Dismiss / Leave subject (student only)
  // -------------------------------------------------------
  const handleSubjectAction = async (subjectId: string, action: 'cancel' | 'dismiss' | 'leave') => {
    // For 'leave', show confirmation first
    if (action === 'leave') {
      const subjectObj = subjects.find(s => s.id === subjectId);
      setLeaveConfirmOpen({ subjectId, subjectName: subjectObj?.name || 'المقرر' });
      return;
    }
    setLeavingSubjectId(subjectId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/leave-subject', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, subjectId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message);
        fetchSubjects();
      } else {
        toast.error(data.error || 'حدث خطأ');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLeavingSubjectId(null);
    }
  };

  const handleConfirmLeave = async () => {
    if (!leaveConfirmOpen) return;
    const subjectId = leaveConfirmOpen.subjectId;
    setLeaveConfirmOpen(null);
    setLeavingSubjectId(subjectId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/leave-subject', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'leave', subjectId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message);
        fetchSubjects();
      } else {
        toast.error(data.error || 'حدث خطأ');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLeavingSubjectId(null);
    }
  };

  // -------------------------------------------------------
  // Helper: format date
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
  // Helper: Convert hex color to rgba
  // -------------------------------------------------------
  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* ─── Header ─── */}
      <motion.div
        variants={cardVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold text-foreground">المقررات الدراسية</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {role === 'teacher' ? 'إدارة مقرراتك ومحاضراتك' : 'مقرراتك المسجلة ومحاضراتها'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {role === 'student' && (
            <button
              onClick={() => setJoinCodeOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-200 transition-all hover:bg-teal-700 hover:shadow-md hover:shadow-teal-200 active:scale-[0.97]"
            >
              <UserPlus className="h-4 w-4" />
              انضمام بمقرر
            </button>
          )}
          {role === 'teacher' && (
            <button
              onClick={() => setCreateSubjectOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-200 transition-all hover:bg-emerald-700 hover:shadow-md hover:shadow-emerald-200 active:scale-[0.97]"
            >
              <Plus className="h-4 w-4" />
              مقرر جديد
            </button>
          )}
        </div>
      </motion.div>

      {/* ─── Loading State ─── */}
      {loadingSubjects && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="mt-3 text-sm text-muted-foreground">جاري تحميل المقررات...</p>
        </div>
      )}

      {/* ─── Empty State ─── */}
      {!loadingSubjects && subjects.length === 0 && (
        <motion.div
          variants={cardVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-transparent py-20"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100 mb-5">
            <BookOpen className="h-10 w-10 text-emerald-600" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1.5">
            {role === 'teacher' ? 'لا توجد مقررات بعد' : 'لست مسجلاً في أي مقرر'}
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            {role === 'teacher'
              ? 'ابدأ بإنشاء مقررك الدراسي الأول'
              : 'اطلب من معلمك تسجيلك في المقرر أو استخدم كود الانضمام'}
          </p>
          <div className="flex items-center gap-3">
            {role === 'student' && (
              <button
                onClick={() => setJoinCodeOpen(true)}
                className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-teal-700 active:scale-[0.97]"
              >
                <UserPlus className="h-4 w-4" />
                انضمام بمقرر
              </button>
            )}
            {role === 'teacher' && (
              <button
                onClick={() => setCreateSubjectOpen(true)}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.97]"
              >
                <Plus className="h-4 w-4" />
                إنشاء مقرر
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* ─── Compute filtered subject lists (student only) ─── */}
      {(() => {
        // For students: split into approved / pending / rejected
        const approvedSubjects = role === 'student'
          ? subjects.filter((s) => (enrollmentStatuses[s.id] || 'approved') === 'approved')
          : subjects;
        const pendingSubjects = role === 'student'
          ? subjects.filter((s) => enrollmentStatuses[s.id] === 'pending')
          : [];
        const rejectedSubjects = role === 'student'
          ? subjects.filter((s) => enrollmentStatuses[s.id] === 'rejected')
          : [];

        return (
          <>
            {/* ─── Approved Subjects Grid ─── */}
            {!loadingSubjects && approvedSubjects.length > 0 && (
              <motion.div
                variants={containerVariants}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
              >
                {approvedSubjects.map((subject) => {
                  const color = subject.color || '#10b981';
                  return (
                    <motion.div key={subject.id} variants={cardVariants}>
                      <div
                        className="group relative rounded-2xl border bg-card shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden hover:-translate-y-0.5"
                        onClick={() => {
                          setStoreSelectedSubjectId(subject.id);
                        }}
                      >
                        {/* Gradient background overlay */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            background: `linear-gradient(135deg, ${hexToRgba(color, 0.12)} 0%, ${hexToRgba(color, 0.03)} 50%, transparent 100%)`,
                          }}
                        />

                        <div className="relative p-5 pt-6">
                          {/* Subject icon + name */}
                          <div className="flex items-start gap-3.5 mb-3">
                            <div
                              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg shadow-sm"
                              style={{ backgroundColor: color }}
                            >
                              {subject.name.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <h3 className="font-bold text-foreground text-base leading-tight truncate">
                                {subject.name}
                              </h3>
                              {subject.description && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                  {subject.description}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Join code pill — only for owned subjects */}
                          {role === 'teacher' && subject.join_code && !subject.is_co_teacher && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyCode(subject.join_code!, subject.id);
                              }}
                              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
                              style={{
                                backgroundColor: hexToRgba(color, 0.1),
                                border: `1px solid ${hexToRgba(color, 0.2)}`,
                              }}
                            >
                              <Hash
                                className="h-3 w-3 shrink-0"
                                style={{ color }}
                              />
                              <span
                                className="font-mono font-semibold tracking-wider text-xs"
                                style={{ color }}
                              >
                                {subject.join_code}
                              </span>
                              {copiedCodeId === subject.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              ) : (
                                <Copy
                                  className="h-3.5 w-3.5 shrink-0 opacity-50"
                                  style={{ color }}
                                />
                              )}
                            </button>
                          )}

                          {/* Co-teacher badge */}
                          {role === 'teacher' && subject.is_co_teacher && (
                            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-teal-50 border border-teal-200 px-2.5 py-1 text-xs text-teal-700">
                              <Shield className="h-3 w-3 shrink-0" />
                              <span className="font-medium">معلم مشارك</span>
                            </div>
                          )}

                          {/* Footer: creation date + teacher name + leave button */}
                          <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(subject.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {role === 'student' && teacherNames[subject.teacher_id] && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <User className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{teacherNames[subject.teacher_id]}</span>
                                </div>
                              )}
                              {role === 'student' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSubjectAction(subject.id, 'leave'); }}
                                  disabled={leavingSubjectId === subject.id}
                                  className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50"
                                  title="انسحاب من المقرر"
                                >
                                  {leavingSubjectId === subject.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                                  انسحاب
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}

            {/* ─── Pending / Rejected Subjects Section (student only) ─── */}
            {!loadingSubjects && role === 'student' && (pendingSubjects.length > 0 || rejectedSubjects.length > 0) && (
              <motion.div variants={cardVariants} className="space-y-4">
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground">طلبات الانضمام</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {/* Pending subjects */}
                  {pendingSubjects.map((subject) => {
                    const color = subject.color || '#10b981';
                    return (
                      <motion.div key={subject.id} variants={cardVariants}>
                        <div className="group relative rounded-2xl border border-amber-200 bg-card shadow-sm overflow-hidden opacity-90">
                          {/* Gradient background overlay */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: `linear-gradient(135deg, ${hexToRgba(color, 0.08)} 0%, transparent 100%)`,
                            }}
                          />

                          <div className="relative p-5 pt-6">
                            {/* Subject icon + name */}
                            <div className="flex items-start gap-3.5 mb-3">
                              <div
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg shadow-sm"
                                style={{ backgroundColor: color }}
                              >
                                {subject.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                <h3 className="font-bold text-foreground text-base leading-tight truncate">
                                  {subject.name}
                                </h3>
                                {subject.description && (
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                    {subject.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Pending badge + cancel button */}
                            <div className="mt-3 flex items-center gap-2">
                              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs text-amber-700">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span className="font-medium">في انتظار الموافقة</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSubjectAction(subject.id, 'cancel'); }}
                                disabled={leavingSubjectId === subject.id}
                                className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                              >
                                {leavingSubjectId === subject.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                إلغاء الطلب
                              </button>
                            </div>

                            {/* Footer */}
                            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                <span>{formatDate(subject.created_at)}</span>
                              </div>
                              {teacherNames[subject.teacher_id] && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <User className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{teacherNames[subject.teacher_id]}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}

                  {/* Rejected subjects */}
                  {rejectedSubjects.map((subject) => {
                    const color = subject.color || '#10b981';
                    return (
                      <motion.div key={subject.id} variants={cardVariants}>
                        <div className="group relative rounded-2xl border border-rose-200 bg-card shadow-sm overflow-hidden opacity-80">
                          {/* Gradient background overlay */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: `linear-gradient(135deg, ${hexToRgba(color, 0.05)} 0%, transparent 100%)`,
                            }}
                          />

                          <div className="relative p-5 pt-6">
                            {/* Subject icon + name */}
                            <div className="flex items-start gap-3.5 mb-3">
                              <div
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg shadow-sm opacity-60"
                                style={{ backgroundColor: color }}
                              >
                                {subject.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                <h3 className="font-bold text-foreground text-base leading-tight truncate">
                                  {subject.name}
                                </h3>
                                {subject.description && (
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                    {subject.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Rejected badge + dismiss button */}
                            <div className="mt-3 flex items-center gap-2">
                              <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs text-rose-700">
                                <XCircle className="h-3 w-3 shrink-0" />
                                <span className="font-medium">مرفوض</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSubjectAction(subject.id, 'dismiss'); }}
                                disabled={leavingSubjectId === subject.id}
                                className="inline-flex items-center gap-1 rounded-full bg-gray-50 border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                              >
                                {leavingSubjectId === subject.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                إزالة
                              </button>
                            </div>

                            {/* Footer */}
                            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                <span>{formatDate(subject.created_at)}</span>
                              </div>
                              {teacherNames[subject.teacher_id] && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <User className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{teacherNames[subject.teacher_id]}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </>
        );
      })()}

      {/* ─── Create Subject Modal ─── */}
      <AnimatePresence>
        {createSubjectOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !creatingSubject && setCreateSubjectOpen(false)}
            />

            {/* Modal content */}
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-md rounded-2xl border bg-background shadow-2xl overflow-hidden"
            >
              {/* Modal gradient header */}
              <div
                className="px-6 pt-6 pb-4"
                style={{
                  background: `linear-gradient(135deg, ${hexToRgba(newSubjectColor, 0.12)} 0%, transparent 100%)`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-white font-bold shadow-sm"
                      style={{ backgroundColor: newSubjectColor }}
                    >
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">مقرر جديد</h3>
                      <p className="text-xs text-muted-foreground">أنشئ مقرراً دراسياً جديداً</p>
                    </div>
                  </div>
                  <button
                    onClick={() => !creatingSubject && setCreateSubjectOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-5">
                {/* Subject name */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    اسم المقرر <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    placeholder="مثال: الرياضيات 101"
                    className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                    dir="rtl"
                    disabled={creatingSubject}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !creatingSubject) handleCreateSubject();
                    }}
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    الوصف
                  </label>
                  <textarea
                    value={newSubjectDesc}
                    onChange={(e) => setNewSubjectDesc(e.target.value)}
                    placeholder="وصف اختياري للمقرر..."
                    rows={3}
                    className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all resize-none"
                    dir="rtl"
                    disabled={creatingSubject}
                  />
                </div>

                {/* Level (الفرقة) & Sub-level (المستوى) */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      الفرقة
                    </label>
                    <select
                      value={newSubjectLevel}
                      onChange={(e) => setNewSubjectLevel(e.target.value)}
                      className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all appearance-none cursor-pointer"
                      dir="rtl"
                      disabled={creatingSubject}
                    >
                      <option value="">بدون فرقة</option>
                      <option value="الفرقة الأولى">الفرقة الأولى</option>
                      <option value="الفرقة الثانية">الفرقة الثانية</option>
                      <option value="الفرقة الثالثة">الفرقة الثالثة</option>
                      <option value="الفرقة الرابعة">الفرقة الرابعة</option>
                      <option value="الفرقة الخامسة">الفرقة الخامسة</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      المستوى
                    </label>
                    <select
                      value={newSubjectSubLevel}
                      onChange={(e) => setNewSubjectSubLevel(e.target.value)}
                      className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all appearance-none cursor-pointer"
                      dir="rtl"
                      disabled={creatingSubject}
                    >
                      <option value="">بدون مستوى</option>
                      <option value="مستوى أول">مستوى أول</option>
                      <option value="مستوى ثاني">مستوى ثاني</option>
                    </select>
                  </div>
                </div>

                {/* Color picker — visual swatches */}
                <div className="space-y-2.5">
                  <label className="text-sm font-semibold text-foreground">
                    لون المقرر
                  </label>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {SUBJECT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewSubjectColor(color)}
                        disabled={creatingSubject}
                        className="relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-110 active:scale-95"
                        style={{
                          backgroundColor: color,
                          boxShadow:
                            newSubjectColor === color
                              ? `0 0 0 3px ${hexToRgba(color, 0.3)}, 0 2px 8px ${hexToRgba(color, 0.3)}`
                              : 'none',
                        }}
                      >
                        {newSubjectColor === color && (
                          <Check className="h-4 w-4 text-white" strokeWidth={3} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Join code preview */}
                <div
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5"
                  style={{
                    backgroundColor: hexToRgba(newSubjectColor, 0.06),
                    border: `1px solid ${hexToRgba(newSubjectColor, 0.15)}`,
                  }}
                >
                  <Hash className="h-4 w-4 shrink-0" style={{ color: newSubjectColor }} />
                  <span className="text-xs text-muted-foreground">سيتم إنشاء كود انضمام تلقائياً</span>
                </div>

                {/* Create button */}
                <button
                  onClick={handleCreateSubject}
                  disabled={creatingSubject || !newSubjectName.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                  style={{
                    backgroundColor: newSubjectColor,
                    boxShadow: `0 2px 12px ${hexToRgba(newSubjectColor, 0.35)}`,
                  }}
                >
                  {creatingSubject ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري الإنشاء...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      إنشاء المقرر
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Join by Code Modal (student only) ─── */}
      <AnimatePresence>
        {joinCodeOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => {
                if (!joiningSubject && !searchingSubject) {
                  setJoinCodeOpen(false);
                  setSubjectPreview(null);
                }
              }}
            />

            {/* Modal content */}
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-md rounded-2xl border bg-background shadow-2xl overflow-hidden"
              dir="rtl"
            >
              {/* Modal gradient header */}
              <div
                className="px-6 pt-6 pb-4"
                style={{
                  background: `linear-gradient(135deg, ${hexToRgba('#14b8a6', 0.12)} 0%, transparent 100%)`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white font-bold shadow-sm">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">انضمام لمقرر</h3>
                      <p className="text-xs text-muted-foreground">
                        {subjectPreview ? 'تأكيد طلب الانضمام' : 'أدخل كود الانضمام للبحث'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!joiningSubject && !searchingSubject) {
                        setJoinCodeOpen(false);
                        setSubjectPreview(null);
                      }
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-5">
                {/* Step 1: Enter code */}
                {!subjectPreview && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-foreground">
                        كود الانضمام <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => {
                          setJoinCodeInput(e.target.value.toUpperCase());
                          setSubjectPreview(null);
                        }}
                        placeholder="أدخل كود الانضمام"
                        className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all font-mono tracking-widest text-center"
                        maxLength={6}
                        disabled={searchingSubject}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !searchingSubject && joinCodeInput.trim()) handleSearchSubject();
                        }}
                      />
                    </div>

                    {/* Info hint */}
                    <div
                      className="flex items-center gap-2 rounded-xl px-4 py-2.5"
                      style={{
                        backgroundColor: hexToRgba('#14b8a6', 0.06),
                        border: `1px solid ${hexToRgba('#14b8a6', 0.15)}`,
                      }}
                    >
                      <Hash className="h-4 w-4 shrink-0 text-teal-600" />
                      <span className="text-xs text-muted-foreground">احصل على الكود من معلم المقرر</span>
                    </div>

                    {/* Search button */}
                    <button
                      onClick={handleSearchSubject}
                      disabled={searchingSubject || !joinCodeInput.trim()}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-teal-700 active:scale-[0.98]"
                      style={{
                        boxShadow: `0 2px 12px ${hexToRgba('#14b8a6', 0.35)}`,
                      }}
                    >
                      {searchingSubject ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري البحث...
                        </>
                      ) : (
                        <>
                          <Hash className="h-4 w-4" />
                          بحث عن المقرر
                        </>
                      )}
                    </button>
                  </>
                )}

                {/* Step 2: Subject preview card */}
                {subjectPreview && (
                  <>
                    <div
                      className="rounded-xl border p-4 space-y-3"
                      style={{
                        borderColor: hexToRgba(subjectPreview.color, 0.4),
                        backgroundColor: hexToRgba(subjectPreview.color, 0.04),
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg shadow-sm"
                          style={{ backgroundColor: subjectPreview.color }}
                        >
                          {subjectPreview.name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-foreground text-base leading-tight truncate">
                            {subjectPreview.name}
                          </h4>
                          {subjectPreview.description && (
                            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                              {subjectPreview.description}
                            </p>
                          )}
                        </div>
                      </div>
                      {subjectPreview.teacher_name && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <User className="h-3.5 w-3.5 shrink-0" />
                          <span>المعلم: {subjectPreview.teacher_name}</span>
                        </div>
                      )}
                      <div
                        className="flex items-center gap-2 rounded-lg px-3 py-2"
                        style={{
                          backgroundColor: hexToRgba('#14b8a6', 0.08),
                        }}
                      >
                        <Clock className="h-4 w-4 text-teal-600 shrink-0" />
                        <span className="text-xs text-teal-700 font-medium">سيتم إرسال طلب انضمام بانتظار موافقة المعلم</span>
                      </div>
                      <button
                        onClick={() => {
                          setSubjectPreview(null);
                          setJoinCodeInput('');
                        }}
                        disabled={joiningSubject}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                      >
                        تغيير الكود
                      </button>
                    </div>

                    {/* Confirm button */}
                    <button
                      onClick={handleConfirmJoinSubject}
                      disabled={joiningSubject}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-teal-700 active:scale-[0.98]"
                      style={{
                        boxShadow: `0 2px 12px ${hexToRgba('#14b8a6', 0.35)}`,
                      }}
                    >
                      {joiningSubject ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري إرسال الطلب...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          تأكيد طلب الانضمام
                        </>
                      )}
                    </button>
                  </>
                )}

                {/* Cancel button */}
                <button
                  onClick={() => {
                    if (!joiningSubject && !searchingSubject) {
                      setJoinCodeOpen(false);
                      setSubjectPreview(null);
                    }
                  }}
                  disabled={joiningSubject || searchingSubject}
                  className="w-full rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Leave Course Confirm Dialog (student only) ─── */}
      <AnimatePresence>
        {leaveConfirmOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !leavingSubjectId && setLeaveConfirmOpen(null)}
            />
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir="rtl"
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 mb-4">
                  <LogOut className="h-7 w-7 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">انسحاب من المقرر</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  هل أنت متأكد من الانسحاب من مقرر &quot;{leaveConfirmOpen.subjectName}&quot;؟
                </p>
                <p className="text-xs text-muted-foreground/70 mb-6">
                  لن تتمكن من الوصول إلى محتوى المقرر بعد الآن، وسيتم إزالة جميع درجاتك ومشاركاتك.
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleConfirmLeave}
                    disabled={leavingSubjectId !== null}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
                  >
                    {leavingSubjectId ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري الانسحاب...
                      </>
                    ) : (
                      <>
                        <LogOut className="h-4 w-4" />
                        نعم، انسحاب
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setLeaveConfirmOpen(null)}
                    disabled={leavingSubjectId !== null}
                    className="flex-1 rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
