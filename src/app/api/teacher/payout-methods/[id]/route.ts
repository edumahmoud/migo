import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import {
  updatePayoutMethod,
  softDisablePayoutMethod,
  hardDeletePayoutMethod,
  getPayoutMethodForTeacher,
} from '@/lib/payment/payout-methods-repository';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * PATCH /api/teacher/payout-methods/[id]
 *
 * Update a payout method owned by the authenticated teacher.
 * - `teacher_id` from session only (NEVER from body).
 * - IDOR defense: WHERE clause includes both `id` AND `teacher_id`.
 * - Allowed updates: `display_label`, `details` (partial patch — merged
 *   with existing decrypted details, then re-validated + re-encrypted).
 * - Immutable: `id`, `teacher_id`, `method_type` (changing method_type
 *   requires disabling this method + creating a new one — audit history
 *   preserved).
 *
 * Body (any subset):
 *   {
 *     display_label?: string,
 *     details?: Record<string, unknown>,  // partial patch — merge with existing
 *   }
 *
 * Examples:
 *   PATCH with details: { holder_name: 'New Name' }   // updates only holder_name
 *   PATCH with details: { last4: '5678', expiry_month: '12' }  // updates bank_card fields
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

  // Fetch the existing method to verify ownership (the repository does
  // this again, but doing it here lets us return a clean 404 before
  // any encryption work).
  const existing = await getPayoutMethodForTeacher(id, teacherId);
  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك' },
      { status: 404 }
    );
  }

  // Validate display_label if provided
  let displayLabel: string | undefined;
  if (body.display_label !== undefined) {
    displayLabel = String(body.display_label).trim();
    if (displayLabel.length < 2 || displayLabel.length > 100) {
      return NextResponse.json(
        { success: false, error: 'اسم العرض يجب أن يكون 2-100 حرف' },
        { status: 400 }
      );
    }
  }

  // Validate details patch if provided — must be a plain object
  let detailsPatch: Record<string, unknown> | undefined;
  if (body.details !== undefined) {
    if (typeof body.details !== 'object' || body.details === null || Array.isArray(body.details)) {
      return NextResponse.json(
        { success: false, error: 'details يجب أن يكون كائنًا (object)' },
        { status: 400 }
      );
    }
    detailsPatch = body.details as Record<string, unknown>;
    if (Object.keys(detailsPatch).length === 0) {
      return NextResponse.json(
        { success: false, error: 'details لا يمكن أن يكون فارغًا' },
        { status: 400 }
      );
    }
  }

  // Apply the update via repository (re-encrypts if details patch is present)
  try {
    const result = await updatePayoutMethod(
      {
        id,
        teacherId,
        displayLabel,
        detailsPatch,
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
    if (message.includes('هذه الوسيلة مسجلة')) {
      return NextResponse.json({ success: false, error: message }, { status: 409 });
    }
    if (message.includes('encryption key')) {
      return NextResponse.json(
        { success: false, error: 'مفتاح التشفير غير مضبوط. تواصل مع الإدارة.' },
        { status: 500 }
      );
    }
    if (message.includes('Validation failed')) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/teacher/payout-methods/[id]
 *
 * Hard-delete (permanently remove) a payout method.
 * The encrypted details are also deleted (not recoverable).
 * Audit log is written BEFORE deletion (payout_method.deleted event).
 *
 * Query param: ?soft=true → soft-disable instead of hard-delete.
 *
 * IDOR defense: WHERE clause includes both `id` AND `teacher_id`.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;
  const { id } = await ctx.params;

  // Check ?soft=true query param — if set, soft-disable instead of hard-delete
  const soft = new URL(request.url).searchParams.get('soft') === 'true';

  if (soft) {
    try {
      const result = await softDisablePayoutMethod(id, teacherId, teacherId);
      if (!result.disabled) {
        return NextResponse.json(
          { success: false, error: 'الوسيلة غير موجودة أو غير مملوكة لك' },
          { status: 404 },
        );
      }
      return NextResponse.json({
        success: true,
        id,
        message: 'تم تعطيل الوسيلة. البيانات محفوظة للسجل التاريخي.',
      });
    } catch (err) {
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'فشل التعطيل' },
        { status: 500 },
      );
    }
  }

  // Hard-delete: permanently remove the payout method
  try {
    const result = await hardDeletePayoutMethod(id, teacherId, teacherId);
    if (!result.deleted) {
      return NextResponse.json(
        { success: false, error: 'تعذّر حذف الوسيلة. حاول مرة أخرى.' },
        { status: 500 },
      );
    }
    return NextResponse.json({
      success: true,
      id,
      message: 'تم حذف الوسيلة نهائيًا.',
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'فشل الحذف' },
      { status: 500 },
    );
  }
}
