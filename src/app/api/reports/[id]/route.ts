// =====================================================
// Reports API — Get, Respond, Forward, Resolve, Dismiss
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

// GET /api/reports/[id] — Get report detail with responses
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const { id } = await params;
    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    // Fetch the report
    const { data: report, error } = await supabaseServer
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .eq('id', id)
      .single();

    if (error || !report) {
      return NextResponse.json(
        { success: false, error: 'الإبلاغ غير موجود' },
        { status: 404 }
      );
    }

    // Check access: reporter, assigned user, or admin/superadmin
    const isAdmin = role === 'admin' || role === 'superadmin';
    if (report.reporter_id !== userId && report.assigned_to !== userId && !isAdmin) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بالوصول' },
        { status: 403 }
      );
    }

    // Fetch responses
    const { data: responses } = await supabaseServer
      .from('report_responses')
      .select(`
        *,
        responder:users!report_responses_responder_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        forwarded_to_user:users!report_responses_forwarded_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .eq('report_id', id)
      .order('created_at', { ascending: true });

    return NextResponse.json({
      success: true,
      data: { ...report, responses: responses || [] },
    });
  } catch (error) {
    console.error('[Reports] GET detail error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// PATCH /api/reports/[id] — Respond to a report (reply, forward, resolve, dismiss, reopen)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const { id } = await params;
    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    // Fetch the report
    const { data: report, error: reportError } = await supabaseServer
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (reportError || !report) {
      return NextResponse.json(
        { success: false, error: 'الإبلاغ غير موجود' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { action, content, forwarded_to } = body;

    if (!action || !['reply', 'forward', 'resolve', 'dismiss', 'reopen'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'إجراء غير صالح' },
        { status: 400 }
      );
    }

    // Access check
    const isAdmin = role === 'admin' || role === 'superadmin';
    const isAssigned = report.assigned_to === userId;
    const isReporter = report.reporter_id === userId;

    if (!isAdmin && !isAssigned && !isReporter) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بهذا الإجراء' },
        { status: 403 }
      );
    }

    // Validate action permissions
    if (action === 'forward' && !isAdmin && !isAssigned) {
      return NextResponse.json(
        { success: false, error: 'فقط المعين أو المشرف يمكنه تحويل الإبلاغ' },
        { status: 403 }
      );
    }

    if ((action === 'resolve' || action === 'dismiss') && !isAdmin && !isAssigned) {
      return NextResponse.json(
        { success: false, error: 'فقط المعين أو المشرف يمكنه إنهاء الإبلاغ' },
        { status: 403 }
      );
    }

    if (action === 'forward' && !forwarded_to) {
      return NextResponse.json(
        { success: false, error: 'يجب تحديد المستخدم المحول إليه' },
        { status: 400 }
      );
    }

    // Determine new status
    let newStatus = report.status;
    if (action === 'resolve') newStatus = 'resolved';
    else if (action === 'dismiss') newStatus = 'dismissed';
    else if (action === 'reopen') newStatus = 'pending';
    else if (action === 'reply' || action === 'forward') newStatus = 'in_progress';

    // Update report
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (action === 'forward' && forwarded_to) {
      updateData.assigned_to = forwarded_to;
      // When forwarded, status goes back to pending
      updateData.status = 'pending';
    }

    const { error: updateError } = await supabaseServer
      .from('reports')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      console.error('[Reports] Update error:', updateError.message);
      return NextResponse.json(
        { success: false, error: 'فشل تحديث الإبلاغ' },
        { status: 500 }
      );
    }

    // Create response record
    const { data: response, error: responseError } = await supabaseServer
      .from('report_responses')
      .insert({
        report_id: id,
        responder_id: userId,
        action,
        content: content || null,
        forwarded_to: action === 'forward' ? forwarded_to : null,
      })
      .select()
      .single();

    if (responseError) {
      console.error('[Reports] Response create error:', responseError.message);
      // Don't fail — report is already updated
    }

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error('[Reports] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
