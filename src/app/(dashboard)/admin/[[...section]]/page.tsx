'use client';

import { use, Suspense } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore } from '@/stores/status-store';
import { destroySocket } from '@/lib/socket';
import AdminDashboard from '@/components/admin/admin-dashboard';

function AdminPageInner({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = use(params);
  const { user } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();
  const { cleanup: cleanupStatusStore } = useStatusStore();

  if (!user) return null;

  const handleSignOut = async () => {
    destroySocket();
    cleanupStatusStore();
    resetAppStore();
    const { signOut } = useAuthStore.getState();
    await signOut();
    window.location.href = '/';
  };

  return <AdminDashboard profile={user} onSignOut={handleSignOut} sectionSlug={section} />;
}

export default function AdminPage({ params }: { params: Promise<{ section?: string[] }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" dir="rtl">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Shield className="w-9 h-9 text-white" />
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
              <span className="text-sm font-medium text-purple-700">جاري التحميل...</span>
            </div>
          </div>
        </div>
      }
    >
      <AdminPageInner params={params} />
    </Suspense>
  );
}
