'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Wallet,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  Landmark,
  Repeat,
  Contact,
  Copy,
  GraduationCap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

type IconPreset = 'wallet' | 'credit_card' | 'banknote' | 'smartphone' | 'building' | 'landmark' | 'repeat';

interface PaymentMethod {
  id: string;
  teacher_id: string;
  name: string;
  icon: string;  // v67: any string (preset name OR custom emoji)
  account_identifier: string;
  contact_for_confirmation: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface TeacherWithMethods {
  id: string;
  name: string | null;
  email: string | null;
  methods: PaymentMethod[];
}

const ICON_COMPONENT: Record<IconPreset, React.ComponentType<{ className?: string }>> = {
  wallet: Wallet,
  credit_card: CreditCard,
  banknote: Banknote,
  smartphone: Smartphone,
  building: Building2,
  landmark: Landmark,
  repeat: Repeat,
};

// Render an icon: if the string is one of the preset keys, use the lucide
// component; otherwise render it as a text/emoji span.
function renderPaymentIcon(icon: string | null | undefined, className?: string) {
  if (!icon) return <Wallet className={className ?? 'h-5 w-5'} />;
  if (icon in ICON_COMPONENT) {
    const Ico = ICON_COMPONENT[icon as IconPreset];
    return <Ico className={className ?? 'h-5 w-5'} />;
  }
  return <span className={className ? `${className} inline-flex items-center justify-center` : 'text-xl leading-none'}>{icon}</span>;
}

// Normalize a phone-like string into a wa.me-compatible number:
// strip everything except digits, and if it starts with 0, replace
// with the Egyptian country code '20' (since this app's teacher contacts
// are most likely Egyptian). If the user already prefixed '+' or country
// code, we keep it (just strip the '+').
function normalizePhoneForWhatsapp(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  // Egyptian local numbers like 01012345678 → 201012345678
  if (digits.startsWith('0') && digits.length === 11) {
    return '20' + digits.slice(1);
  }
  // Already includes country code
  return digits;
}

function isPhoneLike(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

export default function StudentPaymentMethodsSection() {
  const { t } = useTranslations();
  const [teachers, setTeachers] = useState<TeacherWithMethods[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/student/payment-methods', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        setTeachers([]);
      } else {
        setTeachers(json.teachers as TeacherWithMethods[]);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error('تعذّر النسخ');
    }
  };

  const totalMethods = teachers.reduce((sum, t) => sum + t.methods.length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Wallet className="h-5 w-5 text-emerald-600" />
          وسائل الدفع
        </h2>
        <p className="text-sm text-muted-foreground">
          يمكنك الدفع للمعلم عبر أي من وسائل الدفع التالية. تواصل مع الرقم الموجود بجانب كل وسيلة لتأكيد الدفع.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
        </div>
      ) : totalMethods === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30" />
            لا توجد وسائل دفع مُتاحة من معلميك حتى الآن.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {teachers.map((t) => (
            <div key={t.id} className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <GraduationCap className="h-4 w-4" />
                {t.name ?? t.email ?? '—'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {t.methods.map((m) => {
                  const contact = m.contact_for_confirmation ?? '';
                  const contactIsPhone = contact ? isPhoneLike(contact) : false;
                  const whatsappNumber = contactIsPhone ? normalizePhoneForWhatsapp(contact) : null;
                  return (
                    <Card
                      key={m.id}
                      className="border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-900/10"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                            {renderPaymentIcon(m.icon, 'h-5 w-5 text-emerald-700 dark:text-emerald-300')}
                          </div>
                          <CardTitle className="text-base">{m.name}</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Account number / wallet */}
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">رقم الحساب / المحفظة</div>
                          <div className="flex items-center gap-2">
                            <code
                              className="flex-1 font-mono text-sm bg-white dark:bg-background border border-emerald-200 dark:border-emerald-900/50 px-2 py-1.5 rounded break-all"
                              dir="ltr"
                            >
                              {m.account_identifier}
                            </code>
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => copyText(m.account_identifier, 'رقم الحساب')}
                              title="نسخ"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        {/* NEW proof-of-payment design — prominent CTA */}
                        {contact && (
                          <div className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-3 space-y-2 shadow-md">
                            <div className="flex items-center gap-2 text-xs font-medium opacity-90">
                              <Contact className="h-4 w-4" />
                              أرسل إثبات الدفع للمعلم عبر:
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <code
                                className="font-mono text-base tracking-wide bg-white/20 px-2 py-1 rounded"
                                dir="ltr"
                              >
                                {contact}
                              </code>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => copyText(contact, 'رقم التواصل')}
                                title="نسخ"
                                className="text-white hover:bg-white/20 h-8 w-8"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                            {whatsappNumber && (
                              <Button
                                type="button"
                                asChild
                                className="w-full bg-white text-emerald-700 hover:bg-emerald-50 font-semibold h-10"
                              >
                                <a
                                  href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
                                    `السلام عليكم، هذه إثبات دفع لـ ${m.name} (${m.account_identifier})`
                                  )}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.893-.605zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                                  </svg>
                                  تواصل عبر واتساب
                                </a>
                              </Button>
                            )}
                            {contactIsPhone && !whatsappNumber && (
                              <div className="text-xs text-white/80 text-center">
                                اضغط على الرقم للاتصال
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
