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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { Report, ReportResponse, ReportStatus, ReportTargetType, UserProfile } from '@/lib/types';

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

// -------------------------------------------------------
// Status badge
// -------------------------------------------------------
function StatusBadge({ status }: { status: ReportStatus }) {
  const config: Record<ReportStatus, { label: string; className: string }> = {
    pending: { label: 'قيد الانتظار', className: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
    in_progress: { label: 'قيد المعالجة', className: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
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
  role: 'teacher' | 'admin' | 'superadmin';
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function ReportsSection({ profile, role }: ReportsSectionProps) {
  const { setReportsUnreadCount } = useAppStore();

  // State
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [responses, setResponses] = useState<ReportResponse[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'assigned' | 'submitted' | 'all'>(role === 'admin' || role === 'superadmin' ? 'assigned' : 'assigned');
  const [replyText, setReplyText] = useState('');
  const [forwardToId, setForwardToId] = useState('');
  const [availableForwardUsers, setAvailableForwardUsers] = useState<UserProfile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // -------------------------------------------------------
  // Fetch reports
  // -------------------------------------------------------
  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
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

      // Teachers can forward to admins; Admins can forward to superadmins
      if (role === 'teacher') {
        const res = await fetch('/api/admin/users?role=admin', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await res.json();
        if (result.success && result.data) {
          setAvailableForwardUsers(result.data.filter((u: UserProfile) => u.role === 'admin' || u.role === 'superadmin'));
        }
      } else if (role === 'admin') {
        const res = await fetch('/api/admin/users?role=superadmin', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await res.json();
        if (result.success && result.data) {
          setAvailableForwardUsers(result.data.filter((u: UserProfile) => u.role === 'superadmin'));
        }
      }
    } catch {
      // Silently fail
    }
  }, [role]);

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
          fetchReportDetail(selectedReport.id);
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
  const fetchReportDetail = async (reportId: string) => {
    setLoadingDetail(true);
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
      }
    } catch {
      toast.error('فشل تحميل تفاصيل الإبلاغ');
    } finally {
      setLoadingDetail(false);
    }
  };

  // -------------------------------------------------------
  // Handle action (reply, forward, resolve, dismiss, reopen)
  // -------------------------------------------------------
  const handleAction = async (action: 'reply' | 'forward' | 'resolve' | 'dismiss' | 'reopen') => {
    if (!selectedReport) return;
    if (action === 'reply' && !replyText.trim()) {
      toast.error('يرجى كتابة رد');
      return;
    }
    if (action === 'forward' && !forwardToId) {
      toast.error('يرجى اختيار المستخدم للتحويل');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const body: Record<string, unknown> = { action };
      if (action === 'reply') body.content = replyText.trim();
      if (action === 'forward') body.forwarded_to = forwardToId;

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
        toast.success(
          action === 'reply' ? 'تم إرسال الرد' :
          action === 'forward' ? 'تم تحويل الإبلاغ' :
          action === 'resolve' ? 'تم حل الإبلاغ' :
          action === 'dismiss' ? 'تم رفض الإبلاغ' :
          'تم إعادة فتح الإبلاغ'
        );
        setReplyText('');
        setForwardToId('');
        fetchReportDetail(selectedReport.id);
        fetchReports();
        fetchReportsCount();
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
      default: return 'text-muted-foreground';
    }
  };

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
            {role === 'admin' || role === 'superadmin' ? 'إدارة البلاغات والشكاوى' : 'البلاغات الموجهة إليك والمقدمة منك'}
          </p>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3">
        {/* View mode (admin only) */}
        {(role === 'admin' || role === 'superadmin') && (
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {[
              { id: 'assigned' as const, label: 'المعينة لي' },
              { id: 'submitted' as const, label: 'المقدمة مني' },
              { id: 'all' as const, label: 'الكل' },
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
            { id: 'in_progress' as const, label: 'قيد المعالجة' },
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
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{report.reason}</p>
                  {report.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{report.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>من: {report.reporter?.name || 'غير معروف'}</span>
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
  // Render: Report detail
  // -------------------------------------------------------
  const renderReportDetail = () => {
    if (!selectedReport) return null;
    const isActive = selectedReport.status === 'pending' || selectedReport.status === 'in_progress';
    const isAssignedToMe = selectedReport.assigned_to === profile.id;
    const isReporter = selectedReport.reporter_id === profile.id;
    const isAdmin = role === 'admin' || role === 'superadmin';

    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="space-y-4"
      >
        {/* Back button */}
        <button
          onClick={() => { setSelectedReport(null); setResponses([]); }}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4 rotate-180" />
          العودة للقائمة
        </button>

        {/* Report header */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={selectedReport.status} />
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {getTargetTypeLabel(selectedReport.target_type)}
                </span>
              </div>
              <h3 className="text-lg font-bold text-foreground">{selectedReport.reason}</h3>
            </div>
          </div>

          {selectedReport.description && (
            <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">{selectedReport.description}</p>
          )}

          {/* Reporter & Assigned info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">المُبلِغ:</span>
              {selectedReport.reporter ? (
                <div className="flex items-center gap-2">
                  <UserAvatar name={selectedReport.reporter.name} avatarUrl={selectedReport.reporter.avatar_url} size="sm" />
                  <span className="text-sm font-medium">{formatNameWithTitle(selectedReport.reporter.name, selectedReport.reporter.role, selectedReport.reporter.title_id, selectedReport.reporter.gender)}</span>
                </div>
              ) : (
                <span className="text-sm">غير معروف</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">المعين:</span>
              {selectedReport.assigned_user ? (
                <div className="flex items-center gap-2">
                  <UserAvatar name={selectedReport.assigned_user.name} avatarUrl={selectedReport.assigned_user.avatar_url} size="sm" />
                  <span className="text-sm font-medium">{formatNameWithTitle(selectedReport.assigned_user.name, selectedReport.assigned_user.role, selectedReport.assigned_user.title_id, selectedReport.assigned_user.gender)}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">غير معين</span>
              )}
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            تاريخ الإبلاغ: {formatDate(selectedReport.created_at)}
          </div>
        </div>

        {/* Responses thread */}
        {responses.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">الردود والإجراءات</h4>
            {responses.map((resp) => (
              <div
                key={resp.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    {resp.responder && <UserAvatar name={resp.responder.name} avatarUrl={resp.responder.avatar_url} size="sm" />}
                    <span className="text-sm font-medium">
                      {resp.responder ? formatNameWithTitle(resp.responder.name, resp.responder.role, resp.responder.title_id, resp.responder.gender) : 'مستخدم'}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${getActionColor(resp.action)}`}>
                      {getActionIcon(resp.action)}
                      {getActionLabel(resp.action)}
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
            ))}
          </div>
        )}

        {/* Action bar (only for active reports) */}
        {isActive && (isAssignedToMe || isAdmin) && (
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
              </div>
            </div>

            {/* Forward */}
            {availableForwardUsers.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="text-xs font-medium text-muted-foreground">تحويل الإبلاغ</label>
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
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <div className="min-h-[50vh]">
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
            {renderReportList()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
