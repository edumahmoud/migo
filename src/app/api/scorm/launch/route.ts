import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

// ─── GET Handler: Returns launch data for a SCORM resource ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');
    const resourceId = searchParams.get('resourceId');

    if (!packageId || !resourceId) {
      return NextResponse.json(
        { success: false, error: 'packageId and resourceId are required' },
        { status: 400 }
      );
    }

    // ── Fetch the SCORM package ──
    const { data: packageData, error: packageError } = await supabaseServer
      .from('scorm_packages')
      .select('id, title, version, entry_point, storage_path, subject_id, status')
      .eq('id', packageId)
      .single();

    if (packageError || !packageData) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }

    if (packageData.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Package is not active' },
        { status: 400 }
      );
    }

    // ── Fetch the SCORM resource ──
    const { data: resourceData, error: resourceError } = await supabaseServer
      .from('scorm_resources')
      .select('id, identifier, title, type, href, scorm_type, parent_identifier, order_index, launch_url')
      .eq('id', resourceId)
      .eq('package_id', packageId)
      .single();

    if (resourceError || !resourceData) {
      return NextResponse.json(
        { success: false, error: 'Resource not found in this package' },
        { status: 404 }
      );
    }

    // ── Verify enrollment: students must be enrolled in the subject ──
    const role = await getUserRole(authResult.user.id);
    const isStudent = role === 'student';
    const isAdminOrTeacher = role === 'admin' || role === 'superadmin' || role === 'teacher';

    if (isStudent) {
      // Check if the student is enrolled in the subject
      const { data: enrollment, error: enrollError } = await supabaseServer
        .from('subject_students')
        .select('id')
        .eq('subject_id', packageData.subject_id)
        .eq('student_id', authResult.user.id)
        .maybeSingle();

      if (enrollError || !enrollment) {
        return NextResponse.json(
          { success: false, error: 'You are not enrolled in this subject' },
          { status: 403 }
        );
      }
    } else if (!isAdminOrTeacher) {
      return NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      );
    }

    // ── Get or create initial tracking record ──
    const { data: existingTracking, error: trackingError } = await supabaseServer
      .from('scorm_tracking')
      .select('*')
      .eq('student_id', authResult.user.id)
      .eq('resource_id', resourceId)
      .maybeSingle();

    let trackingData = existingTracking;

    if (!trackingData) {
      // Create initial tracking record
      const { data: newTracking, error: createError } = await supabaseServer
        .from('scorm_tracking')
        .insert({
          student_id: authResult.user.id,
          package_id: packageId,
          resource_id: resourceId,
          completion_status: 'not_attempted',
          success_status: 'unknown',
          total_time: '00:00:00',
          session_time: '00:00:00',
          launch_count: 0,
          last_accessed: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) {
        console.error('[SCORM Launch] Tracking creation error:', createError.message);
        // Non-blocking: proceed even if tracking creation fails
      } else {
        trackingData = newTracking;
      }
    }

    // ── Update tracking: set last_accessed and increment launch_count ──
    const currentLaunchCount = trackingData?.launch_count ?? 0;
    const { data: updatedTracking, error: updateError } = await supabaseServer
      .from('scorm_tracking')
      .update({
        last_accessed: new Date().toISOString(),
        launch_count: currentLaunchCount + 1,
      })
      .eq('student_id', authResult.user.id)
      .eq('resource_id', resourceId)
      .select()
      .single();

    if (updateError) {
      console.error('[SCORM Launch] Tracking update error:', updateError.message);
      // Non-blocking: proceed even if update fails
    }

    const finalTracking = updatedTracking || trackingData;

    // ── Build CMI data model for SCORM 1.2 or 2004 ──
    const cmiData = buildCmiData(packageData.version, finalTracking, resourceData);

    // ── Determine the launch URL ──
    let launchUrl = resourceData.launch_url;

    // If launch_url is empty or relative, build it from storage_path and href
    if (!launchUrl || launchUrl.startsWith('/')) {
      const resourceHref = resourceData.href || packageData.entry_point;
      const fullPath = `${packageData.storage_path}/${resourceHref}`;

      const { data: urlData } = supabaseServer.storage
        .from('scorm-packages')
        .getPublicUrl(fullPath);

      launchUrl = urlData?.publicUrl || '';
    }

    // ── Return launch data ──
    return NextResponse.json({
      success: true,
      data: {
        launchUrl,
        packageVersion: packageData.version,
        packageTitle: packageData.title,
        resourceTitle: resourceData.title,
        resourceType: resourceData.type,
        trackingData: finalTracking || null,
        cmiData,
      },
    });
  } catch (error) {
    console.error('[SCORM Launch] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to prepare SCORM launch data' },
      { status: 500 }
    );
  }
}

/**
 * Build CMI data model based on SCORM version and existing tracking data.
 * SCORM 1.2 uses cmi.core.* fields, SCORM 2004 uses cmi.* fields.
 */
function buildCmiData(
  version: string,
  trackingData: Record<string, unknown> | null | undefined,
  resourceData: Record<string, unknown>
): Record<string, unknown> {
  if (version === '1.2') {
    return {
      cmi_core_lesson_status: trackingData?.completion_status || 'not_attempted',
      cmi_core_score_raw: trackingData?.score_raw?.toString() || '0',
      cmi_core_score_min: trackingData?.score_min?.toString() || '0',
      cmi_core_score_max: trackingData?.score_max?.toString() || '100',
      cmi_core_session_time: trackingData?.session_time || '00:00:00',
      cmi_core_total_time: trackingData?.total_time || '00:00:00',
      cmi_core_lesson_location: '',
      cmi_core_suspend_data: trackingData?.suspend_data || '',
      cmi_core_entry: (Number(trackingData?.launch_count ?? 0)) > 0 ? 'resume' : 'ab-initio',
      cmi_core_credit: 'credit',
      cmi_core_mode: 'normal',
      cmi_core_student_id: trackingData?.student_id || '',
      cmi_core_student_name: '',
      cmi_student_preference_language: 'en',
      cmi_launch_data: '',
    };
  }

  // SCORM 2004
  return {
    cmi_completion_status: trackingData?.completion_status || 'not_attempted',
    cmi_success_status: trackingData?.success_status || 'unknown',
    cmi_score_scaled: trackingData?.score_scaled?.toString() || '0',
    cmi_score_raw: trackingData?.score_raw?.toString() || '0',
    cmi_score_min: trackingData?.score_min?.toString() || '0',
    cmi_score_max: trackingData?.score_max?.toString() || '100',
    cmi_progress_measure: '0',
    cmi_total_time: trackingData?.total_time || '00:00:00',
    cmi_session_time: trackingData?.session_time || '00:00:00',
    cmi_suspend_data: trackingData?.suspend_data || '',
    cmi_location: '',
    cmi_entry: (Number(trackingData?.launch_count ?? 0)) > 0 ? 'resume' : 'ab-initio',
    cmi_mode: 'normal',
    cmi_credit: 'credit',
    cmi_learner_id: trackingData?.student_id || '',
    cmi_learner_name: '',
    cmi_learner_preference_language: 'en',
  };
}
