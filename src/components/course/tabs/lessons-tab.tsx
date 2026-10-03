'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Plus,
  Loader2,
  Trash2,
  Edit3,
  Copy,
  ArrowLeft,
  ArrowRight,
  Save,
  Eye,
  Clock,
  FileText,
  Check,
  AlertCircle,
  MoreVertical,
  Pencil,
  ChevronLeft,
  Globe,
  Lock,
  BookMarked,
  Layers,
  FolderTree,
  ChevronDown,
  ChevronUp,
  Target,
  CheckCircle2,
  Play,
  X,
  // v110: extra icons for LMS feature parity
  Bookmark,
  Tag,
  Calendar,
  Sparkles,
  Settings,
  Video,
  ListChecks,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/client-auth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import RichTextEditor from '@/components/editor/rich-text-editor';
import type { UserProfile, Subject, LessonUnit } from '@/lib/types';
import { useTranslations } from '@/i18n/use-translations';
import { useIsMobile } from '@/hooks/use-mobile';

// -------------------------------------------------------
// Lesson Type
// -------------------------------------------------------
// v102: Local Lesson interface — keep in sync with src/lib/types.ts Lesson.
// Local interface is kept for `any` content_json compatibility with TipTap editor.
interface Lesson {
  id: string;
  subject_id: string;
  title: string;
  content_json: any;
  content_html: string;
  status: 'draft' | 'published';
  published_at: string | null;
  published_json: any;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  unit_id?: string | null;
  order_within_unit?: number;
  pass_threshold?: number | null;
  // v100
  estimated_minutes?: number | null;
  // v102: full LMS feature parity
  video_url?: string | null;
  video_id?: string | null;
  summary?: string | null;
  objectives?: any;  // JSONB array (string[] or {text: string}[])
  due_date?: string | null;
  available_from?: string | null;
  available_until?: string | null;
  prerequisite_lesson_id?: string | null;
  duration_seconds?: number | null;
  tags?: string[];
  is_free_preview?: boolean;
  instructor_notes?: string | null;
  transcript?: string | null;
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface LessonsTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subject: Subject;
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
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

const editorVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function LessonsTab({ profile, role, subject }: LessonsTabProps) {
  const { t, direction, isRTL } = useTranslations('lessons');
  const { t: tc } = useTranslations('common');
  const { t: tCourse } = useTranslations('course');
  const isMobile = useIsMobile();

  // ─── Data state ───
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [editorContent, setEditorContent] = useState<any>(null);
  const [editorHtml, setEditorHtml] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [creatingLesson, setCreatingLesson] = useState(false);
  const [viewingLesson, setViewingLesson] = useState<Lesson | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  // v63: Units state
  const [units, setUnits] = useState<LessonUnit[]>([]);
  const [showUnitsManager, setShowUnitsManager] = useState(false);
  const [showUnitsView, setShowUnitsView] = useState(false);
  const [collapsedUnits, setCollapsedUnits] = useState<Record<string, boolean>>({});

  // v100: student lesson progress state — only used by students
  // progressMap: { [lesson_id]: { status, completed_at, last_accessed_at } }
  const [progressMap, setProgressMap] = useState<Record<string, { status: string; completed_at: string | null; last_accessed_at: string | null }>>({});
  const [lastLessonId, setLastLessonId] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalLessonsForProgress, setTotalLessonsForProgress] = useState(0);

  // v99: toggle collapse state of a unit (default expanded)
  const toggleUnitCollapse = useCallback((unitId: string) => {
    setCollapsedUnits((prev) => ({ ...prev, [unitId]: !prev[unitId] }));
  }, []);
  const [movingLessonId, setMovingLessonId] = useState<string | null>(null);

  // v110: LMS feature parity — student-side state for lesson view
  // - bookmarks: list of bookmarks the student has on the current lesson
  // - transcriptOpen: collapsible transcript visibility toggle
  // - bookmarksLoaded: prevents re-fetching bookmarks on every render
  // - showLessonSettings: teacher-only toggle for the "Lesson settings" panel
  //   in the editor sidebar (sets v102 LMS fields: summary, objectives, etc.)
  const [bookmarks, setBookmarks] = useState<{ id: string; label: string | null; position_seconds: number | null; created_at: string }[]>([]);
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [showLessonSettings, setShowLessonSettings] = useState(false);

  // Autosave timer ref
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------
  // Computed: visible lessons based on role
  // -------------------------------------------------------
  const visibleLessons = useMemo(() => {
    if (role === 'teacher') return lessons;
    return lessons.filter((l) => l.status === 'published');
  }, [lessons, role]);

  // -------------------------------------------------------
  // Helper: word count from content
  // -------------------------------------------------------
  const getWordCount = useCallback((content: any): number => {
    if (!content) return 0;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (content.text) {
      text = content.text;
    } else if (content.html) {
      // Strip HTML tags for word counting
      text = content.html.replace(/<[^>]*>/g, ' ');
    } else if (content.content) {
      text = content.content
        ?.map((n: any) =>
          n.content?.map((c: any) => c.text || '').join('') || ''
        )
        .join(' ') || '';
    }
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }, []);

  // -------------------------------------------------------
  // Helper: get excerpt from content
  // -------------------------------------------------------
  const getExcerpt = useCallback((content: any, maxLen = 100): string => {
    if (!content) return '';
    let text = '';
    if (typeof content === 'string') {
      text = content.replace(/<[^>]*>/g, ' ').trim();
    } else if (content.text) {
      text = content.text;
    } else if (content.html) {
      text = content.html.replace(/<[^>]*>/g, ' ').trim();
    } else if (content.content) {
      text = content.content
        ?.map((n: any) =>
          n.content?.map((c: any) => c.text || '').join('') || ''
        )
        .join(' ') || '';
    }
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  }, []);

