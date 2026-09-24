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

type Icon = 'wallet' | 'credit_card' | 'banknote' | 'smartphone' | 'building' | 'landmark' | 'repeat';

interface PaymentMethod {
  id: string;
  teacher_id: string;
  name: string;
  icon: Icon;
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

const ICON_COMPONENT: Record<Icon, React.ComponentType<{ className?: string }>> = {
  wallet: Wallet,
  credit_card: CreditCard,
  banknote: Banknote,
  smartphone: Smartphone,
  building: Building2,
  landmark: Landmark,
  repeat: Repeat,
};

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
                  const IconComp = ICON_COMPONENT[m.icon] ?? Wallet;
                  return (
                    <Card
                      key={m.id}
                      className="border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-900/10"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                            <IconComp className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                          </div>
                          <CardTitle className="text-base">{m.name}</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
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
                        {m.contact_for_confirmation && (
                          <div className="rounded-md bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-900/40 p-2">
                            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                              <Contact className="h-3 w-3" />
                              أرسل إثبات الدفع إلى
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium" dir="ltr">
                                {m.contact_for_confirmation}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => copyText(m.contact_for_confirmation ?? '', 'رقم التواصل')}
                                title="نسخ"
                                className="h-7 w-7"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
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
