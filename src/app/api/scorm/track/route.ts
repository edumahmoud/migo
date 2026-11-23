import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { loadPackageWithAccess, studentIdsOfTeacher, UUID_REGEX } from '@/lib/scorm-access';
import {
  MAX_SUSPEND_DATA,
  addTimes,
  cleanScaled,
  cleanScore,
  mapLessonStatus12,
  normalizeCompletion2004,
  normalizeSessionTime,
  normalizeSuccess2004,
} from '@/lib/scorm-runtime';
import type { ScormCompletionStatus, ScormSuccessStatus } from '@/lib/scorm-types';

const COMPLETION_RANK: Record<string, number> = { unknown: 0, not_attempted: 0, incomplete: 1, completed: 2 };

const LEGACY_12_VALUES = new Set(['passed', 'failed', 'browsed', 'not attempted']);

interface TrackBody {
  student_id?: string;
  package_id?: string;
  resource_id?: string;
  /** Raw SCORM 1.2 cmi.core.lesson_status */
  lesson_status?: string;
  completion_status?: string;
  success_status?: string;
  score_raw?: unknown;
  score_min?: unknown;
  score_max?: unknown;
  score_scaled?: unknown;
  session_time?: string;
  suspend_data?: string | null;
  /** true on LMSFinish / Terminate / close: add session_time to total_time once */
  final?: boolean;
}

// ─── POST: save a student's progress ───

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body: TrackBody = await request.json();
    const userId = authResult.user.id;
    const { package_id, resource_id } = body;

    if (!package_id || !resource_id || !UUID_REGEX.test(package_id) || !UUID_REGEX.test(resource_id)) {
      return NextResponse.json({ success: false, error: 'packageId and resourceId are required' }, { status: 400 });
    }
    // Old clients send student_id: it must be the caller, tracking is never written for someone else
    if (body.student_id && body.student_id !== userId) {
      return NextResponse.json(
        { success: false, error: 'Students can only update their own tracking data' },
        { status: 403 },
      );
    }

    const role = await getUserRole(userId);
    const { pkg, access } = await loadPackageWithAccess(package_id, userId, role);
    if (!pkg) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    if (!access.canView) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });

    // Teachers and admins previewing content do not create tracking rows
    if (!access.isStudent) return NextResponse.json({ success: true, data: null, preview: true });

    const { data: resource } = await supabaseServer
      .from('scorm_resources')
      .select('id')
      .eq('id', resource_id)
      .eq('package_id', package_id)
      .maybeSingle();
    if (!resource) return NextResponse.json({ success: false, error: 'Resource not found in this package' }, { status: 404 });

    // ── Status ──
    let completion: ScormCompletionStatus;
    let success: ScormSuccessStatus;
    const rawCompletion = String(body.completion_status ?? '').trim().toLowerCase();
    if (body.lesson_status !== undefined) {
      ({ completion, success } = mapLessonStatus12(body.lesson_status));
    } else if (LEGACY_12_VALUES.has(rawCompletion)) {
      ({ completion, success } = mapLessonStatus12(rawCompletion));
    } else {
      completion = normalizeCompletion2004(body.completion_status);
      success = normalizeSuccess2004(body.success_status);
    }

    const { data: existing } = await supabaseServer
      .from('scorm_tracking')
      .select('completion_status, success_status, score_raw, score_min, score_max, score_scaled, total_time, suspend_data, launch_count')
      .eq('student_id', userId)
      .eq('resource_id', resource_id)
      .maybeSingle();

    // Keep the best result: never fall back from completed, never lose a known pass/fail to "unknown"
    if (existing) {
      const prev = existing.completion_status as ScormCompletionStatus;
      if ((COMPLETION_RANK[prev] ?? 0) > (COMPLETION_RANK[completion] ?? 0)) completion = prev;
      if (success === 'unknown' && existing.success_status && existing.success_status !== 'unknown') {
        success = existing.success_status as ScormSuccessStatus;
      }
    }

    const sessionTime = normalizeSessionTime(body.session_time);
    let suspend: string | null | undefined = undefined;
    if (body.suspend_data !== undefined) {
      suspend = body.suspend_data === null ? null : String(body.suspend_data);
      if (suspend !== null && suspend.length > MAX_SUSPEND_DATA) {
        return NextResponse.json({ success: false, error: 'suspend_data is too large' }, { status: 413 });
      }
    }

    const row: Record<string, unknown> = {
      student_id: userId,
      package_id,
      resource_id,
      completion_status: completion,
      success_status: success,
      session_time: sessionTime,
      last_accessed: new Date().toISOString(),
    };
    const scoreRaw = cleanScore(body.score_raw);
    const scoreMin = cleanScore(body.score_min);
    const scoreMax = cleanScore(body.score_max);
    const scoreScaled = cleanScaled(body.score_scaled);
    if (scoreRaw !== null) row.score_raw = scoreRaw;
    if (scoreMin !== null) row.score_min = scoreMin;
    if (scoreMax !== null) row.score_max = scoreMax;
    if (scoreScaled !== null) row.score_scaled = scoreScaled;
    if (suspend !== undefined) row.suspend_data = suspend;
    if (body.final === true) row.total_time = addTimes(existing?.total_time, sessionTime);

    const { data: tracking, error: upsertError } = await supabaseServer
      .from('scorm_tracking')
      .upsert(row, { onConflict: 'student_id,resource_id' })
      .select()
      .single();

    if (upsertError) {
      console.error('[SCORM Track] Upsert error:', upsertError.message);
      return NextResponse.json({ success: false, error: 'Failed to save tracking data' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: tracking });
  } catch (error) {
    console.error('[SCORM Track] POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to process tracking data' }, { status: 500 });
  }
}

