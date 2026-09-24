import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/payment/providers
 *
 * Returns the list of available payment providers configured for this
 * deployment. This is the provider-agnostic list — the actual integration
 * is per-provider (each provider has its own gateway adapter that calls
 * the same /api/payment/webhook at the end).
 *
 * The frontend uses this to render the "choose payment method" step.
 *
 * Each entry includes:
 *   - id: stable identifier ('mock', 'fawry', 'paymob', 'instapay', 'wallet', 'card')
 *   - name: display name (Arabic)
 *   - type: 'automatic' (gateway calls webhook) or 'manual' (admin approves)
 *   - description: short text
 */
const PROVIDERS = [
  {
    id: 'mock',
    name: 'بوابة دفع تجريبية',
    type: 'automatic' as const,
    description: 'للتطوير والاختبار فقط — يحاكي نجاح الدفع فوراً.',
  },
  {
    id: 'card',
    name: 'بطاقة ائتمانية',
    type: 'automatic' as const,
    description: 'Visa / Mastercard عبر بوابة الدفع (Paymob).',
  },
  {
    id: 'wallet',
    name: 'محفظة إلكترونية',
    type: 'automatic' as const,
    description: 'فودافون كاش / أورانج كاش / إتصالات كاش — تحويل تلقائي.',
  },
  {
    id: 'instapay',
    name: 'إنستا باي',
    type: 'manual' as const,
    description: 'تحويل عبر إنستا باي — يتطلب تأكيد يدوي من المعلم/الإدارة.',
  },
  {
    id: 'fawry',
    name: 'فوري',
    type: 'manual' as const,
    description: 'دفع عبر ماكينات فوري — يتطلب تأكيد يدوي بعد إرسال إيصال الدفع.',
  },
  {
    id: 'cash',
    name: 'نقدًا لدى المعلم/الوكيل',
    type: 'manual' as const,
    description: 'دفع يدوي — يتطلب تأكيد المعلم/الإدارة بعد استلام المبلغ.',
  },
];

export async function GET(_request: NextRequest) {
  return NextResponse.json({ success: true, providers: PROVIDERS });
}
