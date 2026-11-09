import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { safeErrorResponse } from '@/lib/api-security';

export const runtime = 'nodejs';

/**
 * GET /api/summaries/versions?summaryId=...
 *
 * يجلب كل نسخ الملخص المؤرشفة (الأصلية + السابقة)، مرتبة من الأحدث للأقدم.
 * يتحقق من ملكية المستخدم للملخص قبل الإرجاع.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const { searchParams } = new URL(request.url);
    const summaryId = searchParams.get('summaryId');
    if (!summaryId) {
      return NextResponse.json(
        { success: false, error: 'معرف الملخص مطلوب' },
        { status: 400 }
      );
    }

    // تحقق من الملكية
    const { data: summary, error: sumErr } = await supabaseServer
      .from('summaries')
      .select('id, user_id')
      .eq('id', summaryId)
      .single();
    if (sumErr || !summary) {
      return NextResponse.json(
        { success: false, error: 'الملخص غير موجود' },
        { status: 404 }
      );
    }
    if (summary.user_id !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بعرض هذا الملخص' },
        { status: 403 }
      );
    }

    // جلب النسخ المؤرشفة
    const { data: versions, error: vErr } = await supabaseServer
      .from('summary_versions')
      .select('id, content, version_label, source_op, created_at')
      .eq('summary_id', summaryId)
      .order('created_at', { ascending: false });

    if (vErr) {
      console.error('[Versions API] Fetch error:', vErr.message);
      return NextResponse.json(
        { success: false, error: 'فشل تحميل النسخ' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: versions || [],
    });
  } catch (error) {
    console.error('[Versions API] GET error:', error);
    return safeErrorResponse('حدث خطأ غير متوقع');
  }
}

/**
 * PUT /api/summaries/versions
 *
 * استعادة نسخة سابقة: يأخذ { summaryId, versionId } ويعيد نسخة جديدة
 * من المحتوى المؤرشف إلى summary_content (مع أرشفة المحتوى الحالي أولاً).
 */
export async function PUT(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const body = await request.json();
    const { summaryId, versionId } = body;
    if (!summaryId || !versionId) {
      return NextResponse.json(
        { success: false, error: 'معرف الملخص والنسخة مطلوبان' },
        { status: 400 }
      );
    }

    // تحقق من الملكية
    const { data: summary, error: sumErr } = await supabaseServer
      .from('summaries')
      .select('id, user_id, summary_content')
      .eq('id', summaryId)
      .single();
    if (sumErr || !summary) {
      return NextResponse.json(
        { success: false, error: 'الملخص غير موجود' },
        { status: 404 }
      );
    }
    if (summary.user_id !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتعديل هذا الملخص' },
        { status: 403 }
      );
    }

    // جلب النسخة المطلوبة
    const { data: version, error: vErr } = await supabaseServer
      .from('summary_versions')
      .select('id, content, user_id')
      .eq('id', versionId)
      .eq('summary_id', summaryId)
      .single();
    if (vErr || !version) {
      return NextResponse.json(
        { success: false, error: 'النسخة غير موجودة' },
        { status: 404 }
      );
    }
    if (version.user_id !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح باستعادة هذه النسخة' },
        { status: 403 }
      );
    }

    // أرشفة المحتوى الحالي قبل الاستعادة
    try {
      if (summary.summary_content) {
        await supabaseServer
          .from('summary_versions')
          .insert({
            summary_id: summaryId,
            user_id: authResult.user.id,
            content: summary.summary_content,
            version_label: 'previous',
            source_op: 'restore',
          });
      }
    } catch (archiveErr) {
      console.warn('[Versions API] Failed to archive current before restore:', archiveErr instanceof Error ? archiveErr.message : String(archiveErr));
    }

    // استعادة النسخة
    const { data: updated, error: upErr } = await supabaseServer
      .from('summaries')
      .update({ summary_content: version.content })
      .eq('id', summaryId)
      .select()
      .single();

    if (upErr) {
      console.error('[Versions API] Restore update error:', upErr.message);
      return NextResponse.json(
        { success: false, error: 'فشل استعادة النسخة' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error('[Versions API] PUT error:', error);
    return safeErrorResponse('حدث خطأ أثناء استعادة النسخة');
  }
}
