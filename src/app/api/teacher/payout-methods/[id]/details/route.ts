import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { resolvePayoutMethod } from '@/lib/payment/payout-methods-repository';

/**
 * GET /api/teacher/payout-methods/[id]/details
 *
 * Returns the FULL decrypted payout method details for the teacher's
 * OWN method (self-view). This lets the teacher see their own bank
 * account number, wallet number, card number, etc. with a show/hide
 * toggle in the UI.
 *
 * IDOR defense: resolvePayoutMethod filters by both id AND teacher_id.
 * The teacher can ONLY see their own methods.
 */
interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePayoutMethod(id, teacherId);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      details: resolved.details,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'تعذّر تحميل التفاصيل' },
      { status: 500 },
    );
  }
}
