import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * GET /api/scorm/library
 *
 * List shared platform packages and authorized course uploads.
 * - Admins/superadmins: can see and manage all packages
 * - Teachers: can see packages (read-only) and link them to their subjects
 * - Students: 403 (they access via subject course pages)
 *
 * Returns packages with linked_subjects[] (subjects linked via junction table).
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const userId = authResult.user.id;
    const role = await getUserRole(userId);
    const isAdmin = role === 'admin' || role === 'superadmin';
    const isStudent = !isAdmin && role !== 'teacher';

    if (isStudent) {
      return NextResponse.json(
        { success: false, error: 'Students cannot access the SCORM library directly' },
        { status: 403 },
      );
    }

    // Include course uploads, but never expose another teacher's private packages.
    let teacherSubjectIds: Set<string> | null = null;
    let linkedPackageIds: string[] = [];
    if (!isAdmin) {
      const { data: owned, error: ownedError } = await supabaseServer.from('subjects').select('id').eq('teacher_id', userId);
      const { data: co, error: coError } = await supabaseServer.from('subject_teachers').select('subject_id').eq('teacher_id', userId);
      if (ownedError || coError) throw new Error('Could not resolve teacher subjects');
      teacherSubjectIds = new Set([...(owned || []).map(s => s.id), ...(co || []).map(s => s.subject_id)]);
      if (teacherSubjectIds.size) {
        const { data: linked, error } = await supabaseServer.from('scorm_package_subjects').select('package_id').in('subject_id', [...teacherSubjectIds]);
        if (error) throw new Error('Could not resolve linked packages');
        linkedPackageIds = [...new Set((linked || []).map(l => l.package_id))];
      }
    }
    let query = supabaseServer
      .from('scorm_packages')
      .select(`
        id,
        title,
        description,
        version,
        entry_point,
        total_objects,
        package_size,
        storage_path,
        status,
        uploaded_by,
        subject_id,
        created_at,
        updated_at,
        subject:subjects(id, name, color)
      `)
      .order('created_at', { ascending: false });
    if (!isAdmin) {
      const filters = ['subject_id.is.null', `uploaded_by.eq.${userId}`];
      if (teacherSubjectIds?.size) filters.push(`subject_id.in.(${[...teacherSubjectIds].join(',')})`);
      if (linkedPackageIds.length) filters.push(`id.in.(${linkedPackageIds.join(',')})`);
      query = query.or(filters.join(','));
    }
    const { data: packages, error: pkgError } = await query;

    if (pkgError) {
      console.error('[SCORM Library] Fetch error:', pkgError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch SCORM library packages' },
        { status: 500 },
      );
    }

    if (!packages || packages.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Fetch linked subjects for each package
    const packageIds = packages.map((p: { id: string }) => p.id);
    const { data: links, error: linksError } = await supabaseServer
      .from('scorm_package_subjects')
      .select(`
        package_id,
        subject_id,
        linked_by,
        created_at,
        subject:subjects(id, name, color)
      `)
      .in('package_id', packageIds);

    if (linksError) {
      console.error('[SCORM Library] Links fetch error:', linksError.message);
    }

    // Group links by package_id
    const linksByPackage = new Map<string, any[]>();
    for (const link of links || []) {
      const pid = (link as any).package_id;
      if (!linksByPackage.has(pid)) linksByPackage.set(pid, []);
      const subject = (link as any).subject;
      linksByPackage.get(pid)!.push({
        id: subject?.id,
        name: subject?.name,
        color: subject?.color || null,
        linked_by: (link as any).linked_by,
        linked_at: (link as any).created_at,
      });
    }

    // Fetch uploader names
    const uploaderIds = [...new Set(packages.map((p: { uploaded_by: string }) => p.uploaded_by))];
    const { data: uploaders } = await supabaseServer
      .from('users')
      .select('id, name')
      .in('id', uploaderIds);
    const uploaderMap = new Map<string, string>();
    for (const u of uploaders || []) {
      uploaderMap.set((u as any).id, (u as any).name);
    }

    const enrichedPackages = packages.map((pkg: any) => {
      const linkedSubjects = [...(linksByPackage.get(pkg.id) || [])];
      if (pkg.subject && !linkedSubjects.some(s => s.id === pkg.subject_id)) {
        linkedSubjects.unshift({ ...pkg.subject, is_primary: true });
      }
      // For teachers: only show their linked subjects (still see the package itself)
      const visibleLinks = isAdmin
        ? linkedSubjects
        : linkedSubjects.filter((ls) => teacherSubjectIds?.has(ls.id));

      return {
        ...pkg,
        // A linked teacher may not teach the package's original private course.
        subject: isAdmin || teacherSubjectIds?.has(pkg.subject_id) ? pkg.subject : null,
        uploader_name: uploaderMap.get(pkg.uploaded_by) || 'Unknown',
        linked_subjects: visibleLinks,
        linked_subject_ids: visibleLinks.map((ls) => ls.id),
      };
    });

    return NextResponse.json({ success: true, data: enrichedPackages });
  } catch (error) {
    console.error('[SCORM Library] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch SCORM library' },
      { status: 500 },
    );
  }
}
