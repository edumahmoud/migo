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
  ShieldAlert,
  Vote,
  MessageCircle,
} from 'lucide-react';
import { useNotificationStore } from '@/stores/notification-store';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { navigateNotification, notifTypeToTab } from '@/lib/notification-navigation';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import { formatNameWithTitle } from '@/components/shared/user-avatar';

function timeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string, locale: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('common.justNow');
  if (diffMins < 60) return t('common.minutesAgo', { n: diffMins });
  if (diffHours < 24) return t('common.hoursAgo', { n: diffHours });
  if (diffDays < 7) return t('common.daysAgo', { n: diffDays });
  return date.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US');
}

function getNotifIcon(type: string, title: string | undefined, t: (key: string) => string) {
  if (type === 'link_request' || title?.includes(t('notifications.keywordLinkRequest')) || title?.includes(t('notifications.keywordLink'))) {
    return <UserPlus className="h-5 w-5 text-amber-600 dark:text-amber-500" />;
  }
  switch (type) {
    case 'assignment': return <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-500" />;
    case 'grade': return <Award className="h-5 w-5 text-sky-700 dark:text-sky-400" />;
    case 'enrollment': return <BookOpen className="h-5 w-5 text-teal-600 dark:text-teal-500" />;
    case 'file_request': return <FileText className="h-5 w-5 text-orange-600 dark:text-orange-400" />;
    case 'file': return <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
    case 'attendance': return <UserCheck className="h-5 w-5 text-violet-600 dark:text-violet-500" />;
    case 'lecture': return <BookOpen className="h-5 w-5 text-teal-600 dark:text-teal-500" />;
    case 'chat': return <Bell className="h-5 w-5 text-sky-600 dark:text-sky-400" />;
    case 'report': return <ShieldAlert className="h-5 w-5 text-orange-600 dark:text-orange-400" />;
    case 'poll': return <Vote className="h-5 w-5 text-violet-600 dark:text-violet-500" />;
    case 'quiz': return <ClipboardList className="h-5 w-5 text-rose-600 dark:text-rose-500" />;
    case 'team_message': return <MessageCircle className="h-5 w-5 text-sky-600 dark:text-sky-400" />;
    default: return <Info className="h-5 w-5 text-sky-700 dark:text-sky-400" />;
  }
}

