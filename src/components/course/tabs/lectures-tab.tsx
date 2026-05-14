'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as QRCode from 'qrcode';
import { usePWALifecycle } from '@/hooks/use-pwa-lifecycle';
import {
  BookOpen,
  Plus,
  X,
  Loader2,
  Trash2,
  Play,
  StopCircle,
  QrCode,
  CheckCircle2,
  Clock,
  Calendar,
  Users,
  MapPin,
  ChevronDown,
  ChevronUp,
  StickyNote,
  Scan,
  Navigation,
  Pencil,
  Upload,
  FileText,
  Eye,
  Download,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { UserProfile, Subject, Lecture, AttendanceSession, LectureWithAttendance, LectureNote, LectureNoteWithAuthor } from '@/lib/types';
import LectureModal from '@/components/course/tabs/lecture-modal';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface LecturesTabProps {
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
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try { return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return dateStr; }
}
function formatTime(dateStr: string): string {
  try { return new Date(dateStr).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// -------------------------------------------------------
// Lecture time helpers (stored as metadata in description)
// Format: __LECTURE_TIME__:HH:MM__
// -------------------------------------------------------
const TIME_META_REGEX = /__LECTURE_TIME__:([0-9]{1,2}:[0-9]{2})__/;
const TIME_META_PREFIX = '__LECTURE_TIME__:';
const TIME_META_SUFFIX = '__';

function extractLectureTime(description: string | null | undefined): string {
  if (!description) return '';
  const match = description.match(TIME_META_REGEX);
  return match ? match[1] : '';
}
function cleanDescription(description: string | null | undefined): string {
  if (!description) return '';
  return description.replace(TIME_META_REGEX, '').trim();
}
function encodeDescription(rawDescription: string, time: string): string {
  const clean = rawDescription.trim();
  if (!time) return clean || '';
  const meta = `${TIME_META_PREFIX}${time}${TIME_META_SUFFIX}`;
  return clean ? `${clean}\n${meta}` : meta;
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

// GPS distance calculation (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const GPS_MAX_DISTANCE_METERS = 20; // GPS check-in: strict 20m limit

// Simple, reliable GPS position acquisition.
// Uses getCurrentPosition with enableHighAccuracy: true.
// This is the standard approach that works on mobile devices with GPS hardware.
// Key: maximumAge: 0 ensures no cached positions, enableHighAccuracy forces GPS usage.
function getCurrentGpsPosition(timeoutMs: number = 30000): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log('[GPS] Got position:', {
          lat: pos.coords.latitude.toFixed(6),
          lon: pos.coords.longitude.toFixed(6),
          accuracy: Math.round(pos.coords.accuracy),
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
        });
        resolve(pos);
      },
      (err) => {
        console.warn('[GPS] Error:', err.code, err.message);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}

// Get the best possible GPS position with one retry.
// First attempt: 30s timeout with enableHighAccuracy (uses real GPS on mobile).
// If accuracy is poor (> 100m, likely IP-based), retry once with a fresh request.
async function getBestGpsPosition(): Promise<GeolocationPosition | null> {
  // First attempt - give GPS 30 seconds to get a fix
  let pos = await getCurrentGpsPosition(30000);

  if (!pos) return null;

  // Reject null island (0,0)
  if (pos.coords.latitude === 0 && pos.coords.longitude === 0) {
    console.warn('[GPS] Got null island (0,0) - retrying...');
    pos = await getCurrentGpsPosition(20000);
    if (!pos || (pos.coords.latitude === 0 && pos.coords.longitude === 0)) {
      return null;
    }
  }

  // If accuracy is very poor (> 500m), it's definitely IP-based.
  // Retry once to see if GPS kicks in.
  if (pos.coords.accuracy > 500) {
    console.warn(`[GPS] Poor accuracy (${Math.round(pos.coords.accuracy)}m) - retrying for GPS...`);
    const retry = await getCurrentGpsPosition(20000);
    if (retry && retry.coords.accuracy < pos.coords.accuracy) {
      pos = retry;
    }
  }

  return pos;
}

// -------------------------------------------------------
// Pending file type for upload with rename + progress
// CRITICAL: fileData stores the pre-read ArrayBuffer for mobile PWA reliability.
// On mobile, File objects can become invalid after the native file picker closes
// (app goes to background → Android may terminate the WebView process).
// Storing ArrayBuffer ensures the data is always available for upload.
// -------------------------------------------------------
interface PendingFile {
  file: File;
  fileData: ArrayBuffer | null; // Pre-read data — critical for mobile PWA
  fileName: string;             // Stored separately in case File object is invalidated
  fileType: string;             // MIME type stored separately
  fileSize: number;             // File size stored separately
  customName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
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
    Object.entries(headers).forEach(([key, value]) => { xhr.setRequestHeader(key, value); });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { resolve({ success: false, error: 'حدث خطأ غير متوقع' }); }
    };
    xhr.onerror = () => { resolve({ success: false, error: 'حدث خطأ في الاتصال' }); };
    xhr.ontimeout = () => { resolve({ success: false, error: 'انتهت مهلة الرفع' }); };
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
  } catch { window.open(url, '_blank'); }
}

// Parse [FILE|||url|||name] format from note content
// Uses ||| as separator because URLs contain : which would break the old format
function parseFileNote(content: string): { isFile: boolean; url: string; name: string } {
  // New format: [FILE|||url|||name]
  const newMatch = content.match(/^\[FILE\|\|\|(.+?)\|\|\|(.+?)\]$/);
  if (newMatch) return { isFile: true, url: newMatch[1], name: newMatch[2] };
  // Legacy format: [FILE:url:name] - try to parse with greedy URL match
  const legacyMatch = content.match(/^\[FILE:(https?:\/\/.+):(.+?)\]$/);
  if (legacyMatch) return { isFile: true, url: legacyMatch[1], name: legacyMatch[2] };
  return { isFile: false, url: '', name: '' };
}

// -------------------------------------------------------
// QR Refresh Timer (counts down 10→1 inside QR modal)
// -------------------------------------------------------
function QrRefreshTimer() {
  const [seconds, setSeconds] = useState(10);
  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((prev) => (prev <= 1 ? 10 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{seconds}</span>;
}

// -------------------------------------------------------
// Lecture Timer (counts up from started_at in real-time)
// -------------------------------------------------------
function LectureTimer({ startedAt }: { startedAt: string }) {
  const startTimeMs = useRef(new Date(startedAt).getTime());
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));

  useEffect(() => {
    startTimeMs.current = new Date(startedAt).getTime();
    const msSinceStart = Date.now() - startTimeMs.current;
    const currentSecond = Math.max(0, Math.floor(msSinceStart / 1000));
    const msToNextSecond = 1000 - (msSinceStart % 1000);
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const timeoutId = setTimeout(() => {
      setElapsed(currentSecond + 1);
      intervalId = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    }, msToNextSecond);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [startedAt]);

  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  return (
    <span className="flex items-center gap-1 font-mono font-bold text-sky-800 tabular-nums" dir="ltr">
      <span className="relative flex h-2 w-2 ml-1">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600" />
      </span>
      {hours > 0 ? `${pad(hours)}:` : ''}{pad(minutes)}:{pad(seconds)}
    </span>
  );
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function LecturesTab({ profile, role, subjectId, subject, teacherName }: LecturesTabProps) {
  // ─── Data state ───
  const [lectures, setLectures] = useState<LectureWithAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalStudents, setTotalStudents] = useState(0);

  // ─── Create lecture modal ───
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [creating, setCreating] = useState(false);
  const [newPendingFiles, setNewPendingFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── PWA Lifecycle protection for create lecture modal ───
  // Prevents page reload while modal is open and saves/restores state
  // when the app goes to background (e.g., when opening native file picker)
  const { clearSavedState: clearCreateState } = usePWALifecycle({
    stateKey: `lecture-create-${subjectId}`,
    isBusy: createOpen,
    onSave: () => ({
      newTitle, newDesc, newDate, newTime,
      pendingFileNames: newPendingFiles.map(pf => ({
        customName: pf.customName,
        fileName: pf.fileName,
        fileSize: pf.fileSize,
        fileType: pf.fileType,
        // Note: We can't serialize ArrayBuffer to localStorage efficiently
        // The user will need to re-select files after a full process kill,
        // but all text fields will be preserved.
      })),
    }),
    onRestore: (state) => {
      try {
        if (state.newTitle) setNewTitle(state.newTitle as string);
        if (state.newDesc) setNewDesc(state.newDesc as string);
        if (state.newDate) setNewDate(state.newDate as string);
        if (state.newTime) setNewTime(state.newTime as string);
        // Show a toast that file selection was lost (if there were files)
        const fileNames = state.pendingFileNames as Array<{ fileName: string }> | undefined;
        if (fileNames && fileNames.length > 0) {
          // We can't restore File objects, so inform the user
          setTimeout(() => {
            toast.info(`تم استعادة بيانات المحاضرة. يرجى إعادة اختيار ${fileNames.length} ملف(ات)`);
          }, 500);
        }
        setCreateOpen(true);
      } catch (err) {
        console.warn('[LecturesTab] Failed to restore state:', err);
      }
    },
  });
  // ─── Student: file preview ───
  const [studentPreviewFile, setStudentPreviewFile] = useState<{ url: string; name: string } | null>(null);

  // ─── Edit lecture modal ───
  const [editOpen, setEditOpen] = useState(false);
  const [editingLecture, setEditingLecture] = useState<LectureWithAttendance | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // ─── Delete state ───
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetLecture, setDeleteTargetLecture] = useState<LectureWithAttendance | null>(null);

  // ─── Lecture detail modal ───
  const [selectedLecture, setSelectedLecture] = useState<LectureWithAttendance | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // ─── QR Code fullscreen modal ───
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrLecture, setQrLecture] = useState<LectureWithAttendance | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrAttendeeCount, setQrAttendeeCount] = useState(0);

  // ─── Attendance actions ───
  const [startingAttendance, setStartingAttendance] = useState<string | null>(null);
  const [stoppingAttendance, setStoppingAttendance] = useState<string | null>(null);

  // ─── Student: expanded lecture card ───
  const [expandedLectureId, setExpandedLectureId] = useState<string | null>(null);

  // ─── Student: QR scanner state ───
  const [scanningSessionId, setScanningSessionId] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [gpsCheckingIn, setGpsCheckingIn] = useState<string | null>(null);
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<unknown>(null);

  // ─── Student: public notes for expanded card ───
  const [expandedNotes, setExpandedNotes] = useState<LectureNoteWithAuthor[]>([]);

  // ─── Student: checked-in sessions ───
  const [checkedInSessions, setCheckedInSessions] = useState<Set<string>>(new Set());

  // -------------------------------------------------------
  // Fetch lectures with attendance info
  // -------------------------------------------------------
  const fetchLectures = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const [lecturesResult, sessionsResult, studentCountResult] = await Promise.all([
        supabase.from('lectures').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
        supabase.from('attendance_sessions').select('*').eq('subject_id', subjectId),
        supabase.from('subject_students').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId),
      ]);

      if (lecturesResult.error) { setLectures([]); if (isInitial) setLoading(false); return; }

      const lecturesList = ((lecturesResult.data as Lecture[]) || []).filter(l => !l.title.startsWith('__'));
      const sessionsList = (sessionsResult.data as AttendanceSession[]) || [];
      const sessionMap = new Map<string, AttendanceSession>();
      sessionsList.forEach((s) => sessionMap.set(s.lecture_id, s));

      setTotalStudents(studentCountResult.count || 0);

      // For students: check which sessions they've already checked into
      let checkedInSet = new Set<string>();
      if (role === 'student' && sessionsList.length > 0) {
        const sessionIds = sessionsList.map((s) => s.id);
        const { data: myRecords } = await supabase
          .from('attendance_records')
          .select('session_id')
          .eq('student_id', profile.id)
          .in('session_id', sessionIds);
        if (myRecords) {
          checkedInSet = new Set((myRecords as { session_id: string }[]).map((r) => r.session_id));
        }
      }
      setCheckedInSessions(checkedInSet);

      // Batch-fetch attendance counts using a single grouped query instead of N+1
      const enriched: LectureWithAttendance[] = [];
      if (sessionsList.length > 0) {
        const sessionIds = sessionsList.map((s) => s.id);
        // Single query to get counts grouped by session_id
        const { data: recordsData } = await supabase
          .from('attendance_records')
          .select('session_id')
          .in('session_id', sessionIds);

        const countMap = new Map<string, number>();
        if (recordsData) {
          (recordsData as { session_id: string }[]).forEach((r) => {
            countMap.set(r.session_id, (countMap.get(r.session_id) || 0) + 1);
          });
        }

        for (const lecture of lecturesList) {
          const session = sessionMap.get(lecture.id);
          enriched.push({
            ...lecture,
            attendance_session: session || null,
            attendance_count: session ? countMap.get(session.id) || 0 : 0,
            total_students: studentCountResult.count || 0,
            teacher_name: teacherName,
            student_checked_in: session ? checkedInSet.has(session.id) : false,
          });
        }
      } else {
        for (const lecture of lecturesList) {
          enriched.push({
            ...lecture,
            attendance_session: null,
            attendance_count: 0,
            total_students: studentCountResult.count || 0,
            teacher_name: teacherName,
            student_checked_in: false,
          });
        }
      }
      setLectures(enriched);
    } catch (err) {
      console.error('Fetch lectures error:', err);
      setLectures([]);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [subjectId, profile.id, role, teacherName]);

  // -------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------
  useEffect(() => { fetchLectures(true); }, [fetchLectures]);

  // -------------------------------------------------------
  // Real-time subscription for attendance records (instant count updates)
  // -------------------------------------------------------
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchLectures(), 2000);
    };

    const channel = supabase
      .channel(`lectures-att-${subjectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_sessions', filter: `subject_id=eq.${subjectId}` }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lectures', filter: `subject_id=eq.${subjectId}` }, debouncedFetch)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_records' },
        (payload) => {
          const newRecord = payload.new as { session_id: string; student_id: string };
          // Instantly update attendance count on the lecture card
          setLectures((prev) =>
            prev.map((l) => {
              if (l.attendance_session?.id === newRecord.session_id) {
                return { ...l, attendance_count: (l.attendance_count || 0) + 1 };
              }
              return l;
            })
          );
          // If the current student checked in, update their status
          if (role === 'student' && newRecord.student_id === profile.id) {
            setCheckedInSessions((prev) => {
              const next = new Set(prev);
              next.add(newRecord.session_id);
              return next;
            });
            setLectures((prev) =>
              prev.map((l) => {
                if (l.attendance_session?.id === newRecord.session_id) {
                  return { ...l, student_checked_in: true };
                }
                return l;
              })
            );
          }
          // Also update the QR modal attendee count if open
          if (qrModalOpen && qrLecture?.attendance_session?.id === newRecord.session_id) {
            setQrAttendeeCount((prev) => prev + 1);
          }
          // Debounced full refresh for consistency
          debouncedFetch();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'attendance_records' },
        (payload) => {
          const deletedRecord = payload.old as { session_id: string; student_id: string };
          if (!deletedRecord?.session_id) { debouncedFetch(); return; }
          // Instantly update attendance count on the lecture card
          setLectures((prev) =>
            prev.map((l) => {
              if (l.attendance_session?.id === deletedRecord.session_id) {
                return { ...l, attendance_count: Math.max(0, (l.attendance_count || 0) - 1) };
              }
              return l;
            })
          );
          // If the current student was removed, update their status
          if (role === 'student' && deletedRecord.student_id === profile.id) {
            setCheckedInSessions((prev) => {
              const next = new Set(prev);
              next.delete(deletedRecord.session_id);
              return next;
            });
            setLectures((prev) =>
              prev.map((l) => {
                if (l.attendance_session?.id === deletedRecord.session_id) {
                  return { ...l, student_checked_in: false };
                }
                return l;
              })
            );
          }
          // Also update the QR modal attendee count if open
          if (qrModalOpen && qrLecture?.attendance_session?.id === deletedRecord.session_id) {
            setQrAttendeeCount((prev) => Math.max(0, prev - 1));
          }
          // Debounced full refresh for consistency
          debouncedFetch();
        }
      )
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [subjectId, fetchLectures, role, profile.id, qrModalOpen, qrLecture]);

  // -------------------------------------------------------
  // Create lecture
  // -------------------------------------------------------
  const handleCreateLecture = async () => {
    const title = newTitle.trim();
    if (!title) { toast.error('يرجى إدخال عنوان المحاضرة'); return; }
    setCreating(true);
    try {
      // 1. Create the lecture
      const { data: lectureData, error } = await supabase
        .from('lectures')
        .insert({ subject_id: subjectId, title, description: encodeDescription(newDesc.trim(), newTime) || null, lecture_date: newDate || null })
        .select('id')
        .single();

      if (error) { toast.error('حدث خطأ أثناء إنشاء المحاضرة'); return; }

      const lectureId = (lectureData as { id: string }).id;

      // 2. Upload files with progress and create lecture_notes references
      if (newPendingFiles.length > 0) {
        // FIX: Use waitForSession() instead of getSession() for mobile PWA reliability.
        // getSession() can return null on mobile when the session hasn't hydrated yet,
        // causing all file uploads to fail with 401 Unauthorized.
        const { waitForSession } = await import('@/lib/client-auth');
        const token = await waitForSession(15000);

        for (let i = 0; i < newPendingFiles.length; i++) {
          const pf = newPendingFiles[i];
          try {
            setNewPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, status: 'uploading' as const, progress: 0 } : p)));

            // CRITICAL FIX: Use pre-read ArrayBuffer data instead of File object.
            // On mobile PWA, File objects can become invalid after the app goes to background.
            // Using a Blob created from pre-read ArrayBuffer ensures the data is always available.
            let uploadBlob: Blob;
            if (pf.fileData && pf.fileData.byteLength > 0) {
              uploadBlob = new Blob([pf.fileData], { type: pf.fileType || 'application/octet-stream' });
            } else {
              // Fallback: try to read from File object (might fail on mobile PWA)
              try {
                const arrayBuffer = await pf.file.arrayBuffer();
                uploadBlob = new Blob([arrayBuffer], { type: pf.file.type || 'application/octet-stream' });
              } catch {
                // Last resort: use File object directly
                uploadBlob = pf.file;
              }
            }

            const formData = new FormData();
            formData.append('file', uploadBlob, pf.fileName || pf.file.name);
            formData.append('subjectId', subjectId);
            formData.append('uploadedBy', profile.id);
            formData.append('category', 'محاضرات');
            formData.append('customName', pf.customName.trim());

            const result = await uploadFileWithProgress(
              '/api/files/course-upload',
              formData,
              { Authorization: `Bearer ${token}` },
              (percent) => {
                setNewPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, progress: percent } : p)));
              }
            );

            if (result.success && result.data) {
              const fileData = result.data as { file_url: string; file_name: string };
              await supabase.from('lecture_notes').insert({
                lecture_id: lectureId,
                user_id: profile.id,
                content: `[FILE|||${fileData.file_url}|||${fileData.file_name}]`,
                visibility: 'public',
              });
              setNewPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, status: 'done' as const, progress: 100 } : p)));
            } else {
              setNewPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, status: 'error' as const } : p)));
            }
          } catch (err) {
            console.error('File upload error:', err);
            setNewPendingFiles((prev) => prev.map((p, idx) => (idx === i ? { ...p, status: 'error' as const } : p)));
          }
        }
      }

      toast.success('تم إنشاء المحاضرة بنجاح');

      // Notify all enrolled students about the new lecture (non-blocking)
      // Fire-and-forget: don't block the UI while push notifications are being sent
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'lecture_created',
          subjectId,
          lectureTitle: title,
          teacherName: profile.name,
          lectureDate: newDate || null,
          lectureTime: newTime || null,
        }),
      }).catch(() => {
        // Non-critical: don't block lecture creation if notification fails
      });

      setCreateOpen(false);
      setNewTitle('');
      setNewDesc('');
      setNewDate('');
      setNewTime('');
      setNewPendingFiles([]);
      clearCreateState(); // Clear PWA saved state after successful creation
      fetchLectures();
    } catch { toast.error('حدث خطأ غير متوقع'); }
    finally { setCreating(false); }
  };

  // -------------------------------------------------------
  // Edit lecture
  // -------------------------------------------------------
  const handleOpenEdit = (lecture: LectureWithAttendance, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingLecture(lecture);
    setEditTitle(lecture.title);
    setEditDesc(cleanDescription(lecture.description));
    setEditDate(lecture.lecture_date || '');
    setEditTime(extractLectureTime(lecture.description));
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingLecture) return;
    const title = editTitle.trim();
    if (!title) { toast.error('يرجى إدخال عنوان المحاضرة'); return; }
    setSavingEdit(true);
    try {
      const { error } = await supabase.from('lectures').update({
        title,
        description: encodeDescription(editDesc.trim(), editTime) || null,
        lecture_date: editDate || null,
      }).eq('id', editingLecture.id);
      if (error) toast.error('حدث خطأ أثناء تعديل المحاضرة');
      else { toast.success('تم تعديل المحاضرة بنجاح'); setEditOpen(false); setEditingLecture(null); fetchLectures(); }
    } catch { toast.error('حدث خطأ غير متوقع'); }
    finally { setSavingEdit(false); }
  };

  // -------------------------------------------------------
  // Delete lecture: open confirmation modal
  // -------------------------------------------------------
  const handleDeleteClick = (lecture: LectureWithAttendance, e: React.MouseEvent) => {
    e.stopPropagation();
    if (lecture.attendance_session?.status === 'active') {
      toast.error('لا يمكن حذف محاضرة نشطة');
      return;
    }
    setDeleteTargetLecture(lecture);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetLecture) return;
    const lectureId = deleteTargetLecture.id;
    setDeletingId(lectureId);
    setDeleteConfirmOpen(false);
    try {
      const { error } = await supabase.from('lectures').delete().eq('id', lectureId);
      if (error) toast.error('حدث خطأ أثناء حذف المحاضرة');
      else { toast.success('تم حذف المحاضرة بنجاح'); fetchLectures(); }
    } catch { toast.error('حدث خطأ غير متوقع'); }
    finally { setDeletingId(null); setDeleteTargetLecture(null); }
  };

  // -------------------------------------------------------
  // Start attendance (teacher, from card)
  // -------------------------------------------------------
  const handleStartAttendance = async (lectureId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (startingAttendance) return;
    setStartingAttendance(lectureId);
    try {
      // Get teacher GPS location
      let location: { lat: number; lon: number; accuracy: number } | null = null;
      if (navigator.geolocation) {
        try {
          const pos = await getBestGpsPosition();
          if (pos && !(pos.coords.latitude === 0 && pos.coords.longitude === 0)) {
            location = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
            // Warn if accuracy is poor but still save the location
            // Both teacher and student need to use similar location methods
            if (pos.coords.accuracy > 100) {
              toast(`تنبيه: دقة الموقع ضعيفة (${Math.round(pos.coords.accuracy)} متر). يُفضل تفعيل GPS للحصول على دقة أفضل.`, { duration: 6000 });
            }
          } else if (!pos) {
            toast.error('تعذر تحديد موقعك. يرجى تفعيل خدمات الموقع والمحاولة مرة أخرى.', { duration: 6000 });
          }
        } catch { /* continue without location */ }
      }

      const { data: existing } = await supabase.from('attendance_sessions').select('id').eq('teacher_id', profile.id).eq('status', 'active').maybeSingle();
      if (existing) { toast.error('لديك جلسة حضور نشطة بالفعل'); return; }

      const insertData: Record<string, unknown> = {
        lecture_id: lectureId,
        teacher_id: profile.id,
        subject_id: subjectId,
        status: 'active',
      };
      if (location) {
        insertData.teacher_latitude = location.lat;
        insertData.teacher_longitude = location.lon;
      }

      const { error } = await supabase.from('attendance_sessions').insert(insertData);
      if (error) {
        if (location && (error.message?.includes('teacher_latitude') || error.code === '42703')) {
          const { error: retryError } = await supabase.from('attendance_sessions').insert({
            lecture_id: lectureId, teacher_id: profile.id, subject_id: subjectId, status: 'active',
          });
          if (retryError) {
            if (retryError.code === '23505') toast.error('لديك جلسة حضور نشطة بالفعل');
            else toast.error('حدث خطأ أثناء بدء الحضور');
            return;
          }
        } else if (error.code === '23505') {
          toast.error('لديك جلسة حضور نشطة بالفعل'); return;
        } else {
          toast.error('حدث خطأ أثناء بدء الحضور'); return;
        }
      }

      toast.success(location ? `تم بدء تسجيل الحضور مع تحديد الموقع (دقة ${Math.round(location.accuracy)}م)` : 'تم بدء تسجيل الحضور');
      // Send notification to all students in the subject
      try {
        const lectureTitle = lectures.find((l) => l.id === lectureId)?.title || '';
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'attendance_started',
            subjectId,
            subjectName: subject.name,
            lectureTitle,
            teacherName: profile.name,
          }),
        });
      } catch { /* notification failure is non-critical */ }
      fetchLectures();
    } catch { toast.error('حدث خطأ غير متوقع'); }
    finally { setStartingAttendance(null); }
  };

  // -------------------------------------------------------
  // Stop attendance (teacher, from card)
  // -------------------------------------------------------
  const handleStopAttendance = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStoppingAttendance(sessionId);
    try {
      const { error } = await supabase.from('attendance_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', sessionId);
      if (error) {
        toast.error('حدث خطأ أثناء إنهاء الحضور');
      } else {
        toast.success('تم إنهاء تسجيل الحضور');

        // Optimistic update: immediately reflect the closed session in local state
        // without waiting for fetchLectures() to complete
        setLectures(prev => prev.map(l => {
          if (l.attendance_session?.id === sessionId) {
            return {
              ...l,
              attendance_session: { ...l.attendance_session, status: 'ended', ended_at: new Date().toISOString() }
            };
          }
          return l;
        }));

        // Clear the stopping state immediately after optimistic update
        setStoppingAttendance(null);

        // Background refresh for consistency (don't block UI)
        fetchLectures();
        return; // Exit early since we already cleared stoppingAttendance
      }
    } catch { toast.error('حدث خطأ غير متوقع'); }
    setStoppingAttendance(null);
  };

  // ─── QR Code rotation state ───
  const [qrRotationIndex, setQrRotationIndex] = useState(0);

  // -------------------------------------------------------
  // QR Code modal
  // -------------------------------------------------------
  const generateQrData = (sessionId: string, rotationIndex: number) => {
    // Include rotation index so QR changes every cycle
    return `${sessionId}::${rotationIndex}::${Math.floor(Date.now() / 10000)}`;
  };

  const handleOpenQrModal = async (lecture: LectureWithAttendance, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!lecture.attendance_session || lecture.attendance_session.status !== 'active') {
      toast.error('المحاضرة غير نشطة');
      return;
    }
    setQrLecture(lecture);
    setQrModalOpen(true);
    const newIndex = Math.floor(Date.now() / 10000);
    setQrRotationIndex(newIndex);
    // Generate QR
    try {
      const url = await QRCode.toDataURL(generateQrData(lecture.attendance_session.id, newIndex), {
        width: 400,
        margin: 3,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrDataUrl(url);
    } catch { setQrDataUrl(''); }
    // Fetch attendee count
    try {
      const { count } = await supabase.from('attendance_records').select('*', { count: 'exact', head: true }).eq('session_id', lecture.attendance_session.id);
      setQrAttendeeCount(count || 0);
    } catch { setQrAttendeeCount(0); }
  };

  // QR Code auto-refresh every 10 seconds
  useEffect(() => {
    if (!qrModalOpen || !qrLecture?.attendance_session) return;
    const sessionId = qrLecture.attendance_session.id;
    const interval = setInterval(async () => {
      const newIndex = Math.floor(Date.now() / 10000);
      setQrRotationIndex(newIndex);
      try {
        const url = await QRCode.toDataURL(generateQrData(sessionId, newIndex), {
          width: 400,
          margin: 3,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrDataUrl(url);
      } catch { /* keep old QR */ }
    }, 10000);
    return () => { clearInterval(interval); };
  }, [qrModalOpen, qrLecture]);

  // Real-time update for QR modal attendee count
  useEffect(() => {
    if (!qrModalOpen || !qrLecture?.attendance_session) return;
    const sessionId = qrLecture.attendance_session.id;
    const channel = supabase
      .channel(`qr-att-${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_records', filter: `session_id=eq.${sessionId}` }, async () => {
        const { count } = await supabase.from('attendance_records').select('*', { count: 'exact', head: true }).eq('session_id', sessionId);
        setQrAttendeeCount(count || 0);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qrModalOpen, qrLecture]);

  // -------------------------------------------------------
  // Open lecture detail modal (teacher only) / toggle notes (student)
  // -------------------------------------------------------
  const handleLectureClick = (lecture: LectureWithAttendance) => {
    if (role === 'teacher') {
      setSelectedLecture(lecture);
      setModalOpen(true);
    } else {
      // For students: clicking the card expands/collapses notes
      handleExpandLecture(lecture.id);
    }
  };

  // -------------------------------------------------------
  // Student: Check-in via QR scan
  // -------------------------------------------------------
  const handleStartScan = async (sessionId: string) => {
    setScanningSessionId(sessionId);
    // Modal will render the scanner element; start scanning after a short delay
    setTimeout(async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const scannerId = 'qr-reader-modal';

        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText: string) => {
            // Accept QR if it starts with the session ID (handles rotated QR codes)
            if (decodedText.startsWith(sessionId)) {
              await html5QrCode.stop();
              html5QrCodeRef.current = null;
              setScanningSessionId(null);
              await performCheckIn(sessionId, 'qr');
            } else {
              toast.error('رمز QR غير صالح لهذه المحاضرة');
            }
          },
          () => { /* ignore scan failures */ }
        );
      } catch (err) {
        console.error('QR scan error:', err);
        setScanningSessionId(null);
        toast.error('تعذر تشغيل الكاميرا. حاول استخدام GPS بدلاً من ذلك.');
      }
    }, 300);
  };

  const handleStopScan = async () => {
    try {
      const scanner = html5QrCodeRef.current as { stop: () => Promise<void> } | null;
      if (scanner) {
        await scanner.stop();
        html5QrCodeRef.current = null;
      }
    } catch { /* ignore */ }
    setScanningSessionId(null);
  };

  // -------------------------------------------------------
  // Escape key handler for modals
  // Since we removed onClick from backdrops (to prevent mobile file picker
  // synthetic clicks from closing modals), we provide Escape as an alternative
  // close method. This is standard UX for modals.
  // -------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close modals in priority order (top-most first)
      if (studentPreviewFile) { setStudentPreviewFile(null); return; }
      if (deleteConfirmOpen) { setDeleteConfirmOpen(false); setDeleteTargetLecture(null); return; }
      if (scanningSessionId) { handleStopScan(); return; }
      if (qrModalOpen) { setQrModalOpen(false); setQrLecture(null); setQrDataUrl(''); return; }
      if (modalOpen) { setModalOpen(false); setSelectedLecture(null); return; }
      if (editOpen) { if (!savingEdit) setEditOpen(false); return; }
      if (createOpen) {
        if (creating) {
          if (confirm('هل تريد إلغاء إنشاء المحاضرة؟')) {
            setCreating(false);
            setCreateOpen(false);
            setNewTitle('');
            setNewDesc('');
            setNewDate('');
            setNewTime('');
            setNewPendingFiles([]);
          }
        } else {
          setCreateOpen(false);
        }
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [createOpen, creating, editOpen, savingEdit, modalOpen, qrModalOpen, deleteConfirmOpen, scanningSessionId, studentPreviewFile, handleStopScan]);

  // -------------------------------------------------------
  // Student: Perform check-in with GPS verification
  // -------------------------------------------------------
  const performCheckIn = async (sessionId: string, method: 'qr' | 'gps') => {
    if (checkingIn) return;
    setCheckingIn(true);
    try {
      let studentLat: number | null = null;
      let studentLon: number | null = null;
      let studentAccuracy: number | null = null;

      if (navigator.geolocation) {
        try {
          const pos = await getBestGpsPosition();
          if (pos) {
            // Validate coordinates - reject null island (0,0)
            if (!(pos.coords.latitude === 0 && pos.coords.longitude === 0)) {
              studentLat = pos.coords.latitude;
              studentLon = pos.coords.longitude;
              studentAccuracy = pos.coords.accuracy;
            }
          }
        } catch { /* continue without location */ }
      }

      // For GPS method: location is required
      if (method === 'gps' && !studentLat) {
        toast.error('تعذر تحديد موقعك. يرجى تفعيل GPS وحاول مرة أخرى.');
        setCheckingIn(false);
        return;
      }

      const { data: session } = await supabase.from('attendance_sessions').select('*').eq('id', sessionId).single();

      if (session && studentLat && studentLon) {
        const teacherLat = (session as AttendanceSession).teacher_latitude;
        const teacherLon = (session as AttendanceSession).teacher_longitude;

        if (teacherLat && teacherLon) {
          const distance = calculateDistance(teacherLat, teacherLon, studentLat, studentLon);
          
          // Log GPS data for debugging
          console.log('[GPS Check]', {
            method,
            teacher: { lat: teacherLat.toFixed(6), lon: teacherLon.toFixed(6) },
            student: { lat: studentLat.toFixed(6), lon: studentLon.toFixed(6), accuracy: studentAccuracy ? Math.round(studentAccuracy) : 'N/A' },
            distance: Math.round(distance),
          });
          
          // Detect GPS/IP mismatch: distance > 1km means one device used real GPS and the other used IP/cell tower location
          // This is a common issue when GPS is weak or disabled on one device
          const isLocationMismatch = distance > 1000;
          
          if (method === 'qr') {
            // QR check-in: The QR scan itself proves physical proximity (student scanned teacher's screen).
            // GPS verification is informational only — a GPS/IP mismatch should NOT block QR check-in.
            if (isLocationMismatch) {
              console.warn('[GPS] QR check-in with GPS mismatch (distance:', Math.round(distance), 'm). QR scan proves proximity, allowing check-in.');
              toast(`تم التحقق من قربك عبر مسح QR. الموقع GPS غير متطابق (${Math.round(distance)} متر) — يرجى تفعيل GPS لتحسين الدقة.`, { duration: 6000 });
              // Don't return — allow QR check-in to proceed
            } else if (distance > GPS_MAX_DISTANCE_METERS) {
              // Small distance mismatch (20m-1km): likely GPS inaccuracy, not IP mismatch
              // For QR, still allow — the scan proves proximity
              console.warn('[GPS] QR check-in, distance over GPS threshold:', Math.round(distance), 'm. Allowing via QR proof.');
            }
            // For QR: always proceed regardless of GPS distance
          } else {
            // GPS-only check-in: GPS is the ONLY proof of proximity — must be accurate
            if (isLocationMismatch) {
              console.error('[GPS] GPS check-in mismatch. Teacher:', teacherLat.toFixed(6), teacherLon.toFixed(6), 'Student:', studentLat.toFixed(6), studentLon.toFixed(6));
              toast.error(`المسافة كبيرة جداً (${Math.round(distance)} متر). يبدو أن GPS غير مُفعّل على جهازك ويتم استخدام الموقع التقريبي. يرجى تفعيل GPS من إعدادات الجهاز أو استخدام مسح QR بدلاً من ذلك.`, { duration: 10000 });
              return;
            }
            
            if (distance > GPS_MAX_DISTANCE_METERS) {
              console.warn('[GPS] GPS check-in distance too far:', Math.round(distance), 'meters');
              if (studentAccuracy && studentAccuracy > 100) {
                toast.error(`دقة الموقع ضعيفة (${Math.round(studentAccuracy)} متر) والمسافة ${Math.round(distance)} متر. يرجى تفعيل GPS أو استخدام مسح QR.`, { duration: 8000 });
              } else {
                toast.error(`أنت بعيد عن المعلم بمسافة ${Math.round(distance)} متر. يجب أن تكون ضمن ${GPS_MAX_DISTANCE_METERS} متر.`, { duration: 6000 });
              }
              return;
            }
          }
        }
      }

      const insertData: Record<string, unknown> = {
        session_id: sessionId,
        student_id: profile.id,
        check_in_method: method,
      };

      if (studentLat) insertData.student_latitude = studentLat;
      if (studentLon) insertData.student_longitude = studentLon;

      const { error } = await supabase.from('attendance_records').insert(insertData);

      if (error) {
        if (error.code === '23505') {
          toast.error('تم تسجيل حضورك بالفعل');
        } else if (error.message?.includes('check_in_method') || error.code === '42703') {
          const { error: retryError } = await supabase.from('attendance_records').insert({
            session_id: sessionId,
            student_id: profile.id,
          });
          if (retryError) {
            if (retryError.code === '23505') toast.error('تم تسجيل حضورك بالفعل');
            else toast.error('حدث خطأ أثناء تسجيل الحضور');
          } else {
            toast.success('تم تسجيل الحضور بنجاح');
          }
        } else {
          toast.error('حدث خطأ أثناء تسجيل الحضور');
        }
      } else {
        toast.success('تم تسجيل الحضور بنجاح ✓');
      }
      fetchLectures();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setCheckingIn(false);
    }
  };

  // -------------------------------------------------------
  // Student: GPS-only check-in
  // -------------------------------------------------------
  const handleGpsCheckIn = async (sessionId: string) => {
    setGpsCheckingIn(sessionId);
    try {
      await performCheckIn(sessionId, 'gps');
    } finally {
      setGpsCheckingIn(null);
    }
  };

  // -------------------------------------------------------
  // Student: Expand lecture card to show public notes
  // -------------------------------------------------------
  const handleExpandLecture = async (lectureId: string) => {
    if (expandedLectureId === lectureId) {
      setExpandedLectureId(null);
      setExpandedNotes([]);
      return;
    }
    setExpandedLectureId(lectureId);
    await fetchExpandedNotes(lectureId);
  };

  // Fetch public notes for the expanded lecture (student view)
  const fetchExpandedNotes = useCallback(async (lectureId: string) => {
    try {
      const { data, error } = await supabase.from('lecture_notes').select('*').eq('lecture_id', lectureId).eq('visibility', 'public').order('created_at', { ascending: false });
      if (error) { setExpandedNotes([]); return; }
      const notesList = (data as LectureNote[]) || [];
      if (notesList.length > 0) {
        const authorIds = [...new Set(notesList.map((n) => n.user_id))];
        // Use server-side API to fetch author profiles (bypasses RLS)
        let authorMap = new Map<string, { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }>();
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
            authorMap = new Map((users || []).map((a: { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }) => [a.id, a]));
          }
        } catch {}
        setExpandedNotes(notesList.map((n) => {
          const author = authorMap.get(n.user_id);
          return { ...n, author_name: author ? formatNameWithTitle(author.name, author.role, author.title_id, author.gender) : 'معلم' };
        }) as LectureNoteWithAuthor[]);
      } else {
        setExpandedNotes([]);
      }
    } catch { setExpandedNotes([]); }
  }, []);

  // Real-time subscription for student expanded notes
  useEffect(() => {
    if (role !== 'student' || !expandedLectureId) return;

    const channel = supabase
      .channel(`student-notes-${expandedLectureId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lecture_notes', filter: `lecture_id=eq.${expandedLectureId}` },
        async (payload) => {
          const newNote = payload.new as LectureNote;
          // Only show public notes
          if (newNote.visibility !== 'public') return;
          // Fetch author info for the new note through server-side API (bypasses RLS)
          let authorName = 'معلم';
          try {
            const { data: { session: sess } } = await supabase.auth.getSession();
            const res = await fetch('/api/users/batch', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(sess?.access_token ? { 'Authorization': `Bearer ${sess.access_token}` } : {}),
              },
              body: JSON.stringify({ userIds: [newNote.user_id] }),
            });
            if (res.ok) {
              const { users } = await res.json();
              const author = users?.[0];
              if (author) authorName = formatNameWithTitle(author.name, author.role, author.title_id, author.gender);
            }
          } catch {}
          const enriched: LectureNoteWithAuthor = { ...newNote, author_name: authorName };
          setExpandedNotes((prev) => {
            // Prevent duplicates
            if (prev.some((n) => n.id === newNote.id)) return prev;
            // Insert at the beginning (newest first)
            return [enriched, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'lecture_notes', filter: `lecture_id=eq.${expandedLectureId}` },
        (payload) => {
          const deletedId = (payload.old as { id: string })?.id;
          if (!deletedId) return;
          setExpandedNotes((prev) => prev.filter((n) => n.id !== deletedId));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, expandedLectureId]);

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground">المحاضرات</h3>
          <p className="text-muted-foreground text-sm mt-1">{lectures.length} محاضرة</p>
        </div>
        {role === 'teacher' && (
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sky-800 active:scale-[0.97]">
            <Plus className="h-4 w-4" />
            محاضرة جديدة
          </button>
        )}
      </motion.div>

      {/* Lectures list */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-sky-700" /></div>
      ) : lectures.length === 0 ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/30 py-20">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-100 mb-5">
            <BookOpen className="h-10 w-10 text-sky-700" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1">لا توجد محاضرات بعد</p>
          <p className="text-sm text-muted-foreground">{role === 'teacher' ? 'ابدأ بإضافة محاضرة جديدة' : 'لم يتم إضافة محاضرات بعد'}</p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="space-y-4">
          {lectures.map((lecture) => {
            const isActive = lecture.attendance_session?.status === 'active';
            const hasSession = !!lecture.attendance_session;
            const isCheckedIn = lecture.student_checked_in;
            const isExpanded = expandedLectureId === lecture.id;
            const canCheckIn = role === 'student' && isActive && !isCheckedIn;

            return (
              <motion.div key={lecture.id} variants={itemVariants}>
                <div
                  className={`group relative rounded-2xl border bg-card shadow-sm hover:shadow-md transition-all overflow-hidden ${
                    isActive ? 'ring-2 ring-sky-600/30' : ''
                  } cursor-pointer`}
                  onClick={() => handleLectureClick(lecture)}
                >
                  {/* Active top bar */}
                  {isActive && <div className="h-1.5 bg-sky-600" />}

                  <div className="p-5">
                    {/* ─── Teacher Card Layout ─── */}
                    {role === 'teacher' ? (
                      <>
                        {/* Row 1: Title + Status + Action Buttons */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-sky-100' : 'bg-muted'}`}>
                            <BookOpen className={`h-5 w-5 ${isActive ? 'text-sky-700' : 'text-muted-foreground'}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-foreground truncate">{lecture.title}</h4>
                              {isActive ? (
                                <Badge className="bg-sky-100 text-sky-800 border-sky-200 text-[10px] shrink-0">
                                  <span className="relative flex h-2 w-2 ml-1">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600" />
                                  </span>
                                  جارية
                                </Badge>
                              ) : hasSession ? (
                                <Badge variant="outline" className="text-muted-foreground text-[10px] shrink-0">منتهية</Badge>
                              ) : null}
                            </div>
                            {cleanDescription(lecture.description) && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cleanDescription(lecture.description)}</p>
                            )}
                          </div>

                          {/* Action buttons cluster */}
                          <div className="flex items-center gap-1 shrink-0">
                            {/* QR Code button - only when active */}
                            {isActive && (
                              <button
                                onClick={(e) => handleOpenQrModal(lecture, e)}
                                className="touch-target flex items-center justify-center rounded-lg text-sky-700 hover:bg-sky-50 transition-colors"
                                title="عرض رمز QR"
                              >
                                <QrCode className="h-4 w-4" />
                              </button>
                            )}
                            {/* Edit button */}
                            <button
                              onClick={(e) => handleOpenEdit(lecture, e)}
                              className="touch-target flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              title="تعديل المحاضرة"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {/* Delete button - not when active */}
                            {!isActive && (
                              <button
                                onClick={(e) => handleDeleteClick(lecture, e)}
                                disabled={deletingId === lecture.id}
                                className="touch-target flex items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                title="حذف المحاضرة"
                              >
                                {deletingId === lecture.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Row 2: Meta info (date + time + attendance) */}
                        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground mb-4">
                          <div className="flex items-center gap-3">
                            {lecture.lecture_date && (
                              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(lecture.lecture_date)}</span>
                            )}
                            {extractLectureTime(lecture.description) && (
                              <span className="flex items-center gap-1 text-sky-800 font-medium"><Clock className="h-3 w-3" />{formatTimeArabic(extractLectureTime(lecture.description))}</span>
                            )}
                            {isActive && lecture.attendance_session?.started_at && (
                              <LectureTimer startedAt={lecture.attendance_session.started_at} />
                            )}
                          </div>
                          {hasSession && (
                            <span className="flex items-center gap-1 font-semibold text-sky-800">
                              <Users className="h-3.5 w-3.5" />
                              {lecture.attendance_count || 0}/{lecture.total_students || totalStudents}
                            </span>
                          )}
                        </div>

                        {/* Row 3: Start / End button */}
                        <div>
                          {!hasSession && (
                            <button
                              onClick={(e) => handleStartAttendance(lecture.id, e)}
                              disabled={!!startingAttendance}
                              className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
                            >
                              {startingAttendance === lecture.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                              بدء المحاضرة
                            </button>
                          )}
                          {isActive && lecture.attendance_session && (
                            <button
                              onClick={(e) => handleStopAttendance(lecture.attendance_session!.id, e)}
                              disabled={!!stoppingAttendance}
                              className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
                            >
                              {stoppingAttendance === lecture.attendance_session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <StopCircle className="h-4 w-4" />}
                              إنهاء المحاضرة
                            </button>
                          )}
                          {hasSession && !isActive && (
                            <div className="flex items-center justify-center gap-2 rounded-xl border border-muted bg-muted/30 px-4 py-2.5 text-sm font-medium text-muted-foreground">
                              <CheckCircle2 className="h-4 w-4" />
                              محاضرة منتهية
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* ─── Student Card Layout ─── */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-sky-100' : 'bg-muted'}`}>
                            <BookOpen className={`h-5 w-5 ${isActive ? 'text-sky-700' : 'text-muted-foreground'}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-foreground truncate">{lecture.title}</h4>
                              {isActive ? (
                                <Badge className="bg-sky-100 text-sky-800 border-sky-200 text-[10px] shrink-0">
                                  <span className="relative flex h-2 w-2 ml-1">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600" />
                                  </span>
                                  جارية
                                </Badge>
                              ) : hasSession ? (
                                <Badge variant="outline" className="text-muted-foreground text-[10px] shrink-0">منتهية</Badge>
                              ) : null}
                            </div>
                            {cleanDescription(lecture.description) && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cleanDescription(lecture.description)}</p>
                            )}
                          </div>
                        </div>

                        {/* Date + time info */}
                        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-3">
                            {lecture.lecture_date && (
                              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(lecture.lecture_date)}</span>
                            )}
                            {extractLectureTime(lecture.description) && (
                              <span className="flex items-center gap-1 text-sky-800 font-medium"><Clock className="h-3 w-3" />{formatTimeArabic(extractLectureTime(lecture.description))}</span>
                            )}
                            {isActive && lecture.attendance_session?.started_at && (
                              <LectureTimer startedAt={lecture.attendance_session.started_at} />
                            )}
                          </div>
                          {/* Expand/collapse hint for students */}
                          <span className="flex items-center gap-1 text-sky-700 font-medium">
                            <StickyNote className="h-3 w-3" />
                            {isExpanded ? 'إخفاء الملاحظات' : 'اضغط لعرض الملاحظات'}
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </span>
                        </div>

                        {/* Student: Check-in buttons */}
                        {canCheckIn && lecture.attendance_session && (
                          <div className="mt-4 pt-4 border-t">
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleStartScan(lecture.attendance_session!.id); }}
                                disabled={checkingIn}
                                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
                              >
                                <Scan className="h-4 w-4" />
                                مسح QR Code
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleGpsCheckIn(lecture.attendance_session!.id); }}
                                disabled={checkingIn || gpsCheckingIn === lecture.attendance_session!.id}
                                className="flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-60 transition-colors"
                              >
                                {(gpsCheckingIn === lecture.attendance_session!.id || checkingIn) ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Navigation className="h-4 w-4" />
                                )}
                                GPS
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Student: Already checked in */}
                        {role === 'student' && isCheckedIn && (
                          <div className="mt-4 pt-4 border-t">
                            <div className="flex items-center justify-center gap-2 rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm font-semibold text-sky-800">
                              <CheckCircle2 className="h-5 w-5" />
                              تم تسجيل الحضور
                            </div>
                          </div>
                        )}

                        {/* Student: Expand for public notes — hint is shown in the date row above */}
                        {role === 'student' && !isExpanded && (
                          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <StickyNote className="h-3 w-3" />
                            اضغط على المحاضرة لعرض الملاحظات
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Expanded notes area (student) */}
                  <AnimatePresence>
                    {isExpanded && role === 'student' && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 border-t pt-4">
                          <h5 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <StickyNote className="h-4 w-4 text-amber-600" />
                            ملاحظات المعلم
                          </h5>
                          {expandedNotes.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-3">لا توجد ملاحظات عامة بعد</p>
                          ) : (
                            <div className="space-y-2">
                              {expandedNotes.map((note) => {
                                const fileRef = parseFileNote(note.content);
                                if (fileRef.isFile) {
                                  return (
                                    <div key={note.id} className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium text-foreground">{note.author_name}</span>
                                        <span className="text-[10px] text-muted-foreground">{formatTime(note.created_at)}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-sky-700 shrink-0" />
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setStudentPreviewFile({ url: fileRef.url, name: fileRef.name }); }}
                                          className="flex items-center gap-1.5 text-sm font-medium text-sky-800 hover:text-sky-900 transition-colors min-w-0"
                                        >
                                          <Eye className="h-3.5 w-3.5 shrink-0" />
                                          <span className="truncate">{fileRef.name}</span>
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); downloadWithCustomName(fileRef.url, fileRef.name); }}
                                          className="touch-target shrink-0 flex items-center justify-center rounded-md text-sky-800 hover:bg-sky-100 transition-colors"
                                          title="تحميل"
                                        >
                                          <Download className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={note.id} className="rounded-lg bg-muted/30 border p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-xs font-medium text-foreground">{note.author_name}</span>
                                      <span className="text-[10px] text-muted-foreground">{formatTime(note.created_at)}</span>
                                    </div>
                                    <p className="text-sm text-foreground">{note.content}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ─── Create Lecture Modal ─── */}
      <AnimatePresence>
        {createOpen && (
          <>
            {/* Backdrop — NO onClick handler!
                CRITICAL: On mobile (especially Android), when the native file picker closes,
                the browser fires a synthetic click/pointer event on whatever element is under
                the finger. If this backdrop had an onClick, it would close the modal when the
                user returns from picking a file — regardless of any timestamp guard, because
                the user may spend seconds or minutes browsing files before returning.
                Users can close the modal via: X button, Cancel button, or Escape key. */}
            <motion.div
              key="create-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              key="create-modal-content"
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
            <div
              className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl pointer-events-auto"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-sky-700" />
                  محاضرة جديدة
                </h3>
                <button onClick={() => {
                  if (creating) {
                    if (confirm('هل تريد إلغاء إنشاء المحاضرة؟')) {
                      setCreating(false);
                      setCreateOpen(false);
                      setNewTitle('');
                      setNewDesc('');
                      setNewDate('');
                      setNewTime('');
                      setNewPendingFiles([]);
                    }
                  } else {
                    setCreateOpen(false);
                  }
                }} className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">عنوان المحاضرة <span className="text-rose-500">*</span></label>
                  <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="مثال: المحاضرة الأولى" className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all" dir="rtl" disabled={creating} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف (اختياري)</label>
                  <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="وصف المحاضرة..." rows={3} className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all resize-none" dir="rtl" disabled={creating} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">تاريخ المحاضرة</label>
                    <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all" dir="ltr" disabled={creating} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">وقت المحاضرة</label>
                    <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all" dir="ltr" disabled={creating} />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">ملفات المحاضرة (اختياري)</label>
                  <p className="text-xs text-muted-foreground mb-2">سيتم رفع الملفات إلى ملفات المقرر تلقائياً وعرضها كروابط في المحاضرة</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={async (e) => {
                      if (e.target.files) {
                        // CRITICAL FIX: Pre-read file data into ArrayBuffers immediately.
                        // On mobile PWA, File objects can become invalid after the <input>
                        // is cleared or the app goes to background. Reading ArrayBuffer NOW
                        // ensures the data is always available for upload later.
                        const newFiles: PendingFile[] = await Promise.all(
                          Array.from(e.target.files).map(async (file) => {
                            let fileData: ArrayBuffer | null = null;
                            try {
                              fileData = await file.arrayBuffer();
                              console.log(`[LectureUpload] Pre-read file "${file.name}", size: ${fileData.byteLength} bytes`);
                            } catch (readErr) {
                              console.error(`[LectureUpload] Failed to pre-read file "${file.name}":`, readErr);
                            }
                            return {
                              file,
                              fileData,
                              fileName: file.name,
                              fileType: file.type || 'application/octet-stream',
                              fileSize: file.size,
                              customName: file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name,
                              progress: 0,
                              status: 'pending' as const,
                            };
                          })
                        );
                        setNewPendingFiles(prev => [...prev, ...newFiles]);
                        e.target.value = '';
                      }
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    disabled={creating}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/30 px-4 py-4 text-sm font-medium text-sky-800 hover:bg-sky-50 hover:border-sky-400 transition-colors disabled:opacity-60"
                  >
                    <Upload className="h-5 w-5" />
                    اختر ملفات
                  </button>
                  {newPendingFiles.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {newPendingFiles.map((pf, idx) => (
                        <div
                          key={idx}
                          className={`rounded-lg border p-3 ${
                            pf.status === 'done' ? 'border-sky-200 bg-sky-50/30' :
                            pf.status === 'error' ? 'border-rose-200 bg-rose-50/30' :
                            pf.status === 'uploading' ? 'border-amber-200 bg-amber-50/30' :
                            'border-border bg-muted/20'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className={`h-4 w-4 shrink-0 ${
                              pf.status === 'done' ? 'text-sky-700' : 'text-muted-foreground'
                            }`} />
                            <span className="text-xs text-muted-foreground truncate flex-1">{pf.fileName || pf.file.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{((pf.fileSize || pf.file.size) / 1024).toFixed(0)} KB</span>
                            {pf.status === 'pending' && (
                              <button
                                onClick={() => setNewPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                                disabled={creating}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                            {pf.status === 'done' && <Check className="h-4 w-4 text-sky-700 shrink-0" />}
                          </div>
                          {/* Rename field */}
                          {pf.status !== 'done' && (
                            <div className="flex items-center gap-2 mb-2">
                              <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
                              <input
                                type="text"
                                value={pf.customName}
                                onChange={(e) => setNewPendingFiles(prev => prev.map((p, i) => (i === idx ? { ...p, customName: e.target.value } : p)))}
                                placeholder="اسم الملف (بدون الامتداد)"
                                className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                                dir="rtl"
                                disabled={pf.status === 'uploading'}
                              />
                              {(pf.fileName || pf.file.name).includes('.') && (
                                <span className="text-[10px] text-muted-foreground shrink-0">.{(pf.fileName || pf.file.name).split('.').pop()}</span>
                              )}
                            </div>
                          )}
                          {/* Progress bar */}
                          {(pf.status === 'uploading' || pf.status === 'done') && (
                            <div className="space-y-1">
                              <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${pf.status === 'done' ? 'bg-sky-600' : 'bg-amber-500'}`}
                                  style={{ width: `${pf.progress}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">
                                  {pf.status === 'done' ? 'تم الرفع ✓' : 'جارٍ الرفع...'}
                                </span>
                                <span className={`text-[10px] font-medium ${pf.status === 'done' ? 'text-sky-700' : 'text-amber-600'}`}>
                                  {pf.progress}%
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 border-t p-5">
                <button type="button" onClick={handleCreateLecture} disabled={creating || !newTitle.trim()} className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  إنشاء المحاضرة
                </button>
                <button onClick={() => {
                  if (creating) {
                    if (confirm('هل تريد إلغاء إنشاء المحاضرة؟')) {
                      setCreating(false);
                      setCreateOpen(false);
                      setNewTitle('');
                      setNewDesc('');
                      setNewDate('');
                      setNewTime('');
                      setNewPendingFiles([]);
                    }
                  } else {
                    setCreateOpen(false);
                  }
                }} className="rounded-xl border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">إلغاء</button>
              </div>
            </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Edit Lecture Modal ─── */}
      <AnimatePresence>
        {editOpen && editingLecture && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 pointer-events-none"
            // NO onClick on backdrop — prevents mobile synthetic click issues.
            // Close via: X button, Cancel button, or Escape key.
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl pointer-events-auto"
            >
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Pencil className="h-5 w-5 text-sky-700" />
                  تعديل المحاضرة
                </h3>
                <button onClick={() => { if (!savingEdit) setEditOpen(false); }} className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">عنوان المحاضرة <span className="text-rose-500">*</span></label>
                  <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all" dir="rtl" disabled={savingEdit} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف (اختياري)</label>
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="وصف المحاضرة..." rows={3} className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all resize-none" dir="rtl" disabled={savingEdit} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">تاريخ المحاضرة</label>
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all" dir="ltr" disabled={savingEdit} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">وقت المحاضرة</label>
                    <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all" dir="ltr" disabled={savingEdit} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 border-t p-5">
                <button onClick={handleSaveEdit} disabled={savingEdit || !editTitle.trim()} className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60">
                  {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  حفظ التعديلات
                </button>
                <button onClick={() => { if (!savingEdit) setEditOpen(false); }} disabled={savingEdit} className="rounded-xl border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-60">إلغاء</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── QR Code Fullscreen Modal ─── */}
      <AnimatePresence>
        {qrModalOpen && qrLecture && (
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
              className="relative w-full max-w-lg rounded-3xl bg-background shadow-2xl p-8 text-center pointer-events-auto"
              dir="rtl"
            >
              {/* Close */}
              <button
                onClick={() => { setQrModalOpen(false); setQrLecture(null); setQrDataUrl(''); }}
                className="absolute top-4 left-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Title */}
              <h3 className="text-xl font-bold text-foreground mb-1">{qrLecture.title}</h3>
              <p className="text-sm text-muted-foreground mb-6">رمز QR لتسجيل الحضور</p>

              {/* QR Code with auto-refresh */}
              <div className="flex justify-center mb-4">
                {qrDataUrl ? (
                  <div className="relative rounded-2xl border-2 border-sky-200 bg-white p-4 shadow-lg">
                    <img src={qrDataUrl} alt="QR Code" className="w-64 h-64 rounded-lg" />
                    {/* Refresh countdown ring */}
                    <div className="absolute -top-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-sky-700 text-white text-xs font-bold shadow-lg">
                      <QrRefreshTimer />
                    </div>
                  </div>
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center rounded-2xl border bg-muted">
                    <Loader2 className="h-8 w-8 animate-spin text-sky-700" />
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground mb-4 flex items-center justify-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                يتم تجديد الرمز تلقائياً كل 10 ثوانٍ
              </p>

              {/* Attendee count */}
              <div className="inline-flex items-center gap-3 rounded-2xl border bg-sky-50 px-6 py-3">
                <Users className="h-6 w-6 text-sky-700" />
                <div className="text-right">
                  <p className="text-2xl font-bold text-sky-800">{qrAttendeeCount}</p>
                  <p className="text-xs text-sky-700 font-medium">مسجل حضور حتى الآن</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-4">يمكن للطلاب مسح هذا الرمز لتسجيل الحضور</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Lecture Detail Modal (Teacher) ─── */}
      {selectedLecture && (
        <LectureModal
          lecture={selectedLecture}
          open={modalOpen}
          onClose={() => { setModalOpen(false); setSelectedLecture(null); }}
          profile={profile}
          role={role}
          subjectId={subjectId}
          totalStudents={totalStudents}
          onRefresh={fetchLectures}
        />
      )}

      {/* ─── Delete Confirmation Modal ─── */}
      <AnimatePresence>
        {deleteConfirmOpen && deleteTargetLecture && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="w-full max-w-sm rounded-2xl border bg-background shadow-xl p-6 text-center pointer-events-auto"
              dir="rtl"
            >
              <div className="flex justify-center mb-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100">
                  <AlertTriangle className="h-7 w-7 text-rose-600" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">حذف المحاضرة</h3>
              <p className="text-sm text-muted-foreground mb-1">
                هل أنت متأكد من حذف المحاضرة
              </p>
              <p className="text-sm font-semibold text-foreground mb-6">
                «{deleteTargetLecture.title}»؟
              </p>
              <p className="text-xs text-rose-600 mb-6">هذا الإجراء لا يمكن التراجع عنه</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  حذف
                </button>
                <button
                  onClick={() => { setDeleteConfirmOpen(false); setDeleteTargetLecture(null); }}
                  className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── QR Scanner Modal (Student) ─── */}
      <AnimatePresence>
        {scanningSessionId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="w-full max-w-md rounded-2xl border bg-background shadow-xl overflow-hidden pointer-events-auto"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100">
                    <Scan className="h-5 w-5 text-sky-700" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">مسح رمز QR</h3>
                    <p className="text-xs text-muted-foreground">وجّه الكاميرا نحو الرمز</p>
                  </div>
                </div>
                <button
                  onClick={handleStopScan}
                  className="touch-target flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scanner area */}
              <div className="p-4">
                <div className="rounded-xl overflow-hidden bg-black">
                  <div id="qr-reader-modal" ref={scannerRef} className="w-full" />
                </div>
              </div>

              {/* Footer */}
              <div className="border-t px-5 py-3">
                <button
                  onClick={handleStopScan}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-100 transition-colors"
                >
                  <X className="h-4 w-4" />
                  إلغاء المسح
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Student File Preview Modal ─── */}
      <AnimatePresence>
        {studentPreviewFile && (
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
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100">
                    <FileText className="h-5 w-5 text-sky-700" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground truncate">{studentPreviewFile.name}</h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => downloadWithCustomName(studentPreviewFile.url, studentPreviewFile.name)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    تحميل
                  </button>
                  <button
                    onClick={() => setStudentPreviewFile(null)}
                    className="touch-target flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Preview content */}
              <div className="flex items-center justify-center p-4" style={{ height: 'calc(90vh - 70px)' }}>
                {(() => {
                  const ext = studentPreviewFile.name.split('.').pop()?.toLowerCase() || '';
                  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
                    return <img src={studentPreviewFile.url} alt={studentPreviewFile.name} className="max-w-full max-h-full object-contain rounded-lg" />;
                  }
                  if (ext === 'pdf') {
                    return <iframe src={studentPreviewFile.url} className="w-full h-full rounded-lg border" title={studentPreviewFile.name} />;
                  }
                  return (
                    <div className="text-center py-16">
                      <FileText className="h-16 w-16 text-muted-300 mx-auto mb-4" />
                      <p className="text-sm text-muted-foreground mb-4">لا يمكن معاينة هذا الملف مباشرة</p>
                      <button
                        onClick={() => downloadWithCustomName(studentPreviewFile.url, studentPreviewFile.name)}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 transition-colors"
                      >
                        <Download className="h-4 w-4" />
                        تحميل الملف
                      </button>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
