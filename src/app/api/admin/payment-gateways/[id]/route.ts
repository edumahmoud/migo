import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import '@/lib/payment/providers/paymob';
import { getGatewayById, updateGatewayConfig } from '@/lib/payment';
import { getProviderSchema, validateRequiredCredentialFields } from '@/lib/payment/provider-schemas';
import { auditGatewayUpdated } from '@/lib/payment/audit';
import { logPaymentEvent } from '@/lib/payment/logger';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * GET /api/admin/payment-gateways/[id]
 * Returns gateway metadata + decrypted CONFIGURATION (non-secret).
 * Does NOT return decrypted credentials.
 */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;
  const gateway = await getGatewayById(id);

  if (!gateway) {
    return NextResponse.json({ success: false, error: 'البوابة غير موجودة' }, { status: 404 });
  }

  // Return metadata + configuration (non-secret) but strip credentials
  return NextResponse.json({
    success: true,
    gateway: {
      id: gateway.id,
      provider: gateway.provider,
      displayName: gateway.displayName,
      environment: gateway.environment,
      isEnabled: gateway.isEnabled,
      isDefault: gateway.isDefault,
      capabilities: gateway.capabilities,
      configuration: gateway.configuration, // non-secret (URLs, payment methods)
      // credentials: deliberately omitted
    },
  });
}

/**
 * PATCH /api/admin/payment-gateways/[id]
 * Updates gateway credentials and/or configuration.
 * Credentials are encrypted before storage.
 * If credentials fields are empty → keeps existing encrypted credentials.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const credentials = body.credentials as Record<string, unknown> | undefined;
  const configuration = body.configuration as Record<string, unknown> | undefined;

  // Only update if at least one of credentials/configuration is provided
  // and not empty
  const hasCredentials = credentials && Object.keys(credentials).length > 0
    && Object.values(credentials).some(v => v !== '' && v !== undefined && v !== null);
  const hasConfiguration = configuration && Object.keys(configuration).length > 0;

  if (!hasCredentials && !hasConfiguration) {
    return NextResponse.json({ success: false, error: 'لا توجد بيانات للتحديث' }, { status: 400 });
  }

  // If credentials are provided, validate ALL required fields are present.
  // This prevents partial credential updates that would overwrite the
  // entire encrypted blob and lose existing required fields.
  // (If credentials are NOT provided → keeps existing — no validation needed.)
  if (hasCredentials) {
    // Fetch the gateway's provider (lightweight — no credential decryption)
    const { data: gw } = await supabaseServer
      .from('payment_gateways')
      .select('provider')
      .eq('id', id)
      .maybeSingle();
    const provider = (gw as { provider: string } | null)?.provider;
    const schema = provider ? getProviderSchema(provider) : null;

    if (schema) {
      const missingFields = validateRequiredCredentialFields(schema, credentials);
      if (missingFields.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `عند تحديث بيانات الدخول، يجب تعبئة جميع الحقول المطلوبة: ${missingFields.join('، ')}`,
          },
          { status: 400 },
        );
      }
    }
  }

  try {
    await updateGatewayConfig(
      id,
      hasCredentials ? credentials : undefined,
      hasConfiguration ? configuration : undefined,
    );

    await auditGatewayUpdated(id, { credentials: !!hasCredentials, configuration: !!hasConfiguration }, authResult.user.id);

    logPaymentEvent({
      level: 'info',
      operation: 'gatewayManagement',
      success: true,
      message: `Gateway ${id} updated`,
    });

    return NextResponse.json({ success: true, message: 'تم تحديث البوابة بنجاح' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل التحديث';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
