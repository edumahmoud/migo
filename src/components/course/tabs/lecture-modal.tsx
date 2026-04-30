'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// xlsx is dynamically imported in handleExportExcel to reduce initial bundle size
import {
  BookOpen,
  Clock,
  Calendar,
  CheckCircle2,
  Loader2,
  X,
  Download,
  StickyNote,
  Lock,
  Unlock,
  Send,
  MapPin,
  UserCheck,
  UserX,
  Percent,
  Users,
  FileText,
  Eye,
  Upload,
  Pencil,
  Check,
  Plus,
  UserPlus,
  Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import type { UserProfile, LectureWithAttendance, AttendanceRecordWithStudent, LectureNote, LectureNoteWithAuthor } from '@/lib/types';
import UserAvatar from '@/components/shared/user-avatar';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface LectureModalProps {
  lecture: LectureWithAttendance;
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  totalStudents: number;
  onRefresh: () => void;
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Lecture time helpers (stored as metadata in description)
const TIME_META_REGEX = /__LECTURE_TIME__:([0-9]{1,2}:[0-9]{2})__/;
function extractLectureTime(description: string | null | undefined): string {
  if (!description) return '';
  const match = description.match(TIME_META_REGEX);
  return match ? match[1] : '';
}
function cleanDescription(description: string | null | undefined): string {
  if (!description) return '';
  return description.replace(TIME_META_REGEX, '').trim();
}
function formatTimeArabic(time24: string): string {
  if (!time24) return '';
  try {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'م' : 'ص';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
  } catch { return time24; }
}

function formatDuration(startedAt: string, endedAt?: string | null): string {
  try {
    const start = new Date(startedAt);
    const end = endedAt ? new Date(endedAt) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours} س ${mins} د`;
    return `${mins} دقيقة`;
  } catch { return '—'; }
}

// Parse [FILE|||url|||name] format from note content
// Uses ||| as separator because URLs contain : which would break the old format
function parseFileNote(content: string): { isFile: boolean; url: string; name: string } {
  // New format: [FILE|||url|||name]
  const newMatch = content.match(/^\[FILE\|\|\|(.+?)\|\|\|(.+?)\]$/);
  if (newMatch) {
    return { isFile: true, url: newMatch[1], name: newMatch[2] };
  }
  // Legacy format: [FILE:url:name] - try to parse with greedy URL match
  const legacyMatch = content.match(/^\[FILE:(https?:\/\/.+):(.+?)\]$/);
  if (legacyMatch) {
    return { isFile: true, url: legacyMatch[1], name: legacyMatch[2] };
  }
  return { isFile: false, url: '', name: '' };
}

// Upload file with XHR progress tracking
function uploadFileWithProgress(
  url: string,
  formData: FormData,
  headers: Record<string, string>,
  onProgress: (percent: number) => void
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // Timeout for slow mobile connections (5 minutes for large files)
    xhr.timeout = 5 * 60 * 1000;

    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        resolve(result);
      } catch {
        resolve({ success: false, error: 'حدث خطأ غير متوقع' });
      }
    };

    xhr.onerror = () => {
      resolve({ success: false, error: 'حدث خطأ في الاتصال' });
    };

    xhr.ontimeout = () => {
      resolve({ success: false, error: 'انتهت مهلة الرفع' });
    };

    xhr.send(formData);
  });
}

// Download file with custom name using blob
async function downloadWithCustomName(url: string, displayName: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = displayName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback: open in new tab
    window.open(url, '_blank');
  }
}

// -------------------------------------------------------
// Types for pending file uploads
// -------------------------------------------------------
interface PendingFile {
  file: File;
  customName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const modalVariants: Record<string, Record<string, unknown>> = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, scale: 0.95, y: 10, pointerEvents: 'none' as const, transition: { duration: 0.15 } },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function LectureModal({
  lecture,
  open,
  onClose,
  profile,
  role,
  subjectId,
  totalStudents,
  onRefresh,
}: LectureModalProps) {
  const isActive = lecture.attendance_session?.status === 'active';
  const hasSession = !!lecture.attendance_session;

  // ─── State ───
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecordWithStudent[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [absentStudents, setAbsentStudents] = useState<{ id: string; name: string; email: string; avatar_url: string | null }[]>([]);
  const [loadingAbsent, setLoadingAbsent] = useState(false);
  const [manualRegistering, setManualRegistering] = useState<string | null>(null);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualSearchQuery, setManualSearchQuery] = useState('');
  const [notes, setNotes] = useState<LectureNoteWithAuthor[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'public' | 'private'>('public');
  const [savingNote, setSavingNote] = useState(false);
  const [exporting, setExporting] = useState(false);

  // File preview modal
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);

  // ─── File Upload State ───
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch attendance records ───
  const fetchAttendanceRecords = useCallback(async () => {
    if (!lecture.attendance_session) { setAttendanceRecords([]); return; }
    setLoadingRecords(true);
    try {
      const [recordsResult] = await Promise.all([
        supabase.from('attendance_records').select('*').eq('session_id', lecture.attendance_session.id).order('checked_in_at', { ascending: true }),
      ]);

      if (recordsResult.error) { setAttendanceRecords([]); return; }

      const records = (recordsResult.data as AttendanceRecordWithStudent[]) || [];
      if (records.length > 0) {
        const studentIds = records.map((r) => r.student_id);
        // Use server-side API to fetch student profiles (bypasses RLS)
        let studentMap = new Map<string, { name: string; email: string }>();
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
            studentMap = new Map(
              (users || []).map((s: { id: string; name: string; email: string }) => [s.id, { name: s.name, email: s.email }])
            );
          }
        } catch {}
        const enriched = records.map((r) => ({
          ...r,
          student_name: studentMap.get(r.student_id)?.name || 'طالب',
          student_email: studentMap.get(r.student_id)?.email || '',
        }));
        setAttendanceRecords(enriched);
      } else {
        setAttendanceRecords([]);
      }
    } catch { setAttendanceRecords([]); }
    finally { setLoadingRecords(false); }
  }, [lecture.attendance_session]);

  // ─── Fetch absent students (enrolled but not checked in) ───
  const fetchAbsentStudents = useCallback(async () => {
    if (!lecture.attendance_session) { setAbsentStudents([]); return; }
    setLoadingAbsent(true);
    try {
      // Get all approved students in the subject
      const { data: enrollments } = await supabase
        .from('subject_students')
        .select('student_id')
        .eq('subject_id', subjectId)
        .eq('status', 'approved');

      if (!enrollments || enrollments.length === 0) {
        // Fallback: try without status filter
        const { data: fallbackEnrollments } = await supabase
          .from('subject_students')
          .select('student_id')
          .eq('subject_id', subjectId);
        if (!fallbackEnrollments || fallbackEnrollments.length === 0) {
          setAbsentStudents([]);
          return;
        }
        const allStudentIds = fallbackEnrollments.map((e: { student_id: string }) => e.student_id);
        const presentStudentIds = new Set(attendanceRecords.map((r) => r.student_id));
        const absentIds = allStudentIds.filter((id: string) => !presentStudentIds.has(id));
        if (absentIds.length === 0) { setAbsentStudents([]); return; }
        // Use server-side API to fetch student profiles (bypasses RLS)
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ userIds: absentIds }),
          });
          if (res.ok) {
            const { users } = await res.json();
            setAbsentStudents((users || []) as { id: string; name: string; email: string; avatar_url: string | null }[]);
          }
        } catch { setAbsentStudents([]); }
        return;
      }

      const allStudentIds = enrollments.map((e: { student_id: string }) => e.student_id);
      const presentStudentIds = new Set(attendanceRecords.map((r) => r.student_id));
      const absentIds = allStudentIds.filter((id: string) => !presentStudentIds.has(id));

      if (absentIds.length === 0) { setAbsentStudents([]); return; }

      // Use server-side API to fetch student profiles (bypasses RLS)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/users/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ userIds: absentIds }),
        });
        if (res.ok) {
          const { users } = await res.json();
          setAbsentStudents((users || []) as { id: string; name: string; email: string; avatar_url: string | null }[]);
        }
      } catch { setAbsentStudents([]); }
    } catch { setAbsentStudents([]); }
    finally { setLoadingAbsent(false); }
  }, [lecture.attendance_session, subjectId, attendanceRecords]);

  // ─── Manually register a student as present ───
  const handleManualRegister = async (studentId: string) => {
    if (!lecture.attendance_session) return;
    setManualRegistering(studentId);
    try {
      const res = await fetch('/api/attendance/manual-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: lecture.attendance_session.id,
          studentId,
          teacherId: profile.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('تم تسجيل حضور الطالب بنجاح');
        fetchAttendanceRecords();
        // Remove the student from the absent list immediately
        setAbsentStudents((prev) => prev.filter((s) => s.id !== studentId));
      } else {
        toast.error(data.error || 'حدث خطأ أثناء تسجيل الحضور');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setManualRegistering(null);
    }
  };

  // ─── Fetch lecture notes ───
  const fetchNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const query = supabase.from('lecture_notes').select('*').eq('lecture_id', lecture.id).order('created_at', { ascending: false });
      const { data, error } = await query;
      if (error) { setNotes([]); return; }
      const notesList = (data as LectureNote[]) || [];
      if (notesList.length > 0) {
        const authorIds = [...new Set(notesList.map((n) => n.user_id))];
        // Use server-side API to fetch author profiles (bypasses RLS)
        let authorMap = new Map<string, string>();
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ userIds: authorIds }),
          });
          if (res.ok) {
            const { users } = await res.json();
            authorMap = new Map((users || []).map((a: { id: string; name: string }) => [a.id, a.name]));
          }
        } catch {}
        const enriched = notesList.map((n) => ({
          ...n,
          author_name: authorMap.get(n.user_id) || 'معلم',
        })) as LectureNoteWithAuthor[];
        // Filter notes: teacher sees all, student sees only public
        setNotes(role === 'teacher' ? enriched : enriched.filter((n) => n.visibility === 'public'));
      } else {
        setNotes([]);
      }
    } catch { setNotes([]); }
    finally { setLoadingNotes(false); }
  }, [lecture.id, role]);

  useEffect(() => {
    if (open) {
      fetchAttendanceRecords();
      fetchNotes();
    }
  }, [open, fetchAttendanceRecords, fetchNotes]);

  // ─── Real-time subscription for attendance records ───
  useEffect(() => {
    if (!open || !lecture.attendance_session) return;
    const sessionId = lecture.attendance_session.id;
    const channel = supabase
      .channel(`modal-att-${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${sessionId}` }, () => fetchAttendanceRecords())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${sessionId}` }, () => {
        fetchAttendanceRecords();
        fetchAbsentStudents();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${sessionId}` }, () => fetchAttendanceRecords())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, lecture.attendance_session, fetchAttendanceRecords, fetchAbsentStudents]);

  // ─── Add note ───
  const handleAddNote = async () => {
    const content = newNote.trim();
    if (!content) { toast.error('يرجى كتابة ملاحظة'); return; }
    setSavingNote(true);
    try {
      const { error } = await supabase.from('lecture_notes').insert({
        lecture_id: lecture.id,
        user_id: profile.id,
        content,
        visibility: noteVisibility,
      });
      if (error) { toast.error('حدث خطأ أثناء حفظ الملاحظة'); }
      else { toast.success('تم إضافة الملاحظة'); setNewNote(''); fetchNotes(); }
    } catch { toast.error('حدث خطأ غير متوقع'); }
    finally { setSavingNote(false); }
  };

  // ─── Handle file selection ───
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles: PendingFile[] = Array.from(e.target.files).map((file) => ({
      file,
      customName: file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name,
      progress: 0,
      status: 'pending' as const,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Update custom name for a pending file ───
  const updatePendingFileName = (index: number, name: string) => {
    setPendingFiles((prev) =>
      prev.map((pf, i) => (i === index ? { ...pf, customName: name } : pf))
    );
  };

  // ─── Remove a pending file ───
  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Upload all pending files ───
  const handleUploadFiles = async () => {
    const filesToUpload = pendingFiles.filter((pf) => pf.status === 'pending' || pf.status === 'error');
    if (filesToUpload.length === 0) return;

    setUploadingFiles(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token || '';

    for (let i = 0; i < pendingFiles.length; i++) {
      const pf = pendingFiles[i];
      if (pf.status === 'done') continue;

      // Mark as uploading
      setPendingFiles((prev) =>
        prev.map((p, idx) => (idx === i ? { ...p, status: 'uploading' as const, progress: 0 } : p))
      );

      try {
        const originalExt = pf.file.name.includes('.') ? '.' + pf.file.name.split('.').pop() : '';
        const displayName = pf.customName.trim() ? pf.customName.trim() + originalExt : pf.file.name;

        const formData = new FormData();
        formData.append('file', pf.file);
        formData.append('subjectId', subjectId);
        formData.append('uploadedBy', profile.id);
        formData.append('category', 'محاضرات');
        formData.append('customName', pf.customName.trim());

        const result = await uploadFileWithProgress(
          '/api/files/course-upload',
          formData,
          { Authorization: `Bearer ${token}` },
          (percent) => {
            setPendingFiles((prev) =>
              prev.map((p, idx) => (idx === i ? { ...p, progress: percent } : p))
            );
          }
        );

        if (result.success && result.data) {
          const fileData = result.data as { file_url: string; file_name: string };
          // Create lecture_note referencing this file
          await supabase.from('lecture_notes').insert({
            lecture_id: lecture.id,
            user_id: profile.id,
            content: `[FILE|||${fileData.file_url}|||${fileData.file_name}]`,
            visibility: 'public',
          });

          setPendingFiles((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, status: 'done' as const, progress: 100 } : p))
          );
        } else {
          setPendingFiles((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, status: 'error' as const, error: result.error || 'حدث خطأ' } : p))
          );
        }
      } catch {
        setPendingFiles((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: 'error' as const, error: 'حدث خطأ غير متوقع' } : p))
        );
      }
    }

    setUploadingFiles(false);
    fetchNotes();
    onRefresh();
    toast.success('تم رفع الملفات بنجاح');

    // Clear done files after a short delay
    setTimeout(() => {
      setPendingFiles((prev) => prev.filter((pf) => pf.status !== 'done'));
    }, 1500);
  };

  // ─── Export attendance to Excel ───
  const handleExportExcel = async () => {
    if (attendanceRecords.length === 0) { toast.error('لا توجد بيانات حضور للتصدير'); return; }
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const data = attendanceRecords.map((r) => ({
        'اسم الطالب': r.student_name || 'طالب',
        'البريد الإلكتروني': r.student_email || '—',
        'وقت التسجيل': formatTime(r.checked_in_at),
        'طريقة التسجيل': r.check_in_method === 'qr' ? 'مسح QR' : r.check_in_method === 'gps' ? 'GPS' : r.check_in_method === 'manual' ? 'يدوي' : '—',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'سجل الحضور');
      XLSX.writeFile(wb, `حضور_${lecture.title}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('تم تصدير سجل الحضور بنجاح');
    } catch { toast.error('حدث خطأ أثناء التصدير'); }
    finally { setExporting(false); }
  };

  // ─── Stats ───
  const presentCount = attendanceRecords.length;
  const absentCount = Math.max(0, totalStudents - presentCount);
  const attendancePercent = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

  // ─── Determine file type for preview ───
  const getFilePreviewType = (url: string, name: string): 'image' | 'pdf' | 'other' => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    return 'other';
  };

  // Count file notes
  const fileNotes = notes.filter((n) => parseFileNote(n.content).isFile);
  const textNotes = notes.filter((n) => !parseFileNote(n.content).isFile);
  const hasPendingFiles = pendingFiles.some((pf) => pf.status !== 'done');

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            onClick={onClose}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            <motion.div
              variants={modalVariants as any}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-background shadow-2xl"
              dir="rtl"
            >
              {/* ─── Header ─── */}
              <div className="sticky top-0 z-10 bg-background border-b p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
                      <BookOpen className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-foreground truncate">{lecture.title}</h2>
                      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground mt-0.5">
                        {lecture.lecture_date && (
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(lecture.lecture_date)}</span>
                        )}
                        {extractLectureTime(lecture.description) && (
                          <span className="flex items-center gap-1 text-emerald-700 font-medium"><Clock className="h-3 w-3" />{formatTimeArabic(extractLectureTime(lecture.description))}</span>
                        )}
                        {lecture.attendance_session && (
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTime(lecture.attendance_session.started_at)}</span>
                        )}
                        {hasSession && (
                          <span className="flex items-center gap-1">
                            {isActive ? `المدة: ${formatDuration(lecture.attendance_session!.started_at)}` : lecture.attendance_session?.ended_at ? `المدة: ${formatDuration(lecture.attendance_session!.started_at, lecture.attendance_session!.ended_at)}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Status badge */}
                    {isActive ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                        <span className="relative flex h-2 w-2 ml-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        جارية
                      </Badge>
                    ) : hasSession ? (
                      <Badge variant="outline" className="text-muted-foreground">منتهية</Badge>
                    ) : null}

                    <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {cleanDescription(lecture.description) && (
                  <p className="text-sm text-muted-foreground mt-2">{cleanDescription(lecture.description)}</p>
                )}
              </div>

              {/* ─── Body ─── */}
              <div className="p-5 space-y-5">

                {/* ─── No session yet (teacher) ─── */}
                {!hasSession && role === 'teacher' && (
                  <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 p-8 text-center">
                    <Users className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-foreground mb-1">لم يتم فتح المحاضرة بعد</p>
                    <p className="text-xs text-muted-foreground">اضغط على زر &quot;بدء المحاضرة&quot; في البطاقة لبدء تسجيل الحضور</p>
                  </div>
                )}

                {/* ─── No session (student) ─── */}
                {!hasSession && role === 'student' && (
                  <div className="rounded-xl border border-dashed border-muted-300 bg-muted/30 p-6 text-center">
                    <Clock className="h-8 w-8 text-muted-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">لم يتم فتح المحاضرة بعد من قبل المعلم</p>
                  </div>
                )}

                {/* ─── Attendance Stats Cards ─── */}
                {hasSession && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border bg-emerald-50/50 p-3 text-center">
                      <UserCheck className="h-5 w-5 text-emerald-600 mx-auto mb-1" />
                      <p className="text-xl font-bold text-emerald-700">{presentCount}</p>
                      <p className="text-[10px] text-emerald-600 font-medium">حاضر</p>
                    </div>
                    <div className="rounded-xl border bg-rose-50/50 p-3 text-center">
                      <UserX className="h-5 w-5 text-rose-600 mx-auto mb-1" />
                      <p className="text-xl font-bold text-rose-700">{absentCount}</p>
                      <p className="text-[10px] text-rose-600 font-medium">غائب</p>
                    </div>
                    <div className="rounded-xl border bg-amber-50/50 p-3 text-center">
                      <Users className="h-5 w-5 text-amber-600 mx-auto mb-1" />
                      <p className="text-xl font-bold text-amber-700">{totalStudents}</p>
                      <p className="text-[10px] text-amber-600 font-medium">إجمالي</p>
                    </div>
                    <div className="rounded-xl border bg-teal-50/50 p-3 text-center">
                      <Percent className="h-5 w-5 text-teal-600 mx-auto mb-1" />
                      <p className="text-xl font-bold text-teal-700">{attendancePercent}%</p>
                      <p className="text-[10px] text-teal-600 font-medium">نسبة الحضور</p>
                    </div>
                  </div>
                )}

                {/* ─── File Upload Section (Teacher only) ─── */}
                {role === 'teacher' && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Upload className="h-4 w-4 text-emerald-600" />
                        ملفات المحاضرة
                      </h4>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFiles}
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        إضافة ملفات
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                        disabled={uploadingFiles}
                      />
                    </div>
                    <div className="p-4 space-y-3">
                      {/* Pending files list */}
                      {pendingFiles.length > 0 && (
                        <div className="space-y-2">
                          {pendingFiles.map((pf, idx) => (
                            <div
                              key={idx}
                              className={`rounded-lg border p-3 ${
                                pf.status === 'done' ? 'border-emerald-200 bg-emerald-50/30' :
                                pf.status === 'error' ? 'border-rose-200 bg-rose-50/30' :
                                pf.status === 'uploading' ? 'border-amber-200 bg-amber-50/30' :
                                'border-border bg-muted/20'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <FileText className={`h-4 w-4 shrink-0 ${
                                  pf.status === 'done' ? 'text-emerald-600' :
                                  pf.status === 'error' ? 'text-rose-600' :
                                  'text-muted-foreground'
                                }`} />
                                <span className="text-xs text-muted-foreground truncate flex-1">{pf.file.name}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{(pf.file.size / 1024).toFixed(0)} KB</span>
                                {pf.status === 'pending' && (
                                  <button
                                    onClick={() => removePendingFile(idx)}
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                                {pf.status === 'done' && (
                                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                                )}
                                {pf.status === 'error' && (
                                  <span className="text-[10px] text-rose-600 shrink-0">فشل</span>
                                )}
                              </div>
                              {/* Rename field */}
                              {pf.status !== 'done' && (
                                <div className="flex items-center gap-2 mb-2">
                                  <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <input
                                    type="text"
                                    value={pf.customName}
                                    onChange={(e) => updatePendingFileName(idx, e.target.value)}
                                    placeholder="اسم الملف (بدون الامتداد)"
                                    className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                                    dir="rtl"
                                    disabled={pf.status === 'uploading'}
                                  />
                                  {pf.file.name.includes('.') && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      .{pf.file.name.split('.').pop()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {/* Progress bar */}
                              {(pf.status === 'uploading' || pf.status === 'done') && (
                                <div className="space-y-1">
                                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        pf.status === 'done' ? 'bg-emerald-500' : 'bg-amber-500'
                                      }`}
                                      style={{ width: `${pf.progress}%` }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground">
                                      {pf.status === 'done' ? 'تم الرفع ✓' : 'جارٍ الرفع...'}
                                    </span>
                                    <span className={`text-[10px] font-medium ${
                                      pf.status === 'done' ? 'text-emerald-600' : 'text-amber-600'
                                    }`}>
                                      {pf.progress}%
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Upload button */}
                          {hasPendingFiles && (
                            <button
                              onClick={handleUploadFiles}
                              disabled={uploadingFiles || !pendingFiles.some((pf) => pf.status === 'pending' || pf.status === 'error')}
                              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                            >
                              {uploadingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              {uploadingFiles ? 'جارٍ الرفع...' : 'رفع الملفات'}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Existing file notes */}
                      {fileNotes.length > 0 && (
                        <div className="space-y-2">
                          {fileNotes.map((note) => {
                            const fileRef = parseFileNote(note.content);
                            if (!fileRef.isFile) return null;
                            return (
                              <div
                                key={note.id}
                                className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <FileText className="h-4 w-4 text-emerald-600" />
                                  <span className="text-xs font-medium text-foreground">{note.author_name}</span>
                                  <span className="text-[10px] text-muted-foreground mr-auto">{formatTime(note.created_at)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setPreviewFile({ url: fileRef.url, name: fileRef.name })}
                                    className="flex items-center gap-2 rounded-lg bg-emerald-600/10 border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors flex-1 text-right"
                                  >
                                    <Eye className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{fileRef.name}</span>
                                  </button>
                                  <button
                                    onClick={() => downloadWithCustomName(fileRef.url, fileRef.name)}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors"
                                    title="تحميل"
                                  >
                                    <Download className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* No files message */}
                      {pendingFiles.length === 0 && fileNotes.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-3">لا توجد ملفات مرفقة بعد</p>
                      )}
                    </div>
                  </div>
                )}

                {/* ─── Student: File Links ─── */}
                {role === 'student' && fileNotes.length > 0 && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="flex items-center bg-muted/50 px-4 py-3 border-b">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <FileText className="h-4 w-4 text-emerald-600" />
                        ملفات المحاضرة
                      </h4>
                    </div>
                    <div className="p-4 space-y-2">
                      {fileNotes.map((note) => {
                        const fileRef = parseFileNote(note.content);
                        if (!fileRef.isFile) return null;
                        return (
                          <div
                            key={note.id}
                            className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                              <button
                                onClick={() => setPreviewFile({ url: fileRef.url, name: fileRef.name })}
                                className="flex items-center gap-2 flex-1 text-right text-sm font-medium text-emerald-700 hover:text-emerald-800 transition-colors min-w-0"
                              >
                                <Eye className="h-4 w-4 shrink-0" />
                                <span className="truncate">{fileRef.name}</span>
                              </button>
                              <button
                                onClick={() => downloadWithCustomName(fileRef.url, fileRef.name)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors"
                                title="تحميل"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ─── Notes Section ─── */}
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b">
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <StickyNote className="h-4 w-4 text-amber-600" />
                      الملاحظات
                    </h4>
                  </div>
                  <div className="p-4 space-y-3">
                    {/* Add note (teacher only) */}
                    {role === 'teacher' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setNoteVisibility('public')}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                              noteVisibility === 'public'
                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                : 'border-border text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            <Unlock className="h-3 w-3" />
                            عامة
                          </button>
                          <button
                            onClick={() => setNoteVisibility('private')}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                              noteVisibility === 'private'
                                ? 'border-amber-500 bg-amber-50 text-amber-700'
                                : 'border-border text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            <Lock className="h-3 w-3" />
                            خاصة
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            placeholder={noteVisibility === 'public' ? 'اكتب ملاحظة عامة يراها جميع الطلاب...' : 'اكتب ملاحظة خاصة بك...'}
                            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                            dir="rtl"
                            disabled={savingNote}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !savingNote) handleAddNote(); }}
                          />
                          <button
                            onClick={handleAddNote}
                            disabled={savingNote || !newNote.trim()}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                          >
                            {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Text notes list */}
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                    ) : textNotes.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">لا توجد ملاحظات بعد</p>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {textNotes.map((note) => (
                          <div
                            key={note.id}
                            className={`rounded-lg border p-3 ${
                              note.visibility === 'private' ? 'bg-amber-50/50 border-amber-200' : 'bg-muted/30'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-foreground">{note.author_name}</span>
                              {note.visibility === 'private' && (
                                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[9px] py-0">
                                  <Lock className="h-2.5 w-2.5 ml-0.5" />خاص
                                </Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground mr-auto">{formatTime(note.created_at)}</span>
                            </div>
                            <p className="text-sm text-foreground">{note.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ─── Attendance Records List (AFTER notes) ─── */}
                {hasSession && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Users className="h-4 w-4 text-emerald-600" />
                        سجل الحضور
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-emerald-700">{presentCount}/{totalStudents}</span>
                        {role === 'teacher' && (
                          <button
                            onClick={() => {
                              setManualSearchQuery('');
                              setManualDialogOpen(true);
                              fetchAbsentStudents();
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            تسجيل يدوي
                          </button>
                        )}
                        {role === 'teacher' && (
                          <button
                            onClick={handleExportExcel}
                            disabled={exporting}
                            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors"
                          >
                            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            تحميل Excel
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {loadingRecords ? (
                        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>
                      ) : attendanceRecords.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">لم يسجل أي طالب حضوراً بعد</div>
                      ) : (
                        <div className="divide-y">
                          {attendanceRecords.map((record) => (
                            <div key={record.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <UserAvatar name={record.student_name || 'مستخدم'} avatarUrl={record.student_avatar} size="sm" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{record.student_name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{record.student_email}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {record.check_in_method && (
                                  <Badge variant="outline" className="text-[9px]">
                                    <MapPin className="h-2.5 w-2.5 ml-0.5" />
                                    {record.check_in_method === 'qr' ? 'QR' : record.check_in_method === 'gps' ? 'GPS' : record.check_in_method === 'manual' ? 'يدوي' : '—'}
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(record.checked_in_at)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Manual Attendance Registration Dialog ─── */}
      <AnimatePresence>
        {manualDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setManualDialogOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[80vh] rounded-2xl border bg-background shadow-xl overflow-hidden"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                    <UserPlus className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">تسجيل حضور يدوي</h3>
                    <p className="text-xs text-muted-foreground">سجّل حضور طالب تحسباً لأي ظروف</p>
                  </div>
                </div>
                <button
                  onClick={() => setManualDialogOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={manualSearchQuery}
                    onChange={(e) => setManualSearchQuery(e.target.value)}
                    placeholder="ابحث بالاسم..."
                    className="w-full rounded-xl border bg-background pr-10 pl-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                    dir="rtl"
                    autoFocus
                  />
                </div>
              </div>

              {/* Student List */}
              <div className="max-h-96 overflow-y-auto custom-scrollbar">
                {loadingAbsent ? (
                  <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>
                ) : absentStudents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 mb-3">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                    </div>
                    <p className="text-sm font-medium text-foreground">جميع الطلاب مسجلون ✓</p>
                    <p className="text-xs text-muted-foreground mt-1">لا يوجد طلاب غائبون</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {absentStudents
                      .filter((student) =>
                        !manualSearchQuery.trim() ||
                        student.name.toLowerCase().includes(manualSearchQuery.trim().toLowerCase()) ||
                        student.email.toLowerCase().includes(manualSearchQuery.trim().toLowerCase())
                      )
                      .map((student) => (
                      <div key={student.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{student.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleManualRegister(student.id)}
                          disabled={manualRegistering === student.id}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors shrink-0"
                        >
                          {manualRegistering === student.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                          تسجيل
                        </button>
                      </div>
                    ))}
                    {absentStudents.filter((student) =>
                      !manualSearchQuery.trim() ||
                      student.name.toLowerCase().includes(manualSearchQuery.trim().toLowerCase()) ||
                      student.email.toLowerCase().includes(manualSearchQuery.trim().toLowerCase())
                    ).length === 0 && manualSearchQuery.trim() && (
                      <div className="py-8 text-center text-xs text-muted-foreground">لا توجد نتائج مطابقة للبحث</div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t px-5 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {absentStudents.length > 0 ? `${absentStudents.length} طالب غائب` : ''}
                </span>
                <button
                  onClick={() => setManualDialogOpen(false)}
                  className="rounded-xl border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  إغلاق
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Fullscreen File Preview Modal ─── */}
      <AnimatePresence>
        {previewFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setPreviewFile(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-4xl max-h-[90vh] rounded-2xl bg-background shadow-2xl overflow-hidden"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <FileText className="h-5 w-5 text-emerald-600" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground truncate">{previewFile.name}</h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => downloadWithCustomName(previewFile.url, previewFile.name)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    تحميل
                  </button>
                  <button
                    onClick={() => setPreviewFile(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Preview content */}
              <div className="flex items-center justify-center p-4" style={{ height: 'calc(90vh - 70px)' }}>
                {getFilePreviewType(previewFile.url, previewFile.name) === 'image' ? (
                  <img
                    src={previewFile.url}
                    alt={previewFile.name}
                    className="max-w-full max-h-full object-contain rounded-lg"
                  />
                ) : getFilePreviewType(previewFile.url, previewFile.name) === 'pdf' ? (
                  <iframe
                    src={previewFile.url}
                    className="w-full h-full rounded-lg border"
                    title={previewFile.name}
                  />
                ) : (
                  <div className="text-center py-16">
                    <FileText className="h-16 w-16 text-muted-300 mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground mb-4">لا يمكن معاينة هذا الملف مباشرة</p>
                    <button
                      onClick={() => downloadWithCustomName(previewFile.url, previewFile.name)}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      تحميل الملف
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
