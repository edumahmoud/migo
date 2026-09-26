/**
 * Payment Gateway Core — Gateway Resolver
 *
 * Responsible for:
 *   1. Finding the appropriate gateway config from the database.
 *   2. Verifying the gateway is enabled.
 *   3. Verifying the adapter is implemented (registered in GatewayRegistry).
 *   4. Returning the adapter + decrypted credentials to the caller.
 *
 * The resolver enforces the separation between "configured" (exists
 * in DB) and "usable" (adapter is implemented + gateway is enabled).
 *
 * A gateway that is configured but has no implemented adapter is
 * NOT usable → throws GatewayNotImplementedError.
 * A gateway that is disabled is NOT usable → throws GatewayDisabledError.
 */

import { getDefaultGateway, getGateway, getGatewayById, type ResolvedGateway } from './repository';
import { GatewayRegistry } from './registry';
import {
  GatewayNotFoundError,
  GatewayDisabledError,
  GatewayNotImplementedError,
  CredentialsMissingError,
} from './errors';
import type { PaymentGateway, GatewayProvider, GatewayEnvironment } from './types';
import { logPaymentEvent } from './logger';

export interface ResolvedAdapter {
  gateway: ResolvedGateway;        // the DB config (with decrypted credentials)
  adapter: PaymentGateway;          // the adapter instance
}

/**
 * Resolve the default gateway → adapter.
 * This is the main entry point for PaymentService.
 *
 * Flow:
 *   1. Fetch the default gateway from DB (is_default=true).
 *   2. If not found → GatewayNotFoundError.
 *   3. If not enabled → GatewayDisabledError.
 *   4. If adapter not registered → GatewayNotImplementedError.
 *   5. If credentials missing → CredentialsMissingError.
 *   6. Return { gateway, adapter }.
 */
export async function resolveDefaultGateway(): Promise<ResolvedAdapter> {
  const gateway = await getDefaultGateway();

  if (!gateway) {
    logPaymentEvent({
      level: 'warn',
      operation: 'resolveGateway',
      success: false,
      errorCode: 'GATEWAY_NOT_FOUND',
      message: 'No default gateway configured',
    });
    throw new GatewayNotFoundError();
  }

  return resolveGateway(gateway);
}

/**
 * Resolve a specific gateway by provider + environment.
 */
export async function resolveGatewayByProvider(
  provider: GatewayProvider,
  environment: GatewayEnvironment = 'sandbox',
): Promise<ResolvedAdapter> {
  const gateway = await getGateway(provider, environment);

  if (!gateway) {
    throw new GatewayNotFoundError(provider);
  }

  return resolveGateway(gateway);
}

/**
 * Resolve a gateway by its database ID.
 */
export async function resolveGatewayById(id: string): Promise<ResolvedAdapter> {
  const gateway = await getGatewayById(id);

  if (!gateway) {
    throw new GatewayNotFoundError();
  }

  return resolveGateway(gateway);
}

// ─── Internal: validate + resolve ───

function resolveGateway(gateway: ResolvedGateway): ResolvedAdapter {
  // 1. Check enabled
  if (!gateway.isEnabled) {
    logPaymentEvent({
      level: 'warn',
      operation: 'resolveGateway',
      provider: gateway.provider,
      success: false,
      errorCode: 'GATEWAY_DISABLED',
      message: `Gateway '${gateway.provider}' is disabled`,
    });
    throw new GatewayDisabledError(gateway.provider);
  }

  // 2. Check adapter is implemented (registered in the registry)
  if (!GatewayRegistry.has(gateway.provider)) {
    logPaymentEvent({
      level: 'warn',
      operation: 'resolveGateway',
      provider: gateway.provider,
      success: false,
      errorCode: 'GATEWAY_NOT_IMPLEMENTED',
      message: `No adapter registered for '${gateway.provider}'`,
    });
    throw new GatewayNotImplementedError(gateway.provider);
  }

  // 3. Check credentials exist
  if (Object.keys(gateway.credentials).length === 0) {
    logPaymentEvent({
      level: 'warn',
      operation: 'resolveGateway',
      provider: gateway.provider,
      success: false,
      errorCode: 'CREDENTIALS_MISSING',
      message: `No credentials configured for '${gateway.provider}'`,
    });
    throw new CredentialsMissingError(gateway.provider);
  }

  // 4. Get the adapter instance
  const adapter = GatewayRegistry.get(gateway.provider);

  logPaymentEvent({
    level: 'info',
    operation: 'resolveGateway',
    provider: gateway.provider,
    success: true,
    message: `Gateway resolved: ${gateway.displayName} (${gateway.environment})`,
  });

  return { gateway, adapter };
}
