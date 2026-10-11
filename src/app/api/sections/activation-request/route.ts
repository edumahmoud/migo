import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * POST /api/sections/activation-request
 *
 * A student or teacher submits an activation request for a locked section.
 *
 * Body: {
 *   sectionKey: string,     // e.g. 'summaries'
 *   planType: 'monthly' | 'yearly',
 *   notes?: string,         // optional message to the admin
 * }
 *
 * The user's name, email, and phone are snapshotted from their profile
 * so the admin sees them even if the user later changes their profile.
 *
 * If the user already has a PENDING request for the same section, we
 * return 409 (don't create a duplicate).
 */
const RequestSchema = z.object({
  sectionKey: z.string().min(1).max(100),
  planType: z.enum(['monthly', 'yearly']),
  notes: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (role !== 'student' && role !== 'teacher') {
    return NextResponse.json({ error: 'هذه الميزة للطلاب والمعلمين فقط' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'البيانات غير صالحة' }, { status: 400 });
  }

  const { sectionKey, planType, notes } = parsed.data;

  // 1. Verify the section is actually locked for this role.
  const { data: configRow } = await supabaseServer
    .from('locked_sections_config')
    .select('*')
    .eq('section_key', sectionKey)
    .maybeSingle();

  const config = configRow as Record<string, unknown> | null;
  const roleLockedField = role === 'student' ? 'student_locked' : 'teacher_locked';
  if (!config || !config.is_active || !config[roleLockedField]) {
    return NextResponse.json({ error: 'هذا القسم غير مقفل' }, { status: 400 });
  }

  // 2. Check if the user already has an active unlock (shouldn't happen
  //    from the UI, but defense in depth).
  const now = new Date().toISOString();
  const { data: existingUnlock } = await supabaseServer
    .from('user_section_unlocks')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('section_key', sectionKey)
    .eq('is_active', true)
    .gte('expires_at', now)
    .maybeSingle();
  if (existingUnlock) {
    return NextResponse.json({ error: 'القسم مفعّل بالفعل' }, { status: 409 });
  }

  // 3. Check if the user already has a PENDING request for this section.
  const { data: existingReq } = await supabaseServer
    .from('section_activation_requests')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('section_key', sectionKey)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingReq) {
    return NextResponse.json({ error: 'لديك طلب قيد المراجعة لهذا القسم بالفعل' }, { status: 409 });
  }

  // 4. Fetch the user's profile for the snapshot.
  const { data: profile } = await supabaseServer
    .from('users')
    .select('name, email, phone')
    .eq('id', auth.user.id)
    .maybeSingle();

  // 5. Insert the request.
  const { data: req, error: insertErr } = await supabaseServer
    .from('section_activation_requests')
    .insert({
      user_id: auth.user.id,
      user_role: role,
      section_key: sectionKey,
      plan_type: planType,
      user_name: profile?.name ?? null,
      user_email: profile?.email ?? null,
      user_phone: profile?.phone ?? null,
      notes: notes ?? null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[activation-request] insert error:', insertErr);
    return NextResponse.json({ error: 'فشل إرسال الطلب' }, { status: 500 });
  }

  return NextResponse.json({ success: true, requestId: req.id });
}

/**
 * GET /api/sections/activation-request
 *
 * Returns the current user's activation requests (all statuses).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data: requests, error } = await supabaseServer
    .from('section_activation_requests')
    .select('id, section_key, plan_type, status, created_at, processed_at, notes')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'فشل جلب الطلبات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, requests: requests ?? [] });
}
