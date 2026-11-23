import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Liveness only, intentionally no credentials or dependency internals.
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'attendo' }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
