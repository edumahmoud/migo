import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { isEnrolled, isSubjectTeacher, UUID_REGEX } from '@/lib/scorm-access';
import { buildResourceTree } from '@/lib/scorm-manifest';

// ─── GET: SCORM packages visible in a subject (own + linked library packages) ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get('subjectId');
    const userId = authResult.user.id;

    if (!subjectId) {
      return NextResponse.json({ success: false, error: 'subjectId is required' }, { status: 400 });
    }
    // Validate as UUID: the value is interpolated into a PostgREST .or() filter below
    if (!UUID_REGEX.test(subjectId)) {
      return NextResponse.json({ success: false, error: 'Invalid subjectId format' }, { status: 400 });
    }

    // ── Who may see this subject's packages ──
    const role = await getUserRole(userId);
    const isAdmin = role === 'admin' || role === 'superadmin';
    const isStudent = role === 'student';
    if (!isAdmin) {
      const allowed = isStudent
        ? await isEnrolled(userId, subjectId)
        : role === 'teacher'
          ? await isSubjectTeacher(userId, subjectId)
          : false;
      if (!allowed) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const { data: linkedPackageIds } = await supabaseServer
      .from('scorm_package_subjects')
      .select('package_id')
      .eq('subject_id', subjectId);
    const linkedIds = (linkedPackageIds || []).map((r: { package_id: string }) => r.package_id);

    let pkgQuery = supabaseServer
      .from('scorm_packages')
      .select(
        'id, title, description, version, entry_point, total_objects, package_size, status, uploaded_by, subject_id, created_at, updated_at',
      );
    pkgQuery =
      linkedIds.length > 0
        ? pkgQuery.or(`subject_id.eq.${subjectId},id.in.(${linkedIds.join(',')})`)
        : pkgQuery.eq('subject_id', subjectId);
    // Students only see active packages
    if (isStudent) pkgQuery = pkgQuery.eq('status', 'active');

    const { data: packages, error: packagesError } = await pkgQuery.order('created_at', { ascending: false });
    if (packagesError) {
      console.error('[SCORM List] Packages fetch error:', packagesError.message);
      return NextResponse.json({ success: false, error: 'Failed to fetch SCORM packages' }, { status: 500 });
    }
    if (!packages || packages.length === 0) return NextResponse.json({ success: true, data: [] });

    const packageIds = packages.map((p: { id: string }) => p.id);
    const { data: resources, error: resourcesError } = await supabaseServer
      .from('scorm_resources')
      .select('id, package_id, identifier, title, type, href, scorm_type, parent_identifier, order_index, launch_url')
      .in('package_id', packageIds)
      .order('order_index', { ascending: true });
    if (resourcesError) console.error('[SCORM List] Resources fetch error:', resourcesError.message);

    const uploaderIds = [...new Set(packages.map((p: { uploaded_by: string }) => p.uploaded_by))];
    const { data: uploaders } = await supabaseServer.from('users').select('id, name').in('id', uploaderIds);
    const uploaderName = new Map((uploaders || []).map((u: { id: string; name: string }) => [u.id, u.name]));

    const byPackage = new Map<string, Array<Record<string, unknown> & { identifier: string; parent_identifier?: string | null }>>();
    for (const r of resources || []) {
      const list = byPackage.get(r.package_id) || [];
      list.push(r);
      byPackage.set(r.package_id, list);
    }

    const data = packages.map((pkg: Record<string, unknown>) => ({
      ...pkg,
      uploader_name: uploaderName.get(pkg.uploaded_by as string) || 'Unknown',
      resources: buildResourceTree(byPackage.get(pkg.id as string) || []),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[SCORM List] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch SCORM packages' }, { status: 500 });
  }
}
