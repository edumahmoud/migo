import { NextRequest, NextResponse } from 'next/server';
import { getFreeQuota } from '@/lib/storage-usage';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/paid-services/unlocks
 *   Returns all active user_section_unlocks with user info.
 *
 * POST /api/admin/paid-services/unlocks
 *   Manually grant an unlock to a user (without a request).
 *   Body: { userId, sectionKey, planType: 'monthly'|'yearly'|'manual_trial', durationDays? }
 *
 * DELETE /api/admin/paid-services/unlocks
 *   Revoke an unlock. Body: { unlockId }
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data: unlocks, error } = await supabaseServer
    .from('user_section_unlocks')
    .select(`
      id, user_id, section_key, plan_type, started_at, expires_at,
      activation_method, is_active, created_at,
      user:users!user_id(name, email, role)
    `)
    .eq('is_active', true)
    .order('expires_at', { ascending: false });

  if (error) {
    console.error('[paid-services/unlocks] GET error:', error);
    return NextResponse.json({ error: 'فشل جلب التفعيلات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, unlocks: unlocks ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { userId, sectionKey, planType, durationDays, storageTotalMb } = body as {
    userId?: string;
    storageTotalMb?: number;
    sectionKey?: string;
    planType?: 'monthly' | 'yearly' | 'manual_trial';
    durationDays?: number;
  };

  if (!userId || !sectionKey || !planType) {
    return NextResponse.json({ error: 'userId + sectionKey + planType مطلوبة' }, { status: 400 });
  }

  if (!['monthly', 'yearly', 'manual_trial'].includes(planType)) {
    return NextResponse.json({ error: 'نوع الخطة غير صالح' }, { status: 400 });
  }
  if (durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3660)) {
    return NextResponse.json({ error: 'مدة التفعيل غير صالحة' }, { status: 400 });
  }
  const { data: target } = await supabaseServer.from('users').select('role').eq('id', userId).maybeSingle();
  if (!target || (target.role !== 'student' && target.role !== 'teacher')) {
    return NextResponse.json({ error: 'المستخدم غير موجود أو ليس طالباً/معلماً' }, { status: 400 });
  }
  // ─── Storage: the admin enters the FINAL TOTAL space for the user (MB). ───
  // The purchased part is total minus the user's base quota, so the user ends with exactly the total.
  if (sectionKey === 'files') {
    const totalMb = Number(storageTotalMb);
    if (!Number.isInteger(totalMb) || totalMb < 1 || totalMb > 10485760) {
      return NextResponse.json({ error: 'اكتب إجمالي المساحة النهائي بالميجا' }, { status: 400 });
    }
    const baseMb = await getFreeQuota(target.role as 'student' | 'teacher');
    if (totalMb <= baseMb) {
      return NextResponse.json({ error: `الإجمالي لازم يكون أكبر من المساحة الأساسية (${baseMb} ميجا)` }, { status: 400 });
    }
    const sDays = durationDays ?? (planType === 'yearly' ? 365 : planType === 'monthly' ? 30 : 7);
    const sExpires = new Date(Date.now() + sDays * 24 * 60 * 60 * 1000).toISOString();
    // Only one active upgrade per user, as when a request is approved.
    await supabaseServer.from('user_storage_upgrades').update({ is_active: false }).eq('user_id', userId).eq('is_active', true);
    const { error: upErr } = await supabaseServer.from('user_storage_upgrades').insert({
      user_id: userId,
      plan_id: null,
      size_mb: totalMb - baseMb,
      price: 0,
      currency: 'EGP',
      is_active: true,
      duration_type: planType === 'yearly' ? 'yearly' : 'monthly',
      expires_at: sExpires,
    });
    if (upErr) {
      console.error('[paid-services/unlocks] storage upgrade insert error:', upErr);
      return NextResponse.json({ error: 'فشل تفعيل مساحة التخزين' }, { status: 500 });
    }
    return NextResponse.json({ success: true, expiresAt: sExpires, totalMb, baseMb });
  }

  const { data: sec } = await supabaseServer.from('locked_sections_config').select('section_key').eq('section_key', sectionKey).maybeSingle();
  if (!sec) return NextResponse.json({ error: 'القسم غير موجود' }, { status: 400 });

  const days = durationDays ?? (planType === 'yearly' ? 365 : planType === 'monthly' ? 30 : 7);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  // Deactivate existing active unlock.
  await supabaseServer
    .from('user_section_unlocks')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('section_key', sectionKey)
    .eq('is_active', true);

  const { error } = await supabaseServer
    .from('user_section_unlocks')
    .insert({
      user_id: userId,
      section_key: sectionKey,
      plan_type: planType,
      started_at: now,
      expires_at: expiresAt,
      activation_method: 'manual',
      is_active: true,
    });

  if (error) {
    console.error('[paid-services/unlocks] insert error:', error);
    return NextResponse.json({ error: 'فشل إنشاء التفعيل' }, { status: 500 });
  }

  return NextResponse.json({ success: true, expiresAt });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { unlockId } = body as { unlockId?: string };
  if (!unlockId) {
    return NextResponse.json({ error: 'unlockId مطلوب' }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from('user_section_unlocks')
    .update({ is_active: false })
    .eq('id', unlockId);

  if (error) {
    return NextResponse.json({ error: 'فشل إلغاء التفعيل' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
