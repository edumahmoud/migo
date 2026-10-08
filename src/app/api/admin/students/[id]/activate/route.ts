import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/admin/students/[id]/activate
 *
 * Admin-only. Lift an active suspension for a student. Can lift
 * either global suspensions, all course-scoped suspensions for one
 * student, or one specific course-scoped suspension.
 *
 * Body:
 *   {
 *     scope: 'global' | 'course' | 'all',
 *     subjectId?: string   // required when scope='course'
 *   }
 */
const ActivateSchema = z.object({
  scope: z.enum(['global', 'course', 'all']),
  subjectId: z.string().uuid().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: studentId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 }
    );
  }

  const parsed = ActivateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { scope, subjectId } = parsed.data;

  if (scope === 'course' && !subjectId) {
    return NextResponse.json(
      { success: false, error: 'يجب تحديد المقرر' },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  let builder = supabaseServer
    .from('student_suspensions')
    .update({ is_active: false, lifted_at: nowIso, lifted_by: auth.user.id })
    .eq('student_id', studentId)
    .eq('is_active', true);

  if (scope === 'global') {
    builder = builder.eq('scope', 'global').is('subject_id', null);
  } else if (scope === 'course') {
    builder = builder.eq('scope', 'course').eq('subject_id', subjectId!);
  } else if (scope === 'all') {
    // lift every active suspension for this student
    // (no additional filters)
  }

  const { data: lifted, error: updateErr } = await builder.select('id');

  if (updateErr) {
    console.error('[POST /api/admin/students/[id]/activate] update error:', updateErr);
    return NextResponse.json(
      { success: false, error: 'فشل فك الإيقاف' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    lifted: (lifted ?? []).length,
  });
}
