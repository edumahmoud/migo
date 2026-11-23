import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { loadPackageWithAccess, UUID_REGEX } from '@/lib/scorm-access';
import { CONTENT_TOKEN_TTL_SECONDS, signContentToken } from '@/lib/scorm-content';
import { buildCmiData } from '@/lib/scorm-cmi';

// ─── GET: launch data for one SCO ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const packageId = searchParams.get('packageId');
    const resourceId = searchParams.get('resourceId');
    const userId = authResult.user.id;

    if (!packageId || !resourceId || !UUID_REGEX.test(packageId) || !UUID_REGEX.test(resourceId)) {
      return NextResponse.json({ success: false, error: 'packageId and resourceId are required' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const { pkg, access } = await loadPackageWithAccess(
      packageId,
      userId,
      role,
      'id, title, version, entry_point, storage_path, subject_id, uploaded_by, status',
    );
    if (!pkg) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    if (!access.canView) {
      return NextResponse.json(
        { success: false, error: access.isStudent || role === 'student' ? 'You are not enrolled in this subject' : 'Access denied' },
        { status: 403 },
      );
    }
    if (pkg.status !== 'active' && !access.canManage) {
      return NextResponse.json({ success: false, error: 'Package is not active' }, { status: 400 });
    }

    const { data: resource } = await supabaseServer
      .from('scorm_resources')
      .select('id, identifier, title, type, href, scorm_type, launch_url')
      .eq('id', resourceId)
      .eq('package_id', packageId)
      .maybeSingle();
    if (!resource) return NextResponse.json({ success: false, error: 'Resource not found in this package' }, { status: 404 });
    if (resource.scorm_type === 'organization' || !(resource.launch_url || resource.href)) {
      return NextResponse.json({ success: false, error: 'This item has no launchable content' }, { status: 400 });
    }

    // ── Tracking: students only (teacher previews never touch student data) ──
    let tracking: Record<string, unknown> | null = null;
    if (access.isStudent) {
      const { data: existing } = await supabaseServer
        .from('scorm_tracking')
        .select('*')
        .eq('student_id', userId)
        .eq('resource_id', resourceId)
        .maybeSingle();

      const { data: saved, error: saveError } = await supabaseServer
        .from('scorm_tracking')
        .upsert(
          {
            student_id: userId,
            package_id: packageId,
            resource_id: resourceId,
            launch_count: ((existing?.launch_count as number | undefined) ?? 0) + 1,
            session_time: '00:00:00',
            last_accessed: new Date().toISOString(),
          },
          { onConflict: 'student_id,resource_id' },
        )
        .select()
        .single();
      if (saveError) console.error('[SCORM Launch] Tracking save error:', saveError.message);
      tracking = saved || existing || null;
    }

    const { data: learner } = await supabaseServer.from('users').select('name').eq('id', userId).maybeSingle();

    // ── Launch URL: same-origin content route with a signed, expiring token ──
    const rawLaunch = (resource.launch_url || resource.href || pkg.entry_point) as string;
    let launchUrl: string;
    if (/^https?:\/\//i.test(rawLaunch)) {
      launchUrl = rawLaunch;
    } else {
      const token = signContentToken({
        p: packageId,
        u: userId,
        e: Math.floor(Date.now() / 1000) + CONTENT_TOKEN_TTL_SECONDS,
        m: access.canManage ? 1 : 0,
        r: resourceId,
        t: access.isStudent ? 1 : 0,
      });
      const path = rawLaunch.replace(/^\/+/, '');
      const [file, ...rest] = path.split(/(?=[?#])/);
      const suffix = rest.join('');
      launchUrl = `/api/scorm/content/${token}/${file.split('/').map(encodeURIComponent).join('/')}${suffix}`;
    }

    const version = pkg.version as string;
    return NextResponse.json({
      success: true,
      data: {
        launchUrl,
        packageVersion: version,
        packageTitle: pkg.title,
        resourceTitle: resource.title,
        resourceType: resource.type,
        isPreview: !access.isStudent,
        trackingData: tracking,
        cmiData: buildCmiData(version, tracking, learner?.name || '', userId, !access.isStudent),
      },
    });
  } catch (error) {
    console.error('[SCORM Launch] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to prepare SCORM launch data' }, { status: 500 });
  }
}
