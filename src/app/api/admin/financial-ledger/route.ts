import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/financial-ledger
 *
 * Admin-only endpoint to query the financial ledger.
 * Supports filtering by: teacher_id, student_id, subject_id,
 * status, gateway_id.
 *
 * Returns financial details (gross, platform_share, teacher_share, etc.)
 * — this is admin-only data, NOT exposed to students/teachers.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { searchParams } = request.nextUrl;
  const teacherId = searchParams.get('teacher_id');
  const studentId = searchParams.get('student_id');
  const subjectId = searchParams.get('subject_id');
  const status = searchParams.get('status');
  const gatewayId = searchParams.get('gateway_id');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

  let query = supabaseServer
    .from('financial_ledger')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (teacherId) query = query.eq('teacher_id', teacherId);
  if (studentId) query = query.eq('student_id', studentId);
  if (subjectId) query = query.eq('subject_id', subjectId);
  if (status) query = query.eq('status', status);
  if (gatewayId) query = query.eq('gateway_id', gatewayId);
  if (fromDate) query = query.gte('created_at', fromDate);
  if (toDate) query = query.lte('created_at', toDate);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Summary stats
  const rows = data ?? [];
  const totalGross = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.gross_amount), 0);
  const totalPlatform = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.platform_share), 0);
  const totalTeacher = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.teacher_share), 0);
  const totalGatewayFees = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.gateway_fee ?? 0), 0);

  return NextResponse.json({
    success: true,
    ledger: rows,
    summary: {
      count: rows.length,
      total_gross: totalGross.toFixed(2),
      total_platform_share: totalPlatform.toFixed(2),
      total_teacher_share: totalTeacher.toFixed(2),
      total_gateway_fees: totalGatewayFees.toFixed(2),
    },
  });
}
