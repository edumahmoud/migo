import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/paid-services/trial
 *   Returns all global_section_unlocks (active + expired).
 *
 * POST /api/admin/paid-services/trial
 *   Create a global trial unlock. Superadmin only.
 *   Body: { sectionKey, scope: 'all'|'new_users', durationDays }
 *
 * DELETE /api/admin/paid-services/trial
 *   Deactivate a trial. Body: { trialId }
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data: trials, error } = await supabaseServer
    .from('global_section_unlocks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'فشل جلب الفتح المؤقت' }, { status: 500 });
  }

  return NextResponse.json({ success: true, trials: trials ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'يتطلب صلاحية superadmin' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { sectionKey, scope, durationDays } = body as {
    sectionKey?: string;
    scope?: 'all' | 'new_users';
    durationDays?: number;
  };

  if (!sectionKey || !scope || !durationDays) {
    return NextResponse.json({ error: 'sectionKey + scope + durationDays مطلوبة' }, { status: 400 });
  }

  // Deactivate existing active trial for this section+scope.
  await supabaseServer
    .from('global_section_unlocks')
    .update({ is_active: false })
    .eq('section_key', sectionKey)
    .eq('scope', scope)
    .eq('is_active', true);

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseServer
    .from('global_section_unlocks')
    .insert({
      section_key: sectionKey,
      scope,
      duration_days: durationDays,
      started_at: now,
      expires_at: expiresAt,
      created_by: auth.user.id,
      is_active: true,
    });

  if (error) {
    console.error('[paid-services/trial] insert error:', error);
    return NextResponse.json({ error: 'فشل إنشاء الفتح المؤقت' }, { status: 500 });
  }

  return NextResponse.json({ success: true, expiresAt });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'يتطلب صلاحية superadmin' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { trialId } = body as { trialId?: string };
  if (!trialId) {
    return NextResponse.json({ error: 'trialId مطلوب' }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from('global_section_unlocks')
    .update({ is_active: false })
    .eq('id', trialId);

  if (error) {
    return NextResponse.json({ error: 'فشل إلغاء الفتح المؤقت' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
