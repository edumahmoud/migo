import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ subjectId: string }> }

/**
 * GET /api/teacher/subjects/[subjectId]/subscription-plans
 *   Returns all subscription plans for the subject.
 * POST /api/teacher/subjects/[subjectId]/subscription-plans
 *   Creates a new subscription plan.
 */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const { subjectId } = await ctx.params;

  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', subjectId)
    .maybeSingle();
  if (!subject || (subject as { teacher_id: string }).teacher_id !== auth.user.id) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  const { data, error } = await supabaseServer
    .from('subject_subscription_plans')
    .select('*')
    .eq('subject_id', subjectId)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data: data ?? [] });
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const { subjectId } = await ctx.params;

  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', subjectId)
    .maybeSingle();
  if (!subject || (subject as { teacher_id: string }).teacher_id !== auth.user.id) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const period_type = body.period_type as string;
  const duration_days = body.duration_days as number;
  const price = body.price as number;
  const period_label = (body.period_label as string) || '';
  const currency = (body.currency as string) || 'EGP';

  if (!period_type || !['monthly', 'term', 'yearly', 'custom'].includes(period_type)) {
    return NextResponse.json({ success: false, error: 'نوع الفترة غير صالح' }, { status: 400 });
  }

  const { data, error: insertErr } = await supabaseServer
    .from('subject_subscription_plans')
    .insert({
      subject_id: subjectId,
      period_type,
      period_label,
      duration_days,
      price,
      currency,
      is_active: true,
    })
    .select('*')
    .single();
  if (insertErr) {
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}
