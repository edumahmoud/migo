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

  const isFemale = profile.gender === 'female';
  const roleLabel = profile.role === 'student'
    ? (isFemale ? 'طالبة' : 'طالب')
    : profile.role === 'superadmin'
      ? (isFemale ? 'مديرة المنصة' : 'مدير المنصة')
      : profile.role === 'admin'
        ? (isFemale ? 'مشرفة' : 'مشرف')
        : (isFemale ? 'معلمة' : 'معلم');

  // ─── Handlers ─────────────────────────────────────────
  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('الاسم مطلوب');
      return;
    }

    setIsUpdating(true);
    try {
      const result = await onUpdateProfile({ name: trimmed });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('تم تحديث الملف الشخصي بنجاح');
      }
    } catch {
      toast.error('حدث خطأ أثناء التحديث');
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
      toast.error('يرجى اختيار ملف صورة فقط');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('حجم الصورة يجب أن يكون أقل من 5 ميجابايت');
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
        toast.error(data.error || 'حدث خطأ أثناء رفع الصورة');
        return;
      }

      // Update user profile with new avatar_url
      const avatarUrl = data.data?.file_url || '';
      const result = await onUpdateProfile({ avatar_url: avatarUrl });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('تم تحديث الصورة الشخصية بنجاح');
      }
    } catch {
      toast.error('حدث خطأ أثناء رفع الصورة');
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
      // ── Step 1: Reauthenticate with current password ──
      // Supabase requires a recent session to update the password.
      // We must verify the current password by signing in again.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: profile.email || '',
        password: currentPassword,
      });

      if (reauthError) {
        console.error('[SettingsModal] Reauthentication failed:', reauthError.message);
        toast.error('كلمة المرور الحالية غير صحيحة');
        setIsChangingPassword(false);
        return;
      }

      // ── Step 2: Update password (now the session is fresh) ──
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        console.error('[SettingsModal] Password update error:', error.message, 'Status:', error.status);
        const msg = error.message?.toLowerCase() || '';

        if (msg.includes('same') || msg.includes('different')) {
          toast.error('كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية');
        } else if (msg.includes('password') && (msg.includes('weak') || msg.includes('require') || msg.includes('strength') || msg.includes('policy'))) {
          toast.error('كلمة المرور لا تلبي متطلبات الأمان. تأكد من أن كلمة المرور تحتوي على أحرف كبيرة وصغيرة وأرقام');
        } else if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('429')) {
          toast.error('طلبات كثيرة جداً. يرجى الانتظار ثم المحاولة مرة أخرى');
        } else {
          toast.error(error.message || 'فشل في تغيير كلمة المرور');
        }
        return;
      }

      toast.success('تم تغيير كلمة المرور بنجاح');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('[SettingsModal] Password change error:', err);
      toast.error('حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await onDeleteAccount();
      toast.success('تم حذف الحساب بنجاح');
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch {
      toast.error('حدث خطأ أثناء حذف الحساب');
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
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-right">
            <Settings className="h-5 w-5 text-sky-700" />
            الإعدادات
          </DialogTitle>
          <DialogDescription className="text-right">
            إدارة الملف الشخصي وإعدادات الحساب
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
              <h3 className="text-sm font-semibold text-foreground">الملف الشخصي</h3>
            </div>

            {/* Avatar */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">الصورة الشخصية</Label>
              <div className="flex items-center gap-4">
                <div className="relative">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.name}
                      className="h-16 w-16 rounded-full object-cover border-2 border-sky-200"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-sky-800 font-bold text-lg border-2 border-sky-200">
                      {initials || 'م'}
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
                    تغيير الصورة
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">PNG, JPG حتى 5MB</p>
                </div>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="settings-name" className="text-sm text-muted-foreground">
                الاسم
              </Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="أدخل اسمك"
                className="text-right"
                disabled={isUpdating}
              />
            </div>

            {/* Email (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="settings-email" className="text-sm text-muted-foreground">
                البريد الإلكتروني
              </Label>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground select-all">{profile.email}</span>
              </div>
            </div>

            {/* Role badge */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">الدور</Label>
              <div>
                <Badge className="bg-sky-100 text-sky-800 border-sky-200">
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
              <h3 className="text-sm font-semibold text-foreground">تغيير كلمة المرور</h3>
            </div>

            {/* Current password */}
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-sm text-muted-foreground">
                كلمة المرور الحالية
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور الحالية"
                  className="text-left pr-10"
                  disabled={isChangingPassword}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-sm text-muted-foreground">
                كلمة المرور الجديدة
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور الجديدة"
                  className="text-left pr-10"
                  disabled={isChangingPassword}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm new password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-sm text-muted-foreground">
                تأكيد كلمة المرور الجديدة
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="أعد إدخال كلمة المرور الجديدة"
                  className="text-left pr-10"
                  disabled={isChangingPassword}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
                  جاري التغيير...
                </span>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  تغيير كلمة المرور
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
              <h3 className="text-sm font-semibold text-rose-600">منطقة الخطر</h3>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4">
              <p className="text-sm text-rose-700 mb-3">
                حذف الحساب سيؤدي إلى إزالة جميع بياناتك نهائياً. هذا الإجراء لا يمكن التراجع عنه.
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
                    حذف الحساب
                  </Button>
                </AlertDialogTrigger>

                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader className="text-right">
                    <AlertDialogTitle className="text-right">
                      تأكيد حذف الحساب
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-right">
                      هل أنت متأكد من حذف حسابك؟ سيتم حذف جميع بياناتك بشكل نهائي ولا يمكن استرجاعها.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-row-reverse gap-2">
                    <AlertDialogCancel disabled={isDeleting}>إلغاء</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-rose-600 hover:bg-rose-700 text-white"
                      disabled={isDeleting}
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
                جاري الحفظ...
              </span>
            ) : (
              'حفظ التغييرات'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUpdating}
          >
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
