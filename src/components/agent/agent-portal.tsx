'use client';

import { useState } from 'react';
import { Clock, Loader2, Search, User, BookOpen, Wallet, CheckCircle2, XCircle, Ban, BadgeCheck, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { generatePaymentCode } from '@/lib/payment/utils';
import StudentSubscriptionsLog from '@/components/agent/student-subscriptions-log';
import PaymentCodeSearchBox from '@/components/shared/payment-code-search-box';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface StudentResult {
  id: string; email: string; name: string | null; username: string | null;
  student_code: string | null; account_status: string | null; created_at: string;
}
interface Subscription {
  id: string; subject_id: string; status: string; enrollment_method: string;
  current_period_start: string | null; current_period_end: string | null;
  monthly_price: number | null;
  subject: { id: string; name: string; level: string | null; sub_level: string | null; price: number } | null;
}
interface PendingOrder {
  id: string; subject_id: string; amount: number; currency: string; status: string; created_at: string;
  provider_order_ref?: string | null;
  subject: { id: string; name: string; price?: number } | null;
}

export default function AgentPortal({ activeSection = 'search', onSectionChange }: { activeSection?: string; onSectionChange?: (s: string) => void }) {
  const [searchCode, setSearchCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [studentResult, setStudentResult] = useState<{
    student: StudentResult;
    subscriptions: Subscription[];
    pending_orders: PendingOrder[];
  } | null>(null);
  // Tracks which order is currently being activated or cancelled
  // (so we can show a spinner on that specific button)
  const [actioningOrderId, setActioningOrderId] = useState<string | null>(null);
  const { confirmDialog, confirm } = useConfirmDialog();

  const searchStudent = async () => {
    if (!searchCode.trim()) { toast.error('أدخل كود الطالب'); return; }
    setSearching(true);
    setStudentResult(null);
    try {
      const res = await fetch('/api/agent/search-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ studentCode: searchCode.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setStudentResult(json);
      } else {
        toast.error(json.error || 'لم يتم العثور على الطالب');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSearching(false);
    }
  };

  // Activate a pending order manually (payment received outside the system)
  const activateOrder = async (orderId: string) => {
    if (actioningOrderId) return;
    const ok = await confirm({ title: 'تأكيد التفعيل', description: 'تم استلام المبلغ من الطالب خارج النظام؟ سيتم تفعيل الاشتراك يدويًا.', confirmLabel: 'تفعيل', cancelLabel: 'تراجع' });
    if (!ok) return;
    setActioningOrderId(orderId);
    try {
      const res = await fetch('/api/agent/subscriptions/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم تفعيل الاشتراك');
        // Re-search to refresh the data (subscriptions will now show as active)
        if (searchCode.trim()) searchStudent();
      } else {
        toast.error(json.error || 'فشل التفعيل');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningOrderId(null);
    }
  };

  // Cancel a pending order
  const cancelOrder = async (orderId: string) => {
    if (actioningOrderId) return;
    const okCancel = await confirm({ title: 'تأكيد الإلغاء', description: 'إلغاء هذا الطلب المعلّق؟ يمكن للطالب إنشاء طلب جديد بعد ذلك.', confirmLabel: 'إلغاء', cancelLabel: 'تراجع', variant: 'destructive' });
    if (!okCancel) return;
    setActioningOrderId(orderId);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم إلغاء الطلب');
        // Re-search to refresh the data (pending orders will no longer include this one)
        if (searchCode.trim()) searchStudent();
      } else {
        toast.error(json.error || 'فشل الإلغاء');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningOrderId(null);
    }
  };

  return (
    <div className="space-y-6 p-3 sm:p-6 max-w-5xl mx-auto" dir={typeof window !== 'undefined' ? (document.dir === 'rtl' ? 'rtl' : 'ltr') : undefined}>
      {/* v113: section switcher — shows different content based on sidebar selection */}
      {activeSection === 'search' && (
        <>
      {/* Header */}
      <header className="flex items-start gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shrink-0">
          <Clock className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">بوابة الوكيل</h1>
          <p className="text-sm text-muted-foreground">تفعيل الاشتراكات + البحث عن الطلاب + إدارة حساباتهم.</p>
        </div>
      </header>

      {/* Student search by code */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-sky-600" />
            بحث عن طالب بالكود
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value.toUpperCase())}
              placeholder="مثال: A1B2C3D4"
              dir="ltr"
              maxLength={40}
              className="font-mono tracking-widest"
              disabled={searching}
              onKeyDown={(e) => { if (e.key === 'Enter' && !searching) searchStudent(); }}
            />
            <Button onClick={searchStudent} disabled={searching || !searchCode.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              بحث
            </Button>
          </div>

          {studentResult && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
              {/* Student info */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <span className="font-semibold">{studentResult.student.name ?? '—'}</span>
                  {studentResult.student.student_code && (
                    <Badge variant="outline" className="text-xs font-mono">{studentResult.student.student_code}</Badge>
                  )}
                </div>
                <Badge variant={studentResult.student.account_status === 'active' ? 'default' : studentResult.student.account_status === 'pending' ? 'secondary' : 'destructive'}>
                  {studentResult.student.account_status === 'active' ? 'نشط' : studentResult.student.account_status === 'pending' ? 'قيد التفعيل' : 'موقوف'}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground" dir="ltr">{studentResult.student.email}</div>

              {/* Active subscriptions */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1">الاشتراكات</div>
                {studentResult.subscriptions.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">لا توجد اشتراكات لهذا الطالب لدى معلمك.</div>
                ) : (
                  <div className="space-y-1">
                    {studentResult.subscriptions.map((sub) => {
                      const isActive = sub.current_period_end && new Date(sub.current_period_end) > new Date();
                      const isExpired = sub.current_period_end && new Date(sub.current_period_end) <= new Date();
                      return (
                        <div key={sub.id} className="flex items-center justify-between text-sm border rounded-md px-2 py-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-medium truncate">{sub.subject?.name ?? '—'}</span>
                            {sub.subject && (sub.subject.level || sub.subject.sub_level) && (
                              <span className="text-xs text-muted-foreground ms-1">
                                · {[sub.subject.level, sub.subject.sub_level].filter(Boolean).join(' / ')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {sub.monthly_price != null && (
                              <span className="text-xs font-mono">{Number(sub.monthly_price).toFixed(2)} ج.م/شهر</span>
                            )}
                            <Badge variant={isActive ? 'default' : isExpired ? 'destructive' : 'secondary'} className="text-xs">
                              {isActive ? (
                                <><CheckCircle2 className="h-3 w-3 me-1" />نشط حتى {new Date(sub.current_period_end!).toLocaleDateString('ar-EG')}</>
                              ) : isExpired ? (
                                <><XCircle className="h-3 w-3 me-1" />منتهي</>
                              ) : (
                                sub.status
                              )}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pending orders */}
              {studentResult.pending_orders.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">طلبات قيد الدفع</div>
                  <div className="space-y-1">
                    {studentResult.pending_orders.map((o) => (
                      <div key={o.id} className="flex items-center justify-between text-sm border rounded-md px-2 py-1.5 bg-amber-50/40 gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Wallet className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="truncate">{o.subject?.name ?? '—'}</span>
                            <button
                              type="button"
                              onClick={async () => {
                                const code = generatePaymentCode(o.id);
                                try {
                                  await navigator.clipboard.writeText(code);
                                  toast.success(`تم نسخ الكود: ${code}`);
                                } catch {
                                  toast.error('تعذّر نسخ الكود');
                                }
                              }}
                              className="text-xs font-mono text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center gap-1 self-start"
                              title="اضغط للنسخ"
                            >
                              <span className="bg-sky-50 dark:bg-sky-900/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                {generatePaymentCode(o.id)}
                                <Copy className="h-2.5 w-2.5" />
                              </span>
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {/* v113: show subject base price (not total paid) */}
                          <span className="text-xs font-mono">
                            {Number(o.subject?.price ?? o.amount).toFixed(2)} {o.currency}
                          </span>
                          <Badge variant="secondary" className="text-xs">قيد الدفع</Badge>
                          {(() => {
                            const paymentInitiated = !!o.provider_order_ref && o.provider_order_ref.length > 5 && !o.provider_order_ref.startsWith('order_') && !o.provider_order_ref.startsWith('free_');
                            return (
                              <>
                                {paymentInitiated && (
                                  <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15">
                                    تم الدفع على Paymob
                                  </Badge>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                  disabled={actioningOrderId === o.id}
                                  onClick={() => activateOrder(o.id)}
                                  title={paymentInitiated
                                    ? 'الطالب دفع على Paymob — اضغط هنا لتفعيل الاشتراك يدويًا (الـ webhook لم يصل)'
                                    : 'تفعيل يدوي (تم استلام المبلغ خارج النظام)'}
                                >
                                  {actioningOrderId === o.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <BadgeCheck className="h-3 w-3" />
                                  )}
                                  تفعيل
                                </Button>
                                {!paymentInitiated && (
                                  // Only show "Cancel" if the student did NOT pay yet
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-50"
                                    disabled={actioningOrderId === o.id}
                                    onClick={() => cancelOrder(o.id)}
                                    title="إلغاء الطلب المعلّق"
                                  >
                                    <Ban className="h-3 w-3" />
                                    إلغاء
                                  </Button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* v113: Student subscriptions log (active / expired / free) */}
      <StudentSubscriptionsLog />
      </>
      )}

      {/* v113: Pending Orders section — shows all pending orders for this agent */}
      {activeSection === 'pending' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">الطلبات المعلّقة</h2>
          <p className="text-sm text-muted-foreground">ابحث عن طالب بالكود لرؤية طلباته المعلّقة وتفعيلها أو إلغائها.</p>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4 text-sky-600" />
                بحث عن طالب
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={searchCode}
                  onChange={(e) => setSearchCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !searching) searchStudent(); }}
                  placeholder="كود الطالب..."
                  className="flex-1"
                />
                <Button onClick={searchStudent} disabled={searching || !searchCode.trim()}>بحث</Button>
              </div>
              {searching && <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-sky-500" /></div>}
              {studentResult?.pending_orders && studentResult.pending_orders.length > 0 ? (
                <div className="divide-y mt-3">
                  {studentResult.pending_orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="text-sm font-medium">{o.subject?.name ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{Number(o.amount).toFixed(2)} {o.currency} — {new Date(o.created_at).toLocaleDateString('ar-EG')}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-300 text-emerald-700" disabled={actioningOrderId === o.id} onClick={() => activateOrder(o.id)}>
                          {actioningOrderId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
                          تفعيل
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" disabled={actioningOrderId === o.id} onClick={() => cancelOrder(o.id)}>
                          <Ban className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : studentResult ? (
                <p className="text-sm text-muted-foreground text-center py-4">لا توجد طلبات معلّقة لهذا الطالب.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {/* v113: Students section — quick search */}
      {activeSection === 'students' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">الطلاب</h2>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4 text-sky-600" />
                بحث عن طالب بالكود
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={searchCode}
                  onChange={(e) => setSearchCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !searching) searchStudent(); }}
                  placeholder="كود الطالب..."
                  className="flex-1"
                />
                <Button onClick={searchStudent} disabled={searching || !searchCode.trim()}>بحث</Button>
              </div>
              {searching && <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-sky-500" /></div>}
              {studentResult?.student && (
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="font-medium">{studentResult.student.name ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">{studentResult.student.email}</p>
                  <Badge variant={studentResult.student.account_status === 'active' ? 'default' : 'secondary'} className="text-xs">
                    {studentResult.student.account_status === 'active' ? 'نشط' : 'قيد التفعيل'}
                  </Badge>
                  {studentResult.subscriptions && studentResult.subscriptions.length > 0 && (
                    <div className="mt-2 text-xs space-y-1">
                      <p className="font-medium">الاشتراكات النشطة:</p>
                      {studentResult.subscriptions.map((sub) => (
                        <div key={sub.id} className="flex items-center justify-between">
                          <span>{sub.subject?.name ?? '—'}</span>
                          <Badge variant="secondary" className="text-[10px]">{sub.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* v113: Settings section */}
      {activeSection === 'settings' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">الإعدادات</h2>
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-sm text-muted-foreground">سيتم إضافة إعدادات الوكيل قريبًا.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search by payment code */}
      {activeSection === 'search' && <PaymentCodeSearchBox />}
      {confirmDialog}
    </div>
  );
}