'use client';

import { useEffect, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import PendingOrdersSection from '@/components/teacher/pending-orders-section';

interface AgentInfo {
  success: boolean;
  agent: {
    id: string;
    display_name: string | null;
    kind: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    source_id: string | null;
  };
  teacher: { id: string; name: string | null; email: string | null } | null;
}

export default function AgentPortal() {
  const { t } = useTranslations();
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agent/me', { headers: await getCachedAuthHeaders() });
        const json = await res.json();
        if (json.success) setAgentInfo(json as AgentInfo);
      } catch {
        // non-critical — the pending orders section works independently
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sky-700">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>جارٍ تحميل بوابة المشرف...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-3 sm:p-6 max-w-6xl mx-auto">
      <header className="flex items-start gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shrink-0">
          <Clock className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">بوابة المشرف</h1>
          <p className="text-sm text-muted-foreground">
            تفعيل اشتراكات الطلاب وإدارة طلبات الدفع.
          </p>
          {agentInfo && (
            <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
              <Badge variant="outline" className="bg-sky-50 dark:bg-sky-900/20 border-sky-200 text-sky-800 dark:text-sky-200">
                مشرف: {agentInfo.agent.display_name ?? '—'}
              </Badge>
              {agentInfo.teacher && (
                <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 text-emerald-800 dark:text-emerald-200">
                  المعلم: {agentInfo.teacher.name ?? agentInfo.teacher.email ?? '—'}
                </Badge>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Supervisor portal — only pending orders */}
      <PendingOrdersSection />
    </div>
  );
}
