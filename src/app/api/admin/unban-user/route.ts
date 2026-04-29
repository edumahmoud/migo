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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unban user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
