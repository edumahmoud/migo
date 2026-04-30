import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { notifyUser } from '@/lib/notifications-service';

// POST: Create a file request OR handle approve/reject
export async function POST(request: NextRequest) {
  try {
    // Authenticate the request using shared auth helper
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return authErrorResponse(authResult);
    }
    const authUser = { id: authResult.user.id };

    const body = await request.json();
    const { action, fileId, ownerId, description, requestId } = body;

    // CREATE: Request a file
    if (!action || action === 'create') {
      if (!fileId || !ownerId) {
        return NextResponse.json({ error: 'معرف الملف والمالك مطلوبان' }, { status: 400 });
      }

      // Check if already requested
      const { data: existing } = await supabaseServer
        .from('file_requests')
        .select('id, status')
        .eq('file_id', fileId)
        .eq('requester_id', authUser.id)
        .maybeSingle();

      if (existing) {
        if (existing.status === 'pending') {
          return NextResponse.json({ error: 'لديك طلب معلق بالفعل لهذا الملف' }, { status: 409 });
        }
        if (existing.status === 'approved') {
          return NextResponse.json({ error: 'تمت الموافقة على طلبك بالفعل' }, { status: 409 });
        }
      }

      // Get file info for notification
      const { data: fileData } = await supabaseServer
        .from('user_files')
        .select('file_name')
        .eq('id', fileId)
        .single();

      const { data: requesterProfile } = await supabaseServer
        .from('users')
        .select('name')
        .eq('id', authUser.id)
        .single();

      const { error: insertError } = await supabaseServer
        .from('file_requests')
        .insert({
          file_id: fileId,
          requester_id: authUser.id,
          owner_id: ownerId,
          description: description?.trim() || null,
          status: 'pending',
        });

      if (insertError) {
        console.error('[file-requests] Error creating:', insertError);
        return NextResponse.json({ error: 'حدث خطأ أثناء إرسال الطلب' }, { status: 500 });
      }

      // Send notification to file owner (DB + push)
      await notifyUser(
        ownerId,
        'file_request',
        'طلب ملف جديد',
        `طلب ${requesterProfile?.name || 'مستخدم'} ملف "${fileData?.file_name || 'ملف'}" الخاص بك.`,
        `file_request:${authUser.id}`,
      );

      return NextResponse.json({ success: true, message: 'تم إرسال طلب الملف بنجاح' });
    }

    // APPROVE: Owner approves a request
    if (action === 'approve') {
      if (!requestId) {
        return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
      }

      const { data: req } = await supabaseServer
        .from('file_requests')
        .select('id, owner_id, requester_id, file_id')
        .eq('id', requestId)
        .single();

      if (!req || req.owner_id !== authUser.id) {
        return NextResponse.json({ error: 'غير مصرح بهذا الإجراء' }, { status: 403 });
      }

      const { error } = await supabaseServer
        .from('file_requests')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', requestId);

      if (error) {
        return NextResponse.json({ error: 'حدث خطأ أثناء الموافقة' }, { status: 500 });
      }

      // Also create a file share
      try {
        const { data: fileData } = await supabaseServer
          .from('user_files')
          .select('id')
          .eq('id', req.file_id)
          .single();

        if (fileData) {
          await supabaseServer.from('file_shares').insert({
            file_id: req.file_id,
            shared_by: authUser.id,
            shared_with: req.requester_id,
            permission: 'download',
          }).catch(() => {}); // Ignore if already exists
        }
      } catch {}

      // Notify requester (DB + push)
      await notifyUser(
        req.requester_id,
        'file_request',
        'تمت الموافقة على طلب الملف',
        'تمت الموافقة على طلب الملف الخاص بك. يمكنك الآن تحميله.',
        `profile:${authUser.id}`,
      );

      return NextResponse.json({ success: true, message: 'تمت الموافقة على الطلب' });
    }

    // REJECT: Owner rejects a request
    if (action === 'reject') {
      if (!requestId) {
        return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
      }

      const { data: req } = await supabaseServer
        .from('file_requests')
        .select('id, owner_id, requester_id')
        .eq('id', requestId)
        .single();

      if (!req || req.owner_id !== authUser.id) {
        return NextResponse.json({ error: 'غير مصرح بهذا الإجراء' }, { status: 403 });
      }

      const { error } = await supabaseServer
        .from('file_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', requestId);

      if (error) {
        return NextResponse.json({ error: 'حدث خطأ أثناء رفض الطلب' }, { status: 500 });
      }

      // Notify requester (DB + push)
      await notifyUser(
        req.requester_id,
        'file_request',
        'تم رفض طلب الملف',
        'تم رفض طلب الملف الخاص بك.',
        `profile:${authUser.id}`,
      );

      return NextResponse.json({ success: true, message: 'تم رفض الطلب' });
    }

    // CANCEL: Requester cancels their own pending request
    if (action === 'cancel') {
      if (!requestId) {
        return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
      }

      const { data: req } = await supabaseServer
        .from('file_requests')
        .select('id, requester_id, status')
        .eq('id', requestId)
        .single();

      if (!req || req.requester_id !== authUser.id) {
        return NextResponse.json({ error: 'غير مصرح بهذا الإجراء' }, { status: 403 });
      }

      if (req.status !== 'pending') {
        return NextResponse.json({ error: 'لا يمكن إلغاء طلب غير معلق' }, { status: 400 });
      }

      const { error } = await supabaseServer
        .from('file_requests')
        .delete()
        .eq('id', requestId);

      if (error) {
        return NextResponse.json({ error: 'حدث خطأ أثناء إلغاء الطلب' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'تم إلغاء الطلب' });
    }

    // DISMISS: Requester dismisses their own rejected request
    if (action === 'dismiss') {
      if (!requestId) {
        return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
      }

      const { data: req } = await supabaseServer
        .from('file_requests')
        .select('id, requester_id, status')
        .eq('id', requestId)
        .single();

      if (!req || req.requester_id !== authUser.id) {
        return NextResponse.json({ error: 'غير مصرح بهذا الإجراء' }, { status: 403 });
      }

      if (req.status !== 'rejected') {
        return NextResponse.json({ error: 'لا يمكن إزالة إلا الطلبات المرفوضة' }, { status: 400 });
      }

      const { error } = await supabaseServer
        .from('file_requests')
        .delete()
        .eq('id', requestId);

      if (error) {
        return NextResponse.json({ error: 'حدث خطأ أثناء إزالة الطلب' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'تم إزالة الطلب' });
    }

    // LIST: Owner lists their incoming file requests
    if (action === 'list') {
      const { data: requests, error } = await supabaseServer
        .from('file_requests')
        .select('id, file_id, requester_id, owner_id, description, status, created_at')
        .eq('owner_id', authUser.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: 'حدث خطأ أثناء جلب الطلبات' }, { status: 500 });
      }

      // Enrich with requester names and file names
      const enriched = await Promise.all((requests || []).map(async (req) => {
        const { data: requester } = await supabaseServer
          .from('users')
          .select('name, avatar_url')
          .eq('id', req.requester_id)
          .single();

        const { data: file } = await supabaseServer
          .from('user_files')
          .select('file_name, file_type, file_size')
          .eq('id', req.file_id)
          .single();

        return {
          ...req,
          requester_name: requester?.name,
          requester_avatar: requester?.avatar_url,
          file_name: file?.file_name,
          file_type: file?.file_type,
          file_size: file?.file_size,
        };
      }));

      return NextResponse.json({ requests: enriched });
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (err) {
    console.error('[file-requests] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
