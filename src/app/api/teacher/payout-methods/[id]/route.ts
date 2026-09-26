import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import {
  updatePayoutMethod,
  softDisablePayoutMethod,
  getPayoutMethodForTeacher,
} from '@/lib/payment/payout-methods-repository';
import { getPayoutMethodSchema, validatePayoutMethodDetails } from '@/lib/payment/payout-method-schemas';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * PATCH /api/teacher/payout-methods/[id]
 *
 * Update a payout method owned by the authenticated teacher.
 * - `teacher_id` from session only (NEVER from body).
 * - IDOR defense: WHERE clause includes both `id` AND `teacher_id`.
 * - Allowed updates: `display_label`, `wallet_number`, `holder_name`.
 * - Immutable: `id`, `teacher_id`, `method_type` (changing method_type
 *   requires creating a new method — audit history preserved).
 * - When wallet_number / holder_name change, details are re-encrypted
 *   and the masked summary is regenerated.
 *
 * Body (any subset):
 *   {
 *     display_label?: string,
 *     wallet_number?: string,    // must match Egyptian mobile regex
 *     holder_name?: string,
 *   }
 */
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة الطلب غير صحيحة' },
      { status: 400 }
    );
  }

  // Reject attempts to change immutable fields
  if ('teacher_id' in body || 'id' in body || 'method_type' in body) {
    return NextResponse.json(
      { success: false, error: 'لا يمكن تعديل id / teacher_id / method_type' },
      { status: 400 }
    );
  }

  // Fetch the existing method to get its method_type (for schema validation)
  const existing = await getPayoutMethodForTeacher(id, teacherId);
  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك' },
      { status: 404 }
    );
  }

  // Validate any provided wallet_number / holder_name against the schema
  const schema = getPayoutMethodSchema(existing.method_type);
  if (schema) {
    const toValidate: Record<string, unknown> = {};
    if (body.wallet_number !== undefined) toValidate.wallet_number = body.wallet_number;
    if (body.holder_name !== undefined) toValidate.holder_name = body.holder_name;
    if (Object.keys(toValidate).length > 0) {
      // Merge with existing values for full validation
      // (validatePayoutMethodDetails checks required fields — but on update,
      //  we don't pass the existing values. We just validate the provided ones.)
      if (body.wallet_number !== undefined || body.holder_name !== undefined) {
        const errors = validatePayoutMethodDetails(schema, toValidate);
        // Allow missing fields (they won't be updated) — only reject on
        // format errors (regex, length).
        const formatErrors = errors.filter((e) => e.includes('الصيغة') || e.includes('يتجاوز'));
        if (formatErrors.length > 0) {
          return NextResponse.json(
            { success: false, error: formatErrors.join(' | ') },
            { status: 400 }
          );
        }
      }
    }
  }

  // Validate display_label if provided
  if (body.display_label !== undefined) {
    const label = String(body.display_label).trim();
    if (label.length < 2 || label.length > 100) {
      return NextResponse.json(
        { success: false, error: 'اسم العرض يجب أن يكون 2-100 حرف' },
        { status: 400 }
      );
    }
    body.display_label = label;
  }

  // Apply the update via repository (re-encrypts if wallet/holder changed)
  try {
    const result = await updatePayoutMethod(
      {
        id,
        teacherId,
        displayLabel: body.display_label as string | undefined,
        walletNumber: body.wallet_number as string | undefined,
        holderName: body.holder_name as string | undefined,
      },
      teacherId
    );

    if (!result.updated) {
      return NextResponse.json(
        { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      id,
      new_masked: result.newMasked,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل التحديث';
    if (message.includes('هذه المحفظة مسجلة')) {
      return NextResponse.json({ success: false, error: message }, { status: 409 });
    }
    if (message.includes('encryption key')) {
      return NextResponse.json(
        { success: false, error: 'مفتاح التشفير غير مضبوط. تواصل مع الإدارة.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/teacher/payout-methods/[id]
 *
 * Soft-disable ONLY — never hard-delete.
 * - Sets is_active = false and is_default = false.
 * - Audit history is preserved (the row remains in the table).
 * - Hard-delete is admin-only via the service role (Phase 13 scope).
 *
 * IDOR defense: WHERE clause includes both `id` AND `teacher_id`.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;
  const { id } = await ctx.params;

  try {
    const result = await softDisablePayoutMethod(id, teacherId, teacherId);

    if (!result.disabled) {
      return NextResponse.json(
        { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      id,
      message: 'تم تعطيل الوسيلة (soft-disable). البيانات محفوظة للسجل التاريخي.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل التعطيل';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
