/**
 * Payment Gateway Core — Gateway Registry
 *
 * Central registry that maps provider names to adapter instances.
 * Adapters are registered here at module load time.
 *
 * The application code NEVER branches on provider name — it asks
 * the registry for the adapter, and if it's not registered, the
 * caller gets a GatewayNotImplementedError.
 *
 * Usage (in Phase 4):
 *   import { PaymobAdapter } from './adapters/paymob';
 *   GatewayRegistry.register('paymob', new PaymobAdapter());
 *
 * Phase 3: no adapters are registered yet. The registry exists but
 * is empty. This is intentional — the architecture is ready but
 * no provider is implemented.
 */

import type { PaymentGateway, GatewayProvider, GatewayCapabilities } from './types';
import { GatewayNotImplementedError } from './errors';

class GatewayRegistryImpl {
  private adapters = new Map<GatewayProvider, PaymentGateway>();

  /**
   * Register a provider adapter.
   * Called at module load time (e.g., in the adapter module's
   * top-level code, or in a central bootstrap file).
   *
   * @param provider The provider name (e.g., 'paymob')
   * @param adapter The adapter instance
   */
  register(provider: GatewayProvider, adapter: PaymentGateway): void {
    if (this.adapters.has(provider)) {
      console.warn(`[payment:registry] Overwriting existing adapter for '${provider}'`);
    }
    this.adapters.set(provider, adapter);
  }

  /**
   * Get the adapter for a provider.
   * @throws GatewayNotImplementedError if no adapter is registered
   */
  get(provider: GatewayProvider): PaymentGateway {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new GatewayNotImplementedError(provider);
    }
    return adapter;
  }

  /**
   * Check if an adapter is registered for a provider.
   * Does NOT throw — returns boolean.
   */
  has(provider: GatewayProvider): boolean {
    return this.adapters.has(provider);
  }

  /**
   * Get a list of all registered providers.
   */
  listProviders(): GatewayProvider[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get capabilities for a registered provider.
   * @throws GatewayNotImplementedError if no adapter is registered
   */
  getCapabilities(provider: GatewayProvider): GatewayCapabilities {
    return this.get(provider).capabilities;
  }
}

export const GatewayRegistry = new GatewayRegistryImpl();
