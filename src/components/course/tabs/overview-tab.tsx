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
import StatCard from '@/components/shared/stat-card';
import UserAvatar, { getTitleLabel } from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import { useAppStore } from '@/stores/app-store';
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

// -------------------------------------------------------
// Helper: format date
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

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function OverviewTab({ profile, role, subjectId, subject }: OverviewTabProps) {
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

  // -------------------------------------------------------
  // Auth headers helper
  // -------------------------------------------------------
  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  // -------------------------------------------------------
  // Fetch co-teachers
  // -------------------------------------------------------
  const fetchCoTeachers = useCallback(async () => {
    if (role !== 'teacher') return;
    setLoadingCoTeachers(true);
    try {
      const headers = await getAuthHeaders();
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
      toast.error('يرجى إدخال كود المعلم');
      return;
    }
    setAddingCoTeacher(true);
    try {
      const headers = await getAuthHeaders();
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
        toast.error(data.error || 'حدث خطأ أثناء إضافة المعلم المشارك');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      const headers = await getAuthHeaders();
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
        toast.error(data.error || 'حدث خطأ أثناء إزالة المعلم المشارك');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      const headers = await getAuthHeaders();
      const res = await fetch('/api/subject-teachers', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ subjectId, teacherId: profile.id, selfLeave: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message || 'تمت إزالتك من المقرر بنجاح');
        // Navigate back to dashboard
        setSelectedSubjectId(null);
        setCourseTab('overview');
      } else {
        toast.error(data.error || 'حدث خطأ أثناء مغادرة المقرر');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Quick Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={<BookOpen className="h-5 w-5" />}
          label="المحاضرات"
          value={stats.totalLectures}
          color="emerald"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="الطلاب"
          value={stats.totalStudents}
          color="teal"
        />
        <StatCard
          icon={<File className="h-5 w-5" />}
          label="الملفات"
          value={stats.totalFiles}
          color="amber"
        />
        <StatCard
          icon={<ClipboardCheck className="h-5 w-5" />}
          label="المهام"
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
                <BookOpen className="h-4 w-4 text-emerald-600" />
                أحدث المحاضرات
              </h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recentLectures.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا توجد محاضرات بعد
                </div>
              ) : (
                <div className="divide-y">
                  {recentLectures.map((lecture) => (
                    <div key={lecture.id} className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                        <BookOpen className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{lecture.title}</p>
                        {lecture.lecture_date && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(lecture.lecture_date)}
                            {(lecture.description?.match(/__LECTURE_TIME__:([0-9]{1,2}:[0-9]{2})__/) || [])[1] && (
                              <span className="text-emerald-700 font-medium flex items-center gap-0.5">
                                <Clock className="h-3 w-3" />
                                {(() => {
                                  const t = lecture.description!.match(/__LECTURE_TIME__:([0-9]{1,2}:[0-9]{2})__/)![1];
                                  const [h, m] = t.split(':').map(Number);
                                  const p = h >= 12 ? 'م' : 'ص';
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
                <File className="h-4 w-4 text-amber-600" />
                أحدث الملفات
              </h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recentFiles.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا توجد ملفات بعد
                </div>
              ) : (
                <div className="divide-y">
                  {recentFiles.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 p-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                        <File className="h-4 w-4 text-amber-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(file.created_at)}
                        </p>
                      </div>
                      {file.category && (
                        <span className="shrink-0 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">
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
                <UserCog className="h-4 w-4 text-emerald-600" />
                المعلمون المشاركون
              </h3>
              {isOwner && (
                <button
                  onClick={() => setAddCoTeacherOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  إضافة معلم مشارك
                </button>
              )}
            </div>

            <div className="p-4">
              {/* Co-teacher badge for current user */}
              {isCoTeacher && (
                <div className="mb-4 flex items-center justify-between gap-2 rounded-lg bg-teal-50 border border-teal-200 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-teal-700">
                    <Shield className="h-4 w-4 shrink-0" />
                    <span>أنت معلم مشارك في هذا المقرر</span>
                  </div>
                  <button
                    onClick={() => setLeaveConfirmOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    مغادرة المقرر
                  </button>
                </div>
              )}

              {loadingCoTeachers ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                </div>
              ) : coTeachers.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-sm">
                  لا يوجد معلمون مشاركون بعد
                </div>
              ) : (
                <div className="space-y-2">
                  {coTeachers.map((ct) => {
                    const titleLabel = getTitleLabel(ct.teacher_title_id, ct.teacher_gender);
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
                            name={ct.teacher_name || 'معلم'}
                            avatarUrl={ct.teacher_avatar_url}
                            size="sm"
                          />
                        </button>

                        {/* Name and info */}
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => openProfile(ct.teacher_id)}
                            className="text-sm font-medium text-foreground hover:text-emerald-600 transition-colors"
                          >
                            {titleLabel && (
                              <span className="text-emerald-600 ml-0.5 text-xs font-normal">{titleLabel}</span>
                            )}
                            {ct.teacher_name || 'معلم'}
                          </button>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {ct.role === 'owner' ? 'مالك المقرر' : 'معلم مشارك'}
                            {' · '}
                            {formatDate(ct.created_at)}
                          </p>
                        </div>

                        {/* Role badge */}
                        <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          ct.role === 'owner'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {ct.role === 'owner' ? (
                            <><Shield className="h-3 w-3" /> مالك</>
                          ) : (
                            <><UserCog className="h-3 w-3" /> مشارك</>
                          )}
                        </span>

                        {/* Remove button (only for owner, only for co-teachers) */}
                        {isOwner && ct.role === 'co_teacher' && (
                          <button
                            onClick={() => handleRemoveCoTeacher(ct.teacher_id)}
                            disabled={removingCoTeacherId === ct.teacher_id}
                            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-50"
                            title="إزالة المعلم المشارك"
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
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !leavingCourse && setLeaveConfirmOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
            dir="rtl"
          >
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 mb-4">
                <LogOut className="h-7 w-7 text-rose-600" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">مغادرة المقرر</h3>
              <p className="text-sm text-muted-foreground mb-2">
                هل أنت متأكد من مغادرة مقرر &quot;{subject.name}&quot;؟
              </p>
              <p className="text-xs text-muted-foreground/70 mb-6">
                لن تتمكن من الوصول إلى محتوى المقرر بعد الآن كمعلم مشارك.
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
                      جاري المغادرة...
                    </>
                  ) : (
                    <>
                      <LogOut className="h-4 w-4" />
                      نعم، مغادرة
                    </>
                  )}
                </button>
                <button
                  onClick={() => setLeaveConfirmOpen(false)}
                  disabled={leavingCourse}
                  className="flex-1 rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  إلغاء
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
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !addingCoTeacher && setAddCoTeacherOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-md rounded-2xl border bg-background shadow-2xl overflow-hidden"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">إضافة معلم مشارك</h3>
                  <p className="text-xs text-muted-foreground">أضف معلماً آخر لمشاركة إدارة المقرر</p>
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
                  كود المعلم <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={teacherCodeInput}
                  onChange={(e) => setTeacherCodeInput(e.target.value.toUpperCase())}
                  placeholder="أدخل كود المعلم (مثال: ABC123)"
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all font-mono tracking-wider"
                  dir="ltr"
                  disabled={addingCoTeacher}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !addingCoTeacher) handleAddCoTeacher();
                  }}
                  maxLength={6}
                />
                <p className="text-xs text-muted-foreground">
                  يمكنك العثور على كود المعلم في ملفه الشخصي أو لوحة تحكم المعلم
                </p>
              </div>

              <button
                onClick={handleAddCoTeacher}
                disabled={addingCoTeacher || !teacherCodeInput.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 active:scale-[0.98]"
              >
                {addingCoTeacher ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الإضافة...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    إضافة معلم مشارك
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
