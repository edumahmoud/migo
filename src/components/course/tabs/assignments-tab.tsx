'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePWALifecycle } from '@/hooks/use-pwa-lifecycle';
import {
  ClipboardCheck,
  Plus,
  X,
  Loader2,
  Trash2,
  Calendar,
  Clock,
  Upload,
  CheckCircle2,
  Award,
  AlertCircle,
  FileText,
  MessageSquare,
  Pencil,
  FolderOpen,
  FileUp,
  Filter,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { waitForSession } from '@/lib/client-auth';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import type { UserProfile, Subject, Assignment, Submission, UserFile } from '@/lib/types';
import UserAvatar from '@/components/shared/user-avatar';
import { useTranslations } from '@/i18n/use-translations';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AssignmentsTabProps {
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
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

/**
 * Detects if a date string is date-only (e.g. "2025-03-05" from a DATE column)
 * vs a full timestamp (e.g. "2025-03-05T23:59:00.000Z" from TIMESTAMPTZ).
 */
function isDateOnly(dateStr: string): boolean {
  if (!dateStr) return false;
  // A date-only string matches YYYY-MM-DD with no time component
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
}

function formatDateTime(dateStr: string): string {
  try {
    // If the string is date-only (from a DATE column), don't show misleading time
    if (isDateOnly(dateStr)) {
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('ar-SA', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
    }
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return dateStr; }
}

// Convert a UTC ISO string to a local datetime-local input value (YYYY-MM-DDTHH:mm)
function toLocalDatetimeValue(isoStr: string): string {
  try {
    // Handle date-only strings from DATE column
    if (isDateOnly(isoStr)) {
      // Date-only strings represent the end of that day for deadline purposes
      // e.g. "2025-03-05" → "2025-03-05T23:59"
      return `${isoStr.trim()}T23:59`;
    }
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
}

// Convert a local datetime-local value (YYYY-MM-DDTHH:mm) to UTC ISO string
// Works with both DATE and TIMESTAMPTZ columns
function toUTCISOString(localDatetime: string): string {
  if (!localDatetime) return '';
  try {
    // datetime-local gives us a string like "2025-03-05T23:59"
    // new Date() interprets this as local time, then toISOString() converts to UTC
    const d = new Date(localDatetime);
    if (isNaN(d.getTime())) {
      // Fallback: try treating as ISO with appended Z
      const fallback = new Date(localDatetime + 'Z');
      if (!isNaN(fallback.getTime())) return fallback.toISOString();
      return localDatetime;
    }
    return d.toISOString();
  } catch {
    return localDatetime;
  }
}

function getCountdown(dueDate: string): { days: number; hours: number; minutes: number; urgent: boolean; expired: boolean } {
  const now = new Date();
  // For date-only strings, treat the deadline as end of that day
  let due: Date;
  if (isDateOnly(dueDate)) {
    due = new Date(dueDate + 'T23:59:59');
  } else {
    due = new Date(dueDate);
  }
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return { days: 0, hours: 0, minutes: 0, urgent: false, expired: true };
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const urgent = diffMs < 24 * 60 * 60 * 1000; // less than 24 hours
  return { days, hours, minutes, urgent, expired: false };
}

function isPastDue(dueDate: string): boolean {
  // For date-only strings, the deadline is end of day
  if (isDateOnly(dueDate)) {
    return new Date(dueDate + 'T23:59:59') < new Date();
  }
  return new Date(dueDate) < new Date();
}

interface SubmissionWithStudent extends Submission {
  student_name?: string;
  student_email?: string;
  student_avatar?: string | null;
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AssignmentsTab({ profile, role, subjectId }: AssignmentsTabProps) {
  const { t, direction } = useTranslations('course');
  const { t: tc } = useTranslations('common');

  // Format countdown text using translation keys
  const formatCountdown = (cd: { days: number; hours: number; minutes: number; expired: boolean }) => {
    if (cd.expired) return tc('expired');
    if (cd.days > 0) return `${cd.days} ${tc('day')} ${cd.hours} ${tc('hour')}`;
    if (cd.hours > 0) return `${cd.hours} ${tc('hour')} ${cd.minutes} ${tc('minute')}`;
    return `${cd.minutes} ${tc('minute')}`;
  };
  // ─── Data state ───
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ─── Active/Expired tab ───
  const [activeTab, setActiveTab] = useState<'active' | 'expired'>('active');

  // ─── Create modal ───
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDueDatetime, setNewDueDatetime] = useState('');
  const [newMaxScore, setNewMaxScore] = useState(100);
  const [newAllowFile, setNewAllowFile] = useState(true);
  const [newShowGrade, setNewShowGrade] = useState(true);
  const [creating, setCreating] = useState(false);

  // ─── Edit modal ───
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDueDatetime, setEditDueDatetime] = useState('');
  const [editMaxScore, setEditMaxScore] = useState(100);
  const [editAllowFile, setEditAllowFile] = useState(true);
  const [editShowGrade, setEditShowGrade] = useState(true);
  const [saving, setSaving] = useState(false);

  // ─── Delete confirm ───
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ─── Detail view ───
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionWithStudent[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // ─── Student: own submissions ───
  const [mySubmissions, setMySubmissions] = useState<Record<string, Submission>>({});

  // ─── Student: submit state ───
  const [submitContent, setSubmitContent] = useState('');
  const [submitFile, setSubmitFile] = useState<File | null>(null);
  const [submitFileBuffer, setSubmitFileBuffer] = useState<ArrayBuffer | null>(null); // Pre-read for mobile
  const [submitting, setSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<'text' | 'upload' | 'existing'>('text');
  const [selectedExistingFile, setSelectedExistingFile] = useState<UserFile | null>(null);
  const [myFiles, setMyFiles] = useState<UserFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── PWA Lifecycle protection ───
  usePWALifecycle({
    stateKey: `assignments-${subjectId}`,
    isBusy: createOpen || editOpen || submitting,
    onSave: undefined,
    onRestore: undefined,
  });

  // ─── Grading ───
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [gradeScore, setGradeScore] = useState('');
  const [gradeFeedback, setGradeFeedback] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  // -------------------------------------------------------
  // Fetch assignments
  // -------------------------------------------------------
  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('assignments')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });
      if (error) console.error('Error:', error);
      else setAssignments((data as Assignment[]) || []);
    } catch (err) {
      console.error('Fetch assignments error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  // -------------------------------------------------------
  // Fetch my submissions (student)
  // -------------------------------------------------------
  const fetchMySubmissions = useCallback(async () => {
    if (role !== 'student') return;
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('student_id', profile.id);
    if (error) console.error('Error:', error);
    else {
      const map: Record<string, Submission> = {};
      for (const sub of (data as Submission[]) || []) {
        map[sub.assignment_id] = sub;
      }
      setMySubmissions(map);
    }
  }, [profile.id, role]);

  // -------------------------------------------------------
  // Fetch my files (student) - for existing file selection
  // -------------------------------------------------------
  const fetchMyFiles = useCallback(async () => {
    if (role !== 'student') return;
    const { data, error } = await supabase
      .from('user_files')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) console.error('Error:', error);
    else setMyFiles((data as UserFile[]) || []);
  }, [profile.id, role]);

  // -------------------------------------------------------
  // Fetch submissions (teacher)
  // -------------------------------------------------------
  const fetchSubmissions = useCallback(async (assignmentId: string) => {
    setLoadingSubmissions(true);
    try {
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignmentId);
      if (error) {
        console.error('Error:', error);
        setSubmissions([]);
      } else {
        const subs = (data as Submission[]) || [];
        if (subs.length === 0) {
          setSubmissions([]);
        } else {
          // Batch-fetch all student names in a single query (fixes N+1 problem)
          const studentIds = [...new Set(subs.map(s => s.student_id))];
          const { data: studentsData } = await supabase
            .from('users')
            .select('id, name, email')
            .in('id', studentIds);

          const studentMap = new Map(
            (studentsData || []).map((s: { id: string; name?: string; email?: string }) => [s.id, s])
          );

          const enriched: SubmissionWithStudent[] = subs.map(sub => ({
            ...sub,
            student_name: studentMap.get(sub.student_id)?.name || t('studentFallback'),
            student_email: studentMap.get(sub.student_id)?.email || '',
          }));
          setSubmissions(enriched);
        }
      }
    } catch {
      setSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAssignments();
    fetchMySubmissions();
    fetchMyFiles();
  }, [fetchAssignments, fetchMySubmissions, fetchMyFiles]);

  // ─── Realtime: assignments & submissions for instant CRUD updates ───
  // Without this, students must navigate away and back to see new assignments,
  // and teachers must do the same to see new submissions.
  useEffect(() => {
    const assignmentsChannel = supabase
      .channel(`assignments-${subjectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments', filter: `subject_id=eq.${subjectId}` },
        () => { fetchAssignments(); }
      )
      .subscribe();

    const submissionsChannel = supabase
      .channel(`submissions-${subjectId}-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'submissions', filter: `student_id=eq.${profile.id}` },
        () => {
          fetchMySubmissions();
          // If viewing a specific assignment, refresh its submissions too
          if (selectedAssignment) fetchSubmissions(selectedAssignment.id);
        }
      )
      .subscribe();

    // For teachers: also listen to all submissions for this subject
    let teacherSubsChannel: ReturnType<typeof supabase.channel> | null = null;
    if (role === 'teacher') {
      teacherSubsChannel = supabase
        .channel(`teacher-subs-${subjectId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'submissions' },
          () => {
            // Refresh the selected assignment's submissions if any
            if (selectedAssignment) fetchSubmissions(selectedAssignment.id);
          }
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(assignmentsChannel);
      supabase.removeChannel(submissionsChannel);
      if (teacherSubsChannel) supabase.removeChannel(teacherSubsChannel);
    };
  }, [subjectId, profile.id, role, fetchAssignments, fetchMySubmissions, selectedAssignment, fetchSubmissions]);

  useEffect(() => {
    if (selectedAssignment) fetchSubmissions(selectedAssignment.id);
  }, [selectedAssignment, fetchSubmissions]);

  // -------------------------------------------------------
  // Computed: filtered assignments by tab
  // -------------------------------------------------------
  const activeAssignments = assignments.filter((a) => {
    if (!a.due_date) return true; // No due date = active
    return !isPastDue(a.due_date);
  });

  const expiredAssignments = assignments.filter((a) => {
    if (!a.due_date) return false; // No due date = never expired
    return isPastDue(a.due_date);
  });

  const filteredAssignments = activeTab === 'active' ? activeAssignments : expiredAssignments;

  // -------------------------------------------------------
  // Create assignment
  // -------------------------------------------------------
  const handleCreate = async () => {
    // Read current state values at call time to avoid stale closures
    const currentTitle = newTitle.trim();
    const currentDueDatetime = newDueDatetime;
    const currentDesc = newDesc.trim();
    const currentMaxScore = newMaxScore;
    const currentAllowFile = newAllowFile;
    const currentShowGrade = newShowGrade;

    if (!currentTitle) { toast.error(t('enterAssignmentTitle')); return; }
    if (!currentDueDatetime) { toast.error(t('setDeadlineToast')); return; }
    setCreating(true);
    try {
      const dueDateValue = toUTCISOString(currentDueDatetime);

      const { data: newAssignment, error } = await supabase.from('assignments').insert({
        subject_id: subjectId,
        teacher_id: profile.id,
        title: currentTitle,
        description: currentDesc || null,
        due_date: dueDateValue,
        max_score: currentMaxScore,
        allow_file_submission: currentAllowFile,
        show_grade: currentShowGrade,
      }).select().single();
      if (error) toast.error(t('errorCreatingAssignment'));
      else {
        toast.success(t('assignmentCreatedSuccess'));
        // Optimistic: add to local state immediately (no full refetch)
        if (newAssignment) {
          setAssignments((prev) => [newAssignment as Assignment, ...prev]);
        }
        // Send notification to all students in the subject
        try {
          const { getCachedAuthHeaders } = await import('@/lib/client-auth');
          const authHeaders = await getCachedAuthHeaders();
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
              action: 'assignment_created',
              subjectId,
              assignmentTitle: currentTitle,
              teacherName: profile.name,
            }),
          });
        } catch { /* notification failure is non-critical */ }
        setCreateOpen(false);
        setNewTitle('');
        setNewDesc('');
        setNewDueDatetime('');
        setNewMaxScore(100);
        setNewAllowFile(true);
        setNewShowGrade(true);
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setCreating(false);
    }
  };

  // -------------------------------------------------------
  // Edit assignment
  // -------------------------------------------------------
  const openEditModal = (assignment: Assignment) => {
    setEditId(assignment.id);
    setEditTitle(assignment.title);
    setEditDesc(assignment.description || '');
    if (assignment.due_date) {
      setEditDueDatetime(toLocalDatetimeValue(assignment.due_date));
    } else {
      setEditDueDatetime('');
    }
    setEditMaxScore(assignment.max_score);
    setEditAllowFile(assignment.allow_file_submission);
    setEditShowGrade(assignment.show_grade !== false);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editId) return;
    // Read current state values at call time to avoid stale closures
    const currentEditTitle = editTitle.trim();
    const currentEditDueDatetime = editDueDatetime;
    const currentEditDesc = editDesc.trim();
    const currentEditMaxScore = editMaxScore;
    const currentEditAllowFile = editAllowFile;
    const currentEditShowGrade = editShowGrade;

    if (!currentEditTitle) { toast.error(t('enterAssignmentTitle')); return; }
    if (!currentEditDueDatetime) { toast.error(t('setDeadlineToast')); return; }
    setSaving(true);
    try {
      const dueDateValue = toUTCISOString(currentEditDueDatetime);

      const { error } = await supabase
        .from('assignments')
        .update({
          title: currentEditTitle,
          description: currentEditDesc || null,
          due_date: dueDateValue,
          max_score: currentEditMaxScore,
          allow_file_submission: currentEditAllowFile,
          show_grade: currentEditShowGrade,
        })
        .eq('id', editId);
      if (error) toast.error(t('errorEditingAssignment'));
      else {
        toast.success(t('assignmentEditedSuccess'));
        setEditOpen(false);
        // Optimistic: update local state immediately (no full refetch)
        const updatedFields = {
          title: currentEditTitle,
          description: currentEditDesc || undefined,
          due_date: dueDateValue || undefined,
          max_score: currentEditMaxScore,
          allow_file_submission: currentEditAllowFile,
          show_grade: currentEditShowGrade,
        };
        setAssignments((prev) =>
          prev.map((a) => a.id === editId ? { ...a, ...updatedFields } as Assignment : a)
        );
        setEditId(null);
        // Update selected assignment if it's the one being edited
        if (selectedAssignment?.id === editId) {
          setSelectedAssignment({
            ...selectedAssignment,
            ...updatedFields,
          } as Assignment);
        }
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------
  // Delete assignment
  // -------------------------------------------------------
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from('assignments').delete().eq('id', id);
      if (error) toast.error(t('errorDeletingAssignment'));
      else {
        toast.success(t('assignmentDeletedToast'));
        // Optimistic: remove from local state immediately (no full refetch)
        setAssignments((prev) => prev.filter((a) => a.id !== id));
        if (selectedAssignment?.id === id) {
          setSelectedAssignment(null);
          setSubmissions([]);
        }
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  // -------------------------------------------------------
  // Submit assignment (student)
  // -------------------------------------------------------
  const handleSubmit = async () => {
    if (!selectedAssignment) return;

    // Check deadline
    if (selectedAssignment.due_date && isPastDue(selectedAssignment.due_date)) {
      toast.error(t('deadlineExpiredForAssignment'));
      return;
    }

    if (mySubmissions[selectedAssignment.id]) {
      toast.error(t('alreadySubmittedAlt'));
      return;
    }

    // Read current state values at call time
    const currentSubmitMode = submitMode;
    const currentSubmitContent = submitContent.trim();
    const currentSubmitFile = submitFile;
    const currentSubmitFileBuffer = submitFileBuffer;
    const currentSelectedExistingFile = selectedExistingFile;

    if (currentSubmitMode === 'text' && !currentSubmitContent) {
      toast.error(t('enterContent'));
      return;
    }

    if (currentSubmitMode === 'upload' && !currentSubmitFile) {
      toast.error(t('selectFileToUpload'));
      return;
    }

    if (currentSubmitMode === 'existing' && !currentSelectedExistingFile) {
      toast.error(t('selectFileFromYourFiles'));
      return;
    }

    setSubmitting(true);
    try {
      let fileId: string | null = null;
      let contentValue = currentSubmitContent || null;

      if (currentSubmitMode === 'upload' && currentSubmitFile && selectedAssignment.allow_file_submission) {
        // Use waitForSession for mobile PWA reliability (handles session hydration delay)
        const uploadToken = await waitForSession(15000);
        if (!uploadToken) {
          toast.error(t('loginFirst'));
          setSubmitting(false);
          return;
        }

        // Pre-read file into ArrayBuffer on mobile to prevent File object becoming invalid
        let fileToUpload: File | Blob = currentSubmitFile;
        if (currentSubmitFileBuffer) {
          // Use pre-read ArrayBuffer to create a fresh Blob (mobile PWA fix)
          fileToUpload = new Blob([currentSubmitFileBuffer], { type: currentSubmitFile.type || 'application/octet-stream' });
        }

        const formData = new FormData();
        formData.append('file', fileToUpload, currentSubmitFile.name);
        formData.append('userId', profile.id);
        formData.append('assignmentId', selectedAssignment.id);

        // Add upload timeout to prevent infinity loading
        const uploadController = new AbortController();
        const uploadTimeoutId = setTimeout(() => uploadController.abort(), 60000); // 60s timeout

        try {
          const uploadRes = await fetch('/api/files/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${uploadToken}` },
            body: formData,
            signal: uploadController.signal,
          });

          clearTimeout(uploadTimeoutId);

          if (!uploadRes.ok) {
            const errorData = await uploadRes.json().catch(() => ({ error: t('errorUploadingFile') }));
            toast.error(errorData.error || t('errorUploadingFile'));
            setSubmitting(false);
            return;
          }

          const uploadResult = await uploadRes.json();
          if (!uploadResult.success) {
            toast.error(uploadResult.error || t('errorUploadingFile'));
            setSubmitting(false);
            return;
          }
          fileId = uploadResult.data?.id || null;
        } catch (uploadErr) {
          clearTimeout(uploadTimeoutId);
          if (uploadErr instanceof Error && uploadErr.name === 'AbortError') {
            toast.error(t('uploadTimeoutRetry'));
          } else {
            toast.error(t('errorUploadingFileRetry'));
          }
          setSubmitting(false);
          return;
        }
      } else if (currentSubmitMode === 'existing' && currentSelectedExistingFile) {
        // Use existing file
        fileId = currentSelectedExistingFile.id;
        // Update the user_file to link with this assignment
        await supabase
          .from('user_files')
          .update({ assignment_id: selectedAssignment.id })
          .eq('id', currentSelectedExistingFile.id);
      }

      const { error } = await supabase.from('submissions').insert({
        assignment_id: selectedAssignment.id,
        student_id: profile.id,
        content: contentValue,
        file_id: fileId,
        status: 'submitted',
      });
      if (error) toast.error(t('errorSubmittingAssignment'));
      else {
        toast.success(t('submissionSuccess'));
        // Send notification to teacher
        try {
          const notifyToken = await waitForSession(10000);
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(notifyToken ? { 'Authorization': `Bearer ${notifyToken}` } : {}) },
            body: JSON.stringify({
              action: 'assignment_submitted',
              assignmentId: selectedAssignment.id,
              teacherId: selectedAssignment.teacher_id,
              studentName: profile.name,
              assignmentTitle: selectedAssignment.title,
              subjectId,
            }),
          });
        } catch { /* notification failure is non-critical */ }
        setSubmitContent('');
        setSubmitFile(null);
        setSubmitFileBuffer(null);
        setSelectedExistingFile(null);
        setSubmitMode('text');
        fetchMySubmissions();
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Save grade (teacher)
  // -------------------------------------------------------
  const handleSaveGrade = async (submissionId: string) => {
    const scoreVal = Number(gradeScore);
    if (isNaN(scoreVal) || scoreVal < 0) { toast.error(t('enterValidGrade')); return; }
    if (selectedAssignment && scoreVal > selectedAssignment.max_score) {
      toast.error(t('gradeMustNotExceed', { max: selectedAssignment.max_score }));
      return;
    }
    setSavingGrade(true);
    try {
      const { error } = await supabase
        .from('submissions')
        .update({
          score: scoreVal,
          feedback: gradeFeedback.trim() || null,
          status: 'graded',
          graded_at: new Date().toISOString(),
        })
        .eq('id', submissionId);
      if (error) toast.error(t('failedToSaveGrade'));
      else {
        toast.success(t('gradeSaved'));
        // Send notification to the student
        const gradedSubmission = submissions.find((s) => s.id === submissionId);
        if (gradedSubmission && selectedAssignment) {
          try {
            const { getCachedAuthHeaders } = await import('@/lib/client-auth');
            const authHeaders = await getCachedAuthHeaders();
            await fetch('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({
                action: 'assignment_graded',
                studentId: gradedSubmission.student_id,
                assignmentTitle: selectedAssignment.title,
                score: scoreVal,
                maxScore: selectedAssignment.max_score,
                teacherName: profile.name,
                subjectId,
              }),
            });
          } catch { /* notification failure is non-critical */ }
        }
        setGradingId(null);
        setGradeScore('');
        setGradeFeedback('');
        if (selectedAssignment) fetchSubmissions(selectedAssignment.id);
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setSavingGrade(false);
    }
  };

  // -------------------------------------------------------
  // Drag & drop handlers
  // -------------------------------------------------------
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSubmitFile(file);
      // Pre-read for mobile PWA reliability
      file.arrayBuffer().then(buf => setSubmitFileBuffer(buf)).catch(() => {});
      setSubmitMode('upload');
    }
  };

  // -------------------------------------------------------
  // Status badge
  // -------------------------------------------------------
  const getStatusBadge = (status: 'submitted' | 'graded' | 'returned') => {
    switch (status) {
      case 'submitted':
        return <Badge className="bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-500 text-[10px]"><Clock className="h-2.5 w-2.5 me-1" />{t('submittedStatus')}</Badge>;
      case 'graded':
        return <Badge className="bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5 me-1" />{t('gradedStatus')}</Badge>;
      case 'returned':
        return <Badge className="bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-400 text-[10px]"><MessageSquare className="h-2.5 w-2.5 me-1" />{t('returnedStatus')}</Badge>;
    }
  };

  // -------------------------------------------------------
  // Render: List view
  // -------------------------------------------------------
  const renderList = () => (
    <>
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground">{t('tabAssignments')}</h3>
          <p className="text-muted-foreground text-sm mt-1">{t('assignmentCount', { count: assignments.length })}</p>
        </div>
        {role === 'teacher' && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sky-800 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            {t('addAssignment')}
          </button>
        )}
      </motion.div>



      {/* Active/Expired Tab Switcher */}
      {!loading && assignments.length > 0 && (
        <motion.div variants={itemVariants} className="flex items-center gap-1 rounded-xl border bg-muted/50 p-1 w-fit">
          <button
            onClick={() => setActiveTab('active')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
              activeTab === 'active'
                ? 'bg-sky-700 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            {t('active')}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              activeTab === 'active'
                ? 'bg-sky-600 text-white'
                : 'bg-muted text-muted-foreground'
            }`}>
              {activeAssignments.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('expired')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
              activeTab === 'expired'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            {t('expired')}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              activeTab === 'expired'
                ? 'bg-rose-500 text-white'
                : 'bg-muted text-muted-foreground'
            }`}>
              {expiredAssignments.length}
            </span>
          </button>
        </motion.div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
        </div>
      ) : assignments.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-20"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-100 dark:bg-sky-800/40 mb-5">
            <ClipboardCheck className="h-10 w-10 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1">{t('noAssignmentsYet')}</p>
          <p className="text-sm text-muted-foreground">
            {role === 'teacher' ? t('createNewAssignment') : t('noAssignmentsAddedYet')}
          </p>
        </motion.div>
      ) : filteredAssignments.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100 dark:bg-sky-800/40 mb-4">
            <Filter className="h-8 w-8 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            {activeTab === 'active' ? t('noActiveAssignments') : t('noExpiredAssignments')}
          </p>
          <p className="text-xs text-muted-foreground">
            {activeTab === 'active' ? t('allDeadlinesExpired') : t('noAssignmentsExpiredYet')}
          </p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {filteredAssignments.map((assignment) => {
            const mySub = mySubmissions[assignment.id];
            const countdown = assignment.due_date ? getCountdown(assignment.due_date) : null;
            const pastDue = assignment.due_date ? isPastDue(assignment.due_date) : false;

            return (
              <motion.div key={assignment.id} variants={itemVariants}>
                <div
                  className="group relative rounded-2xl border bg-card p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
                  onClick={() => { setSelectedAssignment(assignment); setGradingId(null); setSubmitContent(''); setSubmitFile(null); setSelectedExistingFile(null); setSubmitMode('text'); }}
                >
                  {/* Top accent bar - color based on status */}
                  <div className={`absolute top-0 end-0 start-0 h-1.5 rounded-t-2xl ${
                    pastDue ? 'bg-rose-500' : countdown?.urgent ? 'bg-amber-500' : 'bg-sky-600'
                  }`} />

                  {/* Teacher actions */}
                  {role === 'teacher' && (
                    <div className="absolute top-3 start-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditModal(assignment); }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sky-50 hover:text-sky-700"
                        title={tc('edit')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(assignment.id); }}
                        disabled={deletingId === assignment.id}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                        title={tc('delete')}
                      >
                        {deletingId === assignment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-3 mt-1">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      pastDue ? 'bg-rose-100 dark:bg-rose-800/40' : countdown?.urgent ? 'bg-amber-100 dark:bg-amber-800/40' : 'bg-sky-100 dark:bg-sky-800/40'
                    }`}>
                      <ClipboardCheck className={`h-5 w-5 ${
                        pastDue ? 'text-rose-600 dark:text-rose-500' : countdown?.urgent ? 'text-amber-600 dark:text-amber-500' : 'text-sky-700 dark:text-sky-400'
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-foreground truncate">{assignment.title}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        {assignment.created_at && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            {formatDateTime(assignment.created_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    {assignment.due_date && (
                      <div className={`flex items-center gap-1.5 text-xs ${
                        pastDue ? 'text-rose-600 dark:text-rose-500' : countdown?.urgent ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
                      }`}>
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(assignment.due_date)}
                        {!pastDue && countdown && (
                          <span className={`font-medium ${countdown.urgent ? 'text-amber-600 dark:text-amber-500' : 'text-sky-700 dark:text-sky-400'}`}>
                            ({formatCountdown(countdown)})
                          </span>
                        )}
                        {pastDue && (
                          <span className="font-medium text-rose-600 dark:text-rose-500">({t('expiredParens')})</span>
                        )}
                      </div>
                    )}
                    {role === 'student' && (
                      mySub ? getStatusBadge(mySub.status) : (
                        pastDue ? (
                          <Badge className="bg-rose-100 dark:bg-rose-800/40 text-rose-700 dark:text-rose-500 text-[10px]">
                            <AlertCircle className="h-2.5 w-2.5 me-1" />{t('expiredStatus')}
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-500 text-[10px]">
                            <AlertCircle className="h-2.5 w-2.5 me-1" />{t('notSubmittedStatus')}
                          </Badge>
                        )
                      )
                    )}
                    {role === 'teacher' && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Award className="h-3 w-3" />
                        {assignment.max_score} {t('pointsUnit')}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteConfirmId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setDeleteConfirmId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0, pointerEvents: 'none' as const }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border bg-background shadow-xl p-6 text-center"
              dir={direction}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-800/40 mx-auto mb-4">
                <Trash2 className="h-6 w-6 text-rose-600 dark:text-rose-500" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{t('deleteAssignmentTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-6">{t('deleteAssignmentConfirm')}</p>
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={() => handleDelete(deleteConfirmId)}
                  disabled={deletingId === deleteConfirmId}
                  className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {deletingId === deleteConfirmId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {tc('delete')}
                </button>
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                >
                  {tc('cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  // -------------------------------------------------------
  // Render: Teacher detail
  // -------------------------------------------------------
  const renderTeacherDetail = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <button
          onClick={() => { setSelectedAssignment(null); setSubmissions([]); }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold text-foreground truncate">{selectedAssignment!.title}</h3>
          <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground flex-wrap">
            {selectedAssignment!.created_at && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {t('createdLabel')} {formatDateTime(selectedAssignment!.created_at)}
              </span>
            )}
            {selectedAssignment!.due_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {t('deadlineLabel')} {formatDateTime(selectedAssignment!.due_date)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Award className="h-3.5 w-3.5" />
              {selectedAssignment!.max_score} {t('pointsUnit')}
            </span>
          </div>
        </div>
        <button
          onClick={() => openEditModal(selectedAssignment!)}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-400 hover:bg-sky-50 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          {tc('edit')}
        </button>
      </motion.div>

      {selectedAssignment!.description && (
        <motion.div variants={itemVariants} className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedAssignment!.description}</p>
        </motion.div>
      )}

      <motion.div variants={itemVariants}>
        <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
          {t('submissions')} ({submissions.length})
        </h4>
        {loadingSubmissions ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-sky-700 dark:text-sky-400" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">{t('noSubmissionsYet')}</div>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => (
              <div key={sub.id} className="rounded-xl border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserAvatar name={sub.student_name || t('userFallback')} avatarUrl={sub.student_avatar} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{sub.student_name}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(sub.submitted_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(sub.status)}
                    {sub.score !== undefined && sub.score !== null && (
                      <span className="text-sm font-bold text-sky-800 dark:text-sky-400">{sub.score}/{selectedAssignment!.max_score}</span>
                    )}
                  </div>
                </div>
                {sub.content && (
                  <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-2">{sub.content}</p>
                )}
                {sub.file_id && (
                  <button
                    onClick={async () => {
                      const { data } = await supabase.from('user_files').select('file_url, file_name').eq('id', sub.file_id!).single();
                      if (data) window.open((data as { file_url: string }).file_url, '_blank');
                    }}
                    className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/15 rounded-lg px-2.5 py-1.5 w-fit hover:bg-sky-100 transition-colors"
                  >
                    <FileText className="h-3 w-3" />
                    {t('filePreview')}
                  </button>
                )}
                {sub.status !== 'graded' && gradingId !== sub.id && (
                  <button
                    onClick={() => { setGradingId(sub.id); setGradeScore(''); setGradeFeedback(''); }}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-800"
                  >
                    <Award className="h-3 w-3" />
                    {t('evaluate')}
                  </button>
                )}
                {gradingId === sub.id && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="number"
                        min={0}
                        max={selectedAssignment!.max_score}
                        value={gradeScore}
                        onChange={(e) => setGradeScore(e.target.value)}
                        placeholder={`0 - ${selectedAssignment!.max_score}`}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/30"
                        dir="ltr"
                      />
                      <textarea
                        value={gradeFeedback}
                        onChange={(e) => setGradeFeedback(e.target.value)}
                        placeholder={t('feedbackPlaceholderShort')}
                        rows={2}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/30 resize-none"
                        dir={direction}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveGrade(sub.id)}
                        disabled={savingGrade}
                        className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-sky-800 disabled:opacity-60"
                      >
                        {savingGrade ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        {tc('save')}
                      </button>
                      <button
                        onClick={() => { setGradingId(null); setGradeScore(''); setGradeFeedback(''); }}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        {tc('cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Student detail
  // -------------------------------------------------------
  const renderStudentDetail = () => {
    const mySub = mySubmissions[selectedAssignment!.id];
    const pastDue = selectedAssignment!.due_date ? isPastDue(selectedAssignment!.due_date) : false;
    const countdown = selectedAssignment!.due_date ? getCountdown(selectedAssignment!.due_date) : null;

    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
        <motion.div variants={itemVariants} className="flex items-center gap-3">
          <button
            onClick={() => { setSelectedAssignment(null); setSubmitContent(''); setSubmitFile(null); setSelectedExistingFile(null); setSubmitMode('text'); }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold text-foreground truncate">{selectedAssignment!.title}</h3>
            <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground flex-wrap">
              {selectedAssignment!.created_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {t('createdLabel')} {formatDateTime(selectedAssignment!.created_at)}
                </span>
              )}
              {selectedAssignment!.due_date && (
                <span className={`flex items-center gap-1 ${pastDue ? 'text-rose-600 dark:text-rose-500' : countdown?.urgent ? 'text-amber-600 dark:text-amber-500' : ''}`}>
                  <Calendar className="h-3.5 w-3.5" />
                  {t('deadlineLabel')} {formatDateTime(selectedAssignment!.due_date)}
                  {pastDue && <span className="font-medium">({t('expiredParens')})</span>}
                  {!pastDue && countdown && (
                    <span className={`font-medium ${countdown.urgent ? 'text-amber-600 dark:text-amber-500' : 'text-sky-700 dark:text-sky-400'}`}>
                      ({formatCountdown(countdown)} {t('remaining')})
                    </span>
                  )}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Award className="h-3.5 w-3.5" />
                {selectedAssignment!.max_score} {t('pointsUnit')}
              </span>
            </div>
          </div>
        </motion.div>

        {selectedAssignment!.description && (
          <motion.div variants={itemVariants} className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedAssignment!.description}</p>
          </motion.div>
        )}

        {/* Deadline warning */}
        {pastDue && !mySub && (
          <motion.div variants={itemVariants} className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-900/20 p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-500 shrink-0" />
            <p className="text-sm text-rose-700 dark:text-rose-500 font-medium">{t('deadlineExpiredCannotSubmit')}</p>
          </motion.div>
        )}

        {/* My submission status */}
        {mySub && (
          <motion.div variants={itemVariants} className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-foreground">{t('mySubmission')}</h4>
              {getStatusBadge(mySub.status)}
            </div>
            {mySub.content && <p className="text-sm text-muted-foreground">{mySub.content}</p>}
            {mySub.file_id && (
              <button
                onClick={async () => {
                  const { data } = await supabase.from('user_files').select('file_url, file_name').eq('id', mySub.file_id!).single();
                  if (data) window.open((data as { file_url: string }).file_url, '_blank');
                }}
                className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/15 rounded-lg px-2.5 py-1.5 w-fit hover:bg-sky-100 transition-colors"
              >
                <FileText className="h-3 w-3" />
                {t('filePreview')}
              </button>
            )}
            {mySub.score !== undefined && mySub.score !== null && selectedAssignment!.show_grade !== false && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-sky-50 dark:bg-sky-900/15">
                <Award className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                <span className="text-sm font-bold text-sky-800 dark:text-sky-400">{mySub.score} / {selectedAssignment!.max_score}</span>
                <span className="text-xs text-sky-700 dark:text-sky-400">
                  ({Math.round((mySub.score / selectedAssignment!.max_score) * 100)}%)
                </span>
              </div>
            )}
            {mySub.feedback && selectedAssignment!.show_grade !== false && (
              <div className="p-2.5 rounded-lg bg-muted/30">
                <p className="text-xs font-medium text-foreground mb-1">{t('teacherFeedback')}</p>
                <p className="text-sm text-muted-foreground">{mySub.feedback}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Submit form - only if not submitted and not past due */}
        {!mySub && !pastDue && (
          <motion.div variants={itemVariants} className="rounded-xl border bg-card p-4 space-y-4">
            <h4 className="text-sm font-bold text-foreground">{t('submitAssignmentTitle')}</h4>

            {/* Submission mode tabs */}
            <div className="flex gap-2">
              <button
                onClick={() => setSubmitMode('text')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  submitMode === 'text'
                    ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15 text-sky-800 dark:text-sky-400'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                {t('textMode')}
              </button>
              {selectedAssignment!.allow_file_submission && (
                <>
                  <button
                    onClick={() => setSubmitMode('upload')}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      submitMode === 'upload'
                        ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15 text-sky-800 dark:text-sky-400'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <FileUp className="h-3 w-3" />
                    {t('uploadFileMode')}
                  </button>
                  <button
                    onClick={() => { setSubmitMode('existing'); fetchMyFiles(); }}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      submitMode === 'existing'
                        ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15 text-sky-800 dark:text-sky-400'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <FolderOpen className="h-3 w-3" />
                    {t('fromMyFiles')}
                  </button>
                </>
              )}
            </div>

            {/* Text submission */}
            {submitMode === 'text' && (
              <textarea
                value={submitContent}
                onChange={(e) => setSubmitContent(e.target.value)}
                placeholder={t('writeAnswerPlaceholder')}
                rows={5}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 resize-none"
                dir={direction}
                disabled={submitting}
              />
            )}

            {/* File upload submission */}
            {submitMode === 'upload' && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  isDragOver ? 'border-sky-600 bg-sky-50/50 dark:bg-sky-900/15' : 'border-muted-foreground/20 hover:border-sky-300'
                }`}
              >
                {submitFile ? (
                  <div className="flex items-center gap-3 justify-center">
                    <FileText className="h-8 w-8 text-sky-700 dark:text-sky-400" />
                    <div className="text-end">
                      <p className="text-sm font-medium text-foreground">{submitFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(submitFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      onClick={() => { setSubmitFile(null); setSubmitFileBuffer(null); }}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">{t('dragFileOr')}</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 text-sm font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800"
                    >
                      {t('chooseFile')}
                    </button>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSubmitFile(file);
                      // Pre-read file into ArrayBuffer immediately on mobile
                      // Mobile PWA File objects can become invalid after the input is cleared
                      file.arrayBuffer().then(buf => setSubmitFileBuffer(buf)).catch(() => {});
                    }
                  }}
                  className="hidden"
                />
              </div>
            )}

            {/* Existing file selection */}
            {submitMode === 'existing' && (
              <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                {myFiles.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <FolderOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    {t('noFilesUploadFirst')}
                  </div>
                ) : (
                  myFiles.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => setSelectedExistingFile(selectedExistingFile?.id === file.id ? null : file)}
                      className={`w-full flex items-center gap-3 rounded-lg border p-3 text-end transition-all ${
                        selectedExistingFile?.id === file.id
                          ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/15'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <FileText className={`h-5 w-5 shrink-0 ${
                        selectedExistingFile?.id === file.id ? 'text-sky-700 dark:text-sky-400' : 'text-muted-foreground'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                        <p className="text-xs text-muted-foreground">{(file.file_size / 1024).toFixed(1)} KB</p>
                      </div>
                      {selectedExistingFile?.id === file.id && (
                        <CheckCircle2 className="h-4 w-4 text-sky-700 dark:text-sky-400 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || (submitMode === 'text' && !submitContent.trim()) || (submitMode === 'upload' && !submitFile) || (submitMode === 'existing' && !selectedExistingFile)}
              className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t('submitBtn')}
            </button>
          </motion.div>
        )}
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Create/Edit Modal
  // -------------------------------------------------------
  const renderModal = (mode: 'create' | 'edit') => {
    const isOpen = mode === 'create' ? createOpen : editOpen;
    const setIsOpen = mode === 'create' ? setCreateOpen : setEditOpen;
    const title = mode === 'create' ? newTitle : editTitle;
    const setTitle = mode === 'create' ? setNewTitle : setEditTitle;
    const desc = mode === 'create' ? newDesc : editDesc;
    const setDesc = mode === 'create' ? setNewDesc : setEditDesc;
    const dueDatetime = mode === 'create' ? newDueDatetime : editDueDatetime;
    const setDueDatetime = mode === 'create' ? setNewDueDatetime : setEditDueDatetime;
    const maxScore = mode === 'create' ? newMaxScore : editMaxScore;
    const setMaxScore = mode === 'create' ? setNewMaxScore : setEditMaxScore;
    const allowFile = mode === 'create' ? newAllowFile : editAllowFile;
    const setAllowFile = mode === 'create' ? setNewAllowFile : setEditAllowFile;
    const showGrade = mode === 'create' ? newShowGrade : editShowGrade;
    const setShowGrade = mode === 'create' ? setNewShowGrade : setEditShowGrade;
    const isProcessing = mode === 'create' ? creating : saving;
    const onSubmit = mode === 'create' ? handleCreate : handleEdit;

    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => { if (!isProcessing) setIsOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0, pointerEvents: 'none' as const }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl"
              dir={direction}
            >
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                  {mode === 'create' ? t('createNewAssignment') : t('editAssignment')}
                </h3>
                <button onClick={() => { if (!isProcessing) setIsOpen(false); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('assignmentTitle')}</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('titlePlaceholder')}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/30"
                    dir={direction}
                    disabled={isProcessing}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('descriptionOptional')}</label>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder={t('descriptionPlaceholder')}
                    rows={3}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/30 resize-none"
                    dir={direction}
                    disabled={isProcessing}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400" />
                    {t('deadlineDatetimeLabel')}
                  </label>
                  <input
                    type="datetime-local"
                    value={dueDatetime}
                    onChange={(e) => setDueDatetime(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/30"
                    dir="ltr"
                    disabled={isProcessing}
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">{t('maxScore')}</label>
                    <input
                      type="number"
                      min={1}
                      value={maxScore}
                      onChange={(e) => setMaxScore(Number(e.target.value))}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600/30"
                      dir="ltr"
                      disabled={isProcessing}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowFile}
                        onChange={(e) => setAllowFile(e.target.checked)}
                        className="h-4 w-4 rounded border-sky-300 dark:border-sky-900/60 text-sky-700 dark:text-sky-400 focus:ring-sky-600"
                        disabled={isProcessing}
                      />
                      <span className="text-sm font-medium text-foreground">{t('allowFileUpload')}</span>
                    </label>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showGrade}
                        onChange={(e) => setShowGrade(e.target.checked)}
                        className="h-4 w-4 rounded border-sky-300 dark:border-sky-900/60 text-sky-700 dark:text-sky-400 focus:ring-sky-600"
                        disabled={isProcessing}
                      />
                      <span className="text-sm font-medium text-foreground">{t('showGradeToStudent')}</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t p-5">
                <button
                  onClick={onSubmit}
                  disabled={isProcessing}
                  className="flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-800 disabled:opacity-60"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'create' ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {mode === 'create' ? t('createAssignmentBtn') : t('saveChangesBtn')}
                </button>
                <button
                  onClick={() => { if (!isProcessing) setIsOpen(false); }}
                  disabled={isProcessing}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
                >
                  {tc('cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  };

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {selectedAssignment ? (
        role === 'teacher' ? renderTeacherDetail() : renderStudentDetail()
      ) : (
        renderList()
      )}

      {renderModal('create')}
      {renderModal('edit')}
    </motion.div>
  );
}
