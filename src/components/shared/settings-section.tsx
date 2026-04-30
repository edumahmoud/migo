'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  User,
  Mail,
  Trash2,
  Loader2,
  AlertTriangle,
  Camera,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  Shield,
  GraduationCap,
  Save,
  X,
  ZoomIn,
  Download,
  WifiOff,
  Check,
  BellRing,
  BellOff,
  Bell,
  RotateCcw,
  Smartphone,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { useSharedSocket, useSocketEvent, setSocketAuth } from '@/lib/socket';
import { useStatusStore, getStatusColor } from '@/stores/status-store';
import type { UserProfile, UserStatus } from '@/lib/types';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface SettingsSectionProps {
  profile: UserProfile;
  onUpdateProfile: (updates: Partial<UserProfile>) => Promise<{ error: string | null }>;
  onDeleteAccount: () => Promise<void>;
}

// -------------------------------------------------------
// Constants
// -------------------------------------------------------
const GENDER_OPTIONS = [
  { value: 'male', label: 'ذكر' },
  { value: 'female', label: 'أنثى' },
] as const;

const ACADEMIC_TITLES = [
  { value: 'teacher', label: 'معلم', femaleLabel: 'معلمة' },
  { value: 'dr', label: 'دكتور', femaleLabel: 'دكتورة' },
  { value: 'prof', label: 'أستاذ', femaleLabel: 'أستاذة' },
  { value: 'assoc_prof', label: 'أستاذ مشارك', femaleLabel: 'أستاذة مشاركة' },
  { value: 'assist_prof', label: 'أستاذ مساعد', femaleLabel: 'أستاذة مساعدة' },
  { value: 'lecturer', label: 'محاضر', femaleLabel: 'محاضرة' },
  { value: 'teaching_assist', label: 'معيد', femaleLabel: 'معيدة' },
] as const;

const STATUS_OPTIONS: {
  value: UserStatus;
  label: string;
  color: string;       // Tailwind bg class for the dot
  textColor: string;   // Tailwind text class for label
  borderColor: string; // Tailwind border class when selected
  bgColor: string;     // Tailwind bg class when selected
  description: string;
}[] = [
  {
    value: 'online',
    label: 'متصل',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-500',
    bgColor: 'bg-emerald-50',
    description: 'متاح',
  },
  {
    value: 'busy',
    label: 'مشغول',
    color: 'bg-amber-500',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-500',
    bgColor: 'bg-amber-50',
    description: 'مشغول',
  },
  {
    value: 'away',
    label: 'بعيد',
    color: 'bg-orange-500',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-500',
    bgColor: 'bg-orange-50',
    description: 'بعيد',
  },
  {
    value: 'invisible',
    label: 'غير مرئي',
    color: 'bg-gray-400',
    textColor: 'text-gray-600',
    borderColor: 'border-gray-400',
    bgColor: 'bg-gray-50',
    description: 'مخفي',
  },
  {
    value: 'offline',
    label: 'غير متصل',
    color: 'bg-gray-400',
    textColor: 'text-gray-500',
    borderColor: 'border-gray-400',
    bgColor: 'bg-gray-50',
    description: 'غير مرئي',
  },
];

const STATUS_STORAGE_KEY = 'attenddo-user-status';
const ORIENTATION_LOCK_KEY = 'attendo-orientation-locked';

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: 'easeOut' },
  }),
};

