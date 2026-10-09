import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

// ─── Schema detection cache ───
let _hasEnhancedSchema: boolean | null = null;

async function hasEnhancedBanSchema(): Promise<boolean> {
  if (_hasEnhancedSchema !== null) return _hasEnhancedSchema;

  try {
    const { error } = await supabaseServer
      .from('banned_users')
      .select('id, is_active')
      .limit(1);

    _hasEnhancedSchema = !error;
  } catch {
    _hasEnhancedSchema = false;
  }

  return _hasEnhancedSchema;
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { email, banId } = body;

    if (!email && !banId) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني أو معرف الحظر مطلوب' },
        { status: 400 }
      );
    }

    const isEnhanced = await hasEnhancedBanSchema();

    if (isEnhanced) {
      // Enhanced schema: deactivate the ban (preserves history)
      let query = supabaseServer
        .from('banned_users')
        .update({ is_active: false });

      if (banId) {
        query = query.eq('id', banId);
      } else {
        query = query.eq('email', email);
      }

      const { error } = await query;

      if (error) {
        console.error('Error unbanning user:', error);
        _hasEnhancedSchema = null;
        return NextResponse.json(
          { success: false, error: 'حدث خطأ أثناء إلغاء الحظر' },
          { status: 500 }
        );
      }
    } else {
      // Basic schema: delete the record entirely (no is_active column)
      let query = supabaseServer
        .from('banned_users')
        .delete();

      if (banId) {
        query = query.eq('id', banId);
      } else {
        query = query.eq('email', email);
      }

      const { error } = await query;

      if (error) {
        console.error('Error unbanning user (basic schema):', error);
        _hasEnhancedSchema = null;
        return NextResponse.json(
          { success: false, error: 'حدث خطأ أثناء إلغاء الحظر' },
          { status: 500 }
        );
      }
    }

    // ═══════════════════════════════════════════════════════════
    // v130: Reverse the cascade suspension that was applied when the
    // teacher was banned. When a teacher was banned, we set:
    //   - registration_agents.is_active = false
    //   - subjects.is_paused = true
    // Now that the ban is lifted, reverse both so the teacher + their
    // agents + their courses are fully operational again.
    // ═══════════════════════════════════════════════════════════
    const lookupEmail = email || null;
    if (lookupEmail) {
      // Find the user by email to check if they're a teacher
      const { data: unbannedUser } = await supabaseServer
        .from('users')
        .select('id, role')
        .eq('email', lookupEmail)
        .maybeSingle();

      if (unbannedUser && unbannedUser.role === 'teacher') {
        // Reactivate all agents belonging to this teacher
        const { error: agentReactivateError } = await supabaseServer
          .from('registration_agents')
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq('teacher_id', unbannedUser.id)
          .eq('is_active', false);

        if (agentReactivateError) {
          console.error('[unban-user] Failed to reactivate agents:', agentReactivateError.message);
        }

        // Unpause all subjects owned by this teacher
        const { error: subjectUnpauseError } = await supabaseServer
          .from('subjects')
          .update({ is_paused: false, updated_at: new Date().toISOString() })
          .eq('teacher_id', unbannedUser.id)
          .eq('is_paused', true);

        if (subjectUnpauseError) {
          console.error('[unban-user] Failed to unpause subjects:', subjectUnpauseError.message);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unban user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
