import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { listPayoutMethodSchemas } from '@/lib/payment/payout-method-schemas';

/**
 * GET /api/teacher/payout-methods/providers
 *
 * Returns the list of supported payout method types + their field schemas.
 * Used by the frontend to render the create form dynamically.
 *
 * This endpoint is teacher-only (no admin verification of identity needed —
 * the response is public-shape data, no secrets).
 *
 * Response shape:
 *   {
 *     success: true,
 *     providers: [
 *       {
 *         method_type: 'vodafone_cash',
 *         display_name: 'فودافون كاش',
 *         fields: [{ name, label, type, required, placeholder, pattern, helpText, maxLength }]
 *       },
 *       ...
 *     ]
 *   }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const schemas = listPayoutMethodSchemas();

  return NextResponse.json({
    success: true,
    providers: schemas.map((s) => ({
      method_type: s.methodType,
      display_name: s.displayName,
      fields: s.fields,
    })),
  });
}
