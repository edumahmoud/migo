'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  StickyNote,
  Plus,
  X,
  Loader2,
  Trash2,
  Edit3,
  Globe,
  Lock,
  Eye,
  BookOpen,
  Send,
  Megaphone,
  Clock,
  User,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { UserProfile, Subject, Lecture, LectureNote, LectureNoteWithAuthor } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface NotesTabProps {
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
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

// -------------------------------------------------------
// Helper
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'الآن';
    if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
    if (diffHours < 24) return `منذ ${diffHours} ساعة`;
    if (diffDays < 7) return `منذ ${diffDays} يوم`;

    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatFullDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// Special lecture ID prefix for general (non-lecture) notes
const GENERAL_NOTES_LECTURE_PREFIX = '__general__';

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function NotesTab({ profile, role, subjectId, teacherName }: NotesTabProps) {
  // ─── Data state ───
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [allNotes, setAllNotes] = useState<LectureNoteWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Note creation ───
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'public' | 'private'>('public');
  const [noteLectureId, setNoteLectureId] = useState<string>('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // ─── Note viewers state ───
  const [noteViewers, setNoteViewers] = useState<{ user_name: string; viewed_at: string }[]>([]);
  const [viewersModalOpen, setViewersModalOpen] = useState(false);

  // ─── Recorded view notes ───
  const [recordedViewNotes, setRecordedViewNotes] = useState<Set<string>>(new Set());

  // ─── General notes lecture ID ───
  const [generalLectureId, setGeneralLectureId] = useState<string | null>(null);

  // -------------------------------------------------------
  // Lecture map for display
  // -------------------------------------------------------
  const lectureMap = useMemo(() => {
    const map = new Map<string, string>();
    lectures.forEach((l) => map.set(l.id, l.title));
    return map;
  }, [lectures]);

  // -------------------------------------------------------
  // Filter notes: only show non-file notes
  // -------------------------------------------------------
  const visibleNotes = useMemo(() => {
    return allNotes.filter((n) => !n.content.startsWith('[FILE'));
  }, [allNotes]);

  // Separate general notes (no lecture or general lecture) from lecture-specific notes
  const generalNotes = useMemo(() => {
    return visibleNotes.filter((n) => !n.lecture_id || n.lecture_id === generalLectureId);
  }, [visibleNotes, generalLectureId]);

  const lectureNotes = useMemo(() => {
    return visibleNotes.filter((n) => n.lecture_id && n.lecture_id !== generalLectureId);
  }, [visibleNotes, generalLectureId]);

  // -------------------------------------------------------
  // Fetch lectures
  // -------------------------------------------------------
  const fetchLectures = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('lectures')
        .select('*')
        .eq('subject_id', subjectId)
        .order('lecture_date', { ascending: false, nullsFirst: false });
      if (error) console.error('Error fetching lectures:', error);
      else {
        const lecturesList = (data as Lecture[]) || [];
        setLectures(lecturesList);

        // Check if general notes lecture exists
        const general = lecturesList.find((l) => l.title === GENERAL_NOTES_LECTURE_PREFIX);
        if (general) {
          setGeneralLectureId(general.id);
        }
      }
    } catch (err) {
      console.error('Fetch lectures error:', err);
    }
  }, [subjectId]);

  // -------------------------------------------------------
  // Fetch ALL notes for the subject
  // -------------------------------------------------------
  const fetchAllNotes = useCallback(async () => {
    setLoading(true);
    try {
      // Get all lecture IDs for this subject
      const { data: lecturesData, error: lecturesError } = await supabase
        .from('lectures')
        .select('id')
        .eq('subject_id', subjectId);

      if (lecturesError || !lecturesData || lecturesData.length === 0) {
        setAllNotes([]);
        return;
      }

      const lectureIds = lecturesData.map((l: { id: string }) => l.id);

      let notesQuery = supabase
        .from('lecture_notes')
        .select('*')
        .in('lecture_id', lectureIds)
        .order('created_at', { ascending: false });

      if (role === 'student') {
        notesQuery = notesQuery.or(`user_id.eq.${profile.id},visibility.eq.public`);
      }

      const { data, error } = await notesQuery;
      if (error) {
        console.error('Error fetching notes:', error);
        setAllNotes([]);
        return;
      }

      const notesList = (data as LectureNote[]) || [];

      // Fetch author names
      if (notesList.length > 0) {
        const authorIds = [...new Set(notesList.map((n) => n.user_id))];
        const { data: authors } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .in('id', authorIds);
        const authorMap = new Map((authors || []).map((a: { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }) => [a.id, a]));

        setAllNotes(notesList.map((n) => {
          const author = authorMap.get(n.user_id);
          return {
            ...n,
            author_name: author ? formatNameWithTitle(author.name, author.role, author.title_id, author.gender) : 'مستخدم',
          };
        }));
      } else {
        setAllNotes([]);
      }
    } catch (err) {
      console.error('Fetch notes error:', err);
      setAllNotes([]);
    } finally {
      setLoading(false);
    }
  }, [subjectId, role, profile.id]);

  useEffect(() => {
    fetchLectures();
    fetchAllNotes();
  }, [fetchLectures, fetchAllNotes]);

  // -------------------------------------------------------
  // Real-time for notes
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`subject-notes-${subjectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lecture_notes' },
        () => { fetchAllNotes(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [subjectId, fetchAllNotes]);

  // -------------------------------------------------------
  // Ensure general notes lecture exists
  // -------------------------------------------------------
  const ensureGeneralLecture = async (): Promise<string | null> => {
    if (generalLectureId) return generalLectureId;

    try {
      const { data, error } = await supabase
        .from('lectures')
        .insert({
          subject_id: subjectId,
          title: GENERAL_NOTES_LECTURE_PREFIX,
          description: '',
        })
        .select('id')
        .single();

      if (error) {
        // Maybe it was created by another process, try to fetch it
        const { data: existing } = await supabase
          .from('lectures')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('title', GENERAL_NOTES_LECTURE_PREFIX)
          .single();
        if (existing) {
          const id = (existing as { id: string }).id;
          setGeneralLectureId(id);
          return id;
        }
        console.error('Error creating general lecture:', error);
        return null;
      }

      const id = (data as { id: string }).id;
      setGeneralLectureId(id);
      fetchLectures();
      return id;
    } catch (err) {
      console.error('Ensure general lecture error:', err);
      return null;
    }
  };

  // -------------------------------------------------------
  // Save note
  // -------------------------------------------------------
  const handleSaveNote = async () => {
    const content = noteContent.trim();
    if (!content) { toast.error('يرجى إدخال محتوى الملاحظة'); return; }

    setSavingNote(true);
    try {
      if (editingNoteId) {
        const { error } = await supabase
          .from('lecture_notes')
          .update({ content, visibility: noteVisibility, updated_at: new Date().toISOString() })
          .eq('id', editingNoteId);
        if (error) toast.error('حدث خطأ أثناء تحديث الملاحظة');
        else { toast.success('تم تحديث الملاحظة'); setEditingNoteId(null); }
      } else {
        // Determine lecture_id
        let lectureId = noteLectureId;

        // If no lecture selected, use general notes lecture
        if (!lectureId) {
          const genId = await ensureGeneralLecture();
          if (!genId) {
            toast.error('حدث خطأ أثناء إنشاء الملاحظة');
            setSavingNote(false);
            return;
          }
          lectureId = genId;
        }

        const { error } = await supabase.from('lecture_notes').insert({
          lecture_id: lectureId,
          user_id: profile.id,
          content,
          visibility: noteVisibility,
        });
        if (error) toast.error('حدث خطأ أثناء حفظ الملاحظة');
        else {
          toast.success(noteVisibility === 'public' ? 'تم نشر الملاحظة للطلاب' : 'تم حفظ الملاحظة كمسودة');
          // Send notification to all students for public notes only
          if (noteVisibility === 'public' && !editingNoteId) {
            try {
              const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;
              await fetch('/api/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'public_note_created',
                  subjectId,
                  notePreview: preview,
                  teacherName: profile.name,
                }),
              });
            } catch { /* notification failure is non-critical */ }
          }
        }
      }
      setNoteContent('');
      setNoteVisibility('public');
      setNoteLectureId('');
      setShowCreateForm(false);
      fetchAllNotes();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSavingNote(false);
    }
  };

  // -------------------------------------------------------
  // Delete note
  // -------------------------------------------------------
  const handleDeleteNote = async (noteId: string) => {
    setDeletingNoteId(noteId);
    try {
      const { error } = await supabase.from('lecture_notes').delete().eq('id', noteId);
      if (error) toast.error('حدث خطأ أثناء حذف الملاحظة');
      else { toast.success('تم حذف الملاحظة'); fetchAllNotes(); }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setDeletingNoteId(null);
    }
  };

  // -------------------------------------------------------
  // Edit note
  // -------------------------------------------------------
  const handleEditNote = (note: LectureNoteWithAuthor) => {
    setEditingNoteId(note.id);
    setNoteContent(note.content);
    setNoteVisibility(note.visibility);
    setNoteLectureId(note.lecture_id !== generalLectureId ? note.lecture_id : '');
    setShowCreateForm(true);
  };

  // -------------------------------------------------------
  // Cancel edit/create
  // -------------------------------------------------------
  const handleCancelForm = () => {
    setEditingNoteId(null);
    setNoteContent('');
    setNoteVisibility('public');
    setNoteLectureId('');
    setShowCreateForm(false);
  };

  // -------------------------------------------------------
  // Record note view
  // -------------------------------------------------------
  const handleRecordNoteView = async (noteId: string) => {
    if (recordedViewNotes.has(noteId)) return;
    try {
      await supabase.from('note_views').insert({ note_id: noteId, user_id: profile.id });
      setRecordedViewNotes((prev) => new Set(prev).add(noteId));
    } catch { /* silently fail */ }
  };

  // -------------------------------------------------------
  // Fetch note viewers (teacher)
  // -------------------------------------------------------
  const handleFetchViewers = async (noteId: string) => {
    try {
      const { data, error } = await supabase
        .from('note_views')
        .select('user_id, viewed_at')
        .eq('note_id', noteId)
        .order('viewed_at', { ascending: false });

      if (error || !data || data.length === 0) {
        setNoteViewers([]);
      } else {
        const userIds = data.map((v) => v.user_id);
        const { data: users } = await supabase
          .from('users')
          .select('id, name')
          .in('id', userIds);
        const userMap = new Map((users || []).map((u: { id: string; name: string }) => [u.id, u.name]));
        const viewers = data.map((v) => ({
          user_name: userMap.get(v.user_id) || 'مستخدم',
          viewed_at: v.viewed_at,
        }));
        setNoteViewers(viewers);
      }
      setViewersModalOpen(true);
    } catch {
      setNoteViewers([]);
      setViewersModalOpen(true);
    }
  };

  // -------------------------------------------------------
  // Render a note card
  // -------------------------------------------------------
  const renderNoteCard = (note: LectureNoteWithAuthor, isGeneral: boolean) => {
    const lectureTitle = lectureMap.get(note.lecture_id);
    const isOwn = note.user_id === profile.id;
    const canEdit = isOwn || role === 'teacher';

    return (
      <motion.div
        key={note.id}
        variants={itemVariants}
        className={`rounded-xl border bg-card shadow-sm hover:shadow-md transition-all overflow-hidden ${
          note.visibility === 'public' && isGeneral
            ? 'border-emerald-200/60'
            : note.visibility === 'public'
              ? 'border-amber-200/60'
              : 'border-muted'
        }`}
        onClick={() => {
          if (role === 'student' && note.visibility === 'public') {
            handleRecordNoteView(note.id);
          }
        }}
      >
        {/* Top bar for public general notes */}
        {note.visibility === 'public' && isGeneral && (
          <div className="h-1 bg-emerald-500" />
        )}

        <div className="p-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Visibility badge */}
              {note.visibility === 'public' ? (
                <Badge
                  variant="outline"
                  className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700"
                >
                  <Globe className="h-2.5 w-2.5 ml-1" />
                  {isGeneral ? 'إعلان' : 'عامة'}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] border-amber-300 bg-amber-50 text-amber-700"
                >
                  <Lock className="h-2.5 w-2.5 ml-1" />
                  مسودة
                </Badge>
              )}
              {/* Lecture badge for lecture-specific notes */}
              {!isGeneral && lectureTitle && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-muted bg-muted/50 text-muted-foreground"
                >
                  <BookOpen className="h-2.5 w-2.5 ml-1" />
                  {lectureTitle}
                </Badge>
              )}
            </div>
            {/* Actions */}
            <div className="flex items-center gap-0.5 shrink-0">
              {role === 'teacher' && note.visibility === 'public' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleFetchViewers(note.id); }}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="عرض المشاهدات"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              )}
              {canEdit && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleEditNote(note); }}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="تعديل"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
                    disabled={deletingNoteId === note.id}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    title="حذف"
                  >
                    {deletingNoteId === note.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Note content */}
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{note.content}</p>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-muted/50">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{note.author_name || (role === 'teacher' ? 'أنت' : formatNameWithTitle(teacherName))}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground" title={formatFullDate(note.created_at)}>
              <Clock className="h-3 w-3" />
              <span>{formatDate(note.created_at)}</span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-5">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-foreground">الملاحظات</h3>
          <p className="text-muted-foreground text-sm mt-1">{visibleNotes.length} ملاحظة</p>
        </div>
        {role === 'teacher' && (
          <button
            onClick={() => { setShowCreateForm(true); setEditingNoteId(null); setNoteContent(''); setNoteVisibility('public'); setNoteLectureId(''); }}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            ملاحظة جديدة
          </button>
        )}
      </motion.div>

      {/* Create/Edit Note Form */}
      <AnimatePresence>
        {showCreateForm && role === 'teacher' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <StickyNote className="h-4 w-4 text-emerald-600" />
                  {editingNoteId ? 'تعديل الملاحظة' : 'كتابة ملاحظة جديدة'}
                </h4>
                <button
                  onClick={handleCancelForm}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Visibility toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground ml-1">الظهور:</span>
                <button
                  onClick={() => setNoteVisibility('public')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    noteVisibility === 'public'
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'text-muted-foreground hover:bg-muted border border-transparent'
                  }`}
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  عامة لكل الطلاب
                </button>
                <button
                  onClick={() => setNoteVisibility('private')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    noteVisibility === 'private'
                      ? 'bg-amber-100 text-amber-700 border border-amber-200'
                      : 'text-muted-foreground hover:bg-muted border border-transparent'
                  }`}
                >
                  <Lock className="h-3.5 w-3.5" />
                  مسودة خاصة
                </button>
              </div>

              {/* Optional lecture selector */}
              {!editingNoteId && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">ربط بمحاضرة:</span>
                  <select
                    value={noteLectureId}
                    onChange={(e) => setNoteLectureId(e.target.value)}
                    className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    dir="rtl"
                  >
                    <option value="">بدون محاضرة (ملاحظة عامة)</option>
                    {lectures
                      .filter((l) => l.title !== GENERAL_NOTES_LECTURE_PREFIX)
                      .map((lecture) => (
                        <option key={lecture.id} value={lecture.id}>{lecture.title}</option>
                      ))}
                  </select>
                </div>
              )}

              {/* Content textarea */}
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder={noteVisibility === 'public' ? 'اكتب ملاحظة أو إعلان يراه جميع الطلاب...' : 'اكتب ملاحظتك الخاصة هنا...'}
                rows={4}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors resize-none"
                dir="rtl"
                disabled={savingNote}
                autoFocus
              />

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveNote}
                  disabled={savingNote || !noteContent.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : noteVisibility === 'public' ? <Send className="h-3 w-3" /> : <StickyNote className="h-3 w-3" />}
                  {editingNoteId ? 'تحديث' : noteVisibility === 'public' ? 'نشر للطلاب' : 'حفظ كمسودة'}
                </button>
                <button
                  onClick={handleCancelForm}
                  className="rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notes content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : visibleNotes.length === 0 ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 py-20">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100 mb-5">
            <StickyNote className="h-10 w-10 text-emerald-600" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1">لا توجد ملاحظات بعد</p>
          <p className="text-sm text-muted-foreground">
            {role === 'teacher' ? 'ابدأ بكتابة ملاحظة أو إعلان لطلابك' : 'لم يتم نشر ملاحظات بعد'}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* General / Announcements Section */}
          {generalNotes.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Megaphone className="h-4 w-4 text-emerald-600" />
                <h4 className="text-sm font-bold text-foreground">إعلانات وملاحظات عامة</h4>
                <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                  {generalNotes.length}
                </Badge>
              </div>
              <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {generalNotes.map((note) => renderNoteCard(note, true))}
              </motion.div>
            </div>
          )}

          {/* Lecture-specific Notes Section */}
          {lectureNotes.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="h-4 w-4 text-amber-600" />
                <h4 className="text-sm font-bold text-foreground">ملاحظات المحاضرات</h4>
                <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
                  {lectureNotes.length}
                </Badge>
              </div>
              <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {lectureNotes.map((note) => renderNoteCard(note, false))}
              </motion.div>
            </div>
          )}
        </div>
      )}

      {/* Viewers Modal */}
      <AnimatePresence>
        {viewersModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setViewersModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0, pointerEvents: 'none' as const }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl p-5"
              dir="rtl"
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Eye className="h-4 w-4 text-emerald-600" />
                  مشاهدي الملاحظة
                </h4>
                <button
                  onClick={() => setViewersModalOpen(false)}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {noteViewers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">لا توجد مشاهدات بعد</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {noteViewers.map((viewer, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-lg border p-2.5">
                      <span className="text-sm font-medium text-foreground">{viewer.user_name}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(viewer.viewed_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
