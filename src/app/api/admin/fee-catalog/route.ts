import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { escapePostgrestIlike } from '@/lib/api-security';

/**
 * GET /api/admin/fee-catalog
 *   - Returns all fee_catalog rows (active + inactive), ordered by sort_order
 *
 * POST /api/admin/fee-catalog
 *   - Creates a new fee_catalog row
 *   - Body: { code, name_ar, name_en, description?, fee_kind, value, sort_order? }
 *   - fee_kind: 'percentage' | 'flat'
 *   - value: 0-100 for percentage, any positive number for flat
 *   - is_active defaults to TRUE on creation
 *
 * Authorization: admin/superadmin only.
 */

const CreateSchema = z.object({
  code: z.string().min(2).max(50).regex(/^[a-z0-9_]+$/, 'code must be lowercase alphanumeric + underscore'),
  name_ar: z.string().min(1).max(100),
  name_en: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  fee_kind: z.enum(['percentage', 'flat']),
  value: z.number().min(0),
  sort_order: z.number().int().min(0).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data, error } = await supabaseServer
    .from('fee_catalog')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.issues },
      { status: 400 },
    );
  }

  // For percentage: value must be 0-100
  if (parsed.data.fee_kind === 'percentage' && parsed.data.value > 100) {
    return NextResponse.json(
      { success: false, error: 'قيمة النسبة يجب أن تكون بين 0 و 100' },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from('fee_catalog')
    .insert({
      code: parsed.data.code,
      name_ar: parsed.data.name_ar,
      name_en: parsed.data.name_en,
      description: parsed.data.description ?? null,
      fee_kind: parsed.data.fee_kind,
      value: parsed.data.value,
      sort_order: parsed.data.sort_order ?? 0,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    // Unique violation on code
    if (error.code === '23505') {
      return NextResponse.json(
        { success: false, error: `الكود '${parsed.data.code}' موجود بالفعل` },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data }, { status: 201 });
}

// Helper used by other endpoints — fetch active fees for order creation
export async function fetchActiveFees(): Promise<Array<{
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  fee_kind: 'percentage' | 'flat';
  value: number;
  sort_order: number;
}>> {
  const { data, error } = await supabaseServer
    .from('fee_catalog')
    .select('id, code, name_ar, name_en, fee_kind, value, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []) as Array<{
    id: string;
    code: string;
    name_ar: string;
    name_en: string;
    fee_kind: 'percentage' | 'flat';
    value: number;
    sort_order: number;
  }>;
}
