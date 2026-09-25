'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Search, Calendar, Users, Clock, AlertCircle, CheckCircle2, Gift, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';

/**
 * StudentSubscriptionsLog
 *
 * Shows the supervisor (registration_agent) a complete log of all
 * student subscriptions for their teacher's courses — active, expired,
 * and free. Used for tracking enrollment health + renewals.
 *
 * Filter: search by student name/code, filter by status (active/expired/all).
 */

type FilterStatus = 'all' | 'active' | 'expired';

interface SubscriptionRow {
  id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  student_code: string | null;
  subject_id: string;
  subject_name: string;
  enrollment_method: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  next_billing_at: string | null;
  monthly_price: number | null;
  currency: string;
  enrolled_at: string | null;
}

export default function StudentSubscriptionsLog() {
  const [loading, setLoading] = useState(true);
  const [allSubs, setAllSubs] = useState<SubscriptionRow[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/student-subscriptions', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setAllSubs(json.subscriptions ?? []);
      } else {
        toast.error(json.error || 'تعذّر تحميل السجل');
      }
    } catch {
      toast.error('تعذّر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Apply filters
  const now = new Date();
  const filtered = allSubs.filter((s) => {
    if (filter === 'active') {
      if (!s.period_end) return s.enrollment_method === 'teacher_add' || s.enrollment_method === 'agent_register';
      return new Date(s.period_end) > now && s.status === 'approved';
    }
    if (filter === 'expired') {
      if (!s.period_end) return false;
      return new Date(s.period_end) <= now;
    }
    return true; // 'all'
  }).filter((s) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      s.student_name?.toLowerCase().includes(q) ||
      s.student_email?.toLowerCase().includes(q) ||
      s.student_code?.toLowerCase().includes(q) ||
      s.subject_name?.toLowerCase().includes(q)
    );
  });

  // Stats
  const stats = {
    total: allSubs.length,
    active: allSubs.filter((s) => {
      if (!s.period_end) return s.enrollment_method === 'teacher_add' || s.enrollment_method === 'agent_register';
      return new Date(s.period_end) > now && s.status === 'approved';
    }).length,
    expired: allSubs.filter((s) => s.period_end && new Date(s.period_end) <= now).length,
    free: allSubs.filter((s) => s.monthly_price === 0 || s.monthly_price === null).length,
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return iso.slice(0, 10);
    }
  };

  const getDaysLeft = (iso: string | null) => {
    if (!iso) return null;
    const days = Math.ceil((new Date(iso).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days;
  };

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5 text-sky-700" />
          سجل اشتراكات الطلاب
        </CardTitle>
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          <Badge variant="secondary" className="text-xs">الإجمالي: {stats.total}</Badge>
          <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-200 text-xs">نشط: {stats.active}</Badge>
          <Badge variant="destructive" className="text-xs">منتهي: {stats.expired}</Badge>
          <Badge variant="outline" className="text-xs">مجاني: {stats.free}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="ابحث باسم الطالب أو الكود أو المقرر..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ps-9 h-10"
            />
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
              className="h-10"
            >
              الكل
            </Button>
            <Button
              size="sm"
              variant={filter === 'active' ? 'default' : 'outline'}
              onClick={() => setFilter('active')}
              className="h-10"
            >
              نشط
            </Button>
            <Button
              size="sm"
              variant={filter === 'expired' ? 'default' : 'outline'}
              onClick={() => setFilter('expired')}
              className="h-10"
            >
              منتهي
            </Button>
          </div>
        </div>

        {/* Table-like list */}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin me-2" />
            جارٍ التحميل...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            لا توجد اشتراكات مطابقة
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filtered.map((sub, idx) => {
              const daysLeft = getDaysLeft(sub.period_end);
              const isFree = sub.monthly_price === 0 || sub.monthly_price === null;
              const isPermanent = sub.enrollment_method === 'teacher_add' || sub.enrollment_method === 'agent_register';
              const isExpired = sub.period_end && new Date(sub.period_end) <= now;
              const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && !isExpired;

              const statusBadge = isPermanent ? (
                <Badge variant="outline" className="text-xs bg-slate-50">دائم</Badge>
              ) : isFree ? (
                <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200">
                  <Gift className="h-3 w-3 me-1" /> مجاني
                </Badge>
              ) : isExpired ? (
                <Badge variant="destructive" className="text-xs">
                  <AlertCircle className="h-3 w-3 me-1" /> منتهي
                </Badge>
              ) : isExpiringSoon ? (
                <Badge className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-200">
                  <Clock className="h-3 w-3 me-1" /> ينتهي خلال {daysLeft} يوم
                </Badge>
              ) : (
                <Badge className="text-xs bg-teal-100 text-teal-800 hover:bg-teal-200">
                  <CheckCircle2 className="h-3 w-3 me-1" /> نشط
                </Badge>
              );

              return (
                <motion.div
                  key={`${sub.id}-${idx}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                  className="rounded-lg border bg-card p-3 hover:shadow-sm transition-shadow"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Users className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        <span className="font-medium text-sm truncate">
                          {sub.student_name || sub.student_email}
                        </span>
                        {sub.student_code && (
                          <span className="text-xs text-muted-foreground font-mono">
                            ({sub.student_code})
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {sub.subject_name}
                      </div>
                    </div>
                    {statusBadge}
                  </div>

                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>بدأ: {formatDate(sub.period_start || sub.enrolled_at)}</span>
                    </div>
                    {!isPermanent && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>ينتهي: {formatDate(sub.period_end)}</span>
                      </div>
                    )}
                    {!isFree && sub.monthly_price !== null && (
                      <div className="text-muted-foreground">
                        {Number(sub.monthly_price)} {sub.currency || 'EGP'}/شهرياً
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
