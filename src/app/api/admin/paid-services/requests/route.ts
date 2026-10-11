import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/paid-services/requests
 *
 * Returns activation requests. All admins can see requests, but:
 *   - superadmin sees ALL requests
 *   - regular admin sees only requests assigned to them + unassigned
 *
 * Query params:
 *   status?: 'pending' | 'approved' | 'rejected' | 'expired' | 'all' (default: all)
 *   sectionKey?: filter by section
 *
 * POST: approve/reject a request
 *   Body: { requestId, action: 'approve'|'reject', durationDays?: number }
 *   - approve: creates a user_section_unlock + sets status='approved'
 *   - reject: sets status='rejected'
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';
  const sectionKey = searchParams.get('sectionKey');

  let query = supabaseServer
    .from('section_activation_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (status !== 'all') {
    query = query.eq('status', status);
  }
  if (sectionKey) {
    query = query.eq('section_key', sectionKey);
  }

  // Regular admins only see requests assigned to them + unassigned.
  if (auth.role !== 'superadmin') {
    query = query.or(`assigned_to.eq.${auth.user.id},assigned_to.is.null`);
  }

  const { data: requests, error } = await query;
  if (error) {
    console.error('[paid-services/requests] GET error:', error);
    return NextResponse.json({ error: 'فشل جلب الطلبات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, requests: requests ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { requestId, action, durationDays, assignedTo } = body as {
    requestId?: string;
    action?: 'approve' | 'reject' | 'assign';
    durationDays?: number;
    assignedTo?: string | null;
  };

  if (!requestId || !action) {
    return NextResponse.json({ error: 'requestId + action مطلوبان' }, { status: 400 });
  }

  // Fetch the request.
  const { data: req, error: reqErr } = await supabaseServer
    .from('section_activation_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (reqErr || !req) {
    return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
  }

  // Regular admins can only process requests assigned to them.
  if (auth.role !== 'superadmin' && req.assigned_to && req.assigned_to !== auth.user.id) {
    return NextResponse.json({ error: 'هذا الطلب مُسند لمشرف آخر' }, { status: 403 });
  }

  const now = new Date().toISOString();

  if (action === 'approve') {
    const days = durationDays ?? (req.plan_type === 'yearly' ? 365 : 30);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    // Deactivate any existing active unlock for this user+section.
    await supabaseServer
      .from('user_section_unlocks')
      .update({ is_active: false })
      .eq('user_id', req.user_id)
      .eq('section_key', req.section_key)
      .eq('is_active', true);

    // Create the new unlock.
    const { error: unlockErr } = await supabaseServer
      .from('user_section_unlocks')
      .insert({
        user_id: req.user_id,
        section_key: req.section_key,
        plan_type: req.plan_type,
        started_at: now,
        expires_at: expiresAt,
        activation_method: 'manual',
        request_id: req.id,
        is_active: true,
      });
    if (unlockErr) {
      console.error('[paid-services/requests] unlock insert error:', unlockErr);
      return NextResponse.json({ error: 'فشل إنشاء التفعيل' }, { status: 500 });
    }

    // Mark the request as approved.
    const { error: updateErr } = await supabaseServer
      .from('section_activation_requests')
      .update({
        status: 'approved',
        processed_by: auth.user.id,
        processed_at: now,
      })
      .eq('id', requestId);
    if (updateErr) {
      console.error('[paid-services/requests] update error:', updateErr);
    }

    return NextResponse.json({ success: true, expiresAt });
  }

  if (action === 'reject') {
    const { error: updateErr } = await supabaseServer
      .from('section_activation_requests')
      .update({
        status: 'rejected',
        processed_by: auth.user.id,
        processed_at: now,
      })
      .eq('id', requestId);
    if (updateErr) {
      return NextResponse.json({ error: 'فشل تحديث الطلب' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (action === 'assign') {
    // Only superadmin can assign.
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'يتطلب صلاحية superadmin' }, { status: 403 });
    }
    const { error: updateErr } = await supabaseServer
      .from('section_activation_requests')
      .update({ assigned_to: assignedTo ?? null })
      .eq('id', requestId);
    if (updateErr) {
      return NextResponse.json({ error: 'فشل الإسناد' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
}
