import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { resolvePayoutMethod } from '@/lib/payment/payout-methods-repository';

/**
 * GET /api/admin/teachers/[id]/payout-details
 *
 * Returns the teacher's DEFAULT payout method (only) with FULL
 * decrypted details (account_number, IBAN, wallet_number,
 * holder_name, etc.) — for admin use ONLY to facilitate the
 * actual bank/wallet transfer.
 *
 * The user requested: only show the teacher's DEFAULT payout method
 * in the admin's payout receipt data. Non-default methods are
 * excluded from this endpoint's response.
 *
 * If the teacher has NO default method set:
 *   - Returns payout_methods: [] (empty array)
 *   - The admin should ask the teacher to set a default
 *
 * SECURITY:
 *   - requireAdmin (admin or superadmin only)
 *   - The full decrypted details are returned ONLY to admins
 *   - Students NEVER see this endpoint (no student auth)
 *   - The details are NOT logged (the logger strips secrets)
 *   - This is the ONLY endpoint that returns decrypted payout details
 *     to the client — all other endpoints (teacher self-view, admin
 *     teacher list) return only `details_masked`.
 *
 * The admin uses this to see WHERE to send the money (bank account,
 * wallet number, IBAN) — without this, the admin can't perform the
 * transfer because the masked data only shows last4.
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: teacherId } = await ctx.params;

  // 1. Fetch ONLY the DEFAULT payout method for this teacher
  //    (user requested: don't show all methods — only the default)
  //    If no default is set, return empty array.
  const { data: methodRows, error: methodsErr } = await supabaseServer
    .from('teacher_payout_methods')
    .select('id, method_type, display_label, details_masked, is_active, is_default, verified_at')
    .eq('teacher_id', teacherId)
    .eq('is_active', true)
    .eq('is_default', true)  // ← Only the default method
    .limit(1);

  if (methodsErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب طريقة الاستلام الافتراضية' },
      { status: 500 },
    );
  }

  if (!methodRows || methodRows.length === 0) {
    return NextResponse.json({
      success: true,
      payout_methods: [],
      message: 'لا توجد وسيلة استلام افتراضية لهذا المعلم — اطلب منه تحديد وسيلة افتراضية',
    });
  }

  // 2. Resolve the full decrypted details for the default method
  const row = methodRows[0] as {
    id: string;
    method_type: string;
    display_label: string;
    details_masked: string;
    is_active: boolean;
    is_default: boolean;
    verified_at: string | null;
  };

  try {
    const resolved = await resolvePayoutMethod(row.id, teacherId);
    if (resolved) {
      return NextResponse.json({
        success: true,
        payout_methods: [{
          id: row.id,
          method_type: row.method_type,
          display_label: row.display_label,
          details_masked: row.details_masked,
          details: resolved.details, // ← FULL decrypted details
          is_active: row.is_active,
          is_default: row.is_default,
          verified_at: row.verified_at,
        }],
      });
    } else {
      throw new Error('resolvePayoutMethod returned null');
    }
  } catch (err) {
    // Decryption failed (key changed, data corrupt) — return masked + error
    return NextResponse.json({
      success: true,
      payout_methods: [{
        id: row.id,
        method_type: row.method_type,
        display_label: row.display_label,
        details_masked: row.details_masked,
        details: null,
        details_error: err instanceof Error ? err.message : 'Decryption failed',
        is_active: row.is_active,
        is_default: row.is_default,
        verified_at: row.verified_at,
      }],
    });
  }
}

