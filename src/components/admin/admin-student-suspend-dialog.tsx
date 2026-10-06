'use client';

/**
 * AdminStudentSuspendDialog — v115 admin-side
 *
 * Modal used by an admin/superadmin to suspend or activate a student
 * globally (or per-course). Uses the admin-only endpoints:
 *   POST /api/admin/students/[id]/suspend   { scope, subjectId?, durationHours, reason }
 *   POST /api/admin/students/[id]/activate  { scope, subjectId? }
 *
 * Defaults to scope='global' (the most common admin use case).
 * Admin can also lift all active suspensions at once with scope='all'.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Ban, Power, Clock, AlertCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';

interface CurrentSuspension {
  id: string;
  scope: string;
  reason: string | null;
  subject_id: string | null;
  suspended_at: string;
  expires_at: string | null;
}

interface Props {
  open: boolean;
  studentId: string | null;
  studentName: string;
  onClose: () => void;
  onChanged?: () => void;
}

const DURATION_PRESETS: Array<{ label: string; hours: number | null }> = [
  { label: 'ساعة', hours: 1 },
  { label: 'يوم', hours: 24 },
  { label: 'أسبوع', hours: 24 * 7 },
  { label: 'شهر', hours: 24 * 30 },
  { label: 'غير محدد', hours: null },
];

export default function AdminStudentSuspendDialog({
  open, studentId, studentName, onClose, onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentGlobal, setCurrentGlobal] = useState<CurrentSuspension | null>(null);
  const [currentByCourse, setCurrentByCourse] = useState<CurrentSuspension[]>([]);
  const [durationHours, setDurationHours] = useState<number | null>(24);
  const [customHours, setCustomHours] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);
  const [reason, setReason] = useState('');

  // Fetch current suspensions
  const fetchCurrent = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('student_suspensions')
        .select('id, scope, reason, subject_id, suspended_at, expires_at, is_active, subject:subjects(id, name)')
        .eq('student_id', studentId)
        .eq('is_active', true)
        .order('suspended_at', { ascending: false });

      if (error) throw error;

      const rows = ((data ?? []) as unknown) as Array<{
        id: string; scope: string; reason: string | null;
        subject_id: string | null; suspended_at: string; expires_at: string | null;
        is_active: boolean;
        subject: { id: string; name: string } | null;
      }>;

      const isActive = (r: typeof rows[number]) =>
        r.is_active && (r.expires_at === null || r.expires_at > nowIso);

      const activeRows = rows.filter(isActive);
      const global = activeRows.find(r => r.scope === 'global') ?? null;
      const byCourse = activeRows.filter(r => r.scope === 'course');
      setCurrentGlobal(global as CurrentSuspension | null);
      setCurrentByCourse(byCourse as CurrentSuspension[]);
    } catch (err) {
      console.error('[AdminStudentSuspendDialog] fetchCurrent error:', err);
      setCurrentGlobal(null);
      setCurrentByCourse([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (open && studentId) {
      fetchCurrent();
      setDurationHours(24);
      setCustomHours('');
      setUseCustom(false);
      setReason('');
    }
  }, [open, studentId, fetchCurrent]);

  const handleSuspend = async () => {
    if (!studentId) return;
    setSubmitting(true);
    try {
      const hours = useCustom ? Number(customHours) : durationHours;
      if (useCustom && (!hours || hours <= 0 || isNaN(hours))) {
        toast.error('أدخل عدد ساعات صحيح');
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/admin/students/${studentId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          scope: 'global',
          durationHours: useCustom ? hours : durationHours,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'فشل إيقاف الطالب');
        return;
      }
      toast.success('تم إيقاف الطالب على مستوى المنصة');
      await fetchCurrent();
      onChanged?.();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLift = async (scope: 'global' | 'all') => {
    if (!studentId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/students/${studentId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ scope }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'فشل فك الإيقاف');
        return;
      }
      toast.success(scope === 'all'
        ? `تم فك ${json.lifted} إيقاف عن الطالب`
        : 'تم فك الإيقاف العام عن الطالب');
      await fetchCurrent();
      onChanged?.();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ar-EG', {
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
            إيقاف / تنشيط الطالب (مشرف)
          </DialogTitle>
          <DialogDescription>
            الطالب: <span className="font-medium">{studentName}</span>
            <br />
            <span className="text-[10px] text-muted-foreground">
              صلاحية كاملة: إيقاف على مستوى المنصة + فك الإيقاف عن أي مقرر
            </span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Current global suspension */}
            {currentGlobal && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/15 px-3 py-2 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  الطالب مُوقَف على مستوى المنصة
                </div>
                <p className="text-amber-800 dark:text-amber-200">
                  تاريخ الإيقاف: {formatDate(currentGlobal.suspended_at)}
                </p>
                {currentGlobal.expires_at && (
                  <p className="text-amber-800 dark:text-amber-200">
                    ينتهي تلقائياً: {formatDate(currentGlobal.expires_at)}
                  </p>
                )}
                {currentGlobal.reason && (
                  <p className="text-amber-800 dark:text-amber-200 mt-1">
                    السبب: {currentGlobal.reason}
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={() => handleLift('global')}
                  disabled={submitting}
                  className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Power className="h-4 w-4 me-1" />}
                  فك الإيقاف العام فقط
                </Button>
              </div>
            )}

            {/* Per-course suspensions */}
            {currentByCourse.length > 0 && (
              <div className="rounded-md border border-orange-200 bg-orange-50 dark:bg-orange-900/15 px-3 py-2 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-orange-700 dark:text-orange-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  إيقافات على مستوى المقررات ({currentByCourse.length})
                </div>
                <ul className="text-orange-800 dark:text-orange-200 list-disc ps-4">
                  {currentByCourse.slice(0, 5).map(c => (
                    <li key={c.id}>
                      {(c as { subject?: { name: string } | null }).subject?.name ?? '—'}
                      {c.expires_at && (
                        <span className="text-[10px]"> — ينتهي: {formatDate(c.expires_at)}</span>
                      )}
                    </li>
                  ))}
                  {currentByCourse.length > 5 && (
                    <li className="text-[10px]">+{currentByCourse.length - 5} أخرى</li>
                  )}
                </ul>
              </div>
            )}

            {/* Lift-all button if anything is suspended */}
            {(currentGlobal || currentByCourse.length > 0) && (
              <Button
                onClick={() => handleLift('all')}
                disabled={submitting}
                variant="outline"
                className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <ShieldCheck className="h-4 w-4 me-1" />}
                فك كل الإيقافات ({(currentGlobal ? 1 : 0) + currentByCourse.length})
              </Button>
            )}

            {/* Suspend form (only shown if no global suspension) */}
            {!currentGlobal && (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-2">
                  <Label>مدة الإيقاف</Label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {DURATION_PRESETS.map((p) => {
                      const selected = !useCustom && durationHours === p.hours;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { setUseCustom(false); setDurationHours(p.hours); }}
                          className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                            selected
                              ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                              : 'border-border hover:bg-muted'
                          }`}
                        >
                          {p.label}
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
                    مدة مخصصة (ساعات)
                  </Label>
                  {useCustom && (
                    <Input
                      type="number"
                      min={1}
                      value={customHours}
                      onChange={(e) => setCustomHours(e.target.value)}
                      placeholder="مثال: 12"
                      dir="ltr"
                    />
                  )}
                </div>

                <div className="space-y-1">
                  <Label>السبب (اختياري)</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="مثال: مخالفة لشروط الاستخدام..."
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
                  إيقاف الطالب (على مستوى المنصة)
                </Button>

                <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                  <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    سيتعذر على الطالب الدخول للمنصة طوال مدة الإيقاف. الإيقاف العام
                    يبقى منفصلاً عن أي إيقاف على مستوى المقرر قد يكون مفروضاً من المعلم.
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
