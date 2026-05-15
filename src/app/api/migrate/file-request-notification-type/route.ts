import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// Migration: Add 'file_request' notification type to the check constraint
export async function POST() {
  try {
    // Test if 'file_request' type is already accepted
    const testId = '00000000-0000-0000-0000-000000000000';
    const { error: testError } = await supabaseServer
      .from('notifications')
      .insert({
        user_id: testId,
        type: 'file_request',
        title: '__migration_test__',
        message: '__migration_test__',
      });

    if (testError) {
      // The constraint doesn't allow 'file_request'
      console.error('[migration] file_request type not accepted:', testError.message);
      return NextResponse.json({
        success: false,
        error: 'نوع file_request غير موجود في قاعدة البيانات. الرجاء تشغيل SQL التالي في Supabase SQL Editor:',
        sql: `ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'file_request', 'system', 'attendance', 'link_request'));`,
      }, { status: 200 });
    }

    // Clean up test row
    await supabaseServer
      .from('notifications')
      .delete()
      .eq('user_id', testId)
      .eq('title', '__migration_test__');

    return NextResponse.json({ success: true, message: 'نوع file_request متاح بالفعل في قاعدة البيانات ✅' });
  } catch (err) {
    console.error('[migration] Error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء تنفيذ الـ migration' }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
