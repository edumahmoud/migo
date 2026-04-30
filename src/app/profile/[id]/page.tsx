'use client';

import { use, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';
import UserProfilePage from '@/components/shared/user-profile-page';
import AppSidebar from '@/components/shared/app-sidebar';
import AppHeader from '@/components/shared/app-header';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore } from '@/stores/status-store';
import { destroySocket } from '@/lib/socket';
import { getDefaultPath } from '@/lib/navigation-config';

function ProfilePageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const router = useRouter();
  const { sidebarOpen, setSidebarOpen, reset: resetAppStore } = useAppStore();
  const { cleanup: cleanupStatusStore } = useStatusStore();

  if (!user) {
    router.replace('/');
    return null;
  }

  const handleBack = () => {
    router.push(getDefaultPath(user.role as 'student' | 'teacher' | 'admin' | 'superadmin'));
  };

  const handleSignOut = async () => {
    destroySocket();
    cleanupStatusStore();
    resetAppStore();
    const { signOut } = useAuthStore.getState();
    await signOut();
    window.location.href = '/';
  };

  const handleOpenSettings = () => {
    router.push(getDefaultPath(user.role as 'student' | 'teacher' | 'admin' | 'superadmin') + '/settings');
  };

  const handleSectionChange = (section: string) => {
    const basePath = getDefaultPath(user.role as 'student' | 'teacher' | 'admin' | 'superadmin');
    router.push(section === 'dashboard' ? basePath : `${basePath}/${section}`);
  };

  // Determine active section from current path (we're on profile)
  const activeSection = 'dashboard'; // Default for profile page sidebar

  return (
    <div className="flex min-h-screen bg-background" dir="rtl">
      <AppHeader
        userName={user.name}
        userId={user.id}
        userRole={user.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
        userGender={user.gender}
        titleId={user.title_id}
        avatarUrl={user.avatar_url}
        onSignOut={handleSignOut}
        onOpenSettings={handleOpenSettings}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        sidebarCollapsed={!sidebarOpen}
      />
      <AppSidebar
        role={user.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />
      <main className={`flex-1 pt-14 sm:pt-16 transition-all duration-300 pl-0 ${
        sidebarOpen ? 'md:pr-64' : 'md:pr-[68px]'
      }`}>
        <UserProfilePage
          userId={id}
          currentUser={user}
          onBack={handleBack}
        />
      </main>
    </div>
  );
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
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
      <ProfilePageInner params={params} />
    </Suspense>
  );
}
