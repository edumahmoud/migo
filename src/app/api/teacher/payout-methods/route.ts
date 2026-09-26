import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import {
  listPayoutMethods,
  createPayoutMethod,
} from '@/lib/payment/payout-methods-repository';
import {
  getPayoutMethodSchema,
  validatePayoutMethodDetails,
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
 * - Validates `method_type`, `wallet_number`, `holder_name` server-side.
 * - Encrypts `wallet_number` + `holder_name` via AES-256-GCM before storage.
 * - Stores only the masked summary in plaintext.
 *
 * Body shape:
 *   {
 *     method_type: 'vodafone_cash' | 'etisalat_cash' | 'orange_cash' | 'we_cash',
 *     display_label: string,
 *     wallet_number: string,    // 11-digit Egyptian mobile
 *     holder_name: string,
 *     set_as_default?: boolean,
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

  // 1. method_type
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

  // 3. wallet_number + holder_name (validate via schema)
  const walletNumber = String(body.wallet_number ?? '').trim();
  const holderName = String(body.holder_name ?? '').trim();
  const schema = getPayoutMethodSchema(methodType)!;
  const validationErrors = validatePayoutMethodDetails(schema, {
    wallet_number: walletNumber,
    holder_name: holderName,
  });
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { success: false, error: validationErrors.join(' | ') },
      { status: 400 }
    );
  }

  // 4. set_as_default (optional boolean)
  const setAsDefault = body.set_as_default === true;

  // ─── Create via repository (encryption + audit handled there) ───
  try {
    const result = await createPayoutMethod(
      {
        teacherId,
        methodType,
        displayLabel,
        walletNumber,
        holderName,
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
    if (message.includes('هذه المحفظة مسجلة')) {
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
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}
