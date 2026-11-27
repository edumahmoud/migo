import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { checkRateLimit, validateRequest } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { UUID_PATTERN, validPosition, verifyAttendanceQr } from '@/lib/attendance-security';

export async function POST(request: NextRequest) {
  const invalid = validateRequest(request);
  if (invalid) return invalid;
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  if (!checkRateLimit(request, 'attendance-check-in:' + auth.user.id, 30).allowed) return NextResponse.json({ error: 'محاولات كثيرة. انتظر دقيقة.' }, { status: 429 });
  try {
    const body = await request.json();
    const { sessionId, method, token, latitude, longitude, accuracy, ageMs } = body;
    // Fix age is measured on the phone (same clock for both ends of the interval), so phone clock skew cannot break it.
    const capturedAt = typeof ageMs === 'number' && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 60000 ? Date.now() - ageMs : (typeof body.capturedAt === 'number' && Math.abs(Date.now() - body.capturedAt) > 5000 ? NaN : body.capturedAt);
    if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId) || !['qr', 'gps'].includes(method)) return NextResponse.json({ error: 'طلب حضور غير صالح' }, { status: 400 });
    const { data: session, error } = await supabaseServer.from('attendance_sessions').select('id,status,started_at').eq('id', sessionId).single();
    if (error || !session || session.status !== 'active') return NextResponse.json({ error: 'جلسة الحضور مغلقة أو غير متاحة' }, { status: 409 });
    if (method === 'qr' && !verifyAttendanceQr(token, session.id, session.started_at, process.env.SUPABASE_SERVICE_ROLE_KEY || '')) return NextResponse.json({ error: 'الرمز غير صالح أو انتهت صلاحيته. امسح الرمز الجديد.' }, { status: 400 });
    if (method === 'gps' && (!validPosition(latitude, longitude, accuracy) || typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt < Date.now() - 60000 || capturedAt > Date.now() + 5000)) return NextResponse.json({ error: 'دقة الموقع غير كافية أو الموقع قديم. حاول مجدداً أو استخدم QR.' }, { status: 400 });
    // Only service_role can execute this RPC. It locks the session while checking
    // status and enrollment, so a concurrent close cannot race an insertion.
    const { data, error: insertError } = await supabaseServer.rpc('verified_attendance_check_in', {
      p_session_id: sessionId,
      p_student_id: auth.user.id,
      p_method: method,
      p_latitude: method === 'gps' ? latitude : null,
      p_longitude: method === 'gps' ? longitude : null,
      p_accuracy: method === 'gps' ? accuracy : null,
      p_captured_at: method === 'gps' ? new Date(capturedAt).toISOString() : null,
    });
    if (insertError) {
      const messages: Record<string, string> = {
        SESSION_CLOSED: 'جلسة الحضور مغلقة', NOT_ENROLLED: 'غير مسجل في هذا المقرر',
        NOT_STUDENT: 'تسجيل الحضور متاح للطلاب فقط', GPS_UNAVAILABLE: 'GPS غير متاح لهذه الجلسة. استخدم QR أو التسجيل اليدوي.',
        GPS_INVALID: 'دقة الموقع غير كافية. حاول مجدداً أو استخدم QR.', GPS_TOO_FAR: 'أنت خارج نطاق الحضور المسموح (20 متر). استخدم QR أو اطلب مراجعة المعلم.',
      };
      const code = Object.keys(messages).find(key => insertError.message.includes(key));
      return NextResponse.json({ error: code ? messages[code] : 'تعذر تسجيل الحضور. حاول مجدداً.' }, { status: code ? 409 : 500 });
    }
    // Fingerprint proof (flag only, never blocks): the phone releases a device secret only after a fingerprint check.
    let bioVerified = false;
    if (typeof body.bioSecret === 'string' && /^[0-9a-f]{64}$/.test(body.bioSecret)) {
      const { data: cred } = await supabaseServer
        .from('biometric_credentials')
        .select('id')
        .eq('user_id', auth.user.id)
        .eq('secret_hash', createHash('sha256').update(body.bioSecret).digest('hex'))
        .is('revoked_at', null)
        .maybeSingle();
      bioVerified = !!cred;
    }
    if (data?.already_registered !== true) {
      await supabaseServer.from('attendance_records').update({ bio_verified: bioVerified }).eq('session_id', sessionId).eq('student_id', auth.user.id);
    }
    return NextResponse.json({ success: true, alreadyRegistered: data?.already_registered === true, bioVerified });
  } catch {
    return NextResponse.json({ error: 'طلب حضور غير صالح' }, { status: 400 });
  }
}
