'use client';

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { SectionErrorBoundary } from '@/components/shared/section-error-boundary';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  BookOpen,
  PenLine,
  Folder,
  FileCheck,
  Video,
  ListChecks,
  MessageCircle,
  Users,
  LayoutDashboard,
  Loader2,
  Hash,
  Copy,
  UserCircle2,
  Check,
  User,
  Pencil,
  Trash2,
  X,
  Sparkles,
  LogOut,
  GraduationCap,
  Calendar,
  ClipboardList,
  BarChart3,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { UserProfile, Subject, SubjectTeacher, CourseTab } from '@/lib/types';
import { useTranslations } from '@/i18n/use-translations';

// -------------------------------------------------------
// Lazy-load tab components for performance
// -------------------------------------------------------
const OverviewTab = lazy(() => import('@/components/course/tabs/overview-tab'));
const LecturesTab = lazy(() => import('@/components/course/tabs/lectures-tab'));
const NotesTab = lazy(() => import('@/components/course/tabs/notes-tab'));
const FilesTab = lazy(() => import('@/components/course/tabs/files-tab'));
const VideosTab = lazy(() => import('@/components/course/tabs/videos-tab'));
const ExamsTab = lazy(() => import('@/components/course/tabs/exams-tab'));
const AssignmentsTab = lazy(() => import('@/components/course/tabs/assignments-tab'));
const ChatTab = lazy(() => import('@/components/course/tabs/chat-tab'));
const StudentsTab = lazy(() => import('@/components/course/tabs/students-tab'));
const TeamsTab = lazy(() => import('@/components/course/tabs/teams-tab'));
const PollsTab = lazy(() => import('@/components/shared/polls-section'));

// Tab loading fallback
function TabLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-sky-700 dark:text-sky-400" />
    </div>
  );
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface CoursePageProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
}

// -------------------------------------------------------
// Tab configuration
// -------------------------------------------------------
interface TabConfig {
  id: CourseTab;
  labelKey: string;
  icon: React.ReactNode;
  teacherOnly?: boolean;
}

const TABS: TabConfig[] = [
  { id: 'overview', labelKey: 'course.tabOverview', icon: <LayoutDashboard className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'lectures', labelKey: 'course.tabLectures', icon: <BookOpen className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'notes', labelKey: 'course.tabNotes', icon: <PenLine className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'files', labelKey: 'course.tabFiles', icon: <Folder className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'videos', labelKey: 'course.tabVideos', icon: <Video className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'exams', labelKey: 'course.tabExams', icon: <FileCheck className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'assignments', labelKey: 'course.tabAssignments', icon: <ListChecks className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'chat', labelKey: 'course.tabChat', icon: <MessageCircle className="h-4 w-4 sm:h-4 sm:w-4" /> },
  { id: 'students', labelKey: 'course.tabStudents', icon: <Users className="h-4 w-4 sm:h-4 sm:w-4" />, teacherOnly: true },
  { id: 'teams', labelKey: 'course.tabTeams', icon: <ClipboardList className="h-4 w-4 sm:h-4 sm:w-4" />, teacherOnly: true },
  { id: 'polls', labelKey: 'course.tabPolls', icon: <BarChart3 className="h-4 w-4 sm:h-4 sm:w-4" /> },
];

// -------------------------------------------------------
// Color utilities
// -------------------------------------------------------
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, Math.round(rgb.r * (1 - amount)));
  const g = Math.max(0, Math.round(rgb.g * (1 - amount)));
  const b = Math.max(0, Math.round(rgb.b * (1 - amount)));
  return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// -------------------------------------------------------
// Subject colors for edit modal
// -------------------------------------------------------
const SUBJECT_COLORS = [
  '#0369A1', '#14b8a6', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const pageVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: 'easeOut' as const } },
};

const modalOverlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const modalContentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.15 },
  },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function CoursePage({ profile, role }: CoursePageProps) {
  const { t, direction, locale } = useTranslations();
  const { selectedSubjectId, courseTab, setSelectedSubjectId, setCourseTab, openProfile } = useAppStore();

  // Translation-derived level values (locale-aware)
  const t_level1 = t('course.level1');
  const t_level2 = t('course.level2');
  const t_level3 = t('course.level3');
  const t_level4 = t('course.level4');
  const t_level5 = t('course.level5');
  const t_subLevel1 = t('course.subLevel1');
  const t_subLevel2 = t('course.subLevel2');

  // ─── Translation helpers for level/sub_level (DB stores Arabic, need to translate for English locale) ───
  const LEVEL_VALUES_AR = ['الفرقة الأولى', 'الفرقة الثانية', 'الفرقة الثالثة', 'الفرقة الرابعة', 'الفرقة الخامسة'] as const;
  const SUB_LEVEL_VALUES_AR = ['المستوى الأول', 'المستوى الثاني'] as const;
  const translateLevel = (level: string): string => {
    const idx = LEVEL_VALUES_AR.indexOf(level as typeof LEVEL_VALUES_AR[number]);
    if (idx !== -1) return t(`course.level${idx + 1}`);
    return level;
  };
  const translateSubLevel = (subLevel: string): string => {
    const idx = SUB_LEVEL_VALUES_AR.indexOf(subLevel as typeof SUB_LEVEL_VALUES_AR[number]);
    if (idx !== -1) return t(`course.subLevel${idx + 1}`);
    return subLevel;
  };

  // Filter options (locale-aware)
  const LEVEL_OPTIONS = [
    { value: t_level1, labelKey: 'levels.first' },
    { value: t_level2, labelKey: 'levels.second' },
    { value: t_level3, labelKey: 'levels.third' },
    { value: t_level4, labelKey: 'levels.fourth' },
    { value: t_level5, labelKey: 'levels.fifth' },
  ];

  const SUB_LEVEL_OPTIONS = [
    { value: t_subLevel1, labelKey: 'sublevels.first' },
    { value: t_subLevel2, labelKey: 'sublevels.second' },
  ];

  const [subject, setSubject] = useState<Subject | null>(null);
  const [loading, setLoading] = useState(true);
  const [teacherName, setTeacherName] = useState<string>('');
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [coTeachers, setCoTeachers] = useState<SubjectTeacher[]>([]);
  const [copiedCode, setCopiedCode] = useState(false);

  // Is the current user the subject owner (not a co-teacher)?
  const isOwner = role === 'teacher' && subject?.teacher_id === profile.id;

  // ─── Edit subject modal state ───
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editColor, setEditColor] = useState(SUBJECT_COLORS[0]);
  const [editLevel, setEditLevel] = useState('');
  const [editSubLevel, setEditSubLevel] = useState('');
  const [savingSubject, setSavingSubject] = useState(false);

  // ─── Delete subject state ───
  const [deletingSubject, setDeletingSubject] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ─── Leave course state (student only) ───
  const [leavingCourse, setLeavingCourse] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  // Subject color with fallback
  const subjectColor = subject?.color || '#0D9488';

  // Gradient colors
  const gradientFrom = subjectColor;
  const gradientTo = useMemo(() => darkenColor(subjectColor, 0.35), [subjectColor]);

  // -------------------------------------------------------
  // Fetch subject data — OPTIMIZED: parallel fetch with teacher name
  // -------------------------------------------------------
  const fetchSubject = useCallback(async () => {
    if (!selectedSubjectId) {
      setSubject(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Fetch subject and teacher name in parallel
      const [subjectResult, teacherResult] = await Promise.all([
        supabase.from('subjects').select('*').eq('id', selectedSubjectId).single(),
        role === 'student'
          ? supabase.from('subjects').select('teacher_id').eq('id', selectedSubjectId).single()
          : Promise.resolve({ data: null }),
      ]);

      const { data, error } = subjectResult;

      if (error) {
        console.error('Error fetching subject:', error);
        setSubject(null);
      } else {
        setSubject(data as Subject);

        // Fetch teacher name and co-teachers for students
        if (role === 'student' && data) {
          const tid = (data as Subject).teacher_id;
          if (tid) {
            setTeacherId(tid);
            supabase
              .from('users')
              .select('name, title_id, gender, role')
              .eq('id', tid)
              .single()
              .then(({ data: teacher }) => {
                if (teacher) {
                  const teacherData = teacher as { name: string; title_id?: string | null; gender?: string | null; role?: string | null };
                  setTeacherName(formatNameWithTitle(teacherData.name, teacherData.role, teacherData.title_id, teacherData.gender, t));
                }
              }, () => {});
          }

          // Fetch co-teachers for students
          fetch(`/api/subject-teachers?subjectId=${data.id}`)
            .then(res => res.json())
            .then(result => {
              if (result.success && result.coTeachers) {
                setCoTeachers(result.coTeachers.filter((ct: SubjectTeacher) => ct.role === 'co_teacher'));
              }
            })
            .catch(() => {});
        }

        // Fetch co-teachers for teacher view (to determine isCoTeacher)
        if (role === 'teacher' && data) {
          fetch(`/api/subject-teachers?subjectId=${data.id}`)
            .then(res => res.json())
            .then(result => {
              if (result.success && result.coTeachers) {
                setCoTeachers(result.coTeachers.filter((ct: SubjectTeacher) => ct.role === 'co_teacher'));
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error('Fetch subject error:', err);
      setSubject(null);
    } finally {
      setLoading(false);
    }
  }, [selectedSubjectId, role]);

  useEffect(() => {
    fetchSubject();
  }, [fetchSubject]);

  // -------------------------------------------------------
  // Handle back navigation
  // -------------------------------------------------------
  const handleBack = () => {
    setSelectedSubjectId(null);
    setCourseTab('overview');
    setSubject(null);
  };

  // -------------------------------------------------------
  // Available tabs based on role
  // -------------------------------------------------------
  const availableTabs = TABS.filter((tab) => !tab.teacherOnly || role === 'teacher');

  // -------------------------------------------------------
  // Copy join code
  // -------------------------------------------------------
  const handleCopyCode = () => {
    if (!subject?.join_code) return;
    navigator.clipboard.writeText(subject.join_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // -------------------------------------------------------
  // Open edit subject modal
  // -------------------------------------------------------
  const handleOpenEditModal = () => {
    if (!subject) return;
    setEditName(subject.name);
    setEditDesc(subject.description || '');
    setEditColor(subject.color || SUBJECT_COLORS[0]);
    setEditLevel(subject.level || '');
    setEditSubLevel(subject.sub_level || '');
    setEditModalOpen(true);
  };

  // -------------------------------------------------------
  // Save edited subject
  // -------------------------------------------------------
  const handleSaveSubject = async () => {
    const name = editName.trim();
    if (!name) {
      toast.error(t('course.toastSubjectNameRequired'));
      return;
    }
    setSavingSubject(true);
    try {
      const { error } = await supabase
        .from('subjects')
        .update({
          name,
          description: editDesc.trim() || null,
          color: editColor,
          level: editLevel || null,
          sub_level: editSubLevel || null,
        })
        .eq('id', subject!.id);

      if (error) {
        console.error('Error updating subject:', error);
        toast.error(t('course.toastSubjectUpdateFailed'));
      } else {
        toast.success(t('course.toastSubjectUpdated'));
        setSubject((prev) => prev ? { ...prev, name, description: editDesc.trim() || undefined, color: editColor, level: editLevel || undefined, sub_level: editSubLevel || undefined } : prev);
        setEditModalOpen(false);
      }
    } catch (err) {
      console.error('Save subject error:', err);
      toast.error(t('common.toastError'));
    } finally {
      setSavingSubject(false);
    }
  };

  // -------------------------------------------------------
  // Delete subject
  // -------------------------------------------------------
  const handleDeleteSubject = async () => {
    if (!subject) return;
    setDeletingSubject(true);
    try {
      const { error } = await supabase.from('subjects').delete().eq('id', subject.id);
      if (error) {
        console.error('Delete subject error:', error);
        toast.error(t('course.toastSubjectDeleteFailed'));
      } else {
        toast.success(t('course.toastSubjectDeleted'));
        handleBack();
      }
    } catch (err) {
      console.error('Delete subject catch error:', err);
      toast.error(t('common.toastError'));
    } finally {
      setDeletingSubject(false);
      setDeleteConfirmOpen(false);
    }
  };

  // -------------------------------------------------------
  // Leave course (student only)
  // -------------------------------------------------------
  const handleLeaveCourse = async () => {
    if (!subject) return;
    setLeavingCourse(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/leave-subject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'leave', subjectId: subject.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message);
        handleBack();
      } else {
        toast.error(data.error || t('course.toastLeaveFailed'));
      }
    } catch {
      toast.error(t('common.toastError'));
    } finally {
      setLeavingCourse(false);
      setLeaveConfirmOpen(false);
    }
  };

  // -------------------------------------------------------
  // Loading state
  // -------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
      </div>
    );
  }

  // -------------------------------------------------------
  // No subject selected
  // -------------------------------------------------------
  if (!subject) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 mb-4">
          <BookOpen className="h-8 w-8 text-sky-700 dark:text-sky-400" />
        </div>
        <p className="text-lg font-semibold text-foreground mb-1">{t('course.subjectNotFound')}</p>
        <p className="text-sm text-muted-foreground mb-4">{t('course.subjectNotFoundDesc')}</p>
        <button
          onClick={handleBack}
          className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('course.backToSubjects')}
        </button>
      </div>
    );
  }

  // -------------------------------------------------------
  // Render tab content with lazy loading
  // -------------------------------------------------------
  const renderTabContent = () => {
    const commonProps = {
      profile,
      role,
      subjectId: subject.id,
      subject,
      teacherName,
    };

    return (
      <Suspense fallback={<TabLoader />}>
        {courseTab === 'overview' && <OverviewTab {...commonProps} />}
        {courseTab === 'lectures' && <LecturesTab {...commonProps} />}
        {courseTab === 'notes' && <NotesTab {...commonProps} />}
        {courseTab === 'files' && <FilesTab {...commonProps} />}
        {courseTab === 'videos' && <VideosTab {...commonProps} />}
        {courseTab === 'exams' && (
          <SectionErrorBoundary name={t('course.exams')}>
            <ExamsTab {...commonProps} />
          </SectionErrorBoundary>
        )}
        {courseTab === 'assignments' && <AssignmentsTab {...commonProps} />}
        {courseTab === 'chat' && <ChatTab {...commonProps} />}
        {courseTab === 'students' && role === 'teacher' && <StudentsTab {...commonProps} />}
        {courseTab === 'teams' && role === 'teacher' && (
          <SectionErrorBoundary name={t('course.teams')}>
            <TeamsTab subjectId={subject.id} profile={profile} />
          </SectionErrorBoundary>
        )}
        {courseTab === 'polls' && <PollsTab profile={profile} role={role} subjectId={subject.id} subject={subject} />}
      </Suspense>
    );
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="space-y-0"
    >
      {/* ============================================ */}
      {/* GRADIENT BANNER HEADER                       */}
      {/* ============================================ */}
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)`,
          minHeight: '150px',
        }}
      >
        {/* Decorative dot pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Decorative large faded circle */}
        <div
          className="absolute -top-16 -start-16 h-64 w-64 rounded-full opacity-[0.07]"
          style={{ backgroundColor: 'white' }}
        />
        <div
          className="absolute -bottom-12 -end-12 h-48 w-48 rounded-full opacity-[0.05]"
          style={{ backgroundColor: 'white' }}
        />

        {/* Banner content */}
        <div className="relative z-10 flex flex-col justify-between p-5 md:p-6" style={{ minHeight: '150px' }}>
          {/* Top row: back button + actions */}
          <div className="flex items-start justify-between gap-3">
            {/* Back button - white circle */}
            <button
              onClick={handleBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/15 backdrop-blur-sm text-white transition-all hover:bg-black/25 active:scale-95"
              aria-label={t('course.backToSubjects')}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            {/* Right side: action buttons + join code + teacher name */}
            <div className="flex flex-col items-end gap-2">
              {/* Teacher action buttons row — only for subject owner */}
              {role === 'teacher' && isOwner && (
                <div className="flex items-center gap-1.5">
                  {/* Edit button */}
                  <button
                    onClick={handleOpenEditModal}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/15 backdrop-blur-sm text-white transition-all hover:bg-black/25 active:scale-95"
                    title={t('course.editSubject')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={deletingSubject}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white transition-all hover:bg-rose-400/40 active:scale-95"
                    title={t('course.deleteSubject')}
                  >
                    {deletingSubject ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              )}

              {/* Student: Leave course button */}
              {role === 'student' && (
                <button
                  onClick={() => setLeaveConfirmOpen(true)}
                  className="flex items-center gap-1.5 rounded-full bg-black/10 backdrop-blur-sm px-3 py-1.5 text-xs text-white/90 hover:bg-rose-500/40 hover:text-white transition-colors"
                  title={t('course.leaveSubject')}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t('course.leave')}
                </button>
              )}

              {/* Join code pill badge — teachers only */}
              {role === 'teacher' && subject.join_code && (
                <button
                  onClick={handleCopyCode}
                  className="group flex items-center gap-1.5 rounded-full bg-black/15 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-black/25 active:scale-95"
                >
                  <Hash className="h-3 w-3 opacity-70" />
                  <span className="font-mono tracking-wider text-xs font-semibold">{subject.join_code}</span>
                  <span className="mx-1 h-3 w-px bg-white/30" />
                  {copiedCode ? (
                    <motion.span
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="flex items-center gap-1 text-xs"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t('course.copied')}
                    </motion.span>
                  ) : (
                    <Copy className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              )}

              {/* Teachers list (students only) — clickable to open profile */}
              {role === 'student' && teacherName && teacherId && (
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <User className="h-3.5 w-3.5 opacity-70 text-white/70 shrink-0" />
                  <button
                    type="button"
                    onClick={() => openProfile(teacherId)}
                    className="rounded-full bg-black/10 backdrop-blur-sm px-2.5 py-1 text-xs text-white/90 hover:bg-black/20 hover:text-white transition-colors"
                  >
                    {teacherName}
                  </button>
                  {coTeachers.map((ct) => {
                    const ctName = formatNameWithTitle(
                      ct.teacher_name || t('roles.teacher'),
                      'teacher',
                      ct.teacher_title_id,
                      ct.teacher_gender,
                      t
                    );
                    return (
                      <button
                        key={ct.id}
                        type="button"
                        onClick={() => openProfile(ct.teacher_id)}
                        className="rounded-full bg-black/10 backdrop-blur-sm px-2.5 py-1 text-xs text-white/90 hover:bg-black/20 hover:text-white transition-colors"
                      >
                        {ctName}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: subject info */}
          <div className="mt-auto">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold text-white truncate leading-tight">
                {subject.name}
              </h1>
              {subject.description && (
                <p className="mt-1 text-white/75 text-sm md:text-base truncate max-w-lg md:max-w-xl">
                  {subject.description}
                </p>
              )}
              {/* Level & Sub-level badges */}
              {(subject.level || subject.sub_level) && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {subject.level && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 backdrop-blur-sm border border-white/25 px-2.5 py-0.5 text-xs text-white font-medium">
                      <GraduationCap className="h-3 w-3" />
                      {translateLevel(subject.level)}
                    </span>
                  )}
                  {subject.sub_level && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 backdrop-blur-sm border border-white/25 px-2.5 py-0.5 text-xs text-white font-medium">
                      <Calendar className="h-3 w-3" />
                      {translateSubLevel(subject.sub_level)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* STICKY PILL TAB NAVIGATION                   */}
      {/* ============================================ */}
      <div className="sticky top-0 z-10 -mt-3 bg-background/95 backdrop-blur-md border-b border-border/60 shadow-sm">
        <div className="relative flex items-center gap-1 md:gap-1.5 px-2 md:px-4 py-2 md:py-3 overflow-x-auto scrollbar-none lg:flex-wrap lg:overflow-x-visible">
          {availableTabs.map((tab) => {
            const isActive = courseTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCourseTab(tab.id)}
                title={t(tab.labelKey)}
                className={`
                  relative flex items-center justify-center gap-1.5
                  rounded-full px-3 py-2
                  text-sm font-medium whitespace-nowrap transition-all duration-200
                  active:scale-95
                  ${
                    isActive
                      ? 'text-white shadow-md'
                      : 'text-muted-foreground border border-border/60 hover:text-foreground hover:border-foreground/20 hover:bg-muted/50'
                  }
                `}
                style={
                  isActive
                    ? { backgroundColor: subjectColor, boxShadow: `0 2px 8px ${subjectColor}40` }
                    : undefined
                }
              >
                <span className={isActive ? 'text-white' : ''}>{tab.icon}</span>
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ============================================ */}
      {/* MOBILE ACTIVE TAB INDICATOR (small screens only) */}
      {/* ============================================ */}
      <div className="sm:hidden mt-3">
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ backgroundColor: subjectColor }}
        >
          {availableTabs.find((t) => t.id === courseTab)?.icon}
          <span>{t(availableTabs.find((tab) => tab.id === courseTab)?.labelKey || '')}</span>
        </div>
      </div>

      {/* ============================================ */}
      {/* TAB CONTENT (no AnimatePresence for performance) */}
      {/* ============================================ */}
      <div className="mt-4">
        {renderTabContent()}
      </div>

      {/* ============================================ */}
      {/* EDIT SUBJECT MODAL                           */}
      {/* ============================================ */}
      <AnimatePresence>
        {editModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !savingSubject && setEditModalOpen(false)}
            />

            {/* Modal content */}
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-md rounded-2xl border bg-background shadow-2xl overflow-hidden"
              dir={direction}
            >
              {/* Modal gradient header */}
              <div
                className="px-6 pt-6 pb-4"
                style={{
                  background: `linear-gradient(135deg, ${hexToRgba(editColor, 0.12)} 0%, transparent 100%)`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-white font-bold shadow-sm"
                      style={{ backgroundColor: editColor }}
                    >
                      <Pencil className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">{t('course.editSubject')}</h3>
                      <p className="text-xs text-muted-foreground">{t('course.editSubjectDesc')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => !savingSubject && setEditModalOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-5">
                {/* Subject name */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    {t('course.subjectName')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={t('course.subjectNamePlaceholder')}
                    className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
                    dir={direction}
                    disabled={savingSubject}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !savingSubject) handleSaveSubject();
                    }}
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    {t('course.description')}
                  </label>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder={t('course.subjectDescPlaceholder')}
                    rows={3}
                    className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all resize-none"
                    dir={direction}
                    disabled={savingSubject}
                  />
                </div>

                {/* الفرقة (السنة الدراسية) & المستوى الدراسي */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      {t('course.academicYear')}
                    </label>
                    <select
                      value={editLevel}
                      onChange={(e) => setEditLevel(e.target.value)}
                      className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all appearance-none cursor-pointer"
                      dir={direction}
                      disabled={savingSubject}
                    >
                      <option value="">{t('course.noYear')}</option>
                      {LEVEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      {t('course.studyLevel')}
                    </label>
                    <select
                      value={editSubLevel}
                      onChange={(e) => setEditSubLevel(e.target.value)}
                      className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all appearance-none cursor-pointer"
                      dir={direction}
                      disabled={savingSubject}
                    >
                      <option value="">{t('course.noTerm')}</option>
                      {SUB_LEVEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Color picker */}
                <div className="space-y-2.5">
                  <label className="text-sm font-semibold text-foreground">
                      {t('course.subjectColor')}
                  </label>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {SUBJECT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setEditColor(color)}
                        disabled={savingSubject}
                        className="relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-110 active:scale-95"
                        style={{
                          backgroundColor: color,
                          boxShadow:
                            editColor === color
                              ? `0 0 0 3px ${hexToRgba(color, 0.3)}, 0 2px 8px ${hexToRgba(color, 0.3)}`
                              : 'none',
                        }}
                      >
                        {editColor === color && (
                          <Check className="h-4 w-4 text-white" strokeWidth={3} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Save button */}
                <button
                  onClick={handleSaveSubject}
                  disabled={savingSubject || !editName.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                  style={{
                    backgroundColor: editColor,
                    boxShadow: `0 2px 12px ${hexToRgba(editColor, 0.35)}`,
                  }}
                >
                  {savingSubject ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {t('common.saveChanges')}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================ */}
      {/* DELETE CONFIRM DIALOG                        */}
      {/* ============================================ */}
      <AnimatePresence>
        {deleteConfirmOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !deletingSubject && setDeleteConfirmOpen(false)}
            />
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-800/40 mb-4">
                  <Trash2 className="h-7 w-7 text-rose-600 dark:text-rose-500" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t('course.deleteSubject')}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {t('course.deleteSubjectConfirm', { name: subject.name })}
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleDeleteSubject}
                    disabled={deletingSubject}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
                  >
                    {deletingSubject ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('common.deleting')}
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4" />
                        {t('common.delete')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setDeleteConfirmOpen(false)}
                    disabled={deletingSubject}
                    className="flex-1 rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================ */}
      {/* LEAVE COURSE CONFIRM DIALOG (student only)   */}
      {/* ============================================ */}
      <AnimatePresence>
        {leaveConfirmOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !leavingCourse && setLeaveConfirmOpen(false)}
            />
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-800/40 mb-4">
                  <LogOut className="h-7 w-7 text-rose-600 dark:text-rose-500" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t('course.leaveSubject')}</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  {t('course.leaveSubjectConfirm', { name: subject.name })}
                </p>
                <p className="text-xs text-muted-foreground/70 mb-6">
                  {t('course.leaveSubjectWarning')}
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleLeaveCourse}
                    disabled={leavingCourse}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
                  >
                    {leavingCourse ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('course.leaving')}
                      </>
                    ) : (
                      <>
                        <LogOut className="h-4 w-4" />
                        {t('course.yesLeave')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setLeaveConfirmOpen(false)}
                    disabled={leavingCourse}
                    className="flex-1 rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
