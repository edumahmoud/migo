import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/migrate/superadmin
 * One-time migration: Promotes the first user to superadmin if none exists.
 * The CHECK constraint must be updated first via supabase/migrations/add_superadmin_role.sql
 */
export async function POST(request: NextRequest) {
  try {
    const results: string[] = [];

    // Check if any superadmin exists
    const { data: superadmins, error: saError } = await supabaseServer
      .from('users')
      .select('id')
      .eq('role', 'superadmin');

    if (saError) {
      results.push('Warning: Could not query superadmins - CHECK constraint may need updating');
      results.push('Please run the migration SQL in supabase/migrations/add_superadmin_role.sql manually');
      return NextResponse.json({ success: false, results, error: saError.message }, { status: 500 });
    }

    if (superadmins && superadmins.length === 0) {
      // No superadmin exists - promote the first user
      const { data: firstUser, error: firstError } = await supabaseServer
        .from('users')
        .select('id, name, email')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (firstError) {
        results.push(`Error finding first user: ${firstError.message}`);
      } else if (firstUser) {
        const { error: updateError } = await supabaseServer
          .from('users')
          .update({ role: 'superadmin', updated_at: new Date().toISOString() })
          .eq('id', firstUser.id);

        if (updateError) {
          results.push(`Error promoting first user: ${updateError.message}`);
          results.push('Please run the migration SQL first: supabase/migrations/add_superadmin_role.sql');
        } else {
          results.push(`Successfully promoted ${firstUser.name} (${firstUser.email}) to superadmin`);
        }
      } else {
        results.push('No users found in the database');
      }
    } else if (superadmins && superadmins.length > 0) {
      results.push(`Superadmin already exists (${superadmins.length} found)`);
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
