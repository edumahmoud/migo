'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Megaphone,
  Plus,
  Trash2,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Eye,
  Calendar,
  X,
  Loader2,
  PartyPopper,
  AlertTriangle,
  Wrench,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import type {
  PlatformAnnouncement,
  PlatformAnnouncementType,
  PlatformAnnouncementLocation,
  PlatformAnnouncementSize,
} from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface PlatformAnnouncementsSectionProps {
  profile: { id: string; name: string; role: string };
}

// -------------------------------------------------------
// Predefined gradient options
// -------------------------------------------------------
const GRADIENT_OPTIONS: { value: string; labelAr: string; labelEn: string; preview: string }[] = [
  {
    value: 'from-sky-700 via-sky-800 to-teal-700',
    labelAr: 'سماوي',
    labelEn: 'Sky / Teal',
    preview: 'bg-gradient-to-br from-sky-700 via-sky-800 to-teal-700',
  },
  {
    value: 'from-emerald-700 via-emerald-800 to-teal-700',
    labelAr: 'أخضر',
    labelEn: 'Green (Celebrations)',
    preview: 'bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-700',
  },
  {
    value: 'from-violet-700 via-purple-800 to-fuchsia-700',
    labelAr: 'بنفسجي',
    labelEn: 'Purple (Events)',
    preview: 'bg-gradient-to-br from-violet-700 via-purple-800 to-fuchsia-700',
  },
  {
    value: 'from-amber-600 via-orange-700 to-red-600',
    labelAr: 'دافئ',
    labelEn: 'Warm (Alerts)',
    preview: 'bg-gradient-to-br from-amber-600 via-orange-700 to-red-600',
  },
  {
    value: 'from-rose-700 via-pink-800 to-red-700',
    labelAr: 'أحمر',
    labelEn: 'Red (Urgent)',
    preview: 'bg-gradient-to-br from-rose-700 via-pink-800 to-red-700',
  },
  {
    value: 'from-gray-700 via-gray-800 to-slate-700',
    labelAr: 'محايد',
    labelEn: 'Neutral (Maintenance)',
    preview: 'bg-gradient-to-br from-gray-700 via-gray-800 to-slate-700',
  },
];

// -------------------------------------------------------
// Type badge config
// -------------------------------------------------------
const TYPE_BADGE_MAP: Record<PlatformAnnouncementType, { labelAr: string; labelEn: string; classes: string }> = {
  celebration: {
    labelAr: 'احتفال',
    labelEn: 'Celebration',
    classes: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  announcement: {
    labelAr: 'إعلان',
    labelEn: 'Announcement',
    classes: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  },
  alert: {
    labelAr: 'تنبيه',
    labelEn: 'Alert',
    classes: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  maintenance: {
    labelAr: 'صيانة',
    labelEn: 'Maintenance',
    classes: 'bg-gray-100 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  },
};

// -------------------------------------------------------
// Type icon helper
// -------------------------------------------------------
function TypeIcon({ type, className }: { type: PlatformAnnouncementType; className?: string }) {
  switch (type) {
    case 'celebration':
      return <PartyPopper className={className} />;
    case 'announcement':
      return <Megaphone className={className} />;
    case 'alert':
      return <AlertTriangle className={className} />;
    case 'maintenance':
      return <Wrench className={className} />;
    default:
      return <Megaphone className={className} />;
  }
}

// -------------------------------------------------------
// Form state type
// -------------------------------------------------------
interface FormState {
  title: string;
  message: string;
  title_en: string;
  message_en: string;
  type: PlatformAnnouncementType;
  bg_color: string;
  icon: string;
  display_location: PlatformAnnouncementLocation;
  display_size: PlatformAnnouncementSize;
  start_at: string;
  end_at: string;
  image_url: string;
}

const INITIAL_FORM: FormState = {
  title: '',
  message: '',
  title_en: '',
  message_en: '',
  type: 'celebration',
  bg_color: 'from-sky-700 via-sky-800 to-teal-700',
  icon: '🎉',
  display_location: 'everywhere',
  display_size: 'fullscreen',
  start_at: '',
  end_at: '',
  image_url: '',
};

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

const modalOverlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const modalContentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.15 } },
};

