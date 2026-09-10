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
  const [movingLessonId, setMovingLessonId] = useState<string | null>(null);

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
  }, [subject.id]);

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
        setUnits([]);
        return;
      }
      const data = await res.json();
      setUnits(data.units || []);
    } catch (err) {
      console.error('Error fetching units:', err);
      setUnits([]);
    }
  }, [subject.id]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

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
  const handleCreateLesson = useCallback(async () => {
    setCreatingLesson(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subject_id: subject.id,
          title: t('untitledLesson') || 'Untitled Lesson',
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
        toast.success(t('lessonCreated') || 'Lesson created');
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
  }, []);

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
          </div>
        </motion.div>

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
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div>
          <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-sky-700 dark:text-sky-400" />
            {t('title') || 'Lessons'}
          </h3>
          <p className="text-muted-foreground text-sm mt-1">
            {t('lessonCount', { count: visibleLessons.length }) ||
              `${visibleLessons.length} lesson(s)`}
          </p>
        </div>
        {role === 'teacher' && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUnitsView((v) => !v)}
              className={showUnitsView ? 'bg-primary/10' : ''}
            >
              <FolderTree className="h-4 w-4 me-1" />
              {t('toggleUnitsView') || 'Unit View'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUnitsManager(true)}
            >
              <Layers className="h-4 w-4 me-1" />
              {t('manageUnits') || 'Manage Units'}
            </Button>
            <button
              onClick={handleCreateLesson}
              disabled={creatingLesson}
              className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sky-800 active:scale-[0.97] disabled:opacity-60"
            >
              {creatingLesson ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t('createLesson') || 'Create Lesson'}
            </button>
          </div>
        )}
      </motion.div>

      {/* Lessons grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
        </div>
      ) : visibleLessons.length === 0 ? (
        /* Empty state */
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-20"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-100 dark:bg-sky-800/40 mb-5">
            <BookOpen className="h-10 w-10 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1">
            {t('noLessonsYet') || 'No lessons yet'}
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            {role === 'teacher'
              ? t('createFirstLesson') || 'Create your first lesson'
              : t('noLessonsPublished') || 'No lessons published yet'}
          </p>
          {role === 'teacher' && (
            <button
              onClick={handleCreateLesson}
              disabled={creatingLesson}
              className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sky-800 active:scale-[0.97] disabled:opacity-60"
            >
              {creatingLesson ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t('createLesson') || 'Create Lesson'}
            </button>
          )}
        </motion.div>
      ) : (
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
                onClick={() =>
                  role === 'teacher'
                    ? handleEditLesson(lesson)
                    : handleViewLesson(lesson)
                }
              >
                {/* Top color bar */}
                <div
                  className={`h-1 ${
                    lesson.status === 'published'
                      ? 'bg-emerald-500'
                      : 'bg-amber-400 dark:bg-amber-500'
                  }`}
                />

                <div className="p-4">
                  {/* Header row: title + actions */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="text-sm font-bold text-foreground line-clamp-2 flex-1 min-w-0">
                      {lesson.title}
                    </h4>
                    {role === 'teacher' && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditLesson(lesson);
                            }}
                          >
                            <Pencil className="h-4 w-4 me-2" />
                            {tc('edit') || 'Edit'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicate(lesson);
                            }}
                          >
                            <Copy className="h-4 w-4 me-2" />
                            {t('duplicate') || 'Duplicate'}
                          </DropdownMenuItem>
                          {/* v63: Move to unit submenu */}
                          {units.length > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger
                                  onClick={(e) => e.stopPropagation()}
                                  className="gap-2"
                                >
                                  <FolderTree className="h-4 w-4 me-2" />
                                  {t('moveToUnit') || 'Move to Unit'}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMoveToUnit(lesson, null);
                                    }}
                                  >
                                    <BookOpen className="h-4 w-4 me-2" />
                                    {t('standalone') || 'Standalone (no unit)'}
                                    {!lesson.unit_id && <Check className="h-3 w-3 ms-auto" />}
                                  </DropdownMenuItem>
                                  {units.map((u) => (
                                    <DropdownMenuItem
                                      key={u.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMoveToUnit(lesson, u.id);
                                      }}
                                    >
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
                                  toast.error(data.error || t('publishFailed') || 'Failed to update publish status');
                                  return;
                                }
                                const data = await res.json();
                                const newStatus: 'draft' | 'published' = data.status || (isUnpublish ? 'draft' : 'published');
                                setLessons((prev) =>
                                  prev.map((l) =>
                                    l.id === lesson.id
                                      ? {
                                          ...l,
                                          status: newStatus,
                                          published_at: newStatus === 'published' ? new Date().toISOString() : null,
                                        }
                                      : l
                                  )
                                );
                                if (editingLesson?.id === lesson.id) {
                                  setEditingLesson((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          status: newStatus,
                                          published_at: newStatus === 'published' ? new Date().toISOString() : null,
                                        }
                                      : prev
                                  );
                                }
                                toast.success(
                                  newStatus === 'published'
                                    ? t('lessonPublished') || 'Lesson published'
                                    : t('lessonUnpublished') || 'Lesson unpublished'
                                );
                              } catch (err) {
                                console.error('Error toggling publish:', err);
                                toast.error(t('publishFailed') || 'Failed to update publish status');
                              }
                            }}
                          >
                            {lesson.status === 'published' ? (
                              <>
                                <Lock className="h-4 w-4 me-2" />
                                {t('unpublish') || 'Unpublish'}
                              </>
                            ) : (
                              <>
                                <Globe className="h-4 w-4 me-2" />
                                {t('publish') || 'Publish'}
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(lesson.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 me-2" />
                            {tc('delete') || 'Delete'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {/* Status badge */}
                  <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                    {lesson.status === 'draft' ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400"
                      >
                        <Lock className="h-2.5 w-2.5 me-1" />
                        {t('draft') || 'Draft'}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
                      >
                        <Globe className="h-2.5 w-2.5 me-1" />
                        {t('published') || 'Published'}
                      </Badge>
                    )}
                    {/* v63: Unit badge */}
                    {lesson.unit_id && (() => {
                      const u = units.find((un) => un.id === lesson.unit_id);
                      if (!u) return null;
                      return (
                        <Badge variant="secondary" className="text-[10px]">
                          <Layers className="h-2.5 w-2.5 me-1" />
                          {u.title}
                        </Badge>
                      );
                    })()}
                    {/* v63: Pass threshold badge */}
                    {lesson.pass_threshold != null && lesson.pass_threshold > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {t('passThreshold') || 'Pass'}: {lesson.pass_threshold}%
                      </Badge>
                    )}
                  </div>

                  {/* Excerpt */}
                  {getExcerpt(lesson.content_json) && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                      {getExcerpt(lesson.content_json)}
                    </p>
                  )}

                  {/* Footer: date + word count */}
                  <div className="flex items-center justify-between pt-2 border-t border-muted/50">
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        {formatDateRelative(
                          lesson.status === 'published'
                            ? lesson.published_at || lesson.updated_at
                            : lesson.updated_at
                        )}
                      </span>
                    </div>
                    {getWordCount(lesson.content_json) > 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        <span>
                          {getWordCount(lesson.content_json)}{' '}
                          {t('words') || 'words'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      )}

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
