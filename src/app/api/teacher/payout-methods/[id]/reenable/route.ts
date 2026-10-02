import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { reenablePayoutMethod } from '@/lib/payment/payout-methods-repository';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/teacher/payout-methods/[id]/reenable
 *
 * Re-enable a soft-disabled payout method.
 * - Sets `is_active = true`.
 * - `is_default` is NOT restored — the teacher must explicitly set default again.
 * - IDOR defense: WHERE clause includes `id AND teacher_id AND is_active = false`.
 *
 * Returns:
 *   - 200 success: { success: true, id, message }
 *   - 404 not found: { success: false, error }
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;
  const { id } = await ctx.params;

  try {
    const result = await reenablePayoutMethod(id, teacherId, teacherId);

    if (!result.reenabled) {
      return NextResponse.json(
        { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك أو مفعّلة بالفعل' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      id,
      message: 'تمت إعادة تفعيل الوسيلة',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشلت إعادة التفعيل';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
