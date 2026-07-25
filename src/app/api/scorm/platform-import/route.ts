import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import JSZip from 'jszip';
import type { ScormVersion } from '@/lib/scorm-types';

// ─── Route Config ───
export const maxDuration = 120;

// ─── Types ───

interface ParsedManifestItem {
  identifier: string;
  title: string;
  parentIdentifier: string | null;
  orderIndex: number;
}

interface ParsedManifestResource {
  identifier: string;
  href: string;
  scormType: string;
}

interface ParsedManifest {
  items: ParsedManifestItem[];
  resources: ParsedManifestResource[];
  entryPoint: string;
  totalScos: number;
}

// ─── POST Handler: Platform-level SCORM import ───
// Imports an external SCORM package to create a new subject (course) on the platform.
// The uploaded ZIP is parsed, a new subject is created, and lessons are created from SCOs.

export async function POST(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const userId = authResult.user.id;

  try {
    // ── Parse FormData ──
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const subjectName = formData.get('name') as string | null;
    const subjectDescription = formData.get('description') as string | null;
    const versionParam = formData.get('version') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'A ZIP file is required' },
        { status: 400 }
      );
    }

    if (!subjectName || subjectName.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Subject name is required' },
        { status: 400 }
      );
    }

    const scormVersion: ScormVersion =
      versionParam === '2004' ? '2004' : '1.2';

    // ── Validate file type ──
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json(
        { success: false, error: 'Only ZIP files are accepted' },
        { status: 400 }
      );
    }

    // ── Read ZIP into buffer ──
    const arrayBuffer = await file.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);

    // ── Parse ZIP with JSZip ──
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipBuffer);
    } catch (zipError) {
      console.error('[SCORM Platform Import] Failed to parse ZIP:', zipError);
      return NextResponse.json(
        { success: false, error: 'Invalid or corrupted ZIP file' },
        { status: 400 }
      );
    }

    // ── Find and read imsmanifest.xml ──
    const manifestFile = zip.file('imsmanifest.xml');
    if (!manifestFile) {
      return NextResponse.json(
        {
          success: false,
          error:
            'imsmanifest.xml not found in the ZIP root. Ensure this is a valid SCORM package.',
        },
        { status: 400 }
      );
    }

    let manifestXml: string;
    try {
      manifestXml = await manifestFile.async('string');
    } catch (readError) {
      console.error(
        '[SCORM Platform Import] Failed to read imsmanifest.xml:',
        readError
      );
      return NextResponse.json(
        { success: false, error: 'Failed to read imsmanifest.xml from the ZIP' },
        { status: 400 }
      );
    }

    if (!manifestXml || manifestXml.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'imsmanifest.xml is empty' },
        { status: 400 }
      );
    }

    // ── Parse the manifest ──
    const parsedManifest = parseManifest(manifestXml, scormVersion);

    if (parsedManifest.items.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No SCORM items found in the manifest. The package may be empty or malformed.',
        },
        { status: 400 }
      );
    }

    // ── Create the subject ──
    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .insert({
        teacher_id: userId,
        name: subjectName.trim(),
        description: subjectDescription?.trim() || null,
        educational_level: 'university',
        code: `SCORM_${Date.now()}`,
      })
      .select()
      .single();

    if (subjectError || !subject) {
      console.error(
        '[SCORM Platform Import] Subject creation error:',
        subjectError?.message
      );
      return NextResponse.json(
        { success: false, error: 'Failed to create subject: ' + (subjectError?.message || 'Unknown error') },
        { status: 500 }
      );
    }

    // ── Upload the ZIP to Supabase Storage ──
    const timestamp = Date.now();
    const storagePath = `scorm-packages/${subject.id}/${timestamp}_${file.name}`;

    const { data: storageData, error: storageError } = await supabaseServer.storage
      .from('scorm-packages')
      .upload(storagePath, zipBuffer, { contentType: 'application/zip' });

    if (storageError) {
      console.error(
        '[SCORM Platform Import] Storage upload error:',
        storageError.message
      );
      // Attempt to clean up the created subject
      await supabaseServer.from('subjects').delete().eq('id', subject.id);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to upload SCORM package to storage: ' + storageError.message,
        },
        { status: 500 }
      );
    }

    // ── Create lesson records from manifest items ──
    const lessonRows = parsedManifest.items.map((item, index) => ({
      subject_id: subject.id,
      title: item.title,
      content_html: `<div class="scorm-imported-lesson"><p>This lesson was imported from a SCORM package. Launch it via the SCORM player to view the original content.</p></div>`,
      status: 'draft',
      order_index: index,
    }));

    const { data: lessons, error: lessonsError } = await supabaseServer
      .from('lessons')
      .insert(lessonRows)
      .select();

    if (lessonsError) {
      console.error(
        '[SCORM Platform Import] Lessons creation error:',
        lessonsError.message
      );
      // Continue — lessons are not critical to the whole import
    }

    // ── Create scorm_packages record ──
    const packageDescription = subjectDescription?.trim() || `SCORM ${scormVersion} package imported for subject: ${subjectName.trim()}`;

    const { data: packageData, error: packageError } = await supabaseServer
      .from('scorm_packages')
      .insert({
        title: subjectName.trim(),
        description: packageDescription,
        version: scormVersion,
        manifest_xml: manifestXml,
        uploaded_by: userId,
        subject_id: subject.id,
        status: 'active',
        entry_point: parsedManifest.entryPoint,
        total_objects: parsedManifest.totalScos,
        package_size: zipBuffer.byteLength,
        storage_path: storagePath,
      })
      .select()
      .single();

    if (packageError || !packageData) {
      console.error(
        '[SCORM Platform Import] Package record creation error:',
        packageError?.message
      );
      // Clean up: remove uploaded file and subject
      await supabaseServer.storage.from('scorm-packages').remove([storagePath]);
      await supabaseServer.from('subjects').delete().eq('id', subject.id);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create SCORM package record: ' + (packageError?.message || 'Unknown error'),
        },
        { status: 500 }
      );
    }

    // ── Create scorm_resources records ──
    const resourceRows = parsedManifest.items.map((item, index) => {
      // Find the matching resource for this item
      const matchingResource = parsedManifest.resources.find(
        (r) => r.identifier === item.identifier
      );
      const resourceHref = matchingResource?.href || '';

      return {
        package_id: packageData.id,
        identifier: item.identifier,
        title: item.title,
        type: 'sco' as const,
        href: resourceHref,
        scorm_type: matchingResource?.scormType || 'sco',
        parent_identifier: item.parentIdentifier || null,
        order_index: index,
        launch_url: resourceHref,
      };
    });

    const { data: resources, error: resourcesError } = await supabaseServer
      .from('scorm_resources')
      .insert(resourceRows)
      .select();

    if (resourcesError) {
      console.error(
        '[SCORM Platform Import] Resources creation error:',
        resourcesError.message
      );
      // Non-critical — resources can be recreated, so we continue
    }

    // ── Return success response ──
    return NextResponse.json({
      success: true,
      data: {
        subject,
        lessons: lessons || [],
        package: packageData,
        resources: resources || [],
      },
    });
  } catch (error) {
    console.error('[SCORM Platform Import] POST error:', error);
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json(
      { success: false, error: 'Platform SCORM import failed: ' + message },
      { status: 500 }
    );
  }
}

