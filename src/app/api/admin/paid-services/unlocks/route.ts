import { NextRequest, NextResponse } from 'next/server';
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

  const { userId, sectionKey, planType, durationDays } = body as {
    userId?: string;
    sectionKey?: string;
    planType?: 'monthly' | 'yearly' | 'manual_trial';
    durationDays?: number;
  };

  if (!userId || !sectionKey || !planType) {
    return NextResponse.json({ error: 'userId + sectionKey + planType مطلوبة' }, { status: 400 });
  }

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