// -------------------------------------------------------
// Component
// -------------------------------------------------------
export default function PlatformAnnouncementsSection({ profile }: PlatformAnnouncementsSectionProps) {
  const { t, direction, locale } = useTranslations();

  // ─── Data state ───
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Create modal state ───
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...INITIAL_FORM });
  const [creating, setCreating] = useState(false);

  // ─── Edit modal state ───
  const [editingId, setEditingId] = useState<string | null>(null);

  // ─── Delete confirmation state ───
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ─── Auth token helper ───
  const getAuthToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch {
      return null;
    }
  }, []);

  // ─── Fetch announcements ───
  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('auth.mustLogin'));
        return;
      }
      const res = await fetch('/api/admin/platform-announcements', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) {
        setAnnouncements(result.data as PlatformAnnouncement[]);
      } else {
        setAnnouncements([]);
      }
    } catch {
      setAnnouncements([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, t]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  // ─── Helper: build request headers ───
  const authHeaders = useCallback(async (contentType = true): Promise<HeadersInit> => {
    const token = await getAuthToken();
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (contentType) headers['Content-Type'] = 'application/json';
    return headers;
  }, [getAuthToken]);

  // ─── Handle create ───
  const handleCreate = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      toast.error(t('common.required') || 'Title and message are required');
      return;
    }

    setCreating(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/admin/platform-announcements', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: form.title.trim(),
          message: form.message.trim(),
          title_en: form.title_en.trim() || null,
          message_en: form.message_en.trim() || null,
          type: form.type,
          bg_color: form.bg_color,
          icon: form.icon || '🎉',
          display_location: form.display_location,
          display_size: form.display_size,
          start_at: form.start_at || new Date().toISOString(),
          end_at: form.end_at || null,
          image_url: form.image_url.trim() || null,
          created_by: profile.id,
        }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(t('common.success') || 'Created successfully');
        setCreateModalOpen(false);
        setForm({ ...INITIAL_FORM });
        fetchAnnouncements();
      } else {
        toast.error(result.error || t('common.unexpectedError'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setCreating(false);
    }
  };

  // ─── Handle toggle (active/inactive) ───
  const handleToggle = async (announcement: PlatformAnnouncement) => {
    const newActive = !announcement.is_active;
    // Optimistic update
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === announcement.id ? { ...a, is_active: newActive } : a))
    );

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/admin/platform-announcements', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: announcement.id, is_active: newActive }),
      });
      const result = await res.json();
      if (!result.success) {
        // Revert optimistic update
        setAnnouncements((prev) =>
          prev.map((a) => (a.id === announcement.id ? { ...a, is_active: announcement.is_active } : a))
        );
        toast.error(result.error || t('common.unexpectedError'));
      } else {
        toast.success(newActive ? (t('common.success') || 'Activated') : (t('common.success') || 'Deactivated'));
      }
    } catch {
      // Revert
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === announcement.id ? { ...a, is_active: announcement.is_active } : a))
      );
      toast.error(t('common.unexpectedError'));
    }
  };

  // ─── Handle delete ───
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/admin/platform-announcements', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(t('common.success') || 'Deleted');
        setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      } else {
        toast.error(result.error || t('common.unexpectedError'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Handle edit (open modal pre-filled) ───
  const openEditModal = (announcement: PlatformAnnouncement) => {
    setEditingId(announcement.id);
    setForm({
      title: announcement.title || '',
      message: announcement.message || '',
      title_en: announcement.title_en || '',
      message_en: announcement.message_en || '',
      type: announcement.type,
      bg_color: announcement.bg_color || 'from-sky-700 via-sky-800 to-teal-700',
      icon: announcement.icon || '🎉',
      display_location: announcement.display_location,
      display_size: announcement.display_size,
      start_at: announcement.start_at ? new Date(announcement.start_at).toISOString().slice(0, 16) : '',
      end_at: announcement.end_at ? new Date(announcement.end_at).toISOString().slice(0, 16) : '',
      image_url: announcement.image_url || '',
    });
    setCreateModalOpen(true);
  };

  // ─── Handle edit submit ───
  const handleEdit = async () => {
    if (!editingId) return;
    if (!form.title.trim() || !form.message.trim()) {
      toast.error(t('common.required') || 'Title and message are required');
      return;
    }

    setCreating(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/admin/platform-announcements', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          id: editingId,
          title: form.title.trim(),
          message: form.message.trim(),
          title_en: form.title_en.trim() || null,
          message_en: form.message_en.trim() || null,
          type: form.type,
          bg_color: form.bg_color,
          icon: form.icon || '🎉',
          display_location: form.display_location,
          display_size: form.display_size,
          start_at: form.start_at || undefined,
          end_at: form.end_at || null,
          image_url: form.image_url.trim() || null,
        }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(t('common.success') || 'Updated');
        setCreateModalOpen(false);
        setEditingId(null);
        setForm({ ...INITIAL_FORM });
        fetchAnnouncements();
      } else {
        toast.error(result.error || t('common.unexpectedError'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setCreating(false);
    }
  };

  // ─── Close modal handler ───
  const closeModal = () => {
    setCreateModalOpen(false);
    setEditingId(null);
    setForm({ ...INITIAL_FORM });
  };

  // ─── Computed stats ───
  const totalCount = announcements.length;
  const activeCount = announcements.filter((a) => a.is_active).length;
  const inactiveCount = totalCount - activeCount;

  // ─── Helper: format date ───
  const formatDate = (dateStr: string, loc: string = 'ar-SA'): string => {
    try {
      return new Date(dateStr).toLocaleDateString(loc === 'en' ? 'en-US' : 'ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  // ─── Helper: get type badge info ───
  const getTypeBadge = (type: PlatformAnnouncementType) => {
    return TYPE_BADGE_MAP[type] || TYPE_BADGE_MAP.announcement;
  };

  // ─── Helper: get location label ───
  const getLocationLabel = (loc: PlatformAnnouncementLocation): string => {
    switch (loc) {
      case 'login': return locale === 'en' ? 'Login' : 'تسجيل الدخول';
      case 'dashboard': return locale === 'en' ? 'Dashboard' : 'لوحة التحكم';
      case 'everywhere': return locale === 'en' ? 'Everywhere' : 'في كل مكان';
      default: return loc;
    }
  };

  // ─── Helper: get size label ───
  const getSizeLabel = (size: PlatformAnnouncementSize): string => {
    switch (size) {
      case 'fullscreen': return locale === 'en' ? 'Fullscreen' : 'ملء الشاشة';
      case 'banner': return locale === 'en' ? 'Banner' : 'شريط';
      case 'popup': return locale === 'en' ? 'Popup' : 'نافذة منبثقة';
      default: return size;
    }
  };

  // ─── Type options for selector ───
  const typeOptions: { value: PlatformAnnouncementType; labelAr: string; labelEn: string }[] = [
    { value: 'celebration', labelAr: 'احتفال', labelEn: 'Celebration' },
    { value: 'announcement', labelAr: 'إعلان', labelEn: 'Announcement' },
    { value: 'alert', labelAr: 'تنبيه', labelEn: 'Alert' },
    { value: 'maintenance', labelAr: 'صيانة', labelEn: 'Maintenance' },
  ];

  // ─── Location options ───
  const locationOptions: { value: PlatformAnnouncementLocation; labelAr: string; labelEn: string }[] = [
    { value: 'login', labelAr: 'تسجيل الدخول', labelEn: 'Login' },
    { value: 'dashboard', labelAr: 'لوحة التحكم', labelEn: 'Dashboard' },
    { value: 'everywhere', labelAr: 'في كل مكان', labelEn: 'Everywhere' },
  ];

  // ─── Size options ───
  const sizeOptions: { value: PlatformAnnouncementSize; labelAr: string; labelEn: string }[] = [
    { value: 'fullscreen', labelAr: 'ملء الشاشة', labelEn: 'Fullscreen' },
    { value: 'banner', labelAr: 'شريط', labelEn: 'Banner' },
    { value: 'popup', labelAr: 'نافذة منبثقة', labelEn: 'Popup' },
  ];

  // ---------------------------------------------------
  // Render: Loading
  // ---------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
          <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------
  // Render: Main
  // ---------------------------------------------------
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
      dir={direction}
    >
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-100 to-teal-100 dark:from-sky-900/50 dark:to-teal-900/50">
            <Megaphone className="h-5 w-5 text-sky-700 dark:text-sky-300" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">
              {t('platformAnnouncements.title') || 'المعايدات والإعلانات العامة'}
            </h2>
          </div>
          <Badge className="bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800 text-xs">
            {totalCount}
          </Badge>
        </div>
        <Button
          onClick={() => {
            setForm({ ...INITIAL_FORM });
            setEditingId(null);
            setCreateModalOpen(true);
          }}
          className="bg-sky-700 hover:bg-sky-800 text-white gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {locale === 'en' ? 'Create New' : 'إنشاء جديد'}
        </Button>
      </div>

      {/* ─── Stats Row ─── */}
      <div className="grid grid-cols-3 gap-3">
        <motion.div
          variants={itemVariants}
          className="rounded-xl border bg-card shadow-sm p-4 text-center"
        >
          <p className="text-2xl font-bold text-foreground">{totalCount}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {locale === 'en' ? 'Total' : 'الإجمالي'}
          </p>
        </motion.div>
        <motion.div
          variants={itemVariants}
          className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 shadow-sm p-4 text-center"
        >
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{activeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {locale === 'en' ? 'Active' : 'نشط'}
          </p>
        </motion.div>
        <motion.div
          variants={itemVariants}
          className="rounded-xl border bg-gray-50 dark:bg-gray-900/30 shadow-sm p-4 text-center"
        >
          <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{inactiveCount}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {locale === 'en' ? 'Inactive' : 'غير نشط'}
          </p>
        </motion.div>
      </div>

      {/* ─── Announcements List ─── */}
      {announcements.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="rounded-xl border border-dashed bg-muted/30 p-12 text-center"
        >
          <Megaphone className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            {locale === 'en' ? 'No platform announcements yet' : 'لا توجد معايدات أو إعلانات بعد'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {locale === 'en' ? 'Create one to celebrate or alert your users' : 'أنشئ واحدة للاحتفال أو تنبيه المستخدمين'}
          </p>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-3 max-h-[calc(100vh-320px)] overflow-y-auto pr-1"
          style={{
            scrollbarWidth: 'thin',
          }}
        >
          {announcements.map((announcement) => {
            const badge = getTypeBadge(announcement.type);
            const isDeleting = deletingId === announcement.id;

            return (
              <motion.div
                key={announcement.id}
                variants={itemVariants}
                layout
                className={`rounded-xl border bg-card shadow-sm overflow-hidden transition-colors ${
                  announcement.is_active
                    ? 'border-border hover:border-sky-300 dark:hover:border-sky-700'
                    : 'border-border/60 opacity-70'
                }`}
              >
                {/* Card gradient accent bar */}
                <div className={`h-1.5 bg-gradient-to-r ${announcement.bg_color || 'from-sky-700 via-sky-800 to-teal-700'}`} />

                <div className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Icon emoji + Type badge */}
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <span className="text-3xl" role="img" aria-label={announcement.type}>
                        {announcement.icon || '🎉'}
                      </span>
                      <Badge className={`${badge.classes} text-[10px] px-2 py-0.5 border font-medium`}>
                        <TypeIcon type={announcement.type} className="h-3 w-3 me-1 inline" />
                        {locale === 'en' ? badge.labelEn : badge.labelAr}
                      </Badge>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-foreground text-sm truncate">
                          {announcement.title}
                        </h3>
                        {!announcement.is_active && (
                          <Badge className="bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 text-[10px] px-1.5">
                            {locale === 'en' ? 'Inactive' : 'غير نشط'}
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {announcement.message}
                      </p>

                      {/* Meta badges row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Display location badge */}
                        <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                          {getLocationLabel(announcement.display_location)}
                        </Badge>

                        {/* Display size badge */}
                        <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                          {getSizeLabel(announcement.display_size)}
                        </Badge>

                        {/* Start date */}
                        {announcement.start_at && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(announcement.start_at, locale)}
                          </span>
                        )}

                        {/* End date */}
                        {announcement.end_at && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="text-muted-foreground/50">→</span>
                            {formatDate(announcement.end_at, locale)}
                          </span>
                        )}

                        {/* Views count */}
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground ms-auto">
                          <Eye className="h-3 w-3" />
                          {announcement.views_count ?? 0}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {/* Toggle active/inactive */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleToggle(announcement)}
                        title={announcement.is_active
                          ? (locale === 'en' ? 'Deactivate' : 'إلغاء التفعيل')
                          : (locale === 'en' ? 'Activate' : 'تفعيل')
                        }
                      >
                        {announcement.is_active ? (
                          <ToggleRight className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                        )}
                      </Button>

                      {/* Edit */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditModal(announcement)}
                        title={locale === 'en' ? 'Edit' : 'تعديل'}
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>

                      {/* Delete */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          if (isDeleting) return;
                          const confirmed = window.confirm(
                            locale === 'en'
                              ? 'Are you sure you want to delete this announcement?'
                              : 'هل أنت متأكد من حذف هذا الإعلان؟'
                          );
                          if (confirmed) handleDelete(announcement.id);
                        }}
                        disabled={isDeleting}
                        title={locale === 'en' ? 'Delete' : 'حذف'}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-rose-500 dark:text-rose-400" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ─── Create / Edit Modal ─── */}
      <AnimatePresence>
        {createModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <motion.div
              className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-background border shadow-xl"
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              dir={direction}
              style={{ scrollbarWidth: 'thin' }}
            >
              {/* Modal header */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-5 py-4">
                <div className="flex items-center gap-2">
                  {editingId ? (
                    <Pencil className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                  ) : (
                    <Plus className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                  )}
                  <h3 className="font-semibold text-foreground">
                    {editingId
                      ? (locale === 'en' ? 'Edit Announcement' : 'تعديل الإعلان')
                      : (locale === 'en' ? 'Create Announcement' : 'إنشاء إعلان')
                    }
                  </h3>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeModal}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Modal body */}
              <div className="p-5 space-y-5">
                {/* Title (AR) + Title (EN) side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {locale === 'en' ? 'Title (Arabic)' : 'العنوان (عربي)'} <span className="text-red-400">*</span>
                    </label>
                    <Input
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder={locale === 'en' ? 'Enter title in Arabic...' : 'أدخل العنوان بالعربية...'}
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {locale === 'en' ? 'Title (English)' : 'العنوان (إنجليزي)'}
                    </label>
                    <Input
                      value={form.title_en}
                      onChange={(e) => setForm((f) => ({ ...f, title_en: e.target.value }))}
                      placeholder={locale === 'en' ? 'Enter title in English...' : 'أدخل العنوان بالإنجليزية...'}
                      className="h-10 text-sm"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Message (AR) + Message (EN) side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {locale === 'en' ? 'Message (Arabic)' : 'الرسالة (عربي)'} <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={form.message}
                      onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                      placeholder={locale === 'en' ? 'Enter message in Arabic...' : 'أدخل الرسالة بالعربية...'}
                      className="w-full rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-sky-400 focus:ring-sky-400/20 px-3 py-2.5 text-sm resize-none h-24"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {locale === 'en' ? 'Message (English)' : 'الرسالة (إنجليزي)'}
                    </label>
                    <textarea
                      value={form.message_en}
                      onChange={(e) => setForm((f) => ({ ...f, message_en: e.target.value }))}
                      placeholder={locale === 'en' ? 'Enter message in English...' : 'أدخل الرسالة بالإنجليزية...'}
                      className="w-full rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-sky-400 focus:ring-sky-400/20 px-3 py-2.5 text-sm resize-none h-24"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Type selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {locale === 'en' ? 'Type' : 'النوع'}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {typeOptions.map((opt) => {
                      const badgeInfo = TYPE_BADGE_MAP[opt.value];
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, type: opt.value }))}
                          className={`flex items-center gap-2 rounded-lg p-2.5 border-2 transition-all text-xs font-medium ${
                            form.type === opt.value
                              ? `${badgeInfo.classes} border-current shadow-sm`
                              : 'border-border text-muted-foreground hover:border-sky-200 dark:hover:border-sky-800'
                          }`}
                        >
                          <TypeIcon type={opt.value} className="h-4 w-4 shrink-0" />
                          {locale === 'en' ? opt.labelEn : opt.labelAr}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Icon emoji input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {locale === 'en' ? 'Icon Emoji' : 'أيقونة إيموجي'}
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl" role="img">{form.icon || '🎉'}</span>
                    <Input
                      value={form.icon}
                      onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                      placeholder="🎉"
                      className="h-10 w-24 text-center text-lg"
                      maxLength={4}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {locale === 'en' ? 'Emoji character for the announcement' : 'رمز إيموجي للإعلان'}
                    </p>
                  </div>
                </div>

                {/* Background color selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {locale === 'en' ? 'Background Gradient' : 'تدرج الخلفية'}
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {GRADIENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, bg_color: opt.value }))}
                        className={`relative rounded-lg overflow-hidden h-14 border-2 transition-all ${
                          form.bg_color === opt.value
                            ? 'border-sky-600 ring-2 ring-sky-600/30 shadow-md scale-105'
                            : 'border-border hover:border-sky-300 dark:hover:border-sky-700'
                        }`}
                        title={locale === 'en' ? opt.labelEn : opt.labelAr}
                      >
                        <div className={`absolute inset-0 ${opt.preview}`} />
                        {form.bg_color === opt.value && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-4 w-4 rounded-full bg-white shadow-md flex items-center justify-center">
                              <span className="text-[8px] text-sky-700 font-bold">✓</span>
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Display location + Display size */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {locale === 'en' ? 'Display Location' : 'مكان العرض'}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {locationOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, display_location: opt.value }))}
                          className={`rounded-lg p-2 border-2 transition-all text-[10px] sm:text-xs font-medium ${
                            form.display_location === opt.value
                              ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 shadow-sm'
                              : 'border-border text-muted-foreground hover:border-sky-200 dark:hover:border-sky-800'
                          }`}
                        >
                          {locale === 'en' ? opt.labelEn : opt.labelAr}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {locale === 'en' ? 'Display Size' : 'حجم العرض'}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {sizeOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, display_size: opt.value }))}
                          className={`rounded-lg p-2 border-2 transition-all text-[10px] sm:text-xs font-medium ${
                            form.display_size === opt.value
                              ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 shadow-sm'
                              : 'border-border text-muted-foreground hover:border-sky-200 dark:hover:border-sky-800'
                          }`}
                        >
                          {locale === 'en' ? opt.labelEn : opt.labelAr}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Start date + End date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {locale === 'en' ? 'Start Date' : 'تاريخ البدء'}
                    </label>
                    <Input
                      type="datetime-local"
                      value={form.start_at}
                      onChange={(e) => setForm((f) => ({ ...f, start_at: e.target.value }))}
                      className="h-10 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {locale === 'en' ? 'End Date' : 'تاريخ الانتهاء'}
                    </label>
                    <Input
                      type="datetime-local"
                      value={form.end_at}
                      onChange={(e) => setForm((f) => ({ ...f, end_at: e.target.value }))}
                      className="h-10 text-sm"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Image URL */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5" />
                    {locale === 'en' ? 'Image URL (optional)' : 'رابط الصورة (اختياري)'}
                  </label>
                  <Input
                    value={form.image_url}
                    onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                    placeholder={locale === 'en' ? 'https://example.com/image.png' : 'https://example.com/image.png'}
                    className="h-10 text-sm"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Modal footer */}
              <div className="sticky bottom-0 border-t bg-background px-5 py-4 flex items-center justify-end gap-3">
                <Button variant="outline" onClick={closeModal} disabled={creating} className="h-10">
                  {t('common.cancel') || (locale === 'en' ? 'Cancel' : 'إلغاء')}
                </Button>
                <Button
                  onClick={editingId ? handleEdit : handleCreate}
                  disabled={creating || !form.title.trim() || !form.message.trim()}
                  className="bg-sky-700 hover:bg-sky-800 text-white gap-1.5 h-10 min-w-[140px]"
                >
                  {creating ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('common.loading') || (locale === 'en' ? 'Saving...' : 'جاري الحفظ...')}
                    </span>
                  ) : (
                    <>
                      {editingId ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {editingId
                        ? (locale === 'en' ? 'Update' : 'تحديث')
                        : (locale === 'en' ? 'Create' : 'إنشاء')
                      }
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
