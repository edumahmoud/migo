import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/paid-services/assign
 *   Returns the list of admins (for the assign dropdown) + per-section
 *   assignment rules (which sections each admin can see).
 *
 * POST /api/admin/paid-services/assign
 *   Assign a request to an admin.
 *   Body: { requestId, adminId }
 *
 * Superadmin only.
 */

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  // Fetch all admins (role = admin or superadmin).
  const { data: admins, error } = await supabaseServer
    .from('users')
    .select('id, name, email, role')
    .in('role', ['admin', 'superadmin'])
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'فشل جلب قائمة المشرفين' }, { status: 500 });
  }

  return NextResponse.json({ success: true, admins: admins ?? [] });
}
