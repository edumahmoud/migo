'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Plus,
  Loader2,
  XCircle,
  Trash2,
  BookOpen,
  FolderOpen,
  File,
  CheckCircle2,
  Upload,
  ClipboardList,
  ListChecks,
  Type,
  Link2,
  Wand2,
  Sparkles,
  Play,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { waitForSession, getAuthHeaders } from '@/lib/client-auth';
import { extractTextFromFile } from '@/lib/pdf-client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useIsMobile } from '@/hooks/use-mobile';
import SummaryView from '@/components/shared/summary-view';
import { useAppStore } from '@/stores/app-store';
import type { UserProfile, Summary, UserFile, Subject } from '@/lib/types';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface PendingSummary {
  id: string;
  title: string;
  status: 'extracting' | 'summarizing' | 'saving' | 'cancelled';
  mode: 'transcribe' | 'summarize';
  startedAt: number;
}

interface TeacherSummariesSectionProps {
  profile: UserProfile;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

const cardHover = {
  whileHover: { y: -2, transition: { duration: 0.2 } },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function TeacherSummariesSection({ profile }: TeacherSummariesSectionProps) {
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setViewingQuizId } = useAppStore();

  // ─── Data state ───
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  // ─── New summary modal state ───
  const [newSummaryOpen, setNewSummaryOpen] = useState(false);
  const [summaryInputMode, setSummaryInputMode] = useState<'text' | 'file' | 'transcribe' | 'existing'>('text');
  const [summaryTitle, setSummaryTitle] = useState('');
  const [summaryText, setSummaryText] = useState('');
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const [summaryFileBuffer, setSummaryFileBuffer] = useState<ArrayBuffer | null>(null);
  const [summaryFileName, setSummaryFileName] = useState<string>('');
  const [summaryFileType, setSummaryFileType] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [creatingSummary, setCreatingSummary] = useState(false);

  // ─── Existing files state ───
  const [existingFiles, setExistingFiles] = useState<UserFile[]>([]);
  const [selectedExistingFile, setSelectedExistingFile] = useState<UserFile | null>(null);
  const [loadingExistingFiles, setLoadingExistingFiles] = useState(false);
  const [existingFileTranscribe, setExistingFileTranscribe] = useState(false);

  // ─── Pending summaries ───
  const [pendingSummaries, setPendingSummaries] = useState<PendingSummary[]>([]);

  // ─── View summary ───
  const [viewingSummaryId, setViewingSummaryId] = useState<string | null>(null);

  // ─── Deleting ───
  const [deletingSummaryId, setDeletingSummaryId] = useState<string | null>(null);

  // Track recently deleted IDs to filter them from stale re-fetch results
  const recentlyDeletedIdsRef = useRef<Set<string>>(new Set());

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
      setSummaryFileType('');
      return;
    }
    setSummaryFile(file);
    setSummaryFileName(file.name);
    setSummaryFileType(file.type || 'application/octet-stream');
    // Enforce file size limit (10MB) immediately
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('حجم الملف يتجاوز الحد الأقصى (10 MB)');
      setSummaryFile(null);
      setSummaryFileBuffer(null);
      setSummaryFileName('');
      setSummaryFileType('');
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

