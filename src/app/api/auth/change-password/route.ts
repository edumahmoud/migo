import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * POST /api/auth/change-password
 *
 * Changes the authenticated user's password.
 * This server-side endpoint is more reliable than the client-side
 * supabase.auth.updateUser() because:
 * 1. It uses the service_role key (bypasses session freshness requirements)
 * 2. It verifies the current password before allowing the change
 * 3. No client-side session reauthentication needed
 *
 * Request body:
 *   - currentPassword: string (required)
 *   - newPassword: string (required, min 6 chars)
 */
export async function POST(request: NextRequest) {
  try {
    // ── 1. Parse request body ──
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'يرجى إدخال كلمة المرور الحالية والجديدة' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية' },
        { status: 400 }
      );
    }

    // ── 2. Authenticate the user ──
    let authUser = null;

    // Try Bearer token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user }, error } = await supabaseServer.auth.getUser(token);
      if (!error && user) authUser = user;
    }

    // Fallback: try server-side cookie auth
    if (!authUser) {
      try {
        const serverClient = await getSupabaseServerClient();
        const { data: { user }, error } = await serverClient.auth.getUser();
        if (!error && user) authUser = user;
      } catch {
        // Cookie auth might fail in API routes
      }
    }

    if (!authUser) {
      return NextResponse.json(
        { error: 'غير مسجل الدخول. يرجى تسجيل الدخول مرة أخرى' },
        { status: 401 }
      );
    }

    // ── 3. Verify current password by attempting sign-in ──
    // We use the anon-key client (not service_role) to verify the password,
    // because the service_role key bypasses auth checks entirely.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'خطأ في إعدادات الخادم' },
        { status: 500 }
      );
    }

    // Dynamic import to avoid bundling issues
    const { createClient } = await import('@supabase/supabase-js');
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await anonClient.auth.signInWithPassword({
      email: authUser.email || '',
      password: currentPassword,
    });

    if (signInError) {
      console.error('[change-password] Current password verification failed:', signInError.message);
      const msg = signInError.message?.toLowerCase() || '';

      if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('wrong password')) {
        return NextResponse.json(
          { error: 'كلمة المرور الحالية غير صحيحة' },
          { status: 400 }
        );
      } else if (msg.includes('email not confirmed')) {
        return NextResponse.json(
          { error: 'البريد الإلكتروني غير مؤكد. يرجى تأكيد بريدك الإلكتروني أولاً' },
          { status: 400 }
        );
      } else if (msg.includes('rate limit') || msg.includes('too many')) {
        return NextResponse.json(
          { error: 'طلبات كثيرة جداً. يرجى الانتظار ثم المحاولة مرة أخرى' },
          { status: 429 }
        );
      } else {
        return NextResponse.json(
          { error: `فشل التحقق من كلمة المرور: ${signInError.message}` },
          { status: 400 }
        );
      }
    }

    // ── 4. Update password using admin API (service_role) ──
    // This bypasses the "session not fresh enough" requirement
    const { error: updateError } = await supabaseServer.auth.admin.updateUserById(
      authUser.id,
      { password: newPassword }
    );

    if (updateError) {
      console.error('[change-password] Password update failed:', updateError.message);
      const msg = updateError.message?.toLowerCase() || '';

      if (msg.includes('same') || msg.includes('different')) {
        return NextResponse.json(
          { error: 'كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية' },
          { status: 400 }
        );
      } else if (msg.includes('password') && (msg.includes('weak') || msg.includes('require') || msg.includes('strength') || msg.includes('policy'))) {
        return NextResponse.json(
          { error: 'كلمة المرور لا تلبي متطلبات الأمان. تأكد من أن كلمة المرور تحتوي على أحرف كبيرة وصغيرة وأرقام' },
          { status: 400 }
        );
      } else {
        return NextResponse.json(
          { error: `فشل تغيير كلمة المرور: ${updateError.message}` },
          { status: 500 }
        );
      }
    }

    console.log('[change-password] Password updated successfully for:', authUser.email);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[change-password] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى' },
      { status: 500 }
    );
  }
}
