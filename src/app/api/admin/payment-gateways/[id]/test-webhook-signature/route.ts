import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { createHmac } from 'crypto';
import { logPaymentEvent } from '@/lib/payment/logger';

// Import payment core (registers Paymob adapter)
import '@/lib/payment/providers/paymob';
import '@/lib/payment/providers/fawry';
import { verifyPaymobHmac } from '@/lib/payment/providers/paymob/hmac';
import type { PaymobCallbackPayload } from '@/lib/payment/providers/paymob/types';
import { PAYMOB_HMAC_FIELDS } from '@/lib/payment/providers/paymob/types';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/payment-gateways/[id]/test-webhook-signature
 *
 * Tests the Paymob HMAC webhook verification pipeline end-to-end
 * WITHOUT making a real payment. Generates a synthetic Paymob
 * callback payload, signs it with the gateway's stored HMAC secret,
 * then runs it through the SAME verifyPaymobHmac() function that
 * the actual webhook handler uses.
 *
 * Useful for:
 *   - Verifying the HMAC secret is correctly configured
 *   - Catching secret rotation drift before real webhooks fail
 *   - Debugging "HMAC signature mismatch" errors
 *   - Sanity-checking after deploying a new Paymob integration
 *
 * Flow:
 *   1. Fetch the gateway config + decrypt credentials.
 *   2. Build a sample Paymob callback obj (covers all 17 HMAC fields).
 *   3. Sign it with HMAC-SHA512 using the stored HMAC secret.
 *   4. Build the full payload { type, obj, hmac }.
 *   5. Call verifyPaymobHmac(payload, secret) — the same function
 *      the production webhook uses.
 *   6. Also run a tamper test — flip one field, keep the original
 *      HMAC, confirm the verifier REJECTS it.
 *   7. Return { ok: true, signedCorrectly, tamperRejected, ... }
 *      with NO secrets exposed.
 *
 * Security:
 *   - admin/superadmin only
 *   - HMAC secret is fetched but never returned in the response
 *   - The synthetic payload is clearly marked as a test
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id: gatewayId } = await ctx.params;

  // 1. Fetch the gateway config + decrypt credentials
  const { data: gateway, error: gwErr } = await supabaseServer
    .from('payment_gateways')
    .select('id, provider, display_name, is_enabled, environment, credentials_encrypted')
    .eq('id', gatewayId)
    .maybeSingle();

  if (gwErr || !gateway) {
    return NextResponse.json(
      { success: false, error: 'البوابة غير موجودة' },
      { status: 404 },
    );
  }

  const g = gateway as {
    id: string;
    provider: string;
    display_name: string;
    is_enabled: boolean;
    environment: string;
    credentials_encrypted: string | null;
  };

  if (g.provider !== 'paymob') {
    return NextResponse.json(
      { success: false, error: 'اختبار توقيع الـ webhook متاح فقط لبوابات Paymob' },
      { status: 400 },
    );
  }

  // Decrypt credentials to extract the HMAC secret
  let hmacSecret = '';
  try {
    const { decrypt } = await import('@/lib/payment/crypto');
    if (!g.credentials_encrypted) {
      return NextResponse.json(
        { success: false, error: 'لا توجد بيانات اعتماد مشفرة لهذه البوابة' },
        { status: 400 },
      );
    }
    const creds = decrypt(g.credentials_encrypted) as Record<string, string>;
    hmacSecret = creds.hmacSecret || creds.hmac_secret || '';
    if (!hmacSecret) {
      return NextResponse.json(
        { success: false, error: 'مفتاح HMAC غير موجود في بيانات الاعتماد' },
        { status: 400 },
      );
    }
  } catch (err) {
    logPaymentEvent({
      level: 'error',
      operation: 'gatewayManagement',
      provider: g.provider,
      success: false,
      message: `Webhook signature test — credential decrypt failed: ${err instanceof Error ? err.message : 'unknown'}`,
    });
    return NextResponse.json(
      { success: false, error: 'فشل فك تشفير بيانات الاعتماد' },
      { status: 500 },
    );
  }

  // 2. Build a sample Paymob callback obj (covers all 17 HMAC fields)
  const sampleObj: Record<string, unknown> = {
    amount_cents: 10000,
    created_at: '2026-09-30T12:00:00Z',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 'test_txn_12345',
    integration_id: 12345,
    is_3D_secure_authentication: false,
    is_refunded: false,
    is_standalone_payment: true,
    order: 'test_order_67890',
    owner: 'test_owner',
    pending: false,
    source_data: {
      pan: '49**********1111',
      sub_type: 'CARD',
      type: 'card',
    },
    success: true,
  };

  // 3. Sign it with HMAC-SHA512 using the stored secret
  //    (mirrors the same field extraction + sort + concat that
  //    verifyPaymobHmac() expects)
  const sortedFields = [...PAYMOB_HMAC_FIELDS].sort();
  const parts = sortedFields.map((f) => {
    if (f.startsWith('source_data_')) {
      const sub = f.replace('source_data_', '');
      const sd = sampleObj['source_data'] as Record<string, unknown> | undefined;
      const v = sd?.[sub];
      return v !== undefined && v !== null ? String(v) : '';
    }
    if (f === 'order') {
      const o = sampleObj['order'];
      if (o && typeof o === 'object') {
        const oid = (o as Record<string, unknown>)?.id;
        return oid !== undefined ? String(oid) : '';
      }
      return o !== undefined && o !== null ? String(o) : '';
    }
    const v = sampleObj[f];
    return v !== undefined && v !== null ? String(v) : '';
  });
  const computedHmac = createHmac('sha512', hmacSecret)
    .update(parts.join(''), 'utf8')
    .digest('hex');

  // 4. Build the full payload
  const payload: PaymobCallbackPayload = {
    type: 'transaction',
    obj: sampleObj as PaymobCallbackPayload['obj'],
    hmac: computedHmac,
  };

  // 5. Run verifyPaymobHmac — same function the production webhook uses
  let verifyPassed = false;
  let verifyError: string | undefined;
  try {
    verifyPaymobHmac(payload, hmacSecret);
    verifyPassed = true;
  } catch (err) {
    verifyError = err instanceof Error ? err.message : 'unknown error';
  }

  // 6. Tamper test — flip one field but keep the ORIGINAL hmac → must be rejected
  const tamperedPayload: PaymobCallbackPayload = {
    type: 'transaction',
    obj: { ...sampleObj, amount_cents: 1 } as PaymobCallbackPayload['obj'],
    hmac: computedHmac, // still the ORIGINAL hmac → should NOT match the tampered obj
  };
  let tamperRejected = false;
  let tamperError: string | undefined;
  try {
    verifyPaymobHmac(tamperedPayload, hmacSecret);
    tamperRejected = false; // if verifyPaymobHmac didn't throw, the verifier is broken
  } catch (err) {
    tamperRejected = true;
    tamperError = err instanceof Error ? err.message : 'unknown error';
  }

  logPaymentEvent({
    level: 'info',
    operation: 'gatewayManagement',
    provider: g.provider,
    success: verifyPassed && tamperRejected,
    message: `Webhook signature test: signed=${verifyPassed}, tamper_rejected=${tamperRejected}`,
  });

  return NextResponse.json({
    success: true,
    gateway: {
      id: g.id,
      provider: g.provider,
      display_name: g.display_name,
      is_enabled: g.is_enabled,
      environment: g.environment,
    },
    test: {
      signedCorrectly: verifyPassed,
      verifyError,
      tamperRejected,
      tamperError,
      hmacFieldCount: PAYMOB_HMAC_FIELDS.length,
      computedHmacLength: computedHmac.length, // expected 128 hex chars for SHA-512
      // Don't expose the secret or the actual hmac value
    },
    overallPass: verifyPassed && tamperRejected,
    message: verifyPassed && tamperRejected
      ? '✅ تم اختبار HMAC بنجاح — التوقيع صحيح والتعديل مرفوض'
      : `⚠️ فشل في اختبار HMAC: signed=${verifyPassed}, tamper_rejected=${tamperRejected}`,
  });
}
