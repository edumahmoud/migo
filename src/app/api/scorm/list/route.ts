import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// ─── GET Handler: List SCORM packages for a subject ───

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get('subjectId');

    if (!subjectId) {
      return NextResponse.json(
        { success: false, error: 'subjectId is required' },
        { status: 400 }
      );
    }

    // ── Fetch all SCORM packages for the subject ──
    const { data: packages, error: packagesError } = await supabaseServer
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
        updated_at
      `)
      .eq('subject_id', subjectId)
      .order('created_at', { ascending: false });

    if (packagesError) {
      console.error('[SCORM List] Packages fetch error:', packagesError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch SCORM packages' },
        { status: 500 }
      );
    }

    if (!packages || packages.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    // ── Fetch resources for all packages ──
    const packageIds = packages.map((p: { id: string }) => p.id);

    const { data: resources, error: resourcesError } = await supabaseServer
      .from('scorm_resources')
      .select(`
        id,
        package_id,
        identifier,
        title,
        type,
        href,
        scorm_type,
        parent_identifier,
        order_index,
        launch_url
      `)
      .in('package_id', packageIds)
      .order('order_index', { ascending: true });

    if (resourcesError) {
      console.error('[SCORM List] Resources fetch error:', resourcesError.message);
      // Still return packages without resources
    }

    // ── Fetch uploader names ──
    const uploaderIds = [...new Set(packages.map((p: { uploaded_by: string }) => p.uploaded_by))];

    const { data: uploaders } = await supabaseServer
      .from('users')
      .select('id, full_name')
      .in('id', uploaderIds);

    // ── Organize resources by package ──
    const resourcesByPackage = new Map<string, Array<Record<string, unknown>>>();

    if (resources) {
      for (const resource of resources) {
        const pkgId = resource.package_id;
        if (!resourcesByPackage.has(pkgId)) {
          resourcesByPackage.set(pkgId, []);
        }
        resourcesByPackage.get(pkgId)!.push(resource);
      }
    }

    // ── Build organized response ──
    // Build a tree structure for resources based on parent_identifier
    const enrichedPackages = packages.map((pkg: Record<string, unknown>) => {
      const packageResources = resourcesByPackage.get(pkg.id as string) || [];
      const organizedResources = organizeResourceTree(packageResources);
      const uploader = uploaders?.find((u: Record<string, unknown>) => u.id === pkg.uploaded_by);

      return {
        ...pkg,
        uploader_name: uploader?.full_name || 'Unknown',
        resources: organizedResources,
      };
    });

    return NextResponse.json({
      success: true,
      data: enrichedPackages,
    });
  } catch (error) {
    console.error('[SCORM List] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch SCORM packages' },
      { status: 500 }
    );
  }
}

/**
 * Organize resources into a tree structure based on parent_identifier.
 * Root resources have no parent; child resources are nested under their parent.
 */
function organizeResourceTree(
  resources: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  // Separate root items (no parent) and children
  const rootItems: Array<Record<string, unknown>> = [];
  const childrenByParent = new Map<string, Array<Record<string, unknown>>>();

  for (const resource of resources) {
    const parentIdentifier = resource.parent_identifier as string | null;
    if (!parentIdentifier) {
      rootItems.push({ ...resource, children: [] });
    } else {
      if (!childrenByParent.has(parentIdentifier)) {
        childrenByParent.set(parentIdentifier, []);
      }
      childrenByParent.get(parentIdentifier)!.push(resource);
    }
  }

  // Attach children to their parents
  for (const rootItem of rootItems) {
    const identifier = rootItem.identifier as string;
    const children = childrenByParent.get(identifier) || [];
    rootItem.children = organizeResourceTree(children);
  }

  return rootItems;
}
