import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/paid-services/config
 *   Returns all locked_sections_config rows.
 *
 * POST /api/admin/paid-services/config
 *   Update a section's config. Superadmin only.
 *   Body: {
 *     sectionKey: string,
 *     updates: {
 *       student_locked?, teacher_locked?,
 *       student_monthly_price?, student_yearly_price?,
 *       teacher_monthly_price?, teacher_yearly_price?,
 *       currency?, student_max_usage?, teacher_max_usage?,
 *       usage_period_days?, usage_metric?, is_active?
 *     }
 *   }
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data: configs, error } = await supabaseServer
    .from('locked_sections_config')
    .select('*')
    .order('section_key', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'فشل جلب الإعدادات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, configs: configs ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  // Only superadmin can change config.
  if (auth.role !== 'superadmin') {
    return NextResponse.json({ error: 'يتطلب صلاحية superadmin' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { sectionKey, updates } = body as {
    sectionKey?: string;
    updates?: Record<string, unknown>;
  };

  if (!sectionKey || !updates) {
    return NextResponse.json({ error: 'sectionKey + updates مطلوبان' }, { status: 400 });
  }

  // Whitelist allowed fields.
  const allowed = [
    'student_locked', 'teacher_locked',
    'student_monthly_price', 'student_yearly_price',
    'teacher_monthly_price', 'teacher_yearly_price',
    'currency',
    'student_monthly_limit', 'student_yearly_limit',
    'teacher_monthly_limit', 'teacher_yearly_limit',
    'free_quota_mb',
    'usage_period_days', 'usage_metric', 'is_active',
    'section_label', 'teacher_only',
  ];
  const cleanUpdates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in updates) {
      cleanUpdates[key] = updates[key];
    }
  }

  if (Object.keys(cleanUpdates).length === 0) {
    return NextResponse.json({ error: 'لا توجد حقول صالحة للتحديث' }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from('locked_sections_config')
    .update(cleanUpdates)
    .eq('section_key', sectionKey)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[paid-services/config] update error:', error);
    return NextResponse.json({ error: 'فشل تحديث الإعدادات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, config: data });
}
