import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/storage-plans
 *   Returns ALL storage plans (including inactive).
 *
 * POST /api/admin/storage-plans
 *   Create a new plan. Superadmin only.
 *   Body: { name, name_en?, size_mb, price, currency?, is_active?, sort_order? }
 *
 * PUT /api/admin/storage-plans
 *   Update a plan. Superadmin only.
 *   Body: { id, updates: { name?, name_en?, size_mb?, price?, currency?, is_active?, sort_order? } }
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

  const { name, name_en, size_mb, price, currency, is_active, sort_order } = body as {
    name?: string; name_en?: string; size_mb?: number; price?: number;
    currency?: string; is_active?: boolean; sort_order?: number;
  };

  if (!name || !size_mb || price === undefined) {
    return NextResponse.json({ error: 'name + size_mb + price مطلوبة' }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from('storage_plans')
    .insert({
      name, name_en: name_en ?? null, size_mb, price,
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

  const allowed = ['name', 'name_en', 'size_mb', 'price', 'currency', 'is_active', 'sort_order'];
  const clean: Record<string, unknown> = {};
  for (const k of allowed) { if (k in updates) clean[k] = updates[k]; }

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

  // Soft delete: set is_active=false.
  const { error } = await supabaseServer
    .from('storage_plans')
    .update({ is_active: false })
    .eq('id', id);

  if (error) return NextResponse.json({ error: 'فشل حذف الخطة' }, { status: 500 });
  return NextResponse.json({ success: true });
}
