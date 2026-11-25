/**
 * Fawry API Client — HTTP calls to Fawry's REST API
 *
 * Handles:
 *   - POST /charge           → create a charge (returns fawryRefNumber)
 *   - GET  /status/v2       → lookup charge status by merchantRefNum
 */

import { fawryBase, FawryChargeRequest, FawryChargeResponse, FawryStatusResponse } from './types';

/**
 * Create a Fawry charge (reference code payment).
 *
 * @param chargeReq  The signed charge request (with signature field populated).
 * @returns          The response from Fawry. statusCode=200 + fawryRefNumber
 *                   means success.
 */
export async function createCharge(
  chargeReq: FawryChargeRequest,
  sandbox: boolean = false,
  timeoutMs: number = 15000,
): Promise<FawryChargeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${fawryBase(sandbox)}/charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(chargeReq),
      signal: controller.signal,
    });
    return (await res.json()) as FawryChargeResponse;
  } catch (err) {
    // Network error, timeout, DNS, etc.
    return {
      statusCode: -1,
      statusDescription: err instanceof Error ? err.message : 'network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up a Fawry charge status by merchantRefNum (our internal order UUID).
 *
 * Query params: merchantCode, merchantRefNum, signature (status signature).
 */
export async function getChargeStatus(
  merchantCode: string,
  merchantRefNum: string,
  signature: string,
  sandbox: boolean = false,
  timeoutMs: number = 10000,
): Promise<FawryStatusResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(`${fawryBase(sandbox)}/status/v2`);
    url.searchParams.set('merchantCode', merchantCode);
    url.searchParams.set('merchantRefNumber', merchantRefNum);
    url.searchParams.set('signature', signature);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    return (await res.json()) as FawryStatusResponse;
  } catch (err) {
    return {
      statusCode: -1,
      statusDescription: err instanceof Error ? err.message : 'network error',
    };
  } finally {
    clearTimeout(timer);
  }
}
