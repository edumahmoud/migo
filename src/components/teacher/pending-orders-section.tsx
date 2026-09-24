'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Check, X, Clock, User, BookOpen, RefreshCw, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface PendingOrder {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  subject?: { id: string; name: string; level: string | null; sub_level: string | null } | null;
  student?: { id: string; email: string; name: string | null; student_code: string | null } | null;
}

export default function PendingOrdersSection() {
  const { t } = useTranslations();
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teacher/pending-orders', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) setOrders(json.orders ?? []);
      else toast.error(json.error || t('common.unexpectedError'));
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setActioning(id);
    try {
      const res = await fetch(`/api/teacher/pending-orders/${id}/approve`, {
        method: 'POST', headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم تفعيل الاشتراك'); await load(); }
      else toast.error(json.error || t('common.unexpectedError'));
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setActioning(null); }
  };

  const reject = async (id: string) => {
    if (!confirm('رفض هذا الطلب؟')) return;
    setActioning(id);
    try {
      const res = await fetch(`/api/teacher/pending-orders/${id}/reject`, {
        method: 'POST', headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم رفض الطلب'); await load(); }
      else toast.error(json.error || t('common.unexpectedError'));
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setActioning(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-sky-600" />
            تفعيل الاشتراكات
          </h2>
          <p className="text-sm text-muted-foreground">
            الطلبات المعلّقة بانتظار تأكيد الدفع من الطالب.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} title="تحديث">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
            لا توجد طلبات معلّقة حالياً.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const studentName = o.student?.name ?? o.student?.email ?? '—';
            const courseName = o.subject?.name ?? '—';
            const meta = [o.subject?.level, o.subject?.sub_level].filter(Boolean).join(' / ');
            return (
              <Card key={o.id} className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-semibold truncate">{studentName}</span>
                        {o.student?.student_code && (
                          <Badge variant="outline" className="text-xs font-mono">{o.student.student_code}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <BookOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{courseName}</span>
                        {meta && <span className="text-xs">· {meta}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString('ar-EG')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-end">
                        <div className="font-bold text-emerald-700">
                          {Number(o.amount).toFixed(2)} {o.currency}/شهر
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          <Clock className="h-3 w-3 me-1" />
                          قيد الدفع
                        </Badge>
                      </div>
                      <Button
                        size="sm" variant="default"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => approve(o.id)}
                        disabled={actioning === o.id}
                      >
                        {actioning === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 me-1" />}
                        تفعيل
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => reject(o.id)}
                        disabled={actioning === o.id}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
