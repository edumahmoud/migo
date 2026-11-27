import { tr } from '@/lib/tr';
import { supabase } from '@/lib/supabase';

async function token(): Promise<string | null> {
  try { return (await supabase.auth.getSession()).data.session?.access_token ?? null; } catch { return null; }
}
async function post(url: string, body: unknown) {
  const t = await token();
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body ?? {}) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok && j.success !== false, status: res.status, j };
}

export async function faceEnroll(embeddings: number[][]) {
  const r = await post('/api/face/enroll', { embeddings, consent: true });
  return r.ok ? { ok: true as const } : { ok: false as const, error: (r.j.error as string) || tr('تعذر حفظ الوجه', 'Could not save your face') };
}
export async function faceVerifyForExam(quizId: string, embedding: number[]) {
  const r = await post('/api/face/verify', { embedding, scope: `exam:${quizId}` });
  return r.ok ? { ok: true as const, pass: r.j.pass as string } : { ok: false as const, code: r.j.code as string | undefined, error: (r.j.error as string) || tr('فشل التحقق', 'Verification failed') };
}
export async function faceDeleteAll() {
  const r = await post('/api/face/delete', {});
  return r.ok;
}
export async function faceStatus(): Promise<boolean> {
  const t = await token();
  if (!t) return false;
  const res = await fetch('/api/face/delete', { headers: { Authorization: `Bearer ${t}` } });
  const j = await res.json().catch(() => ({}));
  return !!j.enrolled;
}
