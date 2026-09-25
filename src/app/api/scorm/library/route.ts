import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * GET /api/scorm/library
 *
 * List platform-level SCORM packages (subject_id IS NULL).
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
    const isStudent = role === 'student';

    if (isStudent) {
      return NextResponse.json(
        { success: false, error: 'Students cannot access the SCORM library directly' },
        { status: 403 },
      );
    }

    // Fetch platform-level packages (subject_id IS NULL)
    const { data: packages, error: pkgError } = await supabaseServer
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
        is_platform_library,
        created_at,
        updated_at
      `)
      .is('subject_id', null)
      .order('created_at', { ascending: false });

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

    // For teachers (non-admin), filter visible links to subjects they own
    const isAdmin = role === 'admin' || role === 'superadmin';
    let teacherSubjectIds: Set<string> | null = null;
    if (!isAdmin) {
      const { data: ownedSubjects } = await supabaseServer
        .from('subjects')
        .select('id')
        .eq('teacher_id', userId);
      const { data: coTaught } = await supabaseServer
        .from('subject_teachers')
        .select('subject_id')
        .eq('teacher_id', userId);
      teacherSubjectIds = new Set([
        ...((ownedSubjects || []).map((s: any) => s.id)),
        ...((coTaught || []).map((s: any) => s.subject_id)),
      ]);
    }

    const enrichedPackages = packages.map((pkg: any) => {
      const linkedSubjects = linksByPackage.get(pkg.id) || [];
      // For teachers: only show their linked subjects (still see the package itself)
      const visibleLinks = isAdmin
        ? linkedSubjects
        : linkedSubjects.filter((ls) => teacherSubjectIds?.has(ls.id));

      return {
        ...pkg,
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
