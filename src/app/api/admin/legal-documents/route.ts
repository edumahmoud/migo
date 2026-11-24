import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { DEFAULT_POLICY_MD } from '@/lib/legal-defaults';
import {
  POLICY_SLUGS, isPolicySlug, validateLegalMd, withUpdatedDate, validateContactEmail,
  CONTACT_EMAIL_PLACEHOLDER, DEFAULT_CONTACT_EMAIL,
} from '@/lib/legal';
import { getContactEmail } from '@/lib/legal-server';

/**
 * GET    /api/admin/legal-documents           -> all three policies (edited text or default)
 * GET    /api/admin/legal-documents?history=slug -> saved versions of one policy (newest first)
 * PUT    /api/admin/legal-documents           -> body { slug, content_md } saves the text and records a new version;
 *                                                body { contact_email } changes the contact email used everywhere
 * DELETE /api/admin/legal-documents?slug=...  -> removes the edit, back to the built-in default
 *
 * Authorization: superadmin only.
 */

const SETTINGS_MISSING = 'جدول legal_settings غير موجود بعد (migration v141)';
const TABLE_MISSING = 'جدول legal_documents غير موجود بعد (migration v140)';

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const history = request.nextUrl.searchParams.get('history');
  if (history) {
    if (!isPolicySlug(history)) {
      return NextResponse.json({ success: false, error: 'البيانات غير صالحة' }, { status: 400 });
    }
    const { data: versions, error: vErr } = await supabaseServer
      .from('legal_document_versions')
      .select('id, content_md, saved_by, saved_at')
      .eq('slug', history)
      .order('saved_at', { ascending: false })
      .limit(50);
    return NextResponse.json({ success: true, data: vErr ? [] : (versions ?? []), versions_ready: !vErr });
  }

  const { data, error } = await supabaseServer
    .from('legal_documents')
    .select('slug, content_md, updated_at');

  const rows = error ? [] : (data ?? []);
  const contactEmail = await getContactEmail();
  const result = POLICY_SLUGS.map((slug) => {
    const row = rows.find((r) => r.slug === slug);
    return {
      slug,
      // Older saved text may contain the literal default email: show it as the placeholder so it follows the setting.
      content_md: (((row?.content_md as string | undefined) ?? DEFAULT_POLICY_MD[slug]) as string)
        .split(DEFAULT_CONTACT_EMAIL).join(CONTACT_EMAIL_PLACEHOLDER),
      is_custom: !!row,
      updated_at: (row?.updated_at as string | undefined) ?? null,
    };
  });
  return NextResponse.json({ success: true, data: result, table_ready: !error, contact_email: contactEmail });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: { slug?: unknown; content_md?: unknown; contact_email?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  if (body.contact_email !== undefined) {
    const emailProblem = validateContactEmail(body.contact_email);
    if (emailProblem) return NextResponse.json({ success: false, error: emailProblem }, { status: 400 });
    const email = (body.contact_email as string).trim();
    const { error: setErr } = await supabaseServer
      .from('legal_settings')
      .upsert(
        { key: 'contact_email', value: email, updated_by: auth.user.id, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    if (setErr) {
      const missing = setErr.code === '42P01' || /legal_settings/.test(setErr.message);
      return NextResponse.json({ success: false, error: missing ? SETTINGS_MISSING : setErr.message }, { status: 500 });
    }
    for (const s of POLICY_SLUGS) revalidatePath(`/${s}`);
    return NextResponse.json({ success: true, contact_email: email });
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

  // Keep every saved text as a version (history is never overwritten). Best effort until migration v141 is applied.
  const { error: verErr } = await supabaseServer
    .from('legal_document_versions')
    .insert({ slug: body.slug, content_md: content, saved_by: auth.user.id, saved_at: now.toISOString() });

  revalidatePath(`/${body.slug}`);
  return NextResponse.json({ success: true, content_md: content, version_recorded: !verErr });
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
