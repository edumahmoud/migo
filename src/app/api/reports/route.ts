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
    const { target_type, target_id, reason, description, attachments } = body;

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

    // Validate attachments if provided
    const validAttachments = Array.isArray(attachments) && attachments.length > 0
      ? attachments.filter((a: any) => a.url && a.name).slice(0, 3)
      : [];

    // Create the report — the DB trigger auto_assign_report() will set assigned_to
    const { data: report, error } = await supabaseServer
      .from('reports')
      .insert({
        reporter_id: authResult.user.id,
        target_type,
        target_id: target_id || null,
        reason,
        description: description || null,
        attachments: validAttachments.length > 0 ? validAttachments : [],
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

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const reportNumber = url.searchParams.get('report_number')?.trim();
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;
    const validStatus = status && ['pending', 'in_progress', 'resolved', 'dismissed'].includes(status) ? status : null;

    // ─── Search by report_number (fast path — bypasses complex visibility logic) ───
    if (reportNumber) {
      let numQuery = supabaseServer
        .from('reports')
        .select(`
          *,
          reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
          assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
        `)
        .ilike('report_number', `%${reportNumber}%`)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // Apply visibility filter
      if (role === 'student') {
        numQuery = numQuery.eq('reporter_id', userId);
      } else if (role === 'teacher') {
        numQuery = numQuery.or(`reporter_id.eq.${userId},assigned_to.eq.${userId}`);
      }
      // Admin/superadmin sees all

      const { data: searchResults, error: searchError, count: searchCount } = await numQuery;

      if (searchError) {
        return NextResponse.json({ success: false, error: 'فشل البحث بالرقم' }, { status: 500 });
      }

      return await enrichAndReturn(searchResults || [], searchCount || 0, page, limit, userId, role);
    }

    // ─── Handle "forwarded" virtual status separately ───
    if (status === 'forwarded') {
      let forwardedQuery = supabaseServer
        .from('report_responses')
        .select('report_id')
        .eq('action', 'forward');

      if (role === 'teacher') {
        forwardedQuery = forwardedQuery.eq('responder_id', userId);
      } else if (role === 'admin' || role === 'superadmin') {
        forwardedQuery = forwardedQuery.eq('forwarded_to', userId);
      }

      const { data: forwardedResponses } = await forwardedQuery;
      const forwardedIds = (forwardedResponses || []).map((r: any) => r.report_id);

      if (forwardedIds.length === 0) {
        return NextResponse.json({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
      }

      // Fetch full forwarded reports
      let query = supabaseServer
        .from('reports')
        .select(`
          *,
          reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
          assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
        `)
        .in('id', forwardedIds)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: reports, error, count } = await query;

      if (error) {
        console.error('[Reports] Forwarded list error:', error.message);
        return NextResponse.json({ success: false, error: 'فشل جلب الإبلاغات المحولة' }, { status: 500 });
      }

      return await enrichAndReturn(reports || [], count || 0, page, limit, userId, role);
    }

    // ─── Collect visible report IDs in PARALLEL instead of sequentially ───
    const visibleIds = new Set<string>();

    // Build all ID-fetch queries and run them in parallel
    const idQueryPromises: Promise<any>[] = [];

    // 1. Reports submitted by the user (ALWAYS visible to reporter)
    const submittedPromise = (async () => {
      let q = supabaseServer.from('reports').select('id').eq('reporter_id', userId);
      if (validStatus) q = q.eq('status', validStatus);
      return q;
    })();
    idQueryPromises.push(submittedPromise);

    // 2. Reports where user is the target (target_type=user)
    const againstPromise = (async () => {
      let q = supabaseServer.from('reports').select('id').eq('target_type', 'user').eq('target_id', userId);
      if (validStatus) q = q.eq('status', validStatus);
      return q;
    })();
    idQueryPromises.push(againstPromise);

    // 3. Reports assigned to the user (for non-students)
    if (role !== 'student' && role !== null) {
      const assignedPromise = (async () => {
        let q = supabaseServer.from('reports').select('id').eq('assigned_to', userId);
        if (validStatus) q = q.eq('status', validStatus);
        return q;
      })();
      idQueryPromises.push(assignedPromise);
    }

    // Run all ID queries in parallel
    const idResults = await Promise.all(idQueryPromises);

    // Collect submitted IDs (result 0)
    const submittedIds = idResults[0]?.data || [];
    submittedIds.forEach((r: any) => visibleIds.add(r.id));

    // Collect against IDs (result 1)
    const againstIds = idResults[1]?.data || [];
    againstIds.forEach((r: any) => visibleIds.add(r.id));

    // Collect assigned IDs (result 2, if exists)
    let assignedIds: any[] = [];
    if (idResults.length > 2) {
      assignedIds = idResults[2]?.data || [];
      assignedIds.forEach((r: any) => visibleIds.add(r.id));
    }

    // ─── Admin view mode filter ───
    if (role === 'admin' || role === 'superadmin') {
      const viewMode = url.searchParams.get('view') || 'all';
      if (viewMode === 'submitted') {
        const submittedIdSet = new Set(submittedIds.map((r: any) => r.id));
        for (const id of visibleIds) {
          if (!submittedIdSet.has(id)) visibleIds.delete(id);
        }
      } else if (viewMode === 'assigned') {
        const assignedIdSet = new Set(assignedIds.map((r: any) => r.id));
        for (const id of visibleIds) {
          if (!assignedIdSet.has(id)) visibleIds.delete(id);
        }
      }
    }

    if (visibleIds.size === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    // ─── Fetch full reports using the collected IDs ───
    let query = supabaseServer
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .in('id', Array.from(visibleIds))
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: reports, error, count } = await query;

    if (error) {
      console.error('[Reports] List error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل جلب الإبلاغات' },
        { status: 500 }
      );
    }

    return await enrichAndReturn(reports || [], count || visibleIds.size, page, limit, userId, role);
  } catch (error) {
    console.error('[Reports] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

/**
 * Shared enrichment function — attaches target_user and target_content to reports
 */
async function enrichAndReturn(
  reports: any[],
  count: number,
  page: number,
  limit: number,
  userId: string,
  role: string | null
): Promise<NextResponse> {

    // ─── Enrich reports with target_user info (PARALLEL queries) ───
    if (reports && reports.length > 0) {
      // Step 1: Collect target IDs
      const directUserIds = new Set<string>();
      const commentIds = new Set<string>();
      const messageIds = new Set<string>();

      for (const r of reports) {
        if (!r.target_id) continue;
        if (r.target_type === 'user') directUserIds.add(r.target_id);
        else if (r.target_type === 'comment') commentIds.add(r.target_id);
        else if (r.target_type === 'message') messageIds.add(r.target_id);
      }

      // Step 2: Run comment, message, and user queries IN PARALLEL
      const enrichmentPromises: Promise<any>[] = [];

      // Comments query
      if (commentIds.size > 0) {
        enrichmentPromises.push(
          Promise.resolve(
            supabaseServer
              .from('video_comments')
              .select('id, user_id, content')
              .in('id', Array.from(commentIds))
          ).then(({ data }) => data || []).catch(() => [])
        );
      } else {
        enrichmentPromises.push(Promise.resolve([]));
      }

      // Messages query
      if (messageIds.size > 0) {
        enrichmentPromises.push(
          Promise.resolve(
            supabaseServer
              .from('chat_messages')
              .select('id, sender_id, content')
              .in('id', Array.from(messageIds))
          ).then(({ data }) => data || []).catch(() => [])
        );
      } else {
        enrichmentPromises.push(Promise.resolve([]));
      }

      // Target users query (always needed)
      if (directUserIds.size > 0) {
        const ids = Array.from(directUserIds);
        enrichmentPromises.push(
          Promise.all([
            Promise.resolve(
              supabaseServer
                .from('users')
                .select('id, name, email, avatar_url, role, gender, title_id')
                .in('id', ids)
            ),
            Promise.resolve(
              supabaseServer
                .from('reports')
                .select('target_id')
                .eq('target_type', 'user')
                .in('target_id', ids)
                .in('status', ['pending', 'in_progress'])
            ),
          ])
        );
      } else {
        enrichmentPromises.push(Promise.resolve([{ data: [] }, { data: [] }]));
      }

      const enrichmentResults = await Promise.all(enrichmentPromises);

      // Process comments
      const comments = enrichmentResults[0] as any[];
      const commentContentMap: Record<string, string> = {};
      const commentOwnerMap: Record<string, string> = {};
      for (const c of comments) {
        if (c.user_id) { directUserIds.add(c.user_id); commentOwnerMap[c.id] = c.user_id; }
        if (c.content) commentContentMap[c.id] = c.content;
      }

      // Process messages
      const chatMsgs = enrichmentResults[1] as any[];
      const messageContentMap: Record<string, string> = {};
      const messageOwnerMap: Record<string, string> = {};
      for (const m of chatMsgs) {
        if (m.sender_id) { directUserIds.add(m.sender_id); messageOwnerMap[m.id] = m.sender_id; }
        if (m.content) messageContentMap[m.id] = m.content;
      }

      // If we got new user IDs from comments/messages, fetch them too
      const newIds = Array.from(directUserIds);
      let targetUserMap: Record<string, any> = {};

      if (enrichmentResults[2] && Array.isArray(enrichmentResults[2])) {
        // We got target users from the parallel query
        const [usersResult, countsResult] = enrichmentResults[2];
        const targetUsers = usersResult?.data || [];
        const reportCounts = countsResult?.data || [];

        const countMap: Record<string, number> = {};
        for (const rc of reportCounts) {
          if (rc.target_id) countMap[rc.target_id] = (countMap[rc.target_id] || 0) + 1;
        }
        for (const u of targetUsers) {
          targetUserMap[u.id] = { ...u, report_count: countMap[u.id] || 0 };
        }

        // Check if we need to fetch additional users from comment/message owners
        const fetchedIds = new Set(targetUsers.map((u: any) => u.id));
        const missingIds = newIds.filter(id => !fetchedIds.has(id));
        if (missingIds.length > 0) {
          const { data: extraUsers } = await supabaseServer
            .from('users')
            .select('id, name, email, avatar_url, role, gender, title_id')
            .in('id', missingIds);
          if (extraUsers) {
            for (const u of extraUsers) {
              targetUserMap[u.id] = { ...u, report_count: 0 };
            }
          }
        }
      }

      // Step 3: Attach target_user and target_content to each report
      for (const r of reports) {
        if (!r.target_content) {
          if (r.target_type === 'comment' && r.target_id && commentContentMap[r.target_id]) {
            (r as any).target_content = commentContentMap[r.target_id];
          } else if (r.target_type === 'message' && r.target_id && messageContentMap[r.target_id]) {
            (r as any).target_content = messageContentMap[r.target_id];
          }
        }
        if (r.target_type === 'user' && r.target_id && targetUserMap[r.target_id]) {
          (r as any).target_user = targetUserMap[r.target_id];
        } else if (r.target_type === 'comment' && r.target_id) {
          const ownerId = commentOwnerMap[r.target_id];
          if (ownerId && targetUserMap[ownerId]) (r as any).target_user = targetUserMap[ownerId];
        } else if (r.target_type === 'message' && r.target_id) {
          const ownerId = messageOwnerMap[r.target_id];
          if (ownerId && targetUserMap[ownerId]) (r as any).target_user = targetUserMap[ownerId];
        }
      }
    }

  // ─── Also include comment/message reports where the current user is the reported person ───
  const alreadyIncludedIds = new Set(reports.map((r: any) => r.id));

  // Run current user profile + comments + messages queries IN PARALLEL
  const [currentUserResult, userCommentsResult, userMessagesResult] = await Promise.all([
    Promise.resolve(
      supabaseServer
        .from('users')
        .select('id, name, email, avatar_url, role, gender, title_id')
        .eq('id', userId)
        .single()
    ),
    Promise.resolve(
      supabaseServer
        .from('video_comments')
        .select('id, content')
        .eq('user_id', userId)
    ).catch(() => ({ data: null })),
    Promise.resolve(
      supabaseServer
        .from('chat_messages')
        .select('id, content')
        .eq('sender_id', userId)
    ).catch(() => ({ data: null })),
  ]);

  const currentUserProfile = currentUserResult?.data;
  const currentUserTargetUser = currentUserProfile
    ? { ...currentUserProfile, report_count: 0 }
    : { id: userId, name: '', email: '', avatar_url: null, role: null, gender: null, title_id: null, report_count: 0 };

  // Process user's comments that have reports
  const userComments = (userCommentsResult as any)?.data;
  if (userComments && userComments.length > 0) {
    const cIds = userComments.map((c: any) => c.id);
    const cContentMap: Record<string, string> = {};
    for (const c of userComments) {
      if ((c as any).content) cContentMap[c.id] = (c as any).content;
    }

    let cQuery = supabaseServer
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .in('target_id', cIds)
      .eq('target_type', 'comment');

    if (alreadyIncludedIds.size > 0) {
      cQuery = cQuery.not('id', 'in', `(${Array.from(alreadyIncludedIds).join(',')})`);
    }

    const { data: commentReports } = await cQuery;
    if (commentReports) {
      for (const cr of commentReports) {
        alreadyIncludedIds.add(cr.id);
        if (!cr.target_content && cContentMap[cr.target_id]) {
          (cr as any).target_content = cContentMap[cr.target_id];
        }
        (cr as any).target_user = currentUserTargetUser;
      }
      reports.push(...commentReports);
    }
  }

  // Process user's chat messages that have reports
  const userMessages = (userMessagesResult as any)?.data;
  if (userMessages && userMessages.length > 0) {
    const mIds = userMessages.map((m: any) => m.id);
    const mContentMap: Record<string, string> = {};
    for (const m of userMessages) {
      if ((m as any).content) mContentMap[m.id] = (m as any).content;
    }

    let mQuery = supabaseServer
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .in('target_id', mIds)
      .eq('target_type', 'message');

    if (alreadyIncludedIds.size > 0) {
      mQuery = mQuery.not('id', 'in', `(${Array.from(alreadyIncludedIds).join(',')})`);
    }

    const { data: messageReports } = await mQuery;
    if (messageReports) {
      for (const mr of messageReports) {
        if (!mr.target_content && mContentMap[mr.target_id]) {
          (mr as any).target_content = mContentMap[mr.target_id];
        }
        (mr as any).target_user = currentUserTargetUser;
      }
      reports.push(...messageReports);
    }
  }

  // Fill in target_user for reports that still don't have it
  const needsTargetUser = reports.filter((r: any) => !r.target_user && r.target_type === 'user' && r.target_id);
  if (needsTargetUser.length > 0) {
    const targetIds = [...new Set(needsTargetUser.map((r: any) => r.target_id))];
    const { data: targetUsers } = await supabaseServer
      .from('users')
      .select('id, name, email, avatar_url, role, gender, title_id')
      .in('id', targetIds);

    if (targetUsers) {
      const tMap = new Map(targetUsers.map((u: any) => [u.id, u]));
      for (const r of needsTargetUser) {
        const tu = tMap.get(r.target_id);
        if (tu) (r as any).target_user = tu;
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: reports,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
    },
  });
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
