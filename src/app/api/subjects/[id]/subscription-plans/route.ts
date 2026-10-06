import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET /api/subjects/[id]/subscription-plans
 *
 * Public endpoint — returns ACTIVE subscription plans for a subject.
 * Students use this during checkout to choose between monthly/term/yearly.
 *
 * No auth required (RLS policy on subject_subscription_plans allows
 * SELECT for is_active=true rows by anyone).
 *
 * Response: { success: true, data: SubscriptionPlan[] }
 */
interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id: subjectId } = await ctx.params;

  if (!subjectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
    return NextResponse.json(
      { success: false, error: 'subject_id غير صالح' },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from('subject_subscription_plans')
    .select('id, period_type, period_label, duration_days, price, currency, sort_order')
    .eq('subject_id', subjectId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: (data ?? []).map((p) => ({
      id: p.id,
      period_type: p.period_type,
      period_label: p.period_label,
      duration_days: p.duration_days,
      price: Number(p.price),
      currency: p.currency,
    })),
  });
}
