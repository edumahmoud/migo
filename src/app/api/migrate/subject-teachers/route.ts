import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/migrate/subject-teachers
 * One-time migration: Creates subject_teachers junction table and backfills existing data.
 * See: supabase/migrations/v10_subject_teachers.sql
 */
export async function POST() {
  try {
    const results: string[] = [];

    // Check if subject_teachers table already exists
    const { error: checkError } = await supabaseServer
      .from('subject_teachers')
      .select('id')
      .limit(1);

    if (checkError) {
      // Table doesn't exist yet - need to run SQL manually
      results.push('subject_teachers table does not exist yet.');
      results.push('Please run the SQL migration manually in Supabase SQL Editor:');
      results.push('supabase/migrations/v10_subject_teachers.sql');
      return NextResponse.json({
        success: false,
        results,
        error: 'Table not found. Run the SQL migration first.',
      }, { status: 200 });
    }

    // Table exists — backfill existing subjects if needed
    const { count: totalSubjects } = await supabaseServer
      .from('subjects')
      .select('*', { count: 'exact', head: true });

    const { count: ownerEntries } = await supabaseServer
      .from('subject_teachers')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'owner');

    if (totalSubjects && ownerEntries !== null && ownerEntries < totalSubjects) {
      // Backfill missing owner entries
      const { data: subjects } = await supabaseServer
        .from('subjects')
        .select('id, teacher_id');

      if (subjects && subjects.length > 0) {
        const rows = subjects.map((s: { id: string; teacher_id: string }) => ({
          subject_id: s.id,
          teacher_id: s.teacher_id,
          role: 'owner',
          added_by: s.teacher_id,
        }));

        const { error: insertError } = await supabaseServer
          .from('subject_teachers')
          .upsert(rows, { onConflict: 'subject_id,teacher_id' });

        if (insertError) {
          results.push(`Error backfilling owner entries: ${insertError.message}`);
        } else {
          results.push(`Backfilled ${rows.length} owner entries in subject_teachers`);
        }
      }
    } else {
      results.push(`subject_teachers table exists with ${ownerEntries} owner entries (${totalSubjects} subjects total)`);
    }

    return NextResponse.json({
      success: true,
      message: 'Migration check completed',
      results,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء الترحيل' },
      { status: 500 }
    );
  }
}
