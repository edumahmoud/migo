'use client';

import { Loader2, BookOpen } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore } from '@/stores/status-store';
import { destroySocket } from '@/lib/socket';
import TeacherDashboard from '@/components/teacher/teacher-dashboard';
import RoleGuard from '@/components/shared/role-guard';

export default function TeacherPage() {
  const { user } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();
  const { cleanup: cleanupStatusStore } = useStatusStore();

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items:center shadow-lg shadow-emerald-500/30">
            <BookOpen className="w-9 h-9 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">جاري التحميل...</span>
          </div>
        </div>
      </div>
    );
  }

  const handleSignOut = async () => {
    destroySocket();
    cleanupStatusStore();
    resetAppStore();
    const { signOut } = useAuthStore.getState();
    await signOut();
    window.location.href = '/';
  };

  // RoleGuard ensures only 'teacher' role can access this page
  // Defense in Depth: middleware.ts (Edge) → RoleGuard (client)
  return (
    <RoleGuard allowedRoles={['teacher']}>
      <TeacherDashboard profile={user} onSignOut={handleSignOut} />
    </RoleGuard>
  );
}
