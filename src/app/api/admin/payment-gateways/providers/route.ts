import { NextRequest, NextResponse } from 'next/server';

// Import payment core (registers Paymob adapter)
import '@/lib/payment/providers/paymob';
import { GatewayRegistry } from '@/lib/payment';
import { listProviderSchemas } from '@/lib/payment/provider-schemas';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/payment-gateways/providers
 *
 * Returns the list of available payment providers + their credential/
 * configuration field schemas. The admin UI uses this to render the
 * Add/Edit form dynamically (provider-aware, not Paymob-specific).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  // Get registered providers from the GatewayRegistry (which adapters
  // are actually implemented)
  const registeredProviders = GatewayRegistry.listProviders();

  // Get field schemas for each provider
  const allSchemas = listProviderSchemas();

  // Merge: only return schemas for providers that have an adapter registered
  const providers = allSchemas
    .filter(schema => registeredProviders.includes(schema.provider))
    .map(schema => ({
      ...schema,
      isImplemented: true,
    }));

  return NextResponse.json({ success: true, providers });
}
