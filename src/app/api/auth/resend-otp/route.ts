import { NextRequest, NextResponse } from 'next/server';
import { scryptSync, randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { normalizePhoneToE164 } from '@/lib/phone-utils';

/**
 * POST /api/auth/resend-otp
 *
 * Generates a 6-digit OTP, stores it hashed (scrypt + random salt),
 * and sends it directly to the student's phone number via the
 * Telegram Gateway API.
 *
 * The Telegram Gateway sends the code to the Telegram app installed
 * on that phone number (with SMS fallback if Telegram is not installed).
 *
 * API endpoint (per official docs at https://gateway.telegram.org/docs):
 *   URL:    https://gatewayapi.telegram.org/sendVerificationMessage
 *   Auth:   Authorization: Bearer <token>
 *   Body:   { phone_number: "+...", code: "123456", sender_username?: "..." }
 *   Response: { ok: true, result: {...} } on success,
 *             { ok: false, error: "ACCESS_TOKEN_INVALID" } on failure.
 *
 * Rate limiting:
 *   - Resend cooldown: 60 seconds.
 *   - Max 3 OTP requests per phone per hour.
 *
 * Env: TELEGRAM_GATEWAY_API_TOKEN (from Telegram Gateway dashboard).
 */
const GATEWAY_TOKEN = process.env.TELEGRAM_GATEWAY_API_TOKEN || '';
const GATEWAY_SEND_URL = 'https://gatewayapi.telegram.org/sendVerificationMessage';
const OTP_EXPIRY_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_PER_HOUR = 3;

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send the OTP code to a phone number via the Telegram Gateway API.
 * Returns true if the gateway accepted the request.
 * If the token is not configured, the OTP is still stored locally
 * (for dev/testing — the code can be read from server logs).
 */
async function sendOtpViaGateway(phone: string, code: string): Promise<{
  sent: boolean;
  error?: string;
  http_status?: number;
  response_preview?: string;
  elapsed_ms?: number;
  error_code?: string;
}> {
  if (!GATEWAY_TOKEN) {
    // Dev mode — log the code so the developer can test.
    console.log(`[OTP DEV MODE] Code for ${phone}: ${code}`);
    return { sent: false, error: 'Telegram Gateway not configured (dev mode)' };
  }

  try {
    const startTime = Date.now();
    const res = await fetch(GATEWAY_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      },
      // Per the official Telegram Gateway API docs:
      //   URL: https://gatewayapi.telegram.org/sendVerificationMessage
      //   Body fields: phone_number, code, sender_username (optional)
      // Response: JSON with `ok` field (true on success, false on error).
      body: JSON.stringify({
        phone_number: phone,
        code: code,
        // sender_username is OPTIONAL — only set if the user has a
        // bot/channel registered with their gateway account. Leave it
        // out by default; the gateway will use a generic sender.
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = Date.now() - startTime;
    const body = await res.text().catch(() => '');

    // Try to parse the JSON response — Telegram Gateway always returns
    // JSON with an `ok` field per the official docs.
    let parsed: { ok?: boolean; error?: string; result?: unknown } | null = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON */ }

    // Success path: HTTP 200 + JSON with ok:true
    if (res.status === 200 && parsed?.ok === true) {
      return {
        sent: true,
        http_status: res.status,
        response_preview: body.slice(0, 300),
        elapsed_ms: elapsed,
      };
    }

    // Auth/token failure: JSON with ok:false + error:ACCESS_TOKEN_INVALID
    if (parsed?.ok === false) {
      const errorCode = parsed.error || 'UNKNOWN_ERROR';
      console.error('[resend-otp] Gateway returned ok:false:', errorCode, body);
      // Map common error codes to user-friendly Arabic messages
      const arabicErrorMap: Record<string, string> = {
        'ACCESS_TOKEN_INVALID': 'توكن تليجرام غير صالح أو مُلغى. تحقق من قيمة TELEGRAM_GATEWAY_API_TOKEN في Vercel.',
        'ACCESS_TOKEN_EXPIRED': 'انتهت صلاحية التوكن. أعد توليده من لوحة تحكم Telegram Gateway.',
        'PHONE_NUMBER_INVALID': `رقم الهاتف (${phone}) غير صالح. يجب أن يكون بصيغة E.164 مثل +201555614624.`,
        'PHONE_NUMBER_FLOOD': 'تم إرسال العديد من الأكواد لهذا الرقم مؤخراً. حاول لاحقاً.',
        'MESSAGE_RATE_LIMIT_EXCEEDED': 'تم تجاوز حد الإرسال. حاول لاحقاً.',
        'USER_NOT_FOUND': 'لا يوجد حساب تليجرام بهذا الرقم. يجب أن يكون لدى الطالب تليجرام مثبت ومسجل بنفس الرقم.',
        'ACCOUNT_BLOCKED': 'تم حظر حسابك في Telegram Gateway. تواصل مع الدعم.',
        'INSUFFICIENT_FUNDS': 'رصيد غير كافٍ في حساب Telegram Gateway. أعد شحن المحفظة بـ TON.',
      };
      return {
        sent: false,
        error: arabicErrorMap[errorCode] || `خطأ من تليجرام: ${errorCode}`,
        http_status: res.status,
        response_preview: body.slice(0, 300),
        elapsed_ms: elapsed,
        error_code: errorCode,
      };
    }

    // Fallback: not JSON, or unexpected status
    if (!res.ok) {
      console.error('[resend-otp] Gateway error:', res.status, body);
      return {
        sent: false,
        error: `Gateway HTTP ${res.status}`,
        http_status: res.status,
        response_preview: body.slice(0, 300),
        elapsed_ms: elapsed,
      };
    }

    // 200 but unexpected body
    return {
      sent: false,
      error: 'استجابة غير متوقعة من تليجرام',
      http_status: res.status,
      response_preview: body.slice(0, 300),
      elapsed_ms: elapsed,
    };
  } catch (err) {
    console.error('[resend-otp] Gateway fetch error:', err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Network error contacting Telegram Gateway',
    };
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  // 1. Fetch the student's profile.
  const { data: profile } = await supabaseServer
    .from('users')
    .select('id, account_status, phone, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ success: false, error: 'الملف الشخصي غير موجود' }, { status: 404 });
  }

  const p = profile as { id: string; account_status: string; phone: string | null; phone_verified: boolean };

  // Resilient OTP gate — see verify-otp/route.ts for the rationale.
  const needsOtp =
    p.account_status === 'pending_verification' ||
    (p.account_status === 'pending' && !!p.phone && p.phone_verified === false);

  if (!needsOtp) {
    return NextResponse.json({ success: false, error: 'حسابك لا يحتاج إلى التحقق' }, { status: 400 });
  }

  if (!p.phone) {
    return NextResponse.json({ success: false, error: 'لا يوجد رقم هاتف مرتبط بحسابك' }, { status: 400 });
  }

  // 1b. NORMALIZE the phone to E.164 before doing anything else.
  //     If the user signed up before the normalization fix, the DB
  //     still has local format like '01555614624'. Telegram Gateway
  //     rejects anything that doesn't start with +. We normalize here
  //     AND persist the normalized value back to the DB so future
  //     requests use it directly.
  const normalizedPhone = normalizePhoneToE164(p.phone);
  if (!normalizedPhone) {
    return NextResponse.json(
      { success: false, error: `رقم الهاتف المخزَّن (${p.phone}) غير صالح. حدّث رقمك من زر "تحديث الرقم".` },
      { status: 400 }
    );
  }
  if (normalizedPhone !== p.phone) {
    // Persist the normalized phone back to the DB.
    await supabaseServer
      .from('users')
      .update({ phone: normalizedPhone, updated_at: new Date().toISOString() })
      .eq('id', p.id);
    // Use the normalized value for the rest of this request.
    p.phone = normalizedPhone;
  }

  // 2. Check resend cooldown.
  const { data: lastOtp } = await supabaseServer
    .from('otp_codes')
    .select('created_at')
    .eq('user_id', p.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastOtp) {
    const lastCreated = new Date((lastOtp as { created_at: string }).created_at).getTime();
    const elapsed = (Date.now() - lastCreated) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
      return NextResponse.json(
        { success: false, error: `يرجى الانتظار ${wait} ثانية قبل طلب كود جديد` },
        { status: 429 }
      );
    }
  }

  // 3. Check rate limit (max 3 per hour per phone).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseServer
    .from('otp_codes')
    .select('id', { count: 'exact', head: true })
    .eq('phone', p.phone)
    .gte('created_at', oneHourAgo);

  if ((count ?? 0) >= MAX_OTP_PER_HOUR) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد الأقصى من طلبات التحقق في هذه الساعة. حاول لاحقاً.' },
      { status: 429 }
    );
  }

  // 4. Generate OTP (6-digit).
  const code = generateOTP();
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(code, salt, 64).toString('hex');
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  // 5. Insert the OTP record.
  const { data: newOtp, error: otpErr } = await supabaseServer
    .from('otp_codes')
    .insert({
      user_id: p.id,
      phone: p.phone,
      code_hash: hash,
      code_salt: salt,
      expires_at: expiresAt,
      max_attempts: 5,
      used: false,
    })
    .select('id')
    .single();

  if (otpErr) {
    console.error('[resend-otp] INSERT error:', otpErr);
    return NextResponse.json({ success: false, error: 'فشل إنشاء كود التحقق' }, { status: 500 });
  }

  // 6. Send OTP via Telegram Gateway API (directly to the phone number).
  const gatewayResult = await sendOtpViaGateway(p.phone, code);

  // 7. Response — include diagnostic info so the frontend can show
  //    the user (and the operator) the actual gateway error.
  return NextResponse.json({
    success: true,
    message: gatewayResult.sent
      ? 'تم إرسال كود التحقق إلى رقم هاتفك عبر تليجرام. تحقق من تطبيق تليجرام.'
      : GATEWAY_TOKEN
        ? `تعذّر إرسال الكود عبر تليجرام: ${gatewayResult.error || 'خطأ غير معروف'}`
        : 'تم إنشاء كود التحقق. (وضع التطوير — راجع سجل الخادم للحصول على الكود.)',
    gateway_sent: gatewayResult.sent,
    gateway_error: gatewayResult.error,
    gateway_http_status: gatewayResult.http_status,
    gateway_response_preview: gatewayResult.response_preview,
    gateway_elapsed_ms: gatewayResult.elapsed_ms,
    token_configured: !!GATEWAY_TOKEN,
    phone: p.phone,
    otp_id: (newOtp as { id: string }).id,
    diagnostic_url: '/api/setup/check-telegram-gateway',
  });
}
