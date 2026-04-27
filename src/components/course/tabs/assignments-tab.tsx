'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import type { UserProfile, Subject, Assignment, Submission, UserFile } from '@/lib/types';
import UserAvatar from '@/components/shared/user-avatar';

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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
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

function getCountdown(dueDate: string): { text: string; urgent: boolean; expired: boolean } {
  const now = new Date();
  // For date-only strings, treat the deadline as end of that day
  let due: Date;
  if (isDateOnly(dueDate)) {
    due = new Date(dueDate + 'T23:59:59');
  } else {
    due = new Date(dueDate);
  }
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return { text: 'انتهى', urgent: false, expired: true };
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const urgent = diffMs < 24 * 60 * 60 * 1000; // less than 24 hours
  if (days > 0) return { text: `${days} يوم ${hours} ساعة`, urgent, expired: false };
  if (hours > 0) return { text: `${hours} ساعة ${minutes} دقيقة`, urgent, expired: false };
  return { text: `${minutes} دقيقة`, urgent, expired: false };
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
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AssignmentsTab({ profile, role, subjectId }: AssignmentsTabProps) {
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
  const [submitting, setSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<'text' | 'upload' | 'existing'>('text');
  const [selectedExistingFile, setSelectedExistingFile] = useState<UserFile | null>(null);
  const [myFiles, setMyFiles] = useState<UserFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const enriched: SubmissionWithStudent[] = [];
        for (const sub of subs) {
          const { data: student } = await supabase
            .from('users')
            .select('name, email')
            .eq('id', sub.student_id)
            .single();
          enriched.push({
            ...sub,
            student_name: (student as { name?: string })?.name || 'طالب',
            student_email: (student as { email?: string })?.email || '',
          });
        }
        setSubmissions(enriched);
      }
    } catch {
      setSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  useEffect(() => {
    fetchAssignments();
    fetchMySubmissions();
    fetchMyFiles();
  }, [fetchAssignments, fetchMySubmissions, fetchMyFiles]);

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

    if (!currentTitle) { toast.error('يرجى إدخال عنوان المهمة'); return; }
    if (!currentDueDatetime) { toast.error('يرجى تحديد الموعد النهائي'); return; }
    setCreating(true);
    try {
      const dueDateValue = toUTCISOString(currentDueDatetime);

      const { error } = await supabase.from('assignments').insert({
        subject_id: subjectId,
        teacher_id: profile.id,
        title: currentTitle,
        description: currentDesc || null,
        due_date: dueDateValue,
        max_score: currentMaxScore,
        allow_file_submission: currentAllowFile,
        show_grade: currentShowGrade,
      });
      if (error) toast.error('حدث خطأ أثناء إنشاء المهمة');
      else {
        toast.success('تم إنشاء المهمة بنجاح');
        // Send notification to all students in the subject
        try {
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        fetchAssignments();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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

    if (!currentEditTitle) { toast.error('يرجى إدخال عنوان المهمة'); return; }
    if (!currentEditDueDatetime) { toast.error('يرجى تحديد الموعد النهائي'); return; }
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
      if (error) toast.error('حدث خطأ أثناء تعديل المهمة');
      else {
        toast.success('تم تعديل المهمة بنجاح');
        setEditOpen(false);
        setEditId(null);
        fetchAssignments();
        // Update selected assignment if it's the one being edited
        if (selectedAssignment?.id === editId) {
          setSelectedAssignment({
            ...selectedAssignment,
            title: currentEditTitle,
            description: currentEditDesc || undefined,
            due_date: dueDateValue || undefined,
            max_score: currentEditMaxScore,
            allow_file_submission: currentEditAllowFile,
            show_grade: currentEditShowGrade,
          } as Assignment);
        }
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      if (error) toast.error('حدث خطأ أثناء حذف المهمة');
      else {
        toast.success('تم حذف المهمة');
        if (selectedAssignment?.id === id) {
          setSelectedAssignment(null);
          setSubmissions([]);
        }
        fetchAssignments();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      toast.error('انتهى الموعد النهائي لهذه المهمة');
      return;
    }

    if (mySubmissions[selectedAssignment.id]) {
      toast.error('لقد سلمت هذه المهمة مسبقاً');
      return;
    }

    // Read current state values at call time
    const currentSubmitMode = submitMode;
    const currentSubmitContent = submitContent.trim();
    const currentSubmitFile = submitFile;
    const currentSelectedExistingFile = selectedExistingFile;

    if (currentSubmitMode === 'text' && !currentSubmitContent) {
      toast.error('يرجى إدخال محتوى');
      return;
    }

    if (currentSubmitMode === 'upload' && !currentSubmitFile) {
      toast.error('يرجى اختيار ملف للرفع');
      return;
    }

    if (currentSubmitMode === 'existing' && !currentSelectedExistingFile) {
      toast.error('يرجى اختيار ملف من ملفاتك');
      return;
    }

    setSubmitting(true);
    try {
      let fileId: string | null = null;
      let contentValue = currentSubmitContent || null;

      if (currentSubmitMode === 'upload' && currentSubmitFile && selectedAssignment.allow_file_submission) {
        // Upload file via API
        const { data: { session: uploadSession } } = await supabase.auth.getSession();
        const uploadToken = uploadSession?.access_token || '';

        const formData = new FormData();
        formData.append('file', currentSubmitFile);
        formData.append('userId', profile.id);
        formData.append('assignmentId', selectedAssignment.id);

        const uploadRes = await fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${uploadToken}` },
          body: formData,
        });

        const uploadResult = await uploadRes.json();
        if (!uploadResult.success) {
          toast.error(uploadResult.error || 'حدث خطأ أثناء رفع الملف');
          setSubmitting(false);
          return;
        }
        fileId = uploadResult.data?.id || null;
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
      if (error) toast.error('حدث خطأ أثناء التسليم');
      else {
        toast.success('تم تسليم المهمة بنجاح');
        // Send notification to teacher
        try {
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        setSelectedExistingFile(null);
        setSubmitMode('text');
        fetchMySubmissions();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Save grade (teacher)
  // -------------------------------------------------------
  const handleSaveGrade = async (submissionId: string) => {
    const scoreVal = Number(gradeScore);
    if (isNaN(scoreVal) || scoreVal < 0) { toast.error('يرجى إدخال درجة صحيحة'); return; }
    if (selectedAssignment && scoreVal > selectedAssignment.max_score) {
      toast.error(`الدرجة يجب ألا تتجاوز ${selectedAssignment.max_score}`);
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
      if (error) toast.error('حدث خطأ أثناء حفظ الدرجة');
      else {
        toast.success('تم حفظ الدرجة');
        // Send notification to the student
        const gradedSubmission = submissions.find((s) => s.id === submissionId);
        if (gradedSubmission && selectedAssignment) {
          try {
            await fetch('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
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
      toast.error('حدث خطأ غير متوقع');
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
      setSubmitFile(e.dataTransfer.files[0]);
      setSubmitMode('upload');
    }
  };

  // -------------------------------------------------------
  // Status badge
  // -------------------------------------------------------
  const getStatusBadge = (status: 'submitted' | 'graded' | 'returned') => {
    switch (status) {
      case 'submitted':
        return <Badge className="bg-amber-100 text-amber-700 text-[10px]"><Clock className="h-2.5 w-2.5 ml-1" />تم التسليم</Badge>;
      case 'graded':
        return <Badge className="bg-emerald-100 text-emerald-700 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5 ml-1" />تم التقييم</Badge>;
      case 'returned':
        return <Badge className="bg-blue-100 text-blue-700 text-[10px]"><MessageSquare className="h-2.5 w-2.5 ml-1" />تم الإرجاع</Badge>;
    }
  };

  // -------------------------------------------------------
  // Render: List view
  // -------------------------------------------------------
  const renderList = () => (
    <>
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground">المهام</h3>
          <p className="text-muted-foreground text-sm mt-1">{assignments.length} مهمة</p>
        </div>
        {role === 'teacher' && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            مهمة جديدة
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
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            نشطة
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              activeTab === 'active'
                ? 'bg-emerald-500 text-white'
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
            منتهية
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
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : assignments.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 py-20"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100 mb-5">
            <ClipboardCheck className="h-10 w-10 text-emerald-600" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1">لا توجد مهام بعد</p>
          <p className="text-sm text-muted-foreground">
            {role === 'teacher' ? 'ابدأ بإنشاء مهمة جديدة' : 'لم يتم إضافة مهام بعد'}
          </p>
        </motion.div>
      ) : filteredAssignments.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 mb-4">
            <Filter className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            {activeTab === 'active' ? 'لا توجد مهام نشطة' : 'لا توجد مهام منتهية'}
          </p>
          <p className="text-xs text-muted-foreground">
            {activeTab === 'active' ? 'جميع المهام انتهت مواعيدها النهائية' : 'لم تنتهِ أي مهمة بعد'}
          </p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <div className={`absolute top-0 right-0 left-0 h-1.5 rounded-t-2xl ${
                    pastDue ? 'bg-rose-500' : countdown?.urgent ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />

                  {/* Teacher actions */}
                  {role === 'teacher' && (
                    <div className="absolute top-3 left-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditModal(assignment); }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600"
                        title="تعديل"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(assignment.id); }}
                        disabled={deletingId === assignment.id}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                        title="حذف"
                      >
                        {deletingId === assignment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-3 mt-1">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      pastDue ? 'bg-rose-100' : countdown?.urgent ? 'bg-amber-100' : 'bg-emerald-100'
                    }`}>
                      <ClipboardCheck className={`h-5 w-5 ${
                        pastDue ? 'text-rose-600' : countdown?.urgent ? 'text-amber-600' : 'text-emerald-600'
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
                        pastDue ? 'text-rose-600' : countdown?.urgent ? 'text-amber-600' : 'text-muted-foreground'
                      }`}>
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(assignment.due_date)}
                        {!pastDue && countdown && (
                          <span className={`font-medium ${countdown.urgent ? 'text-amber-600' : 'text-emerald-600'}`}>
                            ({countdown.text})
                          </span>
                        )}
                        {pastDue && (
                          <span className="font-medium text-rose-600">(انتهى)</span>
                        )}
                      </div>
                    )}
                    {role === 'student' && (
                      mySub ? getStatusBadge(mySub.status) : (
                        pastDue ? (
                          <Badge className="bg-rose-100 text-rose-700 text-[10px]">
                            <AlertCircle className="h-2.5 w-2.5 ml-1" />انتهى الموعد
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700 text-[10px]">
                            <AlertCircle className="h-2.5 w-2.5 ml-1" />لم يسلم
                          </Badge>
                        )
                      )
                    )}
                    {role === 'teacher' && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Award className="h-3 w-3" />
                        {assignment.max_score} درجة
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
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setDeleteConfirmId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border bg-background shadow-xl p-6 text-center"
              dir="rtl"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 mx-auto mb-4">
                <Trash2 className="h-6 w-6 text-rose-600" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">حذف المهمة</h3>
              <p className="text-sm text-muted-foreground mb-6">هل أنت متأكد من حذف هذه المهمة؟ لا يمكن التراجع عن هذا الإجراء.</p>
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={() => handleDelete(deleteConfirmId)}
                  disabled={deletingId === deleteConfirmId}
                  className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {deletingId === deleteConfirmId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  حذف
                </button>
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                >
                  إلغاء
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
                أنشئ: {formatDateTime(selectedAssignment!.created_at)}
              </span>
            )}
            {selectedAssignment!.due_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                الموعد النهائي: {formatDateTime(selectedAssignment!.due_date)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Award className="h-3.5 w-3.5" />
              {selectedAssignment!.max_score} درجة
            </span>
          </div>
        </div>
        <button
          onClick={() => openEditModal(selectedAssignment!)}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          تعديل
        </button>
      </motion.div>

      {selectedAssignment!.description && (
        <motion.div variants={itemVariants} className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedAssignment!.description}</p>
        </motion.div>
      )}

      <motion.div variants={itemVariants}>
        <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
          التسليمات ({submissions.length})
        </h4>
        {loadingSubmissions ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">لا توجد تسليمات بعد</div>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => (
              <div key={sub.id} className="rounded-xl border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserAvatar name={sub.student_name || 'مستخدم'} avatarUrl={sub.student_avatar} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{sub.student_name}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(sub.submitted_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(sub.status)}
                    {sub.score !== undefined && sub.score !== null && (
                      <span className="text-sm font-bold text-emerald-700">{sub.score}/{selectedAssignment!.max_score}</span>
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
                    className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 rounded-lg px-2.5 py-1.5 w-fit hover:bg-emerald-100 transition-colors"
                  >
                    <FileText className="h-3 w-3" />
                    معاينة الملف
                  </button>
                )}
                {sub.status !== 'graded' && gradingId !== sub.id && (
                  <button
                    onClick={() => { setGradingId(sub.id); setGradeScore(''); setGradeFeedback(''); }}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700"
                  >
                    <Award className="h-3 w-3" />
                    تقييم
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
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        dir="ltr"
                      />
                      <textarea
                        value={gradeFeedback}
                        onChange={(e) => setGradeFeedback(e.target.value)}
                        placeholder="ملاحظات..."
                        rows={2}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                        dir="rtl"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveGrade(sub.id)}
                        disabled={savingGrade}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {savingGrade ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        حفظ
                      </button>
                      <button
                        onClick={() => { setGradingId(null); setGradeScore(''); setGradeFeedback(''); }}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        إلغاء
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
                  أنشئ: {formatDateTime(selectedAssignment!.created_at)}
                </span>
              )}
              {selectedAssignment!.due_date && (
                <span className={`flex items-center gap-1 ${pastDue ? 'text-rose-600' : countdown?.urgent ? 'text-amber-600' : ''}`}>
                  <Calendar className="h-3.5 w-3.5" />
                  الموعد النهائي: {formatDateTime(selectedAssignment!.due_date)}
                  {pastDue && <span className="font-medium">(انتهى)</span>}
                  {!pastDue && countdown && (
                    <span className={`font-medium ${countdown.urgent ? 'text-amber-600' : 'text-emerald-600'}`}>
                      ({countdown.text} متبقي)
                    </span>
                  )}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Award className="h-3.5 w-3.5" />
                {selectedAssignment!.max_score} درجة
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
          <motion.div variants={itemVariants} className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            <p className="text-sm text-rose-700 font-medium">انتهى الموعد النهائي لهذه المهمة. لا يمكنك التسليم الآن.</p>
          </motion.div>
        )}

        {/* My submission status */}
        {mySub && (
          <motion.div variants={itemVariants} className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-foreground">تسليمي</h4>
              {getStatusBadge(mySub.status)}
            </div>
            {mySub.content && <p className="text-sm text-muted-foreground">{mySub.content}</p>}
            {mySub.file_id && (
              <button
                onClick={async () => {
                  const { data } = await supabase.from('user_files').select('file_url, file_name').eq('id', mySub.file_id!).single();
                  if (data) window.open((data as { file_url: string }).file_url, '_blank');
                }}
                className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 rounded-lg px-2.5 py-1.5 w-fit hover:bg-emerald-100 transition-colors"
              >
                <FileText className="h-3 w-3" />
                معاينة الملف
              </button>
            )}
            {mySub.score !== undefined && mySub.score !== null && selectedAssignment!.show_grade !== false && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50">
                <Award className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-bold text-emerald-700">{mySub.score} / {selectedAssignment!.max_score}</span>
                <span className="text-xs text-emerald-600">
                  ({Math.round((mySub.score / selectedAssignment!.max_score) * 100)}%)
                </span>
              </div>
            )}
            {mySub.feedback && selectedAssignment!.show_grade !== false && (
              <div className="p-2.5 rounded-lg bg-muted/30">
                <p className="text-xs font-medium text-foreground mb-1">ملاحظات المعلم:</p>
                <p className="text-sm text-muted-foreground">{mySub.feedback}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Submit form - only if not submitted and not past due */}
        {!mySub && !pastDue && (
          <motion.div variants={itemVariants} className="rounded-xl border bg-card p-4 space-y-4">
            <h4 className="text-sm font-bold text-foreground">تسليم المهمة</h4>

            {/* Submission mode tabs */}
            <div className="flex gap-2">
              <button
                onClick={() => setSubmitMode('text')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  submitMode === 'text'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                نص
              </button>
              {selectedAssignment!.allow_file_submission && (
                <>
                  <button
                    onClick={() => setSubmitMode('upload')}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      submitMode === 'upload'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <FileUp className="h-3 w-3" />
                    رفع ملف
                  </button>
                  <button
                    onClick={() => { setSubmitMode('existing'); fetchMyFiles(); }}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      submitMode === 'existing'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <FolderOpen className="h-3 w-3" />
                    من ملفاتي
                  </button>
                </>
              )}
            </div>

            {/* Text submission */}
            {submitMode === 'text' && (
              <textarea
                value={submitContent}
                onChange={(e) => setSubmitContent(e.target.value)}
                placeholder="اكتب إجابتك هنا..."
                rows={5}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                dir="rtl"
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
                  isDragOver ? 'border-emerald-500 bg-emerald-50/50' : 'border-muted-foreground/20 hover:border-emerald-300'
                }`}
              >
                {submitFile ? (
                  <div className="flex items-center gap-3 justify-center">
                    <FileText className="h-8 w-8 text-emerald-600" />
                    <div className="text-right">
                      <p className="text-sm font-medium text-foreground">{submitFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(submitFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      onClick={() => setSubmitFile(null)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">اسحب الملف هنا أو</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
                    >
                      اختر ملف
                    </button>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => { if (e.target.files?.[0]) setSubmitFile(e.target.files[0]); }}
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
                    لا توجد ملفات. قم برفع ملف أولاً من قسم ملفاتي.
                  </div>
                ) : (
                  myFiles.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => setSelectedExistingFile(selectedExistingFile?.id === file.id ? null : file)}
                      className={`w-full flex items-center gap-3 rounded-lg border p-3 text-right transition-all ${
                        selectedExistingFile?.id === file.id
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <FileText className={`h-5 w-5 shrink-0 ${
                        selectedExistingFile?.id === file.id ? 'text-emerald-600' : 'text-muted-foreground'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                        <p className="text-xs text-muted-foreground">{(file.file_size / 1024).toFixed(1)} KB</p>
                      </div>
                      {selectedExistingFile?.id === file.id && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || (submitMode === 'text' && !submitContent.trim()) || (submitMode === 'upload' && !submitFile) || (submitMode === 'existing' && !selectedExistingFile)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              تسليم
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
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => { if (!isProcessing) setIsOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-emerald-600" />
                  {mode === 'create' ? 'إنشاء مهمة جديدة' : 'تعديل المهمة'}
                </h3>
                <button onClick={() => { if (!isProcessing) setIsOpen(false); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">عنوان المهمة</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="مثال: واجب الفصل الثاني"
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    dir="rtl"
                    disabled={isProcessing}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف (اختياري)</label>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="وصف المهمة..."
                    rows={3}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                    dir="rtl"
                    disabled={isProcessing}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                    الموعد النهائي (التاريخ والوقت)
                  </label>
                  <input
                    type="datetime-local"
                    value={dueDatetime}
                    onChange={(e) => setDueDatetime(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    dir="ltr"
                    disabled={isProcessing}
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">الدرجة القصوى</label>
                    <input
                      type="number"
                      min={1}
                      value={maxScore}
                      onChange={(e) => setMaxScore(Number(e.target.value))}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
                        className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                        disabled={isProcessing}
                      />
                      <span className="text-sm font-medium text-foreground">السماح برفع ملفات</span>
                    </label>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showGrade}
                        onChange={(e) => setShowGrade(e.target.checked)}
                        className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                        disabled={isProcessing}
                      />
                      <span className="text-sm font-medium text-foreground">إظهار التقييم للطالب</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t p-5">
                <button
                  onClick={onSubmit}
                  disabled={isProcessing}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'create' ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {mode === 'create' ? 'إنشاء المهمة' : 'حفظ التعديلات'}
                </button>
                <button
                  onClick={() => { if (!isProcessing) setIsOpen(false); }}
                  disabled={isProcessing}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
                >
                  إلغاء
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
