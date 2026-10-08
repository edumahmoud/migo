'use client';

/**
 * AgentStudentSuspendDialog
 *
 * Modal used by a registration_agent to suspend or activate a student
 * in one of their teacher's courses. Uses the agent-scoped endpoints:
 *   POST /api/agent/students/[id]/suspend   { subjectId, durationHours, reason }
 *   POST /api/agent/students/[id]/activate  { subjectId }
 *
 * The agent is read-only for global suspensions — those are admin-only.
 * The agent can ONLY suspend/activate on a per-course basis.
 *
 * Used inside the agent portal's search section after a student is
 * looked up. Shows the student's currently-active course-scoped
 * suspensions + a per-course suspend/activate form.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Ban, Power, Clock, AlertCircle, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';

interface SubjectOption {
  id: string;
  name: string;
}

interface ActiveSuspension {
  id: string;
  subject_id: string;
  subject_name: string | null;
  reason: string | null;
  suspended_at: string;
  expires_at: string | null;
}

interface Props {
  open: boolean;
  studentId: string | null;
  studentName: string;
  subjects: SubjectOption[];
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

export default function AgentStudentSuspendDialog({
  open, studentId, studentName, subjects, onClose, onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeSuspensions, setActiveSuspensions] = useState<ActiveSuspension[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [durationHours, setDurationHours] = useState<number | null>(24);
  const [customHours, setCustomHours] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);
  const [reason, setReason] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (open && studentId && subjects.length > 0) {
      setSelectedSubjectId(subjects[0].id);
      setDurationHours(24);
      setCustomHours('');
      setUseCustom(false);
      setReason('');
      fetchActive(studentId);
    } else if (!open) {
      setActiveSuspensions([]);
      setSelectedSubjectId('');
    }
  }, [open, studentId, subjects]);

  const fetchActive = useCallback(async (sid: string) => {
    if (!sid) return;
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('student_suspensions')
        .select(`
          id, subject_id, reason, suspended_at, expires_at, is_active,
          subject:subjects!subject_id(id, name)
        `)
        .eq('student_id', sid)
        .eq('scope', 'course')
        .eq('is_active', true);

      if (error) throw error;

      type Row = {
        id: string;
        subject_id: string;
        reason: string | null;
        suspended_at: string;
        expires_at: string | null;
        is_active: boolean;
        subject: { id: string; name: string } | null;
      };

      const rows = ((data ?? []) as unknown) as Row[];
      const active = rows.filter(r =>
        r.is_active && (r.expires_at === null || r.expires_at > nowIso)
      ).map(r => ({
        id: r.id,
        subject_id: r.subject_id,
        subject_name: r.subject?.name ?? '—',
        reason: r.reason,
        suspended_at: r.suspended_at,
        expires_at: r.expires_at,
      }));

      setActiveSuspensions(active);
    } catch (err) {
      console.error('[AgentStudentSuspendDialog] fetchActive error:', err);
      setActiveSuspensions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSuspend = async () => {
    if (!studentId || !selectedSubjectId) {
      toast.error('اختر المقرر أولاً');
      return;
    }
    setSubmitting(true);
    try {
      const hours = useCustom ? Number(customHours) : durationHours;
      if (useCustom && (!hours || hours <= 0 || isNaN(hours))) {
        toast.error('أدخل عدد ساعات صحيح');
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/agent/students/${studentId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          durationHours: useCustom ? hours : durationHours,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'فشل إيقاف الطالب');
        return;
      }
      toast.success('تم إيقاف الطالب من المقرر المحدد');
      await fetchActive(studentId);
      onChanged?.();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLift = async (subjectId: string, subjectName: string) => {
    if (!studentId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/agent/students/${studentId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ subjectId }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'فشل فك الإيقاف');
        return;
      }
      toast.success(`تم فك الإيقاف عن المقرر: ${subjectName}`);
      await fetchActive(studentId);
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-amber-600" />
            إيقاف / تنشيط الطالب
          </DialogTitle>
          <DialogDescription>
            الطالب: <span className="font-medium">{studentName}</span>
            <br />
            <span className="text-[10px] text-muted-foreground">
              إيقاف على مستوى المقرر فقط — الإيقاف على مستوى المنصة متاح للمشرف فقط
            </span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Active suspensions list */}
            {activeSuspensions.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/15 px-3 py-2 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  الإيقافات النشطة ({activeSuspensions.length})
                </div>
                {activeSuspensions.map(s => (
                  <div key={s.id} className="rounded bg-amber-100/50 dark:bg-amber-900/30 p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-amber-900 dark:text-amber-100 truncate">
                        {s.subject_name}
                      </span>
                      <button
                        onClick={() => handleLift(s.subject_id, s.subject_name ?? '—')}
                        disabled={submitting}
                        className="shrink-0 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Power className="h-3 w-3" />
                        فك الإيقاف
                      </button>
                    </div>
                    <div className="text-[10px] text-amber-700 dark:text-amber-300">
                      <div>أُوقف في: {formatDate(s.suspended_at)}</div>
                      {s.expires_at && <div>ينتهي: {formatDate(s.expires_at)}</div>}
                      {s.reason && <div>السبب: {s.reason}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Suspend form */}
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label>اختر المقرر</Label>
                <Select
                  value={selectedSubjectId}
                  onValueChange={setSelectedSubjectId}
                  disabled={submitting || subjects.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={subjects.length === 0 ? 'لا توجد مقررات متاحة' : 'اختر المقرر'} />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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
                  placeholder="مثال: عدم حضور المحاضرات..."
                  rows={2}
                  maxLength={500}
                />
              </div>

              <Button
                onClick={handleSuspend}
                disabled={submitting || !selectedSubjectId}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Ban className="h-4 w-4 me-1" />}
                إيقاف الطالب من المقرر المحدد
              </Button>

              <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  سيتعذر على الطالب الوصول إلى محتوى المقرر المحدد طوال مدة الإيقاف.
                  لن يتأثر وصوله إلى المقررات الأخرى.
                </span>
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
