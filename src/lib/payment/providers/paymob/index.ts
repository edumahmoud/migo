/**
 * Paymob Adapter — Public Exports + Registry Registration
 *
 * This module registers the PaymobAdapter in the GatewayRegistry
 * at import time. Any code that imports from '@/lib/payment' will
 * automatically have the Paymob adapter available.
 *
 * The application layer never branches on provider name — it asks
 * the GatewayRegistry for the adapter, and the registry returns it.
 */

export { PaymobAdapter } from './adapter';
export type { PaymobCredentials, PaymobConfiguration } from './types';
export { verifyPaymobHmac } from './hmac';
export { createIntention, getIntention, buildCheckoutUrl } from './client';

// ─── Register the adapter ───
import { GatewayRegistry } from '../../registry';
import { PaymobAdapter } from './adapter';

// Register at module load time
GatewayRegistry.register('paymob', new PaymobAdapter());
