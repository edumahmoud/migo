import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

// ─── POST: Teacher manually registers a student as present ───
// Uses service role key to bypass RLS (teacher can't normally insert on behalf of student)
// SECURITY FIX: Added proper authentication — previously had NO auth at all.
export async function POST(request: NextRequest) {
  try {
    // ── Authenticate the requester ──
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;

    // ── Verify the requester is a teacher, admin, or superadmin ──
    const role = await getUserRole(userId);
    if (!role || (role !== 'teacher' && role !== 'admin' && role !== 'superadmin')) {
      return NextResponse.json(
        { error: 'هذا الإجراء متاح للمعلمين فقط' },
        { status: 403 }
      );
    }

    const { sessionId, studentId, teacherId } = await request.json();

    if (!sessionId || !studentId || !teacherId) {
      return NextResponse.json({ error: 'sessionId, studentId, and teacherId are required' }, { status: 400 });
    }

    // SECURITY FIX: Use the authenticated user's ID instead of trusting the client-supplied teacherId.
    // The client sends teacherId for reference, but we verify ownership using the authenticated ID.
    const effectiveTeacherId = userId;

    // Verify the teacher owns this attendance session
    const { data: session, error: sessionError } = await supabaseServer
      .from('attendance_sessions')
      .select('id, teacher_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'جلسة الحضور غير موجودة' }, { status: 404 });
    }

    // SECURITY FIX: Compare against the authenticated user's ID, not the client-supplied one
    if (session.teacher_id !== effectiveTeacherId) {
      // Admins/superadmins can register for any session they can see
      if (role !== 'admin' && role !== 'superadmin') {
        return NextResponse.json({ error: 'غير مصرح بهذا الإجراء — أنت لست معلم هذه الجلسة' }, { status: 403 });
      }
    }

    if (session.status !== 'active') {
      return NextResponse.json({ error: 'جلسة الحضور غير نشطة' }, { status: 400 });
    }

    // Check if student is already registered
    const { data: existingRecord } = await supabaseServer
      .from('attendance_records')
      .select('id')
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (existingRecord) {
      return NextResponse.json({ error: 'تم تسجيل حضور هذا الطالب بالفعل' }, { status: 409 });
    }

    // Try inserting with check_in_method = 'manual'
    const { error: insertError } = await supabaseServer
      .from('attendance_records')
      .insert({
        session_id: sessionId,
        student_id: studentId,
        check_in_method: 'manual',
      });

    if (insertError) {
      // If 'manual' is not in the CHECK constraint, try without check_in_method
      if (insertError.message?.includes('check_in_method') || insertError.code === '23514') {
        const { error: fallbackError } = await supabaseServer
          .from('attendance_records')
          .insert({
            session_id: sessionId,
            student_id: studentId,
          });

        if (fallbackError) {
          console.error('[manual-register] Fallback insert error:', fallbackError);
          return NextResponse.json({ error: 'حدث خطأ أثناء تسجيل الحضور' }, { status: 500 });
        }
      } else {
        console.error('[manual-register] Insert error:', insertError);
        return NextResponse.json({ error: 'حدث خطأ أثناء تسجيل الحضور' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[manual-register] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
