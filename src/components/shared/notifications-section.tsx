'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  ClipboardList,
  Award,
  BookOpen,
  FileText,
  Info,
  UserCheck,
  UserPlus,
  Loader2,
} from 'lucide-react';
import { useNotificationStore } from '@/stores/notification-store';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import type { CourseTab } from '@/lib/types';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { formatNameWithTitle } from '@/components/shared/user-avatar';

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  if (diffDays < 7) return `منذ ${diffDays} يوم`;
  return date.toLocaleDateString('ar-SA');
}

function getNotifIcon(type: string, title?: string) {
  if (type === 'link_request' || title?.includes('طلب ارتباط') || title?.includes('ارتباط')) {
    return <UserPlus className="h-5 w-5 text-amber-600" />;
  }
  switch (type) {
    case 'assignment': return <ClipboardList className="h-5 w-5 text-amber-600" />;
    case 'grade': return <Award className="h-5 w-5 text-emerald-600" />;
    case 'enrollment': return <BookOpen className="h-5 w-5 text-teal-600" />;
    case 'file_request': return <FileText className="h-5 w-5 text-orange-600" />;
    case 'file': return <FileText className="h-5 w-5 text-blue-600" />;
    case 'attendance': return <UserCheck className="h-5 w-5 text-violet-600" />;
    default: return <Info className="h-5 w-5 text-purple-600" />;
  }
}

