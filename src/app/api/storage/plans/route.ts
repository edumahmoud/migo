import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/storage/plans
 * Returns all active storage upgrade plans (sorted by sort_order).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data: plans, error } = await supabaseServer
    .from('storage_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'فشل جلب الخطط' }, { status: 500 });
  }

  return NextResponse.json({ success: true, plans: plans ?? [] });
}
