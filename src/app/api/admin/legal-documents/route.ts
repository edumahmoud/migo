import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { DEFAULT_POLICY_MD } from '@/lib/legal-defaults';
import { POLICY_SLUGS, isPolicySlug, validateLegalMd, withUpdatedDate } from '@/lib/legal';

/**
 * GET    /api/admin/legal-documents           -> all three policies (edited text or default)
 * PUT    /api/admin/legal-documents           -> body { slug, content_md }, saves the edited text
 * DELETE /api/admin/legal-documents?slug=...  -> removes the edit, back to the built-in default
 *
 * Authorization: superadmin only.
 */

const TABLE_MISSING = 'جدول legal_documents غير موجود بعد (migration v140)';

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data, error } = await supabaseServer
    .from('legal_documents')
    .select('slug, content_md, updated_at');

  const rows = error ? [] : (data ?? []);
  const result = POLICY_SLUGS.map((slug) => {
    const row = rows.find((r) => r.slug === slug);
    return {
      slug,
      content_md: (row?.content_md as string | undefined) ?? DEFAULT_POLICY_MD[slug],
      is_custom: !!row,
      updated_at: (row?.updated_at as string | undefined) ?? null,
    };
  });
  return NextResponse.json({ success: true, data: result, table_ready: !error });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: { slug?: unknown; content_md?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }
  if (!isPolicySlug(body.slug) || typeof body.content_md !== 'string') {
    return NextResponse.json({ success: false, error: 'البيانات غير صالحة' }, { status: 400 });
  }
  const problem = validateLegalMd(body.content_md);
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

  const now = new Date();
  const content = withUpdatedDate(body.content_md.replace(/\r\n/g, '\n').trim(), now) + '\n';

  const { error } = await supabaseServer
    .from('legal_documents')
    .upsert(
      { slug: body.slug, content_md: content, updated_by: auth.user.id, updated_at: now.toISOString() },
      { onConflict: 'slug' },
    );
  if (error) {
    const missing = error.code === '42P01' || /legal_documents/.test(error.message);
    return NextResponse.json({ success: false, error: missing ? TABLE_MISSING : error.message }, { status: 500 });
  }

  revalidatePath(`/${body.slug}`);
  return NextResponse.json({ success: true, content_md: content });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const slug = request.nextUrl.searchParams.get('slug');
  if (!isPolicySlug(slug)) {
    return NextResponse.json({ success: false, error: 'البيانات غير صالحة' }, { status: 400 });
  }
  const { error } = await supabaseServer.from('legal_documents').delete().eq('slug', slug);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  revalidatePath(`/${slug}`);
  return NextResponse.json({ success: true, content_md: DEFAULT_POLICY_MD[slug] });
}
