'use client';

import { useState } from 'react';
import { Search, Loader2, X, BookOpen, User, Calendar, Wallet, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { generatePaymentCode } from '@/lib/payment/utils';

/**
 * Reusable payment code search box.
 *
 * Lets any logged-in user (student/teacher/agent/admin) search for
 * a payment order by its code (e.g., "SUB-73998EA0").
 *
 * Calls GET /api/orders/search?code=XXX which:
 *   - Filters results by the caller's role (RLS-equivalent)
 *   - Returns the order details + subject + student info
 *
 * The result card shows:
 *   - Payment code (with copy button)
 *   - Status badge (paid/pending/cancelled/failed/refunded)
 *   - Subject name + price
 *   - Student name + email + student_code
 *   - Dates (created_at, paid_at, activated_at)
 *   - Amount + currency
 *
 * If the order is not found OR the caller doesn't have access →
 * shows an error message in the card.
 */
export default function PaymentCodeSearchBox() {
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    order?: {
      payment_code: string;
      status: string;
      status_label: string;
      amount: number;
      currency: string;
      created_at: string;
      paid_at: string | null;
      activated_at: string | null;
      provider_order_ref: string | null;
      subject: { id: string; name: string; price: number; teacher_id: string } | null;
      student: { id: string; name: string | null; email: string; student_code: string | null } | null;
    };
    error?: string;
  } | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!code.trim()) {
      toast.error('اكتب كود العملية أولاً');
      return;
    }
    setSearching(true);
    setResult(null);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch(`/api/orders/search?code=${encodeURIComponent(code.trim())}`, {
        headers,
      });
      const json = await res.json();
      setResult(json);
      if (!json.success) {
        toast.error(json.error || 'لم يتم العثور على العملية');
      } else {
        toast.success('تم العثور على العملية');
      }
    } catch (err) {
      console.error('[search-box] failed:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSearching(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700';
      case 'pending': return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700';
      case 'cancelled':
      case 'failed': return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700';
      case 'refunded': return 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900/30 dark:text-slate-300 dark:border-slate-700';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'paid') return <CheckCircle2 className="h-3 w-3" />;
    if (status === 'cancelled' || status === 'failed') return <XCircle className="h-3 w-3" />;
    return <Calendar className="h-3 w-3" />;
  };

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ابحث بكود العملية (مثال: SUB-73998EA0)"
              className="ps-8"
              disabled={searching}
              dir="ltr"
            />
            {code && !searching && (
              <button
                type="button"
                onClick={() => { setCode(''); setResult(null); }}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="submit" disabled={searching || !code.trim()}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            بحث
          </Button>
        </form>

        {/* Result */}
        {result && result.success && result.order && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-3 space-y-3">
            {/* Header row: code + status */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.order!.payment_code);
                    toast.success(`تم نسخ الكود: ${result.order!.payment_code}`);
                  } catch {
                    toast.error('تعذّر نسخ الكود');
                  }
                }}
                className="text-sm font-mono text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center gap-1"
                title="اضغط للنسخ"
              >
                <span className="font-bold">كود العملية:</span>
                <span className="bg-sky-50 dark:bg-sky-900/20 px-2 py-0.5 rounded">
                  {result.order.payment_code}
                </span>
              </button>
              <Badge variant="outline" className={`text-xs gap-1 ${statusColor(result.order.status)}`}>
                <StatusIcon status={result.order.status} />
                {result.order.status_label}
              </Badge>
            </div>

            {/* Subject + Student + Amount grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">المقرر</div>
                  <div className="font-medium truncate">{result.order.subject?.name ?? '—'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">الطالب</div>
                  <div className="font-medium truncate">
                    {result.order.student?.name ?? result.order.student?.email ?? '—'}
                    {result.order.student?.student_code && (
                      <span className="text-xs text-muted-foreground font-mono ms-1">
                        ({result.order.student.student_code})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">المبلغ</div>
                  <div className="font-mono font-semibold">
                    {Number(result.order.amount).toFixed(2)} {result.order.currency}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">تاريخ الإنشاء</div>
                  <div className="text-xs">{new Date(result.order.created_at).toLocaleString('ar-EG')}</div>
                </div>
              </div>
            </div>

            {/* Paid/Activated dates */}
            {(result.order.paid_at || result.order.activated_at) && (
              <div className="flex flex-wrap gap-3 text-xs text-emerald-700 dark:text-emerald-400">
                {result.order.paid_at && (
                  <span>✓ دُفع: {new Date(result.order.paid_at).toLocaleString('ar-EG')}</span>
                )}
                {result.order.activated_at && (
                  <span>✓ فُعّل: {new Date(result.order.activated_at).toLocaleString('ar-EG')}</span>
                )}
              </div>
            )}

            {/* Paymob reference */}
            {result.order.provider_order_ref && /^\d+$/.test(result.order.provider_order_ref) && (
              <div className="text-xs text-muted-foreground font-mono" dir="ltr">
                Paymob ref: {result.order.provider_order_ref}
              </div>
            )}
          </div>
        )}

        {/* Error result */}
        {result && !result.success && result.error && (
          <div className="mt-4 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-900/15 p-3 text-sm text-rose-700 dark:text-rose-400 flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{result.error}</span>
          </div>
        )}

        {/* Hint when empty */}
        {!result && (
          <p className="mt-3 text-xs text-muted-foreground">
            💡 اكتب كود العملية (مثال: <span className="font-mono">SUB-73998EA0</span>) لتبحث عن تفاصيلها وحالتها.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
