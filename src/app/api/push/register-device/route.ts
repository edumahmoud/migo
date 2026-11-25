import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST   /api/push/register-device  { token }  — link this phone's FCM token to the signed-in user
 * DELETE /api/push/register-device  { token }  — unlink (on logout)
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  const { token, platform } = await request.json().catch(() => ({}));
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    return NextResponse.json({ error: 'invalid token' }, { status: 400 });
  }
  const { error } = await supabaseServer.from('device_tokens').upsert(
    { user_id: auth.user.id, token, platform: platform === 'ios' ? 'ios' : 'android', updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  );
  if (error) {
    console.error('[register-device]', error.message);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  const { token } = await request.json().catch(() => ({}));
  if (typeof token !== 'string') return NextResponse.json({ error: 'invalid token' }, { status: 400 });
  await supabaseServer.from('device_tokens').delete().eq('token', token).eq('user_id', auth.user.id);
  return NextResponse.json({ success: true });
}
