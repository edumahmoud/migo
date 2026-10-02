import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

// Import payment core (registers Paymob adapter)
import '@/lib/payment/providers/paymob';
import '@/lib/payment/providers/fawry';
import {
  listGateways,
  createGateway,
  getDefaultGateway,
  setGatewayEnabled,
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

  // Auto-default + auto-enable logic (Fix: gateway "not configured" error
  // even after admin configured Paymob in sandbox mode).
  //
  // ROOT CAUSE: The admin UI's AddGatewayDialog does NOT send `setAsDefault`
  // in the POST body. The backend defaulted to `setAsDefault: false` +
  // `is_enabled: false`. The admin then had to MANUALLY click "Enable"
  // + "Set as Default" separately — a 3-step process. If they forgot
  // either step, `getDefaultGateway()` returned null → categorized as
  // GATEWAY_NOT_CONFIGURED → student sees "بوابة الدفع غير مُهيّأة".
  //
  // FIX:
  //   - If `setAsDefault` is explicitly provided (true/false), honor it.
  //   - If `setAsDefault` is undefined (admin UI default), auto-determine:
  //     if no other default gateway exists in the DB, auto-set this one
  //     as default. This makes the admin's FIRST gateway automatically
  //     the default — they don't need to click "Set as Default" manually.
  //   - Auto-enable on creation (`is_enabled = true`). The admin can
  //     always disable later via the "تعطيل" button. This eliminates
  //     the need to click "تفعيل" separately.
  let resolvedSetAsDefault: boolean;
  if (typeof setAsDefault === 'boolean') {
    resolvedSetAsDefault = setAsDefault;
  } else {
    // Auto-determine: if no default gateway exists, make this one the default
    const existingDefault = await getDefaultGateway();
    resolvedSetAsDefault = existingDefault === null;
  }

  const input: CreateGatewayInput = {
    provider,
    displayName,
    environment,
    credentials: credentials || undefined,
    configuration: configuration || undefined,
    capabilities: GatewayRegistry.getCapabilities(provider),
    setAsDefault: resolvedSetAsDefault,
  };

  try {
    const gatewayId = await createGateway(input);

    // Auto-enable the gateway on creation (the admin can disable later).
    // The createGateway function sets `is_enabled: false` by default —
    // we override it here so the admin doesn't need a separate "Enable" click.
    await setGatewayEnabled(gatewayId, true);

    await auditGatewayCreated(gatewayId, provider, authResult.user.id);

    logPaymentEvent({
      level: 'info',
      operation: 'gatewayManagement',
      provider,
      success: true,
      message: `Gateway created: ${displayName} (${environment}) — auto-enabled${resolvedSetAsDefault ? ' + set as default' : ''}`,
    });

    return NextResponse.json({
      success: true,
      gatewayId,
      message: `تم إنشاء بوابة الدفع بنجاح${resolvedSetAsDefault ? ' وتعيينها كافتراضية' : ''} وتفعيلها تلقائيًا`,
    });
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