export default function NotificationsSection() {
  const { t, direction, locale } = useTranslations();
  const { user } = useAuthStore();
  const { setStudentSection, setTeacherSection, setAdminSection, setCurrentPage } = useAppStore();
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

  // ─── Filter out chat notifications from the notifications section ───
  // Chat notifications should only appear in the chat section icon.
  const bellNotifications = notifications.filter(n => n.type !== 'chat');
  const bellUnreadCount = bellNotifications.filter(n => !n.read).length;

  const [linkRequestModal, setLinkRequestModal] = useState<{
    teacherId: string;
    notificationId: string;
    teacher: any | null;
    loading: boolean;
  } | null>(null);
  const [processingAction, setProcessingAction] = useState(false);

  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

  useEffect(() => {
    if (user?.id && !initialized) {
      initializeNotifications(user.id);
    }
    // Cleanup on unmount to prevent ghost subscriptions
    // Primary cleanup happens in auth-store signOut, this is a safety net
    return () => {
      // We don't cleanup here because this section unmounts/remounts on navigation
      // The real cleanup happens in auth-store.ts signOut() and SIGNED_OUT handler
    };
  }, [user?.id, initialized, initializeNotifications]);

  const handleNotificationClick = (notif: any) => {
    if (!notif.read) {
      markAsRead(notif.id);
    }

    // Use the centralized navigation utility
    const appState = useAppStore.getState();
    const result = navigateNotification(notif, {
      userRole: user?.role,
      userId: user?.id,
      setSelectedSubjectId: appState.setSelectedSubjectId,
      setCourseTab: appState.setCourseTab,
      setStudentSection: appState.setStudentSection,
      setTeacherSection: appState.setTeacherSection,
      setAdminSection: appState.setAdminSection,
      setCurrentPage: appState.setCurrentPage,
      setPendingReportId: appState.setPendingReportId,
      openProfile: appState.openProfile,
      t,
    });

    // Handle link_request — show modal instead of navigating
    if (result === 'link_request') {
      const teacherId = notif.link?.replace('link_request:', '');
      if (teacherId) {
        setLinkRequestModal({ teacherId, notificationId: notif.id, teacher: null, loading: true });
        fetchTeacherForModal(teacherId);
      }
      return;
    }
  };

  const fetchTeacherForModal = async (teacherId: string) => {
    try {
      // Use server-side API to fetch teacher profile (bypasses RLS)
      const headers = await getCachedAuthHeaders();
      const res = await fetch(`/api/profile/${teacherId}`, { headers });
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
      const tokenHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: tokenHeaders,
        body: JSON.stringify({ action: 'accept', teacherId: linkRequestModal.teacherId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(t('notifications.toastAcceptSuccess'));
        setLinkRequestModal(null);
      } else {
        toast.error(data.error || t('common.toastError'));
      }
    } catch {
      toast.error(t('common.toastError'));
    } finally {
      setProcessingAction(false);
    }
  };

  const handleRejectLinkRequest = async () => {
    if (!linkRequestModal) return;
    setProcessingAction(true);
    try {
      const tokenHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers: tokenHeaders,
        body: JSON.stringify({ action: 'reject', teacherId: linkRequestModal.teacherId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(t('notifications.toastRejectSuccess'));
        setLinkRequestModal(null);
      } else {
        toast.error(data.error || t('common.toastError'));
      }
    } catch {
      toast.error(t('common.toastError'));
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
      <motion.div variants={containerVariants} initial="hidden" animate="visible" dir={direction} className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/30">
              <Bell className="h-5 w-5 text-sky-700 dark:text-sky-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{t('notifications.title')}</h2>
              <p className="text-xs text-muted-foreground">
                {bellUnreadCount > 0 ? t('notifications.unreadCount', { count: bellUnreadCount }) : t('notifications.allRead')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {bellUnreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t('notifications.markAllRead')}
              </button>
            )}
            {bellNotifications.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('notifications.clearAll')}
              </button>
            )}
          </div>
        </div>

        {/* Notifications list */}
        {bellNotifications.length === 0 ? (
          <motion.div variants={itemVariants}>
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-700 bg-sky-50/30 dark:bg-sky-900/15 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30 mb-4">
                <BellOff className="h-8 w-8 text-sky-400" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">{t('notifications.noNotifications')}</p>
              <p className="text-xs text-muted-foreground/70 mt-1">{t('notifications.noNotificationsDesc')}</p>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {bellNotifications.map((notif) => (
              <motion.div
                key={notif.id}
                variants={itemVariants}
                onClick={() => handleNotificationClick(notif)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNotificationClick(notif);
                  }
                }}
                className={`group flex items-start gap-4 rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${
                  !notif.read ? 'bg-sky-50/50 border-sky-200 dark:bg-sky-900/15 dark:border-sky-900/60' : 'bg-card hover:bg-muted/30'
                } ${notif.link ? 'hover:border-sky-300 dark:hover:border-sky-600' : ''}`}
              >
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  !notif.read ? 'bg-sky-100 dark:bg-sky-900/30' : 'bg-muted/50'
                }`}>
                  {getNotifIcon(notif.type, notif.title, t)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${!notif.read ? 'font-bold text-foreground' : 'font-medium text-foreground/80'}`}>
                      {notif.title}
                    </p>
                    {!notif.read && (
                      <div className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-600 dark:bg-sky-400" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {notif.message}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 mt-2">
                    {timeAgo(notif.createdAt, t, locale)}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearNotification(notif.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 md:opacity-60 md:group-hover:opacity-100 touch-target flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all"
                  aria-label={t('notifications.deleteNotification')}
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
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={() => !processingAction && setLinkRequestModal(null)}
          >
            <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0, pointerEvents: 'none' as const }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
            >
              <div className="flex flex-col items-center text-center">
                {linkRequestModal.loading ? (
                  <Loader2 className="h-12 w-12 text-sky-600 animate-spin mb-4" />
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-foreground mb-1">{t('notifications.linkRequest')}</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      {t('notifications.linkRequestDesc', { gender: linkRequestModal.teacher?.gender === 'female' ? t('roles.teacherFemale') : t('roles.teacher'), name: '' })}{' '}
                      <span className="font-semibold text-foreground">{formatNameWithTitle(linkRequestModal.teacher?.name || t('roles.teacher'), 'teacher', linkRequestModal.teacher?.title_id, linkRequestModal.teacher?.gender, t)}</span>
                    </p>
                    <div className="flex items-center gap-3 w-full">
                      <button
                        onClick={handleAcceptLinkRequest}
                        disabled={processingAction}
                        className="flex-1 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors"
                      >
                        {processingAction ? <Loader2 className="h-4 w-4 animate-spin inline" /> : t('notifications.acceptBtn')}
                      </button>
                      <button
                        onClick={handleRejectLinkRequest}
                        disabled={processingAction}
                        className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
                      >
                        {processingAction ? <Loader2 className="h-4 w-4 animate-spin inline" /> : t('notifications.rejectBtn')}
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
