import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { hashPassword, validateDestructPassword } from '@/lib/admin-security';

/**
 * POST /api/admin/destruct/set-password
 *
 * Sets or updates the destructive-action password. Requires superadmin.
 *
 * Body: { password: string }
 *
 * This is the FIRST step — the superadmin must set a destruct password
 * before they can access the data-management section.
 *
 * If a password is already set, this endpoint UPDATES it (the old
 * password is not required to change it — superadmin auth is the
 * gate, same as changing the institution settings).
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { password } = body as { password?: string };
  if (!password) {
    return NextResponse.json({ error: 'كلمة المرور مطلوبة' }, { status: 400 });
  }

  // Validate password strength.
  const validation = validateDestructPassword(password);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Hash the password.
  const hash = await hashPassword(password);

  // Upsert into admin_security (single-row table).
  const { data: existing } = await supabaseServer
    .from('admin_security')
    .select('id')
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseServer
      .from('admin_security')
      .update({
        destruct_password_hash: hash,
        set_by: auth.user.id,
        set_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      console.error('[set-password] update error:', error);
      return NextResponse.json({ error: 'فشل تحديث كلمة المرور' }, { status: 500 });
    }
  } else {
    const { error } = await supabaseServer
      .from('admin_security')
      .insert({
        destruct_password_hash: hash,
        set_by: auth.user.id,
      });
    if (error) {
      console.error('[set-password] insert error:', error);
      return NextResponse.json({ error: 'فشل حفظ كلمة المرور' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

/**
 * GET /api/admin/destruct/set-password
 *
 * Returns whether a destruct password has been set (NOT the hash).
 * Used by the UI to decide whether to show "set password" or
 * "enter password" flow.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data } = await supabaseServer
    .from('admin_security')
    .select('id, set_at')
    .maybeSingle();

  return NextResponse.json({
    success: true,
    hasPassword: !!data,
    setAt: data?.set_at ?? null,
  });
}
