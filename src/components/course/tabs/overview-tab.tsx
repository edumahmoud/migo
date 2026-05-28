'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Users,
  File,
  ClipboardCheck,
  Calendar,
  Clock,
  Loader2,
  UserPlus,
  UserCog,
  X,
  Shield,
  Trash2,
  LogOut,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import StatCard from '@/components/shared/stat-card';
import UserAvatar, { getTitleLabel } from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import { useAppStore } from '@/stores/app-store';
import { useTranslations } from '@/i18n/use-translations';
import { toast } from 'sonner';
import type { UserProfile, Subject, Lecture, SubjectFile, SubjectTeacher } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface OverviewTabProps {
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function OverviewTab({ profile, role, subjectId, subject }: OverviewTabProps) {
  const { t, direction } = useTranslations('course');
  const { t: tc } = useTranslations('common');
  const { openProfile, setSelectedSubjectId, setCourseTab } = useAppStore();
  const [stats, setStats] = useState({
    totalLectures: 0,
    totalStudents: 0,
    totalFiles: 0,
    totalAssignments: 0,
  });
  const [recentLectures, setRecentLectures] = useState<Lecture[]>([]);
  const [recentFiles, setRecentFiles] = useState<SubjectFile[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Co-teachers state ───
  const [coTeachers, setCoTeachers] = useState<SubjectTeacher[]>([]);
  const [loadingCoTeachers, setLoadingCoTeachers] = useState(false);
  const [addCoTeacherOpen, setAddCoTeacherOpen] = useState(false);
  const [teacherCodeInput, setTeacherCodeInput] = useState('');
  const [addingCoTeacher, setAddingCoTeacher] = useState(false);
  const [removingCoTeacherId, setRemovingCoTeacherId] = useState<string | null>(null);

  // Is the current user the owner?
  const isOwner = role === 'teacher' && subject.teacher_id === profile.id;
  // Is the current user a co-teacher?
  const isCoTeacher = role === 'teacher' && !isOwner && coTeachers.some(ct => ct.teacher_id === profile.id && ct.role === 'co_teacher');

  // ─── Leave course state (co-teacher) ───
  const [leavingCourse, setLeavingCourse] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

  // -------------------------------------------------------
  // Fetch co-teachers
  // -------------------------------------------------------
  const fetchCoTeachers = useCallback(async () => {
    if (role !== 'teacher') return;
    setLoadingCoTeachers(true);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch(`/api/subject-teachers?subjectId=${subjectId}`, { headers });
      const data = await res.json();
      if (data.success && data.coTeachers) {
        setCoTeachers(data.coTeachers);
      }
    } catch (err) {
      console.error('Error fetching co-teachers:', err);
    } finally {
      setLoadingCoTeachers(false);
    }
  }, [subjectId, role]);

  // -------------------------------------------------------
  // Fetch overview data
  // -------------------------------------------------------
  const fetchOverviewData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all data in parallel for better performance
      const [lecturesResult, studentsResult, filesResult, assignmentsResult] = await Promise.all([
        supabase.from('lectures').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
        supabase.from('subject_students').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId),
        supabase.from('subject_files').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
        supabase.from('assignments').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId),
      ]);

      const lectures = ((lecturesResult.data as Lecture[]) || []).filter(l => !l.title.startsWith('__'));
      setRecentLectures(lectures.slice(0, 3));

      const files = (filesResult.data as SubjectFile[]) || [];
      setRecentFiles(files.slice(0, 3));

      setStats({
        totalLectures: lectures.length,
        totalStudents: studentsResult.count || 0,
        totalFiles: files.length,
        totalAssignments: assignmentsResult.count || 0,
      });
    } catch (err) {
      console.error('Fetch overview data error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchOverviewData();
    fetchCoTeachers();
  }, [fetchOverviewData, fetchCoTeachers]);

  // -------------------------------------------------------
  // Add co-teacher
  // -------------------------------------------------------
  const handleAddCoTeacher = async () => {
    const code = teacherCodeInput.trim().toUpperCase();
    if (!code) {
      toast.error(t('teacherCodeRequired'));
      return;
    }
    setAddingCoTeacher(true);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/subject-teachers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ subjectId, teacherCode: code }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message);
        setTeacherCodeInput('');
        setAddCoTeacherOpen(false);
        fetchCoTeachers();
      } else {
        toast.error(data.error || t('failedToAddCoTeacher'));
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setAddingCoTeacher(false);
    }
  };

  // -------------------------------------------------------
  // Remove co-teacher
  // -------------------------------------------------------
  const handleRemoveCoTeacher = async (teacherId: string) => {
    setRemovingCoTeacherId(teacherId);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/subject-teachers', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ subjectId, teacherId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message);
        fetchCoTeachers();
      } else {
        toast.error(data.error || t('removeCoTeacherError'));
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setRemovingCoTeacherId(null);
    }
  };

  // -------------------------------------------------------
  // Leave course (co-teacher)
  // -------------------------------------------------------
  const handleLeaveCourse = async () => {
    setLeavingCourse(true);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/subject-teachers', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ subjectId, teacherId: profile.id, selfLeave: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message || t('removedFromCourse'));
        // Navigate back to dashboard
        setSelectedSubjectId(null);
        setCourseTab('overview');
      } else {
        toast.error(data.error || t('leaveCourseError'));
      }
    } catch {
      toast.error(tc('unexpectedError'));
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
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
      </div>
    );
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Quick Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={<BookOpen className="h-5 w-5" />}
          label={t('courseLectures')}
          value={stats.totalLectures}
          color="ocean"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label={t('enrolledStudents')}
          value={stats.totalStudents}
          color="teal"
        />
        <StatCard
          icon={<File className="h-5 w-5" />}
          label={t('courseFiles')}
          value={stats.totalFiles}
          color="amber"
        />
        <StatCard
          icon={<ClipboardCheck className="h-5 w-5" />}
          label={t('courseOwnerRole')}
          value={stats.totalAssignments}
          color="rose"
        />
      </motion.div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Latest Lectures */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                {t('latestLectures')}
              </h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recentLectures.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  {t('noLecturesYet')}
                </div>
              ) : (
                <div className="divide-y">
                  {recentLectures.map((lecture) => (
                    <div key={lecture.id} className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-800/40">
                        <BookOpen className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{lecture.title}</p>
                        {lecture.lecture_date && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(lecture.lecture_date).toLocaleDateString(direction === 'rtl' ? 'ar-SA' : 'en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                            {(lecture.description?.match(/__LECTURE_TIME__:([0-9]{1,2}:[0-9]{2})__/) || [])[1] && (
                              <span className="text-sky-800 dark:text-sky-400 font-medium flex items-center gap-0.5">
                                <Clock className="h-3 w-3" />
                                {(() => {
                                  const timeMatch = lecture.description!.match(/__LECTURE_TIME__:([0-9]{1,2}:[0-9]{2})__/)![1];
                                  const [h, m] = timeMatch.split(':').map(Number);
                                  const p = h >= 12 ? tc('pm') : tc('am');
                                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                                  return `${h12}:${m.toString().padStart(2, '0')} ${p}`;
                                })()}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Latest Files */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <File className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                {t('latestFiles')}
              </h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recentFiles.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  {t('noFilesYet')}
                </div>
              ) : (
                <div className="divide-y">
                  {recentFiles.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-800/40">
                        <File className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(file.created_at).toLocaleDateString(direction === 'rtl' ? 'ar-SA' : 'en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                      {file.category && (
                        <span className="shrink-0 rounded-full bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400 px-2 py-0.5 text-[10px] font-medium">
                          {file.category}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ============================================ */}
      {/* CO-TEACHERS SECTION                          */}
      {/* ============================================ */}
      {role === 'teacher' && (
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <UserCog className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                {t('coTeachers')}
              </h3>
              {isOwner && (
                <button
                  onClick={() => setAddCoTeacherOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/15 border border-sky-200 dark:border-sky-900/60 px-3 py-1.5 text-xs font-medium text-sky-800 dark:text-sky-400 hover:bg-sky-100 transition-colors"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {t('addCoTeacher')}
                </button>
              )}
            </div>

            <div className="p-4">
              {/* Co-teacher badge for current user */}
              {isCoTeacher && (
                <div className="mb-4 flex items-center justify-between gap-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-900/60 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-teal-700 dark:text-teal-500">
                    <Shield className="h-4 w-4 shrink-0" />
                    <span>{t('youAreCoTeacher')}</span>
                  </div>
                  <button
                    onClick={() => setLeaveConfirmOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/60 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-500 hover:bg-rose-100 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    {t('leaveCourse')}
                  </button>
                </div>
              )}

              {loadingCoTeachers ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-sky-700 dark:text-sky-400" />
                </div>
              ) : coTeachers.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-sm">
                  {t('noCoTeachersYet')}
                </div>
              ) : (
                <div className="space-y-2">
                  {coTeachers.map((ct) => {
                    const titleLabel = getTitleLabel(ct.teacher_title_id, ct.teacher_gender, t);
                    return (
                      <div
                        key={ct.id}
                        className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 transition-colors hover:bg-muted/30"
                      >
                        {/* Avatar */}
                        <button
                          type="button"
                          onClick={() => openProfile(ct.teacher_id)}
                          className="shrink-0"
                        >
                          <UserAvatar
                            name={ct.teacher_name || t('teacherFallback')}
                            avatarUrl={ct.teacher_avatar_url}
                            size="sm"
                          />
                        </button>

                        {/* Name and info */}
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => openProfile(ct.teacher_id)}
                            className="text-sm font-medium text-foreground hover:text-sky-700 transition-colors"
                          >
                            {titleLabel && (
                              <span className="text-sky-700 dark:text-sky-400 me-0.5 text-xs font-normal">{titleLabel}</span>
                            )}
                            {ct.teacher_name || t('teacherFallback')}
                          </button>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {ct.role === 'owner' ? t('courseOwnerRole') : t('coTeacherRole')}
                            {' · '}
                            {new Date(ct.created_at).toLocaleDateString(direction === 'rtl' ? 'ar-SA' : 'en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>

                        {/* Role badge */}
                        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          ct.role === 'owner'
                            ? 'bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-500'
                            : 'bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400'
                        }`}>
                          {ct.role === 'owner' ? (
                            <><Shield className="h-3 w-3" /> {t('owner')}</>
                          ) : (
                            <><UserCog className="h-3 w-3" /> {t('coTeacher')}</>
                          )}
                        </span>

                        {/* Remove button (only for owner, only for co-teachers) */}
                        {isOwner && ct.role === 'co_teacher' && (
                          <button
                            onClick={() => handleRemoveCoTeacher(ct.teacher_id)}
                            disabled={removingCoTeacherId === ct.teacher_id}
                            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-50"
                            title={t('removeCoTeacherTitle')}
                          >
                            {removingCoTeacherId === ct.teacher_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ============================================ */}
      {/* LEAVE COURSE CONFIRM DIALOG (co-teacher)     */}
      {/* ============================================ */}
      {leaveConfirmOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !leavingCourse && setLeaveConfirmOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10, pointerEvents: 'none' as const }}
            className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
            dir={direction}
          >
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-800/40 mb-4">
                <LogOut className="h-7 w-7 text-rose-600 dark:text-rose-500" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{t('leaveCourseTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-2">
                {t('leaveCourseConfirmMsg', { courseName: subject.name })}
              </p>
              <p className="text-xs text-muted-foreground/70 mb-6">
                {t('leaveCourseWarning')}
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
                      {t('leavingCourse')}
                    </>
                  ) : (
                    <>
                      <LogOut className="h-4 w-4" />
                      {t('yesLeave')}
                    </>
                  )}
                </button>
                <button
                  onClick={() => setLeaveConfirmOpen(false)}
                  disabled={leavingCourse}
                  className="flex-1 rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {tc('cancel')}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ============================================ */}
      {/* ADD CO-TEACHER MODAL                         */}
      {/* ============================================ */}
      {addCoTeacherOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !addingCoTeacher && setAddCoTeacherOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10, pointerEvents: 'none' as const }}
            className="relative w-full max-w-md rounded-2xl border bg-background shadow-2xl overflow-hidden"
            dir={direction}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-800/40 text-sky-700 dark:text-sky-400">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{t('addCoTeacher')}</h3>
                  <p className="text-xs text-muted-foreground">{t('addCoTeacherDesc')}</p>
                </div>
              </div>
              <button
                onClick={() => !addingCoTeacher && setAddCoTeacherOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 pb-6 pt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {t('teacherCodeLabel')}
                </label>
                <input
                  type="text"
                  value={teacherCodeInput}
                  onChange={(e) => setTeacherCodeInput(e.target.value.toUpperCase())}
                  placeholder={t('teacherCodePlaceholder')}
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all font-mono tracking-wider"
                  dir="ltr"
                  disabled={addingCoTeacher}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !addingCoTeacher) handleAddCoTeacher();
                  }}
                  maxLength={6}
                />
                <p className="text-xs text-muted-foreground">
                  {t('teacherCodeHint')}
                </p>
              </div>

              <button
                onClick={handleAddCoTeacher}
                disabled={addingCoTeacher || !teacherCodeInput.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-700 py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-sky-800 active:scale-[0.98]"
              >
                {addingCoTeacher ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('addingCoTeacher')}
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    {t('addCoTeacherBtn')}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}