export default function NotificationsSection() {
  const { user } = useAuthStore();
  const { setStudentSection, setTeacherSection, setCurrentPage } = useAppStore();
  const {
    notifications,
    unreadCount,
    initialized,
    initializeNotifications,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAll,
  } = useNotificationStore();

  const [linkRequestModal, setLinkRequestModal] = useState<{
    teacherId: string;
    notificationId: string;
    teacher: any | null;
    loading: boolean;
  } | null>(null);
  const [processingAction, setProcessingAction] = useState(false);

  useEffect(() => {
    if (user?.id && !initialized) {
      initializeNotifications(user.id);
    }
  }, [user?.id, initialized, initializeNotifications]);

  const handleNotificationClick = (notif: any) => {
    if (!notif.read) {
      markAsRead(notif.id);
    }

    // Handle link_request notifications
    if (notif.type === 'link_request' || notif.link?.startsWith('link_request:')) {
      const teacherId = notif.link?.replace('link_request:', '');
      if (teacherId) {
        setLinkRequestModal({ teacherId, notificationId: notif.id, teacher: null, loading: true });
        fetchTeacherForModal(teacherId);
      }
      return;
    }

    // Handle file_request notifications (owner received a new file request) - navigate to own profile
    if (notif.type === 'file_request' || notif.link?.startsWith('file_request:')) {
      const { openProfile } = useAppStore.getState();
      if (user?.id) openProfile(user.id);
      return;
    }

    // Map of link prefixes to course tabs — matches notification-bell.tsx
    const linkToTab: Record<string, CourseTab> = {
      enrollment: 'overview',
      subject: 'overview',
      assignment: 'assignments',
      lecture: 'lectures',
      exam: 'exams',
      note: 'notes',
      file: 'files',
      chat: 'chat',
    };

    // Check if this is a course-specific link (prefix:SUBJECT_ID or prefix:SUBJECT_ID:ITEM_ID)
    const courseLinkPrefix = Object.keys(linkToTab).find(prefix => notif.link?.startsWith(prefix + ':'));
    if (courseLinkPrefix) {
      const parts = notif.link!.split(':');
      const subjectId = parts[1] || null;
      if (subjectId) {
        const { setSelectedSubjectId, setCourseTab, setStudentSection, setTeacherSection, setAdminSection, setCurrentPage } = useAppStore.getState();
        setSelectedSubjectId(subjectId);
        setCourseTab(linkToTab[courseLinkPrefix]);
        // Navigate to the correct dashboard section
        if (user?.role === 'student') {
          setStudentSection('subjects');
          setCurrentPage('student-dashboard');
        } else if (user?.role === 'teacher') {
          setTeacherSection('subjects');
          setCurrentPage('teacher-dashboard');
        } else if (user?.role === 'admin' || user?.role === 'superadmin') {
          setAdminSection('subjects');
          setCurrentPage('admin-dashboard');
        }
      }
      return;
    }

    // Handle profile: links - navigate to user profile
    if (notif.link?.startsWith('profile:')) {
      const targetUserId = notif.link.replace('profile:', '');
      if (targetUserId) {
        const { openProfile } = useAppStore.getState();
        openProfile(targetUserId);
      }
      return;
    }

    // Handle legacy file request notification (link = 'settings')
    if (notif.type === 'file' && notif.link === 'settings' && notif.title?.includes('طلب ملف')) {
      const { openProfile } = useAppStore.getState();
      if (user?.id) openProfile(user.id);
      return;
    }

    // Navigate to source
    if (notif.link && notif.link !== 'settings') {
      navigateToLink(notif.link);
    }
  };

  const navigateToLink = (link: string) => {
    const [section] = link.split('?');
    const role = user?.role;

    if (role === 'student') {
      const validSections = ['dashboard', 'subjects', 'summaries', 'quizzes', 'files', 'assignments', 'attendance', 'teachers', 'settings', 'notifications'];
      if (validSections.includes(section)) {
        setStudentSection(section as any);
        setCurrentPage('student-dashboard');
      }
    } else if (role === 'teacher') {
      const validSections = ['dashboard', 'subjects', 'students', 'files', 'assignments', 'attendance', 'analytics', 'settings', 'notifications'];
      if (validSections.includes(section)) {
        setTeacherSection(section as any);
        setCurrentPage('teacher-dashboard');
      }
    }
  };

  const fetchTeacherForModal = async (teacherId: string) => {
    try {
      // Use server-side API to fetch teacher profile (bypasses RLS)
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/profile/${teacherId}`, {
        headers: {
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          setLinkRequestModal(prev => prev ? { ...prev, teacher: data.profile, loading: false } : null);
        } else {
          setLinkRequestModal(prev => prev ? { ...prev, loading: false } : null);
        }
      } else {
        setLinkRequestModal(prev => prev ? { ...prev, loading: false } : null);
      }
    } catch {
      setLinkRequestModal(prev => prev ? { ...prev, loading: false } : null);
    }
  };

  const handleAcceptLinkRequest = async () => {
    if (!linkRequestModal) return;
    setProcessingAction(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'accept', teacherId: linkRequestModal.teacherId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('تم قبول طلب الارتباط');
        setLinkRequestModal(null);
      } else {
        toast.error(data.error || 'حدث خطأ');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleRejectLinkRequest = async () => {
    if (!linkRequestModal) return;
    setProcessingAction(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'reject', teacherId: linkRequestModal.teacherId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('تم رفض طلب الارتباط');
        setLinkRequestModal(null);
      } else {
        toast.error(data.error || 'حدث خطأ');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingAction(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  return (
    <>
      <motion.div variants={containerVariants} initial="hidden" animate="visible" dir="rtl" className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
              <Bell className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">الإشعارات</h2>
              <p className="text-xs text-muted-foreground">
                {unreadCount > 0 ? `${unreadCount} إشعار غير مقروء` : 'لا توجد إشعارات جديدة'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                تعيين الكل كمقروء
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                مسح الكل
              </button>
            )}
          </div>
        </div>

        {/* Notifications list */}
        {notifications.length === 0 ? (
          <motion.div variants={itemVariants}>
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
                <BellOff className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">لا توجد إشعارات</p>
              <p className="text-xs text-muted-foreground/70 mt-1">ستظهر الإشعارات الجديدة هنا</p>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notif) => (
              <motion.div
                key={notif.id}
                variants={itemVariants}
                onClick={() => handleNotificationClick(notif)}
                className={`group flex items-start gap-4 rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${
                  !notif.read ? 'bg-emerald-50/50 border-emerald-200' : 'bg-card hover:bg-muted/30'
                } ${notif.link ? 'hover:border-emerald-300' : ''}`}
              >
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  !notif.read ? 'bg-emerald-100' : 'bg-muted/50'
                }`}>
                  {getNotifIcon(notif.type, notif.title)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${!notif.read ? 'font-bold text-foreground' : 'font-medium text-foreground/80'}`}>
                      {notif.title}
                    </p>
                    {!notif.read && (
                      <div className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {notif.message}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 mt-2">
                    {timeAgo(notif.createdAt)}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearNotification(notif.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-50 transition-all"
                  aria-label="حذف الإشعار"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Link Request Modal */}
      <AnimatePresence>
        {linkRequestModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={() => !processingAction && setLinkRequestModal(null)}
          >
            <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir="rtl"
            >
              <div className="flex flex-col items-center text-center">
                {linkRequestModal.loading ? (
                  <Loader2 className="h-12 w-12 text-emerald-500 animate-spin mb-4" />
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-foreground mb-1">طلب ارتباط</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      أرسل {linkRequestModal.teacher?.gender === 'female' ? 'المعلمة' : 'المعلم'}{' '}
                      <span className="font-semibold text-foreground">{formatNameWithTitle(linkRequestModal.teacher?.name || 'معلم', 'teacher', linkRequestModal.teacher?.title_id, linkRequestModal.teacher?.gender)}</span>{' '}
                      طلب ارتباط بك
                    </p>
                    <div className="flex items-center gap-3 w-full">
                      <button
                        onClick={handleAcceptLinkRequest}
                        disabled={processingAction}
                        className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                      >
                        {processingAction ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'قبول'}
                      </button>
                      <button
                        onClick={handleRejectLinkRequest}
                        disabled={processingAction}
                        className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
                      >
                        {processingAction ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'رفض'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
