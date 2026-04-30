import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

// ─── POST: Remove a student's attendance records from active sessions ───
// When a student logs out during an active attendance session, their check-in
// record is deleted so they are considered absent.
export async function POST(request: NextRequest) {
  try {
    // Authenticate the request
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return authErrorResponse(authResult);
    }

    const { studentId } = await request.json();

    if (!studentId) {
      return NextResponse.json({ error: 'studentId is required' }, { status: 400 });
    }

    // Verify the authenticated user matches the studentId
    const ownershipError = verifyOwnership(authResult.user.id, studentId);
    if (ownershipError) {
      return authErrorResponse(ownershipError);
    }

    // Find all active attendance sessions
    const { data: activeSessions, error: sessionsError } = await supabaseServer
      .from('attendance_sessions')
      .select('id')
      .eq('status', 'active');

    if (sessionsError) {
      console.error('[mark-absent-on-logout] Error fetching active sessions:', sessionsError);
      return NextResponse.json({ error: 'Failed to fetch active sessions' }, { status: 500 });
    }

    if (!activeSessions || activeSessions.length === 0) {
      // No active sessions — nothing to do
      return NextResponse.json({ success: true, removed: 0 });
    }

    // Delete the student's attendance records from all active sessions
    const sessionIds = activeSessions.map((s: { id: string }) => s.id);

    const { error: deleteError, count } = await supabaseServer
      .from('attendance_records')
      .delete({ count: 'exact' })
      .eq('student_id', studentId)
      .in('session_id', sessionIds);

    if (deleteError) {
      console.error('[mark-absent-on-logout] Error deleting attendance records:', deleteError);
      return NextResponse.json({ error: 'Failed to remove attendance records' }, { status: 500 });
    }

    return NextResponse.json({ success: true, removed: count || 0 });
  } catch (error) {
    console.error('[mark-absent-on-logout] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
