'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  FileText,
  Download,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Loader2,
  MessageSquare,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  File,
  Inbox,
  FolderOpen,
  CalendarDays,
  ZoomIn,
  X,
  Mail,
  Shield,
  Activity,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import UserAvatar, { getRoleLabel, getTitleLabel } from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore, getStatusColor as getStoreStatusColor, getStatusLabel as getStoreStatusLabel, getStatusTextColor as getStoreStatusTextColor, getStatusBorderColor as getStoreStatusBorderColor } from '@/stores/status-store';
import { toast } from 'sonner';
import type { UserProfile, UserFile, FileRequest, UserStatus } from '@/lib/types';
import { supabase } from '@/lib/supabase';

// ─── Props ───────────────────────────────────────────────
interface UserProfilePageProps {
  userId: string;
  currentUser: UserProfile;
  onBack: () => void;
}

// ─── Types ───────────────────────────────────────────────
interface ProfileData {
  id: string;
  name: string;
  username?: string;
  role: string;
  avatar_url?: string | null;
  title_id?: string | null;
  gender?: string | null;
  created_at: string;
}

interface PublicFile extends UserFile {
  requestStatus?: 'pending' | 'approved' | 'rejected' | null;
  requestId?: string;
}

interface FileRequestWithInfo extends FileRequest {
  requester_name?: string;
  requester_avatar?: string | null;
  file_name?: string;
  file_type?: string;
  file_size?: number;
}

// ─── Animation variants ─────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

const cardHover = {
  rest: { scale: 1 },
  hover: { scale: 1.012, transition: { duration: 0.2 } },
};

// ─── Helpers ─────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getFileIcon(fileType: string) {
  const lower = fileType.toLowerCase();
  if (
    lower.includes('pdf') ||
    lower.includes('word') ||
    lower.includes('document') ||
    lower.includes('doc') ||
    lower.includes('text') ||
    lower.includes('spreadsheet') ||
    lower.includes('presentation')
  ) {
    return <FileText className="h-5 w-5 text-rose-500" />;
  }
  if (
    lower.includes('image') ||
    lower.includes('png') ||
    lower.includes('jpg') ||
    lower.includes('jpeg') ||
    lower.includes('gif') ||
    lower.includes('svg') ||
    lower.includes('webp')
  ) {
    return <ImageIcon className="h-5 w-5 text-emerald-500" />;
  }
  if (lower.includes('video') || lower.includes('mp4') || lower.includes('avi') || lower.includes('mov')) {
    return <FileVideo className="h-5 w-5 text-purple-500" />;
  }
  if (lower.includes('audio') || lower.includes('mp3') || lower.includes('wav') || lower.includes('ogg')) {
    return <FileAudio className="h-5 w-5 text-amber-500" />;
  }
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function getRoleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (role) {
    case 'superadmin':
    case 'admin':
      return 'destructive';
    case 'teacher':
      return 'default';
    case 'student':
      return 'secondary';
    default:
      return 'outline';
  }
}

function getStatusColor(status: UserStatus) {
  return getStoreStatusColor(status);
}

function getStatusLabel(status: UserStatus) {
  return getStoreStatusLabel(status);
}

function getStatusTextColor(status: UserStatus) {
  return getStoreStatusTextColor(status);
}

function getStatusBorderColor(status: UserStatus) {
  return getStoreStatusBorderColor(status);
}

