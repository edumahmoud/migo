import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import {
  listPayoutMethods,
  createPayoutMethod,
} from '@/lib/payment/payout-methods-repository';
import {
  isSupportedPayoutMethodType,
} from '@/lib/payment/payout-method-schemas';

/**
 * GET /api/teacher/payout-methods
 *
 * Returns the authenticated teacher's payout methods (active + disabled).
 * - `teacher_id` comes from the server-side session (`requireTeacher().user.id`).
 * - NEVER accepted from query params / body / headers.
 * - Returns ONLY safe metadata: `details_masked`, never `details_encrypted`.
 *
 * Query params:
 *   - include_inactive=true — include soft-disabled methods (default: false)
 *
 * Response shape:
 *   {
 *     success: true,
 *     methods: PayoutMethodMetadata[],
 *   }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;

  const url = new URL(request.url);
  const includeInactive = url.searchParams.get('include_inactive') === 'true';

  const methods = await listPayoutMethods(teacherId, { includeInactive });

  return NextResponse.json({
    success: true,
    methods,
  });
}

/**
 * POST /api/teacher/payout-methods
 *
 * Create a new payout method for the authenticated teacher.
 * - `teacher_id` is taken from the server-side session.
 * - NEVER accepted from the body (defense against IDOR).
 * - Validates `method_type` + `details` object server-side.
 * - Encrypts the entire `details` object via AES-256-GCM before storage.
 * - Stores only the masked summary in plaintext.
 *
 * After the Phase 13 Step 1 Architecture Correction, `method_type` is one
 * of the generic types: 'wallet' | 'bank_account' | 'bank_card' | 'instapay'.
 * The `details` object's shape depends on `method_type` (validated
 * against the schema in payout-method-schemas.ts).
 *
 * Body shape:
 *   {
 *     method_type: 'wallet' | 'bank_account' | 'bank_card' | 'instapay',
 *     display_label: string,
 *     details: Record<string, unknown>,  // type-specific shape
 *     set_as_default?: boolean,
 *   }
 *
 * Examples:
 *   {
 *     method_type: 'wallet',
 *     display_label: 'محفظتي',
 *     details: { wallet_number: '01012345678', holder_name: 'محمود أحمد' }
 *   }
 *   {
 *     method_type: 'bank_card',
 *     display_label: 'بطاقتي',
 *     details: { last4: '5678', expiry_month: '12', expiry_year: '28', holder_name: 'محمود أحمد' }
 *   }
 *
 * Returns:
 *   { success: true, id, masked }  — masked is the safe summary string
 */
export async function POST(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id; // server-side authoritative

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة الطلب غير صحيحة' },
      { status: 400 }
    );
  }

  // ─── Server-side validation ───

  // 1. method_type — must be one of the generic supported types
  const methodType = String(body.method_type ?? '').trim();
  if (!methodType) {
    return NextResponse.json(
      { success: false, error: 'نوع الوسيلة مطلوب' },
      { status: 400 }
    );
  }
  if (!isSupportedPayoutMethodType(methodType)) {
    return NextResponse.json(
      { success: false, error: `نوع الوسيلة غير مدعوم: ${methodType}` },
      { status: 400 }
    );
  }

  // 2. display_label
  const displayLabel = String(body.display_label ?? '').trim();
  if (!displayLabel || displayLabel.length < 2) {
    return NextResponse.json(
      { success: false, error: 'اسم العرض مطلوب (2 أحرف على الأقل)' },
      { status: 400 }
    );
  }
  if (displayLabel.length > 100) {
    return NextResponse.json(
      { success: false, error: 'اسم العرض يتجاوز 100 حرف' },
      { status: 400 }
    );
  }

  // 3. details — must be a non-empty object (shape validated by the repository)
  const details = body.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return NextResponse.json(
      { success: false, error: 'البيانات مطلوبة (details object)' },
      { status: 400 }
    );
  }
  const detailsObj = details as Record<string, unknown>;
  if (Object.keys(detailsObj).length === 0) {
    return NextResponse.json(
      { success: false, error: 'البيانات مطلوبة (details object)' },
      { status: 400 }
    );
  }

  // 4. set_as_default (optional boolean)
  const setAsDefault = body.set_as_default === true;

  // ─── Create via repository (schema validation + encryption + audit handled there) ───
  try {
    const result = await createPayoutMethod(
      {
        teacherId,
        methodType,
        displayLabel,
        details: detailsObj,
        setAsDefault,
      },
      teacherId // actor = the teacher themselves
    );

    return NextResponse.json({
      success: true,
      id: result.id,
      masked: result.masked,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل الإنشاء';
    // Map known errors to specific status codes
    if (message.includes('هذه الوسيلة مسجلة')) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 409 }
      );
    }
    if (message.includes('EncryptionKeyMissing') || message.includes('encryption key')) {
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
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}
