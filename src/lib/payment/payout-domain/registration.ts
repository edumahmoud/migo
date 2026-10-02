/**
 * Payout Adapter Registration — Phase 13 Step 4
 *
 * Registers the development stub adapter with the
 * PayoutProviderRegistry. This enables the payout execution
 * domain to resolve a provider for any method_type + EGP currency
 * during development/testing.
 *
 * NO real provider (Paymob/Fawry/InstaPay/wallet/bank) is
 * registered here. Real providers will be added in future steps.
 *
 * To use in production: unregister the dev stub and register
 * real provider adapters instead.
 */

import { PayoutProviderRegistry } from './provider-registry';
import { devStubPayoutAdapter } from './adapters/dev-stub-adapter';

/**
 * Register the development stub adapter.
 * Safe to call multiple times — checks if already registered.
 */
export function registerDevStubAdapter(): void {
  if (!PayoutProviderRegistry.getProvider('dev-stub')) {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
  }
}

/**
 * Unregister the development stub adapter.
 * Call this before registering real providers in production.
 */
export function unregisterDevStubAdapter(): void {
  PayoutProviderRegistry.unregister('dev-stub');
}

// Auto-register for development/testing environments.
// In production, this should be conditionally loaded or replaced.
registerDevStubAdapter();
