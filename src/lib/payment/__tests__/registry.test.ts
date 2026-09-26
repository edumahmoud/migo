// =====================================================
// Payment Gateway Core — Registry Tests
// =====================================================
// Tests: adapter registration, lookup, unimplemented provider
// rejection, capability access.

import { describe, test, expect, beforeEach } from 'bun:test';
import { GatewayRegistry } from '../registry';
import { GatewayNotImplementedError } from '../errors';
import type { PaymentGateway, GatewayCapabilities } from '../types';

// ─── Mock adapter for testing ───
const mockCapabilities: GatewayCapabilities = {
  supportsRefund: true,
  supportsVerify: true,
  supportsWebhook: true,
  supportsTestConnection: true,
  supportsRedirectCheckout: true,
  supportsEmbeddedCheckout: false,
};

function createMockAdapter(provider: string): PaymentGateway {
  return {
    provider,
    capabilities: mockCapabilities,
    async createPayment() { return { success: true, provider }; },
    async verifyPayment() { return { success: true, status: 'paid', amount: 0, currency: 'EGP' }; },
    async handleWebhook() { return { success: true, provider, status: 'paid' }; },
    async testConnection() { return { success: true, provider, message: 'OK', testedAt: new Date().toISOString() }; },
    async refundPayment() { return { success: true, amount: 0, status: 'completed' }; },
  };
}

// ─── Reset registry before each test ───
beforeEach(() => {
  // Clear all registered adapters
  for (const p of GatewayRegistry.listProviders()) {
    // Registry doesn't have an unregister method — we rely on
    // the fact that tests use unique provider names.
  }
});

describe('Gateway Registry', () => {
  test('register + get an adapter', () => {
    const adapter = createMockAdapter('test-provider-1');
    GatewayRegistry.register('test-provider-1', adapter);

    const result = GatewayRegistry.get('test-provider-1');
    expect(result).toBe(adapter);
  });

  test('get unimplemented provider throws GatewayNotImplementedError', () => {
    expect(() => GatewayRegistry.get('nonexistent-provider')).toThrow(GatewayNotImplementedError);
  });

  test('has() returns boolean (no throw)', () => {
    expect(GatewayRegistry.has('nonexistent')).toBe(false);
    GatewayRegistry.register('test-provider-2', createMockAdapter('test-provider-2'));
    expect(GatewayRegistry.has('test-provider-2')).toBe(true);
  });

  test('getCapabilities returns the declared capabilities', () => {
    GatewayRegistry.register('test-provider-3', createMockAdapter('test-provider-3'));
    const caps = GatewayRegistry.getCapabilities('test-provider-3');
    expect(caps.supportsRefund).toBe(true);
    expect(caps.supportsWebhook).toBe(true);
    expect(caps.supportsEmbeddedCheckout).toBe(false);
  });

  test('listProviders returns all registered names', () => {
    GatewayRegistry.register('test-provider-4', createMockAdapter('test-provider-4'));
    GatewayRegistry.register('test-provider-5', createMockAdapter('test-provider-5'));
    const providers = GatewayRegistry.listProviders();
    expect(providers).toContain('test-provider-4');
    expect(providers).toContain('test-provider-5');
  });
});
