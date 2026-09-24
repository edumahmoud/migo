import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/auth/resolve-student-code
 *
 * Body: { studentCode: string }
 * Returns: { email, name, studentCode } — used by the login-form's
 * "Login with Student Code" mode to translate a code into the
 * underlying email, then the client calls supabase.auth.signInWithPassword.
 *
 * Why return the email? Because Supabase Auth's signInWithPassword
 * requires email (not a custom field). We do NOT accept the password
 * in this request — the client sends the password directly to Supabase.
 *
 * Lookup is anonymous (no auth required) so a not-yet-logged-in student
 * can use this. The student_code is meant as a public login identifier,
 * not a secret — the password is the secret.
 */
const BodySchema = z.object({
  studentCode: z.string().trim().min(1).max(40),
});

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

  const { data: user, error } = await supabaseServer
    .from('users')
    .select('id, email, name, student_code, role')
    .eq('student_code', parsed.data.studentCode.toUpperCase())
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: 'تعذّر البحث عن الطالب' },
      { status: 500 }
    );
  }

  if (!user) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد طالب بهذا الكود' },
      { status: 404 }
    );
  }

  if (user.role !== 'student') {
    // A 'registration_agent', 'teacher', 'admin', etc. tried to log in by code.
    // We refuse — code login is for students only.
    return NextResponse.json(
      { success: false, error: 'هذا الكود لا يُستخدم لتسجيل دخول الطلاب' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    email: user.email,
    name: user.name,
    studentCode: user.student_code,
  });
}
