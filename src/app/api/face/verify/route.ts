import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { validEmbedding, distance, makeFacePass, FACE_MATCH_MAX_DISTANCE } from '@/lib/face-pass';
import { checkRateLimitDistributed } from '@/lib/rate-limit-server';

/**
 * POST /api/face/verify  { embedding, scope }  scope = "exam:<quizId>"
 * The phone sends the embedding of a live selfie (after the head-turn check). The SERVER compares it with the stored
 * template and, if close enough, returns a signed pass for that scope. Nothing is decided on the phone.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  const rl = await checkRateLimitDistributed(request, { userId: auth.user.id, maxRequests: 12, scope: 'face-verify' });
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'محاولات كثيرة، استنى شوية' }, { status: 429 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const scope = typeof body.scope === 'string' && /^exam:[0-9a-f-]{36}$/i.test(body.scope) ? body.scope : '';
  if (!scope || !validEmbedding(body.embedding)) return NextResponse.json({ success: false, error: 'invalid' }, { status: 400 });

  const { data: t } = await supabaseServer.from('face_templates').select('embedding, expires_at').eq('user_id', auth.user.id).maybeSingle();
  if (!t || new Date(t.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ success: false, code: 'not_enrolled', error: 'سجّل وجهك الأول من الإعدادات' }, { status: 409 });
  }
  const d = distance(body.embedding as number[], t.embedding as number[]);
  if (d > FACE_MATCH_MAX_DISTANCE) return NextResponse.json({ success: false, code: 'mismatch', error: 'الوجه مش متطابق، حاول تاني' }, { status: 403 });
  return NextResponse.json({ success: true, score: Math.round(d * 1000) / 1000, pass: makeFacePass(auth.user.id, scope, 120) });
}
