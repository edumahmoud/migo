'use client';

import { useState } from 'react';
import { Clock, Loader2, Search, User, BookOpen, Wallet, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import PendingOrdersSection from '@/components/teacher/pending-orders-section';
import StudentSubscriptionsLog from '@/components/agent/student-subscriptions-log';

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
  subject: { id: string; name: string } | null;
}

export default function AgentPortal() {
  const [searchCode, setSearchCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [studentResult, setStudentResult] = useState<{
    student: StudentResult;
    subscriptions: Subscription[];
    pending_orders: PendingOrder[];
  } | null>(null);

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

  return (
    <div className="space-y-6 p-3 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex items-start gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shrink-0">
          <Clock className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">بوابة المشرف</h1>
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
                      <div key={o.id} className="flex items-center justify-between text-sm border rounded-md px-2 py-1.5 bg-amber-50/40">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-3.5 w-3.5 text-amber-600" />
                          <span className="truncate">{o.subject?.name ?? '—'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono">{Number(o.amount).toFixed(2)} {o.currency}</span>
                          <Badge variant="secondary" className="text-xs">قيد الدفع</Badge>
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

      {/* Pending orders approval */}
      <PendingOrdersSection />

      {/* Student subscriptions log (active / expired / free) */}
      <StudentSubscriptionsLog />
    </div>
  );
}
