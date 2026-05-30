'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, Trash2, ClipboardList, Award, BookOpen, FileText, Info, CheckCheck, UserCheck, BellOff, UserPlus, Loader2, CheckCircle2, XCircle, ShieldAlert, Vote, MessageCircle } from 'lucide-react';
import { useNotificationStore } from '@/stores/notification-store';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import type { NotificationType } from '@/lib/types';
import { navigateNotification, notifTypeToTab } from '@/lib/notification-navigation';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import { toast } from 'sonner';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';

// ─── Deeplink queue (global, survives before component mount) ───
// When the SW or sw-registration dispatches a `notification-deeplink` event
// before this component has mounted, the event is lost. This queue captures
// those early events so they can be processed after mount.
interface DeeplinkEntry {
  url: string;
  notifType: string;
}

const deeplinkQueue: DeeplinkEntry[] = [];
let deeplinkHandlerAttached = false;

/**
 * Process a single deeplink entry through the notification click handler.
 * Called both from the live event listener and from the queued entries.
 */
function processDeeplinkEntry(entry: DeeplinkEntry, handler: (notif: { id: string; type: string; title?: string; read: boolean; link?: string | null; message?: string }) => void) {
  handler({
    id: `deeplink-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: entry.notifType || 'system',
    read: false,
    link: entry.url,
  });
}

/**
 * Ensure the global `notification-deeplink` listener is attached as early as
 * possible (module-level), so events arriving before React renders are queued.
 */
if (typeof window !== 'undefined' && !deeplinkHandlerAttached) {
  deeplinkHandlerAttached = true;
  window.addEventListener('notification-deeplink', (event: Event) => {
    const { url, notifType } = (event as CustomEvent).detail || {};
    if (url) {
      deeplinkQueue.push({ url, notifType: notifType || 'system' });
    }
  });
}

function timeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string, locale: string = 'ar'): string {
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

function getNotifIcon(type: string, title?: string, t?: (key: string) => string) {
  // Detect link_request notifications by title (works even before DB migration)
  if (type === 'link_request' || (t && (title?.includes(t('notifications.keywordLinkRequest')) || title?.includes(t('notifications.keywordLink'))))) {
    return <UserPlus className="h-4 w-4 text-amber-600" />;
  }
  switch (type) {
    case 'assignment': return <ClipboardList className="h-4 w-4 text-amber-600" />;
    case 'grade': return <Award className="h-4 w-4 text-teal-600" />;
    case 'enrollment': return <BookOpen className="h-4 w-4 text-teal-600" />;
    case 'file_request': return <FileText className="h-4 w-4 text-orange-600" />;
    case 'file': return <FileText className="h-4 w-4 text-blue-600" />;
    case 'attendance': return <UserCheck className="h-4 w-4 text-violet-600" />;
    case 'lecture': return <BookOpen className="h-4 w-4 text-teal-600" />;
    case 'chat': return <MessageCircle className="h-4 w-4 text-sky-600" />;
    case 'report': return <ShieldAlert className="h-4 w-4 text-orange-600" />;
    case 'poll': return <Vote className="h-4 w-4 text-violet-600" />;
    case 'quiz': return <ClipboardList className="h-4 w-4 text-rose-600" />;
    case 'team_message': return <MessageCircle className="h-4 w-4 text-sky-600" />;
    default: return <Info className="h-4 w-4 text-sky-700 dark:text-sky-400" />;
  }
}

export default function NotificationBell() {
  const { t, direction, locale } = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [linkRequestModal, setLinkRequestModal] = useState<{teacherId: string; notificationId: string; teacher: any | null; loading: boolean} | null>(null);
  const [processingAction, setProcessingAction] = useState(false);
  // Use individual selectors to ensure each value triggers independent re-renders
  // This avoids stale closures that can occur when destructuring from a single object
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const initialized = useNotificationStore((s) => s.initialized);
  const initializeNotifications = useNotificationStore((s) => s.initializeNotifications);
  const refetchNotifications = useNotificationStore((s) => s.refetchNotifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const clearNotification = useNotificationStore((s) => s.clearNotification);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const { user } = useAuthStore();
  const { setStudentSection, setTeacherSection, setAdminSection, setCurrentPage } = useAppStore();

  // ─── All notifications shown in bell (including chat) ───
  // Chat notifications appear in the bell with a MessageCircle icon and
  // deep link to the conversation. They are also shown in the chat section.
  const bellNotifications = notifications;
  const bellUnreadCount = notifications.filter(n => !n.read).length;

  // Initialize notifications from DB when component mounts
  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

  // The notification store already handles both Realtime subscription AND polling,
  // so we only need to trigger initialization here — no duplicate polling needed.
  useEffect(() => {
    if (user?.id && !initialized) {
      initializeNotifications(user.id);
    }
  }, [user?.id, initialized, initializeNotifications]);

  // ─── Periodic forced refresh for the bell (every 30s) ───
  // This ensures the badge count and notification list stay up-to-date even
  // if the store's Realtime subscription drops or polling misses events.
  // It runs independently of the store's internal 8s/15s polling.
  useEffect(() => {
    if (!user?.id) return;
    const timer = setInterval(() => {
      refetchNotifications();
    }, 30000);
    return () => clearInterval(timer);
  }, [user?.id, refetchNotifications]);



  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (isOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  /** Fetch teacher info for the link request modal */
  const fetchTeacherForModal = async (teacherId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', teacherId)
        .single();
      if (!error && data) {
        setLinkRequestModal(prev => prev ? { ...prev, teacher: data, loading: false } : null);
      } else {
        setLinkRequestModal(prev => prev ? { ...prev, loading: false } : null);
      }
    } catch {
      setLinkRequestModal(prev => prev ? { ...prev, loading: false } : null);
    }
  };

  /** Accept a link request from a teacher */
  const handleAcceptLinkRequest = async () => {
    if (!linkRequestModal) return;
    setProcessingAction(true);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers,
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
      toast.error(t('common.errorUnexpected'));
    } finally {
      setProcessingAction(false);
    }
  };

  /** Reject a link request from a teacher */
  const handleRejectLinkRequest = async () => {
    if (!linkRequestModal) return;
    setProcessingAction(true);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/link-student-approve', {
        method: 'POST',
        headers,
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
      toast.error(t('common.errorUnexpected'));
    } finally {
      setProcessingAction(false);
    }
  };

  /** Handle clicking a notification — mark as read and navigate if link is provided */
  const handleNotificationClick = (notif: { id: string; type: string; title?: string; read: boolean; link?: string | null; message?: string }) => {
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

    // Close the dropdown after navigation
    if (result === 'handled') {
      setIsOpen(false);
    }
  };

  // Ref to always point to the latest handleNotificationClick
  const handleNotificationClickRef = useRef(handleNotificationClick);
  useEffect(() => {
    handleNotificationClickRef.current = handleNotificationClick;
  });

  // Listen for deeplink events from SW (notification clicks and initial page load deeplinks)
  // AND process any queued deeplinks that arrived before mount
  useEffect(() => {
    const handleDeeplink = (event: Event) => {
      const { url, notifType } = (event as CustomEvent).detail || {};
      if (url && handleNotificationClickRef.current) {
        processDeeplinkEntry({ url, notifType: notifType || 'system' }, handleNotificationClickRef.current);
      }
    };

    window.addEventListener('notification-deeplink', handleDeeplink);

    // Process any deeplinks that were queued before this component mounted
    // Check both the module-level queue AND the window global queue (set by sw-registration.tsx)
    const allQueued: DeeplinkEntry[] = [];

    // Module-level queue (events captured by the listener registered at module load)
    if (deeplinkQueue.length > 0) {
      allQueued.push(...deeplinkQueue.splice(0));
    }

    // Window global queue (set by sw-registration.tsx before this module loaded)
    const windowQueue = (window as any).__attendoDeeplinkQueue as DeeplinkEntry[] | undefined;
    if (Array.isArray(windowQueue) && windowQueue.length > 0) {
      const windowEntries = windowQueue.splice(0);
      // Deduplicate: only add entries not already in allQueued (by url+notifType)
      const seen = new Set(allQueued.map(e => `${e.url}::${e.notifType}`));
      for (const entry of windowEntries) {
        const key = `${entry.url}::${entry.notifType}`;
        if (!seen.has(key)) {
          allQueued.push(entry);
          seen.add(key);
        }
      }
    }

    if (allQueued.length > 0 && handleNotificationClickRef.current) {
      // Dequeue and process with a small delay to ensure the app is fully ready
      requestAnimationFrame(() => {
        for (const entry of allQueued) {
          if (handleNotificationClickRef.current) {
            processDeeplinkEntry(entry, handleNotificationClickRef.current);
          }
        }
      });
    }

    return () => window.removeEventListener('notification-deeplink', handleDeeplink);
  }, []);

  return (
    <>
      <div className="relative">
        <button
          ref={buttonRef}
          onClick={() => {
            setIsOpen(!isOpen);
            // Refresh notifications from DB when bell is opened
            if (!isOpen) refetchNotifications();
          }}
          className="relative touch-target flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 active:bg-muted/80 hover:text-foreground transition-colors touch-manipulation"
          aria-label={t('notifications.title')}
        >
          <Bell className="h-5 w-5" />
          <AnimatePresence>
            {bellUnreadCount > 0 && (
              <motion.span
                key="badge"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-0.5 -end-0.5 flex items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white min-w-[18px] h-[18px]"
              >
                {bellUnreadCount > 9 ? '9+' : bellUnreadCount}
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, pointerEvents: 'none' as const }}
              transition={{ duration: 0.1 }}
              className="fixed top-14 inset-x-2 sm:absolute sm:top-full sm:mt-2 sm:inset-x-auto sm:start-auto sm:end-0 sm:w-[360px] w-auto z-50 rounded-xl border bg-background shadow-lg overflow-hidden"
              dir={direction}
            >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-3">
              <h3 className="text-sm font-bold text-foreground">{t('notifications.title')}</h3>
              <div className="flex items-center gap-1">
                {bellUnreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    {t('notifications.markAllRead')}
                  </button>
                )}
                {bellNotifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-600 dark:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('notifications.clearAll')}
                  </button>
                )}
              </div>
            </div>

            {/* Notifications list */}
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {bellNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 mb-3">
                    <BellOff className="h-7 w-7 opacity-40" />
                  </div>
                  <p className="text-sm font-medium">{t('notifications.noNotifications')}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">{t('notifications.noNotificationsDesc')}</p>
                </div>
              ) : (
                <div className="divide-y">
                  {bellNotifications.map((notif) => (
                    <motion.div
                      key={notif.id}
                      layout
                      onClick={() => handleNotificationClick(notif)}
                      className={`group flex items-start gap-3 p-3 cursor-pointer transition-colors hover:bg-muted/30 ${
                        !notif.read ? 'bg-sky-50/30 dark:bg-sky-900/15' : ''
                      } ${notif.link ? 'hover:bg-muted/50' : ''}`}
                    >
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        !notif.read ? 'bg-sky-100 dark:bg-sky-800/40' : 'bg-muted/50'
                      }`}>
                        {getNotifIcon(notif.type, notif.title, t)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${!notif.read ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notif.message}
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          {timeAgo(notif.createdAt, t, locale)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!notif.read && (
                          <div className="h-2 w-2 rounded-full bg-teal-500" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            clearNotification(notif.id);
                          }}
                          className="touch-target opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-500 transition-all"
                          aria-label={t('notifications.deleteNotification')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {bellNotifications.length > 0 && (
              <div className="border-t px-3 py-2 text-center">
                <p className="text-xs text-muted-foreground/60">
                  {bellUnreadCount > 0
                    ? t('notifications.unreadCount', { count: bellUnreadCount })
                    : t('notifications.allRead')}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* Link Request Modal */}
      <AnimatePresence>
        {linkRequestModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
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
                  <Loader2 className="h-12 w-12 text-sky-500 animate-spin mb-4" />
                ) : (
                  <>
                    <UserAvatar name={linkRequestModal.teacher?.name || t('roles.teacher')} avatarUrl={linkRequestModal.teacher?.avatar_url} size="lg" />
                    <h3 className="text-lg font-bold text-foreground mt-3 mb-1">{t('notifications.linkRequest')}</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      {t('notifications.linkRequestDesc', { gender: linkRequestModal.teacher?.gender === 'female' ? t('admin.teacherFemale') : t('roles.teacher'), name: formatNameWithTitle(linkRequestModal.teacher?.name || t('roles.teacher'), 'teacher', linkRequestModal.teacher?.title_id, linkRequestModal.teacher?.gender, t) })}
                    </p>
                    <div className="flex items-center gap-3 w-full">
                      <button
                        onClick={handleAcceptLinkRequest}
                        disabled={processingAction}
                        className="flex-1 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                      >
                        {processingAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {t('notifications.acceptBtn')}
                      </button>
                      <button
                        onClick={handleRejectLinkRequest}
                        disabled={processingAction}
                        className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                      >
                        {processingAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                        {t('notifications.rejectBtn')}
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
