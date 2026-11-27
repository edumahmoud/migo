import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';

/** POST /api/face/delete : erases the user's face template and every fingerprint device secret on the server. */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  // Report success only when both deletes really worked: this is a privacy promise.
  const face = await supabaseServer.from('face_templates').delete().eq('user_id', auth.user.id);
  const bio = await supabaseServer.from('biometric_credentials').delete().eq('user_id', auth.user.id);
  if (face.error || bio.error) {
    console.error('[face/delete] failed', { face: face.error?.message, bio: bio.error?.message });
    return NextResponse.json({ success: false, error: 'تعذر حذف البيانات، حاول تاني' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/** GET /api/face/delete : whether a face template exists (status for the settings screen). */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  const { data } = await supabaseServer.from('face_templates').select('expires_at').eq('user_id', auth.user.id).maybeSingle();
  return NextResponse.json({ success: true, enrolled: !!data && new Date(data.expires_at).getTime() > Date.now() });
}