// -------------------------------------------------------
// Component
// -------------------------------------------------------
export default function SettingsSection({
  profile,
  onUpdateProfile,
  onDeleteAccount,
}: SettingsSectionProps) {
  const { refreshProfile } = useAuthStore();

  // ─── Shared socket ───
  const { isConnected, status: socketStatus, emitStatusChange } = useSharedSocket();

  // ─── Status store ───
  const { myStatus, setMyStatus, init: initStatusStore } = useStatusStore();

  // ─── Form state ───
  const [name, setName] = useState(profile.name);
  const [username, setUsername] = useState(profile.username || '');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [gender, setGender] = useState(profile.gender || '');
  // Default title for teachers is 'teacher' (معلم/معلمة), others have no title
  const [titleId, setTitleId] = useState(profile.title_id || (profile.role === 'teacher' ? 'teacher' : ''));
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);


  // ─── Avatar upload ───
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false);

  // ─── Password change ───
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // ─── Delete account ───
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // ─── Notification permission ───
  const [pushPermission, setPushPermission] = useState<NotificationPermissionState>('default');
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  // ─── Orientation lock ───
  const [orientationLocked, setOrientationLocked] = useState(false);
  const [orientationSupported, setOrientationSupported] = useState(false);

  // ─── Status / Presence (now from global store) ───
  const userStatus = myStatus;

  // ─── Navigation cleanup: close all Radix UI Dialogs when navigating away ───
  // When the user navigates to a different section while a Dialog is open,
  // Radix UI keeps `inert` on page content and `pointer-events: none` on body.
  // This effect closes all Dialogs when the pathname changes or a cleanup event fires.
  const pathname = usePathname();
  useEffect(() => {
    setAvatarPreviewOpen(false);
    setDeleteConfirmOpen(false);
  }, [pathname]);

  // Also listen for the custom navigation:cleanup event (dispatched by cleanupAfterNavigation)
  useEffect(() => {
    const handleNavCleanup = () => {
      setAvatarPreviewOpen(false);
      setDeleteConfirmOpen(false);
    };
    document.addEventListener('navigation:cleanup', handleNavCleanup);
    return () => {
      document.removeEventListener('navigation:cleanup', handleNavCleanup);
    };
  }, []);

  // ─── Set socket auth credentials ───
  useEffect(() => {
    setSocketAuth(profile.id, profile.name);
  }, [profile.id, profile.name]);

  // ─── Re-emit current status whenever socket reconnects ───
  useEffect(() => {
    if (isConnected) {
      emitStatusChange(profile.id, myStatus);
    }
  }, [isConnected, profile.id, emitStatusChange, myStatus]);

  // ─── Initialize status store with userId ───
  useEffect(() => {
    if (profile.id) {
      initStatusStore(profile.id);
    }
  }, [initStatusStore, profile.id]);

  // ─── Check notification permission ───
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    setPushPermission(Notification.permission);
  }, []);

  // ─── Check orientation lock support ───
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supported = !!(screen as any)?.orientation?.lock;
    setOrientationSupported(supported);
    // Check if previously locked
    const wasLocked = localStorage.getItem(ORIENTATION_LOCK_KEY) === 'true';
    setOrientationLocked(wasLocked);
  }, []);

  // ─── Handle status change ───
  const handleStatusChange = useCallback((newStatus: UserStatus) => {
    // Update status store (handles localStorage + socket emission)
    setMyStatus(newStatus, profile.id);

    const statusLabel = STATUS_OPTIONS.find(s => s.value === newStatus)?.label || newStatus;
    toast.success(`تم تغيير الحالة إلى: ${statusLabel}`);
  }, [profile.id, setMyStatus]);

  // ─── Auth headers helper ───
  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  // ─── Username availability check (debounced) ───
  useEffect(() => {
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const originalUsername = (profile.username || '').toLowerCase();

    // If username hasn't changed from profile, it's available
    if (clean === originalUsername) {
      setUsernameAvailable(true);
      setIsCheckingUsername(false);
      return;
    }

    if (clean.length < 3) {
      setUsernameAvailable(false);
      setIsCheckingUsername(false);
      return;
    }

    setIsCheckingUsername(true);
    const timeout = setTimeout(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/username-check', {
          method: 'POST',
          headers,
          body: JSON.stringify({ username: clean, currentUserId: profile.id }),
        });
        const data = await res.json();
        setUsernameAvailable(data.available === true);
      } catch {
        setUsernameAvailable(null);
      } finally {
        setIsCheckingUsername(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [username, profile.username, profile.id]);

  // ─── Keep local state in sync ───
  useEffect(() => {
    setName(profile.name);
    setUsername(profile.username || '');
    setGender(profile.gender || '');
    setTitleId(profile.title_id || (profile.role === 'teacher' ? 'teacher' : ''));
  }, [profile.name, profile.username, profile.gender, profile.title_id, profile.role]);


  // ─── Track changes ───
  useEffect(() => {
    const nameChanged = name.trim() !== profile.name;
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const usernameChanged = cleanUsername !== (profile.username || '').toLowerCase();
    const genderChanged = (gender || '') !== (profile.gender || '');
    // For teachers, 'teacher' title is the default (equivalent to null/empty in DB)
    const effectiveTitleId = titleId === 'teacher' ? '' : titleId;
    const titleChanged = (effectiveTitleId || '') !== (profile.title_id || '');
    setHasChanges(nameChanged || usernameChanged || genderChanged || titleChanged);
  }, [name, username, gender, titleId, profile.name, profile.username, profile.gender, profile.title_id]);

  // ─── Cache-busted avatar URL ───
  const avatarSrc = useMemo(() => {
    if (!profile.avatar_url) return '';
    // Guard: if this URL is actually an institution logo, don't show it as user avatar
    if (profile.avatar_url.includes('/institution/logos/') || profile.avatar_url.includes('/institution%2Flogos%2F')) return '';
    const hash = profile.avatar_url.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
    const sep = profile.avatar_url.includes('?') ? '&' : '?';
    return `${profile.avatar_url}${sep}cb=${Math.abs(hash)}`;
  }, [profile.avatar_url]);

  // Gender-aware role labels (teachers show their academic title)
  const getRoleLabel = (role: string, g: string | null | undefined, tid: string | null | undefined) => {
    const isFemale = g === 'female';
    switch (role) {
      case 'student': return isFemale ? 'طالبة' : 'طالب';
      case 'superadmin': return isFemale ? 'مديرة المنصة' : 'مدير المنصة';
      case 'admin': return isFemale ? 'مشرفة' : 'مشرف';
      case 'teacher': {
        const effectiveTitleId = tid || 'teacher';
        const title = ACADEMIC_TITLES.find(t => t.value === effectiveTitleId);
        if (title) {
          return isFemale ? title.femaleLabel : title.label;
        }
        return isFemale ? 'معلمة' : 'معلم';
      }
      default: return role;
    }
  };
  const roleLabel = getRoleLabel(profile.role, gender || profile.gender, titleId || profile.title_id);

  const roleBadgeClass = profile.role === 'superadmin'
    ? 'bg-amber-100 text-amber-700 border-amber-200'
    : profile.role === 'admin'
      ? 'bg-purple-100 text-purple-700 border-purple-200'
      : profile.role === 'teacher'
        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
        : 'bg-sky-100 text-sky-700 border-sky-200';

  // ─── Server-side profile update (bypasses RLS) ───
  const updateProfileServer = async (updates: Partial<UserProfile>): Promise<{ error: string | null }> => {
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id, updates }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        return { error: data.error || 'حدث خطأ أثناء التحديث' };
      }

      // Refresh the auth store profile to keep UI in sync
      await refreshProfile();
      return { error: null };
    } catch {
      return { error: 'حدث خطأ غير متوقع' };
    }
  };

  // ─── Save handler ───
  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('الاسم مطلوب');
      return;
    }

    // Validate username if changed
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const usernameChanged = cleanUsername !== (profile.username || '').toLowerCase();
    if (usernameChanged) {
      if (cleanUsername.length < 3) {
        toast.error('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
        return;
      }
      if (!usernameAvailable) {
        toast.error('اسم المستخدم غير متاح');
        return;
      }
    }

    setIsSaving(true);
    try {
      const updates: Partial<UserProfile> = { name: trimmed };

      if (usernameChanged) {
        updates.username = cleanUsername;
      }

      if ((gender || '') !== (profile.gender || '')) {
        updates.gender = gender || null;
      }

      if ((titleId || '') !== (profile.title_id || '')) {
        // 'teacher' is the default title — store as null in DB
        updates.title_id = (titleId && titleId !== 'teacher') ? titleId : null;
      }

      // Use server-side update to bypass RLS
      const result = await updateProfileServer(updates);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('تم حفظ الإعدادات بنجاح');
        setHasChanges(false);
      }
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Avatar upload ───
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('يرجى اختيار ملف صورة فقط');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('حجم الصورة يجب أن يكون أقل من 5 ميجابايت');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', profile.id);

      // Use dedicated avatar upload endpoint
      const res = await fetch('/api/avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'حدث خطأ أثناء رفع الصورة');
        return;
      }

      // Refresh profile to get the new avatar URL
      await refreshProfile();
      toast.success('تم تحديث الصورة الشخصية بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء رفع الصورة');
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  };

  // ─── Password change ───
  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error('يرجى إدخال كلمة المرور الحالية');
      return;
    }
    if (!newPassword) {
      toast.error('يرجى إدخال كلمة المرور الجديدة');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('كلمة المرور الجديدة غير متطابقة');
      return;
    }
    if (currentPassword === newPassword) {
      toast.error('كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية');
      return;
    }

    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error('فشل في تغيير كلمة المرور. تأكد من صحة كلمة المرور الحالية');
        return;
      }
      toast.success('تم تغيير كلمة المرور بنجاح');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      toast.error('حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setIsChangingPassword(false);
    }
  };

  // ─── Delete account ───
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'حذف') {
      toast.error('يرجى كتابة "حذف" للتأكيد');
      return;
    }

    setIsDeleting(true);
    try {
      await onDeleteAccount();
      toast.success('تم حذف الحساب بنجاح');
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
    } catch {
      toast.error('حدث خطأ أثناء حذف الحساب');
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── Current status info ───
  const currentStatusInfo = STATUS_OPTIONS.find(s => s.value === userStatus) || STATUS_OPTIONS[0];

  // ─── Helper: wait for SW with timeout ───
  const waitForServiceWorker = async (timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> => {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('SW timeout')), timeoutMs)),
      ]);
      return registration as ServiceWorkerRegistration;
    } catch {
      return null;
    }
  };

  // ─── Toggle push notifications ───
  const handleTogglePush = async () => {
    setIsTogglingPush(true);
    try {
      if (pushPermission === 'granted') {
        // Disable push — unsubscribe
        const registration = await waitForServiceWorker(3000);
        if (registration) {
          try {
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) {
              await subscription.unsubscribe();
              await fetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: subscription.endpoint }),
              });
            }
          } catch {
            // Push not available, just update UI
          }
        }
        setPushPermission('default');
        toast.success('تم إيقاف الإشعارات الخارجية');
      } else {
        // Enable push — request permission first
        if (!('Notification' in window)) {
          toast.error('المتصفح لا يدعم الإشعارات');
          return;
        }

        const result = await Notification.requestPermission();
        setPushPermission(result);
        if (result !== 'granted') {
          toast.error('تم رفض إذن الإشعارات. يمكنك تفعيله من إعدادات المتصفح.');
          return;
        }

        toast.success('تم تفعيل الإشعارات!');

        // Try Web Push subscription (only works in standalone/secure context)
        const registration = await waitForServiceWorker(4000);
        if (registration?.pushManager) {
          try {
            // Ensure push_subscriptions table exists
            await fetch('/api/push/setup', { method: 'POST' }).catch(() => {});

            const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BEmz0poQ1JXb7aq39ZTW6t1OUSRMgFxaONIgKlUDYxEgW9P_pT-_etTSj9YV-gLOgFnqSEnPqjUuhLLJLAf5qEE';
            const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4);
            const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
            const subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: outputArray,
            });
            const subJSON = subscription.toJSON();
            await fetch('/api/push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: profile.id,
                subscription: { endpoint: subJSON.endpoint, keys: { p256dh: subJSON.keys?.p256dh, auth: subJSON.keys?.auth } },
              }),
            });
            toast.success('تم تفعيل الإشعارات الخارجية! ستصلك حتى عند إغلاق المتصفح.');
          } catch (pushError) {
            // Push subscription failed (common in iframe/sandbox)
            console.warn('[Push] Web Push subscription failed:', pushError);
            toast.info('الإشعارات تعمل داخل التطبيق. لتلقي إشعارات خارجية، افتح التطبيق كـ PWA.');
          }
        } else {
          // SW not available or timed out
          toast.info('الإشعارات تعمل داخل التطبيق. لتلقي إشعارات خارجية، افتح التطبيق كـ PWA.');
        }
      }
    } catch (error) {
      console.error('Push toggle error:', error);
      toast.error('حدث خطأ في تغيير إعدادات الإشعارات');
    } finally {
      setIsTogglingPush(false);
    }
  };

  // ─── Test push notification ───
  const handleTestNotification = async () => {
    try {
      if (pushPermission !== 'granted') {
        toast.error('يرجى تفعيل الإشعارات أولاً');
        return;
      }

      // Try to send a test push notification via the server
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profile.id,
          title: 'إشعار تجريبي 🔔',
          message: 'تم تفعيل الإشعارات الخارجية بنجاح! ستصلك الإشعارات حتى عند إغلاق المتصفح.',
          type: 'system',
        }),
      });

      const data = await res.json();
      if (data.sent > 0) {
        toast.success('تم إرسال إشعار تجريبي! تحقق من إشعارات المتصفح.');
      } else {
        // Fallback: show an in-app notification instead
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('إشعار تجريبي 🔔', {
            body: 'الإشعارات تعمل داخل المتصفح. لتلقي إشعارات خارجية، افتح التطبيق كـ PWA.',
            icon: '/icons/icon-192x192.png',
            dir: 'rtl',
          });
          toast.info('تم إرسال إشعار محلي. الإشعارات الخارجية تحتاج تثبيت التطبيق كـ PWA.');
        } else {
          toast.info('لا توجد اشتراكات إشعارات خارجية. الإشعارات تعمل داخل التطبيق فقط.');
        }
      }
    } catch {
      toast.error('فشل في إرسال الإشعار التجريبي');
    }
  };

  // ─── Toggle orientation lock ───
  const handleToggleOrientation = async () => {
    try {
      const screenOrientation = (screen as any)?.orientation;
      if (!screenOrientation?.lock) {
        toast.info('قفل الاتجاه غير مدعوم في هذا المتصفح');
        return;
      }
      if (orientationLocked) {
        // Unlock
        await screenOrientation.unlock();
        setOrientationLocked(false);
        localStorage.setItem(ORIENTATION_LOCK_KEY, 'false');
        toast.success('تم إلغاء قفل اتجاه الشاشة');
      } else {
        // Lock to portrait
        await screenOrientation.lock('portrait');
        setOrientationLocked(true);
        localStorage.setItem(ORIENTATION_LOCK_KEY, 'true');
        toast.success('تم قفل اتجاه الشاشة على الوضع العمودي');
      }
    } catch (error) {
      console.error('Orientation lock error:', error);
      toast.error('قفل الاتجاه غير مدعوم أو تم رفض الإذن');
    }
  };

  // ─── Render ───
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-foreground">الإعدادات</h2>
        <p className="text-sm text-muted-foreground mt-0.5">إدارة الملف الشخصي وإعدادات الحساب</p>
      </div>


      {/* Main grid: two columns on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ─── Left column: Profile Info + Status ─── */}
        <div className="space-y-4">
          {/* Profile Info Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <User className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">الملف الشخصي</h3>
            </div>

            <div className="p-4 space-y-4">
              {/* Avatar + Name row */}
              <div className="flex items-start gap-4">
                <div className="relative shrink-0 group">
                  <Avatar
                    className="h-20 w-20 border-2 border-emerald-200 shadow-sm cursor-pointer"
                    onClick={() => profile.avatar_url && setAvatarPreviewOpen(true)}
                  >
                    <AvatarImage src={avatarSrc} alt={profile.name} className="object-cover" />
                    <AvatarFallback className="bg-emerald-100 text-emerald-700">
                      <User className="h-8 w-8" />
                    </AvatarFallback>
                  </Avatar>
                  {isUploadingAvatar && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                  {/* Click overlay: preview if avatar exists, otherwise upload */}
                  {!isUploadingAvatar && profile.avatar_url && (
                    <button
                      onClick={() => setAvatarPreviewOpen(true)}
                      className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 group-hover:bg-black/40 transition-colors cursor-pointer"
                    >
                      <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}
                  {!isUploadingAvatar && !profile.avatar_url && (
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 group-hover:bg-black/40 transition-colors cursor-pointer"
                    >
                      <Camera className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                    disabled={isUploadingAvatar}
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="space-y-2">
                    <div>
                      <Label htmlFor="settings-name" className="text-xs text-muted-foreground">
                        الاسم
                      </Label>
                      <Input
                        id="settings-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="أدخل اسمك"
                        className="text-right h-9 text-sm"
                        disabled={isSaving}
                      />
                    </div>
                    <div>
                      <Label htmlFor="settings-username" className="text-xs text-muted-foreground">
                        اسم المستخدم
                      </Label>
                      <div className="relative">
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">@</div>
                        <Input
                          id="settings-username"
                          value={username}
                          onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                          placeholder="username"
                          className="text-left pl-9 pr-8 h-9 text-sm"
                          disabled={isSaving}
                          dir="ltr"
                        />
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                          {isCheckingUsername && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                          {!isCheckingUsername && usernameAvailable === true && username.trim().length >= 3 && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          )}
                          {!isCheckingUsername && usernameAvailable === false && (
                            <X className="h-3.5 w-3.5 text-rose-500" />
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">سيظهر في رابط صفحتك الشخصية</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 text-xs"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={isUploadingAvatar}
                    >
                      <Camera className="h-3.5 w-3.5" />
                      {profile.avatar_url ? 'تغيير الصورة' : 'إضافة صورة'}
                    </Button>
                    <span className="text-[10px] text-muted-foreground">PNG, JPG حتى 5MB</span>
                  </div>
                </div>
              </div>

              {/* Gender + Role row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Gender */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الجنس</Label>
                  <div className="flex gap-1.5">
                    {GENDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setGender(gender === opt.value ? '' : opt.value)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          gender === opt.value
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                        disabled={isSaving}
                      >
                        {opt.label}
                      </button>
                    ))}
                    {gender && (
                      <button
                        onClick={() => setGender('')}
                        className="rounded-lg border border-border px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted/50 transition-colors"
                        disabled={isSaving}
                      >
                        إزالة
                      </button>
                    )}
                  </div>
                </div>

                {/* Role (display only) - for teachers shows academic title */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">صفة المستخدم</Label>
                  <div>
                    <Badge className={`${roleBadgeClass} border text-xs`}>
                      {roleLabel}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Email (read-only) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">البريد الإلكتروني</Label>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground select-all truncate">{profile.email}</span>
                  <Badge variant="outline" className="mr-auto text-[9px] px-1.5 py-0 shrink-0">للقراءة فقط</Badge>
                </div>
              </div>

              {/* Academic title (teacher only - always shown, includes معلم/معلمة as default) */}
              {profile.role === 'teacher' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    اللقب الأكاديمي
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ACADEMIC_TITLES.map((title) => {
                      const displayLabel = (gender || profile.gender) === 'female' ? title.femaleLabel : title.label;
                      return (
                        <button
                          key={title.value}
                          onClick={() => setTitleId(title.value)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                            titleId === title.value
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}
                          disabled={isSaving}
                        >
                          {displayLabel}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-muted-foreground">سيظهر كـ:</span>
                    <span className="text-xs font-semibold text-emerald-700">
                      {(() => {
                        const t = ACADEMIC_TITLES.find((t) => t.value === titleId);
                        if (!t) return '';
                        return ((gender || profile.gender) === 'female' ? t.femaleLabel : t.label);
                      })()} {profile.name}
                    </span>
                  </div>
                </div>
              )}

              {/* Save Button - inside the card */}
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !hasChanges}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-9 min-w-[120px]"
                >
                  {isSaving ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      جاري الحفظ...
                    </span>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      حفظ الإعدادات
                    </>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>

          {/* ─── Status / Presence Card ─── */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={1}
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100">
                <div className={`h-2.5 w-2.5 rounded-full ${currentStatusInfo.color} ${userStatus === 'online' && isConnected ? 'animate-pulse' : ''}`} />
              </div>
              <h3 className="font-semibold text-foreground text-sm">الحالة والظهور</h3>
            </div>

            <div className="p-4 space-y-4">
              {/* Current status display - clean and prominent */}
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${currentStatusInfo.bgColor} ${currentStatusInfo.borderColor}/20`}>
                    <div className={`h-4 w-4 rounded-full ${currentStatusInfo.color}`} />
                  </div>
                  {userStatus === 'online' && isConnected && (
                    <div className={`absolute inset-0 h-10 w-10 rounded-full ${currentStatusInfo.color} animate-ping opacity-15`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{currentStatusInfo.label}</p>
                    {/* Connection indicator - shows actual socket status */}
                    <div className="flex items-center gap-1" title={
                      isConnected ? 'متصل بالخادم' 
                        : socketStatus === 'connecting' ? 'جاري الاتصال بالخادم...' 
                        : 'غير متصل بالخادم'
                    }>
                      <div className={`h-1.5 w-1.5 rounded-full ${
                        isConnected ? 'bg-emerald-500' 
                          : socketStatus === 'connecting' ? 'bg-amber-400 animate-pulse' 
                          : 'bg-red-400'
                      }`} />
                      <span className={`text-[10px] ${
                        isConnected ? 'text-emerald-600' 
                          : socketStatus === 'connecting' ? 'text-amber-600' 
                          : 'text-red-500'
                      }`}>
                        {isConnected ? 'متصل' 
                          : socketStatus === 'connecting' ? 'جاري الاتصال' 
                          : 'غير متصل'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {userStatus === 'invisible'
                      ? 'ستظهر كغير متصل مع إمكانية استخدام المحادثة'
                      : userStatus === 'online'
                        ? 'ستظهر كمتصل للآخرين'
                        : userStatus === 'busy'
                          ? 'ستظهر كمشغول للآخرين'
                          : userStatus === 'away'
                            ? 'ستظهر كبعيد عن الجهاز'
                            : 'ستظهر كغير متصل'}
                  </p>
                </div>
              </div>

              {/* Status options */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">تغيير حالتك</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {STATUS_OPTIONS.map((option) => {
                    const isSelected = userStatus === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => handleStatusChange(option.value)}
                        className={`relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-all duration-200 text-right cursor-pointer ${
                          isSelected
                            ? `${option.borderColor} ${option.bgColor} shadow-sm`
                            : 'border-border hover:bg-muted/50 hover:border-muted-foreground/20'
                        }`}
                      >
                        <div className={`h-3 w-3 rounded-full shrink-0 ${option.color}`} />
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-medium ${isSelected ? option.textColor : 'text-foreground'}`}>
                            {option.label}
                          </span>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                            {option.value === 'online' ? 'متاح للمحادثة' :
                             option.value === 'busy' ? 'مشغول، لا يمكن إزعاجك' :
                             option.value === 'away' ? 'بعيد عن الجهاز' :
                             option.value === 'invisible' ? 'مخفي، تظهر كغير متصل' :
                             'غير متصل بالمحادثة'}
                          </p>
                        </div>
                        {isSelected && (
                          <Check className={`h-3.5 w-3.5 shrink-0 ${option.textColor}`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Invisible mode note */}
              {userStatus === 'invisible' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-2.5 flex items-start gap-2">
                  <WifiOff className="h-3.5 w-3.5 text-gray-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-gray-600">
                    أنت في وضع عدم الظهور. يمكنك استخدام المحادثة واستقبال الرسائل، لكنك ستظهر كغير متصل للآخرين.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* ─── Right column: App Settings + Password + Danger Zone ─── */}
        <div className="space-y-4">
          {/* App Settings Card (Notifications + Orientation) */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={2}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <Smartphone className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">إعدادات التطبيق</h3>
            </div>

            <div className="p-4 space-y-4">
              {/* Push Notifications Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    pushPermission === 'granted'
                      ? 'bg-emerald-100 text-emerald-600'
                      : pushPermission === 'denied'
                        ? 'bg-rose-100 text-rose-600'
                        : 'bg-amber-100 text-amber-600'
                  }`}>
                    {pushPermission === 'granted' ? (
                      <BellRing className="h-4 w-4" />
                    ) : pushPermission === 'denied' ? (
                      <BellOff className="h-4 w-4" />
                    ) : (
                      <Bell className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">الإشعارات الخارجية</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {pushPermission === 'granted'
                        ? 'مفعّلة — ستصلك الإشعارات عند إغلاق المتصفح'
                        : pushPermission === 'denied'
                          ? 'محظورة — فعّلها من إعدادات المتصفح'
                          : 'غير مفعّلة — اضغط لتفعيل الإشعارات خارج المتصفح'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleTogglePush}
                  disabled={isTogglingPush || pushPermission === 'denied'}
                  className={`relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200 ${
                    pushPermission === 'granted'
                      ? 'bg-emerald-500'
                      : pushPermission === 'denied'
                        ? 'bg-rose-300 cursor-not-allowed'
                        : 'bg-muted-foreground/30'
                  }`}
                  aria-label={pushPermission === 'granted' ? 'إيقاف الإشعارات' : 'تفعيل الإشعارات'}
                >
                  <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    pushPermission === 'granted' ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}>
                    {isTogglingPush && (
                      <div className="flex h-full w-full items-center justify-center">
                        <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />
                      </div>
                    )}
                  </div>
                </button>
              </div>

              {/* Test notification button (visible when granted) */}
              {pushPermission === 'granted' && (
                <button
                  onClick={handleTestNotification}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100/60 active:bg-emerald-100 transition-colors"
                >
                  <BellRing className="h-3.5 w-3.5" />
                  إرسال إشعار تجريبي
                </button>
              )}

              {/* Divider */}
              <div className="border-t" />

              {/* Orientation Lock Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    orientationLocked
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-muted/50 text-muted-foreground'
                  }`}>
                    <RotateCcw className={`h-4 w-4 ${orientationLocked ? 'rotate-180' : ''} transition-transform`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">قفل اتجاه الشاشة</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {orientationLocked
                        ? 'مقفل — الشاشة ثابتة على الوضع العمودي'
                        : 'غير مقفل — الشاشة تدور تلقائياً مع الجهاز'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleToggleOrientation}
                  disabled={!orientationSupported}
                  className={`relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200 ${
                    orientationLocked
                      ? 'bg-blue-500'
                      : !orientationSupported
                        ? 'bg-muted-foreground/20 cursor-not-allowed'
                        : 'bg-muted-foreground/30'
                  }`}
                  aria-label={orientationLocked ? 'إلغاء قفل الشاشة' : 'قفل الشاشة'}
                  title={!orientationSupported ? 'غير مدعوم في هذا المتصفح' : undefined}
                >
                  <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    orientationLocked ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>

              {/* Info note */}
              {!orientationSupported && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700">
                    قفل اتجاه الشاشة يعمل فقط عند تثبيت التطبيق كـ PWA على الهاتف. في المتصفح العادي، يمكنك قفل الاتجاه من إعدادات الجهاز.
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Password Change Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={2}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <Lock className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">تغيير كلمة المرور</h3>
            </div>

            <div className="p-4 space-y-3">
              {/* Current password */}
              <div className="space-y-1">
                <Label htmlFor="current-password" className="text-xs text-muted-foreground">
                  كلمة المرور الحالية
                </Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="أدخل كلمة المرور الحالية"
                    className="text-left pr-10 h-9 text-sm"
                    disabled={isChangingPassword}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div className="space-y-1">
                <Label htmlFor="new-password" className="text-xs text-muted-foreground">
                  كلمة المرور الجديدة
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="أدخل كلمة المرور الجديدة"
                    className="text-left pr-10 h-9 text-sm"
                    disabled={isChangingPassword}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Confirm new password */}
              <div className="space-y-1">
                <Label htmlFor="confirm-password" className="text-xs text-muted-foreground">
                  تأكيد كلمة المرور الجديدة
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعد إدخال كلمة المرور الجديدة"
                    className="text-left pr-10 h-9 text-sm"
                    disabled={isChangingPassword}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-9 text-xs"
              >
                {isChangingPassword ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    جاري التغيير...
                  </span>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    تغيير كلمة المرور
                  </>
                )}
              </Button>
            </div>
          </motion.div>

          {/* Danger Zone Card - hidden for superadmin */}
          {profile.role !== 'superadmin' && (
          <motion.div
            className="rounded-xl border border-rose-200 bg-rose-50/30 shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={3}
          >
            <div className="flex items-center gap-2 border-b border-rose-200 px-4 py-2.5 bg-rose-50/50">
              <Shield className="h-4 w-4 text-rose-500" />
              <h3 className="font-semibold text-rose-700 text-sm">منطقة الخطر</h3>
            </div>

            <div className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-rose-700 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    حذف الحساب
                  </h4>
                  <p className="text-[11px] text-rose-600/80 mt-0.5">
                    سيؤدي إلى إزالة جميع بياناتك نهائياً. هذا الإجراء لا يمكن التراجع عنه.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5 shrink-0 h-8 text-xs"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  حذف الحساب
                </Button>
              </div>

              {/* Delete confirmation dialog */}
              <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => {
                setDeleteConfirmOpen(open);
                if (!open) setDeleteConfirmText('');
              }}>
                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader className="text-right">
                    <AlertDialogTitle className="text-right flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-rose-500" />
                      تأكيد حذف الحساب
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-right">
                      هذا الإجراء لا يمكن التراجع عنه. سيتم حذف حسابك وجميع بياناتك بشكل نهائي.
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <div className="space-y-3 py-2">
                    <p className="text-sm text-muted-foreground">
                      يرجى كتابة <span className="font-bold text-rose-600">حذف</span> للتأكيد:
                    </p>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder='اكتب "حذف" هنا'
                      className="text-right"
                      dir="rtl"
                    />
                  </div>

                  <AlertDialogFooter className="flex-row-reverse gap-2">
                    <AlertDialogCancel disabled={isDeleting}>إلغاء</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-rose-600 hover:bg-rose-700 text-white"
                      disabled={isDeleting || deleteConfirmText !== 'حذف'}
                    >
                      {isDeleting ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري الحذف...
                        </span>
                      ) : (
                        'حذف الحساب نهائياً'
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </motion.div>
          )}
        </div>
      </div>

      {/* Avatar Preview Dialog */}
      <Dialog open={avatarPreviewOpen} onOpenChange={setAvatarPreviewOpen}>
        <DialogContent
          className="sm:max-w-md p-0 overflow-hidden bg-black/95 border-none"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">معاينة الصورة الشخصية</DialogTitle>
          <div className="relative flex items-center justify-center min-h-[300px]">
            <img
              src={profile.avatar_url || ''}
              alt={profile.name}
              className="max-h-[70vh] max-w-full object-contain"
            />
            {/* Close button */}
            <button
              onClick={() => setAvatarPreviewOpen(false)}
              className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            {/* Download button */}
            <a
              href={profile.avatar_url || ''}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-3 left-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <Download className="h-4 w-4" />
            </a>
            {/* Change avatar button */}
            <button
              onClick={() => {
                setAvatarPreviewOpen(false);
                setTimeout(() => avatarInputRef.current?.click(), 200);
              }}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-white hover:bg-black/80 transition-colors text-xs"
            >
              <Camera className="h-3.5 w-3.5" />
              تغيير الصورة
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
