import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { subjectId } = body;

    if (!subjectId) {
      return NextResponse.json(
        { success: false, error: 'معرف المقرر مطلوب' },
        { status: 400 }
      );
    }

    const { error } = await supabaseServer
      .from('subjects')
      .delete()
      .eq('id', subjectId);

    if (error) {
      console.error('Error deleting subject:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حذف المقرر' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete subject error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
