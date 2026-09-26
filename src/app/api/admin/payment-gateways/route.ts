import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

// Import payment core (registers Paymob adapter)
import '@/lib/payment/providers/paymob';
import {
  listGateways,
  createGateway,
  type CreateGatewayInput,
} from '@/lib/payment';
import { GatewayRegistry } from '@/lib/payment';
import { listProviderSchemas, getProviderSchema, validateRequiredCredentialFields } from '@/lib/payment/provider-schemas';
import { auditGatewayCreated } from '@/lib/payment/audit';
import { logPaymentEvent } from '@/lib/payment/logger';

/**
 * GET /api/admin/payment-gateways
 * Lists all payment gateways (metadata only — no credentials).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const gateways = await listGateways();
  return NextResponse.json({ success: true, gateways });
}

/**
 * POST /api/admin/payment-gateways
 * Creates a new payment gateway. Credentials are encrypted before storage.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const provider = body.provider as string;
  const displayName = body.displayName as string;
  const environment = body.environment as 'sandbox' | 'live';
  const credentials = body.credentials as Record<string, unknown> | undefined;
  const configuration = body.configuration as Record<string, unknown> | undefined;
  const setAsDefault = body.setAsDefault as boolean | undefined;

  if (!provider || !displayName || !environment) {
    return NextResponse.json({ success: false, error: 'الحقول المطلوبة: provider, displayName, environment' }, { status: 400 });
  }

  // Check the provider is implemented (adapter is registered)
  if (!GatewayRegistry.has(provider)) {
    return NextResponse.json({ success: false, error: `المزود '${provider}' غير مُنفَّذ (لا يوجد adapter مسجل)` }, { status: 400 });
  }

  // Validate required credential fields against the provider's schema.
  // This catches missing required fields at creation time (fail-fast)
  // instead of waiting until the adapter throws at payment time.
  // The validation is GENERIC — works for any provider's schema.
  const schema = getProviderSchema(provider);
  if (schema) {
    const missingFields = validateRequiredCredentialFields(schema, credentials);
    if (missingFields.length > 0) {
      return NextResponse.json(
        { success: false, error: `الحقول المطلوبة مفقودة: ${missingFields.join('، ')}` },
        { status: 400 },
      );
    }
  }

  const input: CreateGatewayInput = {
    provider,
    displayName,
    environment,
    credentials: credentials || undefined,
    configuration: configuration || undefined,
    capabilities: GatewayRegistry.getCapabilities(provider),
    setAsDefault: setAsDefault || false,
  };

  try {
    const gatewayId = await createGateway(input);
    await auditGatewayCreated(gatewayId, provider, authResult.user.id);

    logPaymentEvent({
      level: 'info',
      operation: 'gatewayManagement',
      provider,
      success: true,
      message: `Gateway created: ${displayName} (${environment})`,
    });

    return NextResponse.json({ success: true, gatewayId, message: 'تم إنشاء بوابة الدفع بنجاح' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل إنشاء البوابة';
    logPaymentEvent({
      level: 'error',
      operation: 'gatewayManagement',
      provider,
      success: false,
      message,
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