// ─── Manifest Parser ───
// Uses regex-based extraction since no XML parser is available.
// Handles both SCORM 1.2 and SCORM 2004 formats.

function parseManifest(
  manifestXml: string,
  scormVersion: ScormVersion
): ParsedManifest {
  const items: ParsedManifestItem[] = [];
  const resources: ParsedManifestResource[] = [];

  // ── Extract <item> elements ──
  // Match <item ...>...</item> blocks (including nested items)
  // We use a flat extraction approach: find all <item> tags with their attributes
  const itemRegex = /<item\s+([^>]*?)>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null;
  let itemIndex = 0;

  while ((itemMatch = itemRegex.exec(manifestXml)) !== null) {
    const attributes = itemMatch[1];
    const innerContent = itemMatch[2];

    // Extract identifier from attributes
    const identifierMatch = attributes.match(/identifier\s*=\s*"([^"]+)"/i);
    const identifier = identifierMatch ? identifierMatch[1] : `item_${itemIndex}`;

    // Extract title from inner content (first <title> inside the item)
    const titleMatch = innerContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : `Untitled Item ${itemIndex + 1}`;

    // Extract identifierref (reference to a resource) from attributes
    const identifierRefMatch = attributes.match(/identifierref\s*=\s*"([^"]+)"/i);
    const identifierRef = identifierRefMatch ? identifierRefMatch[1] : '';

    // Determine parent: check if this item is nested inside another item
    // We look at the content before this match to count open/close item tags
    const contentBefore = manifestXml.substring(0, itemMatch.index);
    const parentIdentifier = findParentIdentifier(contentBefore, manifestXml);

    // Only add items that have an identifierref (leaf items that reference resources)
    // These are the actual SCOs; folder items without identifierref are organizational
    if (identifierRef) {
      items.push({
        identifier: identifierRef, // Use the resource reference as the identifier
        title,
        parentIdentifier,
        orderIndex: itemIndex,
      });
      itemIndex++;
    } else {
      // Organizational item (folder) — still track it for parent-child resolution
      // but we don't add it as a lesson
    }
  }

  // ── Fallback: if no items with identifierref were found, try simpler extraction ──
  if (items.length === 0) {
    // Try to find all <item> tags with just identifier and title
    const simpleItemRegex = /<item\s+identifier\s*=\s*"([^"]+)"[^>]*>/gi;
    let simpleMatch: RegExpExecArray | null;
    let simpleIndex = 0;

    while ((simpleMatch = simpleItemRegex.exec(manifestXml)) !== null) {
      const itemId = simpleMatch[1];

      // Find the title that follows this item
      const afterItem = manifestXml.substring(simpleMatch.index);
      const titleInItem = afterItem.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const itemTitle = titleInItem ? titleInItem[1].trim() : `SCO ${simpleIndex + 1}`;

      items.push({
        identifier: itemId,
        title: itemTitle,
        parentIdentifier: null,
        orderIndex: simpleIndex,
      });
      simpleIndex++;
    }
  }

  // ── Extract <resource> elements ──
  const resourceRegex = /<resource\s+([^>]*?)>([\s\S]*?)<\/resource>/gi;
  let resourceMatch: RegExpExecArray | null;

  while ((resourceMatch = resourceRegex.exec(manifestXml)) !== null) {
    const attributes = resourceMatch[1];

    // Extract identifier
    const resIdMatch = attributes.match(/identifier\s*=\s*"([^"]+)"/i);
    const resIdentifier = resIdMatch ? resIdMatch[1] : '';

    // Extract href
    const hrefMatch = attributes.match(/href\s*=\s*"([^"]+)"/i);
    const href = hrefMatch ? hrefMatch[1] : '';

    // Extract SCORM type (adlcp:scormType for SCORM 2004, or type attribute)
    let scormType = 'sco';
    const scormTypeMatch = attributes.match(
      /(?:adlcp:)?scormType\s*=\s*"([^"]+)"/i
    );
    const typeMatch = attributes.match(/type\s*=\s*"([^"]+)"/i);

    if (scormTypeMatch) {
      scormType = scormTypeMatch[1].toLowerCase();
    } else if (typeMatch) {
      scormType = typeMatch[1].toLowerCase();
    }

    // Determine if it's a 'sco' or 'asset' based on the type
    if (scormType.includes('sco')) {
      scormType = 'sco';
    } else if (scormType.includes('asset')) {
      scormType = 'asset';
    }

    if (resIdentifier) {
      resources.push({
        identifier: resIdentifier,
        href,
        scormType,
      });
    }
  }

  // ── Determine entry point ──
  // The entry point is the href of the first resource referenced by the first item,
  // or the default resource if no items are found
  let entryPoint = '';

  if (items.length > 0 && resources.length > 0) {
    const firstResource = resources.find(
      (r) => r.identifier === items[0].identifier
    );
    entryPoint = firstResource?.href || resources[0].href || '';
  } else if (resources.length > 0) {
    entryPoint = resources[0].href || '';
  }

  // ── Count total SCOs ──
  const totalScos = items.length > 0
    ? items.length
    : resources.filter((r) => r.scormType === 'sco').length || resources.length;

  // ── Re-map parent identifiers for items ──
  // Items that reference organizational items should have their parent set
  // For now, we keep the simple parent resolution from findParentIdentifier
  // which may be null for top-level items

  return {
    items,
    resources,
    entryPoint,
    totalScos,
  };
}

