'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, Trash2, ClipboardList, Award, BookOpen, FileText, Info, CheckCheck, UserCheck, BellOff, UserPlus, Loader2, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
import { useNotificationStore } from '@/stores/notification-store';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import type { CourseTab, NotificationType } from '@/lib/types';
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

// ─── Notification type → default CourseTab mapping ───
// Used when the link format doesn't explicitly encode the tab (e.g. `subject:SUBJECT_ID`
// without a 3rd part). This ensures every notification type lands on the correct tab.
const notifTypeToTab: Record<string, CourseTab> = {
  assignment: 'assignments',
  grade: 'assignments',
  enrollment: 'students',
  file: 'files',
  file_request: 'files',
  system: 'overview',
  attendance: 'lectures',
  link_request: 'overview',
  lecture: 'lectures',
  chat: 'overview',
  note: 'notes',
  public_note_created: 'notes',
  report: 'overview',
};

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
    case 'chat': return <Bell className="h-4 w-4 text-sky-600" />;
    case 'report': return <ShieldAlert className="h-4 w-4 text-orange-600" />;
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
  const { 
    notifications, 
    unreadCount, 
    initialized,
    initializeNotifications, 
    refetchNotifications,
    markAsRead, 
    markAllAsRead, 
    clearNotification, 
    clearAll 
  } = useNotificationStore();
  const { user } = useAuthStore();
  const { setStudentSection, setTeacherSection, setAdminSection, setCurrentPage } = useAppStore();

  // ─── Filter out chat notifications from the bell ───
  // Chat notifications should only appear in the chat section icon,
  // not in the notification bell dropdown or unread count badge.
  const bellNotifications = notifications.filter(n => n.type !== 'chat');
  const bellUnreadCount = bellNotifications.filter(n => !n.read).length;

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

  /** Parse notification link and navigate using app store */
  const navigateToLink = (link: string) => {
    // Link format examples: "assignments", "subjects", "quizzes", "attendance", "reports"
    // Or with detail: "assignments?id=xxx"
    // Or tab-based: "subjects?tab=lectures&id=SUBJECT_ID"
    // Or path-style: "/reports/ID"
    const [section, queryString] = link.startsWith('/') ? link.slice(1).split('?') : link.split('?');
    const role = user?.role;

    // Parse query params
    const params = new URLSearchParams(queryString || '');
    const tab = params.get('tab');
    const subjectId = params.get('id');

    // Handle path-style links like "/reports/ID" — extract the base section
    const baseSection = section.includes('/') ? section.split('/')[0] : section;

    // Handle tab-based navigation for subjects (e.g., "subjects?tab=lectures&id=SUBJECT_ID")
    if (baseSection === 'subjects' && subjectId) {
      const { setSelectedSubjectId, setCourseTab } = useAppStore.getState();
      setSelectedSubjectId(subjectId);
      if (tab) {
        setCourseTab(tab as CourseTab);
      }
      if (role === 'student') {
        setStudentSection('subjects');
        setCurrentPage('student-dashboard');
      } else if (role === 'teacher') {
        setTeacherSection('subjects');
        setCurrentPage('teacher-dashboard');
      } else if (role === 'admin' || role === 'superadmin') {
        setAdminSection('subjects');
        setCurrentPage('admin-dashboard');
      }
      return;
    }

    if (role === 'student') {
      const validSections = ['dashboard', 'subjects', 'summaries', 'quizzes', 'files', 'assignments', 'attendance', 'teachers', 'chat', 'settings', 'notifications', 'reports'];
      if (validSections.includes(baseSection)) {
        setStudentSection(baseSection as 'dashboard' | 'subjects' | 'summaries' | 'quizzes' | 'files' | 'assignments' | 'attendance' | 'teachers' | 'chat' | 'settings' | 'notifications' | 'reports');
        setCurrentPage('student-dashboard');
      }
    } else if (role === 'teacher') {
      const validSections = ['dashboard', 'subjects', 'students', 'files', 'assignments', 'attendance', 'analytics', 'chat', 'settings', 'notifications', 'reports'];
      if (validSections.includes(baseSection)) {
        setTeacherSection(baseSection as 'dashboard' | 'subjects' | 'students' | 'files' | 'assignments' | 'attendance' | 'analytics' | 'chat' | 'settings' | 'notifications' | 'reports');
        setCurrentPage('teacher-dashboard');
      }
    } else if (role === 'admin' || role === 'superadmin') {
      const validSections = ['dashboard', 'users', 'subjects', 'reports', 'announcements', 'banned', 'institution', 'chat', 'settings', 'comments', 'complaints'];
      // Special mapping: if the link is /reports/..., route to 'complaints' section (not analytics 'reports')
      const adminSection = baseSection === 'reports' ? 'complaints' : baseSection;
      if (validSections.includes(adminSection)) {
        setAdminSection(adminSection as 'dashboard' | 'users' | 'subjects' | 'reports' | 'announcements' | 'banned' | 'institution' | 'chat' | 'settings' | 'comments' | 'complaints');
        setCurrentPage('admin-dashboard');
      }
    }
  };

  /** Handle clicking a notification — mark as read and navigate if link is provided */
  const handleNotificationClick = (notif: { id: string; type: string; title?: string; read: boolean; link?: string | null; message?: string }) => {
    if (!notif.read) {
      markAsRead(notif.id);
    }

    // Handle link_request notifications - show modal instead of navigating
    if (notif.type === 'link_request' || notif.link?.startsWith('link_request:')) {
      const teacherId = notif.link?.replace('link_request:', '');
      if (teacherId) {
        setLinkRequestModal({ teacherId, notificationId: notif.id, teacher: null, loading: true });
        fetchTeacherForModal(teacherId);
      }
      return;
    }

    // Handle report notifications — navigate to the reports/complaints section
    if (notif.type === 'report' || notif.link?.startsWith('/reports')) {
      setIsOpen(false);
      const { setStudentSection, setTeacherSection, setAdminSection, setCurrentPage, setPendingReportId } = useAppStore.getState();
      
      // Extract report ID from link if available (format: "/reports/UUID")
      let reportId: string | null = null;
      if (notif.link) {
        const parts = notif.link.replace(/^\//, '').split('/');
        if (parts.length >= 2 && parts[0] === 'reports') {
          reportId = parts[1];
        }
      }
      if (reportId) {
        setPendingReportId(reportId);
      }
      
      if (user?.role === 'student') {
        setStudentSection('reports');
        setCurrentPage('student-dashboard');
      } else if (user?.role === 'teacher') {
        setTeacherSection('reports');
        setCurrentPage('teacher-dashboard');
      } else if (user?.role === 'admin' || user?.role === 'superadmin') {
        setAdminSection('complaints');  // Admin's complaints section, NOT 'reports' (which is analytics)
        setCurrentPage('admin-dashboard');
      }
      return;
    }

    // Handle file_request notifications (owner received a new file request) - navigate to own profile
    // Type can be 'file' or 'file_request' (depends on DB constraint), link format: 'file_request:REQUESTER_ID'
    if (notif.type === 'file_request' || notif.link?.startsWith('file_request:')) {
      setIsOpen(false);
      const { openProfile } = useAppStore.getState();
      if (user?.id) openProfile(user.id);
      return;
    }

    // Handle report:REPORT_ID links — navigate to the reports/complaints section
    if (notif.type === 'report' || notif.link?.startsWith('report:')) {
      setIsOpen(false);
      const { setStudentSection, setTeacherSection, setAdminSection, setCurrentPage } = useAppStore.getState();
      if (user?.role === 'admin' || user?.role === 'superadmin') {
        setAdminSection('reports');
        setCurrentPage('admin-dashboard');
      } else if (user?.role === 'teacher') {
        // Teacher doesn't have a dedicated complaints section yet,
        // so navigate to their dashboard for now
        setTeacherSection('dashboard');
        setCurrentPage('teacher-dashboard');
      } else {
        // Student — navigate to their dashboard
        setStudentSection('dashboard');
        setCurrentPage('student-dashboard');
      }
      return;
    }

    // Handle chat:CONVERSATION_ID links — navigate to the main chat section
    // This must be checked BEFORE the courseLinkPrefix logic because 'chat' is also
    // a valid CourseTab, but chat:CONVERSATION_ID means "open the main chat section",
    // not "open a course's chat tab"
    if (notif.link?.startsWith('chat:')) {
      setIsOpen(false);
      const { setStudentSection, setTeacherSection, setAdminSection, setCurrentPage } = useAppStore.getState();
      if (user?.role === 'student') {
        setStudentSection('chat');
        setCurrentPage('student-dashboard');
      } else if (user?.role === 'teacher') {
        setTeacherSection('chat');
        setCurrentPage('teacher-dashboard');
      } else if (user?.role === 'admin' || user?.role === 'superadmin') {
        setAdminSection('chat');
        setCurrentPage('admin-dashboard');
      }
      return;
    }

    // Map of link prefixes to course tabs
    // Includes BOTH singular and plural keys because the API generates
    // 3-part links like "subject:ID:assignments" (plural) while the prefix
    // is "subject" (singular). Both must resolve to the correct CourseTab.
    const linkToTab: Record<string, CourseTab> = {
      enrollment: 'students',
      subject: 'overview',
      overview: 'overview',
      assignment: 'assignments',
      assignments: 'assignments',
      lecture: 'lectures',
      lectures: 'lectures',
      note: 'notes',
      notes: 'notes',
      exam: 'exams',
      exams: 'exams',
      file: 'files',
      files: 'files',
      students: 'students',
      teams: 'teams',
      team: 'teams',
    };

    // Check if this is a course-specific link (prefix:SUBJECT_ID or prefix:SUBJECT_ID:ITEM_ID or subject:SUBJECT_ID:tab)
    const courseLinkPrefix = Object.keys(linkToTab).find(prefix => notif.link?.startsWith(prefix + ':'));
    if (courseLinkPrefix) {
      const parts = notif.link!.split(':');
      const subjectId = parts[1] || null;
      // Support 3-part links like "subject:SUBJECT_ID:assignments" where the 3rd part overrides the tab
      const explicitTab = parts[2] || null;

      // Special case: "assignment:ASSIGNMENT_ID" (2-part, no subject context)
      // should navigate to the Assignments section, NOT treat the assignment ID as a subject ID
      // But only if the assignment ID doesn't look like a subject ID (heuristic: assignment IDs
      // are typically UUIDs just like subject IDs, so we rely on the notification type).
      // If the notification type is 'assignment' and there's no 3rd part, treat as section nav.
      // However, if the notification type suggests a course context (e.g. grade, attendance),
      // treat the 2-part link as prefix:SUBJECT_ID and navigate to the course.
      if (courseLinkPrefix === 'assignment' && !explicitTab && notif.type === 'assignment') {
        setIsOpen(false);
        const { setStudentSection, setTeacherSection, setCurrentPage } = useAppStore.getState();
        if (user?.role === 'student') {
          setStudentSection('assignments');
          setCurrentPage('student-dashboard');
        } else if (user?.role === 'teacher') {
          setTeacherSection('assignments');
          setCurrentPage('teacher-dashboard');
        }
        return;
      }

      if (subjectId) {
        setIsOpen(false);
        const { setSelectedSubjectId, setCourseTab, setStudentSection, setTeacherSection, setAdminSection, setCurrentPage } = useAppStore.getState();
        setSelectedSubjectId(subjectId);

        // Determine the correct tab using a priority chain:
        // 1. Explicit tab from 3-part link (e.g. "subject:ID:notes" → 'notes')
        // 2. Notification type mapping (e.g. type='note' → 'notes')
        // 3. Link prefix mapping (e.g. prefix='lecture' → 'lectures')
        let tab: CourseTab;
        if (explicitTab && linkToTab[explicitTab]) {
          // Priority 1: explicit tab from 3-part link
          tab = linkToTab[explicitTab];
        } else if (notifTypeToTab[notif.type]) {
          // Priority 2: derive tab from notification type
          tab = notifTypeToTab[notif.type];
        } else {
          // Priority 3: fall back to link prefix mapping
          tab = linkToTab[courseLinkPrefix];
        }
        setCourseTab(tab);

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
        setIsOpen(false);
        const { openProfile } = useAppStore.getState();
        openProfile(targetUserId);
      }
      return;
    }

    // Handle legacy file request notification (link = 'settings')
    if (notif.type === 'file' && notif.link === 'settings' && notif.title?.includes(t('notifications.keywordFileRequest'))) {
      setIsOpen(false);
      const { openProfile } = useAppStore.getState();
      if (user?.id) openProfile(user.id);
      return;
    }

    // Handle grade notifications that might have a plain link without prefix
    // Navigate to the assignments section of the course if possible
    if (notif.type === 'grade' && notif.link && !notif.link.includes(':')) {
      setIsOpen(false);
      navigateToLink(notif.link);
      return;
    }

    if (notif.link && notif.link !== 'settings') {
      setIsOpen(false);
      navigateToLink(notif.link);
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
