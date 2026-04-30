'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/auth-store';
import { useStatusStore } from '@/stores/status-store';
import { useAppStore } from '@/stores/app-store';
import { setSocketAuth, destroySocket } from '@/lib/socket';
import { isSupabaseConfigured } from '@/lib/supabase';
import SupabaseConfigError from '@/components/shared/supabase-config-error';
import BannedUserOverlay from '@/components/shared/banned-user-overlay';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, initialized, initialize, banInfo } = useAuthStore();
  const { cleanup: cleanupStatusStore, init: initStatusStore } = useStatusStore();
  const { reset: resetAppStore } = useAppStore();
  const router = useRouter();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Initialize socket and status store
  useEffect(() => {
    if (user) {
      setSocketAuth(user.id, user.name);
      initStatusStore(user.id);
    } else {
      destroySocket();
      cleanupStatusStore();
    }
  }, [user, initStatusStore, cleanupStatusStore]);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (initialized && !user && !loading) {
      router.replace('/');
    }
  }, [initialized, user, loading, router]);

  if (!isSupabaseConfigured) {
    return <SupabaseConfigError />;
  }

  if (loading || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50" dir="rtl">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 animate-ping" />
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">جاري التحميل...</span>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!user) return null;

  const isBannedUser = banInfo && user.role !== 'admin' && user.role !== 'superadmin';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-emerald-50/30" dir="rtl">
      {isBannedUser ? <BannedUserOverlay>{children}</BannedUserOverlay> : children}
    </div>
  );
}
