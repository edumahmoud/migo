// =====================================================
// Reports API — Create & List reports
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

// POST /api/reports — Create a new report
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { target_type, target_id, reason, description } = body;

    if (!target_type || !reason) {
      return NextResponse.json(
        { success: false, error: 'نوع الهدف والسبب مطلوبان' },
        { status: 400 }
      );
    }

    if (!['comment', 'message', 'user', 'other'].includes(target_type)) {
      return NextResponse.json(
        { success: false, error: 'نوع هدف غير صالح' },
        { status: 400 }
      );
    }

    // Create the report — the DB trigger auto_assign_report() will set assigned_to
    const { data: report, error } = await supabaseServer
      .from('reports')
      .insert({
        reporter_id: authResult.user.id,
        target_type,
        target_id: target_id || null,
        reason,
        description: description || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('[Reports] Create error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل إنشاء الإبلاغ' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    console.error('[Reports] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// GET /api/reports — List reports for current user (assigned to them or submitted by them)
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    // ─── Lazy auto-cleanup: delete resolved/dismissed reports older than 10 days ───
    // This runs on every list fetch to ensure old completed reports are purged
    // even if pg_cron is not available on the Supabase plan.
    try {
      await supabaseServer.rpc('cleanup_old_reports');
    } catch {
      // Non-critical: function may not exist yet (migration not applied)
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by status if provided
    if (status && ['pending', 'in_progress', 'resolved', 'dismissed'].includes(status)) {
      query = query.eq('status', status);
    }

    // Role-based filtering — Admin sees ALL reports by default (not just assigned)
    if (role === 'admin' || role === 'superadmin') {
      const viewMode = url.searchParams.get('view') || 'all';
      if (viewMode === 'submitted') {
        query = query.eq('reporter_id', userId);
      } else if (viewMode === 'assigned') {
        query = query.eq('assigned_to', userId);
      }
      // 'all' — no additional filter, admin sees everything
    } else if (role === 'teacher') {
      query = query.or(`assigned_to.eq.${userId},reporter_id.eq.${userId}`);
    } else {
      query = query.eq('reporter_id', userId);
    }

    const { data: reports, error, count } = await query;

    if (error) {
      console.error('[Reports] List error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل جلب الإبلاغات' },
        { status: 500 }
      );
    }

    // ─── Enrich reports with target_user info ───
    // For 'user' reports: target_id is the reported user directly.
    // For 'comment' reports: resolve the user_id from video_comments.
    // For 'message' reports: resolve the sender_id from chat_messages.
    if (reports && reports.length > 0) {
      // Step 1: Collect target user IDs — direct (type=user) and indirect (comment/message owners)
      const directUserIds = new Set<string>();
      const commentIds = new Set<string>();
      const messageIds = new Set<string>();

      for (const r of reports) {
        if (!r.target_id) continue;
        if (r.target_type === 'user') {
          directUserIds.add(r.target_id);
        } else if (r.target_type === 'comment') {
          commentIds.add(r.target_id);
        } else if (r.target_type === 'message') {
          messageIds.add(r.target_id);
        }
      }

      // Step 2: Resolve comment owners → user IDs
      if (commentIds.size > 0) {
        try {
          const { data: comments } = await supabaseServer
            .from('video_comments')
            .select('id, user_id')
            .in('id', Array.from(commentIds));
          if (comments) {
            for (const c of comments) {
              if (c.user_id) directUserIds.add(c.user_id);
            }
            // Store mapping for later attachment
            (reports as any)._commentOwnerMap = Object.fromEntries(
              comments.map((c: any) => [c.id, c.user_id])
            );
          }
        } catch { /* video_comments table may not exist */ }
      }

      // Step 3: Resolve message senders → user IDs
      if (messageIds.size > 0) {
        try {
          const { data: messages } = await supabaseServer
            .from('chat_messages')
            .select('id, sender_id')
            .in('id', Array.from(messageIds));
          if (messages) {
            for (const m of messages) {
              if (m.sender_id) directUserIds.add(m.sender_id);
            }
            (reports as any)._messageOwnerMap = Object.fromEntries(
              messages.map((m: any) => [m.id, m.sender_id])
            );
          }
        } catch { /* chat_messages table may not exist */ }
      }

      // Step 4: Batch-fetch target user profiles + report counts
      const commentOwnerMap: Record<string, string> = (reports as any)._commentOwnerMap || {};
      const messageOwnerMap: Record<string, string> = (reports as any)._messageOwnerMap || {};
      delete (reports as any)._commentOwnerMap;
      delete (reports as any)._messageOwnerMap;

      let targetUserMap: Record<string, { id: string; name: string; email: string; avatar_url: string | null; role: string | null; gender: string | null; title_id: string | null; report_count: number }> = {};

      if (directUserIds.size > 0) {
        const ids = Array.from(directUserIds);
        const { data: targetUsers } = await supabaseServer
          .from('users')
          .select('id, name, email, avatar_url, role, gender, title_id')
          .in('id', ids);

        // Batch-fetch report counts per target user
        const { data: reportCounts } = await supabaseServer
          .from('reports')
          .select('target_id')
          .eq('target_type', 'user')
          .in('target_id', ids);

        const countMap: Record<string, number> = {};
        if (reportCounts) {
          for (const rc of reportCounts) {
            if (rc.target_id) {
              countMap[rc.target_id] = (countMap[rc.target_id] || 0) + 1;
            }
          }
        }

        if (targetUsers) {
          for (const u of targetUsers) {
            targetUserMap[u.id] = { ...u, report_count: countMap[u.id] || 0 };
          }
        }
      }

      // Step 5: Attach target_user to each report
      for (const r of reports) {
        if (r.target_type === 'user' && r.target_id && targetUserMap[r.target_id]) {
          (r as any).target_user = targetUserMap[r.target_id];
        } else if (r.target_type === 'comment' && r.target_id) {
          const ownerId = commentOwnerMap[r.target_id];
          if (ownerId && targetUserMap[ownerId]) {
            (r as any).target_user = targetUserMap[ownerId];
          }
        } else if (r.target_type === 'message' && r.target_id) {
          const ownerId = messageOwnerMap[r.target_id];
          if (ownerId && targetUserMap[ownerId]) {
            (r as any).target_user = targetUserMap[ownerId];
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: reports,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[Reports] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// DELETE /api/reports — Clear resolved/dismissed reports for current user
// Supports two modes:
//   ?mode=all       — delete ALL resolved/dismissed reports visible to the user
//   ?id=<uuid>      — delete a single resolved/dismissed report by ID
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const role = await getUserRole(userId);
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'all';
    const reportId = url.searchParams.get('id');

    if (reportId) {
      // ─── Delete a single report ───
      // First verify it exists and is completed
      const { data: report, error: fetchError } = await supabaseServer
        .from('reports')
        .select('id, status, reporter_id, assigned_to')
        .eq('id', reportId)
        .single();

      if (fetchError || !report) {
        return NextResponse.json(
          { success: false, error: 'الإبلاغ غير موجود' },
          { status: 404 }
        );
      }

      if (!['resolved', 'dismissed'].includes(report.status)) {
        return NextResponse.json(
          { success: false, error: 'لا يمكن حذف إبلاغ قيد المعالجة' },
          { status: 400 }
        );
      }

      // Access check
      const isAdmin = role === 'admin' || role === 'superadmin';
      const isReporter = report.reporter_id === userId;
      const isAssigned = report.assigned_to === userId;
      if (!isAdmin && !isReporter && !isAssigned) {
        return NextResponse.json(
          { success: false, error: 'غير مصرح بحذف هذا الإبلاغ' },
          { status: 403 }
        );
      }

      const { error: deleteError } = await supabaseServer
        .from('reports')
        .delete()
        .eq('id', reportId);

      if (deleteError) {
        console.error('[Reports] Delete single error:', deleteError.message);
        return NextResponse.json(
          { success: false, error: 'فشل حذف الإبلاغ' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, data: { deleted: 1 } });
    }

    // ─── Bulk delete all resolved/dismissed reports ───
    let deleteQuery = supabaseServer
      .from('reports')
      .delete()
      .in('status', ['resolved', 'dismissed']);

    // Role-based scope
    if (role === 'admin' || role === 'superadmin') {
      // Admin: delete ALL resolved/dismissed on the platform
      // No additional filter needed — RLS allows admin to delete any completed report
    } else if (role === 'teacher') {
      // Teacher: delete their own submitted + assigned to them
      deleteQuery = deleteQuery.or(`reporter_id.eq.${userId},assigned_to.eq.${userId}`);
    } else {
      // Student: delete only their own submitted reports
      deleteQuery = deleteQuery.eq('reporter_id', userId);
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      console.error('[Reports] Bulk delete error:', deleteError.message);
      return NextResponse.json(
        { success: false, error: 'فشل حذف الإبلاغات' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: { cleared: true } });
  } catch (error) {
    console.error('[Reports] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
