/**
 * Payout Provider Registry — Phase 13 Step 3
 *
 * Provider-agnostic registry for payout providers. The registry
 * stores registered PayoutProvider implementations and resolves
 * the appropriate provider for a given method_type + currency.
 *
 * NO real provider is registered in this step. Future Step 4+
 * will register Paymob Disbursement, wallet APIs, etc.
 *
 * Resolution logic:
 *   1. Find all providers that support the requested method_type.
 *   2. Filter by supported currency.
 *   3. If multiple match, return the first registered (priority
 *      can be added later if needed).
 *   4. If none match, throw ProviderUnavailableError.
 *
 * The registry does NOT hardcode any provider name. It works
 * with any PayoutProvider implementation.
 */

import type { PayoutProvider, PayoutCapabilities } from './provider';
import {
  providerSupportsMethod,
  providerSupportsCurrency,
} from './provider';
import type { PayoutMethodSnapshot } from './types';
import { ProviderUnavailableError } from './errors';

class PayoutProviderRegistryImpl {
  private providers = new Map<string, PayoutProvider>();

  /**
   * Register a payout provider.
   * Throws if a provider with the same providerId is already registered.
   */
  register(provider: PayoutProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`Payout provider already registered: ${provider.providerId}`);
    }
    this.providers.set(provider.providerId, provider);
  }

  /**
   * Unregister a provider by ID.
   */
  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  /**
   * List all registered providers.
   */
  listProviders(): PayoutProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get a provider by ID.
   */
  getProvider(providerId: string): PayoutProvider | null {
    return this.providers.get(providerId) ?? null;
  }

  /**
   * Resolve a provider for a given method_type + currency.
   *
   * Resolution order:
   *   1. All providers that support the method_type.
   *   2. Filter by supported currency.
   *   3. Return the first match.
   *   4. If none match, throw ProviderUnavailableError.
   *
   * This method does NOT hardcode any provider name. It works
   * purely based on declared capabilities.
   */
  resolve(
    methodType: PayoutMethodSnapshot['method_type'],
    currency: string,
  ): PayoutProvider {
    for (const provider of this.providers.values()) {
      if (
        providerSupportsMethod(provider, methodType) &&
        providerSupportsCurrency(provider, currency)
      ) {
        return provider;
      }
    }
    throw new ProviderUnavailableError(methodType, currency);
  }

  /**
   * Check if any registered provider can handle a method_type + currency.
   */
  canResolve(
    methodType: PayoutMethodSnapshot['method_type'],
    currency: string,
  ): boolean {
    for (const provider of this.providers.values()) {
      if (
        providerSupportsMethod(provider, methodType) &&
        providerSupportsCurrency(provider, currency)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clear all registered providers (useful for tests).
   */
  clear(): void {
    this.providers.clear();
  }
}

/**
 * Singleton instance of the payout provider registry.
 * Future Step 4+ will register real providers here.
 */
export const PayoutProviderRegistry = new PayoutProviderRegistryImpl();
