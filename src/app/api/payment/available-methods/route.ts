import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/payment/available-methods
 *
 * Returns the payment methods available to the current user, based on
 * which global payment gateways are enabled.
 *
 * The student checkout modal uses this to show ONLY methods that are
 * actually configured and enabled — no more hardcoded Card/Fawry.
 *
 * Response:
 *   {
 *     success: true,
 *     methods: [
 *       { id: 'card', label: 'بطاقة (Visa/Mastercard)', icon: '💳', available: true },
 *       { id: 'fawry', label: 'فوري', icon: '🏪', available: false },
 *     ]
 *   }
 *
 * Logic:
 *   - 'card' is available if there's an enabled gateway with provider='paymob'
 *     (or any provider that supports card payments).
 *   - 'fawry' is available if there's an enabled gateway with provider='fawry'.
 *   - Future: if teacher-specific payment_methods are configured, those are
 *     also returned as manual methods.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    // Fetch all enabled gateways.
    const { data: gateways, error } = await supabaseServer
      .from('payment_gateways')
      .select('id, provider, display_name, is_enabled, is_default, capabilities')
      .eq('is_enabled', true);

    if (error) {
      console.error('[available-methods] gateway query error:', error);
      // Fail-open: return card as default if we can't check.
      return NextResponse.json({
        success: true,
        methods: [
          { id: 'card', label: 'بطاقة (Visa/Mastercard)', icon: '💳', available: true },
        ],
      });
    }

    const enabledGateways = gateways ?? [];

    // Determine availability.
    const hasCardGateway = enabledGateways.some(
      (g: Record<string, unknown>) =>
        g.provider === 'paymob' || g.provider === 'stripe' ||
        (typeof g.capabilities === 'object' && g.capabilities !== null &&
         (g.capabilities as Record<string, unknown>)?.card === true)
    );

    const hasFawryGateway = enabledGateways.some(
      (g: Record<string, unknown>) => g.provider === 'fawry'
    );

    const methods: Array<{
      id: string; label: string; icon: string; available: boolean;
    }> = [
      {
        id: 'card',
        label: 'بطاقة (Visa/Mastercard)',
        icon: '💳',
        available: hasCardGateway,
      },
      {
        id: 'fawry',
        label: 'فوري',
        icon: '🏪',
        available: hasFawryGateway,
      },
    ];

    // v134: Also check for teacher-specific manual payment methods
    // (from the payment_methods table). These are manual channels like
    // Vodafone Cash, Instapay, etc. that the teacher configured.
    // Only fetch if the user is a student.
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      try {
        // Get the student's linked teachers.
        const { data: linkedTeachers } = await supabaseServer
          .from('teacher_student_links')
          .select('teacher_id')
          .eq('student_id', auth.user.id)
          .eq('status', 'approved');

        const teacherIds = (linkedTeachers ?? []).map(
          (t: { teacher_id: string }) => t.teacher_id
        );

        if (teacherIds.length > 0) {
          const { data: manualMethods } = await supabaseServer
            .from('payment_methods')
            .select('id, name, icon, account_identifier, contact_for_confirmation, teacher_id')
            .in('teacher_id', teacherIds)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

          for (const m of (manualMethods ?? []) as Array<Record<string, unknown>>) {
            methods.push({
              id: `manual-${m.id}`,
              label: String(m.name ?? 'طريقة دفع'),
              icon: String(m.icon ?? '💰'),
              available: true,
            });
          }
        }
      } catch {
        // Non-critical — manual methods are optional.
      }
    }

    // Filter to only available methods.
    const availableMethods = methods.filter(m => m.available);

    return NextResponse.json({
      success: true,
      methods: availableMethods,
      allMethods: methods, // includes unavailable ones for debugging
    });
  } catch (err) {
    console.error('[available-methods] error:', err);
    return NextResponse.json(
      { success: false, error: 'فشل جلب طرق الدفع' },
      { status: 500 },
    );
  }
}
