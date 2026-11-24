import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { getRateLimitHeaders } from '@/lib/api-security';
import { checkRateLimitDistributed } from '@/lib/rate-limit-server';

/**
 * POST /api/auth/resolve-student-code
 *
 * Body: { studentCode: string }
 * Returns: { email, name, studentCode } — used by the login-form's
 * "Login with Code" mode to translate a code into the
 * underlying email, then the client calls supabase.auth.signInWithPassword.
 *
 * Why return the email? Because Supabase Auth's signInWithPassword
 * requires email (not a custom field). We do NOT accept the password
 * in this request — the client sends the password directly to Supabase.
 *
 * Lookup is anonymous (no auth required) so a not-yet-logged-in user
 * can use this. The code is meant as a public login identifier,
 * not a secret — the password is the secret.
 *
 * v110 made code login available for ALL account types, but v130 moved
 * teacher codes to users.teacher_code (T-<n>) and agent codes to
 * users.registration_code (A-<n>), while students keep users.student_code
 * (S-<n>). So the lookup must cover all three columns, otherwise a
 * teacher/agent entering the code shown on their own dashboard gets
 * "لا يوجد مستخدم بهذا الكود". The prefix namespaces are disjoint
 * (T- / S- / A-), so a code matches at most one column.
 */
const BodySchema = z.object({
  studentCode: z.string().trim().min(1).max(40),
});

/**
 * Normalize a user-typed login code:
 * - Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits → Latin digits
 *   (mobile keyboards with an Arabic layout can emit these)
 * - strip ALL whitespace (phones can insert spaces around the hyphen)
 * - uppercase
 */
function normalizeLoginCode(raw: string): string {
  return raw
    .replace(/[٠-٩۰-۹]/g, (d) => {
      const c = d.charCodeAt(0);
      const zero = c >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(c - zero);
    })
    .replace(/\s+/g, '')
    .toUpperCase();
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'الكود غير صالح' },
      { status: 400 }
    );
  }

  const code = normalizeLoginCode(parsed.data.studentCode);

  // Codes are generated as <prefix>-<seq> (v130) or legacy random
  // alphanumerics. Rejecting anything else also keeps the PostgREST
  // .or() filter below free of user-controlled metacharacters.
  if (!/^[A-Z0-9-]{1,40}$/.test(code)) {
    return NextResponse.json(
      { success: false, error: 'الكود غير صالح' },
      { status: 400 }
    );
  }

  // SECURITY (audit #3): anonymous endpoint that maps codes →
  // emails. Without a cap, an attacker can enumerate codes and harvest
  // the user email list. Strict distributed limit per IP: 10/minute.
  const rateLimit = await checkRateLimitDistributed(request, {
    maxRequests: 10,
    scope: 'resolve-student-code',
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'محاولات كثيرة جداً — حاول بعد قليل' },
      { status: 429, headers: getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs) }
    );
  }

  // Look the code up in every code column (see header comment). The
  // prefix namespaces are disjoint, so at most one user should match;
  // limit(1) guards the response shape either way.
  const { data: matches, error } = await supabaseServer
    .from('users')
    .select('id, email, name, student_code, teacher_code, role')
    .or(
      `student_code.eq.${code},teacher_code.eq.${code},registration_code.eq.${code}`
    )
    .limit(1);

  if (error) {
    return NextResponse.json(
      { success: false, error: 'تعذّر البحث عن المستخدم' },
      { status: 500 }
    );
  }

  const user = matches?.[0];

  if (!user) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد مستخدم بهذا الكود' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    email: user.email,
    name: user.name,
    studentCode: user.student_code ?? code,
  });
}
