import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { setDefaultPayoutMethod } from '@/lib/payment/payout-methods-repository';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/teacher/payout-methods/[id]/set-default
 *
 * Set a payout method as the default for the authenticated teacher.
 * Atomic operation:
 *   1. Clear `is_default` on the teacher's current default (if any).
 *   2. Set `is_default = true` on the new method.
 *
 * IDOR defense:
 *   - `teacher_id` from session only.
 *   - Repository's WHERE clause includes `id AND teacher_id`.
 *   - Cannot set a disabled method as default (WHERE is_active = true).
 *
 * The partial unique index `teacher_payout_methods_one_default`
 * is the defense-in-depth — even if step 1 fails, the DB rejects the
 * duplicate.
 *
 * Idempotent: if the method is already default, returns success.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;
  const { id } = await ctx.params;

  try {
    const result = await setDefaultPayoutMethod(id, teacherId, teacherId);

    if (!result.set) {
      return NextResponse.json(
        { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك أو معطّلة' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      id,
      message: 'تم ضبط الوسيلة كافتراضية',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل الضبط';
    if (message.includes('Default conflict')) {
      return NextResponse.json({ success: false, error: message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
