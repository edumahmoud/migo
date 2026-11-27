'use client';

/**
 * StudentSuspendDialog — v115
 *
 * Modal used by a teacher (within a course's students tab) to
 * suspend or activate a student for that specific course.
 *
 * Supports:
 *   - Showing current suspension status (fetched on open)
 *   - Duration presets: 1h, 1d, 1w, 30d, indefinite
 *   - Optional reason field
 *   - Suspend / Activate buttons
 *
 * Calls:
 *   POST /api/teacher/students/[id]/suspend   { scope: 'course', subjectId, durationHours, reason }
 *   POST /api/teacher/students/[id]/activate  { scope: 'course', subjectId }
 *
 * Only the teacher role can open this dialog (button is rendered
 * only when role='teacher' in students-tab.tsx).
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Ban, Power, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';

interface CurrentSuspension {
  id: string;
  reason: string | null;
  suspended_at: string;
  expires_at: string | null;
}

interface Props {
  open: boolean;
  studentId: string | null;
  studentName: string;
  subjectId: string;
  subjectName: string;
  onClose: () => void;
  onChanged?: () => void;
}

const DURATION_PRESETS: Array<{ labelKey: string; hours: number | null }> = [
  { labelKey: 'suspendDialog.durHour', hours: 1 },
  { labelKey: 'suspendDialog.durDay', hours: 24 },
  { labelKey: 'suspendDialog.durWeek', hours: 24 * 7 },
  { labelKey: 'suspendDialog.durMonth', hours: 24 * 30 },
  { labelKey: 'suspendDialog.durIndefinite', hours: null },
];

export default function StudentSuspendDialog({
  open, studentId, studentName, subjectId, subjectName, onClose, onChanged,
}: Props) {
  const { t, locale } = useTranslations();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [current, setCurrent] = useState<CurrentSuspension | null>(null);
  const [durationHours, setDurationHours] = useState<number | null>(24);
  const [customHours, setCustomHours] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);
  const [reason, setReason] = useState('');

  // Fetch current suspension status when dialog opens.
  const fetchCurrent = useCallback(async () => {
    if (!studentId || !subjectId) return;
    setLoading(true);
    try {
      // The student_suspensions table is exposed via RLS for teachers
      // to read for their own students. We fetch the active course
      // suspension for this (student, subject) via the same GET API
      // the student uses, but we need a teacher-scoped read.
      // For now we use direct supabase call from the client; the
      // RLS policy ss_teacher_read allows it.
      const { supabase } = await import('@/lib/supabase');
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('student_suspensions')
        .select('id, reason, suspended_at, expires_at, is_active')
        .eq('student_id', studentId)
        .eq('subject_id', subjectId)
        .eq('scope', 'course')
        .eq('is_active', true)
        .order('suspended_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      // Treat rows with expires_at in the past as inactive.
      const row = data as { is_active: boolean; expires_at: string | null } | null;
      const isActive = !!row && row.is_active &&
        (row.expires_at === null || row.expires_at > nowIso);

      setCurrent(isActive ? (row as unknown as CurrentSuspension) : null);
    } catch (err) {
      console.error('[StudentSuspendDialog] fetchCurrent error:', err);
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }, [studentId, subjectId]);

  useEffect(() => {
    if (open && studentId && subjectId) {
      fetchCurrent();
      // reset form
      setDurationHours(24);
      setCustomHours('');
      setUseCustom(false);
      setReason('');
    }
  }, [open, studentId, subjectId, fetchCurrent]);

  const handleSuspend = async () => {
    if (!studentId) return;
    setSubmitting(true);
    try {
      const hours = useCustom ? Number(customHours) : durationHours;
      if (useCustom && (!hours || hours <= 0 || isNaN(hours))) {
        toast.error(t('suspendDialog.invalidHours'));
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/teacher/students/${studentId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          scope: 'course',
          subjectId,
          durationHours: useCustom ? hours : durationHours,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('suspendDialog.suspendFailed'));
        return;
      }
      toast.success(t('suspendDialog.suspendSuccess'));
      await fetchCurrent();
      onChanged?.();
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async () => {
    if (!studentId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ scope: 'course', subjectId }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('suspendDialog.unsuspendFailed'));
        return;
      }
      toast.success(t('suspendDialog.unsuspendSuccess'));
      await fetchCurrent();
      onChanged?.();
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-amber-600" />
            {t('suspendDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('suspendDialog.studentLabel')}: <span className="font-medium">{studentName}</span>
            <br />
            {t('suspendDialog.courseLabel')}: <span className="font-medium">{subjectName}</span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
          </div>
        ) : current ? (
          // Currently suspended
          <div className="space-y-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/15 px-3 py-2 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-3.5 w-3.5" />
                {t('suspendDialog.currentlySuspended')}
              </div>
              <p className="text-amber-800 dark:text-amber-200">
                {t('suspendDialog.suspendedAt')}: {formatDate(current.suspended_at)}
              </p>
              {current.expires_at && (
                <p className="text-amber-800 dark:text-amber-200">
                  {t('suspendDialog.expiresAt')}: {formatDate(current.expires_at)}
                </p>
              )}
              {current.reason && (
                <p className="text-amber-800 dark:text-amber-200 mt-1">
                  {t('suspendDialog.reasonLabel')}: {current.reason}
                </p>
              )}
            </div>
            <Button
              onClick={handleActivate}
              disabled={submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Power className="h-4 w-4 me-1" />}
              {t('suspendDialog.unsuspendNow')}
            </Button>
          </div>
        ) : (
          // Not suspended — show suspend form
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('suspendDialog.durationLabel')}</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {DURATION_PRESETS.map((p) => {
                  const selected = !useCustom && durationHours === p.hours;
                  return (
                    <button
                      key={p.labelKey}
                      type="button"
                      onClick={() => { setUseCustom(false); setDurationHours(p.hours); }}
                      className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      {t(p.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={useCustom}
                  onChange={(e) => setUseCustom(e.target.checked)}
                  className="h-3 w-3"
                />
                {t('suspendDialog.customDuration')}
              </Label>
              {useCustom && (
                <Input
                  type="number"
                  min={1}
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  placeholder={t('suspendDialog.customHoursPlaceholder')}
                  dir="ltr"
                />
              )}
            </div>

            <div className="space-y-1">
              <Label>سبب الإيقاف (مطلوب)</Label>
              <div className="flex flex-wrap gap-1">
                {['غش في الامتحان', 'تزييف الحضور', 'مشاركة الحساب أو الجهاز', 'سلوك غير لائق', 'أخرى'].map((c) => (
                  <button key={c} type="button" onClick={() => setReason(c + ': ')} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">{c}</button>
                ))}
              </div>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('suspendDialog.reasonPlaceholder')}
                rows={2}
                maxLength={500}
              />
            </div>

            <Button
              onClick={handleSuspend}
              disabled={submitting}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Ban className="h-4 w-4 me-1" />}
              {t('suspendDialog.suspendButton')}
            </Button>

            <p className="text-[11px] text-muted-foreground flex items-start gap-1">
              <Clock className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                {t('suspendDialog.suspendNote')}
              </span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
