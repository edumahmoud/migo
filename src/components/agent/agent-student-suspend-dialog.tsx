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
import { useTranslations } from '@/i18n/use-translations';

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
  { label: 'agentSuspendDialog.duration.hour', hours: 1 },
  { label: 'agentSuspendDialog.duration.day', hours: 24 },
  { label: 'agentSuspendDialog.duration.week', hours: 24 * 7 },
  { label: 'agentSuspendDialog.duration.month', hours: 24 * 30 },
  { label: 'agentSuspendDialog.duration.indefinite', hours: null },
];

export default function AgentStudentSuspendDialog({
  open, studentId, studentName, subjects, onClose, onChanged,
}: Props) {
  const { t } = useTranslations();
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
      // v131: use the server endpoint instead of the browser supabase
      // client. The previous client-side query was subject to RLS on
      // `subjects` (which requires `teacher_id = auth.uid()`) — since
      // the agent's auth.uid() is their own user id (not the teacher's),
      // the subject name lookup returned an empty list and the UI fell
      // back to "مقرر غير معروف". The server endpoint uses the service
      // role to bypass RLS and resolves the subject name server-side.
      const res = await fetch(
        `/api/agent/students/${sid}/suspensions`,
        { headers: await getCachedAuthHeaders() },
      );
      const json = await res.json();
      if (!json.success) {
        setActiveSuspensions([]);
        return;
      }
      const list = (json.suspensions ?? []) as ActiveSuspension[];
      setActiveSuspensions(list);
    } catch (err) {
      console.error('[AgentStudentSuspendDialog] fetchActive error:', err);
      setActiveSuspensions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSuspend = async () => {
    if (!studentId || !selectedSubjectId) {
      toast.error(t('agentSuspendDialog.pickSubjectFirst'));
      return;
    }
    setSubmitting(true);
    try {
      const hours = useCustom ? Number(customHours) : durationHours;
      if (useCustom && (!hours || hours <= 0 || isNaN(hours))) {
        toast.error(t('agentSuspendDialog.invalidHours'));
        setSubmitting(false);
        return;
      }

      // v131: If "all courses" selected, loop through each subject.
      // EXCLUDE subjects that already have an active suspension — the
      // server now rejects re-suspending an already-suspended subject,
      // and skipping them here lets us give a clearer partial-success
      // message instead of a generic failure.
      const alreadySuspendedIds = new Set(activeSuspensions.map(s => s.subject_id));
      const targetSubjectIds = selectedSubjectId === '__all__'
        ? subjects.filter(s => !alreadySuspendedIds.has(s.id)).map(s => s.id)
        : [selectedSubjectId];

      // v131: single-subject suspend — if that subject is already
      // actively suspended, refuse client-side too (the API will also
      // refuse, but this gives immediate feedback without a round-trip).
      if (selectedSubjectId !== '__all__' && alreadySuspendedIds.has(selectedSubjectId)) {
        toast.error(t('agentSuspendDialog.alreadySuspended'));
        setSubmitting(false);
        return;
      }

      // Edge case: "all courses" but every enrolled course is already
      // suspended → nothing to do.
      if (targetSubjectIds.length === 0) {
        toast.info(t('agentSuspendDialog.allAlreadySuspended'));
        setSubmitting(false);
        return;
      }

      let successCount = 0;
      let lastError = '';
      for (const subjId of targetSubjectIds) {
        const res = await fetch(`/api/agent/students/${studentId}/suspend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
          body: JSON.stringify({
            subjectId: subjId,
            durationHours: useCustom ? hours : durationHours,
            reason: reason.trim() || undefined,
          }),
        });
        const json = await res.json();
        if (json.success) {
          successCount++;
        } else {
          lastError = json.error || t('agentSuspendDialog.suspendFailed');
        }
      }

      if (successCount === targetSubjectIds.length) {
        const skippedCount = selectedSubjectId === '__all__'
          ? alreadySuspendedIds.size
          : 0;
        const msg = selectedSubjectId === '__all__'
          ? (skippedCount > 0
              ? t('agentSuspendDialog.suspendedFromSomeSkipped', { successCount, skippedCount })
              : t('agentSuspendDialog.suspendedFromAll', { successCount }))
          : t('agentSuspendDialog.suspendedFromSelected');
        toast.success(msg);
      } else if (successCount > 0) {
        toast.success(t('agentSuspendDialog.suspendedPartial', { successCount, total: targetSubjectIds.length }));
      } else {
        toast.error(lastError || t('agentSuspendDialog.suspendStudentFailed'));
        return;
      }
      await fetchActive(studentId);
      onChanged?.();
    } catch {
      toast.error(t('agentSuspendDialog.unexpectedError'));
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
        toast.error(json.error || t('agentSuspendDialog.liftFailed'));
        return;
      }
      toast.success(t('agentSuspendDialog.liftedFromSubject', { subjectName }));
      await fetchActive(studentId);
      onChanged?.();
    } catch {
      toast.error(t('agentSuspendDialog.unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLiftAll = async () => {
    if (!studentId || activeSuspensions.length === 0) return;
    setSubmitting(true);
    let successCount = 0;
    for (const s of activeSuspensions) {
      try {
        const res = await fetch(`/api/agent/students/${studentId}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
          body: JSON.stringify({ subjectId: s.subject_id }),
        });
        const json = await res.json();
        if (json.success) successCount++;
      } catch { /* skip */ }
    }
    toast.success(t('agentSuspendDialog.liftedPartial', { successCount, total: activeSuspensions.length }));
    await fetchActive(studentId);
    onChanged?.();
    setSubmitting(false);
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
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="shrink-0 p-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-amber-600" />
            {t('agentSuspendDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('agentSuspendDialog.studentLabel')} <span className="font-medium">{studentName}</span>
            <br />
            <span className="text-[10px] text-muted-foreground">
              {t('agentSuspendDialog.courseOnlyNote')}
            </span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
          </div>
        ) : (
          <div className="space-y-3 flex-1 overflow-y-auto px-6 pb-4">
            {/* Active suspensions list */}
            {activeSuspensions.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/15 px-3 py-2 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t('agentSuspendDialog.activeSuspensions', { count: activeSuspensions.length })}
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
                        {t('agentSuspendDialog.lift')}
                      </button>
                    </div>
                    <div className="text-[10px] text-amber-700 dark:text-amber-300">
                      <div>{t('agentSuspendDialog.suspendedAt')}{formatDate(s.suspended_at)}</div>
                      {s.expires_at && <div>{t('agentSuspendDialog.expires')}{formatDate(s.expires_at)}</div>}
                      {s.reason && <div>{t('agentSuspendDialog.reason')}{s.reason}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Suspend form */}
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label>{t('agentSuspendDialog.chooseSubject')}</Label>
                <Select
                  value={selectedSubjectId}
                  onValueChange={setSelectedSubjectId}
                  disabled={submitting || subjects.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={subjects.length === 0 ? t('agentSuspendDialog.noSubjects') : t('agentSuspendDialog.chooseSubject')} />
                  </SelectTrigger>
                  <SelectContent>
                    {/* v130: "All courses" option — suspends the student from
                        ALL of this teacher's courses at once */}
                    <SelectItem value="__all__">{t('agentSuspendDialog.allSubjects')}</SelectItem>
                    {subjects.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('agentSuspendDialog.durationLabel')}</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {DURATION_PRESETS.map((p) => {
                    const selected = !useCustom && durationHours === p.hours;
                    return (
                      <button
                        key={t(p.label)}
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
                  {t('agentSuspendDialog.customHours')}
                </Label>
                {useCustom && (
                  <Input
                    type="number"
                    min={1}
                    value={customHours}
                    onChange={(e) => setCustomHours(e.target.value)}
                    placeholder={t('agentSuspendDialog.hoursPlaceholder')}
                    dir="ltr"
                  />
                )}
              </div>

              <div className="space-y-1">
                <Label>{t('agentSuspendDialog.reasonLabel')} (مطلوب)</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('agentSuspendDialog.reasonPlaceholder')}
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
                {t('agentSuspendDialog.suspendSelected')}
              </Button>

              <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  {t('agentSuspendDialog.suspendNote1')}
                  {t('agentSuspendDialog.suspendNote2')}
                </span>
              </p>
            </div>
          </div>
        )}
        {/* v130: Footer pinned to bottom — always visible */}
        <div className="shrink-0 border-t px-6 py-3 flex items-center gap-2 bg-card">
          {activeSuspensions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLiftAll}
              disabled={submitting}
              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            >
              <Power className="h-4 w-4 me-1" />
              {t('agentSuspendDialog.liftAll', { count: activeSuspensions.length })}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting} className="ms-auto">
            {t('agentSuspendDialog.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
