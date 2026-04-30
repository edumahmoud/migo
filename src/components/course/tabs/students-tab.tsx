'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Search,
  UserPlus,
  UserMinus,
  Mail,
  Loader2,
  X,
  Trash2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Check,
  UserCheck,
  UserX,
  BarChart3,
  Award,
  ClipboardList,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { UserProfile, Subject } from '@/lib/types';
import StudentProfileModal from '@/components/course/tabs/student-profile-modal';
import UserAvatar from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface StudentsTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  subject: Subject;
  teacherName: string;
}

// -------------------------------------------------------
// Extended type for pending requests
// -------------------------------------------------------
interface PendingStudent extends UserProfile {
  enrollment_status?: string;
  enrollment_date?: string;
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

// -------------------------------------------------------
// Confirmation Dialog Component
// -------------------------------------------------------
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = 'danger',
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning';
}) {
  if (!open) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
            dir="rtl"
          >
            <div className="flex flex-col items-center text-center">
              <div className={`flex h-14 w-14 items-center justify-center rounded-full mb-4 ${
                variant === 'danger' ? 'bg-rose-100' : 'bg-amber-100'
              }`}>
                {variant === 'danger' ? (
                  <Trash2 className="h-7 w-7 text-rose-600" />
                ) : (
                  <AlertTriangle className="h-7 w-7 text-amber-600" />
                )}
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground mb-6">{message}</p>
              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={onConfirm}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors ${
                    variant === 'danger'
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {confirmLabel}
                </button>
                <button
                  onClick={onCancel}
                  className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                >
                  {cancelLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function StudentsTab({ profile, subjectId }: StudentsTabProps) {
  // Students state
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // Pending requests state
  const [pendingRequests, setPendingRequests] = useState<PendingStudent[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [pendingPanelOpen, setPendingPanelOpen] = useState(false);

  // Search for adding new students
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addSearchResults, setAddSearchResults] = useState<UserProfile[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [showAddSearch, setShowAddSearch] = useState(false);

  // Search within enrolled students
  const [enrolledSearchQuery, setEnrolledSearchQuery] = useState('');

  // Bulk selection state
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  // Confirmation dialogs state
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [acceptAllConfirmOpen, setAcceptAllConfirmOpen] = useState(false);
  const [rejectAllConfirmOpen, setRejectAllConfirmOpen] = useState(false);

  // Status column detection
  const [statusColumnExists, setStatusColumnExists] = useState(true);

  // Performance modal state
  const [performanceStudentId, setPerformanceStudentId] = useState<string | null>(null);
  const [performanceData, setPerformanceData] = useState<{
    avgGrade: number | null;
    submissions: { assignmentName: string; grade: number; total: number; submittedAt: string }[];
    attendance: { present: number; total: number; percentage: number };
  } | null>(null);
  const [loadingPerformance, setLoadingPerformance] = useState(false);

  // -------------------------------------------------------
  // Fetch pending enrollment requests
  // -------------------------------------------------------
  const fetchPendingRequests = useCallback(async () => {
    setLoadingPending(true);
    try {
      const { data, error } = await supabase
        .from('subject_students')
        .select('student_id, status, created_at, users(*)')
        .eq('subject_id', subjectId)
        .eq('status', 'pending');

      if (error) {
        setStatusColumnExists(false);
        setPendingRequests([]);
        return;
      }

      if (data && data.length > 0) {
        const pendingStudents: PendingStudent[] = data.map((d: Record<string, unknown>) => ({
          ...((d.users || {}) as UserProfile),
          enrollment_status: d.status as string,
          enrollment_date: d.created_at as string,
        }));
        setPendingRequests(pendingStudents);
      } else {
        setPendingRequests([]);
      }
    } catch {
      setStatusColumnExists(false);
      setPendingRequests([]);
    } finally {
      setLoadingPending(false);
    }
  }, [subjectId]);

  // -------------------------------------------------------
  // Fetch enrolled (approved) students
  // -------------------------------------------------------
  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('subject_students')
        .select('student_id, status, users(*)')
        .eq('subject_id', subjectId);

      if (statusColumnExists) {
        query = query.eq('status', 'approved');
      }

      const { data: enrollments, error: enrollErr } = await query;

      if (enrollErr) {
        console.error('Error fetching enrollments:', enrollErr);
        setStudents([]);
      } else if (enrollments && enrollments.length > 0) {
        const studentsData = enrollments.map((e: Record<string, unknown>) => e.users as UserProfile).filter(Boolean);
        setStudents(studentsData);
      } else {
        setStudents([]);
      }
    } catch (err) {
      console.error('Fetch students error:', err);
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [subjectId, statusColumnExists]);

  // Initial fetch
  useEffect(() => {
    fetchPendingRequests();
    fetchStudents();
  }, [fetchPendingRequests, fetchStudents]);

  // ─── Navigation cleanup: close all modals/dialogs when navigating away ───
  useEffect(() => {
    const handleNavCleanup = () => {
      setProfileModalOpen(false);
      setRemoveConfirmId(null);
      setBulkDeleteConfirmOpen(false);
      setAcceptAllConfirmOpen(false);
      setRejectAllConfirmOpen(false);
      setPerformanceStudentId(null);
      setPendingPanelOpen(false);
    };
    document.addEventListener('navigation:cleanup', handleNavCleanup);
    return () => {
      document.removeEventListener('navigation:cleanup', handleNavCleanup);
    };
  }, []);

  // -------------------------------------------------------
  // Search for students to add
  // -------------------------------------------------------
  const handleAddSearch = useCallback(async (query: string) => {
    setAddSearchQuery(query);
    if (!query.trim()) {
      setAddSearchResults([]);
      return;
    }
    setAddSearching(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'student')
        .or(`name.ilike.%${query.trim()}%,email.ilike.%${query.trim()}%`)
        .limit(10);
      if (error) {
        console.error('Error searching:', error);
        setAddSearchResults([]);
      } else {
        const enrolledIds = new Set(students.map((s) => s.id));
        const pendingIds = new Set(pendingRequests.map((s) => s.id));
        setAddSearchResults(((data as UserProfile[]) || []).filter((s) => !enrolledIds.has(s.id) && !pendingIds.has(s.id)));
      }
    } catch (err) {
      console.error('Search error:', err);
      setAddSearchResults([]);
    } finally {
      setAddSearching(false);
    }
  }, [students, pendingRequests]);

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  // -------------------------------------------------------
  // Add student (via API)
  // -------------------------------------------------------
  const handleAdd = async (studentId: string) => {
    setAddingId(studentId);
    try {
      const res = await fetch('/api/enrollment', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'add', subjectId, studentId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إضافة الطالب');
      } else {
        toast.success('تم إضافة الطالب بنجاح');
        setAddSearchResults((prev) => prev.filter((s) => s.id !== studentId));
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setAddingId(null);
    }
  };

  // -------------------------------------------------------
  // Remove student (via API, after confirmation)
  // -------------------------------------------------------
  const handleRemove = async (studentId: string) => {
    setRemovingId(studentId);
    try {
      const res = await fetch('/api/enrollment', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'remove', subjectId, studentId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء إزالة الطالب');
      } else {
        toast.success('تم إزالة الطالب من المقرر');
        fetchStudents();
        setSelectedStudentIds((prev) => {
          const next = new Set(prev);
          next.delete(studentId);
          return next;
        });
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setRemovingId(null);
      setRemoveConfirmId(null);
    }
  };

  // -------------------------------------------------------
  // Approve individual pending request (via API)
  // -------------------------------------------------------
  const handleApproveRequest = async (studentId: string) => {
    setProcessingId(studentId);
    try {
      const res = await fetch('/api/enrollment', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'approve', subjectId, studentId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء قبول الطلب');
      } else {
        toast.success('تم قبول الطالب بنجاح');
        setPendingRequests((prev) => prev.filter((s) => s.id !== studentId));
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingId(null);
    }
  };

  // -------------------------------------------------------
  // Reject individual pending request (via API)
  // -------------------------------------------------------
  const handleRejectRequest = async (studentId: string) => {
    setProcessingId(studentId);
    try {
      const res = await fetch('/api/enrollment', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'reject', subjectId, studentId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء رفض الطلب');
      } else {
        toast.success('تم رفض الطلب');
        setPendingRequests((prev) => prev.filter((s) => s.id !== studentId));
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingId(null);
    }
  };

  // -------------------------------------------------------
  // Accept all pending requests (via API)
  // -------------------------------------------------------
  const handleAcceptAll = async () => {
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/enrollment', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'approveAll', subjectId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء قبول جميع الطلبات');
      } else {
        toast.success(data.message || `تم قبول ${pendingRequests.length} طلب بنجاح`);
        setPendingRequests([]);
        fetchStudents();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setBulkProcessing(false);
      setAcceptAllConfirmOpen(false);
    }
  };

  // -------------------------------------------------------
  // Reject all pending requests (via API)
  // -------------------------------------------------------
  const handleRejectAll = async () => {
    setBulkProcessing(true);
    try {
      const res = await fetch('/api/enrollment', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ action: 'rejectAll', subjectId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'حدث خطأ أثناء رفض جميع الطلبات');
      } else {
        toast.success(data.message || `تم رفض ${pendingRequests.length} طلب`);
        setPendingRequests([]);
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setBulkProcessing(false);
      setRejectAllConfirmOpen(false);
    }
  };

  // -------------------------------------------------------
  // Bulk delete selected students (via API)
  // -------------------------------------------------------
  const handleBulkDelete = async () => {
    setBulkProcessing(true);
    try {
      let successCount = 0;
      let errorCount = 0;
      for (const studentId of selectedStudentIds) {
        const res = await fetch('/api/enrollment', {
          method: 'POST',
          headers: await getAuthHeaders(),
          body: JSON.stringify({ action: 'remove', subjectId, studentId }),
        });
        const data = await res.json();
        if (!res.ok || data.error) errorCount++;
        else successCount++;
      }
      if (errorCount === 0) {
        toast.success(`تم حذف ${successCount} طالب من المقرر`);
      } else {
        toast.error(`تم حذف ${successCount} طالب، فشل حذف ${errorCount}`);
      }
      setSelectedStudentIds(new Set());
      fetchStudents();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setBulkProcessing(false);
      setBulkDeleteConfirmOpen(false);
    }
  };

  // -------------------------------------------------------
  // Toggle student selection
  // -------------------------------------------------------
  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const filtered = filteredStudents;
    if (selectedStudentIds.size === filtered.length && filtered.length > 0) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(filtered.map((s) => s.id)));
    }
  };

  // -------------------------------------------------------
  // Open student profile
  // -------------------------------------------------------
  const handleOpenProfile = (studentId: string) => {
    setSelectedStudentId(studentId);
    setProfileModalOpen(true);
  };

  // -------------------------------------------------------
  // Format date helper
  // -------------------------------------------------------
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // -------------------------------------------------------
  // Fetch student performance
  // -------------------------------------------------------
  const fetchStudentPerformance = async (studentId: string) => {
    setLoadingPerformance(true);
    try {
      // Fetch quiz scores for this student in this subject
      const { data: scores } = await supabase
        .from('quiz_scores')
        .select('score, total, quiz_title, completed_at')
        .eq('student_id', studentId)
        .eq('subject_id', subjectId)
        .order('completed_at', { ascending: false });

      // Fetch attendance for this student in this subject
      const { data: attendance } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('student_id', studentId);

      // Get total sessions for this subject
      const { data: sessions } = await supabase
        .from('attendance_sessions')
        .select('id')
        .eq('subject_id', subjectId);

      const totalSessions = sessions?.length || 0;
      const presentCount = attendance?.length || 0;
      const attendancePercentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

      // Calculate average grade
      const validScores = (scores || []).filter((s: { total: number }) => s.total > 0);
      const avgGrade = validScores.length > 0
        ? Math.round(validScores.reduce((sum: number, s: { score: number; total: number }) => sum + (s.score / s.total) * 100, 0) / validScores.length)
        : null;

      setPerformanceData({
        avgGrade,
        submissions: (scores || []).map((s: { quiz_title: string; score: number; total: number; completed_at: string }) => ({
          assignmentName: s.quiz_title || 'اختبار',
          grade: s.score,
          total: s.total,
          submittedAt: s.completed_at,
        })),
        attendance: {
          present: presentCount,
          total: totalSessions,
          percentage: attendancePercentage,
        },
      });
    } catch (err) {
      console.error('Error fetching performance:', err);
    } finally {
      setLoadingPerformance(false);
    }
  };

  // -------------------------------------------------------
  // Filter enrolled students by search
  // -------------------------------------------------------
  const filteredStudents = enrolledSearchQuery.trim()
    ? students.filter((s) =>
        s.name.toLowerCase().includes(enrolledSearchQuery.trim().toLowerCase()) ||
        s.email.toLowerCase().includes(enrolledSearchQuery.trim().toLowerCase())
      )
    : students;

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-foreground">الطلاب</h3>
          <p className="text-muted-foreground text-sm mt-1">{students.length} طالب مسجل</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Pending Requests Side Button - always visible */}
          {statusColumnExists && (
            <button
              onClick={() => setPendingPanelOpen(true)}
              className="relative flex items-center gap-2 rounded-xl border border-amber-200/70 bg-gradient-to-b from-amber-50 to-orange-50/50 px-3.5 py-2 text-sm font-medium text-amber-700 hover:from-amber-100 hover:to-orange-100/60 shadow-sm shadow-amber-100/30 hover:shadow-md hover:shadow-amber-100/40 transition-all duration-200 active:scale-[0.97]"
            >
              <UserPlus className="h-4 w-4" />
              <span>طلبات الانضمام</span>
              {pendingRequests.length > 0 ? (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-amber-300/50">
                  {pendingRequests.length}
                </span>
              ) : (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-200/80 px-1.5 text-[10px] font-bold text-amber-600">
                  0
                </span>
              )}
            </button>
          )}
          {/* Add student button */}
          <button
            onClick={() => setShowAddSearch(!showAddSearch)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              showAddSearch
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            <UserPlus className="h-4 w-4" />
            إضافة طالب
          </button>
        </div>
      </motion.div>

      {/* Add student search (collapsible) */}
      <AnimatePresence>
        {showAddSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-emerald-600" />
                  إضافة طالب جديد للمقرر
                </h4>
                <button
                  onClick={() => { setShowAddSearch(false); setAddSearchQuery(''); setAddSearchResults([]); }}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={addSearchQuery}
                  onChange={(e) => handleAddSearch(e.target.value)}
                  placeholder="البحث عن طالب بالاسم أو البريد الإلكتروني..."
                  className="w-full rounded-lg border bg-background pr-9 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                  dir="rtl"
                  autoFocus
                />
              </div>
              {/* Search results */}
              {addSearchQuery.trim() && (
                <div className="rounded-lg border bg-background overflow-hidden max-h-60 overflow-y-auto">
                  {addSearching ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                    </div>
                  ) : addSearchResults.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">لا توجد نتائج</div>
                  ) : (
                    <div className="divide-y">
                      {addSearchResults.map((student) => (
                        <div key={student.id} className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                          <UserLink
                            userId={student.id}
                            name={student.name}
                            avatarUrl={student.avatar_url}
                            role="student"
                            gender={student.gender}
                            size="sm"
                            showAvatar={true}
                            showUsername={false}
                          />
                          <button
                            onClick={() => handleAdd(student.id)}
                            disabled={addingId === student.id}
                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                          >
                            {addingId === student.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                            إضافة
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Enrolled students search */}
      {students.length > 0 && (
        <motion.div variants={itemVariants} className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={enrolledSearchQuery}
            onChange={(e) => setEnrolledSearchQuery(e.target.value)}
            placeholder="البحث في الطلاب المسجلين بالاسم أو البريد الإلكتروني..."
            className="w-full rounded-lg border bg-background pr-9 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
            dir="rtl"
          />
        </motion.div>
      )}

      {/* Students list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : students.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <Users className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا يوجد طلاب مسجلون</p>
          <p className="text-sm text-muted-foreground">ابحث عن طالب وأضفه للمقرر</p>
        </motion.div>
      ) : filteredStudents.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-12"
        >
          <Search className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">لا توجد نتائج مطابقة للبحث</p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="rounded-xl border bg-card shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3 bg-muted/50 text-xs font-semibold text-muted-foreground items-center">
            <div className="col-span-1 flex items-center justify-center">
              <button
                onClick={toggleSelectAll}
                className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                  selectedStudentIds.size === filteredStudents.length && filteredStudents.length > 0
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-muted-foreground/30 hover:border-emerald-500'
                }`}
              >
                {selectedStudentIds.size === filteredStudents.length && filteredStudents.length > 0 && <Check className="h-3 w-3" />}
              </button>
            </div>
            <div className="col-span-5">الطالب</div>
            <div className="col-span-4">البريد الإلكتروني</div>
            <div className="col-span-2">إجراءات</div>
          </div>
          <div className="divide-y max-h-[500px] overflow-y-auto">
            {filteredStudents.map((student, index) => (
              <motion.div
                key={student.id}
                variants={itemVariants}
                className={`px-4 py-3 sm:grid sm:grid-cols-12 sm:gap-2 sm:items-center space-y-2 sm:space-y-0 transition-colors ${
                  selectedStudentIds.has(student.id) ? 'bg-emerald-50/30' : 'hover:bg-muted/30'
                }`}
              >
                <div className="col-span-1 flex items-center justify-center">
                  <button
                    onClick={() => toggleStudentSelection(student.id)}
                    className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                      selectedStudentIds.has(student.id)
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-muted-foreground/30 hover:border-emerald-500'
                    }`}
                  >
                    {selectedStudentIds.has(student.id) && <Check className="h-3 w-3" />}
                  </button>
                </div>
                <div className="col-span-5">
                  <UserLink
                    userId={student.id}
                    name={student.name}
                    avatarUrl={student.avatar_url}
                    role="student"
                    gender={student.gender}
                    size="sm"
                    showAvatar={true}
                    showUsername={false}
                  />
                </div>
                <div className="col-span-4 text-sm text-muted-foreground truncate flex items-center gap-1">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{student.email}</span>
                </div>
                <div className="col-span-2 flex items-center gap-1">
                  <button
                    onClick={() => {
                      setPerformanceStudentId(student.id);
                      fetchStudentPerformance(student.id);
                    }}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                    title="أداء الطالب"
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleOpenProfile(student.id)}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="الملف الشخصي"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setRemoveConfirmId(student.id)}
                    disabled={removingId === student.id}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    title="إزالة"
                  >
                    {removingId === student.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
          {/* Footer with count */}
          {enrolledSearchQuery.trim() && filteredStudents.length !== students.length && (
            <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground text-center">
              عرض {filteredStudents.length} من {students.length} طالب
            </div>
          )}
        </motion.div>
      )}

      {/* ============================================================ */}
      {/* Floating Action Bar for Bulk Selection                        */}
      {/* ============================================================ */}
      <AnimatePresence>
        {selectedStudentIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border bg-background/95 backdrop-blur-md shadow-2xl px-5 py-3"
            dir="rtl"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <span className="text-xs font-bold">{selectedStudentIds.size}</span>
              </div>
              <span className="text-sm font-semibold text-foreground">طالب محدد</span>
            </div>
            <div className="h-6 w-px bg-border" />
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {selectedStudentIds.size === students.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </button>
            <button
              onClick={() => setBulkDeleteConfirmOpen(true)}
              disabled={bulkProcessing}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
            >
              {bulkProcessing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              حذف المحدد ({selectedStudentIds.size})
            </button>
            <button
              onClick={() => setSelectedStudentIds(new Set())}
              className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* Confirmation Dialogs                                          */}
      {/* ============================================================ */}

      <ConfirmDialog
        open={removeConfirmId !== null}
        title="حذف طالب من المقرر"
        message={removeConfirmId ? `هل أنت متأكد من إزالة الطالب ${students.find(s => s.id === removeConfirmId)?.name || ''} من هذا المقرر؟` : ''}
        confirmLabel="حذف"
        cancelLabel="إلغاء"
        onConfirm={() => { if (removeConfirmId) handleRemove(removeConfirmId); }}
        onCancel={() => setRemoveConfirmId(null)}
        variant="danger"
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        title="حذف طلاب من المقرر"
        message={`هل أنت متأكد من حذف ${selectedStudentIds.size} طالب من هذا المقرر؟`}
        confirmLabel="حذف"
        cancelLabel="إلغاء"
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
        variant="danger"
      />

      <ConfirmDialog
        open={acceptAllConfirmOpen}
        title="قبول جميع الطلبات"
        message={`هل أنت متأكد من قبول جميع طلبات الانضمام (${pendingRequests.length} طلب)؟`}
        confirmLabel={`قبول الكل (${pendingRequests.length})`}
        cancelLabel="إلغاء"
        onConfirm={handleAcceptAll}
        onCancel={() => setAcceptAllConfirmOpen(false)}
        variant="warning"
      />

      <ConfirmDialog
        open={rejectAllConfirmOpen}
        title="رفض جميع الطلبات"
        message={`هل أنت متأكد من رفض جميع طلبات الانضمام (${pendingRequests.length} طلب)؟`}
        confirmLabel={`رفض الكل (${pendingRequests.length})`}
        cancelLabel="إلغاء"
        onConfirm={handleRejectAll}
        onCancel={() => setRejectAllConfirmOpen(false)}
        variant="danger"
      />

      {/* Student Performance Modal */}
      <AnimatePresence>
        {performanceStudentId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => { setPerformanceStudentId(null); setPerformanceData(null); }}
          >
            <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-2xl border bg-background shadow-2xl max-h-[80vh] overflow-y-auto"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-3">
                  <BarChart3 className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-lg font-bold text-foreground">أداء الطالب</h3>
                </div>
                <button
                  onClick={() => { setPerformanceStudentId(null); setPerformanceData(null); }}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Content */}
              <div className="p-5 space-y-5">
                {loadingPerformance ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
                  </div>
                ) : performanceData ? (
                  <>
                    {/* Average Grade */}
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                        <Award className="h-6 w-6 text-emerald-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">متوسط الدرجات</p>
                        <p className="text-2xl font-bold text-foreground">
                          {performanceData.avgGrade !== null ? `${performanceData.avgGrade}%` : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Attendance */}
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100">
                        <UserCheck className="h-6 w-6 text-teal-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">الحضور</p>
                        <p className="text-lg font-bold text-foreground">
                          {performanceData.attendance.present} / {performanceData.attendance.total}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          نسبة الحضور: {performanceData.attendance.percentage}%
                        </p>
                      </div>
                      {/* Progress bar for attendance */}
                      <div className="w-20">
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              performanceData.attendance.percentage >= 75 ? 'bg-emerald-500' :
                              performanceData.attendance.percentage >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${performanceData.attendance.percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Submissions by task */}
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-amber-600" />
                        التسليمات ({performanceData.submissions.length})
                      </h4>
                      {performanceData.submissions.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">لا توجد تسليمات</p>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {performanceData.submissions.map((sub, i) => {
                            const pct = sub.total > 0 ? Math.round((sub.grade / sub.total) * 100) : 0;
                            return (
                              <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                  pct >= 75 ? 'bg-emerald-50' : pct >= 50 ? 'bg-amber-50' : 'bg-rose-50'
                                }`}>
                                  <span className={`text-xs font-bold ${
                                    pct >= 75 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-rose-600'
                                  }`}>{pct}%</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{sub.assignmentName}</p>
                                  <p className="text-xs text-muted-foreground">{sub.grade}/{sub.total}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-center text-muted-foreground py-4">لا توجد بيانات</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Student Profile Modal */}
      {selectedStudentId && (
        <StudentProfileModal
          studentId={selectedStudentId}
          subjectId={subjectId}
          open={profileModalOpen}
          onClose={() => { setProfileModalOpen(false); setSelectedStudentId(null); }}
        />
      )}

      {/* ============================================================ */}
      {/* Centered Modal for Pending Requests (gentle appearance)      */}
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
                      <UserPlus className="h-5.5 w-5.5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">طلبات الانضمام</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {pendingRequests.length > 0
                          ? `${pendingRequests.length} طلب بانتظار المراجعة`
                          : 'لا توجد طلبات معلقة حالياً'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingPanelOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/60 hover:text-foreground transition-all duration-200"
                  >
                    <X className="h-4.5 w-4.5" />
                  </button>
                </div>
                {/* Bulk actions */}
                {pendingRequests.length > 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 }}
                    className="flex items-center gap-2.5 mt-5"
                  >
                    <button
                      onClick={() => setAcceptAllConfirmOpen(true)}
                      disabled={bulkProcessing}
                      className="flex items-center gap-2 rounded-xl bg-emerald-600/90 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-emerald-200/50 hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60 transition-all duration-200 disabled:opacity-50 disabled:shadow-none"
                    >
                      {bulkProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      قبول الكل ({pendingRequests.length})
                    </button>
                    <button
                      onClick={() => setRejectAllConfirmOpen(true)}
                      disabled={bulkProcessing}
                      className="flex items-center gap-2 rounded-xl border border-rose-200/80 bg-white/80 px-4 py-2.5 text-xs font-semibold text-rose-500 hover:bg-rose-50 hover:border-rose-300 transition-all duration-200 disabled:opacity-50"
                    >
                      {bulkProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      رفض الكل
                    </button>
                  </motion.div>
                )}
              </div>

              {/* Soft divider */}
              <div className="shrink-0 mx-6 h-px bg-gradient-to-l from-transparent via-border to-transparent" />

              {/* Pending Requests List */}
              <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
                {loadingPending ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="relative">
                      <div className="h-12 w-12 rounded-full border-2 border-emerald-200 border-t-emerald-500 animate-spin" />
                    </div>
                    <p className="text-sm text-muted-foreground mt-4">جارٍ تحميل الطلبات...</p>
                  </div>
                ) : pendingRequests.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.35, delay: 0.1 }}
                    className="flex flex-col items-center justify-center py-14"
                  >
                    <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100/50 mb-5 shadow-sm">
                      <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                    </div>
                    <p className="text-base font-semibold text-foreground mb-1.5">كل شيء جاهز! 🎉</p>
                    <p className="text-sm text-muted-foreground text-center leading-relaxed">
                      لا توجد طلبات انضمام معلقة
                      <br />
                      عندما يطلب طالب الانضمام سيظهر هنا
                    </p>
                  </motion.div>
                ) : (
                  <div className="space-y-3">
                    {pendingRequests.map((student, index) => (
                      <motion.div
                        key={student.id}
                        initial={{ opacity: 0, y: 12, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.2 } }}
                        transition={{ duration: 0.35, delay: 0.08 + index * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
                        className="group rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm hover:shadow-md hover:border-emerald-200/50 transition-all duration-250"
                      >
                        <div className="flex items-center gap-3.5 mb-3.5">
                          <UserLink
                            userId={student.id}
                            name={student.name || 'مستخدم'}
                            avatarUrl={student.avatar_url}
                            role="student"
                            gender={student.gender}
                            size="md"
                            showAvatar={true}
                            showUsername={false}
                            className="flex-1 min-w-0"
                          />
                        </div>
                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={() => handleApproveRequest(student.id)}
                            disabled={processingId === student.id}
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600/90 px-3 py-2.5 text-xs font-bold text-white shadow-sm shadow-emerald-200/50 hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none transition-all duration-200"
                          >
                            {processingId === student.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                            قبول
                          </button>
                          <button
                            onClick={() => handleRejectRequest(student.id)}
                            disabled={processingId === student.id}
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-rose-200/80 bg-white/80 px-3 py-2.5 text-xs font-bold text-rose-500 hover:bg-rose-50 hover:border-rose-300 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
                          >
                            {processingId === student.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-4 w-4" />}
                            رفض
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Soft footer */}
              {pendingRequests.length > 0 && (
                <div className="shrink-0 px-6 py-3 bg-muted/20 border-t border-border/30">
                  <p className="text-[11px] text-muted-foreground/60 text-center">
                    اضغط على «قبول» لإضافة الطالب للمقرر أو «رفض» لإلغاء الطلب
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