  // -------------------------------------------------------
  // v110: Helper: format estimated minutes → "X دقيقة" / "X min"
  // -------------------------------------------------------
  const formatEstimatedMinutes = useCallback((minutes: number | null | undefined): string => {
    if (minutes == null || minutes <= 0) return '';
    if (minutes < 60) return `${minutes} ${t('minutesLabel') || 'دقيقة'}`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours} ${t('hoursLabel') || 'ساعة'}`;
    return `${hours} ${t('hoursLabel') || 'ساعة'} ${mins} ${t('minutesLabel') || 'دقيقة'}`;
  }, [t]);

  // -------------------------------------------------------
  // v110: Helper: parse objectives into string[] (handles both
  // string[] and {text: string}[] shapes from the JSONB column).
  // -------------------------------------------------------
  const getObjectives = useCallback((objectives: unknown): string[] => {
    if (!Array.isArray(objectives)) return [];
    return objectives
      .map((o) => typeof o === 'string' ? o : (o as { text?: string })?.text || '')
      .filter(Boolean);
  }, []);

  // -------------------------------------------------------
  // v110: Helper: format a scheduling date as a short localized string.
  // Used for available_from / available_until / due_date displays.
  // -------------------------------------------------------
  const formatScheduleDate = useCallback((dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleString(
        direction === 'rtl' ? 'ar-EG' : 'en-US',
        { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      );
    } catch {
      return dateStr;
    }
  }, [direction]);

  // -------------------------------------------------------
  // v110: Student-only — fetch bookmarks for the currently-viewed lesson.
  // Triggered when viewingLesson changes (only for student role).
  // -------------------------------------------------------
  const fetchLessonBookmarks = useCallback(async (lessonId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lessons/${lessonId}/bookmarks`, { headers });
      if (!res.ok) {
        setBookmarks([]);
        return;
      }
      const data = await res.json();
      setBookmarks(data.bookmarks || []);
    } catch (err) {
      console.error('[LessonsTab] fetch bookmarks error:', err);
      setBookmarks([]);
    } finally {
      setBookmarksLoaded(true);
    }
  }, []);

  // -------------------------------------------------------
  // v110: Student-only — add a quick bookmark to the current lesson.
  // Used by the inline "+ Save bookmark" button in the student view.
  // -------------------------------------------------------
  const handleAddBookmark = useCallback(async (lessonId: string, label: string) => {
    if (!label.trim()) {
      toast.error(t('bookmarkLabelRequired') || 'اكتب عنوان للم bookmark');
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lessons/${lessonId}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ label: label.trim(), position_seconds: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('bookmarkAddFailed') || 'فشل حفظ الم bookmark');
        return;
      }
      const data = await res.json();
      if (data.bookmark) {
        setBookmarks((prev) => [...prev, data.bookmark]);
        toast.success(t('bookmarkAdded') || 'تم حفظ الم bookmark');
      }
    } catch (err) {
      console.error('[LessonsTab] add bookmark error:', err);
      toast.error(t('bookmarkAddFailed') || 'فشل حفظ الم bookmark');
    }
  }, [t]);

  // -------------------------------------------------------
  // v110: Student-only — delete a bookmark by id.
  // -------------------------------------------------------
  const handleDeleteBookmark = useCallback(async (lessonId: string, bookmarkId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lessons/${lessonId}/bookmarks?bookmark_id=${bookmarkId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        toast.error(t('bookmarkDeleteFailed') || 'فشل حذف الم bookmark');
        return;
      }
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
      toast.success(t('bookmarkDeleted') || 'تم حذف الم bookmark');
    } catch (err) {
      console.error('[LessonsTab] delete bookmark error:', err);
      toast.error(t('bookmarkDeleteFailed') || 'فشل حذف الم bookmark');
    }
  }, [t]);

  // -------------------------------------------------------
  // Helper: format relative date
  // -------------------------------------------------------
  const formatDateRelative = useCallback(
    (dateStr: string): string => {
      try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return tc('justNow');
        if (diffMins < 60) return tc('minutesAgo', { count: diffMins });
        if (diffHours < 24) return tc('hoursAgo', { count: diffHours });
        if (diffDays < 7) return tc('daysAgo', { count: diffDays });

        return date.toLocaleDateString(direction === 'rtl' ? 'ar-SA' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      } catch {
        return dateStr;
      }
    },
    [tc, direction]
  );

  const formatFullDate = useCallback(
    (dateStr: string): string => {
      try {
        return new Date(dateStr).toLocaleDateString(
          direction === 'rtl' ? 'ar-SA' : 'en-US',
          {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }
        );
      } catch {
        return dateStr;
      }
    },
    [direction]
  );

  // -------------------------------------------------------
  // Fetch lessons
  // -------------------------------------------------------
  const fetchLessons = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lessons?subject_id=${subject.id}`, {
        headers,
      });
      if (!res.ok) {
        console.error('Failed to fetch lessons:', res.status);
        // v104: show user-facing toast on 403 (enrollment issue) instead of silent failure
        if (res.status === 403 && role === 'student') {
          toast.error(t('enrollmentMissing') || 'لا يمكنك الوصول إلى محتوى هذا المقرر — تأكد من تفعيل اشتراكك');
        }
        setLessons([]);
        return;
      }
      const data = await res.json();
      setLessons(data.lessons || []);
    } catch (err) {
      console.error('Error fetching lessons:', err);
      setLessons([]);
    } finally {
      setLoading(false);
    }
  }, [subject.id, role, t]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  // -------------------------------------------------------
  // v63: Fetch units
  // -------------------------------------------------------
  const fetchUnits = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lesson-units?subject_id=${subject.id}`, { headers });
      if (!res.ok) {
        console.error('Failed to fetch units:', res.status);
        // v104: show toast on 403 for students
        if (res.status === 403 && role === 'student') {
          toast.error(t('enrollmentMissing') || 'لا يمكنك الوصول إلى محتوى هذا المقرر — تأكد من تفعيل اشتراكك');
        }
        setUnits([]);
        return;
      }
      const data = await res.json();
      setUnits(data.units || []);
    } catch (err) {
      console.error('Error fetching units:', err);
      setUnits([]);
    }
  }, [subject.id, role, t]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  // v100: Fetch the student's progress for all lessons in this subject.
  // Teachers/admins get an empty progress map (no progress tracking).
  const fetchProgress = useCallback(async () => {
    // Skip progress tracking for non-student roles (teachers don't track
    // progress on their own lessons)
    if (role !== 'student') {
      setProgressMap({});
      setLastLessonId(null);
      setCompletedCount(0);
      setTotalLessonsForProgress(0);
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lessons/progress?subject_id=${subject.id}`, { headers });
      if (!res.ok) {
        console.error('Failed to fetch progress:', res.status);
        return;
      }
      const data = await res.json();
      setProgressMap(data.progress || {});
      setLastLessonId(data.lastLessonId || null);
      setCompletedCount(data.completedCount || 0);
      setTotalLessonsForProgress(data.totalLessons || 0);
    } catch (err) {
      console.error('Error fetching progress:', err);
    }
  }, [subject.id, role]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  // v100: helper — mark a lesson as completed (or reset) — optimistic UI
  const markLessonProgress = useCallback(async (lessonId: string, action: 'view' | 'complete' | 'reset') => {
    // Optimistic UI update
    const prevMap = { ...progressMap };
    setProgressMap((prev) => ({
      ...prev,
      [lessonId]: {
        status: action === 'complete' ? 'completed' : action === 'reset' ? 'not_started' : 'in_progress',
        completed_at: action === 'complete' ? new Date().toISOString() : null,
        last_accessed_at: new Date().toISOString(),
      },
    }));
    // Update completed count
    if (action === 'complete' && prevMap[lessonId]?.status !== 'completed') {
      setCompletedCount((c) => c + 1);
    } else if (action === 'reset' && prevMap[lessonId]?.status === 'completed') {
      setCompletedCount((c) => Math.max(0, c - 1));
    }
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/lessons/${lessonId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ action }),
      });
    } catch (err) {
      console.error('Error marking progress:', err);
      // Revert on failure
      setProgressMap(prevMap);
    }
  }, [progressMap]);

  // v100: helper — is lesson completed?
  const isLessonCompleted = useCallback((lessonId: string) => {
    return progressMap[lessonId]?.status === 'completed';
  }, [progressMap]);

  // -------------------------------------------------------
  // v63: Move lesson to a different unit (or unassign)
  // -------------------------------------------------------
  const handleMoveToUnit = useCallback(
    async (lesson: Lesson, newUnitId: string | null) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/lessons/${lesson.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ unit_id: newUnitId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || t('moveFailed') || 'Failed to move lesson');
          return;
        }
        const data = await res.json();
        if (data.lesson) {
          setLessons((prev) => prev.map((l) => (l.id === lesson.id ? { ...l, ...data.lesson } : l)));
        }
        toast.success(newUnitId ? t('lessonMoved') || 'Lesson moved' : t('lessonUnassigned') || 'Lesson moved to standalone');
        setMovingLessonId(null);
      } catch (err) {
        console.error('Error moving lesson:', err);
        toast.error(t('moveFailed') || 'Failed to move lesson');
      }
    },
    [t]
  );

  // -------------------------------------------------------
  // Real-time subscription for lessons
  // -------------------------------------------------------
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`subject-lessons-${subject.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'lessons',
            filter: `subject_id=eq.${subject.id}`,
          },
          () => {
            fetchLessons();
          }
        )
        .subscribe();
    } catch (err) {
      console.error('Error setting up lessons realtime subscription:', err);
    }
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [subject.id, fetchLessons]);

  // -------------------------------------------------------
  // Create lesson
  // -------------------------------------------------------
  // v99: handleCreateLesson now REQUIRES a unitId — lessons can only be created
  // inside a unit. If called with null/undefined, it shows a clear error toast
  // instructing the teacher to create a unit first.
  const handleCreateLesson = useCallback(async (unitId?: string | null) => {
    if (!unitId) {
      toast.error(t('createLessonRequiresUnit') || 'يجب إنشاء وحدة أولاً، ثم إضافة الدرس داخل الوحدة');
      return;
    }
    setCreatingLesson(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subject_id: subject.id,
          title: t('untitledLesson') || 'Untitled Lesson',
          // v98: pass unit_id so the new lesson is auto-grouped under the unit
          unit_id: unitId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('createFailed') || 'Failed to create lesson');
        return;
      }
      const data = await res.json();
      if (data.lesson) {
        setLessons((prev) => [data.lesson, ...prev]);
        setEditingLesson(data.lesson);
        setEditorContent(null);
        setEditorHtml('');
        setHasUnsavedChanges(false);
        setLastSaved(null);
        toast.success(t('lessonCreatedInUnit') || 'تم إنشاء الدرس داخل الوحدة');
      }
    } catch (err) {
      console.error('Error creating lesson:', err);
      toast.error(t('createFailed') || 'Failed to create lesson');
    } finally {
      setCreatingLesson(false);
    }
  }, [subject.id, t]);

  // -------------------------------------------------------
  // Save lesson
  // -------------------------------------------------------
  const handleSaveLesson = useCallback(async () => {
    if (!editingLesson) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lessons/${editingLesson.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          title: editingLesson.title,
          content_json: editorContent,
          content_html: editorHtml,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('saveFailed') || 'Failed to save');
        return;
      }
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      // Update the lesson in the local list
      setLessons((prev) =>
        prev.map((l) =>
          l.id === editingLesson.id
            ? {
                ...l,
                title: editingLesson.title,
                content_json: editorContent,
                content_html: editorHtml,
                updated_at: new Date().toISOString(),
              }
            : l
        )
      );
      toast.success(t('lessonSaved') || 'Lesson saved');
    } catch (err) {
      console.error('Error saving lesson:', err);
      toast.error(t('saveFailed') || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [editingLesson, editorContent, editorHtml, t]);

  // -------------------------------------------------------
  // Autosave with debounce (3 seconds)
  // -------------------------------------------------------
  useEffect(() => {
    if (!hasUnsavedChanges || !editingLesson || role !== 'teacher') return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      handleSaveLesson();
    }, 3000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [hasUnsavedChanges, editingLesson, role, handleSaveLesson]);

  // -------------------------------------------------------
  // Publish / Unpublish lesson
  // -------------------------------------------------------
  const handlePublish = useCallback(async () => {
    if (!editingLesson) return;
    try {
      const headers = await getAuthHeaders();
      const isUnpublish = editingLesson.status === 'published';
      const res = await fetch(`/api/lessons/${editingLesson.id}/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ unpublish: isUnpublish }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          data.error || t('publishFailed') || 'Failed to update publish status'
        );
        return;
      }
      const data = await res.json();
      const newStatus: 'draft' | 'published' = data.status || (editingLesson.status === 'draft' ? 'published' : 'draft');
      const updatedLesson: Lesson = {
        ...editingLesson,
        status: newStatus,
        published_at: newStatus === 'published' ? new Date().toISOString() : null,
      };
      setEditingLesson(updatedLesson);
      setLessons((prev) =>
        prev.map((l) => (l.id === editingLesson.id ? updatedLesson : l))
      );
      toast.success(
        newStatus === 'published'
          ? t('lessonPublished') || 'Lesson published'
          : t('lessonUnpublished') || 'Lesson unpublished'
      );
    } catch (err) {
      console.error('Error toggling publish:', err);
      toast.error(t('publishFailed') || 'Failed to update publish status');
    }
  }, [editingLesson, t]);

  // -------------------------------------------------------
  // Delete lesson
  // -------------------------------------------------------
  const handleDelete = useCallback(
    async (lessonId: string) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/lessons/${lessonId}`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || t('deleteFailed') || 'Failed to delete lesson');
          return;
        }
        setLessons((prev) => prev.filter((l) => l.id !== lessonId));
        if (editingLesson?.id === lessonId) {
          setEditingLesson(null);
          setEditorContent(null);
          setEditorHtml('');
          setHasUnsavedChanges(false);
        }
        toast.success(t('lessonDeleted') || 'Lesson deleted');
      } catch (err) {
        console.error('Error deleting lesson:', err);
        toast.error(t('deleteFailed') || 'Failed to delete lesson');
      } finally {
        setConfirmDeleteId(null);
      }
    },
    [editingLesson, t]
  );

  // -------------------------------------------------------
  // Duplicate lesson
  // -------------------------------------------------------
  const handleDuplicate = useCallback(
    async (lesson: Lesson) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/lessons', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            subject_id: subject.id,
            title: `${lesson.title} (${t('copy') || 'Copy'})`,
            content_json: lesson.content_json,
            content_html: lesson.content_html,
            status: 'draft',
          }),
        });
        if (!res.ok) {
          toast.error(t('duplicateFailed') || 'Failed to duplicate lesson');
          return;
        }
        const data = await res.json();
        if (data.lesson) {
          setLessons((prev) => [data.lesson, ...prev]);
          toast.success(t('lessonDuplicated') || 'Lesson duplicated');
        }
      } catch (err) {
        console.error('Error duplicating lesson:', err);
        toast.error(t('duplicateFailed') || 'Failed to duplicate lesson');
      }
    },
    [subject.id, t]
  );

  // -------------------------------------------------------
  // Open editor for a lesson
  // -------------------------------------------------------
  const handleEditLesson = useCallback((lesson: Lesson) => {
    setEditingLesson(lesson);
    setEditorContent(lesson.content_json || null);
    setEditorHtml(lesson.content_html || '');
    setHasUnsavedChanges(false);
    setLastSaved(lesson.updated_at ? new Date(lesson.updated_at) : null);
    setPreviewMode(false);
  }, []);

  // -------------------------------------------------------
  // Back to list from editor
  // -------------------------------------------------------
  const handleBackToList = useCallback(() => {
    // If there are unsaved changes, save first
    if (hasUnsavedChanges && editingLesson) {
      handleSaveLesson();
    }
    setEditingLesson(null);
    setEditorContent(null);
    setEditorHtml('');
    setHasUnsavedChanges(false);
    setPreviewMode(false);
    setViewingLesson(null);
  }, [hasUnsavedChanges, editingLesson, handleSaveLesson]);

  // -------------------------------------------------------
  // Open student view for a lesson
  // -------------------------------------------------------
  const handleViewLesson = useCallback((lesson: Lesson) => {
    setViewingLesson(lesson);
    setEditorContent(lesson.published_json || lesson.content_json || null);
    setEditorHtml(lesson.content_html || '');
    // v100: record this view in lesson_progress (student only, fire-and-forget)
    if (role === 'student') {
      markLessonProgress(lesson.id, 'view').catch((err) => {
        console.error('[handleViewLesson] Failed to record progress:', err);
      });
      // v110: load this student's bookmarks for the lesson (LMS feature parity)
      setBookmarksLoaded(false);
      setBookmarks([]);
      fetchLessonBookmarks(lesson.id);
    }
  }, [markLessonProgress, role, fetchLessonBookmarks]);

  // -------------------------------------------------------
  // Handle editor content change
  // -------------------------------------------------------
  const handleEditorChange = useCallback(
    (content: any, html: string) => {
      setEditorContent(content);
      setEditorHtml(html);
      if (!hasUnsavedChanges) {
        setHasUnsavedChanges(true);
      }
    },
    [hasUnsavedChanges]
  );

  // -------------------------------------------------------
  // Handle lesson title change
  // -------------------------------------------------------
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!editingLesson) return;
      setEditingLesson({ ...editingLesson, title: e.target.value });
      if (!hasUnsavedChanges) {
        setHasUnsavedChanges(true);
      }
    },
    [editingLesson, hasUnsavedChanges]
  );

  // -------------------------------------------------------
  // Autosave indicator text
  // -------------------------------------------------------
  const autosaveStatus = useMemo(() => {
    if (saving) return t('saving') || 'Saving...';
    if (hasUnsavedChanges) return t('unsavedChanges') || 'Unsaved changes';
    if (lastSaved)
      return `${t('saved') || 'Saved'} · ${formatDateRelative(lastSaved.toISOString())}`;
    return t('saved') || 'Saved';
  }, [saving, hasUnsavedChanges, lastSaved, t, formatDateRelative]);

  // -------------------------------------------------------
  // RENDER: Student Read-Only View
  // -------------------------------------------------------
  if (role === 'student' && viewingLesson) {
    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-5"
      >
        {/* Back button */}
        <motion.div variants={itemVariants}>
          <button
            onClick={handleBackToList}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {isRTL ? (
              <ArrowRight className="h-4 w-4" />
            ) : (
              <ArrowLeft className="h-4 w-4" />
            )}
            {tc('back') || 'Back'}
          </button>
        </motion.div>

        {/* Lesson header */}
        <motion.div variants={itemVariants} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
              {viewingLesson.title}
            </h2>
            <Badge
              variant="outline"
              className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
            >
              <Globe className="h-3 w-3 me-1" />
              {t('published') || 'Published'}
            </Badge>
            {/* v110: free preview badge — students can preview without enrollment */}
            {viewingLesson.is_free_preview && (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
              >
                <Sparkles className="h-3 w-3 me-1" />
                {t('freePreviewLabel') || 'معاينة مجانية'}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
            {viewingLesson.published_at && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatFullDate(viewingLesson.published_at)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              {getWordCount(viewingLesson.content_json)} {t('words') || 'words'}
            </span>
            {/* v110: estimated minutes — LMS feature parity */}
            {viewingLesson.estimated_minutes != null && viewingLesson.estimated_minutes > 0 && (
              <span className="flex items-center gap-1 text-sky-700 dark:text-sky-400">
                <Clock className="h-3.5 w-3.5" />
                {formatEstimatedMinutes(viewingLesson.estimated_minutes)}
              </span>
            )}
            {/* v110: scheduling info — available_from / available_until / due_date */}
            {viewingLesson.available_from && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {t('availableFromLabel') || 'متاح من'}: {formatScheduleDate(viewingLesson.available_from)}
              </span>
            )}
            {viewingLesson.available_until && (
              <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <Calendar className="h-3.5 w-3.5" />
                {t('availableUntilLabel') || 'متاح حتى'}: {formatScheduleDate(viewingLesson.available_until)}
              </span>
            )}
            {viewingLesson.due_date && (
              <span className="flex items-center gap-1 text-rose-700 dark:text-rose-400">
                <Calendar className="h-3.5 w-3.5" />
                {t('dueDateLabel') || 'آخر موعد'}: {formatScheduleDate(viewingLesson.due_date)}
              </span>
            )}
          </div>
          {/* v110: tags row — small badges under the title */}
          {Array.isArray(viewingLesson.tags) && viewingLesson.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Tag className="h-3 w-3 text-muted-foreground/60" />
              {viewingLesson.tags.map((tag, idx) => (
                <Badge key={idx} variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </motion.div>

        {/* v102: Lesson summary (if set) */}
        {viewingLesson.summary && (
          <motion.div variants={itemVariants} className="rounded-2xl border bg-sky-50/40 dark:bg-sky-900/10 p-4">
            <h3 className="text-sm font-bold text-sky-700 dark:text-sky-400 mb-2 flex items-center gap-2">
              <BookMarked className="h-4 w-4" />
              {t('summaryLabel') || 'ملخص الدرس'}
            </h3>
            <p className="text-sm text-foreground leading-relaxed">{viewingLesson.summary}</p>
          </motion.div>
        )}

        {/* v102: Learning objectives (if set) — v110: uses getObjectives helper for safer parsing */}
        {getObjectives(viewingLesson.objectives).length > 0 && (
          <motion.div variants={itemVariants} className="rounded-2xl border bg-emerald-50/40 dark:bg-emerald-900/10 p-4">
            <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-2">
              <Target className="h-4 w-4" />
              {t('objectivesLabel') || 'أهداف التعلم'}
            </h3>
            <ul className="space-y-1.5">
              {getObjectives(viewingLesson.objectives).map((text, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        {/* v102: Video (if video_url or video_id is set) — v110: includes duration + transcript link */}
        {viewingLesson.video_url && (
          <motion.div variants={itemVariants} className="rounded-2xl border bg-card p-2 overflow-hidden">
            <video
              src={viewingLesson.video_url}
              controls
              className="w-full max-h-[480px] rounded-xl"
              preload="metadata"
            />
            {/* v110: video duration badge + transcript toggle */}
            {(viewingLesson.duration_seconds || viewingLesson.transcript) && (
              <div className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-1 flex-wrap">
                {viewingLesson.duration_seconds != null && viewingLesson.duration_seconds > 0 && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Video className="h-3 w-3" />
                    {Math.floor(viewingLesson.duration_seconds / 60)}:{String(Math.floor(viewingLesson.duration_seconds % 60)).padStart(2, '0')}
                  </span>
                )}
                {viewingLesson.transcript && (
                  <button
                    onClick={() => setTranscriptOpen((v) => !v)}
                    className="text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline flex items-center gap-1"
                  >
                    <FileText className="h-3 w-3" />
                    {transcriptOpen ? (t('hideTranscript') || 'إخفاء النص') : (t('showTranscript') || 'عرض النص')}
                  </button>
                )}
              </div>
            )}
            {/* v110: collapsible transcript panel */}
            {viewingLesson.transcript && transcriptOpen && (
              <div className="mx-2 mb-2 p-3 rounded-lg bg-muted/40 border border-muted text-sm text-foreground whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {viewingLesson.transcript}
              </div>
            )}
          </motion.div>
        )}

        {/* Lesson content */}
        <motion.div variants={itemVariants}>
          <RichTextEditor
            content={
              viewingLesson.published_json || viewingLesson.content_json
            }
            editable={false}
            dir={direction === 'rtl' ? 'rtl' : 'ltr'}
          />
        </motion.div>

        {/* v100: Mark as complete / Reset progress — student only */}
        <motion.div variants={itemVariants} className="rounded-2xl border bg-card p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isLessonCompleted(viewingLesson.id)
                ? 'bg-emerald-500 text-white'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            }`}>
              {isLessonCompleted(viewingLesson.id)
                ? <CheckCircle2 className="h-5 w-5" />
                : <BookOpen className="h-5 w-5" />}
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">
                {isLessonCompleted(viewingLesson.id)
                  ? (t('lessonCompleted') || 'تم إكمال هذا الدرس')
                  : (t('markLessonComplete') || 'هل أكملت هذا الدرس؟')}
              </p>
              <p className="text-xs text-muted-foreground">
                {isLessonCompleted(viewingLesson.id)
                  ? (t('canUnmarkHint') || 'يمكنك إلغاء التحديد لمراجعته مرة أخرى')
                  : (t('markCompleteHint') || 'حدّده كمكتمل لمتابعة تقدمك في المقرر')}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              const newAction = isLessonCompleted(viewingLesson.id) ? 'reset' : 'complete';
              markLessonProgress(viewingLesson.id, newAction).then(() => {
                toast.success(newAction === 'complete'
                  ? (t('markedComplete') || 'تم تحديد الدرس كمكتمل')
                  : (t('markedIncomplete') || 'تم إلغاء التحديد'));
              }).catch(() => {
                toast.error(t('progressUpdateFailed') || 'فشل تحديث التقدم');
              });
            }}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.97] ${
              isLessonCompleted(viewingLesson.id)
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isLessonCompleted(viewingLesson.id) ? (
              <>
                <X className="h-4 w-4" />
                {t('unmarkAsComplete') || 'إلغاء التحديد'}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {t('markAsComplete') || 'تحديد كمكتمل'}
              </>
            )}
          </button>
        </motion.div>

        {/* v102: Student notes panel — collapsible, saved per-lesson */}
        <StudentNotesPanel
          lessonId={viewingLesson.id}
          dir={direction === 'rtl' ? 'rtl' : 'ltr'}
          labels={{
            title: t('myNotesLabel') || 'ملاحظاتي على هذا الدرس',
            placeholder: t('notesPlaceholder') || 'اكتب ملاحظاتك هنا... (تُحفظ تلقائياً)',
            saved: t('notesSaved') || 'تم الحفظ',
            saveFailed: t('notesSaveFailed') || 'فشل الحفظ',
            expand: t('expandNotes') || 'فتح الملاحظات',
            collapse: t('collapseNotes') || 'إغلاق',
          }}
        />

        {/* v110: Student bookmarks panel — quick-add + list existing bookmarks.
            LMS feature parity (Thinkific / Teachable / Coursera all support per-lesson
            bookmarks so students can jump back to specific spots later). */}
        <StudentBookmarksPanel
          lessonId={viewingLesson.id}
          bookmarks={bookmarks}
          loaded={bookmarksLoaded}
          dir={direction === 'rtl' ? 'rtl' : 'ltr'}
          labels={{
            title: t('myBookmarksLabel') || 'مفضلاتي في هذا الدرس',
            placeholder: t('bookmarkPlaceholder') || 'اكتب عنوان للم bookmark...',
            add: t('addBookmark') || 'حفظ',
            empty: t('noBookmarksYet') || 'لا توجد مفضلات بعد — أضف واحدة للعودة لمكان محدد لاحقاً.',
            deleteFailed: t('bookmarkDeleteFailed') || 'فشل حذف المفضلة',
          }}
          onAdd={(label) => handleAddBookmark(viewingLesson.id, label)}
          onDelete={(bmId) => handleDeleteBookmark(viewingLesson.id, bmId)}
        />
      </motion.div>
    );
  }

  // -------------------------------------------------------
  // RENDER: Teacher Editor View
  // -------------------------------------------------------
  if (role === 'teacher' && editingLesson) {
    return (
      <motion.div
        variants={editorVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col md:flex-row h-[calc(100vh-180px)] md:h-[calc(100vh-280px)] min-h-[400px] md:min-h-[500px] rounded-xl border bg-background overflow-hidden"
        dir={direction}
      >
        {/* Left sidebar */}
        <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-e flex flex-col bg-muted/20 max-h-[200px] md:max-h-none overflow-y-auto">
          {/* Back button */}
          <div className="p-4 border-b">
            <button
              onClick={handleBackToList}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full"
            >
              {isRTL ? (
                <ArrowRight className="h-4 w-4" />
              ) : (
                <ArrowLeft className="h-4 w-4" />
              )}
              {tc('back') || 'Back'}
            </button>
          </div>

          {/* Lesson title */}
          <div className="px-4 py-2 md:p-4 md:space-y-3 border-b flex items-center gap-2 md:flex-col md:items-start">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
              {t('lessonTitle') || 'Lesson Title'}
            </label>
            <Input
              value={editingLesson.title}
              onChange={handleTitleChange}
              className="text-sm font-semibold"
              placeholder={t('enterTitle') || 'Enter lesson title...'}
              dir={direction}
            />
          </div>

          {/* Status */}
          <div className="px-4 py-2 md:p-4 md:space-y-3 border-b flex items-center gap-2 md:flex-col md:items-start">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
              {tCourse('status') || 'Status'}
            </label>
            <div>
              {editingLesson.status === 'draft' ? (
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
                >
                  <Lock className="h-3 w-3 me-1" />
                  {t('draft') || 'Draft'}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                >
                  <Globe className="h-3 w-3 me-1" />
                  {t('published') || 'Published'}
                </Badge>
              )}
            </div>
          </div>

          {/* Autosave indicator */}
          <div className="px-4 py-2 md:p-4 md:space-y-3 border-b flex items-center gap-2 md:flex-col md:items-start">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
              {t('saveStatus') || 'Save Status'}
            </label>
            <div className="flex items-center gap-2 text-xs">
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              ) : hasUnsavedChanges ? (
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              ) : (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              )}
              <span
                className={
                  saving
                    ? 'text-amber-600'
                    : hasUnsavedChanges
                    ? 'text-amber-600'
                    : 'text-emerald-600'
                }
              >
                {autosaveStatus}
              </span>
            </div>
          </div>

          {/* Lesson metadata */}
          <div className="hidden md:block p-4 space-y-3 flex-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('metadata') || 'Details'}
            </label>
            <div className="space-y-2.5 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>{t('created') || 'Created'}</span>
                <span>{formatDateRelative(editingLesson.created_at)}</span>
              </div>
              {lastSaved && (
                <div className="flex items-center justify-between">
                  <span>{t('lastSaved') || 'Last saved'}</span>
                  <span>{formatDateRelative(lastSaved.toISOString())}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>{t('wordCount') || 'Word count'}</span>
                <span>{getWordCount(editorContent)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5 bg-muted/10">
            <div className="flex items-center gap-2">
              {/* Preview toggle */}
              <Button
                variant={previewMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPreviewMode(!previewMode)}
                className="text-xs h-8"
              >
                <Eye className="h-3.5 w-3.5 me-1" />
                {tc('preview') || 'Preview'}
              </Button>
              {/* v110: Lesson settings toggle — opens a panel with all the v102 LMS fields
                  (summary, objectives, video_url, scheduling, free_preview, etc.).
                  These exist in the DB + PUT endpoint but had no UI before. */}
              <Button
                variant={showLessonSettings ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowLessonSettings((v) => !v)}
                className="text-xs h-8"
              >
                <Settings className="h-3.5 w-3.5 me-1" />
                {t('lessonSettingsLabel') || 'إعدادات الدرس'}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {/* Save button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveLesson}
                disabled={saving || !hasUnsavedChanges}
                className="text-xs h-8"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 me-1" />
                )}
                {tc('save') || 'Save'}
              </Button>
            </div>
          </div>

          {/* v110: Lesson settings panel — toggled by the Settings button above.
              Renders inline (above the editor) when showLessonSettings is true.
              Contains all v102 LMS fields: summary, objectives, video, scheduling, etc.
              Has its own Save button — does NOT use the content autosave (these fields
              require explicit save so teachers don't accidentally publish wrong metadata). */}
          {showLessonSettings && (
            <LessonSettingsPanel
              lesson={editingLesson}
              dir={direction === 'rtl' ? 'rtl' : 'ltr'}
              onSaved={(updated) => {
                // Update the local editingLesson + lessons list with the new fields
                setEditingLesson({ ...editingLesson, ...updated });
                setLessons((prev) =>
                  prev.map((l) => (l.id === editingLesson.id ? { ...l, ...updated } : l))
                );
              }}
              labels={{
                title: t('lessonSettingsTitle') || 'إعدادات الدرس',
                summary: t('summaryLabel') || 'ملخص الدرس',
                summaryHint: t('summaryHint') || 'يظهر للطالب أعلى المحتوى — سطر أو اثنان.',
                objectives: t('objectivesLabel') || 'أهداف التعلم',
                objectivesHint: t('objectivesHint') || 'أهداف يحققها الطالب بعد إكمال الدرس.',
                objectivePlaceholder: t('objectivePlaceholder') || 'اكتب هدفاً ثم اضغط Enter',
                videoUrl: t('videoUrlLabel') || 'رابط الفيديو',
                videoUrlHint: t('videoUrlHint') || 'YouTube / Vimeo / MP4 مطلق.',
                estimatedMinutes: t('estimatedMinutesLabel') || 'الوقت المقدر (دقائق)',
                tags: t('tagsLabel') || 'الوسوم',
                tagsHint: t('tagsHint') || 'وسوم مفصولة بفواصل لتنظيم الدروس.',
                tagPlaceholder: t('tagPlaceholder') || 'أضف وسماً...',
                dueDate: t('dueDateLabel') || 'آخر موعد للتسليم',
                availableFrom: t('availableFromLabel') || 'متاح من',
                availableUntil: t('availableUntilLabel') || 'متاح حتى',
                freePreview: t('freePreviewLabel') || 'معاينة مجانية',
                freePreviewHint: t('freePreviewHint') || 'الطلاب غير المشتركين يمكنهم معاينة هذا الدرس.',
                instructorNotes: t('instructorNotesLabel') || 'ملاحظات المُعلِّم',
                instructorNotesHint: t('instructorNotesHint') || 'ملاحظات خاصة بك — لا تظهر للطلاب.',
                transcript: t('transcriptLabel') || 'نص الفيديو',
                transcriptHint: t('transcriptHint') || 'نص كامل للفيديو لإمكانية الوصول.',
                save: tc('save') || 'Save',
                cancel: tc('cancel') || 'Cancel',
                saveFailed: t('saveFailed') || 'فشل الحفظ',
                saved: t('lessonSaved') || 'تم حفظ الدرس',
                add: t('add') || 'إضافة',
              }}
            />
          )}

          {/* Editor / Preview area */}
          <div className="flex-1 overflow-y-auto p-4">
            {previewMode ? (
              <div className="max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold text-foreground mb-4">
                  {editingLesson.title}
                </h1>
                <div
                  className="prose-editor max-w-none"
                  dangerouslySetInnerHTML={{ __html: editorHtml || '' }}
                />
              </div>
            ) : (
              <RichTextEditor
                content={editorContent}
                onChange={handleEditorChange}
                placeholder={
                  t('startWriting') || 'Start writing your lesson...'
                }
                subjectId={subject.id}
                userId={profile.id}
                dir={direction === 'rtl' ? 'rtl' : 'ltr'}
              />
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // -------------------------------------------------------
  // RENDER: List View (Default)
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      {/* Header — LMS-style compact summary */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-sky-700 dark:text-sky-400" />
            {t('title') || 'محتوى المقرر'}
            {/* v100: "Resume last lesson" button — students only, when a lastLessonId exists */}
            {role === 'student' && lastLessonId && (() => {
              const lastLesson = visibleLessons.find((l) => l.id === lastLessonId);
              if (!lastLesson) return null;
              return (
                <button
                  onClick={() => handleViewLesson(lastLesson)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors ms-2"
                  title={t('resumeLastLesson') || 'استئناف من آخر درس'}
                >
                  <Play className="h-3.5 w-3.5" />
                  {t('resumeLastLesson') || 'استئناف'}
                </button>
              );
            })()}
          </h3>
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-2 flex-wrap">
            {units.length > 0 ? (
              <>
                <Badge variant="secondary" className="text-[10px] me-1 px-1.5 py-0">
                  <Layers className="h-2.5 w-2.5 me-1" />
                  {units.length} {t('unitsCountLabel') || 'وحدة'}
                </Badge>
                {' '}
                <BookOpen className="h-3 w-3 inline me-1" />
                {t('lessonCount', { count: visibleLessons.length }) || `${visibleLessons.length} درس`}
              </>
            ) : (
              <>
                <BookOpen className="h-3 w-3 inline me-1" />
                {t('lessonCount', { count: visibleLessons.length }) ||
                  `${visibleLessons.length} lesson(s)`}
              </>
            )}
            {/* v100: show progress percent for students when there are visible lessons */}
            {role === 'student' && visibleLessons.length > 0 && (
              <>
                <span className="text-muted-foreground/40 mx-1">•</span>
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                  <CheckCircle2 className="h-3 w-3" />
                  {completedCount} / {visibleLessons.length} {t('completedLabel') || 'مكتمل'}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({Math.round((completedCount / Math.max(visibleLessons.length, 1)) * 100)}%)
                </span>
              </>
            )}
          </p>
          {/* v100: overall progress bar for students */}
          {role === 'student' && visibleLessons.length > 0 && (
            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden max-w-md">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500"
                style={{ width: `${Math.round((completedCount / Math.max(visibleLessons.length, 1)) * 100)}%` }}
              />
            </div>
          )}
        </div>
        {role === 'teacher' && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUnitsManager(true)}
              className="h-8"
            >
              <Layers className="h-4 w-4 me-1" />
              {units.length > 0
                ? (t('manageUnits') || 'إدارة الوحدات')
                : (t('createFirstUnit') || 'إنشاء وحدة أولى')}
            </Button>
            {/* v99: removed the standalone "Create Lesson" button — lessons now
                REQUIRE a unit. Teachers add lessons via the inline "+ إضافة درس إلى
                هذه الوحدة" button inside each unit card. */}
          </div>
        )}
      </motion.div>

      {/* Lessons grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
        </div>
      ) : visibleLessons.length === 0 && units.length === 0 ? (
        /* v99: improved empty state — when no units AND no lessons, ONLY offer to create a unit */
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 dark:border-sky-900/60 bg-gradient-to-b from-sky-50/40 dark:from-sky-900/10 to-transparent py-16 px-4"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-100 dark:bg-sky-800/40 mb-5 ring-4 ring-sky-50 dark:ring-sky-900/30">
            <BookOpen className="h-10 w-10 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1">
            {t('noLessonsYet') || 'لا يوجد محتوى بعد'}
          </p>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
            {role === 'teacher'
              ? (t('startByCreatingUnit') || 'ابدأ بإنشاء وحدة لتنظيم دروسك. كل وحدة تحتوي على مجموعة من الدروس تظهر للطلاب بشكل تسلسلي. لا يمكن إنشاء درس بدون وحدة.')
              : (t('noLessonsPublished') || 'لا توجد دروس منشورة في هذا المقرر بعد.')}
          </p>
          {role === 'teacher' && (
            <button
              onClick={() => setShowUnitsManager(true)}
              className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sky-800 active:scale-[0.97]"
            >
              <Layers className="h-4 w-4" />
              {t('createFirstUnit') || 'إنشاء وحدة أولى'}
            </button>
          )}
        </motion.div>
      ) : units.length === 0 && visibleLessons.length > 0 && role === 'teacher' ? (
        /* v99: hint banner — lessons exist but no units, encourage organizing */
        <motion.div variants={itemVariants} className="space-y-4">
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
              <span className="text-lg">💡</span>
              <span>{t('organizeLessonsHint') || 'نظّم دروسك في وحدات لتحسين تجربة الطالب. كل وحدة تظهر كقسم منفصل في المحتوى.'}</span>
            </div>
            <button
              onClick={() => setShowUnitsManager(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Layers className="h-3.5 w-3.5" />
              {t('createUnit') || 'إنشاء وحدة'}
            </button>
          </div>
          {/* Flat grid fallback (no units) */}
          <AnimatePresence>
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {visibleLessons.map((lesson) => (
                <motion.div
                  key={lesson.id}
                  variants={itemVariants}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  layout
                  className="rounded-xl border bg-card shadow-sm hover:shadow-md transition-all overflow-hidden cursor-pointer group"
                  onClick={() => role === 'teacher' ? handleEditLesson(lesson) : handleViewLesson(lesson)}
                >
                  <div className={`h-1 ${lesson.status === 'published' ? 'bg-emerald-500' : 'bg-amber-400 dark:bg-amber-500'}`} />
                  <div className="p-4">
                    <h4 className="text-sm font-bold text-foreground line-clamp-2 mb-2">{lesson.title}</h4>
                    <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                      {lesson.status === 'draft' ? (
                        <Badge variant="outline" className="text-[10px] border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                          <Lock className="h-2.5 w-2.5 me-1" />
                          {t('draft') || 'مسودة'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                          <Globe className="h-2.5 w-2.5 me-1" />
                          {t('published') || 'منشور'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-muted/50 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatDateRelative(lesson.status === 'published' ? lesson.published_at || lesson.updated_at : lesson.updated_at)}</span>
                      </div>
                      {getWordCount(lesson.content_json) > 0 && (
                        <div className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          <span>{getWordCount(lesson.content_json)} {t('words') || 'كلمة'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      ) : units.length > 0 ? (
        // v99: LMS-style hierarchical view — collapsible units + list-style lessons + progress bar
        <div className="space-y-4">
          {units.map((unit, unitIdx) => {
            const unitLessons = visibleLessons.filter((l) => l.unit_id === unit.id);
            // v110: A unit is "locked" for a student when EITHER:
            //   - is_enabled === false  (teacher explicitly disabled the unit — v98)
            //   - is_published === false (teacher marked as draft — was invisible before v110;
            //     now visible-but-locked per user request)
            // Teachers/admins never see the lock — they can always open lessons.
            const isUnitLocked = role !== 'teacher' && (unit.is_enabled === false || unit.is_published === false);
            // v110: ALWAYS show all units to students — even unpublished ones
            // (visible but locked with a lock icon) and even if they have 0
            // published lessons (empty units show "no published lessons yet").
            // This matches the user's requirement: the unit appears but can't
            // be opened, with a lock icon.
            const isCollapsed = !!collapsedUnits[unit.id];
            const unitNumber = unitIdx + 1;

            return (
              <motion.div
                key={unit.id}
                variants={itemVariants}
                initial="hidden"
                animate="visible"
                className={`rounded-2xl border bg-card overflow-hidden shadow-sm transition-shadow hover:shadow-md ${
                  isUnitLocked ? 'border-amber-200 dark:border-amber-900/40' : 'border-sky-100 dark:border-sky-900/40'
                }`}
              >
                {/* Unit header — clickable to collapse/expand */}
                <button
                  type="button"
                  onClick={() => toggleUnitCollapse(unit.id)}
                  className={`w-full text-start px-4 sm:px-5 py-4 flex items-center gap-3 transition-colors ${
                    isUnitLocked ? 'bg-amber-50/40 dark:bg-amber-900/10 hover:bg-amber-50/70 dark:hover:bg-amber-900/20' : 'bg-muted/30 hover:bg-muted/50'
                  }`}
                >
                  {/* Unit number badge */}
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                    isUnitLocked
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                      : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400'
                  }`}>
                    {isUnitLocked ? <Lock className="h-5 w-5" /> : unitNumber}
                  </div>

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-bold text-base sm:text-lg truncate ${isUnitLocked ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {unit.title}
                      </h3>
                      {!unit.is_published && role === 'teacher' && (
                        <Badge variant="outline" className="text-[10px] border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                          {t('unitDraft') || 'مسودة'}
                        </Badge>
                      )}
                      {/* v110: For students, distinguish between unpublished (draft)
                          and disabled units — both render with a lock icon but the
                          badge label differs so the student understands why it's locked.
                          Note: `isUnitLocked` already implies `role !== 'teacher'`
                          (defined above), so we don't re-check it here — TypeScript
                          narrows `role` to 'student' once `isUnitLocked` is true. */}
                      {isUnitLocked && unit.is_published === false && (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-900/40">
                          <Lock className="h-2.5 w-2.5 me-1" />
                          {t('unitUnpublished') || 'غير منشورة'}
                        </Badge>
                      )}
                      {isUnitLocked && unit.is_enabled === false && (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-900/40">
                          <Lock className="h-2.5 w-2.5 me-1" />
                          {t('unitDisabled') || 'متوقفة'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3 w-3" />
                        {unitLessons.length} {t('lessonsLabel') || 'دروس'}
                      </span>
                      {unit.pass_threshold != null && (
                        <span className="flex items-center gap-1">
                          <Target className="h-3 w-3" />
                          {t('passThreshold') || 'نجاح'}: {unit.pass_threshold}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Collapse chevron */}
                  <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
                </button>

                {/* Lessons list — visible only when expanded */}
                {!isCollapsed && (
                  <div className="border-t border-muted/50">
                    {unitLessons.length === 0 ? (
                      <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                        {role === 'teacher'
                          ? (t('noLessonsInUnit') || 'لا توجد دروس في هذه الوحدة بعد')
                          : (t('noLessonsPublishedInUnit') || 'لا توجد دروس منشورة في هذه الوحدة بعد')}
                      </div>
                    ) : (
                      <div className="divide-y divide-muted/40">
                        {unitLessons.map((lesson, lessonIdx) => {
                          const lessonNumber = lessonIdx + 1;
                          return (
                            <div
                              key={lesson.id}
                              className={`group px-4 sm:px-5 py-3 flex items-center gap-3 transition-colors ${
                                isUnitLocked
                                  ? 'opacity-60 cursor-not-allowed'
                                  : 'hover:bg-muted/30 cursor-pointer'
                              }`}
                              onClick={() => {
                                if (isUnitLocked) {
                                  toast.error(t('unitLockedToast') || 'الوحدة متوقفة — لا يمكن فتح الدرس');
                                  return;
                                }
                                if (role === 'teacher') handleEditLesson(lesson);
                                else handleViewLesson(lesson);
                              }}
                            >
                              {/* Sequential number circle (or ✓ if completed) */}
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                                isUnitLocked
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                  : isLessonCompleted(lesson.id)
                                    ? 'bg-emerald-500 text-white'
                                    : lesson.status === 'published'
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              }`}>
                                {isLessonCompleted(lesson.id) ? <CheckCircle2 className="h-4 w-4" /> : lessonNumber}
                              </div>

                              {/* Title + excerpt */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className={`text-sm font-semibold line-clamp-1 ${isLessonCompleted(lesson.id) ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'}`}>
                                    {lesson.title}
                                  </h4>
                                  {lesson.status === 'draft' ? (
                                    <Badge variant="outline" className="text-[10px] border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                                      {t('draft') || 'مسودة'}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                                      <Globe className="h-2.5 w-2.5 me-1" />
                                      {t('published') || 'منشور'}
                                    </Badge>
                                  )}
                                  {isLessonCompleted(lesson.id) && (
                                    <Badge variant="outline" className="text-[10px] border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                                      <CheckCircle2 className="h-2.5 w-2.5 me-1" />
                                      {t('completedLabel') || 'مكتمل'}
                                    </Badge>
                                  )}
                                  {lesson.pass_threshold != null && lesson.pass_threshold > 0 && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {t('passThreshold') || 'نجاح'}: {lesson.pass_threshold}%
                                    </Badge>
                                  )}
                                </div>
                                {getExcerpt(lesson.content_json) && (
                                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                    {getExcerpt(lesson.content_json)}
                                  </p>
                                )}
                                <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-2.5 w-2.5" />
                                    {formatDateRelative(lesson.status === 'published' ? lesson.published_at || lesson.updated_at : lesson.updated_at)}
                                  </span>
                                  {getWordCount(lesson.content_json) > 0 && (
                                    <span className="flex items-center gap-1">
                                      <FileText className="h-2.5 w-2.5" />
                                      {getWordCount(lesson.content_json)} {t('words') || 'كلمة'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Teacher kebab menu */}
                              {role === 'teacher' && !isUnitLocked && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      onClick={(e) => e.stopPropagation()}
                                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEditLesson(lesson); }}>
                                      <Pencil className="h-4 w-4 me-2" />
                                      {tc('edit') || 'تعديل'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(lesson); }}>
                                      <Copy className="h-4 w-4 me-2" />
                                      {t('duplicate') || 'تكرار'}
                                    </DropdownMenuItem>
                                    {units.length > 0 && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger onClick={(e) => e.stopPropagation()} className="gap-2">
                                            <FolderTree className="h-4 w-4 me-2" />
                                            {t('moveToUnit') || 'نقل لوحدة'}
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleMoveToUnit(lesson, null); }}>
                                              <BookOpen className="h-4 w-4 me-2" />
                                              {t('standalone') || 'مستقل'}
                                              {!lesson.unit_id && <Check className="h-3 w-3 ms-auto" />}
                                            </DropdownMenuItem>
                                            {units.map((u) => (
                                              <DropdownMenuItem key={u.id} onClick={(e) => { e.stopPropagation(); handleMoveToUnit(lesson, u.id); }}>
                                                <Layers className="h-4 w-4 me-2" />
                                                <span className="truncate">{u.title}</span>
                                                {lesson.unit_id === u.id && <Check className="h-3 w-3 ms-auto" />}
                                              </DropdownMenuItem>
                                            ))}
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                      </>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const isUnpublish = lesson.status === 'published';
                                        try {
                                          const headers = await getAuthHeaders();
                                          const res = await fetch(`/api/lessons/${lesson.id}/publish`, {
                                            method: 'POST',
                                            headers,
                                            body: JSON.stringify({ unpublish: isUnpublish }),
                                          });
                                          if (!res.ok) {
                                            const data = await res.json().catch(() => ({}));
                                            toast.error(data.error || t('publishFailed') || 'Failed');
                                            return;
                                          }
                                          const data = await res.json();
                                          const newStatus: 'draft' | 'published' = data.status || (isUnpublish ? 'draft' : 'published');
                                          setLessons((prev) => prev.map((l) => l.id === lesson.id ? { ...l, status: newStatus, published_at: newStatus === 'published' ? new Date().toISOString() : null } : l));
                                          toast.success(newStatus === 'published' ? t('lessonPublished') || 'تم النشر' : t('lessonUnpublished') || 'تم إلغاء النشر');
                                        } catch (err) {
                                          console.error('Error toggling publish:', err);
                                          toast.error(t('publishFailed') || 'Failed');
                                        }
                                      }}
                                    >
                                      {lesson.status === 'published' ? (
                                        <><Lock className="h-4 w-4 me-2" />{t('unpublish') || 'إلغاء النشر'}</>
                                      ) : (
                                        <><Globe className="h-4 w-4 me-2" />{t('publish') || 'نشر'}</>
                                      )}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(lesson.id); }}>
                                      <Trash2 className="h-4 w-4 me-2" />
                                      {tc('delete') || 'حذف'}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          );
                        })}

                      </div>
                    )}
                    {/* v110: Inline "Add lesson to this unit" — teacher only, ALWAYS visible
                        whether the unit is empty or has lessons. Moved OUTSIDE the
                        unitLessons.length === 0 conditional so teachers can add a lesson
                        even when the unit is currently empty. */}
                    {role === 'teacher' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCreateLesson(unit.id); }}
                        disabled={creatingLesson}
                        className="w-full px-5 py-3 flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-400 hover:bg-sky-50/50 dark:hover:bg-sky-900/10 transition-colors border-t-2 border-dashed border-sky-200/60 dark:border-sky-900/30 disabled:opacity-50"
                      >
                        {creatingLesson ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        {t('addLessonToUnit') || 'إضافة درس إلى هذه الوحدة'}
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}

          {/* Standalone lessons (no unit_id) — render as a list at the bottom */}
          {(() => {
            const standaloneLessons = visibleLessons.filter((l) => !l.unit_id);
            if (standaloneLessons.length === 0) return null;
            return (
              <motion.div
                variants={itemVariants}
                initial="hidden"
                animate="visible"
                className="rounded-2xl border-2 border-dashed border-sky-200 dark:border-sky-900/40 bg-card overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-muted/50 bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                    <h3 className="font-bold text-base">
                      {t('standaloneLessons') || 'دروس بدون وحدة'}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {standaloneLessons.length}
                    </Badge>
                  </div>
                  {role === 'teacher' && (
                    <span className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                      <span className="text-base">💡</span>
                      {t('moveToUnitHint') || 'انقل هذه الدروس إلى وحدات لتنظيم المحتوى'}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-muted/40">
                  {standaloneLessons.map((lesson, lessonIdx) => (
                    <div
                      key={lesson.id}
                      className="group px-5 py-3 flex items-center gap-3 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => role === 'teacher' ? handleEditLesson(lesson) : handleViewLesson(lesson)}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        lesson.status === 'published'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {lessonIdx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold text-foreground line-clamp-1">
                            {lesson.title}
                          </h4>
                          {lesson.status === 'draft' ? (
                            <Badge variant="outline" className="text-[10px] border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                              {t('draft') || 'مسودة'}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                              <Globe className="h-2.5 w-2.5 me-1" />
                              {t('published') || 'منشور'}
                            </Badge>
                          )}
                          {lesson.pass_threshold != null && lesson.pass_threshold > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              {t('passThreshold') || 'نجاح'}: {lesson.pass_threshold}%
                            </Badge>
                          )}
                        </div>
                        {getExcerpt(lesson.content_json) && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {getExcerpt(lesson.content_json)}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {formatDateRelative(lesson.status === 'published' ? lesson.published_at || lesson.updated_at : lesson.updated_at)}
                          </span>
                          {getWordCount(lesson.content_json) > 0 && (
                            <span className="flex items-center gap-1">
                              <FileText className="h-2.5 w-2.5" />
                              {getWordCount(lesson.content_json)} {t('words') || 'كلمة'}
                            </span>
                          )}
                        </div>
                      </div>
                      {role === 'teacher' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEditLesson(lesson); }}>
                              <Pencil className="h-4 w-4 me-2" />
                              {tc('edit') || 'تعديل'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(lesson); }}>
                              <Copy className="h-4 w-4 me-2" />
                              {t('duplicate') || 'تكرار'}
                            </DropdownMenuItem>
                            {units.length > 0 && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger onClick={(e) => e.stopPropagation()} className="gap-2">
                                    <FolderTree className="h-4 w-4 me-2" />
                                    {t('moveToUnit') || 'نقل لوحدة'}
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleMoveToUnit(lesson, null); }}>
                                      <BookOpen className="h-4 w-4 me-2" />
                                      {t('standalone') || 'مستقل'}
                                      {!lesson.unit_id && <Check className="h-3 w-3 ms-auto" />}
                                    </DropdownMenuItem>
                                    {units.map((u) => (
                                      <DropdownMenuItem key={u.id} onClick={(e) => { e.stopPropagation(); handleMoveToUnit(lesson, u.id); }}>
                                        <Layers className="h-4 w-4 me-2" />
                                        <span className="truncate">{u.title}</span>
                                        {lesson.unit_id === u.id && <Check className="h-3 w-3 ms-auto" />}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(lesson.id); }}>
                              <Trash2 className="h-4 w-4 me-2" />
                              {tc('delete') || 'حذف'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })()}
        </div>
      ) : null}


      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent dir={direction}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('deleteTitle') || 'Delete Lesson'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm') ||
                'Are you sure you want to delete this lesson? This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel') || 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId) handleDelete(confirmDeleteId);
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {tc('delete') || 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v63: Manage Units Dialog */}
      <Dialog open={showUnitsManager} onOpenChange={setShowUnitsManager}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto" dir={direction}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              {t('manageUnits') || 'Manage Units'}
            </DialogTitle>
            <DialogDescription>
              {t('manageUnitsDesc') || 'Create, edit, and reorder units. Set pass thresholds to gate student progression between units.'}
            </DialogDescription>
          </DialogHeader>
          <UnitsInlineManager subject={subject} onChanged={fetchUnits} />
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

// -------------------------------------------------------
// v63: Inline Units Manager (used inside Dialog)
// -------------------------------------------------------
function UnitsInlineManager({ subject, onChanged }: { subject: Subject; onChanged?: () => void }) {
  const { t } = useTranslations('lessons');
  const [units, setUnits] = useState<LessonUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUnit, setEditingUnit] = useState<LessonUnit | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [passThreshold, setPassThreshold] = useState<number>(60);
  const [isPublished, setIsPublished] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteUnit, setDeleteUnit] = useState<LessonUnit | null>(null);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lesson-units?subject_id=${subject.id}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch units');
      const data = await res.json();
      setUnits(data.units || []);
    } catch (err) {
      console.error('[UnitsInlineManager] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [subject.id]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPassThreshold(60);
    setIsPublished(true);
    setEditingUnit(null);
  };

  const openAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (u: LessonUnit) => {
    setEditingUnit(u);
    setTitle(u.title);
    setDescription(u.description || '');
    setPassThreshold(u.pass_threshold ?? 60);
    setIsPublished(u.is_published);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error(t('unitTitleRequired') || 'Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        subject_id: subject.id,
        title: title.trim(),
        description: description.trim() || null,
        pass_threshold: passThreshold,
        is_published: isPublished,
      };
      const authHeaders = await getAuthHeaders();
      const headers = { 'Content-Type': 'application/json', ...authHeaders };
      const res = editingUnit
        ? await fetch(`/api/lesson-units/${editingUnit.id}`, { method: 'PUT', headers, body: JSON.stringify(payload) })
        : await fetch('/api/lesson-units', { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Save failed');
      }
      toast.success(editingUnit ? t('unitUpdated') || 'Unit updated' : t('unitCreated') || 'Unit created');
      setShowForm(false);
      resetForm();
      fetchUnits();
      onChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save unit');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteUnit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/lesson-units/${deleteUnit.id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Delete failed');
      }
      toast.success(t('unitDeleted') || 'Unit deleted');
      setDeleteUnit(null);
      fetchUnits();
      onChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete unit');
    } finally {
      setSaving(false);
    }
  };

  const moveUnit = async (index: number, dir: 'up' | 'down') => {
    if (dir === 'up' && index === 0) return;
    if (dir === 'down' && index === units.length - 1) return;
    const newOrder = [...units];
    const swap = dir === 'up' ? index - 1 : index + 1;
    [newOrder[index], newOrder[swap]] = [newOrder[swap], newOrder[index]];
    setUnits(newOrder);
    const reorderHeaders = await getAuthHeaders();
    try {
      await fetch('/api/lesson-units/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...reorderHeaders },
        body: JSON.stringify({
          subject_id: subject.id,
          ordered_unit_ids: newOrder.map((u) => u.id),
        }),
      });
    } catch {
      fetchUnits();
    }
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : units.length === 0 ? (
        <div className="text-center py-6 border border-dashed rounded-lg">
          <Layers className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground mb-3">
            {t('noUnits') || 'No units yet. Create your first unit to organize lessons.'}
          </p>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 me-1" />
            {t('addFirstUnit') || 'Add First Unit'}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {units.map((u, idx) => (
              <div key={u.id} className="flex items-start gap-2 p-3 rounded-lg border">
                <div className="flex flex-col gap-0.5 pt-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveUnit(idx, 'up')} disabled={idx === 0}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveUnit(idx, 'down')} disabled={idx === units.length - 1}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{u.title}</span>
                    {!u.is_published && <Badge variant="outline" className="text-xs">{t('unitDraft') || 'Draft'}</Badge>}
                    {typeof u.lesson_count === 'number' && (
                      <Badge variant="secondary" className="text-xs">
                        <BookOpen className="h-3 w-3 me-1" />
                        {u.lesson_count}
                      </Badge>
                    )}
                    {u.pass_threshold != null && (
                      <Badge variant="outline" className="text-xs">
                        {t('passThreshold') || 'Pass'}: {u.pass_threshold}%
                      </Badge>
                    )}
                  </div>
                  {u.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{u.description}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteUnit(u)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={openAdd} className="w-full">
            <Plus className="h-4 w-4 me-1" />
            {t('addUnit') || 'Add Unit'}
          </Button>
        </>
      )}

      {showForm && (
        <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
          <div className="space-y-1.5">
            <Label htmlFor="u-title">{t('unitTitle') || 'Unit Title'}</Label>
            <Input id="u-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving} placeholder={t('unitTitlePlaceholder') || 'e.g. Unit 1: Basics'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-desc">{t('unitDescription') || 'Description'}</Label>
            <Textarea id="u-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-threshold">{t('passThreshold') || 'Pass Threshold'} (%)</Label>
            <Input id="u-threshold" type="number" min={0} max={100} value={passThreshold} onChange={(e) => setPassThreshold(Number(e.target.value))} disabled={saving} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="u-pub">{t('published') || 'Published'}</Label>
            <Switch id="u-pub" checked={isPublished} onCheckedChange={setIsPublished} disabled={saving} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); resetForm(); }} disabled={saving}>
              {tc_cancel(t)}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !title.trim()}>
              {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              {editingUnit ? t('save') || 'Save' : t('create') || 'Create'}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteUnit} onOpenChange={(o) => !o && setDeleteUnit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteUnitTitle') || 'Delete Unit'}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteUnitConfirm') || 'Are you sure? Lessons inside will remain but become unassigned.'}
              <br /><strong>{deleteUnit?.title}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t('cancel') || 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              {t('delete') || 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Helper: get a localized "Cancel" string
function tc_cancel(t: (k: string) => string) {
  return t('cancel') || 'Cancel';
}

// =====================================================
// v102: StudentNotesPanel — collapsible notes panel for student lessons
// One note per (lesson, student) — uses lesson_notes table.
// Auto-saves with debounce (1.5s after last keystroke).
// =====================================================

interface StudentNotesPanelProps {
  lessonId: string;
  dir: 'rtl' | 'ltr';
  labels: {
    title: string;
    placeholder: string;
    saved: string;
    saveFailed: string;
    expand: string;
    collapse: string;
  };
}

function StudentNotesPanel({ lessonId, dir, labels }: StudentNotesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveTimer, setSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing note when lessonId changes
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setContent('');
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/lessons/${lessonId}/notes`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.note?.content) {
          setContent(data.note.content);
        }
      } catch (err) {
        console.error('[StudentNotesPanel] load error:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [lessonId]);

  // Auto-save with 1.5s debounce
  const saveNote = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/lessons/${lessonId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        toast.success(labels.saved);
      } else {
        toast.error(labels.saveFailed);
      }
    } catch (err) {
      console.error('[StudentNotesPanel] save error:', err);
      toast.error(labels.saveFailed);
    } finally {
      setSaving(false);
    }
  }, [lessonId, labels.saved, labels.saveFailed]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveNote(text);
    }, 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-2xl border bg-card overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between gap-2 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-sky-700 dark:text-sky-400" />
          <span className="font-semibold text-sm">{labels.title}</span>
          {content.trim() && (
            <Badge variant="secondary" className="text-[10px] ms-1">✓</Badge>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="p-4 border-t border-muted/50">
          {!loaded ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>...</span>
            </div>
          ) : (
            <>
              <Textarea
                value={content}
                onChange={handleChange}
                placeholder={labels.placeholder}
                rows={6}
                dir={dir}
                className="resize-y min-h-[120px]"
                disabled={saving}
              />
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>{saving ? '...' : (content.trim() ? labels.saved : '')}</span>
                <button
                  type="button"
                  onClick={() => saveNote(content)}
                  disabled={saving || !content.trim()}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/40 disabled:opacity-50 transition-colors"
                >
                  <Save className="h-3 w-3" />
                  {labels.saved}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

// =====================================================
// v110: StudentBookmarksPanel — quick-add + list bookmarks
// for the currently-open lesson. Uses lesson_bookmarks table.
// Multiple bookmarks per lesson are allowed (each has a label
// and optional position_seconds for video timelines).
// =====================================================

interface StudentBookmark {
  id: string;
  label: string | null;
  position_seconds: number | null;
  created_at: string;
}

interface StudentBookmarksPanelProps {
  lessonId: string;
  bookmarks: StudentBookmark[];
  loaded: boolean;
  dir: 'rtl' | 'ltr';
  labels: {
    title: string;
    placeholder: string;
    add: string;
    empty: string;
    deleteFailed: string;
  };
  onAdd: (label: string) => void;
  onDelete: (bookmarkId: string) => void;
}

function StudentBookmarksPanel({
  lessonId,
  bookmarks,
  loaded,
  dir,
  labels,
  onAdd,
  onDelete,
}: StudentBookmarksPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  // Reset the input when the lesson changes
  useEffect(() => {
    setNewLabel('');
  }, [lessonId]);

  const handleAdd = () => {
    if (!newLabel.trim()) return;
    onAdd(newLabel);
    setNewLabel('');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-2xl border bg-card overflow-hidden"
      dir={dir}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between gap-2 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-sky-700 dark:text-sky-400" />
          <span className="font-semibold text-sm">{labels.title}</span>
          {bookmarks.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ms-1">
              {bookmarks.length}
            </Badge>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="p-4 border-t border-muted/50 space-y-3">
          {/* Quick-add input + button */}
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={labels.placeholder}
              dir={dir}
              className="flex-1 min-w-[200px] h-9"
            />
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!newLabel.trim()}
              className="h-9"
            >
              <Plus className="h-4 w-4 me-1" />
              {labels.add}
            </Button>
          </div>

          {/* List existing bookmarks */}
          {!loaded ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>...</span>
            </div>
          ) : bookmarks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              {labels.empty}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {bookmarks.map((bm) => (
                <li
                  key={bm.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Bookmark className="h-3.5 w-3.5 shrink-0 text-sky-700 dark:text-sky-400" />
                    <span className="text-sm text-foreground truncate">{bm.label || '—'}</span>
                    {bm.position_seconds != null && (
                      <Badge variant="outline" className="text-[9px] ms-1 px-1 py-0">
                        {Math.floor(bm.position_seconds / 60)}:{String(Math.floor(bm.position_seconds % 60)).padStart(2, '0')}
                      </Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(bm.id)}
                    className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-900/30 dark:hover:text-rose-400 transition-colors"
                    title={labels.deleteFailed}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </motion.div>
  );
}

// =====================================================
// v110: LessonSettingsPanel — teacher-only panel for editing
// all v102 LMS fields (summary, objectives, video, scheduling,
// free_preview, instructor_notes, transcript). These fields
// already existed in the DB and PUT /api/lessons/[id] endpoint
// but had no UI before this.
//
// The panel has its own Save button (does NOT use the content
// autosave) so teachers explicitly publish metadata changes.
// =====================================================

interface LessonSettingsPanelProps {
  lesson: Lesson;
  dir: 'rtl' | 'ltr';
  onSaved: (updated: Partial<Lesson>) => void;
  labels: {
    title: string;
    summary: string;
    summaryHint: string;
    objectives: string;
    objectivesHint: string;
    objectivePlaceholder: string;
    videoUrl: string;
    videoUrlHint: string;
    estimatedMinutes: string;
    tags: string;
    tagsHint: string;
    tagPlaceholder: string;
    dueDate: string;
    availableFrom: string;
    availableUntil: string;
    freePreview: string;
    freePreviewHint: string;
    instructorNotes: string;
    instructorNotesHint: string;
    transcript: string;
    transcriptHint: string;
    save: string;
    cancel: string;
    saveFailed: string;
    saved: string;
    add: string;
  };
}

function LessonSettingsPanel({ lesson, dir, onSaved, labels }: LessonSettingsPanelProps) {
  // Local state — fields mirror the v102 LMS columns on the lessons table
  const [summary, setSummary] = useState<string>(lesson.summary || '');
  const [objectives, setObjectives] = useState<string[]>(() => {
    if (!Array.isArray(lesson.objectives)) return [];
    return lesson.objectives
      .map((o) => (typeof o === 'string' ? o : (o as { text?: string })?.text || ''))
      .filter(Boolean);
  });
  const [newObjective, setNewObjective] = useState('');
  const [videoUrl, setVideoUrl] = useState<string>(lesson.video_url || '');
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>(
    lesson.estimated_minutes != null ? String(lesson.estimated_minutes) : ''
  );
  const [tags, setTags] = useState<string[]>(() => {
    if (!Array.isArray(lesson.tags)) return [];
    return lesson.tags.filter((t): t is string => typeof t === 'string');
  });
  const [newTag, setNewTag] = useState('');
  // Scheduling — convert ISO strings to the datetime-local input format
  const isoToLocalInput = (iso: string | null | undefined): string => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      // datetime-local format: YYYY-MM-DDTHH:mm (in local time, no timezone offset)
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  };
  const localInputToIso = (val: string): string | null => {
    if (!val) return null;
    try {
      // Treat the local input as a local-time value (no TZ shift)
      return new Date(val).toISOString();
    } catch {
      return null;
    }
  };
  const [availableFrom, setAvailableFrom] = useState<string>(isoToLocalInput(lesson.available_from));
  const [availableUntil, setAvailableUntil] = useState<string>(isoToLocalInput(lesson.available_until));
  const [dueDate, setDueDate] = useState<string>(isoToLocalInput(lesson.due_date));
  const [isFreePreview, setIsFreePreview] = useState<boolean>(!!lesson.is_free_preview);
  const [instructorNotes, setInstructorNotes] = useState<string>(lesson.instructor_notes || '');
  const [transcript, setTranscript] = useState<string>(lesson.transcript || '');
  const [saving, setSaving] = useState(false);

  // Re-sync local state when the lesson prop changes (e.g., teacher switches
  // between lessons without leaving the editor). We only depend on lesson.id
  // because the parent always passes a fresh lesson object when switching.
  useEffect(() => {
    setSummary(lesson.summary || '');
    setObjectives(
      Array.isArray(lesson.objectives)
        ? lesson.objectives
            .map((o) => (typeof o === 'string' ? o : (o as { text?: string })?.text || ''))
            .filter(Boolean)
        : []
    );
    setVideoUrl(lesson.video_url || '');
    setEstimatedMinutes(lesson.estimated_minutes != null ? String(lesson.estimated_minutes) : '');
    setTags(
      Array.isArray(lesson.tags) ? lesson.tags.filter((t): t is string => typeof t === 'string') : []
    );
    setAvailableFrom(isoToLocalInput(lesson.available_from));
    setAvailableUntil(isoToLocalInput(lesson.available_until));
    setDueDate(isoToLocalInput(lesson.due_date));
    setIsFreePreview(!!lesson.is_free_preview);
    setInstructorNotes(lesson.instructor_notes || '');
    setTranscript(lesson.transcript || '');
  }, [lesson.id]);

  // Objectives handlers
  const addObjective = () => {
    if (!newObjective.trim()) return;
    setObjectives((prev) => [...prev, newObjective.trim()]);
    setNewObjective('');
  };
  const removeObjective = (idx: number) => {
    setObjectives((prev) => prev.filter((_, i) => i !== idx));
  };

  // Tags handlers
  const addTag = () => {
    if (!newTag.trim()) return;
    setTags((prev) => [...prev, newTag.trim()]);
    setNewTag('');
  };
  const removeTag = (idx: number) => {
    setTags((prev) => prev.filter((_, i) => i !== idx));
  };

  // Save — PUT to /api/lessons/[id] with all the v102 fields
  const handleSave = async () => {
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const payload: Record<string, unknown> = {
        summary: summary.trim() || null,
        objectives: objectives,
        video_url: videoUrl.trim() || null,
        estimated_minutes: estimatedMinutes.trim() === '' ? null : Number(estimatedMinutes),
        tags: tags,
        available_from: localInputToIso(availableFrom),
        available_until: localInputToIso(availableUntil),
        due_date: localInputToIso(dueDate),
        is_free_preview: !!isFreePreview,
        instructor_notes: instructorNotes.trim() || null,
        transcript: transcript.trim() || null,
      };
      const res = await fetch(`/api/lessons/${lesson.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || labels.saveFailed);
        return;
      }
      const data = await res.json();
      if (data.lesson) {
        // Pass only the v102 fields back so the parent can update its state
        const updated: Partial<Lesson> = {
          summary: data.lesson.summary ?? null,
          objectives: data.lesson.objectives ?? null,
          video_url: data.lesson.video_url ?? null,
          estimated_minutes: data.lesson.estimated_minutes ?? null,
          tags: data.lesson.tags ?? [],
          available_from: data.lesson.available_from ?? null,
          available_until: data.lesson.available_until ?? null,
          due_date: data.lesson.due_date ?? null,
          is_free_preview: data.lesson.is_free_preview ?? false,
          instructor_notes: data.lesson.instructor_notes ?? null,
          transcript: data.lesson.transcript ?? null,
        };
        onSaved(updated);
        toast.success(labels.saved);
      }
    } catch (err) {
      console.error('[LessonSettingsPanel] save error:', err);
      toast.error(labels.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="border-b bg-muted/20 overflow-y-auto max-h-[60vh]"
      dir={dir}
    >
      <div className="p-4 sm:p-5 space-y-4 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Settings className="h-4 w-4 text-sky-700 dark:text-sky-400" />
            {labels.title}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="h-8"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : <Save className="h-3.5 w-3.5 me-1" />}
              {labels.save}
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1.5">
          <Label htmlFor="ls-summary" className="text-xs font-medium flex items-center gap-1">
            <BookMarked className="h-3 w-3" />
            {labels.summary}
          </Label>
          <p className="text-[11px] text-muted-foreground">{labels.summaryHint}</p>
          <Textarea
            id="ls-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            dir={dir}
            disabled={saving}
            placeholder="..."
          />
        </div>

        {/* Objectives — list editor */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium flex items-center gap-1">
            <ListChecks className="h-3 w-3" />
            {labels.objectives}
          </Label>
          <p className="text-[11px] text-muted-foreground">{labels.objectivesHint}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={newObjective}
              onChange={(e) => setNewObjective(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addObjective();
                }
              }}
              placeholder={labels.objectivePlaceholder}
              dir={dir}
              disabled={saving}
              className="flex-1 min-w-[200px] h-9"
            />
            <Button size="sm" onClick={addObjective} disabled={saving || !newObjective.trim()} className="h-9">
              <Plus className="h-3.5 w-3.5 me-1" />
              {labels.add}
            </Button>
          </div>
          {objectives.length > 0 && (
            <ul className="space-y-1 mt-1">
              {objectives.map((obj, idx) => (
                <li key={idx} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-background border">
                  <span className="text-sm text-foreground flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate">{obj}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeObjective(idx)}
                    className="shrink-0 text-muted-foreground hover:text-rose-700 dark:hover:text-rose-400"
                    title={labels.cancel}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Video URL + Estimated minutes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ls-video" className="text-xs font-medium flex items-center gap-1">
              <Video className="h-3 w-3" />
              {labels.videoUrl}
            </Label>
            <p className="text-[11px] text-muted-foreground">{labels.videoUrlHint}</p>
            <Input
              id="ls-video"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              dir="ltr"
              disabled={saving}
              placeholder="https://..."
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ls-minutes" className="text-xs font-medium flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {labels.estimatedMinutes}
            </Label>
            <Input
              id="ls-minutes"
              type="number"
              min={0}
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(e.target.value)}
              dir="ltr"
              disabled={saving}
              placeholder="0"
              className="h-9"
            />
          </div>
        </div>

        {/* Tags — list editor */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {labels.tags}
          </Label>
          <p className="text-[11px] text-muted-foreground">{labels.tagsHint}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder={labels.tagPlaceholder}
              dir={dir}
              disabled={saving}
              className="flex-1 min-w-[200px] h-9"
            />
            <Button size="sm" onClick={addTag} disabled={saving || !newTag.trim()} className="h-9">
              <Plus className="h-3.5 w-3.5 me-1" />
              {labels.add}
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {tags.map((tag, idx) => (
                <Badge key={idx} variant="secondary" className="text-[11px] px-2 py-0.5 flex items-center gap-1">
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => removeTag(idx)}
                    className="hover:text-rose-700 dark:hover:text-rose-400"
                    title={labels.cancel}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Scheduling dates */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ls-from" className="text-xs font-medium flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {labels.availableFrom}
            </Label>
            <Input
              id="ls-from"
              type="datetime-local"
              value={availableFrom}
              onChange={(e) => setAvailableFrom(e.target.value)}
              disabled={saving}
              dir="ltr"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ls-until" className="text-xs font-medium flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {labels.availableUntil}
            </Label>
            <Input
              id="ls-until"
              type="datetime-local"
              value={availableUntil}
              onChange={(e) => setAvailableUntil(e.target.value)}
              disabled={saving}
              dir="ltr"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ls-due" className="text-xs font-medium flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {labels.dueDate}
            </Label>
            <Input
              id="ls-due"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={saving}
              dir="ltr"
              className="h-9"
            />
          </div>
        </div>

        {/* Free preview toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-background">
          <div className="space-y-0.5">
            <Label htmlFor="ls-preview" className="text-xs font-medium flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {labels.freePreview}
            </Label>
            <p className="text-[11px] text-muted-foreground">{labels.freePreviewHint}</p>
          </div>
          <Switch
            id="ls-preview"
            checked={isFreePreview}
            onCheckedChange={setIsFreePreview}
            disabled={saving}
          />
        </div>

        {/* Instructor notes (private) */}
        <div className="space-y-1.5">
          <Label htmlFor="ls-instructor" className="text-xs font-medium flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {labels.instructorNotes}
          </Label>
          <p className="text-[11px] text-muted-foreground">{labels.instructorNotesHint}</p>
          <Textarea
            id="ls-instructor"
            value={instructorNotes}
            onChange={(e) => setInstructorNotes(e.target.value)}
            rows={3}
            dir={dir}
            disabled={saving}
            placeholder="..."
          />
        </div>

        {/* Transcript */}
        <div className="space-y-1.5">
          <Label htmlFor="ls-transcript" className="text-xs font-medium flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {labels.transcript}
          </Label>
          <p className="text-[11px] text-muted-foreground">{labels.transcriptHint}</p>
          <Textarea
            id="ls-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={4}
            dir={dir}
            disabled={saving}
            placeholder="..."
          />
        </div>

        {/* Save button (footer) */}
        <div className="flex justify-end gap-2 pt-1 sticky bottom-0 bg-background/80 backdrop-blur p-2 -mx-2 border-t">
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="bg-sky-700 hover:bg-sky-800"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : <Save className="h-3.5 w-3.5 me-1" />}
            {labels.save}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
