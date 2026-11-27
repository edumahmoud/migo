import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { validEmbedding, distance } from '@/lib/face-pass';

/**
 * POST /api/face/enroll  { embeddings: number[128][] (3 shots), consent: true }
 * Stores only the averaged 128-number face embedding (no photo ever leaves the phone). Expires after 12 months.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const list = body.embeddings;
  if (body.consent !== true) return NextResponse.json({ success: false, error: 'لازم توافق على استخدام بيانات الوجه' }, { status: 400 });
  if (!Array.isArray(list) || list.length < 2 || list.length > 5 || !list.every(validEmbedding)) {
    return NextResponse.json({ success: false, error: 'بيانات الوجه غير صالحة' }, { status: 400 });
  }
  const shots = list as number[][];
  // The shots must be the same face
  for (let i = 1; i < shots.length; i++) {
    if (distance(shots[0], shots[i]) > 0.5) return NextResponse.json({ success: false, error: 'الصور مش لنفس الوجه، حاول تاني' }, { status: 400 });
  }
  const avg = new Array(128).fill(0).map((_, k) => shots.reduce((s, e) => s + e[k], 0) / shots.length);
  const { error } = await supabaseServer.from('face_templates').upsert(
    { user_id: auth.user.id, embedding: avg, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 365 * 86400_000).toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) return NextResponse.json({ success: false, error: 'تعذر الحفظ' }, { status: 500 });
  return NextResponse.json({ success: true });
}
