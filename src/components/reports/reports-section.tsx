'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert,
  Loader2,
  ChevronLeft,
  Send,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  RotateCcw,
  MessageSquare,
  AlertTriangle,
  Flag,
  Mail,
  User,
  BarChart3,
  Trash2,
  Ban,
  Bell,
  ChevronDown,
  ChevronUp,
  Users,
  Eye,
  FileText,
  Inbox,
  Calendar,
  Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { Report, ReportResponse, ReportMessage, ReportStatus, ReportTargetType, ReportResponseAction, UserProfile } from '@/lib/types';

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Report reason options
// -------------------------------------------------------
const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'inappropriate', label: 'محتوى غير مناسب' },
  { value: 'harassment', label: 'تحرش أو تنمر' },
  { value: 'spam', label: 'رسائل مزعجة' },
  { value: 'misinformation', label: 'معلومات مضللة' },
  { value: 'cheating', label: 'غش أكاديمي' },
  { value: 'other', label: 'سبب آخر' },
];

/** Map an English reason value to its Arabic label */
function getReasonLabel(value: string): string {
  return REPORT_REASONS.find((r) => r.value === value)?.label || value;
}

// -------------------------------------------------------
// Status badge
// -------------------------------------------------------
function StatusBadge({ status }: { status: ReportStatus }) {
  const config: Record<ReportStatus, { label: string; className: string }> = {
    pending: { label: 'قيد الانتظار', className: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
    in_progress: { label: 'جاري المعالجة', className: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
    resolved: { label: 'تم الحل', className: 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' },
    dismissed: { label: 'مرفوض', className: 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700' },
  };
  const c = config[status] || config.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>
      {status === 'pending' && <AlertTriangle className="h-3 w-3" />}
      {status === 'in_progress' && <Loader2 className="h-3 w-3" />}
      {status === 'resolved' && <CheckCircle2 className="h-3 w-3" />}
      {status === 'dismissed' && <XCircle className="h-3 w-3" />}
      {c.label}
    </span>
  );
}

// -------------------------------------------------------
// Target type label
// -------------------------------------------------------
function getTargetTypeLabel(type: ReportTargetType): string {
  switch (type) {
    case 'comment': return 'تعليق';
    case 'message': return 'رسالة';
    case 'user': return 'مستخدم';
    case 'other': return 'أخرى';
    default: return type;
  }
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface ReportsSectionProps {
  profile: UserProfile;
  role: 'student' | 'teacher' | 'admin' | 'superadmin';
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function ReportsSection({ profile, role }: ReportsSectionProps) {
  const { setReportsUnreadCount, openProfile } = useAppStore();

  // State
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [responses, setResponses] = useState<ReportResponse[]>([]);
  const [messages, setMessages] = useState<ReportMessage[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | 'all' | 'forwarded'>('all');
  const [viewMode, setViewMode] = useState<'assigned' | 'submitted' | 'all'>(role === 'admin' || role === 'superadmin' ? 'all' : 'submitted');
  const [replyText, setReplyText] = useState('');
  const [forwardToId, setForwardToId] = useState('');
  const [availableForwardUsers, setAvailableForwardUsers] = useState<UserProfile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showActionsLog, setShowActionsLog] = useState(true);
  const [messageToReporter, setMessageToReporter] = useState('');
  const [messageToReported, setMessageToReported] = useState('');
  const [showMessageReporter, setShowMessageReporter] = useState(false);
  const [showMessageReported, setShowMessageReported] = useState(false);
  const [activeTab, setActiveTab] = useState<'reports' | 'inbox'>('reports');
  const [inboxMessages, setInboxMessages] = useState<any[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [banDuration, setBanDuration] = useState<'permanent' | '1day' | '1week' | '1month' | 'custom'>('permanent');
  const [banCustomDate, setBanCustomDate] = useState('');
  const [banReason, setBanReason] = useState('');

  // -------------------------------------------------------
  // Fetch reports
  // -------------------------------------------------------
  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const params = new URLSearchParams();
      if (statusFilter === 'forwarded') {
        params.set('status', 'in_progress');
      } else if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (role === 'admin' || role === 'superadmin') params.set('view', viewMode);

      const res = await fetch(`/api/reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success) {
        setReports(result.data || []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [statusFilter, viewMode, role]);

  // -------------------------------------------------------
  // Fetch reports count (for badge)
  // -------------------------------------------------------
  const fetchReportsCount = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/reports/count', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        setReportsUnreadCount(result.data.count);
      }
    } catch {
      // Silently fail
    }
  }, [setReportsUnreadCount]);

  // -------------------------------------------------------
  // Fetch available forward targets
  // -------------------------------------------------------
  const fetchForwardTargets = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      if (role === 'teacher') {
        // Strategy 1: Try the dedicated API endpoint first
        try {
          const res = await fetch(`/api/teacher-supervisor?teacher_id=${profile.id}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const result = await res.json();
          if (result.success && result.data && result.data.length > 0) {
            const supervisors = result.data
              .map((link: any) => link.supervisor)
              .filter((u: any) => u && (u.role === 'admin' || u.role === 'superadmin'));
            if (supervisors.length > 0) {
              setAvailableForwardUsers(supervisors);
              return;
            }
          }
        } catch { /* API may fail, try direct query */ }

        // Strategy 2: Direct Supabase query for linked supervisors
        const { data: links } = await supabase
          .from('teacher_supervisor_links')
          .select('supervisor_id')
          .eq('teacher_id', profile.id);

        const supervisorIds = (links || []).map((l: any) => l.supervisor_id);

        if (supervisorIds.length > 0) {
          const { data: supervisors } = await supabase
            .from('users')
            .select('id, name, email, avatar_url, role, gender, title_id, created_at, updated_at')
            .in('id', supervisorIds);
          if (supervisors && supervisors.length > 0) {
            setAvailableForwardUsers(supervisors.filter((u: any) => u.role === 'admin' || u.role === 'superadmin') as unknown as UserProfile[]);
            return;
          }
        }

        // Strategy 3: Fallback — fetch all admins directly from users table
        const { data: admins } = await supabase
          .from('users')
          .select('id, name, email, avatar_url, role, gender, title_id, created_at, updated_at')
          .in('role', ['admin', 'superadmin'])
          .limit(20);
        if (admins && admins.length > 0) {
          setAvailableForwardUsers(admins as unknown as UserProfile[]);
          return;
        }
      } else if (role === 'admin') {
        const { data: superadmins } = await supabase
          .from('users')
          .select('id, name, email, avatar_url, role, gender, title_id, created_at, updated_at')
          .eq('role', 'superadmin')
          .limit(10);
        if (superadmins && superadmins.length > 0) {
          setAvailableForwardUsers(superadmins as unknown as UserProfile[]);
          return;
        }
      }
    } catch {
      // Silently fail
    }
  }, [role, profile.id]);

  useEffect(() => {
    fetchReports();
    fetchReportsCount();
    fetchForwardTargets();
  }, [fetchReports, fetchReportsCount, fetchForwardTargets]);

  // -------------------------------------------------------
  // Realtime subscription for reports
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel('reports-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => {
        fetchReports();
        fetchReportsCount();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_responses' }, () => {
        if (selectedReport) {
          fetchReportDetail(selectedReport.id, false);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_messages' }, () => {
        if (selectedReport) {
          fetchReportDetail(selectedReport.id, false);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchReports, fetchReportsCount, selectedReport]);

  // -------------------------------------------------------
  // Fetch report detail
  // -------------------------------------------------------
  const fetchReportDetail = async (reportId: string, showLoading = true) => {
    if (showLoading) setLoadingDetail(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/reports/${reportId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        setSelectedReport(result.data);
        setResponses(result.data.responses || []);
        setMessages(result.data.messages || []);
      }
    } catch {
      toast.error('فشل تحميل تفاصيل الإبلاغ');
    } finally {
      if (showLoading) setLoadingDetail(false);
    }
  };

  // -------------------------------------------------------
  // Fetch inbox messages (messages where current user is recipient)
  // -------------------------------------------------------
  const fetchInboxMessages = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('report_messages')
        .select(`
          *,
          sender:users!report_messages_sender_id_fkey(id, name, email, avatar_url, role, gender, title_id)
        `)
        .eq('recipient_id', profile.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setInboxMessages(data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingInbox(false);
    }
  }, [profile.id]);

  useEffect(() => {
    if (activeTab === 'inbox') {
      fetchInboxMessages();
    }
  }, [activeTab, fetchInboxMessages]);

  // -------------------------------------------------------
  // Clear completed reports (resolved/dismissed)
  // -------------------------------------------------------
  const handleClearCompleted = async () => {
    setClearing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/reports?mode=all', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success) {
        toast.success('تم مسح الإبلاغات المكتملة');
        setShowClearConfirm(false);
        fetchReports();
        fetchReportsCount();
      } else {
        toast.error(result.error || 'فشل مسح الإبلاغات');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setClearing(false);
    }
  };

  // -------------------------------------------------------
  // Delete a single completed report
  // -------------------------------------------------------
  const handleDeleteReport = async (reportId: string) => {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/reports?id=${reportId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success) {
        toast.success('تم حذف الإبلاغ');
        setSelectedReport(null);
        setResponses([]);
        setMessages([]);
        fetchReports();
        fetchReportsCount();
      } else {
        toast.error(result.error || 'فشل حذف الإبلاغ');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Handle action (reply, forward, resolve, dismiss, reopen, block, warn, message_reporter, message_reported)
  // -------------------------------------------------------
  const handleAction = async (action: ReportResponseAction) => {
    if (!selectedReport) return;
    if (action === 'reply' && !replyText.trim()) {
      toast.error('يرجى كتابة رد');
      return;
    }
    if (action === 'forward' && !forwardToId) {
      toast.error('يرجى اختيار المستخدم للتحويل');
      return;
    }
    if (action === 'message_reporter' && !messageToReporter.trim()) {
      toast.error('يرجى كتابة رسالة للمُبلِغ');
      return;
    }
    if (action === 'message_reported' && !messageToReported.trim()) {
      toast.error('يرجى كتابة رسالة للمُبلَّغ عنه');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const body: Record<string, unknown> = { action };
      if (action === 'reply') body.content = replyText.trim();
      if (action === 'forward') body.forwarded_to = forwardToId;
      if (action === 'warn') body.content = 'تحذير';
      if (action === 'block') body.content = 'حظر المستخدم';
      if (action === 'message_reporter') body.message_content = messageToReporter.trim();
      if (action === 'message_reported') body.message_content = messageToReported.trim();

      const res = await fetch(`/api/reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      if (result.success) {
        const actionLabels: Record<string, string> = {
          reply: 'تم إرسال الرد',
          forward: 'تم تحويل الإبلاغ',
          resolve: 'تم حل الإبلاغ',
          dismiss: 'تم رفض الإبلاغ',
          reopen: 'تم إعادة فتح الإبلاغ',
          block: 'تم حظر المستخدم',
          warn: 'تم تحذير المستخدم',
          message_reporter: 'تم إرسال الرسالة للمُبلِغ',
          message_reported: 'تم إرسال الرسالة للمُبلَّغ عنه',
        };
        toast.success(actionLabels[action] || 'تم تنفيذ الإجراء');
        setReplyText('');
        setForwardToId('');
        setMessageToReporter('');
        setMessageToReported('');
        setShowMessageReporter(false);
        setShowMessageReported(false);
        // For message actions, update detail silently without spinner
        const isMessageAction = action === 'message_reporter' || action === 'message_reported';
        fetchReportDetail(selectedReport.id, !isMessageAction);
        // Only refresh list/count for non-message actions (messages don't change list or count)
        if (!isMessageAction) {
          fetchReports();
          fetchReportsCount();
        }
      } else {
        toast.error(result.error || 'فشل تنفيذ الإجراء');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Format date
  // -------------------------------------------------------
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  // -------------------------------------------------------
  // Action icon
  // -------------------------------------------------------
  const getActionIcon = (action: string) => {
    switch (action) {
      case 'reply': return <MessageSquare className="h-3.5 w-3.5" />;
      case 'forward': return <ArrowRightLeft className="h-3.5 w-3.5" />;
      case 'resolve': return <CheckCircle2 className="h-3.5 w-3.5" />;
      case 'dismiss': return <XCircle className="h-3.5 w-3.5" />;
      case 'reopen': return <RotateCcw className="h-3.5 w-3.5" />;
      case 'block': return <Ban className="h-3.5 w-3.5" />;
      case 'warn': return <AlertTriangle className="h-3.5 w-3.5" />;
      default: return null;
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'reply': return 'رد';
      case 'forward': return 'تحويل';
      case 'resolve': return 'حل';
      case 'dismiss': return 'رفض';
      case 'reopen': return 'إعادة فتح';
      case 'block': return 'حظر';
      case 'warn': return 'تحذير';
      default: return action;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'reply': return 'text-sky-600 dark:text-sky-400';
      case 'forward': return 'text-amber-600 dark:text-amber-400';
      case 'resolve': return 'text-teal-600 dark:text-teal-400';
      case 'dismiss': return 'text-gray-600 dark:text-gray-400';
      case 'reopen': return 'text-rose-600 dark:text-rose-400';
      case 'block': return 'text-red-600 dark:text-red-400';
      case 'warn': return 'text-orange-600 dark:text-orange-400';
      default: return 'text-muted-foreground';
    }
  };

  // -------------------------------------------------------
  // UserLink helper — clickable user name that opens profile
  // -------------------------------------------------------
  const UserLink = ({ userId, name }: { userId: string; name: string }) => (
    <button
      onClick={(e) => { e.stopPropagation(); openProfile(userId); }}
      className="text-sm font-medium text-sky-700 dark:text-sky-300 hover:underline"
    >
      {name}
    </button>
  );

  // -------------------------------------------------------
  // Render: Report list
  // -------------------------------------------------------
  const renderReportList = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">الإبلاغات</h2>
          <p className="text-muted-foreground mt-1">
            {role === 'student' ? 'إبلاغاتك المقدمة وحالتها' : role === 'admin' || role === 'superadmin' ? 'إدارة البلاغات والشكاوى' : 'البلاغات الموجهة إليك والمقدمة منك'}
          </p>
        </div>
      </motion.div>

      {/* Clear completed button + info */}
      {reports.some(r => r.status === 'resolved' || r.status === 'dismissed') && (
        <motion.div variants={itemVariants} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            يتم حذف الإبلاغات المكتملة تلقائياً بعد 10 أيام
          </p>
          <div className="flex items-center gap-2">
            {!showClearConfirm ? (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                مسح المكتملة
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">حذف كل الإبلاغات المكتملة؟</span>
                <button
                  onClick={handleClearCompleted}
                  disabled={clearing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
                >
                  {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  تأكيد
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  disabled={clearing}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  إلغاء
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Filters */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3">
        {/* View mode (admin only) */}
        {(role === 'admin' || role === 'superadmin') && (
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {[
              { id: 'all' as const, label: 'جميع الإبلاغات' },
              { id: 'assigned' as const, label: 'المعينة لي' },
              { id: 'submitted' as const, label: 'المقدمة مني' },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === mode.id
                    ? 'bg-sky-700 text-white'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        )}

        {/* Status filter */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {[
            { id: 'all' as const, label: 'الكل' },
            { id: 'pending' as const, label: 'قيد الانتظار' },
            { id: 'in_progress' as const, label: 'جاري المعالجة' },
            { id: 'forwarded' as const, label: 'محوّلة' },
            { id: 'resolved' as const, label: 'تم الحل' },
            { id: 'dismissed' as const, label: 'مرفوض' },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === s.id
                  ? 'bg-sky-700 text-white'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Reports list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : reports.length === 0 ? (
        <motion.div variants={itemVariants} className="text-center py-16">
          <ShieldAlert className="h-16 w-16 mx-auto text-muted-foreground/30" />
          <p className="mt-4 text-muted-foreground">لا توجد إبلاغات</p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <motion.button
              key={report.id}
              variants={itemVariants}
              onClick={() => fetchReportDetail(report.id)}
              className={`w-full text-start rounded-xl border p-4 transition-all hover:shadow-md ${
                selectedReport?.id === report.id
                  ? 'border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20'
                  : 'border-border bg-card hover:border-sky-200 dark:hover:border-sky-800'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusBadge status={report.status} />
                    <span className="text-xs text-muted-foreground">{getTargetTypeLabel(report.target_type)}</span>
                    {(report as any).reporter_count > 1 && role !== 'student' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400">
                        <Users className="h-3 w-3" />
                        {(report as any).reporter_count} مُبلِغ
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{getReasonLabel(report.reason)}</p>
                  {report.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{report.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>من: {report.reporter ? <UserLink userId={report.reporter.id} name={report.reporter.name || 'غير معروف'} /> : 'غير معروف'}</span>
                    {(report as any).target_user && (
                      <span>المُبلَّغ عنه: <UserLink userId={(report as any).target_user.id} name={(report as any).target_user.name} /></span>
                    )}
                    {report.assigned_user && (
                      <span>إلى: {report.assigned_user.name}</span>
                    )}
                    <span>{formatDate(report.created_at)}</span>
                  </div>
                </div>
                <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Target User Info Card
  // -------------------------------------------------------
  const renderTargetUserInfo = () => {
    const report = selectedReport;
    if (!report || !(report as any).target_user) return null;

    const tu = (report as any).target_user;
    const reporterCount = (report as any).reporter_count || 1;

    return (
      <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Flag className="h-4 w-4 text-rose-500" />
          <h4 className="text-sm font-semibold text-foreground">المستخدم المُبلَّغ عنه</h4>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <UserAvatar name={tu.name} avatarUrl={tu.avatar_url} size="md" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              <UserLink userId={tu.id} name={formatNameWithTitle(tu.name, tu.role, tu.title_id, tu.gender)} />
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              <Mail className="h-3 w-3" />
              <span>{tu.email}</span>
            </div>
          </div>
        </div>
        {role !== 'student' ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-background/80 p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-rose-600 dark:text-rose-400">
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="text-lg font-bold">{tu.report_count ?? 0}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">إجمالي البلاغات</p>
            </div>
            <div className="rounded-lg bg-background/80 p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-amber-600 dark:text-amber-400">
                <Users className="h-3.5 w-3.5" />
                <span className="text-lg font-bold">{reporterCount}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">عدد المُبلِغين</p>
            </div>
            <div className="rounded-lg bg-background/80 p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">{tu.role === 'student' ? 'طالب' : tu.role === 'teacher' ? 'معلم' : tu.role === 'admin' ? 'مشرف' : 'مدير'}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">الدور</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-lg bg-background/80 p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">{tu.role === 'student' ? 'طالب' : tu.role === 'teacher' ? 'معلم' : tu.role === 'admin' ? 'مشرف' : 'مدير'}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">الدور</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Target Content (reported comment/message)
  // -------------------------------------------------------
  const renderTargetContent = () => {
    const report = selectedReport;
    if (!report || !report.target_content) return null;

    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-4 w-4 text-amber-500" />
          <h4 className="text-sm font-semibold text-foreground">
            المحتوى المُبلَّغ عنه ({getTargetTypeLabel(report.target_type)})
          </h4>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap bg-background/60 dark:bg-background/40 rounded-lg p-3 border border-border">
          {report.target_content}
        </p>
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Actions log (collapsible)
  // -------------------------------------------------------
  const renderActionsLog = () => {
    const report = selectedReport;
    if (!report) return null;

    // Combine responses and messages into a unified timeline
    const allActions = [
      ...responses.map(r => ({
        type: 'response' as const,
        date: r.created_at,
        data: r,
      })),
      ...messages.map(m => ({
        type: 'message' as const,
        date: m.created_at,
        data: m,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Filter actions for students: only show forward, block, warn, and messages
    const filteredActions = role === 'student'
      ? allActions.filter(item => {
          if (item.type === 'message') return true;
          const resp = item.data as ReportResponse;
          return ['forward', 'block', 'warn'].includes(resp.action);
        })
      : allActions;

    if (filteredActions.length === 0) return null;

    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <button
          onClick={() => setShowActionsLog(!showActionsLog)}
          className="flex items-center justify-between w-full text-start"
        >
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">الإجراءات والخطوات المتخذة</h4>
            <span className="text-xs text-muted-foreground">({filteredActions.length})</span>
          </div>
          {showActionsLog ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        <AnimatePresence>
          {showActionsLog && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 mt-4">
                {filteredActions.map((item, idx) => {
                  if (item.type === 'response') {
                    const resp = item.data as ReportResponse;
                    // Student-facing labels for specific actions
                    const studentActionLabel = role === 'student'
                      ? (resp.action === 'forward' ? 'تم التحويل للمشرف/المدير'
                        : resp.action === 'block' ? 'تم حظر المستخدم'
                        : resp.action === 'warn' ? 'تم تحذير المستخدم'
                        : getActionLabel(resp.action))
                      : getActionLabel(resp.action);
                    return (
                      <div
                        key={resp.id}
                        className="rounded-lg border border-border bg-background p-4"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            {resp.responder && <UserAvatar name={resp.responder.name} avatarUrl={resp.responder.avatar_url} size="sm" />}
                            <span className="text-sm font-medium">
                              {resp.responder ? <UserLink userId={resp.responder.id} name={formatNameWithTitle(resp.responder.name, resp.responder.role, resp.responder.title_id, resp.responder.gender)} /> : 'مستخدم'}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${getActionColor(resp.action)}`}>
                              {getActionIcon(resp.action)}
                              {studentActionLabel}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDate(resp.created_at)}</span>
                        </div>
                        {resp.content && (
                          <p className="text-sm text-foreground whitespace-pre-wrap mt-1 ms-10">{resp.content}</p>
                        )}
                        {resp.forwarded_to_user && (
                          <div className="flex items-center gap-2 mt-2 ms-10 text-xs text-amber-600 dark:text-amber-400">
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                            <span>حوّل إلى: {formatNameWithTitle(resp.forwarded_to_user.name, resp.forwarded_to_user.role, resp.forwarded_to_user.title_id, resp.forwarded_to_user.gender)}</span>
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    const msg = item.data as ReportMessage;
                    return (
                      <div
                        key={msg.id}
                        className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-900/10 p-4"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            {msg.sender && <UserAvatar name={msg.sender.name} avatarUrl={msg.sender.avatar_url} size="sm" />}
                            <span className="text-sm font-medium">
                              {msg.sender ? <UserLink userId={msg.sender.id} name={formatNameWithTitle(msg.sender.name, msg.sender.role, msg.sender.title_id, msg.sender.gender)} /> : 'مستخدم'}
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400">
                              <Mail className="h-3.5 w-3.5" />
                              {msg.recipient_type === 'reporter' ? 'رسالة للمُبلِغ' : 'رسالة للمُبلَّغ عنه'}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDate(msg.created_at)}</span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap mt-1 ms-10">{msg.content}</p>
                      </div>
                    );
                  }
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Report detail
  // -------------------------------------------------------
  const renderReportDetail = () => {
    if (!selectedReport) return null;
    const isActive = selectedReport.status === 'pending' || selectedReport.status === 'in_progress';
    const isAssignedToMe = selectedReport.assigned_to === profile.id;
    const isReporter = selectedReport.reporter_id === profile.id;
    const isAdmin = role === 'admin' || role === 'superadmin';
    const isTeacherOrAbove = role === 'teacher' || role === 'admin' || role === 'superadmin';
    const canTakeAction = isActive && (isAssignedToMe || isAdmin);

    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="space-y-4"
      >
        {/* Back button */}
        <button
          onClick={() => { setSelectedReport(null); setResponses([]); setMessages([]); }}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4 rotate-180" />
          العودة للقائمة
        </button>

        {/* Report header — compact design */}
        <div className="rounded-xl border border-border bg-card p-3">
          {/* Row 1: Status + Type + Reason + Reporter count */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={selectedReport.status} />
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {getTargetTypeLabel(selectedReport.target_type)}
            </span>
            <span className="text-sm font-bold text-foreground">{getReasonLabel(selectedReport.reason)}</span>
            {role !== 'student' && (selectedReport as any).reporter_count > 1 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400">
                <Users className="h-3 w-3" />
                {(selectedReport as any).reporter_count} مُبلِغ
              </span>
            )}
          </div>
          {/* Row 2: Reporter email + Assigned + Date - all inline */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
            {selectedReport.reporter ? (
              <div className="flex items-center gap-1.5">
                <UserAvatar name={selectedReport.reporter.name} avatarUrl={selectedReport.reporter.avatar_url} size="sm" />
                <UserLink userId={selectedReport.reporter.id} name={formatNameWithTitle(selectedReport.reporter.name, selectedReport.reporter.role, selectedReport.reporter.title_id, selectedReport.reporter.gender)} />
                {selectedReport.reporter?.email && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Mail className="h-2.5 w-2.5" />
                    <span>{selectedReport.reporter.email}</span>
                  </div>
                )}
              </div>
            ) : (
              <span>المُبلِغ: غير معروف</span>
            )}
            <span className="text-border">|</span>
            {selectedReport.assigned_user ? (
              <div className="flex items-center gap-1.5">
                <UserAvatar name={selectedReport.assigned_user.name} avatarUrl={selectedReport.assigned_user.avatar_url} size="sm" />
                <UserLink userId={selectedReport.assigned_user.id} name={formatNameWithTitle(selectedReport.assigned_user.name, selectedReport.assigned_user.role, selectedReport.assigned_user.title_id, selectedReport.assigned_user.gender)} />
              </div>
            ) : (
              <span>غير معين</span>
            )}
            <span className="text-border">|</span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(selectedReport.created_at)}
            </span>
          </div>
          {selectedReport.description && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2 whitespace-pre-wrap">{selectedReport.description}</p>
          )}
        </div>

        {/* Target User Info */}
        {renderTargetUserInfo()}

        {/* Target Content (reported comment/message) */}
        {renderTargetContent()}

        {/* Actions Log (collapsible) */}
        {renderActionsLog()}

        {/* ─── Action Buttons ─── */}
        {canTakeAction && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h4 className="text-sm font-semibold text-foreground">إجراء</h4>

            {/* Reply */}
            <div className="space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="اكتب ردك هنا..."
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleAction('reply')}
                  disabled={submitting || !replyText.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 disabled:opacity-50 transition-colors"
                >
                  <Send className="h-4 w-4" />
                  رد
                </button>
                <button
                  onClick={() => handleAction('resolve')}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  حل
                </button>
                <button
                  onClick={() => handleAction('dismiss')}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-500 text-white text-sm font-medium hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  <XCircle className="h-4 w-4" />
                  رفض
                </button>

                {/* Warn button — visible for teacher, admin, superadmin */}
                {isTeacherOrAbove && (
                  <button
                    onClick={() => handleAction('warn')}
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    تحذير
                  </button>
                )}

                {/* Block button — visible for admin, superadmin only — opens ban modal */}
                {isAdmin && (
                  <button
                    onClick={() => setBanModalOpen(true)}
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 disabled:opacity-50 transition-colors"
                  >
                    <Ban className="h-4 w-4" />
                    حظر المستخدم
                  </button>
                )}
              </div>
            </div>

            {/* Forward */}
            {availableForwardUsers.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="text-xs font-medium text-muted-foreground">
                  تحويل الإبلاغ {role === 'teacher' ? 'للمشرف' : role === 'admin' ? 'لمدير المنصة' : ''}
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={forwardToId}
                    onChange={(e) => setForwardToId(e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">اختر المستخدم...</option>
                    {availableForwardUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role === 'admin' ? 'مشرف' : u.role === 'superadmin' ? 'مدير' : u.role})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleAction('forward')}
                    disabled={submitting || !forwardToId}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                    تحويل
                  </button>
                </div>
              </div>
            )}

            {/* Send message to reporter */}
            <div className="space-y-2 pt-2 border-t border-border">
              <button
                onClick={() => { setShowMessageReporter(!showMessageReporter); setShowMessageReported(false); }}
                className="flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-300 hover:underline"
              >
                <Mail className="h-4 w-4" />
                إرسال رسالة للمُبلِغ
              </button>
              <AnimatePresence>
                {showMessageReporter && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 pt-2">
                      <textarea
                        value={messageToReporter}
                        onChange={(e) => setMessageToReporter(e.target.value)}
                        placeholder="اكتب رسالتك للمُبلِغ هنا..."
                        rows={3}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <button
                        onClick={() => handleAction('message_reporter')}
                        disabled={submitting || !messageToReporter.trim()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 disabled:opacity-50 transition-colors"
                      >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        إرسال للمُبلِغ
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Send message to reported user */}
            <div className="space-y-2 pt-2 border-t border-border">
              <button
                onClick={() => { setShowMessageReported(!showMessageReported); setShowMessageReporter(false); }}
                className="flex items-center gap-2 text-sm font-medium text-rose-700 dark:text-rose-300 hover:underline"
              >
                <Bell className="h-4 w-4" />
                إرسال رسالة للمُبلَّغ عنه
              </button>
              <AnimatePresence>
                {showMessageReported && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 pt-2">
                      {/* Auto-generated context info */}
                      <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground space-y-1">
                        <p>سيتم إرسال الرسالة مع بيانات البلاغ التالية:</p>
                        <p>• نوع البلاغ: {getReasonLabel(selectedReport.reason)}</p>
                        <p>• نوع المحتوى: {getTargetTypeLabel(selectedReport.target_type)}</p>
                        {selectedReport.target_content && (
                          <p>• المحتوى المُبلَّغ عنه: {selectedReport.target_content.substring(0, 80)}...</p>
                        )}
                        <p>• تاريخ البلاغ: {formatDate(selectedReport.created_at)}</p>
                        <p>• الإجراءات المتخذة: {responses.filter(r => ['block', 'warn', 'resolve'].includes(r.action)).map(r => getActionLabel(r.action)).join('، ') || 'لا يوجد'}</p>
                      </div>
                      <textarea
                        value={messageToReported}
                        onChange={(e) => setMessageToReported(e.target.value)}
                        placeholder="اكتب رسالتك للمُبلَّغ عنه هنا..."
                        rows={3}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <button
                        onClick={() => handleAction('message_reported')}
                        disabled={submitting || !messageToReported.trim()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-700 text-white text-sm font-medium hover:bg-rose-800 disabled:opacity-50 transition-colors"
                      >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        إرسال للمُبلَّغ عنه
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Reporter can reopen */}
        {selectedReport.status === 'resolved' && isReporter && (
          <button
            onClick={() => handleAction('reopen')}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            إعادة فتح الإبلاغ
          </button>
        )}

        {/* Delete button for completed reports (resolved/dismissed) */}
        {(selectedReport.status === 'resolved' || selectedReport.status === 'dismissed') && (isReporter || isAssignedToMe || isAdmin) && (
          <div className="pt-2 border-t border-border">
            <button
              onClick={() => handleDeleteReport(selectedReport.id)}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-rose-600 border border-rose-200 dark:border-rose-800 text-sm font-medium hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50 transition-colors"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف الإبلاغ
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Handle ban confirm
  // -------------------------------------------------------
  const handleBanConfirm = async () => {
    if (!selectedReport) return;
    const targetUser = (selectedReport as any).target_user;
    if (!targetUser) {
      toast.error('لم يتم العثور على المستخدم المُبلَّغ عنه');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Calculate ban_until date
      let banUntil: string | null = null;
      if (banDuration === '1day') {
        banUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      } else if (banDuration === '1week') {
        banUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (banDuration === '1month') {
        banUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      } else if (banDuration === 'custom' && banCustomDate) {
        banUntil = new Date(banCustomDate).toISOString();
      }
      // permanent = null banUntil

      // Call ban-user API
      const banRes = await fetch('/api/admin/ban-user', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: targetUser.id,
          reason: banReason || 'حظر بسبب إبلاغ',
          banUntil,
          bannedBy: profile.id,
        }),
      });
      const banResult = await banRes.json();

      if (banResult.success) {
        // Also record the block action in the report
        await handleAction('block');
        setBanModalOpen(false);
        setBanDuration('permanent');
        setBanCustomDate('');
        setBanReason('');
      } else {
        toast.error(banResult.error || 'فشل حظر المستخدم');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع أثناء الحظر');
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Render: Inbox tab
  // -------------------------------------------------------
  const renderInbox = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
      <motion.div variants={itemVariants}>
        <h2 className="text-2xl font-bold text-foreground">الرسائل الواردة</h2>
        <p className="text-muted-foreground mt-1">الرسائل المتعلقة بالبلاغات المرسلة إليك</p>
      </motion.div>

      {loadingInbox ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : inboxMessages.length === 0 ? (
        <motion.div variants={itemVariants} className="text-center py-16">
          <Inbox className="h-16 w-16 mx-auto text-muted-foreground/30" />
          <p className="mt-4 text-muted-foreground">لا توجد رسائل واردة</p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {inboxMessages.map((msg: any) => (
            <motion.div
              key={msg.id}
              variants={itemVariants}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-3 mb-2">
                {msg.sender && <UserAvatar name={msg.sender.name} avatarUrl={msg.sender.avatar_url} size="sm" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {msg.sender ? (
                        <UserLink userId={msg.sender.id} name={formatNameWithTitle(msg.sender.name, msg.sender.role, msg.sender.title_id, msg.sender.gender)} />
                      ) : 'مستخدم'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {msg.recipient_type === 'reporter' ? '• بخصوص بلاغك' : '• بخصوص بلاغ ضدك'}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(msg.created_at)}</span>
                </div>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-1">{msg.content}</p>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Ban Modal
  // -------------------------------------------------------
  const renderBanModal = () => {
    if (!banModalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBanModalOpen(false)}>
        <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <Ban className="h-6 w-6 text-red-600" />
            <h3 className="text-lg font-bold text-foreground">حظر المستخدم</h3>
          </div>

          {/* Duration selector */}
          <div className="space-y-3 mb-4">
            <label className="text-sm font-medium text-foreground">مدة الحظر</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'permanent' as const, label: 'دائم' },
                { id: '1day' as const, label: 'يوم واحد' },
                { id: '1week' as const, label: 'أسبوع' },
                { id: '1month' as const, label: 'شهر' },
              ].map((d) => (
                <button
                  key={d.id}
                  onClick={() => setBanDuration(d.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    banDuration === d.id
                      ? 'border-red-300 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {banDuration === 'custom' && (
              <input
                type="datetime-local"
                value={banCustomDate}
                onChange={(e) => setBanCustomDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            )}
            <button
              onClick={() => setBanDuration('custom')}
              className={`text-xs font-medium hover:underline ${banDuration === 'custom' ? 'text-red-600' : 'text-muted-foreground'}`}
            >
              تاريخ مخصص
            </button>
          </div>

          {/* Reason */}
          <div className="space-y-2 mb-6">
            <label className="text-sm font-medium text-foreground">سبب الحظر</label>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="أدخل سبب الحظر (اختياري)..."
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 justify-end">
            <button
              onClick={() => { setBanModalOpen(false); setBanDuration('permanent'); setBanCustomDate(''); setBanReason(''); }}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              إلغاء
            </button>
            <button
              onClick={handleBanConfirm}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 disabled:opacity-50 transition-colors"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              تأكيد الحظر
            </button>
          </div>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <div className="min-h-[50vh]">
      {/* Ban Modal */}
      {renderBanModal()}

      <AnimatePresence mode="wait">
        {selectedReport ? (
          <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {loadingDetail ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
              </div>
            ) : (
              renderReportDetail()
            )}
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Tab bar */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 mb-4">
              <button
                onClick={() => setActiveTab('reports')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'reports'
                    ? 'bg-sky-700 text-white'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <ShieldAlert className="h-4 w-4 inline-block ml-1.5" />
                الإبلاغات
              </button>
              <button
                onClick={() => setActiveTab('inbox')}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'inbox'
                    ? 'bg-sky-700 text-white'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Inbox className="h-4 w-4 inline-block ml-1.5" />
                الرسائل الواردة
              </button>
            </div>

            {activeTab === 'reports' ? renderReportList() : renderInbox()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
