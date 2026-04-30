'use client';

import { use, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';
import SummaryView from '@/components/shared/summary-view';
import { getDefaultPath } from '@/lib/navigation-config';

function SummaryPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const router = useRouter();

  if (!user) {
    router.replace('/');
    return null;
  }

  const handleBack = () => {
    router.push(getDefaultPath(user.role as 'student' | 'teacher' | 'admin' | 'superadmin'));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-teal-50" dir="rtl">
      <SummaryView summaryId={id} onBack={handleBack} />
    </div>
  );
}

export default function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" dir="rtl">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">جاري التحميل...</span>
          </div>
        </div>
      }
    >
      <SummaryPageInner params={params} />
    </Suspense>
  );
}
