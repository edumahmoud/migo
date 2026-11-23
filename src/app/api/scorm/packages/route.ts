import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { loadPackageWithAccess, studentIdsOfTeacher, UUID_REGEX } from '@/lib/scorm-access';

// ─── GET: single package details ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');
    const userId = authResult.user.id;

    if (!packageId || !UUID_REGEX.test(packageId)) {
      return NextResponse.json({ success: false, error: 'packageId is required' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const { pkg, access } = await loadPackageWithAccess(packageId, userId, role, '*');
    if (!pkg) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    if (!access.canView) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });

    const { data: resources, error: resourceError } = await supabaseServer
      .from('scorm_resources')
      .select('*')
      .eq('package_id', packageId)
      .order('order_index', { ascending: true });
    if (resourceError) console.error('[SCORM Package] Resources fetch error:', resourceError.message);

    const { data: uploader } = await supabaseServer
      .from('users')
      .select('id, name')
      .eq('id', pkg.uploaded_by)
      .maybeSingle();

    // Internal fields never leave the server
    const { storage_path: _storagePath, manifest_xml: _manifest, ...publicPkg } = pkg as Record<string, unknown>;
    void _storagePath;
    void _manifest;

    const result: Record<string, unknown> = {
      ...publicPkg,
      uploader_name: uploader?.name || 'Unknown',
      resources: resources || [],
    };

    // Class statistics: teachers/admins only, limited to their own students unless they manage the package
    if (!access.isStudent) {
      let q = supabaseServer
        .from('scorm_tracking')
        .select('student_id, completion_status, success_status, score_raw')
        .eq('package_id', packageId);
      if (!access.canManage) {
        const allowed = await studentIdsOfTeacher(userId);
        q = q.in('student_id', allowed.length > 0 ? allowed : ['00000000-0000-0000-0000-000000000000']);
      }
      const { data: tracking } = await q;
      const rows = tracking || [];
      const scored = rows.filter((t: { score_raw: number | null }) => t.score_raw !== null && t.score_raw !== undefined);
      const avg = scored.length > 0
        ? scored.reduce((sum: number, t: { score_raw: number | string }) => sum + Number(t.score_raw), 0) / scored.length
        : 0;
      result.tracking_summary = {
        total_students: new Set(rows.map((t: { student_id: string }) => t.student_id)).size,
        completed_count: rows.filter((t: { completion_status: string }) => t.completion_status === 'completed').length,
        in_progress_count: rows.filter((t: { completion_status: string }) => t.completion_status === 'incomplete').length,
        passed_count: rows.filter((t: { success_status: string }) => t.success_status === 'passed').length,
        failed_count: rows.filter((t: { success_status: string }) => t.success_status === 'failed').length,
        average_score_raw: Math.round(avg),
      };
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[SCORM Package] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch SCORM package' }, { status: 500 });
  }
}

// ─── DELETE: remove a package ───

export async function DELETE(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');
    const userId = authResult.user.id;

    if (!packageId || !UUID_REGEX.test(packageId)) {
      return NextResponse.json({ success: false, error: 'packageId is required' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const { pkg, access } = await loadPackageWithAccess(
      packageId,
      userId,
      role,
      'id, uploaded_by, subject_id, status, storage_path',
    );
    if (!pkg) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });

    if (!access.canManage) {
      const message = pkg.subject_id === null
        ? 'Only admins can delete platform-level SCORM packages'
        : 'You do not have permission to delete this package';
      return NextResponse.json({ success: false, error: message }, { status: 403 });
    }

    // Child rows first (tracking, resources, subject links), then the stored ZIP, then the package
    await supabaseServer.from('scorm_tracking').delete().eq('package_id', packageId);
    await supabaseServer.from('scorm_resources').delete().eq('package_id', packageId);
    await supabaseServer.from('scorm_package_subjects').delete().eq('package_id', packageId);

    const { error: deleteError } = await supabaseServer.from('scorm_packages').delete().eq('id', packageId);
    if (deleteError) {
      console.error('[SCORM Package] Delete error:', deleteError.message);
      return NextResponse.json({ success: false, error: 'Failed to delete SCORM package' }, { status: 500 });
    }

    // Only after the record is gone, so a failed delete never leaves a package without its file
    try {
      await supabaseServer.storage.from('scorm-packages').remove([pkg.storage_path as string]);
    } catch (e) {
      console.error('[SCORM Package] Storage file removal error:', e);
    }

    return NextResponse.json({ success: true, message: 'SCORM package deleted successfully' });
  } catch (error) {
    console.error('[SCORM Package] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete SCORM package' }, { status: 500 });
  }
}

// ─── PATCH: update metadata ───

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
    const userId = authResult.user.id;

    if (!packageId || !UUID_REGEX.test(packageId)) {
      return NextResponse.json({ success: false, error: 'packageId is required' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const { pkg, access } = await loadPackageWithAccess(packageId, userId, role);
    if (!pkg) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    if (!access.canManage) {
      return NextResponse.json({ success: false, error: 'You do not have permission to edit this package' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {};
    if (typeof title === 'string' && title.trim()) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description === null ? null : String(description);
    if (status) {
      if (!['active', 'draft', 'archived'].includes(status)) {
        return NextResponse.json({ success: false, error: `Invalid status: ${status}` }, { status: 400 });
      }
      updateData.status = status;
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabaseServer
      .from('scorm_packages')
      .update(updateData)
      .eq('id', packageId)
      .select('id, title, description, version, entry_point, total_objects, package_size, status, uploaded_by, subject_id, created_at, updated_at')
      .single();
    if (updateError) {
      console.error('[SCORM Package] Update error:', updateError.message);
      return NextResponse.json({ success: false, error: 'Failed to update SCORM package' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[SCORM Package] PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update SCORM package' }, { status: 500 });
  }
}
