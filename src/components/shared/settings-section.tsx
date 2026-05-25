'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Smartphone,
  Sun,
  Moon,
  Unlock,
  Globe,
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
import { getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import { useAuthStore } from '@/stores/auth-store';
import { useSharedSocket, useSocketEvent, setSocketAuth } from '@/lib/socket';
import { useStatusStore, getStatusColor } from '@/stores/status-store';
import type { UserProfile, UserStatus } from '@/lib/types';
import ThemeToggle from '@/components/shared/theme-toggle';
import { useTranslations } from '@/i18n/use-translations';
import { useLocaleStore } from '@/i18n/locale-store';

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
  { value: 'male', labelKey: 'settings.profile.genderMale' },
  { value: 'female', labelKey: 'settings.profile.genderFemale' },
] as const;

const ACADEMIC_TITLES = [
  { value: 'teacher', label: 'titles.teacher', femaleLabel: 'titles.teacherFemale' },
  { value: 'dr', label: 'titles.dr', femaleLabel: 'titles.drFemale' },
  { value: 'prof', label: 'titles.prof', femaleLabel: 'titles.profFemale' },
  { value: 'assoc_prof', label: 'titles.assocProf', femaleLabel: 'titles.assocProfFemale' },
  { value: 'assist_prof', label: 'titles.assistProf', femaleLabel: 'titles.assistProfFemale' },
  { value: 'lecturer', label: 'titles.lecturer', femaleLabel: 'titles.lecturerFemale' },
  { value: 'teaching_assist', label: 'titles.teachingAssist', femaleLabel: 'titles.teachingAssistFemale' },
] as const;

const STATUS_OPTIONS: {
  value: UserStatus;
  labelKey: string;
  color: string;       // Tailwind bg class for the dot
  textColor: string;   // Tailwind text class for label
  borderColor: string; // Tailwind border class when selected
  bgColor: string;     // Tailwind bg class when selected
  descriptionKey: string;
}[] = [
  {
    value: 'online',
    labelKey: 'settings.status.online',
    color: 'bg-sky-600',
    textColor: 'text-sky-800 dark:text-sky-200',
    borderColor: 'border-sky-600',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    descriptionKey: 'settings.status.onlineDesc',
  },
  {
    value: 'busy',
    labelKey: 'settings.status.busy',
    color: 'bg-amber-500',
    textColor: 'text-amber-700 dark:text-amber-300',
    borderColor: 'border-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    descriptionKey: 'settings.status.busyDesc',
  },
  {
    value: 'away',
    labelKey: 'settings.status.away',
    color: 'bg-orange-500',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-500',
    bgColor: 'bg-orange-50',
    descriptionKey: 'settings.status.awayDesc',
  },
  {
    value: 'invisible',
    labelKey: 'settings.status.invisible',
    color: 'bg-gray-400',
    textColor: 'text-gray-600 dark:text-gray-400',
    borderColor: 'border-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-800/50',
    descriptionKey: 'settings.status.invisibleDesc',
  },
  {
    value: 'offline',
    labelKey: 'settings.status.offline',
    color: 'bg-gray-400',
    textColor: 'text-gray-500 dark:text-gray-400',
    borderColor: 'border-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-800/50',
    descriptionKey: 'settings.status.offlineDesc',
  },
];

const STATUS_STORAGE_KEY = 'attenddo-user-status';


// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: 'easeOut' as const },
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
  const { t, isRTL, direction } = useTranslations();
  const { locale, setLocale } = useLocaleStore();
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
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  // ─── Screen orientation lock ───
  const [orientationLocked, setOrientationLocked] = useState(false);



  // ─── Status / Presence (now from global store) ───
  const userStatus = myStatus;

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

  // ─── Load orientation lock preference ───
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('attenddo-orientation-locked');
    if (stored === 'true') {
      setOrientationLocked(true);
    }
  }, []);



  // ─── Handle status change ───
  const handleStatusChange = useCallback((newStatus: UserStatus) => {
    // Update status store (handles localStorage + socket emission)
    setMyStatus(newStatus, profile.id);

    const statusLabel = t(STATUS_OPTIONS.find(s => s.value === newStatus)?.labelKey || '') || newStatus;
    toast.success(t('settings.status.changedToast', { status: statusLabel }));
  }, [profile.id, setMyStatus, t]);

  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

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
        const headers = await getCachedAuthHeaders();
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
      case 'student': return isFemale ? t('roles.studentFemale') : t('roles.student');
      case 'superadmin': return isFemale ? t('roles.superadminFemale') : t('roles.superadmin');
      case 'admin': return isFemale ? t('roles.adminFemale') : t('roles.admin');
      case 'teacher': {
        const effectiveTitleId = tid || 'teacher';
        const title = ACADEMIC_TITLES.find(at => at.value === effectiveTitleId);
        if (title) {
          return isFemale ? t(title.femaleLabel) : t(title.label);
        }
        return isFemale ? t('titles.teacherFemale') : t('titles.teacher');
      }
      default: return role;
    }
  };
  const roleLabel = getRoleLabel(profile.role, gender || profile.gender, titleId || profile.title_id);

  const roleBadgeClass = profile.role === 'superadmin'
    ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
    : profile.role === 'admin'
      ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800'
      : profile.role === 'teacher'
        ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800'
        : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';

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
        return { error: data.error || t('settings.errorUpdateFailed') };
      }

      // Refresh the auth store profile to keep UI in sync
      await refreshProfile();
      return { error: null };
    } catch {
      return { error: t('settings.errorUnexpected') };
    }
  };

  // ─── Save handler ───
  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('settings.errorNameRequired'));
      return;
    }

    // Validate username if changed
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const usernameChanged = cleanUsername !== (profile.username || '').toLowerCase();
    if (usernameChanged) {
      if (cleanUsername.length < 3) {
        toast.error(t('settings.errorUsernameMinLength'));
        return;
      }
      if (!usernameAvailable) {
        toast.error(t('settings.errorUsernameUnavailable'));
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
        toast.success(t('settings.successSaved'));
        setHasChanges(false);
      }
    } catch {
      toast.error(t('settings.errorSaving'));
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Avatar upload ───
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('settings.errorImageOnly'));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('settings.errorImageSize'));
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
        toast.error(data.error || t('settings.errorAvatarUpload'));
        return;
      }

      // Refresh profile to get the new avatar URL
      await refreshProfile();
      toast.success(t('settings.successAvatarUpdated'));
    } catch {
      toast.error(t('settings.errorAvatarUpload'));
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
      toast.error(t('settings.password.errorCurrentRequired'));
      return;
    }
    if (!newPassword) {
      toast.error(t('settings.password.errorNewRequired'));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(t('settings.password.errorNewMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.password.errorMismatch'));
      return;
    }
    if (currentPassword === newPassword) {
      toast.error(t('settings.password.errorSamePassword'));
      return;
    }

    setIsChangingPassword(true);
    try {
      // ── Use server-side API for reliable password change ──
      // The server endpoint uses the admin API (service_role key) which bypasses
      // the "session not fresh enough" requirement. This is much more reliable
      // than client-side signInWithPassword + updateUser.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        console.error('[Settings] Password change failed:', data.error, 'Status:', res.status);
        toast.error(data.error || t('settings.password.errorChangeFailed'));
        return;
      }

      toast.success(t('settings.password.successChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('[Settings] Password change unexpected error:', err);
      if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
        toast.error(t('common.errorNetwork'));
      } else {
        toast.error(`${t('settings.errorUnexpected')}: ${err?.message || ''}`);
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  // ─── Delete account ───
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== t('common.delete')) {
      toast.error(t('settings.errorDeleteConfirm'));
      return;
    }

    setIsDeleting(true);
    try {
      await onDeleteAccount();
      toast.success(t('settings.successAccountDeleted'));
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
    } catch {
      toast.error(t('settings.errorDeleteAccount'));
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── Current status info ───
  const currentStatusInfo = STATUS_OPTIONS.find(s => s.value === userStatus) || STATUS_OPTIONS[0];

  // ─── Toggle screen orientation lock ───
  const handleToggleOrientation = async () => {
    try {
      if (!orientationLocked) {
        // Lock to portrait
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
          try {
            // First attempt: try locking directly (works in some PWA standalone contexts)
            await screen.orientation.lock('portrait');
            setOrientationLocked(true);
            localStorage.setItem('attenddo-orientation-locked', 'true');
            toast.success(t('settings.orientation.locked'));
          } catch (lockError: unknown) {
            // The Screen Orientation API requires a fullscreen context in most browsers.
            // If direct lock fails, request fullscreen first then retry.
            const errMsg = lockError instanceof Error ? lockError.message : String(lockError);
            console.warn('[Orientation Lock] Direct lock failed, trying fullscreen:', errMsg);

            try {
              // Request fullscreen on the document element
              const docEl = document.documentElement;
              if (docEl.requestFullscreen) {
                await docEl.requestFullscreen();
              } else if ((docEl as any).webkitRequestFullscreen) {
                // Safari fallback
                await (docEl as any).webkitRequestFullscreen();
              }

              // Now try locking orientation again in fullscreen context
              await screen.orientation.lock('portrait');
              setOrientationLocked(true);
              localStorage.setItem('attenddo-orientation-locked', 'true');
              toast.success(t('settings.orientation.locked'));
            } catch (fullscreenError: unknown) {
              const fsErrMsg = fullscreenError instanceof Error ? fullscreenError.message : String(fullscreenError);
              console.warn('[Orientation Lock] Fullscreen + lock failed:', fsErrMsg);
              toast.error(t('settings.orientation.lockFailed'));
            }
          }
        } else {
          toast.error(t('settings.orientation.notSupported'));
        }
      } else {
        // Unlock
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
          screen.orientation.unlock();
        }
        // Exit fullscreen if we entered it for orientation lock
        if (document.fullscreenElement) {
          try {
            await document.exitFullscreen();
          } catch {
            // Ignore fullscreen exit errors
          }
        }
        setOrientationLocked(false);
        localStorage.removeItem('attenddo-orientation-locked');
        toast.success(t('settings.orientation.unlocked'));
      }
    } catch {
      toast.error(t('settings.orientation.toggleFailed'));
    }
  };

  // ─── Sync orientation lock state when fullscreen changes (e.g. user presses Escape) ───
  useEffect(() => {
    const handleFullscreenChange = () => {
      // If we were locked but user exited fullscreen (Esc key), sync state
      if (!document.fullscreenElement && orientationLocked) {
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
          screen.orientation.unlock();
        }
        setOrientationLocked(false);
        localStorage.removeItem('attenddo-orientation-locked');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [orientationLocked]);

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
        toast.success(t('settings.push.disabled'));
      } else {
        // Enable push — request permission first
        if (!('Notification' in window)) {
          toast.error(t('settings.push.notSupported'));
          return;
        }

        const result = await Notification.requestPermission();
        setPushPermission(result);
        if (result !== 'granted') {
          toast.error(t('settings.push.denied'));
          return;
        }

        toast.success(t('settings.push.enabled'));

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
            toast.success(t('settings.push.pushEnabled'));
          } catch (pushError) {
            // Push subscription failed (common in iframe/sandbox)
            console.warn('[Push] Web Push subscription failed:', pushError);
            toast.info(t('settings.push.pwaOnly'));
          }
        } else {
          // SW not available or timed out
          toast.info(t('settings.push.pwaOnly'));
        }
      }
    } catch (error) {
      console.error('Push toggle error:', error);
      toast.error(t('settings.push.toggleFailed'));
    } finally {
      setIsTogglingPush(false);
    }
  };

  // ─── Test push notification ───
  const handleTestNotification = async () => {
    try {
      if (pushPermission !== 'granted') {
        toast.error(t('settings.push.enableFirst'));
        return;
      }

      // Try to send a test push notification via the server
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profile.id,
          title: t('settings.push.testTitle'),
          message: t('settings.push.testBody'),
          type: 'system',
        }),
      });

      const data = await res.json();
      if (data.sent > 0) {
        toast.success(t('settings.push.testSent'));
      } else {
        // Fallback: show an in-app notification instead
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(t('settings.push.testTitle'), {
            body: t('settings.push.testLocalBody'),
            icon: '/icons/icon-192x192.png',
            dir,
          });
          toast.info(t('settings.push.testLocal'));
        } else {
          toast.info(t('settings.push.noSubscription'));
        }
      }
    } catch {
      toast.error(t('settings.push.testFailed'));
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
        <h2 className="text-xl sm:text-2xl font-bold text-foreground">{t('settings.title')}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t('settings.subtitle')}</p>
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
              <User className="h-4 w-4 text-sky-700 dark:text-sky-300" />
              <h3 className="font-semibold text-foreground text-sm">{t('settings.profile.title')}</h3>
            </div>

            <div className="p-4 space-y-4">
              {/* Avatar + Name row */}
              <div className="flex items-start gap-4">
                <div className="relative shrink-0 group">
                  <Avatar
                    className="h-20 w-20 border-2 border-sky-200 dark:border-sky-800 shadow-sm cursor-pointer"
                    onClick={() => profile.avatar_url && setAvatarPreviewOpen(true)}
                  >
                    <AvatarImage src={avatarSrc} alt={profile.name} className="object-cover" />
                    <AvatarFallback className="bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200">
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
                        {t('settings.profile.nameLabel')}
                      </Label>
                      <Input
                        id="settings-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('settings.profile.namePlaceholder')}
                        className="h-9 text-sm"
                        disabled={isSaving}
                      />
                    </div>
                    <div>
                      <Label htmlFor="settings-username" className="text-xs text-muted-foreground">
                        {t('settings.profile.usernameLabel')}
                      </Label>
                      <div className="relative">
                        <div className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">@</div>
                        <Input
                          id="settings-username"
                          value={username}
                          onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                          placeholder="username"
                          className="text-start ps-9 pe-8 h-9 text-sm"
                          disabled={isSaving}
                          dir="ltr"
                        />
                        <div className="absolute start-2.5 top-1/2 -translate-y-1/2">
                          {isCheckingUsername && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                          {!isCheckingUsername && usernameAvailable === true && username.trim().length >= 3 && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                          )}
                          {!isCheckingUsername && usernameAvailable === false && (
                            <X className="h-3.5 w-3.5 text-rose-500" />
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{t('settings.profile.usernameHint')}</p>
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
                      {profile.avatar_url ? t('settings.profile.changePhoto') : t('settings.profile.addPhoto')}
                    </Button>
                    <span className="text-[10px] text-muted-foreground">{t('settings.profile.photoSizeHint')}</span>
                  </div>
                </div>
              </div>

              {/* Gender + Role row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Gender */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('settings.profile.genderLabel')}</Label>
                  <div className="flex gap-1.5">
                    {GENDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setGender(gender === opt.value ? '' : opt.value)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          gender === opt.value
                            ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                        disabled={isSaving}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                    {gender && (
                      <button
                        onClick={() => setGender('')}
                        className="rounded-lg border border-border px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted/50 transition-colors"
                        disabled={isSaving}
                      >
                        {t('settings.profile.genderRemove')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Role (display only) - for teachers shows academic title */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('settings.profile.roleLabel')}</Label>
                  <div>
                    <Badge className={`${roleBadgeClass} border text-xs`}>
                      {roleLabel}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Email (read-only) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('settings.profile.emailLabel')}</Label>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground select-all truncate">{profile.email}</span>
                  <Badge variant="outline" className="ms-auto text-[9px] px-1.5 py-0 shrink-0">{t('settings.profile.emailReadonly')}</Badge>
                </div>
              </div>

              {/* Academic title (teacher only - always shown, includes معلم/معلمة as default) */}
              {profile.role === 'teacher' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    {t('settings.profile.academicTitleLabel')}
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {ACADEMIC_TITLES.map((title) => {
                      const displayLabel = (gender || profile.gender) === 'female' ? t(title.femaleLabel) : t(title.label);
                      return (
                        <button
                          key={title.value}
                          onClick={() => setTitleId(title.value)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                            titleId === title.value
                              ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
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
                    <span className="text-[10px] text-muted-foreground">{t('settings.profile.willAppearAs')}</span>
                    <span className="text-xs font-semibold text-sky-800 dark:text-sky-200">
                      {(() => {
                        const titleObj = ACADEMIC_TITLES.find((at) => at.value === titleId);
                        if (!titleObj) return '';
                        return ((gender || profile.gender) === 'female' ? t(titleObj.femaleLabel) : t(titleObj.label));
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
                  className="bg-sky-700 hover:bg-sky-800 text-white gap-1.5 h-9 min-w-[120px]"
                >
                  {isSaving ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('settings.saving')}
                    </span>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      {t('settings.saveSettings')}
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
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-sky-100 dark:bg-sky-900/50">
                <div className={`h-2.5 w-2.5 rounded-full ${currentStatusInfo.color} ${userStatus === 'online' && isConnected ? 'animate-pulse' : ''}`} />
              </div>
              <h3 className="font-semibold text-foreground text-sm">{t('settings.status.presenceTitle')}</h3>
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
                    <p className="text-sm font-semibold text-foreground">{t(currentStatusInfo.labelKey)}</p>
                    {/* Connection indicator - shows actual socket status */}
                    <div className="flex items-center gap-1" title={
                      isConnected ? t('settings.status.connectedToServer') 
                        : socketStatus === 'connecting' ? t('settings.status.connectingToServer') 
                        : t('settings.status.disconnectedFromServer')
                    }>
                      <div className={`h-1.5 w-1.5 rounded-full ${
                        isConnected ? 'bg-sky-600' 
                          : socketStatus === 'connecting' ? 'bg-amber-400 animate-pulse' 
                          : 'bg-red-400'
                      }`} />
                      <span className={`text-[10px] ${
                        isConnected ? 'text-sky-700 dark:text-sky-300' 
                          : socketStatus === 'connecting' ? 'text-amber-600 dark:text-amber-400' 
                          : 'text-red-500'
                      }`}>
                        {isConnected ? t('settings.status.connectedShort') 
                          : socketStatus === 'connecting' ? t('settings.status.connectingShort') 
                          : t('settings.status.disconnectedShort')}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {userStatus === 'invisible'
                      ? t('settings.status.invisibleHidden')
                      : userStatus === 'online'
                        ? t('settings.status.onlineAvailable')
                        : userStatus === 'busy'
                          ? t('settings.status.busyUnavailable')
                          : userStatus === 'away'
                            ? t('settings.status.awayFromDevice')
                            : t('settings.status.offlineHidden')}
                  </p>
                </div>
              </div>

              {/* Status options */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('settings.status.changeYourStatus')}</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {STATUS_OPTIONS.map((option) => {
                    const isSelected = userStatus === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => handleStatusChange(option.value)}
                        className={`relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-all duration-200 text-end cursor-pointer ${
                          isSelected
                            ? `${option.borderColor} ${option.bgColor} shadow-sm`
                            : 'border-border hover:bg-muted/50 hover:border-muted-foreground/20'
                        }`}
                      >
                        <div className={`h-3 w-3 rounded-full shrink-0 ${option.color}`} />
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-medium ${isSelected ? option.textColor : 'text-foreground'}`}>
                            {t(option.labelKey)}
                          </span>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                            {option.value === 'online' ? t('settings.status.onlineDetail') :
                             option.value === 'busy' ? t('settings.status.busyDetail') :
                             option.value === 'away' ? t('settings.status.awayDetail') :
                             option.value === 'invisible' ? t('settings.status.invisibleDetail') :
                             t('settings.status.offlineDetail')}
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
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 p-2.5 flex items-start gap-2">
                  <WifiOff className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-gray-600 dark:text-gray-400">
                    {t('settings.status.invisibleNote')}
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
              <Smartphone className="h-4 w-4 text-sky-700 dark:text-sky-300" />
              <h3 className="font-semibold text-foreground text-sm">{t('settings.appSettingsTitle')}</h3>
            </div>

            <div className="p-4 space-y-4">
              {/* Push Notifications Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    pushPermission === 'granted'
                      ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300'
                      : pushPermission === 'denied'
                        ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400'
                        : 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400'
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
                    <p className="text-sm font-medium text-foreground">{t('settings.push.pushTitle')}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {pushPermission === 'granted'
                        ? t('settings.push.enabledDesc')
                        : pushPermission === 'denied'
                          ? t('settings.push.deniedDesc')
                          : t('settings.push.defaultDesc')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleTogglePush}
                  disabled={isTogglingPush || pushPermission === 'denied'}
                  className={`relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200 ${
                    pushPermission === 'granted'
                      ? 'bg-sky-600'
                      : pushPermission === 'denied'
                        ? 'bg-rose-300 cursor-not-allowed'
                        : 'bg-muted-foreground/30'
                  }`}
                  aria-label={pushPermission === 'granted' ? t('settings.push.disableAria') : t('settings.push.enableAria')}
                >
                  <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                    pushPermission === 'granted' ? 'end-0.5' : 'start-0.5'
                  }`}>
                    {isTogglingPush && (
                      <div className="flex h-full w-full items-center justify-center">
                        <Loader2 className="h-3 w-3 animate-spin text-sky-700 dark:text-sky-300" />
                      </div>
                    )}
                  </div>
                </button>
              </div>

              {/* Test notification button (visible when granted) */}
              {pushPermission === 'granted' && (
                <button
                  onClick={handleTestNotification}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 px-3 py-2 text-xs font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-100/60 active:bg-sky-100 transition-colors"
                >
                  <BellRing className="h-3.5 w-3.5" />
                  {t('settings.push.testButton')}
                </button>
              )}

              {/* Divider */}
              <div className="border-t" />

              {/* Screen Orientation Lock Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    orientationLocked
                      ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300'
                      : 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400'
                  }`}>
                    {orientationLocked ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <Unlock className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {orientationLocked ? t('settings.orientation.unlockLabel') : t('settings.orientation.lockLabel')}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {orientationLocked
                        ? t('settings.orientation.lockedDesc')
                        : t('settings.orientation.unlockedDesc')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleToggleOrientation}
                  className={`relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200 ${
                    orientationLocked ? 'bg-sky-600' : 'bg-muted-foreground/30'
                  }`}
                  aria-label={orientationLocked ? t('settings.orientation.unlockAria') : t('settings.orientation.lockAria')}
                >
                  <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                    orientationLocked ? 'end-0.5' : 'start-0.5'
                  }`} />
                </button>
              </div>

              {/* Divider */}
              <div className="border-t" />

              {/* Theme Toggle (Appearance) */}
              <ThemeToggle />

              {/* Divider */}
              <div className="border-t" />

              {/* Language Switcher */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
                    <Globe className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t('settings.language')}</p>
                    <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'العربية' : 'English'}</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setLocale('ar')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      locale === 'ar'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    العربية
                  </button>
                  <button
                    onClick={() => setLocale('en')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      locale === 'en'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
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
              <Lock className="h-4 w-4 text-sky-700 dark:text-sky-300" />
              <h3 className="font-semibold text-foreground text-sm">{t('settings.password.title')}</h3>
            </div>

            <div className="p-4 space-y-3">
              {/* Current password */}
              <div className="space-y-1">
                <Label htmlFor="current-password" className="text-xs text-muted-foreground">
                  {t('settings.password.currentLabel')}
                </Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={t('settings.password.currentPlaceholder')}
                    className="text-start pe-10 h-9 text-sm"
                    disabled={isChangingPassword}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div className="space-y-1">
                <Label htmlFor="new-password" className="text-xs text-muted-foreground">
                  {t('settings.password.newLabel')}
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('settings.password.newPlaceholder')}
                    className="text-start pe-10 h-9 text-sm"
                    disabled={isChangingPassword}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Confirm new password */}
              <div className="space-y-1">
                <Label htmlFor="confirm-password" className="text-xs text-muted-foreground">
                  {t('settings.password.confirmLabel')}
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('settings.password.confirmPlaceholder')}
                    className="text-start pe-10 h-9 text-sm"
                    disabled={isChangingPassword}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
                className="bg-sky-700 hover:bg-sky-800 text-white gap-1.5 h-9 text-xs"
              >
                {isChangingPassword ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('settings.password.changing')}
                  </span>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t('settings.password.submit')}
                  </>
                )}
              </Button>
            </div>
          </motion.div>

          {/* Danger Zone Card - hidden for superadmin */}
          {profile.role !== 'superadmin' && (
          <motion.div
            className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/30 shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={3}
          >
            <div className="flex items-center gap-2 border-b border-rose-200 dark:border-rose-800 px-4 py-2.5 bg-rose-50/50 dark:bg-rose-950/30">
              <Shield className="h-4 w-4 text-rose-500" />
              <h3 className="font-semibold text-rose-700 dark:text-rose-300 text-sm">{t('settings.danger.title')}</h3>
            </div>

            <div className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t('settings.danger.deleteButton')}
                  </h4>
                  <p className="text-[11px] text-rose-600/80 dark:text-rose-400 mt-0.5">
                    {t('settings.danger.deleteDesc')}
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
                  {t('settings.danger.deleteButton')}
                </Button>
              </div>

              {/* Delete confirmation dialog */}
              <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => {
                setDeleteConfirmOpen(open);
                if (!open) setDeleteConfirmText('');
              }}>
                <AlertDialogContent dir={direction}>
                  <AlertDialogHeader className="text-end">
                    <AlertDialogTitle className="text-end flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-rose-500" />
                      {t('settings.danger.confirmTitle')}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-end">
                      {t('settings.danger.confirmDesc')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <div className="space-y-3 py-2">
                    <p className="text-sm text-muted-foreground">
                      {t('settings.profile.deleteTypeHint')} <span className="font-bold text-rose-600 dark:text-rose-400">{t('common.delete')}</span>:
                    </p>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={t('settings.profile.deletePlaceholder')}
                      className="text-end"
                      dir={direction}
                    />
                  </div>

                  <AlertDialogFooter className="flex-row-reverse gap-2">
                    <AlertDialogCancel disabled={isDeleting}>{t('settings.danger.confirmCancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-rose-600 hover:bg-rose-700 text-white"
                      disabled={isDeleting || deleteConfirmText !== t('common.delete')}
                    >
                      {isDeleting ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('settings.danger.deleting')}
                        </span>
                      ) : (
                        t('settings.danger.confirmDelete')
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
          <DialogTitle className="sr-only">{t('settings.profile.avatarPreviewTitle')}</DialogTitle>
          <div className="relative flex items-center justify-center min-h-[300px]">
            <img
              src={profile.avatar_url || ''}
              alt={profile.name}
              className="max-h-[70vh] max-w-full object-contain"
            />
            {/* Close button */}
            <button
              onClick={() => setAvatarPreviewOpen(false)}
              className="absolute top-3 start-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            {/* Download button */}
            <a
              href={profile.avatar_url || ''}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-3 start-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <Download className="h-4 w-4" />
            </a>
            {/* Change avatar button */}
            <button
              onClick={() => {
                setAvatarPreviewOpen(false);
                setTimeout(() => avatarInputRef.current?.click(), 200);
              }}
              className="absolute bottom-3 end-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-white hover:bg-black/80 transition-colors text-xs"
            >
              <Camera className="h-3.5 w-3.5" />
              {t('settings.profile.changePhoto')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
