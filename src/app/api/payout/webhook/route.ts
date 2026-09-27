import { NextRequest, NextResponse } from 'next/server';
import { processPayoutWebhook } from '@/lib/payment/payout-domain/service';

/**
 * POST /api/payout/webhook
 *
 * Provider-agnostic webhook handler. Receives normalized status
 * updates from payout providers.
 *
 * SECURITY:
 *   - Webhook signature verification is provider-specific.
 *     The caller (or middleware) should authenticate the source
 *     before this handler is reached.
 *   - This handler trusts ONLY the provider_reference + status.
 *   - It NEVER trusts client-controlled teacher_id or payout_id.
 *   - It's idempotent — duplicate webhooks are safe.
 *
 * Expected body:
 *   {
 *     "provider_reference": "string",
 *     "status": "completed" | "failed",
 *     "failure_reason": "string" (optional, when status=failed)
 *   }
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const providerRef = String(body.provider_reference ?? '').trim();
  const status = String(body.status ?? '').trim();

  if (!providerRef || !['completed', 'failed'].includes(status)) {
    return NextResponse.json({ success: false, error: 'Missing provider_reference or invalid status' }, { status: 400 });
  }

  const result = await processPayoutWebhook({
    providerReference: providerRef,
    status: status as 'completed' | 'failed',
    failureReason: body.failure_reason ? String(body.failure_reason) : undefined,
  });

  return NextResponse.json({ success: true, processed: result.processed, payout_id: result.payoutId });
}
