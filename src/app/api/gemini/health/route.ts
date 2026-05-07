import { NextResponse } from 'next/server';
import { checkAllProvidersHealth } from '@/lib/ai';

// Quick health check — must complete fast
export const maxDuration = 15;
export const runtime = 'nodejs';

/**
 * GET /api/gemini/health
 *
 * Quick health check for the AI service.
 * Tests all providers and reports their status.
 * Returns immediately (under 15s) with diagnostic information.
 */
export async function GET() {
  try {
    const health = await checkAllProvidersHealth();

    const isOk = health.status === 'ok';
    return NextResponse.json(health, { status: isOk ? 200 : 503 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      status: 'error',
      provider: 'multi',
      providers: {},
      summary: `Health check failed: ${msg}`,
    }, { status: 503 });
  }
}