// ─── GET: read tracking ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');
    const resourceId = searchParams.get('resourceId');
    const studentId = searchParams.get('studentId');
    const userId = authResult.user.id;

    if (!packageId || !UUID_REGEX.test(packageId)) {
      return NextResponse.json({ success: false, error: 'packageId is required' }, { status: 400 });
    }
    if ((resourceId && !UUID_REGEX.test(resourceId)) || (studentId && !UUID_REGEX.test(studentId))) {
      return NextResponse.json({ success: false, error: 'Invalid id format' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const { pkg, access } = await loadPackageWithAccess(packageId, userId, role);
    if (!pkg) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    if (!access.canView) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });

    let query = supabaseServer
      .from('scorm_tracking')
      .select(
        'id, student_id, package_id, resource_id, completion_status, success_status, score_raw, score_min, score_max, score_scaled, total_time, session_time, suspend_data, launch_count, last_accessed, created_at, updated_at',
      )
      .eq('package_id', packageId);
    if (resourceId) query = query.eq('resource_id', resourceId);

    if (access.isStudent) {
      if (studentId && studentId !== userId) {
        return NextResponse.json({ success: false, error: 'You can only view your own tracking' }, { status: 403 });
      }
      query = query.eq('student_id', userId);
    } else {
      if (studentId) query = query.eq('student_id', studentId);
      if (!access.canManage) {
        // Teacher using a platform library package: only their own students
        const allowed = await studentIdsOfTeacher(userId);
        if (allowed.length === 0) return NextResponse.json({ success: true, data: [] });
        query = query.in('student_id', allowed);
      }
    }

    const { data: trackingData, error: fetchError } = await query;
    if (fetchError) {
      console.error('[SCORM Track] GET error:', fetchError.message);
      return NextResponse.json({ success: false, error: 'Failed to fetch tracking data' }, { status: 500 });
    }
    if (!trackingData || trackingData.length === 0) return NextResponse.json({ success: true, data: [] });

    // Student names are only shown to teachers/admins
    if (access.isStudent) return NextResponse.json({ success: true, data: trackingData });

    const studentIds = [...new Set(trackingData.map((t: { student_id: string }) => t.student_id))];
    const resourceIds = [...new Set(trackingData.map((t: { resource_id: string }) => t.resource_id))];
    const [{ data: students }, { data: resources }] = await Promise.all([
      supabaseServer.from('users').select('id, name, email, avatar_url').in('id', studentIds),
      supabaseServer.from('scorm_resources').select('id, title, identifier').in('id', resourceIds),
    ]);

    const studentById = new Map((students || []).map((s: { id: string }) => [s.id, s as Record<string, unknown>]));
    const resourceById = new Map((resources || []).map((r: { id: string }) => [r.id, r as Record<string, unknown>]));
    const enriched = trackingData.map((t: Record<string, unknown>) => {
      const s = studentById.get(t.student_id as string);
      const r = resourceById.get(t.resource_id as string);
      return {
        ...t,
        student_name: (s?.name as string) || 'Unknown',
        student_email: (s?.email as string) || '',
        student_avatar_url: (s?.avatar_url as string) || null,
        resource_title: (r?.title as string) || '',
      };
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    console.error('[SCORM Track] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch tracking data' }, { status: 500 });
  }
}
