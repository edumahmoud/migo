'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList,
  Plus,
  X,
  Loader2,
  ChevronLeft,
  Trash2,
  Calendar,
  Users,
  CheckCircle2,
  Clock,
  Upload,
  FileText,
  MessageSquare,
  Award,
  AlertCircle,
  Pencil,
  FolderOpen,
  FileUp,
  CheckCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { UserProfile, Assignment, Submission, Subject, UserFile } from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AssignmentsSectionProps {
  profile: UserProfile;
  role: 'student' | 'teacher';
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

function isDateOnly(dateStr: string): boolean {
  // A date-only string from a DATE column looks like "2025-03-05" (no T or time part)
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
}

function formatDateTime(dateStr: string): string {
  try {
    if (isDateOnly(dateStr)) {
      // Date-only: display without time to avoid misleading 2:00 AM
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
    const d = new Date(isoStr);
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
function toUTCISOString(localDatetime: string): string {
  // The datetime-local input gives us a value like "2025-03-05T14:30"
  // which JavaScript interprets as local time. We need to explicitly
  // construct a UTC ISO string from it.
  const d = new Date(localDatetime);
  if (isNaN(d.getTime())) return localDatetime;
  return d.toISOString();
}

function getCountdown(dueDate: string): { text: string; urgent: boolean; expired: boolean } {
  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return { text: 'انتهى', urgent: false, expired: true };
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const urgent = diffMs < 24 * 60 * 60 * 1000;
  if (days > 0) return { text: `${days} يوم ${hours} ساعة`, urgent, expired: false };
  if (hours > 0) return { text: `${hours} ساعة ${minutes} دقيقة`, urgent, expired: false };
  return { text: `${minutes} دقيقة`, urgent, expired: false };
}

function isPastDue(dueDate: string): boolean {
  return new Date(dueDate) < new Date();
}

// Sort assignments by remaining time (soonest first), then no-deadline at end
function sortByRemainingTime(a: Assignment, b: Assignment): number {
  const aHasDue = !!a.due_date;
  const bHasDue = !!b.due_date;

  if (aHasDue && bHasDue) {
    return new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime();
  }
  if (aHasDue && !bHasDue) return -1;
  if (!aHasDue && bHasDue) return 1;
  return 0; // both no deadline, keep creation order
}

// -------------------------------------------------------
// Submission with student info (for teacher view)
// -------------------------------------------------------
interface SubmissionWithStudent extends Submission {
  student_name?: string;
  student_email?: string;
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AssignmentsSection({ profile, role }: AssignmentsSectionProps) {
  // ─── Data state ───
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionWithStudent[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // ─── Student: own submission per assignment ───
  const [mySubmissions, setMySubmissions] = useState<Record<string, Submission>>({});

  // ─── Create assignment modal ───
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDueDatetime, setNewDueDatetime] = useState('');
  const [newMaxScore, setNewMaxScore] = useState(100);
  const [newAllowFile, setNewAllowFile] = useState(true);
  const [creating, setCreating] = useState(false);

  // ─── Edit state ───
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDueDatetime, setEditDueDatetime] = useState('');
  const [editMaxScore, setEditMaxScore] = useState(100);
  const [editAllowFile, setEditAllowFile] = useState(true);
  const [saving, setSaving] = useState(false);

  // ─── Delete state ───
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ─── Grading state ───
  const [gradingSubmissionId, setGradingSubmissionId] = useState<string | null>(null);
  const [gradeScore, setGradeScore] = useState('');
  const [gradeFeedback, setGradeFeedback] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  // ─── Student: submit state ───
  const [submitContent, setSubmitContent] = useState('');
  const [submitFile, setSubmitFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<'text' | 'upload' | 'existing'>('text');
  const [selectedExistingFile, setSelectedExistingFile] = useState<UserFile | null>(null);
  const [myFiles, setMyFiles] = useState<UserFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Submission counts per assignment (teacher) ───
  const [submissionCounts, setSubmissionCounts] = useState<Record<string, number>>({});

  // ─── Active/Expired tab ───
  const [activeTab, setActiveTab] = useState<'active' | 'expired'>('active');

  // ─── Submission filter (student) ───
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'submitted' | 'not_submitted'>('all');



  // -------------------------------------------------------
  // Fetch assignments
  // -------------------------------------------------------
  const fetchAssignments = useCallback(async () => {
    setLoadingAssignments(true);
    try {
      if (role === 'teacher') {
        const { data, error } = await supabase
          .from('assignments')
          .select('*')
          .eq('teacher_id', profile.id)
          .order('created_at', { ascending: false });
        if (error) console.error('Error fetching assignments:', error);
        else setAssignments((data as Assignment[]) || []);
      } else {
        // Student: get enrolled subjects then fetch assignments
        const { data: enrollments } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id);

        if (enrollments && enrollments.length > 0) {
          const subjectIds = enrollments.map((e) => e.subject_id);
          const { data, error } = await supabase
            .from('assignments')
            .select('*')
            .in('subject_id', subjectIds);
          if (error) console.error('Error:', error);
          else {
            const sorted = ((data as Assignment[]) || []).sort(sortByRemainingTime);
            setAssignments(sorted);
          }
        } else {
          setAssignments([]);
        }
      }
    } catch (err) {
      console.error('Fetch assignments error:', err);
    } finally {
      setLoadingAssignments(false);
    }
  }, [profile.id, role]);

  // -------------------------------------------------------
  // Fetch teacher's subjects for the subject selector
  // -------------------------------------------------------
  const fetchSubjects = useCallback(async () => {
    if (role !== 'teacher') return;
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('teacher_id', profile.id);
    if (error) console.error('Error:', error);
    else setSubjects((data as Subject[]) || []);
  }, [profile.id, role]);

  // -------------------------------------------------------
  // Fetch submissions for an assignment (teacher)
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
            .select('name, email, title_id, gender, role')
            .eq('id', sub.student_id)
            .single();
          const studentData = student as { name?: string; email?: string; title_id?: string | null; gender?: string | null; role?: string | null } | null;
          enriched.push({
            ...sub,
            student_name: formatNameWithTitle(
              studentData?.name || 'طالب',
              studentData?.role,
              studentData?.title_id,
              studentData?.gender
            ),
            student_email: studentData?.email || '',
          });
        }
        setSubmissions(enriched);
      }
    } catch (err) {
      console.error('Fetch submissions error:', err);
      setSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

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
  // Fetch submission counts (teacher)
  // -------------------------------------------------------
  const fetchSubmissionCounts = useCallback(async () => {
    if (role !== 'teacher' || assignments.length === 0) return;
    const counts: Record<string, number> = {};
    for (const a of assignments) {
      const { count, error } = await supabase
        .from('submissions')
        .select('*', { count: 'exact', head: true })
        .eq('assignment_id', a.id);
      if (!error && count !== null) counts[a.id] = count;
    }
    setSubmissionCounts(counts);
  }, [assignments, role]);

  // -------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------
  useEffect(() => {
    fetchAssignments();
    fetchSubjects();
  }, [fetchAssignments, fetchSubjects]);

  useEffect(() => {
    if (role === 'student') { fetchMySubmissions(); fetchMyFiles(); }
  }, [fetchMySubmissions, fetchMyFiles, role]);

  useEffect(() => {
    fetchSubmissionCounts();
  }, [fetchSubmissionCounts]);

  useEffect(() => {
    if (selectedAssignment) fetchSubmissions(selectedAssignment.id);
  }, [selectedAssignment, fetchSubmissions]);



  // -------------------------------------------------------
  // Derived: active vs expired assignments
  // -------------------------------------------------------
  const activeAssignments = assignments.filter(
    (a) => !a.due_date || !isPastDue(a.due_date)
  );
  const expiredAssignments = assignments.filter(
    (a) => a.due_date && isPastDue(a.due_date)
  );
  const filteredAssignments = activeTab === 'active' ? activeAssignments : expiredAssignments;

  // Further filter by submission status (student only)
  const displayAssignments = filteredAssignments.filter((a) => {
    if (role !== 'student' || submissionFilter === 'all') return true;
    const mySub = mySubmissions[a.id];
    if (submissionFilter === 'submitted') return !!mySub;
    if (submissionFilter === 'not_submitted') return !mySub;
    return true;
  });

  // -------------------------------------------------------
  // Real-time subscription for assignments
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel('assignments-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'assignments',
        },
        () => {
          fetchAssignments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAssignments]);

  // -------------------------------------------------------
  // Real-time subscription for submissions
  // -------------------------------------------------------
  useEffect(() => {
    if (!selectedAssignment) return;

    const channel = supabase
      .channel(`submissions-${selectedAssignment.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'submissions',
          filter: `assignment_id=eq.${selectedAssignment.id}`,
        },
        () => {
          fetchSubmissions(selectedAssignment.id);
          if (role === 'student') fetchMySubmissions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedAssignment, fetchSubmissions, fetchMySubmissions, role]);

  // -------------------------------------------------------
  // Create assignment
  // -------------------------------------------------------
  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) {
      toast.error('يرجى إدخال عنوان المهمة');
      return;
    }
    if (!newSubjectId) {
      toast.error('يرجى اختيار المقرر');
      return;
    }
    if (!newDueDatetime) {
      toast.error('يرجى تحديد الموعد النهائي');
      return;
    }
    setCreating(true);
    try {
      const dueDateValue = newDueDatetime
        ? toUTCISOString(newDueDatetime)
        : null;

      const { error } = await supabase.from('assignments').insert({
        subject_id: newSubjectId,
        teacher_id: profile.id,
        title,
        description: newDescription.trim() || null,
        due_date: dueDateValue,
        max_score: newMaxScore,
        allow_file_submission: newAllowFile,
      });
      if (error) {
        toast.error('حدث خطأ أثناء إنشاء المهمة');
      } else {
        toast.success('تم إنشاء المهمة بنجاح');
        // Send notification to all students in the subject
        try {
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'assignment_created',
              subjectId: newSubjectId,
              assignmentTitle: title,
              teacherName: profile.name,
            }),
          });
        } catch { /* notification failure is non-critical */ }
        setCreateOpen(false);
        setNewTitle('');
        setNewSubjectId('');
        setNewDescription('');
        setNewDueDatetime('');
        setNewMaxScore(100);
        setNewAllowFile(true);
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
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editId) return;
    const title = editTitle.trim();
    if (!title) { toast.error('يرجى إدخال عنوان المهمة'); return; }
    if (!editDueDatetime) { toast.error('يرجى تحديد الموعد النهائي'); return; }
    setSaving(true);
    try {
      const dueDateValue = editDueDatetime
        ? toUTCISOString(editDueDatetime)
        : null;

      const { error } = await supabase
        .from('assignments')
        .update({
          title,
          description: editDesc.trim() || null,
          due_date: dueDateValue,
          max_score: editMaxScore,
          allow_file_submission: editAllowFile,
        })
        .eq('id', editId);
      if (error) toast.error('حدث خطأ أثناء تعديل المهمة');
      else {
        toast.success('تم تعديل المهمة بنجاح');
        setEditOpen(false);
        setEditId(null);
        fetchAssignments();
        if (selectedAssignment?.id === editId) {
          setSelectedAssignment({
            ...selectedAssignment,
            title,
            description: editDesc.trim() || undefined,
            due_date: dueDateValue || undefined,
            max_score: editMaxScore,
            allow_file_submission: editAllowFile,
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
  const handleDelete = async (assignmentId: string) => {
    setDeletingId(assignmentId);
    try {
      const { error } = await supabase.from('assignments').delete().eq('id', assignmentId);
      if (error) toast.error('حدث خطأ أثناء حذف المهمة');
      else {
        toast.success('تم حذف المهمة بنجاح');
        if (selectedAssignment?.id === assignmentId) {
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
  // Save grade (teacher)
  // -------------------------------------------------------
  const handleSaveGrade = async (submissionId: string) => {
    const scoreVal = Number(gradeScore);
    if (isNaN(scoreVal) || scoreVal < 0) {
      toast.error('يرجى إدخال درجة صحيحة');
      return;
    }
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
        toast.success('تم حفظ الدرجة بنجاح');
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
              }),
            });
          } catch { /* notification failure is non-critical */ }
        }
        setGradingSubmissionId(null);
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
      toast.error('لقد قمت بتسليم هذه المهمة مسبقاً');
      return;
    }

    if (submitMode === 'text' && !submitContent.trim() && !submitFile) {
      toast.error('يرجى إدخال محتوى أو رفع ملف');
      return;
    }

    if (submitMode === 'upload' && !submitFile) {
      toast.error('يرجى اختيار ملف للرفع');
      return;
    }

    if (submitMode === 'existing' && !selectedExistingFile) {
      toast.error('يرجى اختيار ملف من ملفاتك');
      return;
    }

    setSubmitting(true);
    try {
      let fileId: string | null = null;
      let contentValue = submitContent.trim() || null;

      if (submitMode === 'upload' && submitFile && selectedAssignment.allow_file_submission) {
        const { data: { session: uploadSession } } = await supabase.auth.getSession();
        const uploadToken = uploadSession?.access_token || '';

        const formData = new FormData();
        formData.append('file', submitFile);
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
      } else if (submitMode === 'existing' && selectedExistingFile) {
        fileId = selectedExistingFile.id;
        // Update the user_file to link with this assignment
        await supabase
          .from('user_files')
          .update({ assignment_id: selectedAssignment.id })
          .eq('id', selectedExistingFile.id);
      }

      const { error } = await supabase.from('submissions').insert({
        assignment_id: selectedAssignment.id,
        student_id: profile.id,
        content: contentValue,
        file_id: fileId,
        status: 'submitted',
      });
      if (error) {
        toast.error('حدث خطأ أثناء تسليم المهمة');
      } else {
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
  // Get subject name by id
  // -------------------------------------------------------
  const getSubjectName = (subjectId: string): string => {
    const s = subjects.find((sub) => sub.id === subjectId);
    return s?.name || '';
  };

  // All subjects for lookup (student needs to fetch all subjects too)
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  useEffect(() => {
    if (role === 'student' && assignments.length > 0) {
      const subjectIds = [...new Set(assignments.map((a) => a.subject_id))];
      if (subjectIds.length > 0) {
        supabase
          .from('subjects')
          .select('*')
          .in('id', subjectIds)
          .then(({ data }) => {
            if (data) setAllSubjects(data as Subject[]);
          });
      }
    }
  }, [assignments, role]);

  const getSubjectNameAll = (subjectId: string): string => {
    const s = subjects.find((sub) => sub.id === subjectId) || allSubjects.find((sub) => sub.id === subjectId);
    return s?.name || 'مقرر';
  };

  // -------------------------------------------------------
  // Status badge helper
  // -------------------------------------------------------
  const getStatusBadge = (status: 'submitted' | 'graded' | 'returned', size: 'sm' | 'md' = 'sm') => {
    const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';
    switch (status) {
      case 'submitted':
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 font-medium ${sizeClasses}`}>
            <Clock className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
            تم التسليم
          </span>
        );
      case 'graded':
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 font-medium ${sizeClasses}`}>
            <CheckCircle2 className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
            تم التقييم
          </span>
        );
      case 'returned':
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 font-medium ${sizeClasses}`}>
            <MessageSquare className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
            تم الإرجاع
          </span>
        );
    }
  };

  // -------------------------------------------------------
  // Student submission status badge for assignment card
  // -------------------------------------------------------
  const getStudentStatusBadge = (assignment: Assignment) => {
    const sub = mySubmissions[assignment.id];
    const pastDue = assignment.due_date ? isPastDue(assignment.due_date) : false;

    if (!sub) {
      if (pastDue) {
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-700 font-medium text-[10px] px-1.5 py-0.5">
            <AlertCircle className="h-2.5 w-2.5" />
            انتهى الموعد
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-700 font-medium text-[10px] px-1.5 py-0.5">
          <AlertCircle className="h-2.5 w-2.5" />
          لم يسلم
        </span>
      );
    }
    return getStatusBadge(sub.status);
  };

  // -------------------------------------------------------
  // Score color helper
  // -------------------------------------------------------
  const getScoreColor = (score: number, maxScore: number) => {
    const pct = (score / maxScore) * 100;
    if (pct >= 80) return 'text-emerald-600';
    if (pct >= 60) return 'text-amber-600';
    return 'text-rose-600';
  };

  // -------------------------------------------------------
  // Render: Assignments List
  // -------------------------------------------------------
  const renderAssignmentsList = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">المهام</h2>
          <p className="text-muted-foreground mt-1">
            {role === 'teacher' ? 'إدارة مهامك وتقييم التسليمات' : 'جميع مهامك مرتبة حسب الوقت المتبقي'}
          </p>
        </div>
        {role === 'teacher' && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            إنشاء مهمة
          </button>
        )}
      </motion.div>



      {/* Active / Expired Tabs */}
      <motion.div variants={itemVariants} className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
        <button
          onClick={() => setActiveTab('active')}
          className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all ${
            activeTab === 'active'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          <CheckCircle className="h-3.5 w-3.5" />
          نشطة
          <span className={`text-xs rounded-full px-1.5 py-0.5 ${
            activeTab === 'active' ? 'bg-white/20' : 'bg-muted'
          }`}>
            {activeAssignments.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('expired')}
          className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all ${
            activeTab === 'expired'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          منتهية
          <span className={`text-xs rounded-full px-1.5 py-0.5 ${
            activeTab === 'expired' ? 'bg-white/20' : 'bg-muted'
          }`}>
            {expiredAssignments.length}
          </span>
        </button>
      </motion.div>

      {/* Submission status filter (student only) */}
      {role === 'student' && assignments.length > 0 && (
        <motion.div variants={itemVariants} className="flex gap-1.5 flex-wrap">
          {([
            { key: 'all' as const, label: 'الكل' },
            { key: 'submitted' as const, label: 'تم تسليمها' },
            { key: 'not_submitted' as const, label: 'لم يتم التسليم' },
          ]).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSubmissionFilter(opt.key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                submissionFilter === opt.key
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </motion.div>
      )}

      {/* Assignments grid */}
      {loadingAssignments ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : displayAssignments.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <ClipboardList className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">
            {submissionFilter !== 'all'
              ? 'لا توجد مهام مطابقة للفلتر'
              : activeTab === 'active'
                ? (role === 'teacher' ? 'لا توجد مهام نشطة' : 'لا توجد مهام نشطة')
                : 'لا توجد مهام منتهية'}
          </p>
          <p className="text-sm text-muted-foreground">
            {submissionFilter !== 'all'
              ? 'جرّب تغيير الفلتر'
              : activeTab === 'active'
                ? (role === 'teacher' ? 'ابدأ بإنشاء مهمتك الأولى' : 'لم يتم إضافة مهام بعد')
                : 'لم تنتهِ صلاحية أي مهمة بعد'}
          </p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayAssignments.map((assignment) => {
            const countdown = assignment.due_date ? getCountdown(assignment.due_date) : null;
            const pastDue = assignment.due_date ? isPastDue(assignment.due_date) : false;

            return (
              <motion.div key={assignment.id} variants={itemVariants}>
                <div
                  className="group relative rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
                  onClick={() => {
                    setSelectedAssignment(assignment);
                    setGradingSubmissionId(null);
                    setGradeScore('');
                    setGradeFeedback('');
                    setSubmitContent('');
                    setSubmitFile(null);
                    setSelectedExistingFile(null);
                    setSubmitMode('text');
                  }}
                >
                  {/* Top accent bar */}
                  <div className={`absolute top-0 right-0 left-0 h-1.5 rounded-t-xl ${
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
                        {deletingId === assignment.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-3 mt-1">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      pastDue ? 'bg-rose-100' : countdown?.urgent ? 'bg-amber-100' : 'bg-emerald-100'
                    }`}>
                      <ClipboardList className={`h-5 w-5 ${
                        pastDue ? 'text-rose-600' : countdown?.urgent ? 'text-amber-600' : 'text-emerald-600'
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{assignment.title}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground truncate">
                          {getSubjectNameAll(assignment.subject_id)}
                        </p>
                        {assignment.created_at && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
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
                        {pastDue && <span className="font-medium text-rose-600">(انتهى)</span>}
                      </div>
                    )}
                    {role === 'teacher' ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        <span>{submissionCounts[assignment.id] || 0} تسليم</span>
                      </div>
                    ) : (
                      getStudentStatusBadge(assignment)
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
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Assignment Detail (Teacher)
  // -------------------------------------------------------
  const renderTeacherDetail = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Back button + header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedAssignment(null);
              setSubmissions([]);
              setGradingSubmissionId(null);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground truncate">{selectedAssignment!.title}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <ClipboardList className="h-3.5 w-3.5" />
                {getSubjectNameAll(selectedAssignment!.subject_id)}
              </span>
              {selectedAssignment!.due_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDateTime(selectedAssignment!.due_date)}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => openEditModal(selectedAssignment!)}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          تعديل المهمة
        </button>
      </motion.div>

      {/* Assignment info */}
      <motion.div variants={itemVariants} className="rounded-xl border bg-card p-5 space-y-3">
        {selectedAssignment!.description && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">الوصف</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedAssignment!.description}</p>
          </div>
        )}
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <div className="flex items-center gap-1.5">
            <Award className="h-4 w-4 text-emerald-600" />
            <span className="text-muted-foreground">الدرجة القصوى:</span>
            <span className="font-semibold text-foreground">{selectedAssignment!.max_score}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {selectedAssignment!.allow_file_submission ? (
              <>
                <FileText className="h-4 w-4 text-emerald-600" />
                <span className="text-emerald-600 font-medium">يسمح برفع ملفات</span>
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">تسليم نصي فقط</span>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Submissions list */}
      <motion.div variants={itemVariants}>
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-emerald-600" />
          التسليمات
          {submissions.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {submissions.length}
            </span>
          )}
        </h3>

        {loadingSubmissions ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 mb-3">
              <Users className="h-7 w-7 text-emerald-600" />
            </div>
            <p className="text-base font-semibold text-foreground mb-1">لا توجد تسليمات بعد</p>
            <p className="text-sm text-muted-foreground">سيظهر تسليمات الطلاب هنا</p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-x-auto">
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3 bg-muted/50 text-xs font-semibold text-muted-foreground min-w-[600px]">
              <div className="col-span-3">الطالب</div>
              <div className="col-span-2">تاريخ التسليم</div>
              <div className="col-span-2">الحالة</div>
              <div className="col-span-2">الدرجة</div>
              <div className="col-span-3">إجراءات</div>
            </div>

            <div className="divide-y">
              {submissions.map((sub) => (
                <div key={sub.id} className="px-4 py-3 space-y-2 sm:space-y-0 sm:grid sm:grid-cols-12 sm:gap-2 sm:items-center min-w-[600px]">
                  <div className="col-span-3 flex items-center gap-2">
                    <UserAvatar name={sub.student_name || 'مستخدم'} avatarUrl={sub.student_avatar} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{sub.student_name}</p>
                      <p className="text-xs text-muted-foreground truncate sm:hidden">
                        {formatDate(sub.submitted_at)}
                      </p>
                    </div>
                  </div>

                  <div className="col-span-2 text-sm text-muted-foreground hidden sm:block">
                    {formatDate(sub.submitted_at)}
                  </div>

                  <div className="col-span-2">{getStatusBadge(sub.status, 'md')}</div>

                  <div className="col-span-2">
                    {sub.score !== undefined && sub.score !== null ? (
                      <span className={`text-sm font-bold ${getScoreColor(sub.score, selectedAssignment!.max_score)}`}>
                        {sub.score} / {selectedAssignment!.max_score}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="col-span-3 flex items-center gap-2">
                    {sub.status !== 'graded' && gradingSubmissionId !== sub.id && (
                      <button
                        onClick={() => {
                          setGradingSubmissionId(sub.id);
                          setGradeScore('');
                          setGradeFeedback('');
                        }}
                        className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
                      >
                        <Award className="h-3 w-3" />
                        تقييم
                      </button>
                    )}
                    {sub.content && (
                      <button
                        onClick={() => {
                          toast.info(sub.content!);
                        }}
                        className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <MessageSquare className="h-3 w-3" />
                        المحتوى
                      </button>
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
                  </div>

                  {gradingSubmissionId === sub.id && (
                    <div className="col-span-12 mt-2 rounded-lg border bg-muted/30 p-3 space-y-3">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Award className="h-4 w-4 text-emerald-600" />
                        تقييم تسليم {sub.student_name}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">الدرجة</label>
                          <input
                            type="number"
                            min={0}
                            max={selectedAssignment!.max_score}
                            value={gradeScore}
                            onChange={(e) => setGradeScore(e.target.value)}
                            placeholder={`0 - ${selectedAssignment!.max_score}`}
                            className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                            dir="ltr"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">ملاحظات</label>
                          <textarea
                            value={gradeFeedback}
                            onChange={(e) => setGradeFeedback(e.target.value)}
                            placeholder="أضف ملاحظاتك هنا..."
                            rows={2}
                            className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors resize-none"
                            dir="rtl"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveGrade(sub.id)}
                          disabled={savingGrade}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {savingGrade ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          حفظ الدرجة
                        </button>
                        <button
                          onClick={() => {
                            setGradingSubmissionId(null);
                            setGradeScore('');
                            setGradeFeedback('');
                          }}
                          className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Assignment Detail (Student)
  // -------------------------------------------------------
  const renderStudentDetail = () => {
    const mySub = mySubmissions[selectedAssignment!.id];
    const pastDue = selectedAssignment!.due_date ? isPastDue(selectedAssignment!.due_date) : false;
    const countdown = selectedAssignment!.due_date ? getCountdown(selectedAssignment!.due_date) : null;

    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
        {/* Back button + header */}
        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedAssignment(null);
                setSubmitContent('');
                setSubmitFile(null);
                setSelectedExistingFile(null);
                setSubmitMode('text');
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground truncate">{selectedAssignment!.title}</h2>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <ClipboardList className="h-3.5 w-3.5" />
                  {getSubjectNameAll(selectedAssignment!.subject_id)}
                </span>
                {selectedAssignment!.due_date && (
                  <span className={`flex items-center gap-1 ${pastDue ? 'text-rose-600' : countdown?.urgent ? 'text-amber-600' : ''}`}>
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDateTime(selectedAssignment!.due_date)}
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
          </div>
        </motion.div>

        {/* Assignment info */}
        <motion.div variants={itemVariants} className="rounded-xl border bg-card p-5 space-y-3">
          {selectedAssignment!.description && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">الوصف</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedAssignment!.description}</p>
            </div>
          )}
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <div className="flex items-center gap-1.5">
              <Award className="h-4 w-4 text-emerald-600" />
              <span className="text-muted-foreground">الدرجة القصوى:</span>
              <span className="font-semibold text-foreground">{selectedAssignment!.max_score}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {selectedAssignment!.allow_file_submission ? (
                <>
                  <FileText className="h-4 w-4 text-emerald-600" />
                  <span className="text-emerald-600 font-medium">يسمح برفع ملفات</span>
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">تسليم نصي فقط</span>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {/* Deadline warning */}
        {pastDue && !mySub && (
          <motion.div variants={itemVariants} className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            <p className="text-sm text-rose-700 font-medium">انتهى الموعد النهائي لهذه المهمة. لا يمكنك التسليم الآن.</p>
          </motion.div>
        )}

        {/* My submission status */}
        {mySub && (
          <motion.div variants={itemVariants} className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">تسليمي</h4>
              {getStatusBadge(mySub.status, 'md')}
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
                <span className={`text-sm font-bold ${getScoreColor(mySub.score, selectedAssignment!.max_score)}`}>
                  {mySub.score} / {selectedAssignment!.max_score}
                </span>
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
          <motion.div variants={itemVariants} className="rounded-xl border bg-card p-5 space-y-4">
            <h4 className="text-sm font-semibold text-foreground">تسليم المهمة</h4>

            {/* Submission mode tabs */}
            <div className="flex gap-2 flex-wrap">
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
              disabled={submitting || (submitMode === 'text' && !submitContent.trim() && !submitFile) || (submitMode === 'upload' && !submitFile) || (submitMode === 'existing' && !selectedExistingFile)}
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
  // Create/Edit Modal
  // -------------------------------------------------------
  const renderModal = (mode: 'create' | 'edit') => {
    const isOpen = mode === 'create' ? createOpen : editOpen;
    const setIsOpen = mode === 'create' ? setCreateOpen : setEditOpen;
    const title = mode === 'create' ? newTitle : editTitle;
    const setTitle = mode === 'create' ? setNewTitle : setEditTitle;
    const desc = mode === 'create' ? newDescription : editDesc;
    const setDesc = mode === 'create' ? setNewDescription : setEditDesc;
    const dueDatetime = mode === 'create' ? newDueDatetime : editDueDatetime;
    const setDueDatetime = mode === 'create' ? setNewDueDatetime : setEditDueDatetime;
    const maxScore = mode === 'create' ? newMaxScore : editMaxScore;
    const setMaxScore = mode === 'create' ? setNewMaxScore : setEditMaxScore;
    const allowFile = mode === 'create' ? newAllowFile : editAllowFile;
    const setAllowFile = mode === 'create' ? setNewAllowFile : setEditAllowFile;
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
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-emerald-600" />
                  {mode === 'create' ? 'إنشاء مهمة جديدة' : 'تعديل المهمة'}
                </h3>
                <button onClick={() => { if (!isProcessing) setIsOpen(false); }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                {mode === 'create' && (
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">المقرر</label>
                    <select
                      value={newSubjectId}
                      onChange={(e) => setNewSubjectId(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      dir="rtl"
                      disabled={isProcessing}
                    >
                      <option value="">اختر المقرر</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">عنوان المهمة</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: واجب الفصل الثاني" className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" dir="rtl" disabled={isProcessing} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف (اختياري)</label>
                  <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="وصف المهمة..." rows={3} className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none" dir="rtl" disabled={isProcessing} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                    الموعد النهائي (التاريخ والوقت)
                  </label>
                  <input type="datetime-local" value={dueDatetime} onChange={(e) => setDueDatetime(e.target.value)} className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" dir="ltr" disabled={isProcessing} required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">الدرجة القصوى</label>
                    <input type="number" min={1} value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" dir="ltr" disabled={isProcessing} />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={allowFile} onChange={(e) => setAllowFile(e.target.checked)} className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500" disabled={isProcessing} />
                      <span className="text-sm font-medium text-foreground">السماح برفع ملفات</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t p-5">
                <button onClick={onSubmit} disabled={isProcessing} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'create' ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {mode === 'create' ? 'إنشاء المهمة' : 'حفظ التعديلات'}
                </button>
                <button onClick={() => { if (!isProcessing) setIsOpen(false); }} disabled={isProcessing} className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-60">
                  إلغاء
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  };

  // -------------------------------------------------------
  // Main Render
  // -------------------------------------------------------
  return (
    <>
      {selectedAssignment ? (
        role === 'teacher' ? renderTeacherDetail() : renderStudentDetail()
      ) : (
        renderAssignmentsList()
      )}

      {renderModal('create')}
      {renderModal('edit')}
    </>
  );
}