  // -------------------------------------------------------
  // Fetch summaries
  // -------------------------------------------------------
  const fetchSummaries = useCallback(async () => {
    const { data, error } = await supabase
      .from('summaries')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Filter out recently deleted IDs to prevent stale data from re-appearing
      const filtered = (data as Summary[]).filter(s => !recentlyDeletedIdsRef.current.has(s.id));
      setSummaries(filtered);
    }
    setLoadingSummaries(false);
  }, [profile.id]);

  // -------------------------------------------------------
  // Fetch teacher subjects
  // -------------------------------------------------------
  const fetchSubjects = useCallback(async () => {
    // Fetch owned subjects
    const { data: ownedData, error: ownedErr } = await supabase
      .from('subjects')
      .select('*')
      .eq('teacher_id', profile.id)
      .order('name');
    let allSubjects: Subject[] = [];
    if (!ownedErr && ownedData) {
      allSubjects = (ownedData as Subject[]).map(s => ({ ...s, is_co_teacher: false }));
    }
    // Fetch co-taught subjects
    try {
      const { data: coTeacherEntries, error: coTeacherError } = await supabase
        .from('subject_teachers')
        .select('subject_id, role, subjects(*)')
        .eq('teacher_id', profile.id)
        .eq('role', 'co_teacher');
      if (!coTeacherError && coTeacherEntries) {
        (coTeacherEntries as Record<string, unknown>[]).forEach((entry) => {
          const subject = entry.subjects as Subject | null;
          if (subject && !allSubjects.find(s => s.id === subject.id)) {
            allSubjects.push({ ...subject, is_co_teacher: true });
          }
        });
      }
    } catch { /* subject_teachers may not exist */ }
    setSubjects(allSubjects);
  }, [profile.id]);

  // -------------------------------------------------------
  // Realtime subscription
  // -------------------------------------------------------
  useEffect(() => {
    fetchSummaries();
    fetchSubjects();

    const channel = supabase
      .channel('teacher-summaries-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'summaries',
        filter: `user_id=eq.${profile.id}`,
      }, () => {
        fetchSummaries();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id, fetchSummaries, fetchSubjects]);

  // ─── Auth re-hydration for mobile (fix: no INITIAL_SESSION handling) ───
  // FIX: Also clear loading state and re-trigger fetch on session ready.
  // This prevents the page from appearing stuck/hung when returning to the app on mobile.
  useEffect(() => {
    let cancelled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
        console.log('[TeacherSummaries] Session ready (event:', event, '), re-fetching...');
        // Reset loading state so user sees a spinner instead of stale data/error
        setLoadingSummaries(true);
        fetchSummaries();
        fetchSubjects();
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchSummaries, fetchSubjects]);

  // ─── Loading timeout for mobile (fix: no timeout = stuck forever) ───
  // FIX: Increased timeout from 15s to 20s for slower mobile connections.
  // Also only force-loading=false if we still have no data (prevent flash of empty state).
  useEffect(() => {
    if (!loadingSummaries) return;
    const timer = setTimeout(() => {
      console.warn('[TeacherSummaries] Loading timeout (20s) — forcing data display');
      setLoadingSummaries(false);
    }, 20000);
    return () => clearTimeout(timer);
  }, [loadingSummaries]);

  // ─── Stale pending summary auto-cleanup (fix: stuck "جاري إنشاء..." on mobile) ───
  useEffect(() => {
    if (pendingSummaries.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setPendingSummaries(prev => {
        const stale = prev.filter(p => now - p.startedAt > 10 * 60 * 1000); // 10 minutes
        if (stale.length > 0) {
          console.warn('[TeacherSummaries] Cleaning up', stale.length, 'stale pending summaries');
          return prev.filter(p => now - p.startedAt <= 10 * 60 * 1000);
        }
        return prev;
      });
    }, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [pendingSummaries.length]);

  // -------------------------------------------------------
  // Handle delete summary
  // -------------------------------------------------------
  const handleDeleteSummary = async (summaryId: string) => {
    setDeletingSummaryId(summaryId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/summaries', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ summaryId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('تم حذف الملخص بنجاح');
        // Add to recently deleted set to prevent stale re-fetch from re-adding it
        recentlyDeletedIdsRef.current.add(summaryId);
        setTimeout(() => recentlyDeletedIdsRef.current.delete(summaryId), 10000);
        setSummaries(prev => prev.filter(s => s.id !== summaryId));
      } else {
        toast.error(data.error || 'فشل حذف الملخص');
      }
    } catch {
      toast.error('حدث خطأ أثناء حذف الملخص');
    } finally {
      setDeletingSummaryId(null);
    }
  };

  // -------------------------------------------------------
  // Cancel pending summary
  // -------------------------------------------------------
  const cancelPendingSummary = (pendingId: string) => {
    setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'cancelled' as const } : s));
  };

  // -------------------------------------------------------
  // Handle create summary (teacher version)
  // -------------------------------------------------------
  const handleCreateSummary = async () => {
    const title = summaryTitle.trim();
    if (!title) {
      toast.error('يرجى إدخال عنوان الملخص');
      return;
    }

    if (summaryInputMode === 'text' && !summaryText.trim()) {
      toast.error('يرجى إدخال المحتوى');
      return;
    }

    if ((summaryInputMode === 'file' || summaryInputMode === 'transcribe') && !summaryFile) {
      toast.error('يرجى اختيار ملف');
      return;
    }

    if (summaryInputMode === 'existing' && !selectedExistingFile) {
      toast.error('يرجى اختيار ملف من ملفاتك');
      return;
    }

    setCreatingSummary(true);

    // Snapshot state
    const inputMode = summaryInputMode;
    const capturedFile = summaryFile;
    const capturedText = summaryText.trim();
    const capturedFileBuffer = summaryFileBuffer;
    const capturedFileName = summaryFileName || capturedFile?.name || '';
    const capturedFileType = summaryFileType || capturedFile?.type || 'application/octet-stream';

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
        toast.error('حجم الملف يتجاوز الحد الأقصى (10 MB)');
        setCreatingSummary(false);
        return;
      }
      try {
        preReadFileData = await capturedFile.arrayBuffer();
        console.log('[Summary] Fallback pre-read file data, size:', preReadFileData.byteLength, 'bytes');
      } catch {
        toast.error('فشل في قراءة الملف. يرجى إعادة اختيار الملف والمحاولة مرة أخرى');
        setCreatingSummary(false);
        return;
      }
    }

    const capturedExistingFile = inputMode === 'existing' ? selectedExistingFile : null;
    const capturedExistingFileTranscribe = existingFileTranscribe;
    const selectedSubject = selectedSubjectId || null;

    // Create pending tracker
    const pendingId = `pending-${Date.now()}`;
    const pending: PendingSummary = {
      id: pendingId,
      title,
      status: 'extracting',
      mode: (inputMode === 'transcribe' || (inputMode === 'existing' && capturedExistingFileTranscribe)) ? 'transcribe' : 'summarize',
      startedAt: Date.now(),
    };

    // Reset form
    setSummaryTitle('');
    setSummaryText('');
    setSummaryFile(null);
    setSummaryFileBuffer(null);
    setSummaryFileName('');
    setSummaryFileType('');
    setSummaryInputMode('text');
    setNewSummaryOpen(false);
    setCreatingSummary(false);
    setSelectedExistingFile(null);
    setExistingFileTranscribe(false);

    const isTranscribe = inputMode === 'transcribe' || (inputMode === 'existing' && capturedExistingFileTranscribe);
    toast.info(isTranscribe
      ? 'جاري استخراج النص من الملف في الخلفية...'
      : 'جاري استخراج النص وتوليد الملخص في الخلفية...'
    );

    setPendingSummaries(prev => [...prev, pending]);

    // Process in background
    const processInBackground = async () => {
      const abortController = new AbortController();
      // REMOVED aggressive client-side timeout — the server handles its own
      // timeout chain. We keep a 5-minute safety net only.
      const clientTimeoutMs = 300000; // 5 minutes — safety net only
      const clientTimeoutId = setTimeout(() => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      }, clientTimeoutMs);

      try {
        const isMob = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const token = await waitForSession(isMob ? 15000 : 10000);
        if (!token) {
          throw new Error('انتهت جلسة تسجيل الدخول');
        }

        let originalContent = '';
        let summaryContent = '';
        let savedSummaryId = '';
        let sourceFileType: 'pdf' | 'docx' | null = null;
        let sourceFileUrl: string | null = null;

        // ─── Upload source file to Supabase Storage (parallel with text extraction) ───
        // This uploads the raw file so the user can download it later from the summary.
        if ((inputMode === 'file' || inputMode === 'transcribe') && (preReadFileData || capturedFile)) {
          try {
            const timestamp = Date.now();
            const sanitized = capturedFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const storagePath = `${profile.id}/summaries/${timestamp}_${sanitized}`;
            const uploadData = preReadFileData || await capturedFile!.arrayBuffer();
            const uploadBlob = new Blob([uploadData], { type: capturedFileType });

            const { error: uploadError } = await supabase.storage
              .from('user-files')
              .upload(storagePath, uploadBlob, {
                cacheControl: '3600',
                contentType: capturedFileType || 'application/octet-stream',
                upsert: false,
              });

            if (!uploadError) {
              sourceFileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${storagePath}`;
            } else {
              console.warn('[SummaryUpload] File upload failed, continuing without URL:', uploadError.message);
            }
          } catch (uploadErr) {
            console.warn('[SummaryUpload] File upload error, continuing without URL:', uploadErr);
          }
        }

        if ((inputMode === 'file' || inputMode === 'transcribe') && (preReadFileData || capturedFile)) {
          setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'extracting' } : s));

          let extractionSucceeded = false;

          // Primary: Client-side extraction
          {
            const pdfSource = preReadFileData || capturedFile!;
            const extractionTimeoutMs = 30000;
            const extractionPromise = extractTextFromFile(pdfSource, capturedFileName);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), extractionTimeoutMs)
            );

            try {
              const pdfResult = await Promise.race([extractionPromise, timeoutPromise]);
              originalContent = pdfResult.text;
              sourceFileType = pdfResult.sourceFileType || null;
              extractionSucceeded = true;
            } catch {
              // Will try server fallback
            }
          }

          // Fallback: Server-side extraction
          if (!extractionSucceeded) {
            try {
              const sourceBuffer = preReadFileData || (capturedFile ? await capturedFile.arrayBuffer() : null);
              // Note: capturedFile.arrayBuffer() may fail on mobile if File ref is invalid,
              // but preReadFileData should always be available from the onChange pre-read.
              if (!sourceBuffer) throw new Error('لم يتم العثور على بيانات الملف');

              if (!sourceFileType && capturedFileName) {
                sourceFileType = /\.(docx|doc)$/i.test(capturedFileName) ? 'docx' : 'pdf';
              }

              // Send with correct MIME type so the server can handle both PDF and DOCX
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
                headers: { 'Authorization': `Bearer ${token}` },
                body: extractFormData,
                signal: extractController.signal,
              });

              clearTimeout(extractTimeoutId);
              const extractData = await extractRes.json();

              if (extractRes.ok && extractData.success && extractData.data?.text) {
                originalContent = extractData.data.text;
                sourceFileType = extractData.data.sourceFileType || sourceFileType;
                extractionSucceeded = true;
              }
            } catch { /* Server fallback failed */ }
          }

          if (!extractionSucceeded) {
            throw new Error('فشل في استخراج النص من الملف');
          }

          if (!originalContent.trim()) {
            throw new Error('لم يتم العثور على نص في الملف');
          }

          if (inputMode === 'transcribe') {
            summaryContent = originalContent;
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'saving' } : s));

            const saveRes = await fetch('/api/summaries', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                title,
                original_content: originalContent,
                summary_content: originalContent,
                subject_id: selectedSubject,
                transcribe_only: true,
                source_file_type: sourceFileType,
                source_file_url: sourceFileUrl,
              }),
              signal: abortController.signal,
            });

            const saveData = await saveRes.json();
            if (saveRes.ok && saveData.success && saveData.data?.id) {
              savedSummaryId = saveData.data.id;
            }
          } else {
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'summarizing' } : s));

            const summaryRes = await fetch('/api/gemini/summary', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                content: originalContent,
                title,
                subject_id: selectedSubject,
                source_file_type: sourceFileType,
                source_file_url: sourceFileUrl,
              }),
              signal: abortController.signal,
            });

            const summaryData = await summaryRes.json();
            if (summaryRes.ok && summaryData.success) {
              summaryContent = summaryData.data?.summary || '';
              savedSummaryId = summaryData.data?.summaryId || '';
            } else {
              throw new Error(summaryData.error || 'فشل إنشاء الملخص');
            }
          }
        } else if (inputMode === 'existing' && capturedExistingFile) {
          setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'extracting' } : s));

          if (!sourceFileType && capturedExistingFile.file_name) {
            sourceFileType = /\.(docx|doc)$/i.test(capturedExistingFile.file_name) ? 'docx' : 'pdf';
          }

          let extractionSucceeded = false;

          // Primary: Server-side extraction
          try {
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
                ...(capturedExistingFile.storage_path ? { storagePath: capturedExistingFile.storage_path } : {}),
              }),
              signal: extractController.signal,
            });

            clearTimeout(extractTimeoutId);
            const extractData = await extractRes.json();

            if (extractRes.ok && extractData.success && extractData.data?.text) {
              originalContent = extractData.data.text;
              sourceFileType = extractData.data.sourceFileType || sourceFileType;
              extractionSucceeded = true;
            }
          } catch { /* Server extraction failed */ }

          // Fallback: Client-side extraction
          if (!extractionSucceeded) {
            try {
              const fileRes = await fetch(capturedExistingFile.file_url, { signal: abortController.signal });
              if (!fileRes.ok) throw new Error('فشل في تحميل الملف');
              const arrayBuffer = await fileRes.arrayBuffer();

              const extractionTimeoutMs = 30000;
              const extractionPromise = extractTextFromFile(arrayBuffer, capturedExistingFile.file_name);
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), extractionTimeoutMs)
              );

              const result = await Promise.race([extractionPromise, timeoutPromise]);
              originalContent = result.text;
              sourceFileType = result.sourceFileType || sourceFileType;
              extractionSucceeded = true;
            } catch { /* Client extraction also failed */ }
          }

          if (!extractionSucceeded) {
            throw new Error('فشل في استخراج النص من الملف');
          }

          if (!originalContent.trim()) {
            throw new Error('لم يتم العثور على نص في الملف');
          }

          if (capturedExistingFileTranscribe) {
            summaryContent = originalContent;
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'saving' } : s));

            const saveRes = await fetch('/api/summaries', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                title,
                original_content: originalContent,
                summary_content: originalContent,
                subject_id: selectedSubject,
                transcribe_only: true,
                source_file_type: sourceFileType,
                source_file_url: sourceFileUrl,
              }),
              signal: abortController.signal,
            });

            const saveData = await saveRes.json();
            if (saveRes.ok && saveData.success && saveData.data?.id) {
              savedSummaryId = saveData.data.id;
            }
          } else {
            setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'summarizing' } : s));

            const summaryRes = await fetch('/api/gemini/summary', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                content: originalContent,
                title,
                subject_id: selectedSubject,
                source_file_type: sourceFileType,
                source_file_url: sourceFileUrl,
              }),
              signal: abortController.signal,
            });

            const summaryData = await summaryRes.json();
            if (summaryRes.ok && summaryData.success) {
              summaryContent = summaryData.data?.summary || '';
              savedSummaryId = summaryData.data?.summaryId || '';
            } else {
              throw new Error(summaryData.error || 'فشل إنشاء الملخص');
            }
          }
        } else {
          // Text mode
          originalContent = capturedText;
          setPendingSummaries(prev => prev.map(s => s.id === pendingId ? { ...s, status: 'summarizing' } : s));

          const summaryRes = await fetch('/api/gemini/summary', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              content: originalContent,
              title,
              subject_id: selectedSubject,
            }),
            signal: abortController.signal,
          });

          const summaryData = await summaryRes.json();
          if (summaryRes.ok && summaryData.success) {
            summaryContent = summaryData.data?.summary || '';
            savedSummaryId = summaryData.data?.summaryId || '';
          } else {
            throw new Error(summaryData.error || 'فشل إنشاء الملخص');
          }
        }

        // Success
        setPendingSummaries(prev => prev.filter(s => s.id !== pendingId));
        toast.success(isTranscribe ? 'تم تفريغ النص بنجاح' : 'تم إنشاء الملخص بنجاح');
        fetchSummaries();

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setPendingSummaries(prev => prev.filter(s => s.id !== pendingId));
        toast.error(errMsg || 'فشل في إنشاء الملخص');
      } finally {
        clearTimeout(clientTimeoutId);
      }
    };

    processInBackground();
  };

  // -------------------------------------------------------
  // Format date
  // -------------------------------------------------------
  function formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return dateStr; }
  }

  // -------------------------------------------------------
  // If viewing a specific summary, show SummaryView
  // -------------------------------------------------------
  if (viewingSummaryId) {
    return (
      <SummaryView
        summaryId={viewingSummaryId}
        onBack={() => setViewingSummaryId(null)}
        teacherMode={true}
        onViewQuiz={(quizId) => setViewingQuizId(quizId)}
      />
    );
  }

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">الملخصات والتفريغ</h2>
          <p className="text-muted-foreground mt-1">فرّغ محتوى الملفات وأنشئ ملخصات واختبارات لطلابك</p>
        </div>
        <button
          onClick={() => setNewSummaryOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
        >
          <Plus className="h-4 w-4" />
          جديد
        </button>
      </motion.div>

      {/* Pending summaries progress */}
      {pendingSummaries.length > 0 && (
        <motion.div variants={itemVariants} className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="h-4 w-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">
              جاري إنشاء {pendingSummaries.length} عنصر...
            </span>
          </div>
          {pendingSummaries.map(ps => (
            <div key={ps.id} className="flex items-center gap-2 text-xs text-sky-800 py-1 ms-6">
              <span className="font-medium">{ps.title}</span>
              <span className="text-sky-700/70">
                {ps.status === 'extracting' && (ps.mode === 'transcribe' ? '• استخراج النص (تفريغ)...' : '• استخراج النص...')}
                {ps.status === 'summarizing' && '• توليد الملخص...'}
                {ps.status === 'saving' && '• حفظ...'}
                {ps.status === 'cancelled' && '• تم الإلغاء'}
              </span>
              {ps.status !== 'cancelled' && ps.status !== 'saving' && (
                <button
                  onClick={() => cancelPendingSummary(ps.id)}
                  className="ms-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-rose-600 hover:bg-rose-50 transition-colors"
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
      {loadingSummaries ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 mb-4" />
          <p className="text-muted-foreground text-sm">جاري تحميل الملخصات...</p>
        </div>
      ) : summaries.length === 0 && pendingSummaries.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <FileText className="h-8 w-8 text-sky-700" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد ملخصات</p>
          <p className="text-sm text-muted-foreground mb-4">ابدأ بتفريغ محتوى ملف أو إنشاء ملخص دراسي لطلابك</p>
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
          {summaries.map((summary) => {
            const isTranscribed = summary.original_content === summary.summary_content;
            return (
              <motion.div key={summary.id} variants={itemVariants} {...cardHover}>
                <div
                  className="group relative rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setViewingSummaryId(summary.id)}
                >
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSummary(summary.id);
                    }}
                    disabled={deletingSummaryId === summary.id}
                    className="absolute top-3 left-3 rounded-md p-1.5 text-muted-foreground/60 hover:text-rose-600 hover:bg-rose-50 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                  >
                    {deletingSummaryId === summary.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>

                  {/* Badge */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      isTranscribed
                        ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                        : 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200'
                    }`}>
                      {isTranscribed ? (
                        <><BookOpen className="h-3 w-3" /> تفريغ</>
                      ) : (
                        <><Sparkles className="h-3 w-3" /> ملخص AI</>
                      )}
                    </span>
                    {summary.source_file_type && (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {summary.source_file_type.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-semibold text-foreground mb-1.5 line-clamp-2">{summary.title}</h3>

                  {/* Preview */}
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                    {summary.summary_content?.substring(0, 150) || summary.original_content?.substring(0, 150) || ''}
                  </p>

                  {/* Date */}
                  <p className="text-xs text-muted-foreground/60">{formatDate(summary.created_at)}</p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ─── New Summary Modal ─── */}
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
              className="w-full max-w-lg rounded-2xl border bg-background shadow-xl max-h-[90vh] overflow-y-auto"
              dir="rtl"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-semibold text-foreground">إنشاء ملخص / تفريغ</h3>
                <button
                  onClick={() => setNewSummaryOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-4">
                {/* Title */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">العنوان</label>
                  <input
                    type="text"
                    value={summaryTitle}
                    onChange={(e) => setSummaryTitle(e.target.value)}
                    placeholder="مثال: ملخص محاضرة الفيزياء..."
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-colors"
                    dir="rtl"
                  />
                </div>

                {/* Subject selection */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">المقرر (اختياري)</label>
                  <select
                    value={selectedSubjectId}
                    onChange={(e) => setSelectedSubjectId(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-colors"
                    dir="rtl"
                  >
                    <option value="">بدون مقرر</option>
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Input mode tabs */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">طريقة الإدخال</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSummaryInputMode('text')}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'text'
                          ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <FileText className="h-4 w-4" />
                      نص
                    </button>
                    <button
                      onClick={() => setSummaryInputMode('transcribe')}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'transcribe'
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <BookOpen className="h-4 w-4" />
                      تفريغ ملف
                    </button>
                    <button
                      onClick={() => setSummaryInputMode('file')}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        summaryInputMode === 'file'
                          ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <Upload className="h-4 w-4" />
                      تلخيص ملف
                    </button>
                    <button
                      onClick={() => {
                        setSummaryInputMode('existing');
                        if (existingFiles.length === 0) {
                          setLoadingExistingFiles(true);
                          supabase
                            .from('user_files')
                            .select('*')
                            .eq('user_id', profile.id)
                            .order('created_at', { ascending: false })
                            .then(({ data, error }) => {
                              if (!error && data) {
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
                    <p className="text-xs text-teal-600/80 mt-2">
                      سيتم استخراج النص من ملف PDF أو Word فقط دون تلخيص
                    </p>
                  )}
                  {summaryInputMode === 'existing' && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-sky-600/80">
                        اختر ملفاً من ملفاتك المرفوعة مسبقاً
                      </p>
                      {/* Sub-toggle: Summarize vs Transcribe */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExistingFileTranscribe(false)}
                          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                            !existingFileTranscribe
                              ? 'border-sky-600 bg-sky-50 text-sky-800'
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
                              ? 'border-teal-500 bg-teal-50 text-teal-700'
                              : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          <BookOpen className="h-3 w-3" />
                          تفريغ النص فقط
                        </button>
                      </div>
                      {existingFileTranscribe && (
                        <p className="text-xs text-teal-600/70">
                          سيتم استخراج النص من الملف فقط دون تلخيص
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Text input */}
                {summaryInputMode === 'text' && (
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">المحتوى</label>
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
                    <label className="text-sm font-medium text-foreground mb-1.5 block">ملف PDF أو Word</label>
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
                          ? 'border-teal-300 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/30 hover:border-teal-400 hover:bg-teal-50/50'
                          : 'border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 hover:border-sky-400 hover:bg-sky-50/50'
                      }`}
                    >
                      {summaryFile ? (
                        <>
                          <FileText className={`h-8 w-8 ${summaryInputMode === 'transcribe' ? 'text-teal-600 dark:text-teal-400' : 'text-sky-700 dark:text-sky-300'}`} />
                          <span className={`text-sm font-medium ${summaryInputMode === 'transcribe' ? 'text-teal-700 dark:text-teal-300' : 'text-sky-800 dark:text-sky-200'}`}>{summaryFile.name}</span>
                          <span className="text-xs text-muted-foreground">{(summaryFile.size / 1024 / 1024).toFixed(2)} MB</span>
                        </>
                      ) : (
                        <>
                          <Upload className={`h-8 w-8 ${summaryInputMode === 'transcribe' ? 'text-teal-400' : 'text-sky-400'}`} />
                          <span className="text-sm text-muted-foreground">اضغط لاختيار ملف</span>
                          <span className="text-xs text-muted-foreground/60">PDF أو Word (بحد أقصى 10 MB)</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Existing files selection */}
                {summaryInputMode === 'existing' && (
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">اختر ملفاً من ملفاتك</label>
                    {loadingExistingFiles ? (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
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
                                  <FileText className="h-4 w-4 text-rose-600" />
                                ) : (
                                  <File className="h-4 w-4 text-blue-600" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                  <span>{isPdf ? 'PDF' : 'Word'}</span>
                                  <span className="text-muted-foreground/40">•</span>
                                  <span>{(file.file_size / 1024).toFixed(0)} KB</span>
                                </div>
                              </div>
                              {selectedExistingFile?.id === file.id && (
                                <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
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
                  {summaryInputMode === 'transcribe' ? <BookOpen className="h-4 w-4" /> :
                   summaryInputMode === 'existing' ? (existingFileTranscribe ? <BookOpen className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />) :
                   <CheckCircle2 className="h-4 w-4" />}
                  {summaryInputMode === 'transcribe' ? 'تفريغ النص' :
                   summaryInputMode === 'existing' ? (existingFileTranscribe ? 'تفريغ النص' : 'تلخيص الملف') :
                   'إنشاء الملخص'}
                </button>
                <button
                  onClick={() => setNewSummaryOpen(false)}
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
}
