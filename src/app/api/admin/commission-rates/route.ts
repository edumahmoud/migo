import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/commission-rates
 * Lists all commission rates (current + historical).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { data, error } = await supabaseServer
    .from('commission_rates')
    .select('*')
    .order('effective_from', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, rates: data ?? [] });
}

/**
 * POST /api/admin/commission-rates
 * Creates a new commission rate and activates it.
 * Deactivates any previously active rate (only one active at a time).
 * The new rate affects NEW payments only — existing ledger records
 * are immutable (snapshotted commission_rate).
 */
const CreateSchema = z.object({
  rate_percentage: z.number().min(0).max(100),
  effective_from: z.string().optional(), // ISO datetime, defaults to now()
});

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'النسبة غير صالحة (0-100)' }, { status: 400 });
  }

  const effectiveFrom = parsed.data.effective_from || new Date().toISOString();

  // Deactivate any currently active rate
  const { error: deactivateErr } = await supabaseServer
    .from('commission_rates')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('is_active', true);

  if (deactivateErr) {
    return NextResponse.json({ success: false, error: deactivateErr.message }, { status: 500 });
  }

  // Insert the new active rate
  const { data, error } = await supabaseServer
    .from('commission_rates')
    .insert({
      rate_percentage: parsed.data.rate_percentage,
      is_active: true,
      effective_from: effectiveFrom,
      created_at: new Date().toISOString(),
    })
    .select('id, rate_percentage, is_active, effective_from, created_at')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    rate: data,
    message: `تم إنشاء نسبة عمولة جديدة: ${parsed.data.rate_percentage}%. تؤثر على المعاملات الجديدة فقط.`,
  });
}