/**
 * Attempt to find the parent item identifier by analyzing the XML structure
 * before the current item's position. We look at the nesting of <item> tags
 * to determine which parent item this one belongs to.
 */
function findParentIdentifier(
  contentBefore: string,
  _fullManifest: string
): string | null {
  // Count open and closed item tags to determine nesting depth
  const openItems: Array<{ index: number; identifier: string }> = [];

  // Find all <item> opening tags with their identifiers
  const itemOpenRegex = /<item\s+identifier\s*=\s*"([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemOpenRegex.exec(contentBefore)) !== null) {
    openItems.push({
      index: match.index,
      identifier: match[1],
    });
  }

  // Find all </item> closing tags
  const closeRegex = /<\/item>/gi;
  let closeMatch: RegExpExecArray | null;
  const closePositions: number[] = [];

  while ((closeMatch = closeRegex.exec(contentBefore)) !== null) {
    closePositions.push(closeMatch.index);
  }

  // Simulate a stack to determine current parent
  const stack: string[] = [];
  let openIdx = 0;
  let closeIdx = 0;

  // Merge and sort all events by position
  const events: Array<{ pos: number; type: 'open' | 'close'; identifier?: string }> = [];

  while (openIdx < openItems.length) {
    events.push({ pos: openItems[openIdx].index, type: 'open', identifier: openItems[openIdx].identifier });
    openIdx++;
  }

  for (const pos of closePositions) {
    events.push({ pos, type: 'close' });
  }

  events.sort((a, b) => a.pos - b.pos);

  for (const event of events) {
    if (event.type === 'open' && event.identifier) {
      stack.push(event.identifier);
    } else if (event.type === 'close' && stack.length > 0) {
      stack.pop();
    }
  }

  // The parent is the item currently on top of the stack
  // (the last item opened but not yet closed)
  return stack.length > 0 ? stack[stack.length - 1] : null;
}
