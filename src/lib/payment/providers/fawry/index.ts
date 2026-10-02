/**
 * Fawry Provider — registration entry point
 *
 * Importing this module registers the FawryAdapter in the GatewayRegistry.
 * The webhook route + admin route import this file to ensure the adapter
 * is available.
 */

import { fawryAdapter } from './adapter';
import { GatewayRegistry } from '../../registry';

GatewayRegistry.register('fawry', fawryAdapter);

export { fawryAdapter } from './adapter';

