import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * Teacher Payment Methods
 *   GET    /api/teacher/payment-methods       → list current teacher's methods
 *   POST   /api/teacher/payment-methods        → create a new method
 */
// As of v67, `icon` accepts any string — either a preset lucide icon
// name (wallet, credit_card, banknote, smartphone, building, landmark,
// repeat) OR a custom emoji / short text (e.g., '💰', '🏦', '⚡', 'paypal').
const PRESET_ICONS = [
  'wallet',
  'credit_card',
  'banknote',
  'smartphone',
  'building',
  'landmark',
  'repeat',
] as const;

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(20).default('wallet'),
  account_identifier: z.string().trim().min(1).max(200),
  contact_for_confirmation: z.string().trim().max(120).optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export { PRESET_ICONS };

export async function GET(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const teacherId = auth.user.id;

  const { data, error } = await supabaseServer
    .from('payment_methods')
    .select('id, teacher_id, name, icon, account_identifier, contact_for_confirmation, is_active, sort_order, created_at, updated_at')
    .eq('teacher_id', teacherId)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل وسائل الدفع' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, methods: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 }
    );
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseServer
    .from('payment_methods')
    .insert({
      teacher_id: auth.user.id,
      name: parsed.data.name,
      icon: parsed.data.icon,
      account_identifier: parsed.data.account_identifier,
      contact_for_confirmation: parsed.data.contact_for_confirmation || null,
      is_active: parsed.data.is_active,
      sort_order: parsed.data.sort_order,
    })
    .select('id, teacher_id, name, icon, account_identifier, contact_for_confirmation, is_active, sort_order, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء وسيلة الدفع' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, method: data });
}
