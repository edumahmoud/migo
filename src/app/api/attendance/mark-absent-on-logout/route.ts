import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// Compatibility endpoint for older clients. Logout must never erase attendance.
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  return NextResponse.json({ success: true, removed: 0 });
}
