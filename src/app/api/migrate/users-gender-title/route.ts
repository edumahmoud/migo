import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET: Check if gender and title_id columns exist in the users table
 * POST: Provide migration SQL to add missing columns
 */
export async function GET() {
  try {
    // Try to select gender and title_id from users - if they don't exist, it will error
    const { error: genderError } = await supabaseServer
      .from('users')
      .select('gender')
      .limit(1);

    const { error: titleError } = await supabaseServer
      .from('users')
      .select('title_id')
      .limit(1);

    const genderMissing = genderError?.message?.includes('column') || genderError?.code === 'PGRST204';
    const titleMissing = titleError?.message?.includes('column') || titleError?.code === 'PGRST204';

    return NextResponse.json({
      needsMigration: genderMissing || titleMissing,
      genderMissing,
      titleMissing,
    });
  } catch (error) {
    console.error('Migration check error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء التحقق' }, { status: 500 });
  }
}

export async function POST() {
  try {
    // Check what's missing first
    const { error: genderError } = await supabaseServer
      .from('users')
      .select('gender')
      .limit(1);

    const { error: titleError } = await supabaseServer
      .from('users')
      .select('title_id')
      .limit(1);

    const genderMissing = genderError?.message?.includes('column') || genderError?.code === 'PGRST204';
    const titleMissing = titleError?.message?.includes('column') || titleError?.code === 'PGRST204';

    if (!genderMissing && !titleMissing) {
      return NextResponse.json({ success: true, message: 'لا حاجة للترحيل - الأعمدة موجودة بالفعل' });
    }

    // Build the SQL statements
    const sqlStatements: string[] = [];
    if (genderMissing) {
      sqlStatements.push("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS gender TEXT;");
    }
    if (titleMissing) {
      sqlStatements.push("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS title_id TEXT;");
    }

    const sql = sqlStatements.join('\n');

    return NextResponse.json({
      success: false,
      needsMigration: true,
      message: 'يرجى تنفيذ SQL التالي في Supabase SQL Editor لإضافة الأعمدة المفقودة',
      sql,
    });
  } catch (error) {
    console.error('Migration POST error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
