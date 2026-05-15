import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get('subjectId');

    if (!subjectId) {
      return NextResponse.json(
        { success: false, error: 'معرف المقرر مطلوب' },
        { status: 400 }
      );
    }

    // Fetch teacher data
    const { data: subjectData } = await supabaseServer
      .from('subjects')
      .select('teacher_id')
      .eq('id', subjectId)
      .single();

    let teacher = null;
    if (subjectData?.teacher_id) {
      const { data: teacherData } = await supabaseServer
        .from('users')
        .select('*')
        .eq('id', subjectData.teacher_id)
        .single();
      teacher = teacherData;
    }

    // Fetch enrolled students
    const { data: enrollments } = await supabaseServer
      .from('subject_students')
      .select('student_id')
      .eq('subject_id', subjectId);

    let students: unknown[] = [];
    if (enrollments && enrollments.length > 0) {
      const studentIds = enrollments.map((e: { student_id: string }) => e.student_id);
      const { data: studentData } = await supabaseServer
        .from('users')
        .select('*')
        .in('id', studentIds);
      students = studentData || [];
    }

    return NextResponse.json({
      success: true,
      data: { teacher, students },
    });
  } catch (error) {
    console.error('Subject detail fetch error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب بيانات المقرر' },
      { status: 500 }
    );
  }
}
