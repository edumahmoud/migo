import { NextRequest, NextResponse } from 'next/server';
import { processPayoutWebhook } from '@/lib/payment/payout-domain/service';
import {
  verifyPayoutWebhookSignature,
  PAYOUT_WEBHOOK_SIGNATURE_HEADER,
} from '@/lib/payment/payout-domain/webhook-security';

/**
 * POST /api/payout/webhook
 *
 * Provider-agnostic webhook handler. Receives normalized status
 * updates from payout providers.
 *
 * SECURITY (Phase 13 Hardening):
 *   - Every request MUST carry a valid HMAC-SHA512 signature in the
 *     `X-Payout-Webhook-Signature` header, computed over the RAW
 *     request body using the server-side `PAYOUT_WEBHOOK_SECRET`
 *     environment variable. The signature is verified with
 *     constant-time comparison (timingSafeEqual) — the same pattern
 *     used for Paymob payment webhook verification.
 *   - If the secret is not configured, the webhook FAILS CLOSED —
 *     every request is rejected with 401.
 *   - The secret is NEVER logged, returned in responses, or exposed
 *     to client code.
 *   - Only AFTER signature verification does the handler trust the
 *     `provider_reference` + `status` fields.
 *   - It NEVER trusts client-controlled teacher_id or payout_id.
 *   - It's idempotent — duplicate webhooks are safe.
 *
 * Expected body (after signature verification):
 *   {
 *     "provider_reference": "string",
 *     "status": "completed" | "failed",
 *     "failure_reason": "string" (optional, when status=failed)
 *   }
 *
 * Signature header:
 *   X-Payout-Webhook-Signature: <lowercase hex HMAC-SHA512>
 *   Computed over the RAW request body (UTF-8), NOT the parsed JSON.
 */
export async function POST(request: NextRequest) {
  // 1. Capture the RAW body BEFORE any parsing — required for HMAC
  //    verification (parsing JSON first would lose original byte
  //    representation: whitespace, key ordering, number formatting).
  const rawBody = await request.text();

  // 2. Verify the webhook signature. Fail-closed if the secret is not
  //    configured, the header is missing, the header is malformed,
  //    or the signature does not match.
  const signatureHeader = request.headers.get(PAYOUT_WEBHOOK_SIGNATURE_HEADER);
  if (!verifyPayoutWebhookSignature(rawBody, signatureHeader)) {
    // 401 Unauthorized — do NOT disclose which check failed
    // (missing vs invalid vs unconfigured). The same status code is
    // returned for all failure modes to avoid leaking information
    // to attackers probing the endpoint.
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  // 3. NOW safe to parse the verified body
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const providerRef = String(body.provider_reference ?? '').trim();
  const status = String(body.status ?? '').trim();

  if (!providerRef || !['completed', 'failed'].includes(status)) {
    return NextResponse.json(
      { success: false, error: 'Missing provider_reference or invalid status' },
      { status: 400 },
    );
  }

  // 4. Process the verified webhook. The service layer enforces
  //    idempotency + valid status transitions + audit logging.
  const result = await processPayoutWebhook({
    providerReference: providerRef,
    status: status as 'completed' | 'failed',
    failureReason: body.failure_reason ? String(body.failure_reason) : undefined,
  });

  return NextResponse.json({
    success: true,
    processed: result.processed,
    payout_id: result.payoutId,
  });
}
