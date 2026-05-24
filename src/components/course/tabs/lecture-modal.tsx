'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePWALifecycle } from '@/hooks/use-pwa-lifecycle';
import { useI18n } from '@/lib/i18n/context';
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
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { waitForSession, getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
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
function formatDate(dateStr: string, locale: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function formatTime(dateStr: string, locale: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
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
function formatTimeArabic(time24: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!time24) return '';
  try {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? t('lecture.pm') : t('lecture.am');
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
  } catch { return time24; }
}

function formatDuration(startedAt: string, endedAt?: string | null, t?: (key: string, params?: Record<string, string | number>) => string): string {
  try {
    const start = new Date(startedAt);
    const end = endedAt ? new Date(endedAt) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (t) {
      if (hours > 0) return t('lecture.durationShort', { h: hours, m: mins });
      return t('lecture.durationMinutes', { m: mins });
    }
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
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
  onProgress: (percent: number) => void,
  t: (key: string, params?: Record<string, unknown>) => string
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
      // FIX: Check HTTP status code before parsing response
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({ success: false, error: t('lecture.toastUnexpectedError') }); }
      } else {
        // Server returned an error status — parse the error message
        try {
          const result = JSON.parse(xhr.responseText);
          resolve({ success: false, error: result.error || t('lecture.httpError', { status: xhr.status }) });
        } catch {
          resolve({ success: false, error: t('lecture.httpError', { status: xhr.status }) });
        }
      }
    };

    xhr.onerror = () => {
      resolve({ success: false, error: t('lecture.connectionError') });
    };

    xhr.ontimeout = () => {
      resolve({ success: false, error: t('lecture.uploadTimeout') });
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
  fileData: ArrayBuffer | null; // Pre-read data (critical for mobile PWA where File objects can become invalid)
  fileName: string; // Store separately in case File object is invalidated
  fileType: string;
  fileSize: number;
  customName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  errorCode?: 'duplicate_name' | 'auth' | 'network' | 'size' | 'other'; // Categorized error
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
  const { t, dir, locale } = useI18n();
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
  const [existingSubjectFileNames, setExistingSubjectFileNames] = useState<string[]>([]); // For client-side pre-validation
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── PWA Lifecycle protection ───
  // Prevents page reload while modal is open and files are being uploaded
  usePWALifecycle({
    stateKey: `lecture-modal-${lecture.id}`,
    isBusy: open && (uploadingFiles || pendingFiles.some(pf => pf.status === 'uploading')),
    onSave: undefined, // No state restoration needed — modal re-fetches on mount
    onRestore: undefined,
  });

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
          const headers = await getCachedAuthHeaders();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers,
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
          student_name: studentMap.get(r.student_id)?.name || t('lecture.student'),
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
          const headers = await getCachedAuthHeaders();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers,
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
        const headers = await getCachedAuthHeaders();
        const res = await fetch('/api/users/batch', {
          method: 'POST',
          headers,
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
        toast.success(t('lecture.toastManualRegisterSuccess'));
        fetchAttendanceRecords();
        // Remove the student from the absent list immediately
        setAbsentStudents((prev) => prev.filter((s) => s.id !== studentId));
      } else {
        toast.error(data.error || t('lecture.toastManualRegisterFailed'));
      }
    } catch {
      toast.error(t('lecture.toastUnexpectedError'));
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
          const headers = await getCachedAuthHeaders();
          const res = await fetch('/api/users/batch', {
            method: 'POST',
            headers,
            body: JSON.stringify({ userIds: authorIds }),
          });
          if (res.ok) {
            const { users } = await res.json();
            authorMap = new Map((users || []).map((a: { id: string; name: string }) => [a.id, a.name]));
          }
        } catch {}
        const enriched = notesList.map((n) => ({
          ...n,
          author_name: authorMap.get(n.user_id) || t('lecture.teacher'),
        })) as LectureNoteWithAuthor[];
        // Filter notes: teacher sees all, student sees only public
        setNotes(role === 'teacher' ? enriched : enriched.filter((n) => n.visibility === 'public'));
      } else {
        setNotes([]);
      }
    } catch { setNotes([]); }
    finally { setLoadingNotes(false); }
  }, [lecture.id, role]);

  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

  // ─── Escape key handler ───
  // Since we removed onClick from backdrop (to prevent mobile synthetic click issues
  // when returning from native file picker), we provide Escape as a close method.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      fetchAttendanceRecords();
      fetchNotes();
      // Fetch existing subject file names for client-side pre-validation
      (async () => {
        try {
          const { data } = await supabase
            .from('subject_files')
            .select('file_name')
            .eq('subject_id', subjectId);
          if (data) {
            setExistingSubjectFileNames(data.map((f: { file_name: string }) => f.file_name.toLowerCase()));
          }
        } catch (err) {
          console.warn('[LectureModal] Failed to fetch existing file names:', err);
        }
      })();
    }
  }, [open, fetchAttendanceRecords, fetchNotes, subjectId]);

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
    if (!content) { toast.error(t('lecture.toastNoteRequired')); return; }
    setSavingNote(true);
    try {
      const { error } = await supabase.from('lecture_notes').insert({
        lecture_id: lecture.id,
        user_id: profile.id,
        content,
        visibility: noteVisibility,
      });
      if (error) { toast.error(t('lecture.toastNoteSaveFailed')); }
      else { toast.success(t('lecture.toastNoteAdded')); setNewNote(''); fetchNotes(); }
    } catch { toast.error(t('lecture.toastUnexpectedError')); }
    finally { setSavingNote(false); }
  };

  // ─── Handle file selection ───
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    // Pre-read file data into ArrayBuffers for mobile PWA reliability
    const newFiles: PendingFile[] = await Promise.all(
      Array.from(e.target.files).map(async (file) => {
        let fileData: ArrayBuffer | null = null;
        try {
          fileData = await file.arrayBuffer();
          console.log(`[LectureUpload] Pre-read file "${file.name}", size: ${fileData.byteLength} bytes`);
        } catch (readErr) {
          console.error(`[LectureUpload] Failed to pre-read file "${file.name}":`, readErr);
        }
        // Client-side pre-validation: check for duplicate name+extension
        const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
        const customName = file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name;
        const displayName = customName.trim() + originalExt;
        const isDuplicate = existingSubjectFileNames.includes(displayName.toLowerCase());
        // Also check against other pending files
        const isDuplicateInPending = pendingFiles.some(pf => {
          const pfExt = pf.fileName.includes('.') ? '.' + pf.fileName.split('.').pop() : '';
          const pfDisplayName = pf.customName.trim() + pfExt;
          return pfDisplayName.toLowerCase() === displayName.toLowerCase();
        });
        return {
          file,
          fileData,
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          customName,
          progress: 0,
          status: (isDuplicate || isDuplicateInPending) ? 'error' as const : 'pending' as const,
          error: (isDuplicate || isDuplicateInPending)
            ? t('lecture.duplicateFileName', { name: displayName })
            : undefined,
          errorCode: (isDuplicate || isDuplicateInPending) ? 'duplicate_name' as const : undefined,
        };
      })
    );
    // Show warning for duplicates
    const duplicateFiles = newFiles.filter(f => f.errorCode === 'duplicate_name');
    if (duplicateFiles.length > 0) {
      toast.error(t('lecture.duplicateFilesCount', { count: duplicateFiles.length }));
    }
    setPendingFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Update custom name for a pending file ───
  const updatePendingFileName = (index: number, name: string) => {
    setPendingFiles((prev) =>
      prev.map((pf, i) => (i === index ? { ...pf, customName: name, error: undefined, errorCode: undefined, status: 'pending' as const } : pf))
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

    // Wait for valid auth session — critical on mobile PWA where session hydration is slow
    const token = await waitForSession(15000);
    if (!token) {
      toast.error(t('lecture.toastLoginRequired'));
      setUploadingFiles(false);
      return;
    }

    for (let i = 0; i < pendingFiles.length; i++) {
      const pf = pendingFiles[i];
      if (pf.status === 'done') continue;

      // Mark as uploading
      setPendingFiles((prev) =>
        prev.map((p, idx) => (idx === i ? { ...p, status: 'uploading' as const, progress: 0 } : p))
      );

      try {
        // SAFETY: Only use pre-read properties (pf.fileName, pf.fileType, pf.fileSize).
        // Never access pf.file.name / pf.file.type / pf.file.size — on mobile PWA,
        // the File object can become invalidated after the native file picker closes,
        // and accessing its properties throws TypeError during render/execution.
        const fileName = pf.fileName || 'unknown';
        const fileType = pf.fileType || 'application/octet-stream';
        const fileSize = pf.fileSize || 0;

        // ─── CRITICAL FIX: Use pre-read ArrayBuffer data instead of File object ───
        let arrayBuffer: ArrayBuffer;
        if (pf.fileData && pf.fileData.byteLength > 0) {
          arrayBuffer = pf.fileData;
          console.log(`[LectureUpload] Using pre-read data for "${fileName}", size: ${arrayBuffer.byteLength}`);
        } else {
          console.warn(`[LectureUpload] No pre-read data for "${fileName}", reading from File object...`);
          try {
            arrayBuffer = await pf.file.arrayBuffer();
          } catch (readErr) {
            console.error(`[LectureUpload] File object is invalid for "${fileName}":`, readErr);
            throw new Error(t('lecture.toastFileReadFailed', { name: fileName }));
          }
        }

        // Create a fresh Blob from the ArrayBuffer
        const uploadBlob = new Blob([arrayBuffer], { type: fileType });

        const originalExt = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
        const displayName = pf.customName.trim() ? pf.customName.trim() + originalExt : fileName;

        let uploadSucceeded = false;

        // ── STEP 1 (PRIMARY): Server-side upload via same-origin fetch() ──
        // Most reliable on mobile PWA: same-origin fetch() with FormData.
        // The server handles storage upload (no cross-origin client requests).
        // Subject to Vercel 4.5MB body limit.
        const FILE_SIZE_LIMIT = 4 * 1024 * 1024; // 4MB safe margin
        if (fileSize <= FILE_SIZE_LIMIT) {
          try {
            setPendingFiles((prev) =>
              prev.map((p, idx) => (idx === i ? { ...p, progress: 20 } : p))
            );

            const formData = new FormData();
            formData.append('file', uploadBlob, fileName);
            formData.append('subjectId', subjectId);
            formData.append('uploadedBy', profile.id);
            formData.append('category', t('lecture.category'));
            formData.append('customName', pf.customName.trim());

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const res = await fetch('/api/files/course-upload', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
              },
              body: formData,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // FIX: Check HTTP status before parsing JSON to avoid SyntaxError on HTML error pages
            let result: { success: boolean; data?: Record<string, unknown>; error?: string; code?: string };
            if (res.ok) {
              try { result = await res.json(); }
              catch { result = { success: false, error: t('lecture.unexpectedServerError') }; }
            } else {
              const errorText = await res.text();
              try { result = JSON.parse(errorText); }
              catch { result = { success: false, error: t('lecture.httpError', { status: res.status }) }; }
            }

            if (result.success && result.data) {
              const fileData = result.data as { file_url: string; file_name: string };
              // Create lecture_note referencing this file
              await supabase.from('lecture_notes').insert({
                lecture_id: lecture.id,
                user_id: profile.id,
                content: `[FILE|||${fileData.file_url}|||${fileData.file_name}]`,
                visibility: 'public',
              });
              uploadSucceeded = true;
              console.log(`[LectureUpload] Server-side upload succeeded for ${displayName}`);
            } else if (result.code === 'DUPLICATE_NAME') {
              // DUPLICATE_NAME error — store error code for retry UI
              const duplicateMsg = t('lecture.duplicateFileName', { name: displayName });
              setPendingFiles((prev) =>
                prev.map((p, idx) => (idx === i ? { ...p, error: duplicateMsg, errorCode: 'duplicate_name' as const } : p))
              );
              toast.error(duplicateMsg);
              // Skip fallback for duplicate name — no point retrying with same name
              continue;
            } else {
              console.warn(`[LectureUpload] Server-side upload failed for ${displayName}:`, result.error);
            }
          } catch (serverErr) {
            console.warn(`[LectureUpload] Server-side upload error for ${displayName}:`, serverErr instanceof Error ? serverErr.message : serverErr);
          }
        } else {
          console.log(`[LectureUpload] File ${displayName} is ${Math.round(fileSize / 1024 / 1024)}MB, too large for server route`);
        }

        // ── STEP 2 (FALLBACK): Direct upload to Supabase Storage from client ──
        if (!uploadSucceeded) {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
          const safeStorageName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const storagePath = `courses/${subjectId}/${safeStorageName}`;
          let storageUploadSuccess = false;

          // Try SDK upload (uses fetch internally, more reliable than XHR on mobile PWA)
          try {
            const { error: uploadError } = await supabase.storage
              .from('user-files')
              .upload(storagePath, uploadBlob, {
                cacheControl: '3600',
                contentType: fileType,
                upsert: false,
              });

            if (uploadError) {
              throw uploadError;
            }
            storageUploadSuccess = true;
          } catch (sdkErr) {
            console.warn(`[LectureUpload] SDK upload failed:`, sdkErr);
          }

          // XHR fallback for storage upload (real progress tracking)
          if (!storageUploadSuccess && supabaseUrl && supabaseAnonKey) {
            try {
              await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.timeout = 5 * 60 * 1000;

                xhr.upload.addEventListener('progress', (e) => {
                  if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 85);
                    setPendingFiles((prev) =>
                      prev.map((p, idx) => (idx === i ? { ...p, progress: percent } : p))
                    );
                  }
                });

                xhr.addEventListener('load', () => {
                  if (xhr.status >= 200 && xhr.status < 300) resolve();
                  else reject(new Error(`HTTP ${xhr.status}`));
                });
                xhr.addEventListener('error', () => reject(new Error('Network error')));
                xhr.addEventListener('timeout', () => reject(new Error(t('lecture.uploadTimeout'))));

                const storageUploadUrl = `${supabaseUrl}/storage/v1/object/user-files/${storagePath}`;
                xhr.open('POST', storageUploadUrl);
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                xhr.setRequestHeader('apikey', supabaseAnonKey);
                xhr.setRequestHeader('x-upsert', 'false');

                const formData = new FormData();
                formData.append('cacheControl', '3600');
                formData.append('file', uploadBlob, fileName);
                xhr.send(formData);
              });

              storageUploadSuccess = true;
            } catch (xhrErr) {
              console.warn(`[LectureUpload] XHR upload also failed:`, xhrErr instanceof Error ? xhrErr.message : xhrErr);
            }
          }

          if (!storageUploadSuccess) {
            throw new Error(t('lecture.storageConnectFailed'));
          }

          // Create DB record via API
          const fileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${storagePath}`;
          setPendingFiles((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, progress: 90 } : p))
          );

          const recordHeaders = await getCachedAuthHeaders();
          const recordController = new AbortController();
          const recordTimeout = setTimeout(() => recordController.abort(), 30000);

          try {
            const createRes = await fetch('/api/files/course-upload', {
              method: 'POST',
              headers: recordHeaders,
              body: JSON.stringify({
                subjectId,
                uploadedBy: profile.id,
                category: t('lecture.category'),
                customName: pf.customName.trim(),
                displayName,
                fileUrl,
                storagePath,
                fileSize: fileSize,
                fileType: fileType,
              }),
              signal: recordController.signal,
            });

            clearTimeout(recordTimeout);
            // FIX: Safely parse JSON — server may return HTML on error
            let createResult: { success: boolean; data?: Record<string, unknown>; error?: string; code?: string };
            if (createRes.ok) {
              try { createResult = await createRes.json(); }
              catch { createResult = { success: false, error: t('lecture.unexpectedServerError') }; }
            } else {
              const errorText = await createRes.text();
              try { createResult = JSON.parse(errorText); }
              catch { createResult = { success: false, error: t('lecture.httpError', { status: createRes.status }) }; }
            }

            if (createRes.ok && createResult.success && createResult.data) {
              const fileData = createResult.data as { file_url: string; file_name: string };
              await supabase.from('lecture_notes').insert({
                lecture_id: lecture.id,
                user_id: profile.id,
                content: `[FILE|||${fileData.file_url}|||${fileData.file_name}]`,
                visibility: 'public',
              });
              uploadSucceeded = true;
            } else if (createResult.code === 'DUPLICATE_NAME') {
              // DUPLICATE_NAME error from JSON mode — store error code for retry UI
              const duplicateMsg = t('lecture.duplicateFileName', { name: displayName });
              setPendingFiles((prev) =>
                prev.map((p, idx) => (idx === i ? { ...p, error: duplicateMsg, errorCode: 'duplicate_name' as const } : p))
              );
              await supabase.storage.from('user-files').remove([storagePath]);
              toast.error(duplicateMsg);
            } else {
              console.error('[LectureUpload] Create record error:', createResult.error);
              await supabase.storage.from('user-files').remove([storagePath]);
              throw new Error(createResult.error || t('lecture.fileUploadFailed'));
            }
          } finally {
            clearTimeout(recordTimeout);
          }
        }

        if (uploadSucceeded) {
          setPendingFiles((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, status: 'done' as const, progress: 100 } : p))
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : t('lecture.toastUnexpectedError');
        setPendingFiles((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: 'error' as const, error: errMsg } : p))
        );
      }
    }

    setUploadingFiles(false);
    fetchNotes();
    onRefresh();
    const failedCount = pendingFiles.filter(f => f.status === 'error').length;
    if (failedCount === 0) {
      toast.success(t('lecture.toastFilesUploaded'));
    } else {
      toast.error(t('lecture.toastFilesPartialFailed', { failed: failedCount, total: pendingFiles.length }));
    }

    // Clear done files after a short delay
    setTimeout(() => {
      setPendingFiles((prev) => prev.filter((pf) => pf.status !== 'done'));
    }, 1500);
  };

  // ─── Export attendance to Excel ───
  const handleExportExcel = async () => {
    if (attendanceRecords.length === 0) { toast.error(t('lecture.toastNoAttendanceExport')); return; }
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const data = attendanceRecords.map((r) => ({
        [t('lecture.excelStudentName')]: r.student_name || t('lecture.student'),
        [t('lecture.excelEmail')]: r.student_email || '—',
        [t('lecture.excelCheckInTime')]: formatTime(r.checked_in_at, locale),
        [t('lecture.excelCheckInMethod')]: r.check_in_method === 'qr' ? t('lecture.excelMethodQR') : r.check_in_method === 'gps' ? t('lecture.excelMethodGPS') : r.check_in_method === 'manual' ? t('lecture.excelMethodManual') : '—',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, t('lecture.excelAttendanceSheet'));
      XLSX.writeFile(wb, `${t('lecture.excelAttendanceSheet')}_${lecture.title}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success(t('lecture.toastAttendanceExportSuccess'));
    } catch { toast.error(t('lecture.toastExportFailed')); }
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            // NO onClick on backdrop — prevents mobile synthetic click issues when
            // returning from native file picker or other system dialogs.
            // Close via: X button or Escape key.
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            <motion.div
              variants={modalVariants as any}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-background shadow-2xl pointer-events-auto"
              dir={dir}
            >
              {/* ─── Header ─── */}
              <div className="sticky top-0 z-10 bg-background border-b p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/50">
                      <BookOpen className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-foreground truncate">{lecture.title}</h2>
                      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground mt-0.5">
                        {lecture.lecture_date && (
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(lecture.lecture_date, locale)}</span>
                        )}
                        {extractLectureTime(lecture.description) && (
                          <span className="flex items-center gap-1 text-sky-800 dark:text-sky-200 font-medium"><Clock className="h-3 w-3" />{formatTimeArabic(extractLectureTime(lecture.description), t)}</span>
                        )}
                        {lecture.attendance_session && (
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTime(lecture.attendance_session.started_at, locale)}</span>
                        )}
                        {hasSession && (
                          <span className="flex items-center gap-1">
                            {isActive ? formatDuration(lecture.attendance_session!.started_at, undefined, t) : lecture.attendance_session?.ended_at ? formatDuration(lecture.attendance_session!.started_at, lecture.attendance_session!.ended_at, t) : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Status badge */}
                    {isActive ? (
                      <Badge className="bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800">
                        <span className="relative flex h-2 w-2 me-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600" />
                        </span>
                        {t('lecture.active')}
                      </Badge>
                    ) : hasSession ? (
                      <Badge variant="outline" className="text-muted-foreground">{t('lecture.finished')}</Badge>
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
                  <div className="rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 p-8 text-center">
                    <Users className="h-10 w-10 text-sky-400 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-foreground mb-1">{t('lecture.notOpenedYet')}</p>
                    <p className="text-xs text-muted-foreground">{t('lecture.pressStartToBegin')}</p>
                  </div>
                )}

                {/* ─── No session (student) ─── */}
                {!hasSession && role === 'student' && (
                  <div className="rounded-xl border border-dashed border-muted-300 bg-muted/30 p-6 text-center">
                    <Clock className="h-8 w-8 text-muted-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">{t('lecture.notOpenedByTeacher')}</p>
                  </div>
                )}

                {/* ─── Attendance Stats Cards ─── */}
                {hasSession && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border bg-sky-50/50 dark:bg-sky-950/30 p-3 text-center">
                      <UserCheck className="h-5 w-5 text-sky-700 dark:text-sky-300 mx-auto mb-1" />
                      <p className="text-xl font-bold text-sky-800 dark:text-sky-200">{presentCount}</p>
                      <p className="text-[10px] text-sky-700 dark:text-sky-300 font-medium">{t('lecture.present')}</p>
                    </div>
                    <div className="rounded-xl border bg-rose-50/50 dark:bg-rose-950/30 p-3 text-center">
                      <UserX className="h-5 w-5 text-rose-600 dark:text-rose-400 mx-auto mb-1" />
                      <p className="text-xl font-bold text-rose-700 dark:text-rose-300">{absentCount}</p>
                      <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">{t('lecture.absent')}</p>
                    </div>
                    <div className="rounded-xl border bg-amber-50/50 dark:bg-amber-950/30 p-3 text-center">
                      <Users className="h-5 w-5 text-amber-600 dark:text-amber-400 mx-auto mb-1" />
                      <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{totalStudents}</p>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">{t('lecture.total')}</p>
                    </div>
                    <div className="rounded-xl border bg-teal-50/50 dark:bg-teal-950/30 p-3 text-center">
                      <Percent className="h-5 w-5 text-teal-600 dark:text-teal-400 mx-auto mb-1" />
                      <p className="text-xl font-bold text-teal-700 dark:text-teal-300">{attendancePercent}%</p>
                      <p className="text-[10px] text-teal-600 dark:text-teal-400 font-medium">{t('lecture.attendanceRate')}</p>
                    </div>
                  </div>
                )}

                {/* ─── File Upload Section (Teacher only) ─── */}
                {role === 'teacher' && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Upload className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                        {t('lecture.lectureFiles')}
                      </h4>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFiles}
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 hover:bg-sky-100 disabled:opacity-60 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('lecture.addFiles')}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.zip,.mp4,.mp3,.wav"
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
                                pf.status === 'done' ? 'border-sky-200 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30' :
                                pf.status === 'error' ? (pf.errorCode === 'duplicate_name' ? 'border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/30' : 'border-rose-200 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/30') :
                                pf.status === 'uploading' ? 'border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/30' :
                                'border-border bg-muted/20'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <FileText className={`h-4 w-4 shrink-0 ${
                                  pf.status === 'done' ? 'text-sky-700 dark:text-sky-300' :
                                  pf.status === 'error' ? (pf.errorCode === 'duplicate_name' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400') :
                                  'text-muted-foreground'
                                }`} />
                                <span className="text-xs text-muted-foreground truncate flex-1">{pf.fileName}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{((pf.fileSize) / 1024).toFixed(0)} KB</span>
                                {(pf.status === 'pending' || pf.status === 'error') && (
                                  <button
                                    onClick={() => removePendingFile(idx)}
                                    disabled={uploadingFiles}
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                                {pf.status === 'done' && (
                                  <Check className="h-4 w-4 text-sky-700 dark:text-sky-300 shrink-0" />
                                )}
                              </div>
                              {/* Error message for failed files */}
                              {pf.status === 'error' && pf.error && (
                                <div className="flex items-start gap-1.5 mb-2 px-1">
                                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                                  <span className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">{pf.error}</span>
                                </div>
                              )}
                              {/* Rename field — visible for pending AND error files */}
                              {pf.status !== 'done' && (
                                <div className="flex items-center gap-2 mb-2">
                                  <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <input
                                    type="text"
                                    value={pf.customName}
                                    onChange={(e) => updatePendingFileName(idx, e.target.value)}
                                    placeholder={t('lecture.fileNamePlaceholder')}
                                    className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                                    dir={dir}
                                    disabled={pf.status === 'uploading'}
                                  />
                                  {pf.fileName.includes('.') && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      .{pf.fileName.split('.').pop()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {/* Retry button for failed files */}
                              {pf.status === 'error' && (
                                <button
                                  onClick={async () => {
                                    // Re-upload this single file — same as handleUploadFiles but for one file
                                    const token = await waitForSession(15000);
                                    if (!token) { toast.error(t('lecture.toastLoginRequired')); return; }

                                    setPendingFiles((prev) =>
                                      prev.map((p, j) => (j === idx ? { ...p, status: 'uploading' as const, progress: 0 } : p))
                                    );

                                    try {
                                      const fName = pf.fileName || 'unknown';
                                      const fType = pf.fileType || 'application/octet-stream';
                                      const fSize = pf.fileSize || 0;
                                      const origExt = fName.includes('.') ? '.' + fName.split('.').pop() : '';
                                      const dName = pf.customName.trim() ? pf.customName.trim() + origExt : fName;

                                      // Client-side pre-validation
                                      if (existingSubjectFileNames.includes(dName.toLowerCase())) {
                                        const dupMsg = t('lecture.duplicateFileName', { name: dName });
                                        setPendingFiles((prev) => prev.map((p, j) => (j === idx ? { ...p, status: 'error' as const, error: dupMsg, errorCode: 'duplicate_name' as const } : p)));
                                        toast.error(dupMsg);
                                        return;
                                      }

                                      let aBuffer: ArrayBuffer;
                                      if (pf.fileData && pf.fileData.byteLength > 0) {
                                        aBuffer = pf.fileData;
                                      } else {
                                        try { aBuffer = await pf.file.arrayBuffer(); }
                                        catch { throw new Error(t('lecture.fileReadError')); }
                                      }
                                      const uBlob = new Blob([aBuffer], { type: fType });

                                      let succeeded = false;
                                      const FILE_SIZE_LIMIT = 4 * 1024 * 1024;

                                      if (fSize <= FILE_SIZE_LIMIT) {
                                        try {
                                          const fd = new FormData();
                                          fd.append('file', uBlob, fName);
                                          fd.append('subjectId', subjectId);
                                          fd.append('uploadedBy', profile.id);
                                          fd.append('category', t('lecture.category'));
                                          fd.append('customName', pf.customName.trim());
                                          const ctrl = new AbortController();
                                          const tid = setTimeout(() => ctrl.abort(), 60000);
                                          const r = await fetch('/api/files/course-upload', {
                                            method: 'POST',
                                            headers: { 'Authorization': `Bearer ${token}` },
                                            body: fd,
                                            signal: ctrl.signal,
                                          });
                                          clearTimeout(tid);
                                          let res: { success: boolean; data?: Record<string, unknown>; error?: string; code?: string };
                                          if (r.ok) { try { res = await r.json(); } catch { res = { success: false, error: t('lecture.unexpectedServerError') }; } }
                                          else { const txt = await r.text(); try { res = JSON.parse(txt); } catch { res = { success: false, error: t('lecture.httpError', { status: r.status }) }; } }

                                          if (res.success && res.data) {
                                            const fD = res.data as { file_url: string; file_name: string };
                                            await supabase.from('lecture_notes').insert({ lecture_id: lecture.id, user_id: profile.id, content: `[FILE|||${fD.file_url}|||${fD.file_name}]`, visibility: 'public' });
                                            succeeded = true;
                                          } else if (res.code === 'DUPLICATE_NAME') {
                                            const dupMsg = t('lecture.duplicateFileName', { name: dName });
                                            setPendingFiles((prev) => prev.map((p, j) => (j === idx ? { ...p, status: 'error' as const, error: dupMsg, errorCode: 'duplicate_name' as const } : p)));
                                            toast.error(dupMsg);
                                            return;
                                          }
                                        } catch { /* server upload failed */ }
                                      }

                                      if (!succeeded) {
                                        const sUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
                                        const safeN = `${Date.now()}_${fName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                                        const sPath = `courses/${subjectId}/${safeN}`;
                                        let stOk = false;
                                        try {
                                          const { error: uErr } = await supabase.storage.from('user-files').upload(sPath, uBlob, { cacheControl: '3600', contentType: fType, upsert: false });
                                          if (!uErr) stOk = true;
                                        } catch { /* */ }
                                        if (stOk) {
                                          const fUrl = `${sUrl}/storage/v1/object/public/user-files/${sPath}`;
                                          const rH = await getCachedAuthHeaders();
                                          const rC = new AbortController();
                                          const rT = setTimeout(() => rC.abort(), 30000);
                                          try {
                                            const cR = await fetch('/api/files/course-upload', {
                                              method: 'POST', headers: rH,
                                              body: JSON.stringify({ subjectId, uploadedBy: profile.id, category: t('lecture.category'), customName: pf.customName.trim(), displayName: dName, fileUrl: fUrl, storagePath: sPath, fileSize: fSize, fileType: fType }),
                                              signal: rC.signal,
                                            });
                                            clearTimeout(rT);
                                            let cRes: { success: boolean; data?: Record<string, unknown>; error?: string; code?: string };
                                            if (cR.ok) { try { cRes = await cR.json(); } catch { cRes = { success: false, error: t('lecture.unexpectedServerError') }; } }
                                            else { const txt = await cR.text(); try { cRes = JSON.parse(txt); } catch { cRes = { success: false, error: t('lecture.httpError', { status: cR.status }) }; } }
                                            if (cR.ok && cRes.success && cRes.data) {
                                              const fD = cRes.data as { file_url: string; file_name: string };
                                              await supabase.from('lecture_notes').insert({ lecture_id: lecture.id, user_id: profile.id, content: `[FILE|||${fD.file_url}|||${fD.file_name}]`, visibility: 'public' });
                                              succeeded = true;
                                            } else if (cRes.code === 'DUPLICATE_NAME') {
                                              const dupMsg = t('lecture.duplicateFileName', { name: dName });
                                              setPendingFiles((prev) => prev.map((p, j) => (j === idx ? { ...p, status: 'error' as const, error: dupMsg, errorCode: 'duplicate_name' as const } : p)));
                                              await supabase.storage.from('user-files').remove([sPath]);
                                              toast.error(dupMsg);
                                              return;
                                            }
                                          } finally { clearTimeout(rT); }
                                        }
                                      }

                                      if (succeeded) {
                                        setPendingFiles((prev) => prev.map((p, j) => (j === idx ? { ...p, status: 'done' as const, progress: 100 } : p)));
                                        toast.success(t('lecture.toastFileUploaded', { name: dName }));
                                        fetchNotes();
                                        onRefresh();
                                        // Refresh existing file names after successful upload
                                        try {
                                          const { data } = await supabase.from('subject_files').select('file_name').eq('subject_id', subjectId);
                                          if (data) setExistingSubjectFileNames(data.map((f: { file_name: string }) => f.file_name.toLowerCase()));
                                        } catch { /* */ }
                                        // Clear done files after short delay
                                        setTimeout(() => {
                                          setPendingFiles((prev) => prev.filter((p) => p.status !== 'done'));
                                        }, 1500);
                                      } else {
                                        setPendingFiles((prev) => prev.map((p, j) => (j === idx ? { ...p, status: 'error' as const, error: t('lecture.fileUploadFailed') } : p)));
                                      }
                                    } catch (err) {
                                      const errMsg = err instanceof Error ? err.message : t('lecture.unknownError');
                                      setPendingFiles((prev) => prev.map((p, j) => (j === idx ? { ...p, status: 'error' as const, error: errMsg } : p)));
                                      toast.error(t('lecture.fileRetryFailed', { error: errMsg }));
                                    }
                                  }}
                                  disabled={uploadingFiles}
                                  className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-60 transition-colors"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  {t('lecture.retry')}
                                </button>
                              )}
                              {/* Progress bar */}
                              {(pf.status === 'uploading' || pf.status === 'done') && (
                                <div className="space-y-1">
                                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        pf.status === 'done' ? 'bg-sky-600' : 'bg-amber-500'
                                      }`}
                                      style={{ width: `${pf.progress}%` }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground">
                                      {pf.status === 'done' ? t('lecture.uploaded') : t('lecture.uploading')}
                                    </span>
                                    <span className={`text-[10px] font-medium ${
                                      pf.status === 'done' ? 'text-sky-700 dark:text-sky-300' : 'text-amber-600 dark:text-amber-400'
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
                              className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
                            >
                              {uploadingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              {uploadingFiles ? t('lecture.uploading') : t('lecture.uploadFiles')}
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
                                className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-3"
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <FileText className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                                  <span className="text-xs font-medium text-foreground">{note.author_name}</span>
                                  <span className="text-[10px] text-muted-foreground ms-auto">{formatTime(note.created_at, locale)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setPreviewFile({ url: fileRef.url, name: fileRef.name })}
                                    className="flex items-center gap-2 rounded-lg bg-sky-700/10 border border-sky-200 dark:border-sky-800 px-3 py-2 text-sm font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-100 transition-colors flex-1 text-end"
                                  >
                                    <Eye className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{fileRef.name}</span>
                                  </button>
                                  <button
                                    onClick={() => downloadWithCustomName(fileRef.url, fileRef.name)}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 hover:bg-sky-100 transition-colors"
                                    title={t('lecture.download')}
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
                        <p className="text-xs text-muted-foreground text-center py-3">{t('lecture.noFilesAttached')}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* ─── Student: File Links ─── */}
                {role === 'student' && fileNotes.length > 0 && (
                  <div className="rounded-xl border overflow-hidden">
                    <div className="flex items-center bg-muted/50 px-4 py-3 border-b">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <FileText className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                        {t('lecture.lectureFiles')}
                      </h4>
                    </div>
                    <div className="p-4 space-y-2">
                      {fileNotes.map((note) => {
                        const fileRef = parseFileNote(note.content);
                        if (!fileRef.isFile) return null;
                        return (
                          <div
                            key={note.id}
                            className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-3"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-sky-700 dark:text-sky-300 shrink-0" />
                              <button
                                onClick={() => setPreviewFile({ url: fileRef.url, name: fileRef.name })}
                                className="flex items-center gap-2 flex-1 text-end text-sm font-medium text-sky-800 dark:text-sky-200 hover:text-sky-900 transition-colors min-w-0"
                              >
                                <Eye className="h-4 w-4 shrink-0" />
                                <span className="truncate">{fileRef.name}</span>
                              </button>
                              <button
                                onClick={() => downloadWithCustomName(fileRef.url, fileRef.name)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 hover:bg-sky-100 transition-colors"
                                title={t('lecture.download')}
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
                      <StickyNote className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      {t('lecture.notes')}
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
                                ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                                : 'border-border text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            <Unlock className="h-3 w-3" />
                            {t('lecture.publicNote')}
                          </button>
                          <button
                            onClick={() => setNoteVisibility('private')}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                              noteVisibility === 'private'
                                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                                : 'border-border text-muted-foreground hover:bg-muted/50'
                            }`}
                          >
                            <Lock className="h-3 w-3" />
                            {t('lecture.privateNote')}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            placeholder={noteVisibility === 'public' ? t('lecture.notePlaceholderPublic') : t('lecture.notePlaceholderPrivate')}
                            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                            dir={dir}
                            disabled={savingNote}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !savingNote) handleAddNote(); }}
                          />
                          <button
                            onClick={handleAddNote}
                            disabled={savingNote || !newNote.trim()}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-60 transition-colors"
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
                      <p className="text-xs text-muted-foreground text-center py-3">{t('lecture.noNotesYet')}</p>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {textNotes.map((note) => (
                          <div
                            key={note.id}
                            className={`rounded-lg border p-3 ${
                              note.visibility === 'private' ? 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800' : 'bg-muted/30'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-foreground">{note.author_name}</span>
                              {note.visibility === 'private' && (
                                <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-[9px] py-0">
                                  <Lock className="h-2.5 w-2.5 ms-0.5" />{t('lecture.privateLabel')}
                                </Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground ms-auto">{formatTime(note.created_at, locale)}</span>
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
                        <Users className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                        {t('lecture.attendanceRecord')}
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-sky-800 dark:text-sky-200">{presentCount}/{totalStudents}</span>
                        {role === 'teacher' && (
                          <button
                            onClick={() => {
                              setManualSearchQuery('');
                              setManualDialogOpen(true);
                              fetchAbsentStudents();
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition-colors"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            {t('lecture.manualRegister')}
                          </button>
                        )}
                        {role === 'teacher' && (
                          <button
                            onClick={handleExportExcel}
                            disabled={exporting}
                            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60 transition-colors"
                          >
                            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            {t('lecture.downloadExcel')}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {loadingRecords ? (
                        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-sky-700 dark:text-sky-300" /></div>
                      ) : attendanceRecords.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">{t('lecture.noAttendanceYet')}</div>
                      ) : (
                        <div className="divide-y">
                          {attendanceRecords.map((record) => (
                            <div key={record.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <UserAvatar name={record.student_name || t('common.user')} avatarUrl={record.student_avatar} size="sm" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{record.student_name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{record.student_email}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {record.check_in_method && (
                                  <Badge variant="outline" className="text-[9px]">
                                    <MapPin className="h-2.5 w-2.5 me-0.5" />
                                    {record.check_in_method === 'qr' ? 'QR' : record.check_in_method === 'gps' ? 'GPS' : record.check_in_method === 'manual' ? t('lecture.manualMethod') : '—'}
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(record.checked_in_at, locale)}</span>
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
              dir={dir}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
                    <UserPlus className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{t('lecture.manualRegisterTitle')}</h3>
                    <p className="text-xs text-muted-foreground">{t('lecture.manualRegisterDesc')}</p>
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
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={manualSearchQuery}
                    onChange={(e) => setManualSearchQuery(e.target.value)}
                    placeholder={t('lecture.searchByName')}
                    className="w-full rounded-xl border bg-background pe-10 ps-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
                    dir={dir}
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
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-3">
                      <CheckCircle2 className="h-6 w-6 text-sky-700 dark:text-sky-300" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{t('lecture.allStudentsRegistered')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('lecture.noAbsentStudents')}</p>
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
                          className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-60 transition-colors shrink-0"
                        >
                          {manualRegistering === student.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                          {t('lecture.register')}
                        </button>
                      </div>
                    ))}
                    {absentStudents.filter((student) =>
                      !manualSearchQuery.trim() ||
                      student.name.toLowerCase().includes(manualSearchQuery.trim().toLowerCase()) ||
                      student.email.toLowerCase().includes(manualSearchQuery.trim().toLowerCase())
                    ).length === 0 && manualSearchQuery.trim() && (
                      <div className="py-8 text-center text-xs text-muted-foreground">{t('lecture.noSearchResults')}</div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t px-5 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {absentStudents.length > 0 ? t('lecture.absentCount', { count: absentStudents.length }) : ''}
                </span>
                <button
                  onClick={() => setManualDialogOpen(false)}
                  className="rounded-xl border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  {t('lecture.close')}
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
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="relative w-full max-w-4xl max-h-[90vh] rounded-2xl bg-background shadow-2xl overflow-hidden pointer-events-auto"
              dir={dir}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                    <FileText className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground truncate">{previewFile.name}</h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => downloadWithCustomName(previewFile.url, previewFile.name)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('lecture.download')}
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
                    <p className="text-sm text-muted-foreground mb-4">{t('lecture.cannotPreview')}</p>
                    <button
                      onClick={() => downloadWithCustomName(previewFile.url, previewFile.name)}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      {t('lecture.downloadFile')}
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
