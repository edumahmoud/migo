import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';

/** POST /api/face/delete : erases the user's face template and every fingerprint device secret on the server. */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  await supabaseServer.from('face_templates').delete().eq('user_id', auth.user.id);
  await supabaseServer.from('biometric_credentials').delete().eq('user_id', auth.user.id);
  return NextResponse.json({ success: true });
}

/** GET /api/face/delete : whether a face template exists (status for the settings screen). */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  const { data } = await supabaseServer.from('face_templates').select('expires_at').eq('user_id', auth.user.id).maybeSingle();
  return NextResponse.json({ success: true, enrolled: !!data && new Date(data.expires_at).getTime() > Date.now() });
}
