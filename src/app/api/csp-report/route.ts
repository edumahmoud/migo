import { NextRequest, NextResponse } from 'next/server';

// Receives Content-Security-Policy-Report-Only violation reports (logged to server logs only).
export async function POST(req: NextRequest) {
  try {
    const text = (await req.text()).slice(0, 2000);
    console.warn('[csp-report]', text);
  } catch {}
  return new NextResponse(null, { status: 204 });
}