// ─── Component ───────────────────────────────────────────
export default function UserProfilePage({ userId, currentUser, onBack }: UserProfilePageProps) {
  // ─── State ───────────────────────────────────────────
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [publicFiles, setPublicFiles] = useState<PublicFile[]>([]);
  const [fileRequests, setFileRequests] = useState<FileRequestWithInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(false);

  // Request dialog state
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestingFileId, setRequestingFileId] = useState<string | null>(null);
  const [requestDescription, setRequestDescription] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);

  // Approve/reject loading
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);

  // Photo enlargement state
  const [photoEnlarged, setPhotoEnlarged] = useState(false);

  // User status from global store
  const { getUserStatus, init: initStatusStore, fetchUserStatuses } = useStatusStore();
  const profileUserStatus = getUserStatus(userId);

  const { openProfile } = useAppStore();

  // ─── Auth headers ─────────────────────────────────────
  const getAuthHeaders = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // ─── Fetch profile data ───────────────────────────────
  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/profile/${userId}`, { headers });
      if (!res.ok) {
        toast.error('حدث خطأ أثناء تحميل الملف الشخصي');
        return;
      }
      const data = await res.json();
      setProfile(data.profile);

      // Use server-side file request statuses (bypasses RLS)
      const fileRequestStatuses: Record<string, { status: string; requestId: string }> = data.fileRequestStatuses || {};

      const files: PublicFile[] = (data.publicFiles || []).map((f: UserFile) => {
        const reqStatus = fileRequestStatuses[f.id];
        return {
          ...f,
          requestStatus: reqStatus ? (reqStatus.status as 'pending' | 'approved' | 'rejected') : null,
          requestId: reqStatus?.requestId,
        };
      });

      setPublicFiles(files);
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [userId, currentUser.id]);

  // ─── Fetch file requests (own profile only) ──────────
  const fetchFileRequests = useCallback(async () => {
    if (userId !== currentUser.id) return;
    setLoadingRequests(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/file-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'list' }),
      });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      setFileRequests(data.requests || []);
    } catch {
      // Silent fail for requests
    } finally {
      setLoadingRequests(false);
    }
  }, [userId, currentUser.id]);

  // ─── Initialize status store & fetch user status ───
  useEffect(() => {
    initStatusStore();
  }, [initStatusStore]);

  useEffect(() => {
    if (userId) {
      fetchUserStatuses([userId]);
    }
  }, [userId, fetchUserStatuses]);

  // ─── Initial load ─────────────────────────────────────
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (userId === currentUser.id) {
      fetchFileRequests();
    }
  }, [userId, currentUser.id, fetchFileRequests]);

  // ─── Send file request ────────────────────────────────
  const handleSendRequest = async () => {
    if (!requestingFileId) return;
    setSendingRequest(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/file-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'create',
          fileId: requestingFileId,
          ownerId: userId,
          description: requestDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('تم إرسال طلب الملف بنجاح');
        setPublicFiles((prev) =>
          prev.map((f) =>
            f.id === requestingFileId
              ? { ...f, requestStatus: 'pending' }
              : f
          )
        );
        setRequestDialogOpen(false);
        setRequestDescription('');
        setRequestingFileId(null);
      } else {
        toast.error(data.error || 'حدث خطأ أثناء إرسال الطلب');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSendingRequest(false);
    }
  };

  // ─── Approve / reject file request ───────────────────
  const handleRequestAction = async (requestId: string, action: 'approve' | 'reject') => {
    setProcessingRequestId(requestId);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/file-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, requestId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(action === 'approve' ? 'تمت الموافقة على الطلب' : 'تم رفض الطلب');
        setFileRequests((prev) => prev.filter((r) => r.id !== requestId));
      } else {
        toast.error(data.error || 'حدث خطأ أثناء المعالجة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setProcessingRequestId(null);
    }
  };

  // ─── Is own profile ──────────────────────────────────
  const isOwnProfile = userId === currentUser.id;

  // ─── Role & title labels ──────────────────────────────
  const roleLabel = profile ? getRoleLabel(profile.role, profile.gender, profile.title_id) : '';
  const titleLabel = profile?.role === 'teacher' ? getTitleLabel(profile.title_id, profile.gender) : null;

  // ─── Loading state ────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-10 w-10 text-emerald-500 animate-spin" />
        <p className="text-muted-foreground text-sm">جارٍ تحميل الملف الشخصي...</p>
      </div>
    );
  }

  // ─── Not found state ──────────────────────────────────
  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <User className="h-16 w-16 text-muted-foreground/40" />
        <p className="text-muted-foreground text-lg">المستخدم غير موجود</p>
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowRight className="h-4 w-4" />
          العودة
        </Button>
      </div>
    );
  }

  return (
    <div dir="rtl" className="relative max-w-5xl mx-auto pb-8 px-2 sm:px-0">
      {/* ─── Cover Banner ─────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative"
      >
        {/* Back button - positioned over the banner */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="absolute top-4 right-4 gap-2 text-white/90 hover:text-white hover:bg-white/20 bg-black/20 backdrop-blur-sm"
        >
          <ArrowRight className="h-4 w-4" />
          العودة
        </Button>

        {/* Banner gradient */}
        <div className="h-40 sm:h-52 rounded-b-2xl bg-gradient-to-bl from-emerald-600 via-teal-500 to-emerald-700 relative overflow-hidden">
          {/* Decorative patterns */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-48 h-48 bg-white rounded-full translate-x-1/4 translate-y-1/4" />
            <div className="absolute top-1/2 left-1/2 w-32 h-32 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
          </div>
          {/* Subtle grid pattern */}
          <div className="absolute inset-0 opacity-5" style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '24px 24px'
          }} />
        </div>

        {/* Avatar - overlapping the banner */}
        <div className="absolute -bottom-20 right-6 sm:right-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="relative cursor-pointer group"
            onClick={() => profile.avatar_url && setPhotoEnlarged(true)}
          >
            <div className="rounded-full p-1 bg-white dark:bg-gray-900 shadow-xl">
              <UserAvatar
                name={profile.name}
                avatarUrl={profile.avatar_url}
                size="2xl"
                className="ring-4 ring-emerald-400/30"
              />
            </div>
            {/* Zoom overlay */}
            {profile.avatar_url && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 group-hover:bg-black/30 transition-all duration-200 p-1">
                <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              </div>
            )}
            {/* Status indicator */}
            <span className={`absolute bottom-2 left-2 h-5 w-5 rounded-full ring-3 ring-white dark:ring-gray-900 ${
              getStatusColor(profileUserStatus)
            } ${profileUserStatus === 'online' ? 'animate-pulse' : ''}`} />
          </motion.div>
        </div>
      </motion.div>

      {/* ─── Profile Info Section ──────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="mt-24 sm:mt-24 px-6 sm:px-10"
      >
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          {/* Name & identity */}
          <div className="flex-1 min-w-0">
            {/* Name with title */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {titleLabel && (
                <span className="text-emerald-600 dark:text-emerald-400 text-sm font-semibold bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md">
                  {titleLabel}
                </span>
              )}
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                {profile.name}
              </h1>
            </div>

            {/* Username */}
            {profile.username && (
              <p className="text-muted-foreground text-sm mb-2 flex items-center gap-1.5">
                <span dir="ltr">@{profile.username}</span>
              </p>
            )}

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={getRoleBadgeVariant(profile.role)}
                className="text-xs font-medium gap-1"
              >
                <Shield className="h-3 w-3" />
                {roleLabel}
              </Badge>
              {profileUserStatus && profileUserStatus !== 'invisible' && (
                <Badge
                  variant="outline"
                  className={`text-[11px] font-medium gap-1.5 ${getStatusBorderColor(profileUserStatus)} ${getStatusTextColor(profileUserStatus)}`}
                >
                  <span className={`h-2 w-2 rounded-full ${getStatusColor(profileUserStatus)} ${profileUserStatus === 'online' ? 'animate-pulse' : ''}`} />
                  {getStatusLabel(profileUserStatus)}
                </Badge>
              )}
            </div>
          </div>

          {/* Quick info cards */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground shrink-0">
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-3 py-1.5">
              <CalendarDays className="h-4 w-4 text-emerald-500" />
              <span className="text-xs">انضم {formatDate(profile.created_at)}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-3 py-1.5">
              <FolderOpen className="h-4 w-4 text-emerald-500" />
              <span className="text-xs">{publicFiles.length} ملف</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── Separator ─────────────────────────────────── */}
      <div className="px-6 sm:px-10 mt-5">
        <Separator />
      </div>

      {/* ─── Content Tabs ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
        className="px-6 sm:px-10 mt-5"
      >
        <Tabs defaultValue="files" dir="rtl" className="w-full">
          <TabsList className="mb-5 bg-muted/60">
            <TabsTrigger value="files" className="gap-1.5 text-xs sm:text-sm">
              <FolderOpen className="h-4 w-4" />
              {isOwnProfile ? 'ملفاتي العامة' : 'الملفات العامة'}
            </TabsTrigger>
            {isOwnProfile && (
              <TabsTrigger value="requests" className="gap-1.5 text-xs sm:text-sm">
                <Download className="h-4 w-4" />
                طلبات الملفات
                {fileRequests.length > 0 && (
                  <Badge className="h-5 min-w-5 px-1.5 text-[10px] bg-emerald-600 text-white border-0">
                    {fileRequests.length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ─── Public Files Tab ──────────────────────── */}
          <TabsContent value="files">
            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {publicFiles.length === 0 ? (
                <motion.div variants={itemVariants}>
                  <Card className="border-dashed border-2 bg-muted/20">
                    <CardContent className="py-16 flex flex-col items-center gap-4">
                      <div className="h-16 w-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <Inbox className="h-8 w-8 text-emerald-500" />
                      </div>
                      <div className="text-center">
                        <p className="text-muted-foreground text-sm font-medium">لا توجد ملفات عامة</p>
                        <p className="text-muted-foreground/60 text-xs mt-1">
                          {isOwnProfile
                            ? 'لم تقم برفع أي ملفات عامة بعد'
                            : 'لم يقم هذا المستخدم برفع ملفات عامة بعد'}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {publicFiles.map((file) => (
                    <motion.div key={file.id} variants={itemVariants}>
                      <motion.div
                        variants={cardHover}
                        initial="rest"
                        whileHover="hover"
                      >
                        <Card className="h-full border shadow-sm hover:shadow-md transition-all duration-200 bg-card group">
                          <CardContent className="p-4 flex flex-col gap-3">
                            {/* File info row */}
                            <div className="flex items-start gap-3">
                              <div className="shrink-0 h-11 w-11 rounded-xl bg-muted/60 flex items-center justify-center group-hover:bg-muted/80 transition-colors">
                                {getFileIcon(file.file_type)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate" title={file.file_name}>
                                  {file.file_name}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[11px] text-muted-foreground font-medium uppercase">
                                    {file.file_type.split('/').pop()?.substring(0, 8) || 'ملف'}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground/40">•</span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {formatFileSize(file.file_size)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Date */}
                            <p className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" />
                              {formatDate(file.created_at)}
                            </p>

                            {/* Action area */}
                            {!isOwnProfile && (
                              <div className="mt-auto pt-1">
                                {file.requestStatus === 'approved' ? (
                                  <Badge
                                    className="w-full justify-center gap-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-xs py-1.5"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    تمت الموافقة
                                  </Badge>
                                ) : file.requestStatus === 'pending' ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full gap-1.5 text-xs h-8 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/30"
                                    disabled={processingRequestId === file.requestId}
                                    onClick={async () => {
                                      if (!file.requestId) return;
                                      setProcessingRequestId(file.requestId);
                                      try {
                                        const headers = await getAuthHeaders();
                                        const res = await fetch('/api/file-requests', {
                                          method: 'POST',
                                          headers,
                                          body: JSON.stringify({ action: 'cancel', requestId: file.requestId }),
                                        });
                                        const data = await res.json();
                                        if (res.ok && data.success) {
                                          toast.success('تم إلغاء الطلب');
                                          setPublicFiles((prev) =>
                                            prev.map((f) =>
                                              f.id === file.id ? { ...f, requestStatus: null, requestId: undefined } : f
                                            )
                                          );
                                        } else {
                                          toast.error(data.error || 'حدث خطأ');
                                        }
                                      } catch {
                                        toast.error('حدث خطأ غير متوقع');
                                      } finally {
                                        setProcessingRequestId(null);
                                      }
                                    }}
                                  >
                                    {processingRequestId === file.requestId ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <XCircle className="h-3.5 w-3.5" />
                                    )}
                                    إلغاء الطلب
                                  </Button>
                                ) : file.requestStatus === 'rejected' ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full gap-1.5 text-xs h-8 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                                    disabled={processingRequestId === file.requestId}
                                    onClick={async () => {
                                      if (!file.requestId) return;
                                      setProcessingRequestId(file.requestId);
                                      try {
                                        const headers = await getAuthHeaders();
                                        const res = await fetch('/api/file-requests', {
                                          method: 'POST',
                                          headers,
                                          body: JSON.stringify({ action: 'dismiss', requestId: file.requestId }),
                                        });
                                        const data = await res.json();
                                        if (res.ok && data.success) {
                                          toast.success('تم إزالة الطلب');
                                          setPublicFiles((prev) =>
                                            prev.map((f) =>
                                              f.id === file.id ? { ...f, requestStatus: null, requestId: undefined } : f
                                            )
                                          );
                                        } else {
                                          toast.error(data.error || 'حدث خطأ');
                                        }
                                      } catch {
                                        toast.error('حدث خطأ غير متوقع');
                                      } finally {
                                        setProcessingRequestId(null);
                                      }
                                    }}
                                  >
                                    {processingRequestId === file.requestId ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <XCircle className="h-3.5 w-3.5" />
                                    )}
                                    إزالة
                                  </Button>
                                ) : (
                                  <Dialog
                                    open={requestDialogOpen && requestingFileId === file.id}
                                    onOpenChange={(open) => {
                                      setRequestDialogOpen(open);
                                      if (!open) {
                                        setRequestDescription('');
                                        setRequestingFileId(null);
                                      }
                                    }}
                                  >
                                    <DialogTrigger asChild>
                                      <Button
                                        size="sm"
                                        className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                                        onClick={() => setRequestingFileId(file.id)}
                                      >
                                        <Send className="h-3.5 w-3.5" />
                                        طلب ملف
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent dir="rtl" className="sm:max-w-md">
                                      <DialogHeader>
                                        <DialogTitle className="flex items-center gap-2 text-right">
                                          <MessageSquare className="h-5 w-5 text-emerald-600" />
                                          طلب ملف
                                        </DialogTitle>
                                      </DialogHeader>
                                      <div className="space-y-4 pt-2">
                                        {/* File info */}
                                        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                          <div className="shrink-0 h-9 w-9 rounded-md bg-background flex items-center justify-center shadow-sm">
                                            {getFileIcon(file.file_type)}
                                          </div>
                                          <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{file.file_name}</p>
                                            <p className="text-xs text-muted-foreground">
                                              {formatFileSize(file.file_size)} • {formatDate(file.created_at)}
                                            </p>
                                          </div>
                                        </div>

                                        {/* Description textarea */}
                                        <div>
                                          <label className="text-sm font-medium text-foreground mb-1.5 block">
                                            وصف الطلب{' '}
                                            <span className="text-muted-foreground font-normal">(اختياري)</span>
                                          </label>
                                          <Textarea
                                            value={requestDescription}
                                            onChange={(e) => setRequestDescription(e.target.value)}
                                            placeholder="أخبر المالك لماذا تحتاج هذا الملف..."
                                            className="resize-none min-h-[80px] text-sm"
                                            maxLength={500}
                                          />
                                          <p className="text-[11px] text-muted-foreground/60 mt-1 text-left" dir="ltr">
                                            {requestDescription.length}/500
                                          </p>
                                        </div>

                                        {/* Submit button */}
                                        <Button
                                          onClick={handleSendRequest}
                                          disabled={sendingRequest}
                                          className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                                        >
                                          {sendingRequest ? (
                                            <>
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                              جارٍ الإرسال...
                                            </>
                                          ) : (
                                            <>
                                              <Send className="h-4 w-4" />
                                              إرسال الطلب
                                            </>
                                          )}
                                        </Button>
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.section>
          </TabsContent>

          {/* ─── File Requests Tab (own profile only) ──── */}
          {isOwnProfile && (
            <TabsContent value="requests">
              <motion.section
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
              >
                {loadingRequests ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
                  </div>
                ) : fileRequests.length === 0 ? (
                  <Card className="border-dashed border-2 bg-muted/20">
                    <CardContent className="py-16 flex flex-col items-center gap-4">
                      <div className="h-16 w-16 rounded-2xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-teal-500" />
                      </div>
                      <div className="text-center">
                        <p className="text-muted-foreground text-sm font-medium">لا توجد طلبات معلقة</p>
                        <p className="text-muted-foreground/60 text-xs mt-1">
                          ستظهر هنا طلبات المستخدمين الآخرين لملفاتك
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-thin">
                    {fileRequests.map((req, index) => (
                      <motion.div
                        key={req.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.05 }}
                      >
                        <Card className="border shadow-sm hover:shadow-md transition-all duration-200">
                          <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                              {/* Requester info */}
                              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                <UserLink
                                  userId={req.requester_id}
                                  name={req.requester_name || 'مستخدم'}
                                  avatarUrl={req.requester_avatar}
                                  size="sm"
                                  showAvatar={true}
                                  showRole={false}
                                />
                                <span className="text-muted-foreground text-xs shrink-0">طلب ملف</span>
                              </div>

                              {/* File name */}
                              <div className="flex items-center gap-2 shrink-0 bg-muted/50 rounded-lg px-3 py-1.5">
                                <FileText className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                                <span className="text-xs font-medium truncate max-w-[180px]">
                                  {req.file_name || 'ملف'}
                                </span>
                              </div>

                              {/* Description */}
                              {req.description && (
                                <p className="text-xs text-muted-foreground italic truncate max-w-[200px]">
                                  &ldquo;{req.description}&rdquo;
                                </p>
                              )}

                              {/* Actions */}
                              <div className="flex items-center gap-2 shrink-0 mr-auto sm:mr-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                                  disabled={processingRequestId === req.id}
                                  onClick={() => handleRequestAction(req.id, 'approve')}
                                >
                                  {processingRequestId === req.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                  موافقة
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs gap-1.5 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                                  disabled={processingRequestId === req.id}
                                  onClick={() => handleRequestAction(req.id, 'reject')}
                                >
                                  {processingRequestId === req.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <XCircle className="h-3.5 w-3.5" />
                                  )}
                                  رفض
                                </Button>
                              </div>
                            </div>

                            {/* Request date */}
                            <p className="text-[11px] text-muted-foreground/40 mt-2.5 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(req.created_at)}
                            </p>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.section>
            </TabsContent>
          )}
        </Tabs>
      </motion.div>

      {/* Photo enlargement dialog */}
      <Dialog open={photoEnlarged} onOpenChange={setPhotoEnlarged}>
        <DialogContent className="max-w-lg p-0 border-0 bg-transparent shadow-none" dir="rtl">
          <div className="relative">
            <img
              src={profile.avatar_url || ''}
              alt={profile.name}
              className="w-full h-auto rounded-2xl object-contain"
            />
            <button
              onClick={() => setPhotoEnlarged(false)}
              className="absolute top-2 left-2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
