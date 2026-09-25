'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Check, X, Clock, User, BookOpen, RefreshCw, Wallet,
  FileText, MessageSquare, AlertCircle,
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
  confirmation_mode: string;
  sender_name: string | null;
  transaction_ref: string | null;
  proof_notes: string | null;
  proof_submitted_at: string | null;
  proof_url: string | null;
  payment_method_id: string | null;
  subject?: { id: string; name: string; level: string | null; sub_level: string | null } | null;
  student?: { id: string; email: string; name: string | null; student_code: string | null } | null;
  payment_method?: {
    id: string;
    name: string;
    icon: string | null;
    account_identifier: string;
    contact_for_confirmation: string | null;
  } | null;
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
            const hasProof = !!(o.proof_submitted_at && o.sender_name && o.transaction_ref);
            return (
              <Card key={o.id} className={`overflow-hidden ${hasProof ? 'border-sky-300 bg-sky-50/30' : ''}`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-semibold truncate">{studentName}</span>
                        {o.student?.student_code && (
                          <Badge variant="outline" className="text-xs font-mono">{o.student.student_code}</Badge>
                        )}
                        {hasProof ? (
                          <Badge className="text-xs bg-sky-100 text-sky-800 hover:bg-sky-200 border-sky-200">
                            <FileText className="h-3 w-3 me-1" /> إثبات مُرسَل
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                            <AlertCircle className="h-3 w-3 me-1" /> بدون إثبات
                          </Badge>
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

                  {/* ── Proof-of-payment details (when submitted) ── */}
                  {hasProof && (
                    <div className="rounded-md border border-sky-200 bg-white p-2 space-y-1 text-xs">
                      <div className="font-semibold text-sky-800 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" />
                        إثبات الدفع
                        {o.proof_submitted_at && (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            · {new Date(o.proof_submitted_at).toLocaleString('ar-EG')}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        <div className="flex items-start gap-1.5">
                          <User className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                          <div>
                            <div className="text-[10px] text-muted-foreground">اسم المرسل</div>
                            <div className="font-medium">{o.sender_name}</div>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <FileText className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                          <div>
                            <div className="text-[10px] text-muted-foreground">رقم العملية / المرجع</div>
                            <div className="font-mono font-medium" dir="ltr">{o.transaction_ref}</div>
                          </div>
                        </div>
                      </div>
                      {o.proof_notes && (
                        <div className="flex items-start gap-1.5 pt-1 border-t border-sky-100">
                          <MessageSquare className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                          <div>
                            <div className="text-[10px] text-muted-foreground">ملاحظات</div>
                            <div>{o.proof_notes}</div>
                          </div>
                        </div>
                      )}
                      {o.payment_method && (
                        <div className="text-[10px] text-muted-foreground pt-1 border-t border-sky-100">
                          وسيلة الدفع: {o.payment_method.name} · {o.payment_method.account_identifier}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
