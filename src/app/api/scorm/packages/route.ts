import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

// ─── GET Handler: Get single SCORM package details ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');

    if (!packageId) {
      return NextResponse.json(
        { success: false, error: 'packageId is required' },
        { status: 400 }
      );
    }

    // Fetch the package
    const { data: packageData, error: packageError } = await supabaseServer
      .from('scorm_packages')
      .select('*')
      .eq('id', packageId)
      .single();

    if (packageError || !packageData) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }

    // Fetch resources for this package
    const { data: resources, error: resourceError } = await supabaseServer
      .from('scorm_resources')
      .select('*')
      .eq('package_id', packageId)
      .order('order_index', { ascending: true });

    if (resourceError) {
      console.error('[SCORM Package] Resources fetch error:', resourceError.message);
    }

    // Fetch uploader name
    const { data: uploader } = await supabaseServer
      .from('users')
      .select('id, full_name')
      .eq('id', packageData.uploaded_by)
      .single();

    // Fetch tracking summary for this package
    const { data: trackingSummary } = await supabaseServer
      .from('scorm_tracking')
      .select('id, student_id, resource_id, completion_status, success_status, score_raw, score_scaled, total_time, launch_count, last_accessed')
      .eq('package_id', packageId);

    // Build summary stats
    const totalStudents = trackingSummary ? new Set(trackingSummary.map((t: Record<string, unknown>) => t.student_id)).size : 0;
    const completedCount = trackingSummary ? trackingSummary.filter((t: Record<string, unknown>) => t.completion_status === 'completed').length : 0;
    const inProgressCount = trackingSummary ? trackingSummary.filter((t: Record<string, unknown>) => t.completion_status === 'incomplete').length : 0;
    const passedCount = trackingSummary ? trackingSummary.filter((t: Record<string, unknown>) => t.success_status === 'passed').length : 0;
    const failedCount = trackingSummary ? trackingSummary.filter((t: Record<string, unknown>) => t.success_status === 'failed').length : 0;
    const avgScore = trackingSummary && trackingSummary.length > 0
      ? trackingSummary.reduce((sum: number, t: Record<string, unknown>) => sum + (Number(t.score_raw) || 0), 0) / trackingSummary.filter((t: Record<string, unknown>) => t.score_raw !== null).length || 0
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        ...packageData,
        uploader_name: uploader?.full_name || 'Unknown',
        resources: resources || [],
        tracking_summary: {
          total_students: totalStudents,
          completed_count: completedCount,
          in_progress_count: inProgressCount,
          passed_count: passedCount,
          failed_count: failedCount,
          average_score_raw: Math.round(avgScore),
        },
      },
    });
  } catch (error) {
    console.error('[SCORM Package] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch SCORM package' },
      { status: 500 }
    );
  }
}

// ─── DELETE Handler: Delete a SCORM package ───

export async function DELETE(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');

    if (!packageId) {
      return NextResponse.json(
        { success: false, error: 'packageId is required' },
        { status: 400 }
      );
    }

    // Fetch the package to verify ownership
    const { data: packageData, error: packageError } = await supabaseServer
      .from('scorm_packages')
      .select('id, uploaded_by, subject_id, storage_path')
      .eq('id', packageId)
      .single();

    if (packageError || !packageData) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }

    // Verify teacher owns this package or is subject owner/co-teacher
    const role = await getUserRole(authResult.user.id);
    const isSuperAdmin = role === 'superadmin';

    if (!isSuperAdmin && packageData.uploaded_by !== authResult.user.id) {
      // Check if the teacher is the subject owner
      const { data: subject } = await supabaseServer
        .from('subjects')
        .select('teacher_id')
        .eq('id', packageData.subject_id)
        .single();

      if (subject?.teacher_id !== authResult.user.id) {
        // Check co-teacher
        const { data: coTeacher } = await supabaseServer
          .from('subject_teachers')
          .select('id')
          .eq('subject_id', packageData.subject_id)
          .eq('teacher_id', authResult.user.id)
          .maybeSingle();

        if (!coTeacher) {
          return NextResponse.json(
            { success: false, error: 'You do not have permission to delete this package' },
            { status: 403 }
          );
        }
      }
    }

    // Delete tracking data first
    await supabaseServer
      .from('scorm_tracking')
      .delete()
      .eq('package_id', packageId);

    // Delete resources
    await supabaseServer
      .from('scorm_resources')
      .delete()
      .eq('package_id', packageId);

    // Delete storage files
    const { data: storageFiles } = await supabaseServer.storage
      .from('scorm-packages')
      .list(packageData.storage_path);

    if (storageFiles && storageFiles.length > 0) {
      const filePaths = storageFiles.map(f => `${packageData.storage_path}/${f.name}`);
      await supabaseServer.storage.from('scorm-packages').remove(filePaths);
    }

    // Delete the package record
    const { error: deleteError } = await supabaseServer
      .from('scorm_packages')
      .delete()
      .eq('id', packageId);

    if (deleteError) {
      console.error('[SCORM Package] Delete error:', deleteError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to delete SCORM package' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'SCORM package deleted successfully',
    });
  } catch (error) {
    console.error('[SCORM Package] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete SCORM package' },
      { status: 500 }
    );
  }
}

// ─── PATCH Handler: Update SCORM package metadata ───

export async function PATCH(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { packageId, title, description, status } = body as {
      packageId: string;
      title?: string;
      description?: string;
      status?: 'active' | 'draft' | 'archived';
    };

    if (!packageId) {
      return NextResponse.json(
        { success: false, error: 'packageId is required' },
        { status: 400 }
      );
    }

    // Verify package exists and user has permission
    const { data: existingPackage } = await supabaseServer
      .from('scorm_packages')
      .select('id, uploaded_by, subject_id')
      .eq('id', packageId)
      .single();

    if (!existingPackage) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status) {
      const validStatuses = ['active', 'draft', 'archived'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { success: false, error: `Invalid status: ${status}` },
          { status: 400 }
        );
      }
      updateData.status = status;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: updatedPackage, error: updateError } = await supabaseServer
      .from('scorm_packages')
      .update(updateData)
      .eq('id', packageId)
      .select()
      .single();

    if (updateError) {
      console.error('[SCORM Package] Update error:', updateError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to update SCORM package' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updatedPackage,
    });
  } catch (error) {
    console.error('[SCORM Package] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update SCORM package' },
      { status: 500 }
    );
  }
}
