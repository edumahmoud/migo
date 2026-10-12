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
    // ─── Storage upgrade requests ───
    // For storage_upgrade requests, approving means:
    //   1. Look up the storage plan (from plan_id on the request, or
    //      fall back to the plan name in notes).
    //   2. Insert a user_storage_upgrades row (the storage check API
    //      will pick this up and increase the user's quota).
    //   3. Mark the request as approved.
    // No user_section_unlocks row is created for storage upgrades.
    if (req.request_type === 'storage_upgrade') {
      // Fetch the plan (from plan_id, or fail gracefully).
      let plan: { id: string; size_mb: number; price: number; currency: string; name: string } | null = null;
      if (req.plan_id) {
        const { data: planRow, error: planErr } = await supabaseServer
          .from('storage_plans')
          .select('id, size_mb, price, currency, name')
          .eq('id', req.plan_id)
          .maybeSingle();
        if (planErr || !planRow) {
          return NextResponse.json(
            { error: 'خطة التخزين غير موجودة. قد تكون قد حُذفت.' },
            { status: 404 },
          );
        }
        plan = planRow as { id: string; size_mb: number; price: number; currency: string; name: string };
      } else {
        return NextResponse.json(
          { error: 'طلب الترقية لا يحتوي على خطة محددة (plan_id مفقود).' },
          { status: 400 },
        );
      }

      // Deactivate any existing active upgrade for this user (only one active at a time).
      await supabaseServer
        .from('user_storage_upgrades')
        .update({ is_active: false })
        .eq('user_id', req.user_id)
        .eq('is_active', true);

      // Insert the new active upgrade.
      const { error: upgradeErr } = await supabaseServer
        .from('user_storage_upgrades')
        .insert({
          user_id: req.user_id,
          plan_id: plan.id,
          size_mb: plan.size_mb,
          price: plan.price,
          currency: plan.currency,
          request_id: req.id,
          is_active: true,
        });
      if (upgradeErr) {
        console.error('[paid-services/requests] storage upgrade insert error:', upgradeErr);
        return NextResponse.json({ error: 'فشل تفعيل مساحة التخزين' }, { status: 500 });
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

      return NextResponse.json({
        success: true,
        storageUpgrade: {
          size_mb: plan.size_mb,
          name: plan.name,
        },
      });
    }

    // ─── Section unlock requests (default path) ───
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
