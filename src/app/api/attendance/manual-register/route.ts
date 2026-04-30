import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

// ─── POST: Teacher manually registers a student as present ───
// Uses service role key to bypass RLS (teacher can't normally insert on behalf of student)
// 🔒 SECURITY: Requires teacher role. The teacherId is verified from the authenticated
// session, NOT from the request body (which could be spoofed).
export async function POST(request: NextRequest) {
  // 🔒 SECURITY: Only teachers (and admins) can manually register attendance
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { sessionId, studentId } = await request.json();

    if (!sessionId || !studentId) {
      return NextResponse.json({ error: 'sessionId and studentId are required' }, { status: 400 });
    }

    // SECURITY: Use the authenticated user's ID, not a body parameter
    // The old code trusted `teacherId` from the request body which could be spoofed
    const authenticatedTeacherId = authResult.user.id;

    // Verify the authenticated teacher owns this attendance session
    const { data: session, error: sessionError } = await supabaseServer
      .from('attendance_sessions')
      .select('id, teacher_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'جلسة الحضور غير موجودة' }, { status: 404 });
    }

    // SECURITY: Verify the authenticated user IS the teacher of this session
    // Not just any teacher can register attendance for any session
    if (session.teacher_id !== authenticatedTeacherId && authResult.role !== 'admin' && authResult.role !== 'superadmin') {
      return NextResponse.json({ error: 'غير مصرح بهذا الإجراء — لست معلم هذه الجلسة' }, { status: 403 });
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
