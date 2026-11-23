import { parseScormTime, toIsoDuration, toLessonStatus12 } from '@/lib/scorm-runtime';

/** Initial CMI values for SCORM 1.2 (cmi.core.*) or 2004 (cmi.*). */
export function buildCmiData(
  version: string,
  t: Record<string, unknown> | null,
  learnerName: string,
  userId: string,
  preview: boolean,
): Record<string, unknown> {
  const suspend = (t?.suspend_data as string | null | undefined) || '';
  const entry = suspend ? 'resume' : 'ab-initio';
  const str = (v: unknown, fallback = '') => (v === null || v === undefined ? fallback : String(v));
  const totalClock = str(t?.total_time, '00:00:00');
  const mode = preview ? 'browse' : 'normal';
  const credit = preview ? 'no-credit' : 'credit';

  if (version === '1.2') {
    return {
      cmi_core_lesson_status: toLessonStatus12(t?.completion_status as string, t?.success_status as string),
      cmi_core_score_raw: str(t?.score_raw),
      cmi_core_score_min: str(t?.score_min),
      cmi_core_score_max: str(t?.score_max),
      cmi_core_total_time: totalClock,
      cmi_core_suspend_data: suspend,
      cmi_core_entry: entry,
      cmi_core_credit: credit,
      cmi_core_mode: mode,
      cmi_core_student_id: userId,
      cmi_core_student_name: learnerName,
    };
  }

  const totalSeconds = parseScormTime(totalClock);
  return {
    cmi_completion_status: str(t?.completion_status, 'not_attempted').replace('_', ' '),
    cmi_success_status: str(t?.success_status, 'unknown'),
    cmi_score_scaled: str(t?.score_scaled),
    cmi_score_raw: str(t?.score_raw),
    cmi_score_min: str(t?.score_min),
    cmi_score_max: str(t?.score_max),
    cmi_progress_measure: '',
    cmi_total_time: toIsoDuration(Number.isNaN(totalSeconds) ? 0 : totalSeconds),
    cmi_suspend_data: suspend,
    cmi_location: '',
    cmi_entry: entry,
    cmi_mode: mode,
    cmi_credit: credit,
    cmi_learner_id: userId,
    cmi_learner_name: learnerName,
  };
}
