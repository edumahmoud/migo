import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import type {
  ScormCompletionStatus,
  ScormSuccessStatus,
  ScormTrackingUpsertRequest,
} from '@/lib/scorm-types';

// ─── POST Handler: Upsert tracking data ───

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body: ScormTrackingUpsertRequest = await request.json();

    // Validate required fields
    const { student_id, package_id, resource_id } = body;
    if (!student_id || !package_id || !resource_id) {
      return NextResponse.json(
        { success: false, error: 'studentId, packageId, and resourceId are required' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user is the student (students can only update their own tracking)
    if (authResult.user.id !== student_id) {
      return NextResponse.json(
        { success: false, error: 'Students can only update their own tracking data' },
        { status: 403 }
      );
    }

    // Validate completion_status and success_status values
    const validCompletionStatuses: ScormCompletionStatus[] = ['not_attempted', 'incomplete', 'completed', 'unknown'];
    const validSuccessStatuses: ScormSuccessStatus[] = ['passed', 'failed', 'unknown'];

    const completionStatus = body.completion_status || 'not_attempted';
    const successStatus = body.success_status || 'unknown';

    if (!validCompletionStatuses.includes(completionStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid completion_status: ${completionStatus}` },
        { status: 400 }
      );
    }

    if (!validSuccessStatuses.includes(successStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid success_status: ${successStatus}` },
        { status: 400 }
      );
    }

    // Verify the resource exists
    const { data: resourceData, error: resourceError } = await supabaseServer
      .from('scorm_resources')
      .select('id, package_id')
      .eq('id', resource_id)
      .single();

    if (resourceError || !resourceData) {
      return NextResponse.json(
        { success: false, error: 'Resource not found' },
        { status: 404 }
      );
    }

    // Verify the package exists
    const { data: packageData, error: packageError } = await supabaseServer
      .from('scorm_packages')
      .select('id, subject_id')
      .eq('id', package_id)
      .single();

    if (packageError || !packageData) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }

    // Upsert tracking data
    const upsertData = {
      student_id,
      package_id,
      resource_id,
      completion_status: completionStatus,
      success_status: successStatus,
      score_raw: body.score_raw ?? null,
      score_min: body.score_min ?? null,
      score_max: body.score_max ?? null,
      score_scaled: body.score_scaled ?? null,
      session_time: body.session_time || '00:00:00',
      suspend_data: body.suspend_data ?? null,
      launch_count: body.launch_count ?? undefined,
      last_accessed: new Date().toISOString(),
    };

    const { data: trackingData, error: upsertError } = await supabaseServer
      .from('scorm_tracking')
      .upsert(upsertData, {
        onConflict: 'student_id,resource_id',
      })
      .select()
      .single();

    if (upsertError) {
      console.error('[SCORM Track] Upsert error:', upsertError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to save tracking data' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: trackingData,
    });
  } catch (error) {
    console.error('[SCORM Track] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process tracking data' },
      { status: 500 }
    );
  }
}

// ─── GET Handler: Fetch tracking data ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');
    const resourceId = searchParams.get('resourceId');
    const studentId = searchParams.get('studentId');

    if (!packageId) {
      return NextResponse.json(
        { success: false, error: 'packageId is required' },
        { status: 400 }
      );
    }

    const role = await getUserRole(authResult.user.id);
    const isAdminOrTeacher = role === 'admin' || role === 'superadmin' || role === 'teacher';

    let query = supabaseServer
      .from('scorm_tracking')
      .select(`
        id,
        student_id,
        package_id,
        resource_id,
        completion_status,
        success_status,
        score_raw,
        score_min,
        score_max,
        score_scaled,
        total_time,
        session_time,
        suspend_data,
        launch_count,
        last_accessed,
        created_at,
        updated_at
      `)
      .eq('package_id', packageId);

    // ── Teachers/admins: can view any student's tracking data ──
    if (isAdminOrTeacher) {
      // Optionally filter by a specific student
      if (studentId) {
        query = query.eq('student_id', studentId);
      }
      // Optionally filter by a specific resource
      if (resourceId) {
        query = query.eq('resource_id', resourceId);
      }
    } else {
      // ── Students: can only view their own tracking data ──
      if (!resourceId) {
        return NextResponse.json(
          { success: false, error: 'Students must specify resourceId to view their tracking' },
          { status: 400 }
        );
      }
      query = query
        .eq('student_id', authResult.user.id)
        .eq('resource_id', resourceId);
    }

    const { data: trackingData, error: fetchError } = await query;

    if (fetchError) {
      console.error('[SCORM Track] GET error:', fetchError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch tracking data' },
        { status: 500 }
      );
    }

    // Enrich with student names (join with users table)
    if (trackingData && trackingData.length > 0) {
      const studentIds = [...new Set(trackingData.map((t: { student_id: string }) => t.student_id))];

      const { data: students } = await supabaseServer
        .from('users')
        .select('id, full_name, email, avatar_url')
        .in('id', studentIds);

      // Enrich with resource titles
      const resourceIds = [...new Set(trackingData.map((t: { resource_id: string }) => t.resource_id))];

      const { data: resources } = await supabaseServer
        .from('scorm_resources')
        .select('id, title, identifier')
        .in('id', resourceIds);

      // Merge student names and resource titles into tracking data
      const enrichedData = trackingData.map((t: Record<string, unknown>) => {
        const student = students?.find((s: Record<string, unknown>) => s.id === t.student_id);
        const resource = resources?.find((r: Record<string, unknown>) => r.id === t.resource_id);

        return {
          ...t,
          student_name: student?.full_name || 'Unknown',
          student_email: student?.email || '',
          student_avatar_url: student?.avatar_url || null,
          resource_title: resource?.title || '',
        };
      });

      return NextResponse.json({
        success: true,
        data: enrichedData,
      });
    }

    return NextResponse.json({
      success: true,
      data: trackingData || [],
    });
  } catch (error) {
    console.error('[SCORM Track] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch tracking data' },
      { status: 500 }
    );
  }
}
