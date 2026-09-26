import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { verifyPayoutMethod } from '@/lib/payment/payout-methods-repository';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/teacher/payout-methods/[id]/verify
 *
 * Admin-only: mark a teacher's payout method as verified.
 * - Requires admin/superadmin auth (`requireAdmin`).
 * - `verified_by` is set to the admin's user_id (server-side only,
 *   NEVER accepted from the request body).
 * - `verified_at` = now().
 *
 * Use cases:
 *   - Admin manually verified the wallet belongs to the teacher
 *     (e.g., via phone call, document review).
 *   - Verification enables Phase 13 payout execution (deferred).
 *
 * Returns:
 *   - 200 success: { success: true, id, verified_at, verified_by }
 *   - 404 not found: { success: false, error }
 *   - 403 forbidden (non-admin): handled by requireAdmin
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  // `verified_by` is taken ONLY from the authenticated admin's user_id.
  // NEVER from body / query / headers.
  const adminId = authResult.user.id;
  const { id } = await ctx.params;

  try {
    const result = await verifyPayoutMethod(id, adminId);

    if (!result.verified) {
      return NextResponse.json(
        { success: false, error: 'الوسيلة غير موجودة' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      id,
      verified_at: new Date().toISOString(),
      verified_by: adminId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل التحقق';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
