'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Settings, User, Mail, Trash2, Loader2, AlertTriangle, Camera, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/lib/types';
import { useTranslations } from '@/i18n/use-translations';
import { getRoleLabel } from '@/components/shared/user-avatar';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: UserProfile;
  onUpdateProfile: (updates: Partial<UserProfile>) => Promise<{ error: string | null }>;
  onDeleteAccount: () => Promise<void>;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const sectionVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3, ease: 'easeOut' as const },
  }),
};

// -------------------------------------------------------
// Component
// -------------------------------------------------------
export default function SettingsModal({
  open,
  onOpenChange,
  profile,
  onUpdateProfile,
  onDeleteAccount,
}: SettingsModalProps) {
  const { t, direction } = useTranslations('settings');
  const { t: ta } = useTranslations('auth');
  const { t: tc } = useTranslations('common');
  const [name, setName] = useState(profile.name);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Avatar upload state
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Keep local name in sync when the profile prop updates
  useEffect(() => {
    setName(profile.name);
  }, [profile.name]);

  const roleLabel = getRoleLabel(profile.role, profile.gender, profile.title_id, t);

  // ─── Handlers ─────────────────────────────────────────
  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('nameRequired'));
      return;
    }

    setIsUpdating(true);
    try {
      const result = await onUpdateProfile({ name: trimmed });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(t('profileUpdated'));
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setIsUpdating(false);
    }
  };

  // ─── Avatar Upload Handler ────────────────────────────
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error(t('imageFileOnly'));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('imageSizeLimit'));
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', profile.id);

      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || t('avatarUploadError'));
        return;
      }

      // Update user profile with new avatar_url
      const avatarUrl = data.data?.file_url || '';
      const result = await onUpdateProfile({ avatar_url: avatarUrl });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(t('avatarUpdated'));
      }
    } catch {
      toast.error(t('avatarUploadError'));
    } finally {
      setIsUploadingAvatar(false);
      // Reset file input
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  };

  // ─── Password Change Handler ──────────────────────────
  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error(ta('pleaseEnterPassword'));
      return;
    }
    if (!newPassword) {
      toast.error(t('pleaseEnterNewPassword'));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(ta('passwordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordsDontMatch'));
      return;
    }
    if (currentPassword === newPassword) {
      toast.error(ta('passwordDifferent'));
      return;
    }

    setIsChangingPassword(true);
    try {
      // ── Use server-side API for reliable password change ──
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
        console.error('[SettingsModal] Password change failed:', data.error, 'Status:', res.status);
        toast.error(data.error || t('passwordChangeFailed'));
        return;
      }

      toast.success(t('passwordChangedSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('[SettingsModal] Password change unexpected error:', err);
      if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
        toast.error(tc('connectionError'));
      } else {
        toast.error(`${tc('unexpectedError')}: ${err?.message || ''}`);
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await onDeleteAccount();
      toast.success(t('accountDeleted'));
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch {
      toast.error(t('accountDeleteError'));
    } finally {
      setIsDeleting(false);
    }
  };

  // Get initials for avatar fallback
  const initials = profile.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);

  // ─── Render ───────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" dir={direction}>
        <DialogHeader className="text-end">
          <DialogTitle className="flex items-center gap-2 text-end">
            <Settings className="h-5 w-5 text-sky-700" />
            {tc('settings')}
          </DialogTitle>
          <DialogDescription className="text-end">
            {t('manageProfileAndSettings')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* ── Profile section ── */}
          <motion.div
            className="space-y-4"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-sky-700" />
              <h3 className="text-sm font-semibold text-foreground">{t('profile.title')}</h3>
            </div>

            {/* Avatar */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">{t('avatar')}</Label>
              <div className="flex items-center gap-4">
                <div className="relative">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.name}
                      className="h-16 w-16 rounded-full object-cover border-2 border-sky-200"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400 font-bold text-lg border-2 border-sky-200 dark:border-sky-900/60">
                      {initials || tc('appNameFallback')[0]}
                    </div>
                  )}
                  {isUploadingAvatar && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                    disabled={isUploadingAvatar}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={isUploadingAvatar}
                  >
                    <Camera className="h-4 w-4" />
                    {t('changeAvatar')}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">{t('avatarFileSizeHint')}</p>
                </div>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="settings-name" className="text-sm text-muted-foreground">
                {ta('name')}
              </Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={ta('enterName')}
                className="text-end"
                disabled={isUpdating}
              />
            </div>

            {/* Email (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="settings-email" className="text-sm text-muted-foreground">
                {ta('email')}
              </Label>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground select-all">{profile.email}</span>
              </div>
            </div>

            {/* Role badge */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">{t('role')}</Label>
              <div>
                <Badge className="bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400 border-sky-200 dark:border-sky-900/60">
                  {roleLabel}
                </Badge>
              </div>
            </div>
          </motion.div>

          <Separator />

          {/* ── Password change section ── */}
          <motion.div
            className="space-y-4"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={1}
          >
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-sky-700" />
              <h3 className="text-sm font-semibold text-foreground">{t('changePassword')}</h3>
            </div>

            {/* Current password */}
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-sm text-muted-foreground">
                {ta('currentPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={ta('enterPassword')}
                  className="text-start pe-10"
                  disabled={isChangingPassword}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-sm text-muted-foreground">
                {ta('newPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={ta('enterNewPassword')}
                  className="text-start pe-10"
                  disabled={isChangingPassword}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm new password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-sm text-muted-foreground">
                {t('confirmNewPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={ta('reenterPassword')}
                  className="text-start pe-10"
                  disabled={isChangingPassword}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              onClick={handleChangePassword}
              disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="bg-sky-700 hover:bg-sky-800 text-white gap-2"
            >
              {isChangingPassword ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('changing')}
                </span>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  {t('changePassword')}
                </>
              )}
            </Button>
          </motion.div>

          <Separator />

          {/* ── Danger zone ── */}
          <motion.div
            className="space-y-4"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={2}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <h3 className="text-sm font-semibold text-rose-600">{t('dangerZone')}</h3>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4">
              <p className="text-sm text-rose-700 mb-3">
                {t('deleteAccountWarning')}
              </p>

              <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    disabled={isDeleting}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('deleteAccount')}
                  </Button>
                </AlertDialogTrigger>

                <AlertDialogContent dir={direction}>
                  <AlertDialogHeader className="text-end">
                    <AlertDialogTitle className="text-end">
                      {t('confirmDeleteAccount')}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-end">
                      {t('confirmDeleteAccountDesc')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-row-reverse gap-2">
                    <AlertDialogCancel disabled={isDeleting}>{tc('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-rose-600 hover:bg-rose-700 text-white"
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('deleting')}
                        </span>
                      ) : (
                        t('deleteAccountPermanently')
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </motion.div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
          <Button
            onClick={handleSave}
            disabled={isUpdating || name === profile.name}
            className="bg-sky-700 hover:bg-sky-800 text-white gap-2"
          >
            {isUpdating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('saving')}
              </span>
            ) : (
              t('saveChanges')
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUpdating}
          >
            {tc('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
