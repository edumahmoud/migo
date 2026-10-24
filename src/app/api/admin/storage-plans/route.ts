import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/storage-plans
 *   Returns ALL storage plans (including inactive).
 *
 * POST /api/admin/storage-plans
 *   Create a new plan. Superadmin only.
 *   Body: { name, name_en?, size_mb, price_monthly?, price_yearly?, price?, currency?, is_active?, sort_order? }
 *   v134q: plans are subscriptions — price_monthly is required (or the
 *   legacy `price` alias). price_yearly is optional (NULL = yearly not
 *   offered for this plan).
 *
 * PUT /api/admin/storage-plans
 *   Update a plan. Superadmin only.
 *   Body: { id, updates: { name?, name_en?, size_mb?, price_monthly?, price_yearly?, price?, currency?, is_active?, sort_order? } }
 *
 * DELETE /api/admin/storage-plans
 *   Deactivate a plan (soft delete). Superadmin only.
 *   Body: { id }
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data: plans, error } = await supabaseServer
    .from('storage_plans')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: 'فشل جلب الخطط' }, { status: 500 });
  return NextResponse.json({ success: true, plans: plans ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'يتطلب صلاحية superadmin' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { name, name_en, size_mb, price, price_monthly, price_yearly, currency, is_active, sort_order } = body as {
    name?: string; name_en?: string; size_mb?: number; price?: number;
    price_monthly?: number; price_yearly?: number | null;
    currency?: string; is_active?: boolean; sort_order?: number;
  };

  // v134q: price_monthly is the canonical field; accept the legacy
  // `price` as a fallback for older callers.
  const monthly = price_monthly ?? price;
  if (!name || !size_mb || (monthly === undefined && price === undefined)) {
    return NextResponse.json({ error: 'name + size_mb + price_monthly مطلوبة' }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from('storage_plans')
    .insert({
      name, name_en: name_en ?? null, size_mb,
      price: monthly ?? 0,
      price_monthly: monthly ?? 0,
      price_yearly: price_yearly ?? null,
      currency: currency ?? 'EGP',
      is_active: is_active ?? true,
      sort_order: sort_order ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[storage-plans] insert error:', error);
    return NextResponse.json({ error: 'فشل إنشاء الخطة' }, { status: 500 });
  }

  return NextResponse.json({ success: true, plan: data });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'يتطلب صلاحية superadmin' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { id, updates } = body as { id?: string; updates?: Record<string, unknown> };
  if (!id || !updates) {
    return NextResponse.json({ error: 'id + updates مطلوبة' }, { status: 400 });
  }

  // v134q: allow the new subscription price fields; keep the legacy
  // `price` column in sync with price_monthly when either is set.
  const allowed = ['name', 'name_en', 'size_mb', 'price', 'price_monthly', 'price_yearly', 'currency', 'is_active', 'sort_order'];
  const clean: Record<string, unknown> = {};
  for (const k of allowed) { if (k in updates) clean[k] = updates[k]; }
  if ('price_monthly' in clean && clean.price_monthly != null) {
    clean.price = clean.price_monthly;
  } else if ('price' in clean && clean.price != null && !('price_monthly' in clean)) {
    clean.price_monthly = clean.price;
  }

  const { data, error } = await supabaseServer
    .from('storage_plans')
    .update(clean)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'فشل تحديث الخطة' }, { status: 500 });
  return NextResponse.json({ success: true, plan: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'يتطلب صلاحية superadmin' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { id } = body as { id?: string };
  if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 });

  // v134k: HARD DELETE the plan (not soft delete). The admin wants it gone.
  const { error } = await supabaseServer
    .from('storage_plans')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: 'فشل حذف الخطة' }, { status: 500 });
  return NextResponse.json({ success: true });
}
