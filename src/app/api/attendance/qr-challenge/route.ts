import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, validateRequest } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { issueAttendanceQr, UUID_PATTERN } from '@/lib/attendance-security';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const invalid = validateRequest(request);
  if (invalid) return invalid;
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  if (!checkRateLimit(request, 'attendance-qr-challenge:' + auth.user.id, 30).allowed) return NextResponse.json({ error: 'محاولات كثيرة. انتظر دقيقة.' }, { status: 429 });
  try {
    const { sessionId } = await request.json();
    if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) return NextResponse.json({ error: 'جلسة غير صالحة' }, { status: 400 });
    const role = await getUserRole(auth.user.id);
    if (!role || !['teacher', 'admin', 'superadmin'].includes(role)) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    const { data: session, error } = await supabaseServer.from('attendance_sessions').select('id,teacher_id,status,started_at').eq('id', sessionId).single();
    if (error || !session || (session.teacher_id !== auth.user.id && !['admin', 'superadmin'].includes(role))) return NextResponse.json({ error: 'الجلسة غير متاحة' }, { status: 403 });
    if (session.status !== 'active') return NextResponse.json({ error: 'جلسة الحضور مغلقة' }, { status: 409 });
    const qr = issueAttendanceQr(session.id, session.started_at, process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    return NextResponse.json(qr, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch {
    return NextResponse.json({ error: 'تعذر إنشاء رمز الحضور' }, { status: 500 });
  }
}
