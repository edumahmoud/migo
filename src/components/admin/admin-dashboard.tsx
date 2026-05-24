'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// recharts is imported at top level for now — consider lazy-loading the analytics tab component
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Settings,
  GraduationCap,
  ClipboardList,
  TrendingUp,
  Search,
  Trash2,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Mail,
  Calendar,
  Shield,
  UserCircle,
  Hash,
  Eye,
  AlertTriangle,
  Download,
  Award,
  BarChart3,
  Ban,
  Megaphone,
  Plus,
  Unlock,
  ToggleLeft,
  ToggleRight,
  Activity,
  Radio,
  ArrowUpRight,
  ArrowDownRight,
  Building2,
  MessageCircle,
  Clock,
  Gavel,
  ArrowUpDown,
  Filter,
  Video,
  Flag,
  MessageSquare,
  ShieldAlert,
} from 'lucide-react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
// Admin dashboard uses API routes with service role client — no direct Supabase data calls
import { supabase } from '@/lib/supabase';
import AppSidebar from '@/components/shared/app-sidebar';
import AppHeader from '@/components/shared/app-header';
import MobileBottomNav from '@/components/shared/mobile-bottom-nav';
import SettingsSection from '@/components/shared/settings-section';
import ChatSection from '@/components/shared/chat-section';
import InstitutionSection from '@/components/admin/institution-section';
import ReportsSection from '@/components/reports/reports-section';
import StatCard from '@/components/shared/stat-card';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type { UserProfile, Subject, Score, AdminSection, BannedUser, Announcement } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AdminDashboardProps {
  profile: UserProfile;
  onSignOut: () => void;
}

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

const cardHover = {
  whileHover: { scale: 1.02, y: -2 },
  whileTap: { scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
};

// -------------------------------------------------------
// Admin navigation items (labelKey used for i18n, t() called at render time)
// -------------------------------------------------------
const adminNavItemDefs = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'users', labelKey: 'nav.users', icon: <Users className="h-5 w-5" /> },
  { id: 'subjects', labelKey: 'nav.subjects', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'announcements', labelKey: 'nav.announcements', icon: <Megaphone className="h-5 w-5" /> },
  { id: 'banned', labelKey: 'nav.banned', icon: <Ban className="h-5 w-5" /> },
  { id: 'comments', labelKey: 'admin.comments', icon: <Flag className="h-5 w-5" /> },
  { id: 'complaints', labelKey: 'nav.complaints', icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'reports', labelKey: 'nav.reports', icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'chat', labelKey: 'nav.chat', icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'settings', labelKey: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
  { id: 'institution', labelKey: 'nav.institution', icon: <Building2 className="h-5 w-5" />, superadminOnly: true },
];

// -------------------------------------------------------
// Helper: format date to Arabic-friendly string
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Format date with exact time
function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// -------------------------------------------------------
// Role label helper - accepts t function as parameter since it's outside component
// -------------------------------------------------------
function getRoleLabel(role: string, translate: (key: string) => string): string {
  switch (role) {
    case 'superadmin':
      return translate('roles.superadmin');
    case 'admin':
      return translate('roles.supervisor');
    case 'teacher':
      return translate('roles.teacher');
    case 'student':
      return translate('roles.student');
    default:
      return role;
  }
}

function getRoleBadgeClass(role: string): string {
  switch (role) {
    case 'superadmin':
      return 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'admin':
      return 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800';
    case 'teacher':
      return 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800';
    case 'student':
      return 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-sky-800';
    default:
      return 'bg-gray-100 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700';
  }
}

// Role-based card styling (border color)
function getRoleCardClass(role: string): string {
  switch (role) {
    case 'superadmin':
      return 'border-amber-200 dark:border-amber-800 hover:border-amber-400';
    case 'admin':
      return 'border-sky-200 dark:border-sky-800 hover:border-sky-400';
    case 'teacher':
      return 'border-teal-200 dark:border-teal-800 hover:border-teal-400';
    case 'student':
      return 'border-sky-200 dark:border-sky-800 hover:border-sky-400';
    default:
      return 'border-border';
  }
}

// Role-based card top accent bar color
function getRoleAccentClass(role: string): string {
  switch (role) {
    case 'superadmin':
      return 'bg-amber-500';
    case 'admin':
      return 'bg-sky-600';
    case 'teacher':
      return 'bg-teal-500';
    case 'student':
      return 'bg-sky-500';
    default:
      return 'bg-gray-400';
  }
}

// -------------------------------------------------------
// Score percentage helper
// -------------------------------------------------------
function scorePercentage(score: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((score / total) * 100);
}

function pctColorClass(pct: number): string {
  if (pct >= 90) return 'text-teal-700 dark:text-teal-300 bg-teal-100 dark:bg-teal-900/50';
  if (pct >= 75) return 'text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-900/50';
  if (pct >= 60) return 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50';
  return 'text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/50';
}

// -------------------------------------------------------
// Extended user profile with subject count for teachers
// -------------------------------------------------------
interface UserWithMeta extends UserProfile {
  subjectCount?: number;
  studentCount?: number;
  teacherCount?: number;
}

// -------------------------------------------------------
// Supervisor Links Manager (moved OUTSIDE AdminDashboard)
// FIX: Previously defined inside AdminDashboard, which caused
// React to unmount/remount the entire subtree on every parent
// render (new component type each render = infinite re-fetching).
// -------------------------------------------------------
const SupervisorLinksManager = React.memo(function SupervisorLinksManager({ teacherId, teacherName }: { teacherId: string; teacherName: string }) {
  const { t } = useTranslations();
  const [links, setLinks] = useState<Array<{ id: string; supervisor_id: string; is_primary: boolean; supervisor?: { name: string; role: string } }>>([]);
  const [admins, setAdmins] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState('');

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/teacher-supervisor?teacher_id=${teacherId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success) setLinks(result.data || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [teacherId]);

  const fetchAdmins = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success) {
        setAdmins((result.data || []).filter((u: UserProfile) => u.role === 'admin' || u.role === 'superadmin'));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchLinks(); fetchAdmins(); }, [fetchLinks, fetchAdmins]);

  const handleAddLink = async () => {
    if (!selectedAdmin) return;
    setAdding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/teacher-supervisor', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: teacherId, supervisor_id: selectedAdmin, is_primary: links.length === 0 }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success('تم ربط المعلم بالمشرف بنجاح');
        setSelectedAdmin('');
        fetchLinks();
      } else {
        toast.error(result.error || 'فشل إنشاء الرابط');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally { setAdding(false); }
  };

  const handleRemoveLink = async (linkId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/teacher-supervisor?id=${linkId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (result.success) {
        toast.success('تم إزالة الرابط');
        fetchLinks();
      } else {
        toast.error(result.error || 'فشل حذف الرابط');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const handleSetPrimary = async (linkId: string, supervisorId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // Remove primary from all, then set new primary
      await fetch('/api/teacher-supervisor', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: teacherId, supervisor_id: supervisorId, is_primary: true }),
      });
      fetchLinks();
    } catch { /* ignore */ }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <span className="text-sm font-semibold text-foreground">المشرفون المرتبطون</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">المشرفون المسؤولون عن معلم {teacherName}</p>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : links.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا يوجد مشرفون مرتبطون. سيتم الربط تلقائياً عند ترقية الحساب.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {links.map((link) => (
            <div key={link.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{link.supervisor?.name || 'غير معروف'}</span>
                {link.is_primary && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">رئيسي</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!link.is_primary && (
                  <button
                    onClick={() => handleSetPrimary(link.id, link.supervisor_id)}
                    className="text-[10px] text-sky-600 hover:underline"
                  >
                    تعيين رئيسي
                  </button>
                )}
                <button
                  onClick={() => handleRemoveLink(link.id)}
                  className="text-[10px] text-rose-600 hover:underline"
                >
                  إزالة
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new supervisor */}
      <div className="flex items-center gap-2">
        <select
          value={selectedAdmin}
          onChange={(e) => setSelectedAdmin(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          <option value="">إضافة مشرف...</option>
          {admins
            .filter((a) => !links.some((l) => l.supervisor_id === a.id))
            .map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.role === 'admin' ? t('roles.supervisor') : 'مدير'})</option>
            ))}
        </select>
        <button
          onClick={handleAddLink}
          disabled={adding || !selectedAdmin}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          ربط
        </button>
      </div>
    </div>
  );
});

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AdminDashboard({ profile, onSignOut }: AdminDashboardProps) {
  // ─── Auth store ───
  const { updateProfile: authUpdateProfile, signOut: authSignOut } = useAuthStore();
  const { t, isRTL, direction } = useTranslations();
  const { sidebarOpen, setSidebarOpen, adminSection: storedAdminSection, setAdminSection: storeSetAdminSection } = useAppStore();

  // ─── Navigation ───
  const [activeSection, setActiveSection] = useState<AdminSection>(storedAdminSection || 'dashboard');

  // Keep local state in sync when store changes (e.g. notification navigation)
  useEffect(() => {
    if (storedAdminSection && storedAdminSection !== activeSection) {
      setActiveSection(storedAdminSection);
    }
  }, [storedAdminSection, activeSection]);

  // ─── Data state ───
  const [allUsers, setAllUsers] = useState<UserWithMeta[]>([]);
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [allScores, setAllScores] = useState<Score[]>([]);
  const [totalQuizzes, setTotalQuizzes] = useState(0);
  const [totalSubmissions, setTotalSubmissions] = useState(0);
  const [totalVideos, setTotalVideos] = useState(0);
  const [flaggedComments, setFlaggedComments] = useState<any[]>([]);
  const [flaggedLoading, setFlaggedLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  // ─── Users section state ───
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'teacher' | 'admin' | 'superadmin'>('all');
  const [selectedUser, setSelectedUser] = useState<UserWithMeta | null>(null);
  const [userDetailOpen, setUserDetailOpen] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);
  const [userPage, setUserPage] = useState(1);
  const usersPerPage = 12;
  const [userSortOrder, setUserSortOrder] = useState<'newest' | 'oldest'>('newest');

  // ─── Subject detail ───
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [subjectDetailOpen, setSubjectDetailOpen] = useState(false);
  const [subjectStudents, setSubjectStudents] = useState<UserProfile[]>([]);
  const [subjectTeacher, setSubjectTeacher] = useState<UserProfile | null>(null);
  const [loadingSubjectDetail, setLoadingSubjectDetail] = useState(false);
  const [deletingSubjectId, setDeletingSubjectId] = useState<string | null>(null);
  const [confirmDeleteSubject, setConfirmDeleteSubject] = useState<string | null>(null);

  // ─── Subject search/filter state ───
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectLevelFilter, setSubjectLevelFilter] = useState('');
  const [subjectSubLevelFilter, setSubjectSubLevelFilter] = useState('');

  // ─── Banned users state ───
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([]);
  const [loadingBanned, setLoadingBanned] = useState(false);
  const [unbanningEmail, setUnbanningEmail] = useState<string | null>(null);

  // ─── Ban dialog state ───
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState<'permanent' | '1day' | '1week' | '1month' | 'custom'>('permanent');
  const [banCustomDate, setBanCustomDate] = useState('');
  const [banningUserId, setBanningUserId] = useState<string | null>(null);

  // ─── Announcements state ───
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [createAnnouncementOpen, setCreateAnnouncementOpen] = useState(false);
  const [newAnnTitle, setNewAnnTitle] = useState('');
  const [newAnnContent, setNewAnnContent] = useState('');
  const [newAnnPriority, setNewAnnPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false);
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null);

  // ─── Usage stats state (reports section) ───
  const [usageStats, setUsageStats] = useState<{
    activeLectures: number;
    period: string;
    activeUsers: number;
    newRegistrations: number;
    attendanceSessions: number;
    quizzesTaken: number;
    lecturesCreated: number;
    assignmentsCreated: number;
    changes: {
      activeUsers: number;
      newRegistrations: number;
      attendanceSessions: number;
      quizzesTaken: number;
      lecturesCreated: number;
      assignmentsCreated: number;
    };
    prevData: {
      activeUsers: number;
      newRegistrations: number;
      attendanceSessions: number;
      quizzesTaken: number;
      lecturesCreated: number;
      assignmentsCreated: number;
    };
    chartData: { date: string; users: number; sessions: number; quizzes: number }[];
    registrationTrends: { month: string; count: number; label: string }[];
  } | null>(null);
  const [usagePeriod, setUsagePeriod] = useState<'day' | 'month' | 'year'>('month');
  const [loadingUsageStats, setLoadingUsageStats] = useState(false);

  // -------------------------------------------------------
  // Data fetching — uses API routes with service role key
  // -------------------------------------------------------
  const [changingRole, setChangingRole] = useState(false);

  // ─── Helper: fetch with timeout ───
  const fetchWithTimeout = useCallback(async (url: string, options: RequestInit = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('انتهت مهلة الطلب. يرجى المحاولة مرة أخرى');
      }
      throw error;
    }
  }, []);

  // ─── Helper: get auth token ───
  const getAuthToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch {
      return null;
    }
  }, []);

  const fetchAllData = useCallback(async (silent = false) => {
    if (!silent) setLoadingData(true);
    try {
      const token = await getAuthToken();
      
      if (!token) {
        console.error('Admin data fetch: No auth token available');
        if (!silent) toast.error(t('auth.mustLogin'));
        if (!silent) setLoadingData(false);
        return;
      }
      
      const res = await fetchWithTimeout('/api/admin/data?type=all', {
        headers: { 'Authorization': `Bearer ${token}` },
      }, 30000); // 30s timeout for data fetch
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.error('Admin data fetch failed:', res.status, errorData);
        if (!silent) {
          if (res.status === 401) {
            toast.error(t('auth.sessionKicked'));
          } else if (res.status === 403) {
            toast.error(t('common.accessDenied'));
          } else {
            toast.error(`خطأ في جلب البيانات: ${errorData.error || res.status}`);
          }
        }
        if (!silent) setLoadingData(false);
        return;
      }
      
      const result = await res.json();
      if (result.success && result.data) {
        if (result.data.users) setAllUsers(result.data.users as UserWithMeta[]);
        if (result.data.subjects) setAllSubjects(result.data.subjects as Subject[]);
        if (result.data.scores) setAllScores(result.data.scores as Score[]);
        if (result.data.quizCount !== undefined) setTotalQuizzes(result.data.quizCount as number);
        if (result.data.videoCount !== undefined) setTotalVideos(result.data.videoCount as number);
        
        // Log warnings if any
        if (result.warnings && result.warnings.length > 0) {
          console.warn('Admin data fetch warnings:', result.warnings);
        }
      } else if (!result.success) {
        console.error('Admin data fetch returned error:', result.error);
        if (!silent) toast.error(result.error || t('common.unexpectedError'));
      }
    } catch (error) {
      console.error('Error fetching admin data:', error);
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      if (!silent) toast.error(message);
    } finally {
      if (!silent) setLoadingData(false);
    }
  }, [fetchWithTimeout, getAuthToken]);

  const handleChangeRole = async (userId: string, newRole: 'student' | 'teacher' | 'admin' | 'superadmin') => {
    setChangingRole(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('auth.mustLogin'));
        return;
      }
      const res = await fetchWithTimeout('/api/admin/change-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId, newRole }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(t('admin.roleChanged'));
        // Update selectedUser immediately so the dialog shows the new role
        setSelectedUser((prev) => prev ? { ...prev, role: newRole } as UserWithMeta : prev);
        // Refresh data in the background
        fetchAllData(true);
        // Close the dialog
        setUserDetailOpen(false);
      } else {
        toast.error(result.error || t('common.unexpectedError'));
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    } finally {
      setChangingRole(false);
    }
  };

  // -------------------------------------------------------
  // Fetch banned users (declared early to avoid TDZ)
  // -------------------------------------------------------
  const fetchBannedUsers = useCallback(async () => {
    setLoadingBanned(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetchWithTimeout('/api/admin/data?type=banned', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        const bannedData = result.data.banned || result.data.data || result.data;
        setBannedUsers(Array.isArray(bannedData) ? bannedData as BannedUser[] : []);
      } else {
        setBannedUsers([]);
      }
    } catch {
      setBannedUsers([]);
    } finally {
      setLoadingBanned(false);
    }
  }, [fetchWithTimeout, getAuthToken]);

  useEffect(() => {
    fetchAllData();
    fetchBannedUsers();
  }, [fetchAllData, fetchBannedUsers]);

  // ─── Note: Visibility change handler removed ───
  // Realtime subscriptions now handle instant state updates automatically.
  // No need to refresh all data when returning to the tab.
  // Fallback polling below catches any missed events if Realtime disconnects.

  // ─── Fallback polling for admin dashboard ───
  // Poll every 60s as a fallback for Realtime disconnections.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAllData(true); // silent background refresh
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // ─── Realtime subscriptions for instant state updates ───
  useEffect(() => {
    // Subscribe to subjects table for instant create/update/delete
    const subjectsChannel = supabase
      .channel('admin-subjects-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'subjects' },
        (payload) => {
          const newRecord = payload.new as Subject | null;
          if (!newRecord) return;
          setAllSubjects(prev => {
            const exists = prev.some(s => s.id === newRecord.id);
            if (exists) return prev;
            return [newRecord, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'subjects' },
        (payload) => {
          const newRecord = payload.new as Subject | null;
          if (!newRecord) return;
          setAllSubjects(prev => prev.map(s =>
            s.id === newRecord.id ? newRecord : s
          ));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'subjects' },
        (payload) => {
          const oldRecord = payload.old as { id: string } | null;
          if (!oldRecord) return;
          setAllSubjects(prev => prev.filter(s => s.id !== oldRecord.id));
        }
      )
      .subscribe();

    // Subscribe to users table for instant user changes
    const usersChannel = supabase
      .channel('admin-users-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'users' },
        () => { fetchAllData(true); } // Full refetch for users (need batch API for profiles)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        () => { fetchAllData(true); }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'users' },
        () => { fetchAllData(true); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subjectsChannel);
      supabase.removeChannel(usersChannel);
    };
  }, [fetchAllData]);

  // ─── Loading timeout safety net ───
  // If loading takes too long (slow session hydration on mobile/PWA),
  // stop showing infinite loading spinner and show content with available data.
  useEffect(() => {
    if (!loadingData) return;
    const timeout = setTimeout(() => {
      console.warn('[AdminDashboard] Loading timeout (15s) — showing available data');
      setLoadingData(false);
    }, 15000);
    return () => clearTimeout(timeout);
  }, [loadingData]);

  // Update total submissions from scores
  useEffect(() => {
    setTotalSubmissions(allScores.length);
  }, [allScores]);

  // -------------------------------------------------------
  // Section change handler
  // -------------------------------------------------------
  const handleSectionChange = (section: string) => {
    setActiveSection(section as AdminSection);
    storeSetAdminSection(section as AdminSection);
    // Fetch section-specific data
    if (section === 'banned' || section === 'users') fetchBannedUsers();
    if (section === 'announcements') fetchAnnouncements();
    if (section === 'reports') fetchUsageStats(usagePeriod);
    if (section === 'comments') fetchFlaggedComments();
  };

  // -------------------------------------------------------
  // Fetch usage statistics (reports section)
  // -------------------------------------------------------
  const fetchUsageStats = useCallback(async (period: 'day' | 'month' | 'year') => {
    setLoadingUsageStats(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetchWithTimeout(`/api/admin/usage-stats?period=${period}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        setUsageStats(result.data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingUsageStats(false);
    }
  }, [fetchWithTimeout, getAuthToken]);

  // Refetch usage stats when period changes (only if reports section is active)
  useEffect(() => {
    if (activeSection === 'reports') {
      fetchUsageStats(usagePeriod);
    }
  }, [usagePeriod, activeSection, fetchUsageStats]);

  // -------------------------------------------------------
  // Computed values
  // -------------------------------------------------------
  const studentCount = allUsers.filter((u) => u.role === 'student').length;
  const teacherCount = allUsers.filter((u) => u.role === 'teacher').length;
  const adminCount = allUsers.filter((u) => u.role === 'admin').length;
  const superadminCount = allUsers.filter((u) => u.role === 'superadmin').length;

  const avgPlatformScore = allScores.length > 0
    ? Math.round(allScores.reduce((sum, s) => sum + scorePercentage(s.score, s.total), 0) / allScores.length)
    : 0;

  const filteredUsers = allUsers
    .filter((u) => {
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      const matchesSearch =
        u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase());
      return matchesRole && matchesSearch;
    })
    .sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return userSortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

  // ─── Subject filter options ───
  const LEVEL_OPTIONS = [
    { value: 'الفرقة الأولى', label: 'الفرقة الأولى' },
    { value: 'الفرقة الثانية', label: 'الفرقة الثانية' },
    { value: 'الفرقة الثالثة', label: 'الفرقة الثالثة' },
    { value: 'الفرقة الرابعة', label: 'الفرقة الرابعة' },
    { value: 'الفرقة الخامسة', label: 'الفرقة الخامسة' },
  ];

  const SUB_LEVEL_OPTIONS = [
    { value: 'المستوى الأول', label: 'المستوى الأول' },
    { value: 'المستوى الثاني', label: 'المستوى الثاني' },
  ];

  const mapSubLevel = (val: string | undefined): string | undefined => {
    if (!val) return val;
    if (val === 'مستوى أول') return 'المستوى الأول';
    if (val === 'مستوى ثاني') return 'المستوى الثاني';
    return val;
  };

  const filteredSubjects = allSubjects.filter((s) => {
    const matchesSearch = !subjectSearch ||
      s.name.toLowerCase().includes(subjectSearch.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(subjectSearch.toLowerCase());
    const matchesLevel = !subjectLevelFilter || s.level === subjectLevelFilter;
    const effectiveMatchesSubLevel = !subjectSubLevelFilter || mapSubLevel(s.sub_level) === subjectSubLevelFilter;
    return matchesSearch && matchesLevel && effectiveMatchesSubLevel;
  });

  // User growth per month (for reports section)
  const userGrowthByMonth = (() => {
    const monthMap: Record<string, number> = {};
    allUsers.forEach((u) => {
      const date = new Date(u.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = (monthMap[key] || 0) + 1;
    });
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, count]) => ({
        month,
        count,
        label: new Date(month + '-01').toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' }),
      }));
  })();

  // -------------------------------------------------------
  // Delete user (with confirmation)
  // -------------------------------------------------------
  const handleDeleteUser = async (userId: string) => {
    setDeletingUserId(userId);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('auth.mustLogin'));
        return;
      }
      const res = await fetchWithTimeout('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      }, 20000);
      let result;
      try {
        result = await res.json();
      } catch {
        throw new Error(res.ok ? t('common.unexpectedError') : `خطأ في الخادم (${res.status})`);
      }
      if (result.success) {
        toast.success(t('admin.userDeleted'));
        setUserDetailOpen(false);
        setConfirmDeleteUser(null);
        fetchAllData(true);
      } else {
        toast.error(result.error || t('common.unexpectedError'));
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    } finally {
      setDeletingUserId(null);
    }
  };

  // -------------------------------------------------------
  // Delete subject (with confirmation)
  // -------------------------------------------------------
  const handleDeleteSubject = async (subjectId: string) => {
    setDeletingSubjectId(subjectId);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('auth.mustLogin'));
        return;
      }
      const res = await fetchWithTimeout('/api/admin/delete-subject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ subjectId }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(t('course.subjectDeleted'));
        setSubjectDetailOpen(false);
        setConfirmDeleteSubject(null);
        fetchAllData(true);
      } else {
        toast.error(result.error || t('common.unexpectedError'));
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    } finally {
      setDeletingSubjectId(null);
    }
  };


  const handleUnbanUser = async (email: string, banId?: string) => {
    setUnbanningEmail(email);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('auth.mustLogin'));
        return;
      }
      const res = await fetchWithTimeout('/api/admin/unban-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ email, banId }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(t('admin.userUnbanned'));
        fetchBannedUsers();
      } else {
        toast.error(result.error || t('common.unexpectedError'));
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    } finally {
      setUnbanningEmail(null);
    }
  };

  // -------------------------------------------------------
  // Ban user handler
  // -------------------------------------------------------
  const handleBanUser = async () => {
    if (!selectedUser && !banningUserId) return;

    const targetUserId = selectedUser?.id || banningUserId;
    if (!targetUserId) return;

    // Calculate ban_until based on duration
    let banUntil: string | null = null;
    if (banDuration === '1day') {
      banUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    } else if (banDuration === '1week') {
      banUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (banDuration === '1month') {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      banUntil = d.toISOString();
    } else if (banDuration === 'custom' && banCustomDate) {
      banUntil = new Date(banCustomDate).toISOString();
    }
    // permanent -> banUntil stays null

    setBanningUserId(targetUserId);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('auth.mustLogin'));
        return;
      }
      const res = await fetchWithTimeout('/api/admin/ban-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          userId: targetUserId,
          reason: banReason.trim() || undefined,
          banUntil,
          bannedBy: profile.id,
        }),
      }, 20000);
      let result;
      try {
        result = await res.json();
      } catch {
        throw new Error(res.ok ? t('common.unexpectedError') : `خطأ في الخادم (${res.status})`);
      }
      if (result.success) {
        toast.success(banUntil ? 'تم حظر المستخدم مؤقتاً' : 'تم حظر المستخدم نهائياً');
        setBanDialogOpen(false);
        setBanReason('');
        setBanDuration('permanent');
        setBanCustomDate('');
        setUserDetailOpen(false);
        fetchBannedUsers();
        fetchAllData(true);
      } else {
        toast.error(result.error || 'حدث خطأ أثناء حظر المستخدم');
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    } finally {
      setBanningUserId(null);
    }
  };

  // -------------------------------------------------------
  // Fetch announcements
  // -------------------------------------------------------
  const fetchAnnouncements = useCallback(async () => {
    setLoadingAnnouncements(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetchWithTimeout('/api/admin/announcements', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        setAnnouncements(result.data as Announcement[]);
      }
    } catch {
      // ignore
    } finally {
      setLoadingAnnouncements(false);
    }
  }, [fetchWithTimeout, getAuthToken]);

  const handleCreateAnnouncement = async () => {
    if (!newAnnTitle.trim() || !newAnnContent.trim()) {
      toast.error('يرجى إدخال العنوان والمحتوى');
      return;
    }
    setCreatingAnnouncement(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error(t('auth.mustLogin'));
        return;
      }
      const res = await fetchWithTimeout('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          title: newAnnTitle.trim(),
          content: newAnnContent.trim(),
          priority: newAnnPriority,
          created_by: profile.id,
        }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success('تم إنشاء الإعلان بنجاح');
        setCreateAnnouncementOpen(false);
        setNewAnnTitle('');
        setNewAnnContent('');
        setNewAnnPriority('normal');
        fetchAnnouncements();
      } else {
        toast.error(result.error || 'حدث خطأ أثناء إنشاء الإعلان');
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    } finally {
      setCreatingAnnouncement(false);
    }
  };

  const handleToggleAnnouncement = async (id: string, isActive: boolean) => {
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error('لا يوجد جلسة نشطة');
        return;
      }
      const res = await fetchWithTimeout('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id, is_active: !isActive }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(isActive ? 'تم إيقاف الإعلان' : 'تم تفعيل الإعلان');
        fetchAnnouncements();
      } else {
        toast.error(result.error || 'حدث خطأ');
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    setDeletingAnnouncementId(id);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error('لا يوجد جلسة نشطة');
        return;
      }
      const res = await fetchWithTimeout('/api/admin/announcements', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success('تم حذف الإعلان');
        fetchAnnouncements();
      } else {
        toast.error(result.error || 'حدث خطأ أثناء حذف الإعلان');
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes('مهلة') ? error.message : t('common.unexpectedError');
      toast.error(message);
    } finally {
      setDeletingAnnouncementId(null);
    }
  };

  // -------------------------------------------------------
  // View subject detail
  // -------------------------------------------------------
  const handleViewSubject = async (subject: Subject) => {
    setSelectedSubject(subject);
    setSubjectDetailOpen(true);
    setLoadingSubjectDetail(true);

    try {
      const token = await getAuthToken();
      if (!token) {
        setSubjectTeacher(null);
        setSubjectStudents([]);
        return;
      }
      const res = await fetchWithTimeout(`/api/admin/subject-detail?subjectId=${subject.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success && result.data) {
        setSubjectTeacher((result.data.teacher as UserProfile) || null);
        setSubjectStudents((result.data.students as UserProfile[]) || []);
      } else {
        setSubjectTeacher(null);
        setSubjectStudents([]);
      }
    } catch {
      setSubjectTeacher(null);
      setSubjectStudents([]);
    } finally {
      setLoadingSubjectDetail(false);
    }
  };

  // -------------------------------------------------------
  // Excel export (reports section)
  // -------------------------------------------------------
  const handleExportReport = async () => {
    try {
      const XLSX = await import('xlsx');
      toast.info('جاري تحضير التقرير...');
      const wb = XLSX.utils.book_new();

      // Sheet 1: Platform overview
      const overviewData = [
        { 'المؤشر': 'إجمالي المستخدمين', 'القيمة': allUsers.length },
        { 'المؤشر': 'الطلاب', 'القيمة': studentCount },
        { 'المؤشر': 'المعلمون', 'القيمة': teacherCount },
        { 'المؤشر': 'المشرفون', 'القيمة': adminCount },
        { 'المؤشر': 'مديرو المنصة', 'القيمة': superadminCount },
        { 'المؤشر': 'المقررات الدراسية', 'القيمة': allSubjects.length },
        { 'المؤشر': 'الاختبارات', 'القيمة': totalQuizzes },
        { 'المؤشر': 'التسليمات', 'القيمة': totalSubmissions },
        { 'المؤشر': 'متوسط الدرجات', 'القيمة': `${avgPlatformScore}%` },
      ];
      const ws1 = XLSX.utils.json_to_sheet(overviewData);
      XLSX.utils.book_append_sheet(wb, ws1, 'نظرة عامة');

      // Sheet 2: All users
      const usersData = allUsers.map((u) => ({
        'الاسم': u.name,
        'البريد الإلكتروني': u.email,
        'الدور': getRoleLabel(u.role, t),
        'تاريخ التسجيل': formatDate(u.created_at),
      }));
      const ws2 = XLSX.utils.json_to_sheet(usersData);
      XLSX.utils.book_append_sheet(wb, ws2, t('nav.users'));

      // Sheet 3: All subjects
      const subjectsData = allSubjects.map((s) => {
        const teacher = allUsers.find((u) => u.id === s.teacher_id);
        return {
          'اسم المقرر': s.name,
          'الوصف': s.description || '—',
          'المعلم': teacher?.name || 'غير معروف',
          'تاريخ الإنشاء': formatDate(s.created_at),
        };
      });
      const ws3 = XLSX.utils.json_to_sheet(subjectsData);
      XLSX.utils.book_append_sheet(wb, ws3, t('nav.subjects'));

      // Sheet 4: Score performance
      if (allScores.length > 0) {
        const scoresData = allScores.map((s) => ({
          'عنوان الاختبار': s.quiz_title,
          'الدرجة': `${s.score}/${s.total}`,
          'النسبة': `${scorePercentage(s.score, s.total)}%`,
          'تاريخ الإنجاز': formatDate(s.completed_at),
        }));
        const ws4 = XLSX.utils.json_to_sheet(scoresData);
        XLSX.utils.book_append_sheet(wb, ws4, 'النتائج');
      }

      XLSX.writeFile(wb, `تقرير_المنصة_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('تم تصدير التقرير بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تصدير التقرير');
    }
  };

  // -------------------------------------------------------
  // Settings handlers
  // -------------------------------------------------------
  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    return authUpdateProfile(updates);
  };

  const handleDeleteAccount = async () => {
    // Get the current session token for authorization
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('لا يوجد جلسة نشطة');
    }

    // Call the server-side API to delete the account from the database
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشل في حذف الحساب');
    }

    // Sign out after successful deletion
    await authSignOut();
  };

  // -------------------------------------------------------
  // Render: Loading
  // -------------------------------------------------------
  const renderLoading = () => (
    <div className="flex items-center justify-center py-32">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        <span className="text-sm text-muted-foreground">جاري تحميل البيانات...</span>
      </div>
    </div>
  );

  // -------------------------------------------------------
  // Render: Dashboard Section
  // -------------------------------------------------------
  const renderDashboard = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h2 className="text-2xl font-bold text-foreground">
          {profile.role === 'superadmin' ? 'لوحة تحكم مدير المنصة' : 'لوحة تحكم المشرف'}
        </h2>
        <p className="text-muted-foreground mt-1">مرحباً بك في لوحة إدارة منصة أتيندو</p>
      </motion.div>

      {/* Stats row */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="إجمالي المستخدمين"
          value={allUsers.length}
          color="sky"
        />
        <StatCard
          icon={<GraduationCap className="h-5 w-5" />}
          label="المعلمون"
          value={teacherCount}
          color="teal"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="الطلاب"
          value={studentCount}
          color="amber"
        />
        <StatCard
          icon={<Video className="h-5 w-5" />}
          label="الفيديوهات"
          value={totalVideos}
          color="violet"
        />
        <div onClick={() => setActiveSection('banned')} className="cursor-pointer">
          <StatCard
            icon={<Ban className="h-5 w-5" />}
            label="المحظورون"
            value={bannedUsers.filter(b => b.is_active !== false && (!b.ban_until || new Date(b.ban_until) > new Date())).length}
            color="rose"
          />
        </div>
      </motion.div>

      {/* Two columns: 2/3 + 1/3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent users table (2/3) */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <UserCircle className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                أحدث المستخدمين
              </h3>
              <button
                onClick={() => setActiveSection('users')}
                className="text-xs text-sky-700 dark:text-sky-300 hover:text-sky-800 dark:hover:text-sky-200 font-medium flex items-center gap-1"
              >
                عرض الكل
                <ChevronLeft className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto custom-scrollbar">
              {allUsers.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  لا يوجد مستخدمون بعد
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr className="text-xs text-muted-foreground">
                        <th className="text-right font-medium p-3">الاسم</th>
                        <th className="text-right font-medium p-3 hidden sm:table-cell">البريد الإلكتروني</th>
                        <th className="text-right font-medium p-3">الدور</th>
                        <th className="text-right font-medium p-3 hidden md:table-cell">تاريخ التسجيل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allUsers.slice(0, 8).map((user) => (
                        <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3">
                            <UserLink
                              userId={user.id}
                              name={user.name}
                              avatarUrl={user.avatar_url}
                              role={user.role}
                              gender={user.gender}
                              titleId={user.title_id}
                              size="xs"
                              showAvatar={true}
                              showRole={false}
                              showUsername={false}
                            />
                          </td>
                          <td className="p-3 hidden sm:table-cell">
                            <span className="text-sm text-muted-foreground truncate max-w-[180px] block">{user.email}</span>
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold border ${getRoleBadgeClass(user.role)}`}>
                              {getRoleLabel(user.role, t)}
                            </span>
                          </td>
                          <td className="p-3 hidden md:table-cell">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(user.created_at)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Platform stats summary (1/3) */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                إحصائيات المنصة
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {/* Total quizzes */}
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                  <ClipboardList className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">إجمالي الاختبارات</p>
                  <p className="text-sm font-bold text-foreground">{totalQuizzes}</p>
                </div>
              </div>

              {/* Total submissions */}
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                  <Award className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">إجمالي التسليمات</p>
                  <p className="text-sm font-bold text-foreground">{totalSubmissions}</p>
                </div>
              </div>

              {/* Active subjects */}
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50">
                  <BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">المقررات النشطة</p>
                  <p className="text-sm font-bold text-foreground">{allSubjects.length}</p>
                </div>
              </div>

              {/* Average score */}
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
                  <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">متوسط الدرجات</p>
                  <p className="text-sm font-bold text-foreground">{avgPlatformScore}%</p>
                </div>
              </div>

              {/* User distribution */}
              <div className="pt-2 border-t">
                <p className="text-sm font-medium text-foreground mb-3">توزيع المستخدمين</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-blue-500" />
                    <span className="text-sm text-muted-foreground flex-1">الطلاب</span>
                    <span className="text-sm font-bold text-foreground">{studentCount}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-sky-600" />
                    <span className="text-sm text-muted-foreground flex-1">المعلمون</span>
                    <span className="text-sm font-bold text-foreground">{teacherCount}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-sky-600" />
                    <span className="text-sm text-muted-foreground flex-1">المشرفون</span>
                    <span className="text-sm font-bold text-foreground">{adminCount}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-amber-500" />
                    <span className="text-sm text-muted-foreground flex-1">مدير المنصة</span>
                    <span className="text-sm font-bold text-foreground">{superadminCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Users Section
  // -------------------------------------------------------
  // Check if user is self (admin/supervisor viewing themselves)
  const isSelf = (userId: string) => userId === profile.id;

  const renderUsers = () => {
    // Pagination
    const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
    const paginatedUsers = filteredUsers.slice((userPage - 1) * usersPerPage, userPage * usersPerPage);

    return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">المستخدمون</h2>
          <p className="text-muted-foreground mt-1">إدارة جميع المستخدمين على المنصة</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{filteredUsers.length} مستخدم</span>
          </div>
          {/* Sort toggle */}
          <button
            onClick={() => { setUserSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest'); setUserPage(1); }}
            className="flex items-center gap-1.5 rounded-lg border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            title={userSortOrder === 'newest' ? 'ترتيب: الأحدث أولاً' : 'ترتيب: الأقدم أولاً'}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {userSortOrder === 'newest' ? 'الأحدث' : 'الأقدم'}
          </button>
        </div>
      </motion.div>

      {/* Search and filter */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={userSearch}
            onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
            placeholder="بحث بالاسم أو البريد الإلكتروني..."
            className="w-full rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir="rtl"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'student', 'teacher', 'admin', 'superadmin'] as const).map((role) => (
            <button
              key={role}
              onClick={() => { setRoleFilter(role); setUserPage(1); }}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all whitespace-nowrap ${
                roleFilter === role
                  ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {role === 'all' ? 'الكل' : getRoleLabel(role, t)}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Pagination top */}
      {totalPages > 1 && (
        <motion.div variants={itemVariants} className="flex items-center justify-center gap-1.5">
          <button
            onClick={() => setUserPage(p => Math.max(1, p - 1))}
            disabled={userPage === 1}
            className="flex items-center justify-center h-8 w-8 rounded-lg border text-xs font-medium hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - userPage) <= 1)
            .reduce<(number | string)[]>((acc, p, idx, arr) => {
              if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
              acc.push(p);
              return acc;
            }, [])
            .map((item, idx) =>
              typeof item === 'string' ? (
                <span key={`ellipsis-${idx}`} className="flex items-center justify-center h-8 w-8 text-xs text-muted-foreground">...</span>
              ) : (
                <button
                  key={item}
                  onClick={() => setUserPage(item)}
                  className={`flex items-center justify-center h-8 w-8 rounded-lg border text-xs font-medium transition-colors ${
                    userPage === item
                      ? 'bg-sky-700 text-white border-sky-700'
                      : 'hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  {item}
                </button>
              )
            )}
          <button
            onClick={() => setUserPage(p => Math.min(totalPages, p + 1))}
            disabled={userPage === totalPages}
            className="flex items-center justify-center h-8 w-8 rounded-lg border text-xs font-medium hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </motion.div>
      )}

      {/* Users display - Cards only */}
      {filteredUsers.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 bg-sky-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <Users className="h-8 w-8 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">
            {userSearch || roleFilter !== 'all' ? 'لا توجد نتائج للبحث' : 'لا يوجد مستخدمون'}
          </p>
          <p className="text-sm text-muted-foreground">
            {userSearch || roleFilter !== 'all' ? 'جرّب البحث بكلمات مختلفة' : 'سيظهر المستخدمون هنا بعد تسجيلهم'}
          </p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedUsers.map((user) => (
            <motion.div key={user.id} variants={itemVariants} {...cardHover}>
              <div
                className={`group relative rounded-xl border-2 bg-card shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden ${getRoleCardClass(user.role)}`}
                onClick={() => {
                  setSelectedUser(user);
                  setUserDetailOpen(true);
                  if (bannedUsers.length === 0) fetchBannedUsers();
                }}
              >
                {/* Accent top bar */}
                <div className={`h-1 w-full ${getRoleAccentClass(user.role)}`} />
                <div className="p-3 sm:p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <UserAvatar name={user.name} avatarUrl={user.avatar_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">
                        {formatNameWithTitle(user.name, user.role, user.gender, user.title_id)}
                      </span>
                      <span className="text-xs text-muted-foreground truncate block mt-0.5">{user.email}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold border ${getRoleBadgeClass(user.role)}`}>
                        {getRoleLabel(user.role, t)}
                      </span>
                      {bannedUsers.some(b => b.email === user.email && b.is_active !== false && (!b.ban_until || new Date(b.ban_until) > new Date())) && (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold border bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800">
                          محظور
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground flex items-center gap-1" title={formatDateTime(user.created_at)}>
                      <Clock className="h-3 w-3" />
                      {formatDateTime(user.created_at)}
                    </span>
                  </div>

                  {/* Stats row */}
                  {(user.role === 'teacher' || user.role === 'student') && (
                    <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                      {user.role === 'teacher' && (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/30 rounded-md px-1.5 py-0.5">
                            <BookOpen className="h-3 w-3" />
                            {user.subjectCount ?? 0} مقرر
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/30 rounded-md px-1.5 py-0.5">
                            <Users className="h-3 w-3" />
                            {user.studentCount ?? 0} طالب
                          </span>
                        </>
                      )}
                      {user.role === 'student' && (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/30 rounded-md px-1.5 py-0.5">
                            <BookOpen className="h-3 w-3" />
                            {user.subjectCount ?? 0} مقرر
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30 rounded-md px-1.5 py-0.5">
                            <GraduationCap className="h-3 w-3" />
                            {user.teacherCount ?? 0} معلم
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* User detail modal */}
      <AnimatePresence>
        {userDetailOpen && selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!deletingUserId) setUserDetailOpen(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-3">
                  <UserAvatar name={selectedUser.name} avatarUrl={selectedUser.avatar_url} size="lg" />
                  <div>
                    <span className="text-base font-semibold text-foreground block">
                      {formatNameWithTitle(selectedUser.name, selectedUser.role, selectedUser.gender, selectedUser.title_id)}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold border ${getRoleBadgeClass(selectedUser.role)}`}>
                      {getRoleLabel(selectedUser.role, t)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setUserDetailOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground">{selectedUser.email}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      وقت التسجيل: {formatDateTime(selectedUser.created_at)}
                    </span>
                  </div>
                  {selectedUser.role === 'teacher' && selectedUser.teacher_code && (
                    <div className="flex items-center gap-3">
                      <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground">
                        كود المعلم: <span className="font-mono font-bold text-foreground">{selectedUser.teacher_code}</span>
                      </span>
                    </div>
                  )}
                </div>

                {/* Stats for teacher */}
                {selectedUser.role === 'teacher' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 p-3 text-center">
                        <p className="text-lg font-bold text-teal-700 dark:text-teal-300">{selectedUser.subjectCount ?? 0}</p>
                        <p className="text-xs text-teal-600 dark:text-teal-400">مقرر دراسي</p>
                      </div>
                      <div className="rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 p-3 text-center">
                        <p className="text-lg font-bold text-teal-700 dark:text-teal-300">{selectedUser.studentCount ?? 0}</p>
                        <p className="text-xs text-teal-600 dark:text-teal-400">طالب مسجل</p>
                      </div>
                    </div>
                    {/* Supervisor links management */}
                    <SupervisorLinksManager teacherId={selectedUser.id} teacherName={selectedUser.name} />
                  </div>
                )}

                {/* Stats for student */}
                {selectedUser.role === 'student' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 p-3 text-center">
                      <p className="text-lg font-bold text-sky-800 dark:text-sky-200">{selectedUser.teacherCount ?? 0}</p>
                      <p className="text-xs text-sky-700 dark:text-sky-300">معلم مربوط</p>
                    </div>
                    <div className="rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 p-3 text-center">
                      <p className="text-lg font-bold text-teal-700 dark:text-teal-300">{selectedUser.subjectCount ?? 0}</p>
                      <p className="text-xs text-teal-600 dark:text-teal-400">مقرر دراسي</p>
                    </div>
                  </div>
                )}

                {/* Role change section - not for self */}
                {!isSelf(selectedUser.id) && (
                  <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                      <span className="text-sm font-semibold text-sky-700 dark:text-sky-300">تغيير الدور</span>
                    </div>
                    <p className="text-xs text-sky-700 dark:text-sky-300 mb-3">
                      تغيير دور المستخدم في المنصة
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {(['student', 'teacher', 'admin', 'superadmin'] as const)
                        .filter((role) => {
                          if (profile.role === 'superadmin') return true;
                          if (profile.role === 'admin') return role !== 'superadmin' && role !== 'admin';
                          return false;
                        })
                        .map((role) => (
                          <button
                            key={role}
                            onClick={() => handleChangeRole(selectedUser.id, role)}
                            disabled={changingRole || selectedUser.role === role}
                            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                              selectedUser.role === role
                                ? 'bg-sky-700 text-white cursor-default'
                                : 'border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50 disabled:opacity-50'
                            }`}
                          >
                            {changingRole ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {getRoleLabel(role, t)}
                          </button>
                        ))}
                    </div>
                    {profile.role !== 'superadmin' && (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        مدير المنصة فقط يمكنه تعيين أدوار المشرف ومدير المنصة
                      </p>
                    )}
                  </div>
                )}

                {/* Danger zone - not for self and not for superadmins */}
                {!isSelf(selectedUser.id) && selectedUser.role !== 'superadmin' && (() => {
                  const userBan = bannedUsers.find(b => b.email === selectedUser.email && b.is_active !== false);
                  const isBanExpired = userBan?.ban_until ? new Date(userBan.ban_until) <= new Date() : false;
                  const isUserBanned = !!userBan && !isBanExpired;
                  return (
                  <div className={`rounded-lg border p-4 mt-4 ${isUserBanned ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30' : 'border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/30'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {isUserBanned ? (
                        <Gavel className="h-4 w-4 text-amber-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-rose-500" />
                      )}
                      <span className={`text-sm font-semibold ${isUserBanned ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {isUserBanned ? 'المستخدم محظور' : 'منطقة الخطر'}
                      </span>
                    </div>

                    {isUserBanned && userBan && (
                      <div className="rounded-lg bg-amber-100/60 dark:bg-amber-900/50 border border-amber-200 dark:border-amber-800 p-3 mb-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                            userBan.ban_until
                              ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          }`}>
                            {userBan.ban_until ? 'حظر مؤقت' : 'حظر نهائي'}
                          </span>
                        </div>
                        {userBan.reason && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">السبب: {userBan.reason}</p>
                        )}
                        {userBan.ban_until && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">ينتهي في: {formatDate(userBan.ban_until)}</p>
                        )}
                        {userBan.banned_by_name && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">بواسطة: {userBan.banned_by_name}</p>
                        )}
                      </div>
                    )}

                    {!isUserBanned && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">
                        حذف المستخدم سيؤدي إلى إزالة جميع بياناته نهائياً.
                      </p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      {isUserBanned ? (
                        <button
                          onClick={() => handleUnbanUser(selectedUser.email, userBan?.id)}
                          disabled={unbanningEmail === selectedUser.email}
                          className="flex items-center gap-2 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 transition-colors disabled:opacity-60"
                        >
                          {unbanningEmail === selectedUser.email ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Unlock className="h-3.5 w-3.5" />
                          )}
                          إلغاء الحظر
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setBanDialogOpen(true);
                            setBanReason('');
                            setBanDuration('permanent');
                            setBanCustomDate('');
                          }}
                          disabled={banningUserId === selectedUser.id}
                          className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-60"
                        >
                          {banningUserId === selectedUser.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Gavel className="h-3.5 w-3.5" />
                          )}
                          حظر المستخدم
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteUser(selectedUser.id)}
                        disabled={deletingUserId === selectedUser.id}
                        className="flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
                      >
                        {deletingUserId === selectedUser.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        حذف المستخدم
                      </button>
                    </div>
                  </div>
                  );
                })()}

                {/* Self-action notice */}
                {isSelf(selectedUser.id) && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-4">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">لا يمكنك اتخاذ إجراءات بحق حسابك</span>
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      لا يمكنك تغيير صفتك أو حظر أو حذف حسابك الخاص.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ban user dialog */}
      <AnimatePresence>
        {banDialogOpen && selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => { if (!banningUserId) setBanDialogOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
                    <Gavel className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">حظر المستخدم</h3>
                    <p className="text-xs text-muted-foreground">{selectedUser.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setBanDialogOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Reason */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">سبب الحظر</label>
                  <textarea
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                    placeholder="أدخل سبب الحظر (اختياري)..."
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-colors resize-none"
                    rows={3}
                    dir="rtl"
                  />
                </div>

                {/* Duration */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">مدة الحظر</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'permanent' as const, label: 'حظر نهائي', icon: <Ban className="h-3.5 w-3.5" /> },
                      { value: '1day' as const, label: 'يوم واحد', icon: <Clock className="h-3.5 w-3.5" /> },
                      { value: '1week' as const, label: 'أسبوع', icon: <Clock className="h-3.5 w-3.5" /> },
                      { value: '1month' as const, label: 'شهر', icon: <Clock className="h-3.5 w-3.5" /> },
                    ]).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setBanDuration(opt.value)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all ${
                          banDuration === opt.value
                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Custom date option */}
                  <button
                    onClick={() => setBanDuration('custom')}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all mt-2 w-full ${
                      banDuration === 'custom'
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    تاريخ مخصص
                  </button>
                  {banDuration === 'custom' && (
                    <input
                      type="datetime-local"
                      value={banCustomDate}
                      onChange={(e) => setBanCustomDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-colors"
                    />
                  )}
                </div>

                {/* Warning */}
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {banDuration === 'permanent'
                      ? '⚠️ الحظر النهائي سيمنع المستخدم من الوصول لجميع الميزات نهائياً ما لم يتم إلغاء الحظر يدوياً.'
                      : '⚠️ الحظر المؤقت سيمنع المستخدم من الوصول للمقررات والمحادثات والإشعارات حتى انتهاء المدة المحددة.'
                    }
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={handleBanUser}
                    disabled={!!banningUserId || (banDuration === 'custom' && !banCustomDate)}
                    className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-60 flex-1 justify-center"
                  >
                    {banningUserId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Gavel className="h-4 w-4" />
                    )}
                    تأكيد الحظر
                  </button>
                  <button
                    onClick={() => setBanDialogOpen(false)}
                    className="rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Subjects Section
  // -------------------------------------------------------
  const renderSubjects = () => {
    const hasSubjectFilters = subjectSearch || subjectLevelFilter || subjectSubLevelFilter;

    return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">المقررات الدراسية</h2>
          <p className="text-muted-foreground mt-1">جميع المقررات على المنصة</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          <span>{filteredSubjects.length} مقرر{hasSubjectFilters ? ` من ${allSubjects.length}` : ''}</span>
        </div>
      </motion.div>

      {/* Search and filter bar */}
      {allSubjects.length > 0 && (
        <motion.div variants={itemVariants} className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                placeholder="بحث باسم المقرر أو الوصف..."
                className="w-full rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors"
                dir="rtl"
              />
            </div>
            {/* Level filter */}
            <div className="relative">
              <GraduationCap className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <select
                value={subjectLevelFilter}
                onChange={(e) => setSubjectLevelFilter(e.target.value)}
                className="w-full sm:w-auto appearance-none rounded-lg border bg-background pr-10 pl-8 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors cursor-pointer"
                dir="rtl"
              >
                <option value="">كل الفرقات</option>
                {LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {/* Sub-level filter */}
            <div className="relative">
              <Calendar className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <select
                value={subjectSubLevelFilter}
                onChange={(e) => setSubjectSubLevelFilter(e.target.value)}
                className="w-full sm:w-auto appearance-none rounded-lg border bg-background pr-10 pl-8 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors cursor-pointer"
                dir="rtl"
              >
                <option value="">كل المستويات</option>
                {SUB_LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Active filters indicator + clear button */}
          {hasSubjectFilters && (
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">فلاتر نشطة:</span>
              {subjectSearch && (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 px-2.5 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">
                  بحث: {subjectSearch}
                  <button onClick={() => setSubjectSearch('')} className="hover:text-teal-900">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {subjectLevelFilter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 px-2.5 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">
                  {subjectLevelFilter}
                  <button onClick={() => setSubjectLevelFilter('')} className="hover:text-teal-900">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {subjectSubLevelFilter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 px-2.5 py-0.5 text-xs font-medium text-teal-700 dark:text-teal-300">
                  {subjectSubLevelFilter}
                  <button onClick={() => setSubjectSubLevelFilter('')} className="hover:text-teal-900">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <button
                onClick={() => { setSubjectSearch(''); setSubjectLevelFilter(''); setSubjectSubLevelFilter(''); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
              >
                مسح الكل
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Subjects grid */}
      {allSubjects.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-teal-300 bg-teal-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50 mb-4">
            <BookOpen className="h-8 w-8 text-teal-600 dark:text-teal-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد مقررات بعد</p>
          <p className="text-sm text-muted-foreground">سيظهر المقررات هنا بعد إنشائها من قبل المعلمين</p>
        </motion.div>
      ) : filteredSubjects.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-teal-300 bg-teal-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50 mb-4">
            <Search className="h-8 w-8 text-teal-600 dark:text-teal-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد نتائج</p>
          <p className="text-sm text-muted-foreground">جرّب البحث بكلمات مختلفة أو تغيير الفلاتر</p>
          <button
            onClick={() => { setSubjectSearch(''); setSubjectLevelFilter(''); setSubjectSubLevelFilter(''); }}
            className="mt-3 text-sm text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium underline"
          >
            مسح الفلاتر
          </button>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSubjects.map((subject) => {
            const teacher = allUsers.find((u) => u.id === subject.teacher_id);
            return (
              <motion.div
                key={subject.id}
                variants={itemVariants}
                {...cardHover}
              >
                <div className="group rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-110"
                      style={{ backgroundColor: subject.color ? `${subject.color}20` : '#f0f9ff', color: subject.color || '#0369a1' }}
                    >
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{subject.name}</h3>
                      {subject.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{subject.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Teacher info */}
                  <div className="flex items-center gap-2 mb-3">
                    {teacher ? (
                      <UserLink
                        userId={teacher.id}
                        name={teacher.name}
                        avatarUrl={teacher.avatar_url}
                        role="teacher"
                        gender={teacher.gender}
                        titleId={teacher.title_id}
                        size="xs"
                        showAvatar={true}
                        showUsername={false}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">معلم غير معروف</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(subject.created_at)}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewSubject(subject)}
                        className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300 hover:text-sky-800 dark:hover:text-sky-200 font-medium"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        عرض
                      </button>
                      {confirmDeleteSubject === subject.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDeleteSubject(subject.id)}
                            disabled={deletingSubjectId === subject.id}
                            className="flex items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                          >
                            {deletingSubjectId === subject.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'تأكيد'
                            )}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteSubject(null)}
                            className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteSubject(subject.id)}
                          className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          حذف
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Subject detail modal */}
      <AnimatePresence>
        {subjectDetailOpen && selectedSubject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!deletingSubjectId) setSubjectDetailOpen(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: selectedSubject.color ? `${selectedSubject.color}20` : '#f0f9ff', color: selectedSubject.color || '#0369a1' }}
                  >
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{selectedSubject.name}</h3>
                    {selectedSubject.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{selectedSubject.description}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSubjectDetailOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {loadingSubjectDetail ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-sky-700 dark:text-sky-300" />
                  </div>
                ) : (
                  <>
                    {/* Teacher info */}
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">المعلم</p>
                      {subjectTeacher ? (
                        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                          <UserAvatar name={subjectTeacher.name} avatarUrl={subjectTeacher.avatar_url} size="sm" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{subjectTeacher.name}</p>
                            <p className="text-xs text-muted-foreground">{subjectTeacher.email}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">لم يتم العثور على بيانات المعلم</p>
                      )}
                    </div>

                    {/* Enrolled students */}
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">
                        الطلاب المسجلون ({subjectStudents.length})
                      </p>
                      {subjectStudents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">لا يوجد طلاب مسجلون في هذا المقرر</p>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                          {subjectStudents.map((student) => (
                            <div key={student.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                              <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="xs" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(student.name, student.role, student.title_id, student.gender)}</p>
                                <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Danger zone */}
                    <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/30 p-4 mt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-rose-500" />
                        <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">منطقة الخطر</span>
                      </div>
                      <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">
                        حذف المقرر سيؤدي إلى إزالة جميع البيانات المرتبطة به نهائياً.
                      </p>
                      <button
                        onClick={() => handleDeleteSubject(selectedSubject.id)}
                        disabled={deletingSubjectId === selectedSubject.id}
                        className="flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
                      >
                        {deletingSubjectId === selectedSubject.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        حذف المقرر
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Banned Users Section
  // -------------------------------------------------------
  // -------------------------------------------------------
  // Fetch flagged comments
  // -------------------------------------------------------
  const fetchFlaggedComments = useCallback(async () => {
    setFlaggedLoading(true);
    try {
      const { data, error } = await supabase
        .from('video_comments')
        .select('*, video:subject_videos(id, title)')
        .eq('is_flagged', true)
        .order('flagged_at', { ascending: false });

      if (error) {
        console.error('Error fetching flagged comments:', error);
      } else {
        // Enrich with user names
        const comments = (data || []) as any[];
        if (comments.length > 0) {
          const userIds = [...new Set(comments.map((c: any) => c.user_id))];
          const { data: users } = await supabase
            .from('users')
            .select('id, name, title_id, gender, role')
            .in('id', userIds);

          const userMap = new Map<string, any>();
          if (users) {
            for (const u of users as any[]) {
              userMap.set(u.id, u);
            }
          }

          const enriched = comments.map((c: any) => {
            const user = userMap.get(c.user_id);
            return {
              ...c,
              user_name: user ? formatNameWithTitle(user.name, user.role, user.title_id, user.gender) : 'مستخدم',
            };
          });
          setFlaggedComments(enriched);
        } else {
          setFlaggedComments([]);
        }
      }
    } catch (err) {
      console.error('Fetch flagged comments error:', err);
    } finally {
      setFlaggedLoading(false);
    }
  }, []);

  // -------------------------------------------------------
  // Unflag a comment
  // -------------------------------------------------------
  const handleUnflagComment = async (commentId: string) => {
    try {
      const { error } = await supabase
        .from('video_comments')
        .update({ is_flagged: false, flagged_at: null, flagged_by: null })
        .eq('id', commentId);

      if (error) {
        toast.error('فشل إلغاء البلاغ');
      } else {
        toast.success('تم إلغاء البلاغ');
        setFlaggedComments((prev) => prev.filter((c: any) => c.id !== commentId));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  // -------------------------------------------------------
  // Delete a flagged comment (admin)
  // -------------------------------------------------------
  const handleDeleteFlaggedComment = async (commentId: string) => {
    try {
      const { error } = await supabase
        .from('video_comments')
        .delete()
        .eq('id', commentId);

      if (error) {
        toast.error('فشل حذف التعليق');
      } else {
        toast.success('تم حذف التعليق');
        setFlaggedComments((prev) => prev.filter((c: any) => c.id !== commentId));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  // -------------------------------------------------------
  // Render: Comment Moderation Section
  // -------------------------------------------------------
  const renderCommentModeration = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Flag className="h-5 w-5 text-amber-600" />
            رقابة التعليقات
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            التعليقات المبلّغة التي تحتاج مراجعة
          </p>
        </div>
        <button
          onClick={fetchFlaggedComments}
          disabled={flaggedLoading}
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-60"
        >
          <Loader2 className={`h-3.5 w-3.5 ${flaggedLoading ? 'animate-spin' : 'hidden'}`} />
          تحديث
        </button>
      </motion.div>

      {/* Load flagged comments on first visit */}
      {/* This effect runs when the section becomes active */}

      {flaggedLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : flaggedComments.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 mb-4">
            <MessageSquare className="h-8 w-8 text-amber-600 dark:text-amber-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد تعليقات مبلّغة</p>
          <p className="text-sm text-muted-foreground">جميع التعليقات متوافقة مع السياسة</p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3">
            <Flag className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
              {flaggedComments.length} تعليق مبلّغ يحتاج مراجعة
            </p>
          </div>

          {flaggedComments.map((comment: any) => (
            <motion.div
              key={comment.id}
              variants={itemVariants}
              className="rounded-xl border bg-card shadow-sm overflow-hidden"
            >
              <div className="p-4 space-y-3">
                {/* Comment header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{comment.user_name || 'مستخدم'}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(comment.created_at).toLocaleDateString('ar-SA')}
                      </span>
                      <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-medium flex items-center gap-1">
                        <Flag className="h-2.5 w-2.5" />
                        مبلّغ
                      </span>
                    </div>
                    {/* Video reference */}
                    {comment.video && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Video className="h-3 w-3" />
                        {comment.video.title}
                      </p>
                    )}
                  </div>
                </div>

                {/* Comment content */}
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">{comment.content}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleUnflagComment(comment.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30 transition-colors"
                  >
                    <Unlock className="h-3.5 w-3.5" />
                    إلغاء البلاغ
                  </button>
                  <button
                    onClick={() => handleDeleteFlaggedComment(comment.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-800 px-3 py-1.5 text-sm font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    حذف التعليق
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );

  const renderBannedUsers = () => {
    // Helper: determine if a ban is expired
    const isBanExpired = (ban: BannedUser) => {
      if (!ban.ban_until) return false; // permanent
      return new Date(ban.ban_until) <= new Date();
    };

    // Helper: format remaining time
    const formatRemaining = (banUntil: string) => {
      const remaining = new Date(banUntil).getTime() - Date.now();
      if (remaining <= 0) return 'منتهي';
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      if (days > 0) return `${days} يوم و ${hours} ساعة`;
      return `${hours} ساعة`;
    };

    // Filter tabs
    const activeBans = bannedUsers.filter((b) => b.is_active && !isBanExpired(b));
    const expiredBans = bannedUsers.filter((b) => !b.is_active || isBanExpired(b));

    return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">المستخدمون المحظورون</h2>
          <p className="text-muted-foreground mt-1">إدارة الحظر المؤقت والنهائي للمستخدمين</p>
        </div>
        <button
          onClick={fetchBannedUsers}
          className="flex items-center gap-2 rounded-lg border border-sky-200 dark:border-sky-800 px-3 py-2 text-xs font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-colors"
        >
          <Loader2 className={`h-3.5 w-3.5 ${loadingBanned ? 'animate-spin' : 'hidden'}`} />
          تحديث
        </button>
      </motion.div>

      {/* Stats summary */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-rose-700 dark:text-rose-300">{activeBans.length}</p>
          <p className="text-xs text-muted-foreground">حظر نشط</p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{activeBans.filter((b) => b.ban_until).length}</p>
          <p className="text-xs text-muted-foreground">حظر مؤقت</p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{activeBans.filter((b) => !b.ban_until).length}</p>
          <p className="text-xs text-muted-foreground">حظر نهائي</p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-muted-foreground">{expiredBans.length}</p>
          <p className="text-xs text-muted-foreground">منتهي الصلاحية</p>
        </div>
      </motion.div>

      {bannedUsers.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-rose-300 bg-rose-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/50 mb-4">
            <Ban className="h-8 w-8 text-rose-600 dark:text-rose-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا يوجد مستخدمون محظورون</p>
          <p className="text-sm text-muted-foreground">سيظهر المستخدمون المحظورون هنا عند حظر مستخدم</p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bannedUsers.map((banned) => {
            const expired = isBanExpired(banned);
            const isActive = banned.is_active && !expired;
            const isPermanent = !banned.ban_until;

            return (
              <motion.div key={banned.id} variants={itemVariants} {...cardHover}>
                <div className={`group rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow ${!isActive ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      isActive
                        ? isPermanent
                          ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                          : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                        : 'bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400'
                    }`}>
                      {isPermanent ? <Ban className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate text-sm">
                        {banned.user_name || banned.email}
                      </h3>
                      <p className="text-xs text-muted-foreground truncate">{banned.email}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(banned.banned_at)}
                      </p>
                    </div>
                  </div>

                  {/* Ban status badge */}
                  <div className="mb-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                      isActive
                        ? isPermanent
                          ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                        : 'bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                    }`}>
                      {isActive
                        ? isPermanent
                          ? 'حظر نهائي'
                          : `مؤقت - متبقي ${formatRemaining(banned.ban_until!)}`
                        : 'منتهي الصلاحية'
                      }
                    </span>
                  </div>

                  {/* Ban end date for temporary bans */}
                  {isActive && banned.ban_until && (
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      ينتهي في: {formatDate(banned.ban_until)}
                    </p>
                  )}

                  {banned.reason && (
                    <p className="text-xs text-muted-foreground mb-2 bg-muted/30 rounded-lg p-2 break-words">
                      {banned.reason}
                    </p>
                  )}

                  {banned.banned_by_name && (
                    <p className="text-xs text-muted-foreground mb-2">
                      حظر بواسطة: {banned.banned_by_name}
                    </p>
                  )}

                  <div className="flex items-center justify-end pt-2 border-t gap-2">
                    {isActive ? (
                      <button
                        onClick={() => handleUnbanUser(banned.email, banned.id)}
                        disabled={unbanningEmail === banned.email}
                        className="flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 transition-colors disabled:opacity-60"
                      >
                        {unbanningEmail === banned.email ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5" />
                        )}
                        إلغاء الحظر
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">تم إلغاء الحظر</span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Announcements Section
  // -------------------------------------------------------
  const renderAnnouncements = () => {
    const priorityLabel = (p: string) => {
      switch (p) {
        case 'urgent': return 'عاجل';
        case 'high': return 'مهم';
        case 'normal': return 'عادي';
        case 'low': return 'منخفض';
        default: return p;
      }
    };
    const priorityClass = (p: string) => {
      switch (p) {
        case 'urgent': return 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
        case 'high': return 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
        case 'normal': return 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800';
        case 'low': return 'bg-gray-100 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700';
        default: return 'bg-gray-100 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700';
      }
    };

    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
        {/* Header */}
        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">الإعلانات</h2>
            <p className="text-muted-foreground mt-1">إنشاء وإدارة إعلانات المنصة</p>
          </div>
          <button
            onClick={() => setCreateAnnouncementOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
          >
            <Plus className="h-4 w-4" />
            إعلان جديد
          </button>
        </motion.div>

        {announcements.length === 0 ? (
          <motion.div
            variants={itemVariants}
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 bg-sky-50/30 py-16"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
              <Megaphone className="h-8 w-8 text-sky-700 dark:text-sky-300" />
            </div>
            <p className="text-lg font-semibold text-foreground mb-1">لا توجد إعلانات</p>
            <p className="text-sm text-muted-foreground mb-4">ابدأ بإنشاء إعلان جديد للمستخدمين</p>
            <button
              onClick={() => setCreateAnnouncementOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-800"
            >
              <Plus className="h-4 w-4" />
              إنشاء إعلان
            </button>
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} className="space-y-4">
            {announcements.map((ann) => (
              <motion.div key={ann.id} variants={itemVariants}>
                <div className={`group rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow ${!ann.is_active ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50 transition-transform group-hover:scale-110">
                      <Megaphone className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground truncate">{ann.title}</h3>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold border ${priorityClass(ann.priority)}`}>
                          {priorityLabel(ann.priority)}
                        </span>
                        {!ann.is_active && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-bold border bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700">
                            متوقف
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 break-words">{ann.content}</p>
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(ann.created_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    <button
                      onClick={() => handleToggleAnnouncement(ann.id, ann.is_active)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-950/30"
                    >
                      {ann.is_active ? (
                        <>
                          <ToggleRight className="h-3.5 w-3.5" />
                          إيقاف
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="h-3.5 w-3.5" />
                          تفعيل
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteAnnouncement(ann.id)}
                      disabled={deletingAnnouncementId === ann.id}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
                    >
                      {deletingAnnouncementId === ann.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      حذف
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Create announcement modal */}
        <AnimatePresence>
          {createAnnouncementOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: 'none' as const }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
              onClick={() => { if (!creatingAnnouncement) setCreateAnnouncementOpen(false); }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border bg-background shadow-xl"
                dir="rtl"
              >
                <div className="flex items-center justify-between border-b p-5">
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                    إعلان جديد
                  </h3>
                  <button
                    onClick={() => { if (!creatingAnnouncement) setCreateAnnouncementOpen(false); }}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">العنوان</label>
                    <input
                      type="text"
                      value={newAnnTitle}
                      onChange={(e) => setNewAnnTitle(e.target.value)}
                      placeholder="عنوان الإعلان..."
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                      disabled={creatingAnnouncement}
                      dir="rtl"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">المحتوى</label>
                    <textarea
                      value={newAnnContent}
                      onChange={(e) => setNewAnnContent(e.target.value)}
                      placeholder="محتوى الإعلان..."
                      rows={4}
                      className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors resize-none"
                      disabled={creatingAnnouncement}
                      dir="rtl"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">الأولوية</label>
                    <div className="flex gap-2">
                      {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setNewAnnPriority(p)}
                          disabled={creatingAnnouncement}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                            newAnnPriority === p
                              ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                              : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          {priorityLabel(p)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleCreateAnnouncement}
                    disabled={creatingAnnouncement || !newAnnTitle.trim() || !newAnnContent.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-800 transition-colors disabled:opacity-60"
                  >
                    {creatingAnnouncement ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    إنشاء الإعلان
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Period label helper (reports section)
  // -------------------------------------------------------
  const getPeriodLabel = (p: 'day' | 'month' | 'year') => {
    switch (p) {
      case 'day': return 'اليوم';
      case 'month': return 'الشهر';
      case 'year': return 'السنة';
    }
  };

  const renderReports = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">التقارير</h2>
          <p className="text-muted-foreground mt-1">تقارير وإحصائيات المنصة</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportReport}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 whitespace-nowrap"
          >
            <Download className="h-4 w-4" />
            تصدير التقرير
          </button>
        </div>
      </motion.div>

      {/* ─── Stats Cards Row ─── */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Active Lectures */}
        <motion.div {...cardHover}>
          <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-l from-sky-500 to-sky-700" />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/50">
                <Radio className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  المحاضرات النشطة
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-600" />
                  </span>
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {loadingUsageStats ? <Loader2 className="h-5 w-5 animate-spin text-sky-700 dark:text-sky-300 inline" /> : (usageStats?.activeLectures ?? 0)}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Active Users */}
        <motion.div {...cardHover}>
          <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-l from-teal-400 to-teal-600" />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/50">
                <Activity className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">المستخدمون النشطون ({getPeriodLabel(usagePeriod)})</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {loadingUsageStats ? <Loader2 className="h-5 w-5 animate-spin text-teal-600 dark:text-teal-400 inline" /> : (usageStats?.activeUsers ?? 0)}
                  </p>
                  {usageStats && usageStats.changes && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${usageStats.changes.activeUsers >= 0 ? 'text-sky-700 dark:text-sky-300' : 'text-rose-600 dark:text-rose-400'}`}>
                      {usageStats.changes.activeUsers >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(usageStats.changes.activeUsers)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* New Registrations */}
        <motion.div {...cardHover}>
          <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-l from-amber-400 to-amber-600" />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/50">
                <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">التسجيلات الجديدة ({getPeriodLabel(usagePeriod)})</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {loadingUsageStats ? <Loader2 className="h-5 w-5 animate-spin text-amber-600 dark:text-amber-400 inline" /> : (usageStats?.newRegistrations ?? 0)}
                  </p>
                  {usageStats && usageStats.changes && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${usageStats.changes.newRegistrations >= 0 ? 'text-sky-700 dark:text-sky-300' : 'text-rose-600 dark:text-rose-400'}`}>
                      {usageStats.changes.newRegistrations >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(usageStats.changes.newRegistrations)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Attendance Sessions */}
        <motion.div {...cardHover}>
          <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-l from-sky-400 to-sky-700" />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/50">
                <ClipboardList className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">جلسات الحضور ({getPeriodLabel(usagePeriod)})</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {loadingUsageStats ? <Loader2 className="h-5 w-5 animate-spin text-sky-700 dark:text-sky-300 inline" /> : (usageStats?.attendanceSessions ?? 0)}
                  </p>
                  {usageStats && usageStats.changes && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${usageStats.changes.attendanceSessions >= 0 ? 'text-sky-700 dark:text-sky-300' : 'text-rose-600 dark:text-rose-400'}`}>
                      {usageStats.changes.attendanceSessions >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(usageStats.changes.attendanceSessions)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Quizzes Taken */}
        <motion.div {...cardHover}>
          <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-l from-rose-400 to-rose-600" />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/50">
                <Award className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">الاختبارات المكتملة ({getPeriodLabel(usagePeriod)})</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {loadingUsageStats ? <Loader2 className="h-5 w-5 animate-spin text-rose-600 dark:text-rose-400 inline" /> : (usageStats?.quizzesTaken ?? 0)}
                  </p>
                  {usageStats && usageStats.changes && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${usageStats.changes.quizzesTaken >= 0 ? 'text-sky-700 dark:text-sky-300' : 'text-rose-600 dark:text-rose-400'}`}>
                      {usageStats.changes.quizzesTaken >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(usageStats.changes.quizzesTaken)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Lectures Created */}
        <motion.div {...cardHover}>
          <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-l from-sky-400 to-sky-600" />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/50">
                <ClipboardList className="h-5 w-5 text-sky-600 dark:text-sky-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">محاضرات جديدة ({getPeriodLabel(usagePeriod)})</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {loadingUsageStats ? <Loader2 className="h-5 w-5 animate-spin text-sky-600 dark:text-sky-400 inline" /> : (usageStats?.lecturesCreated ?? 0)}
                  </p>
                  {usageStats && usageStats.changes && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${usageStats.changes.lecturesCreated >= 0 ? 'text-sky-700 dark:text-sky-300' : 'text-rose-600 dark:text-rose-400'}`}>
                      {usageStats.changes.lecturesCreated >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(usageStats.changes.lecturesCreated)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Assignments Created */}
        <motion.div {...cardHover}>
          <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-l from-orange-400 to-orange-600" />
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                <ClipboardList className="h-5 w-5 text-orange-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">تكليفات جديدة ({getPeriodLabel(usagePeriod)})</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {loadingUsageStats ? <Loader2 className="h-5 w-5 animate-spin text-orange-600 inline" /> : (usageStats?.assignmentsCreated ?? 0)}
                  </p>
                  {usageStats && usageStats.changes && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${usageStats.changes.assignmentsCreated >= 0 ? 'text-sky-700 dark:text-sky-300' : 'text-rose-600 dark:text-rose-400'}`}>
                      {usageStats.changes.assignmentsCreated >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(usageStats.changes.assignmentsCreated)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* ─── Period Filter ─── */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground ms-1">الفترة الزمنية:</span>
          {(['day', 'month', 'year'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setUsagePeriod(p)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                usagePeriod === p
                  ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 shadow-sm'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {getPeriodLabel(p)}
            </button>
          ))}
        </div>
      </motion.div>

      {/* ─── Charts Section ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Activity Bar Chart */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-300" />
              النشاط اليومي
              <span className="text-xs font-normal text-muted-foreground ms-1">آخر 30 يوم</span>
            </h3>
            {usageStats && usageStats.chartData && usageStats.chartData.some((d) => d.users > 0 || d.sessions > 0 || d.quizzes > 0) ? (
              <div className="h-72 min-h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={usageStats.chartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      tickLine={false}
                      tickFormatter={(val: string) => {
                        const d = new Date(val);
                        return `${d.getDate()}/${d.getMonth() + 1}`;
                      }}
                      interval={4}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        fontSize: '12px',
                        direction: 'rtl',
                      }}
                      labelFormatter={(val: unknown) => {
                        const d = new Date(String(val));
                        return d.toLocaleDateString('ar-SA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
                      }}
                    />
                    <Bar dataKey="users" name="تسجيلات جديدة" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="sessions" name="جلسات حضور" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="quizzes" name="اختبارات" fill="#0284c7" radius={[2, 2, 0, 0]} />
                    <Legend wrapperStyle={{ fontSize: '12px', direction: 'rtl' }} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <BarChart3 className="h-10 w-10 opacity-30" />
                  <span>لا توجد بيانات نشاط بعد</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Registration Trends Line Chart */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              اتجاه التسجيلات
              <span className="text-xs font-normal text-muted-foreground ms-1">آخر 12 شهر</span>
            </h3>
            {usageStats && usageStats.registrationTrends && usageStats.registrationTrends.some((d) => d.count > 0) ? (
              <div className="h-72 min-h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={usageStats.registrationTrends} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: '#6b7280' }}
                      tickLine={false}
                      interval={1}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6b7280' }}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        fontSize: '12px',
                        direction: 'rtl',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name="عدد التسجيلات"
                      stroke="#14b8a6"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#14b8a6', stroke: '#fff', strokeWidth: 2 }}
                      activeDot={{ r: 6, fill: '#0d9488' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <TrendingUp className="h-10 w-10 opacity-30" />
                  <span>لا توجد بيانات تسجيلات بعد</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ─── Score Distribution + Quiz Performance ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score Distribution Pie Chart */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              توزيع الدرجات
            </h3>
            {allScores.length > 0 ? (
              <div className="h-56 sm:h-72 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(() => {
                        const excellent = allScores.filter((s) => scorePercentage(s.score, s.total) >= 90).length;
                        const veryGood = allScores.filter((s) => { const p = scorePercentage(s.score, s.total); return p >= 75 && p < 90; }).length;
                        const good = allScores.filter((s) => { const p = scorePercentage(s.score, s.total); return p >= 60 && p < 75; }).length;
                        const weak = allScores.filter((s) => scorePercentage(s.score, s.total) < 60).length;
                        return [
                          { name: 'ممتاز', value: excellent },
                          { name: 'جيد جداً', value: veryGood },
                          { name: 'جيد', value: good },
                          { name: 'ضعيف', value: weak },
                        ].filter((d) => d.value > 0);
                      })()}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }: { name?: string; percent?: number }) => `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`}
                    >
                      <Cell fill="#0284c7" />
                      <Cell fill="#14b8a6" />
                      <Cell fill="#f59e0b" />
                      <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        fontSize: '12px',
                        direction: 'rtl',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '12px', direction: 'rtl' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
                لا توجد نتائج بعد
              </div>
            )}
          </div>
        </motion.div>

        {/* Quiz performance overview */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                أداء الاختبارات
              </h3>
              <span className="text-xs text-muted-foreground">{allScores.length} نتيجة</span>
            </div>
            <div className="p-5">
              {allScores.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Award className="h-10 w-10 mb-2 opacity-40" />
                  <p className="text-sm">لا توجد نتائج اختبارات بعد</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-foreground mb-3">توزيع الدرجات</p>
                    {(() => {
                      const excellent = allScores.filter((s) => scorePercentage(s.score, s.total) >= 90).length;
                      const veryGood = allScores.filter((s) => { const p = scorePercentage(s.score, s.total); return p >= 75 && p < 90; }).length;
                      const good = allScores.filter((s) => { const p = scorePercentage(s.score, s.total); return p >= 60 && p < 75; }).length;
                      const weak = allScores.filter((s) => scorePercentage(s.score, s.total) < 60).length;
                      const total = allScores.length;
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full bg-sky-600 shrink-0" />
                            <span className="text-sm text-muted-foreground flex-1">ممتاز (90%+)</span>
                            <span className="text-sm font-bold text-foreground">{excellent}</span>
                            <span className="text-xs text-muted-foreground">({total > 0 ? Math.round((excellent / total) * 100) : 0}%)</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full bg-teal-500 shrink-0" />
                            <span className="text-sm text-muted-foreground flex-1">جيد جداً (75-89%)</span>
                            <span className="text-sm font-bold text-foreground">{veryGood}</span>
                            <span className="text-xs text-muted-foreground">({total > 0 ? Math.round((veryGood / total) * 100) : 0}%)</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full bg-amber-500 shrink-0" />
                            <span className="text-sm text-muted-foreground flex-1">جيد (60-74%)</span>
                            <span className="text-sm font-bold text-foreground">{good}</span>
                            <span className="text-xs text-muted-foreground">({total > 0 ? Math.round((good / total) * 100) : 0}%)</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full bg-rose-500 shrink-0" />
                            <span className="text-sm text-muted-foreground flex-1">ضعيف (&lt;60%)</span>
                            <span className="text-sm font-bold text-foreground">{weak}</span>
                            <span className="text-xs text-muted-foreground">({total > 0 ? Math.round((weak / total) * 100) : 0}%)</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="pt-3 border-t">
                    <p className="text-sm font-medium text-foreground mb-3">أحدث النتائج</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                      {allScores.slice(0, 6).map((score) => {
                        const pct = scorePercentage(score.score, score.total);
                        return (
                          <div key={score.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground truncate">{score.quiz_title}</p>
                              <p className="text-xs text-muted-foreground">
                                {score.score}/{score.total} · {formatDate(score.completed_at)}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${pctColorClass(pct)}`}>
                              {pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ─── Detailed Statistics Table ─── */}
      <motion.div variants={itemVariants}>
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b p-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-sky-700 dark:text-sky-300" />
              إحصائيات تفصيلية
            </h3>
            <span className="text-xs text-muted-foreground">مقارنة مع الفترة السابقة</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-right font-medium p-3">المؤشر</th>
                  <th className="text-center font-medium p-3">العدد الحالي</th>
                  <th className="text-center font-medium p-3">الفترة السابقة</th>
                  <th className="text-center font-medium p-3">التغيير</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {usageStats ? (
                  <>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50">
                            <Activity className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                          </div>
                          <span className="text-sm font-medium text-foreground">المستخدمون النشطون</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm font-bold text-foreground">{usageStats.activeUsers}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm text-muted-foreground">{usageStats.prevData?.activeUsers ?? '—'}</span>
                      </td>
                      <td className="p-3 text-center">
                        {usageStats.changes && (
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${usageStats.changes.activeUsers >= 0 ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'}`}>
                            {usageStats.changes.activeUsers >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(usageStats.changes.activeUsers)}%
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
                            <Users className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          </div>
                          <span className="text-sm font-medium text-foreground">التسجيلات الجديدة</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm font-bold text-foreground">{usageStats.newRegistrations}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm text-muted-foreground">{usageStats.prevData?.newRegistrations ?? '—'}</span>
                      </td>
                      <td className="p-3 text-center">
                        {usageStats.changes && (
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${usageStats.changes.newRegistrations >= 0 ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'}`}>
                            {usageStats.changes.newRegistrations >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(usageStats.changes.newRegistrations)}%
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                            <ClipboardList className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                          </div>
                          <span className="text-sm font-medium text-foreground">جلسات الحضور</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm font-bold text-foreground">{usageStats.attendanceSessions}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm text-muted-foreground">{usageStats.prevData?.attendanceSessions ?? '—'}</span>
                      </td>
                      <td className="p-3 text-center">
                        {usageStats.changes && (
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${usageStats.changes.attendanceSessions >= 0 ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'}`}>
                            {usageStats.changes.attendanceSessions >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(usageStats.changes.attendanceSessions)}%
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100">
                            <Award className="h-3.5 w-3.5 text-sky-700" />
                          </div>
                          <span className="text-sm font-medium text-foreground">الاختبارات المكتملة</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm font-bold text-foreground">{usageStats.quizzesTaken}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm text-muted-foreground">{usageStats.prevData?.quizzesTaken ?? '—'}</span>
                      </td>
                      <td className="p-3 text-center">
                        {usageStats.changes && (
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${usageStats.changes.quizzesTaken >= 0 ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'}`}>
                            {usageStats.changes.quizzesTaken >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(usageStats.changes.quizzesTaken)}%
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-100">
                            <Radio className="h-3.5 w-3.5 text-rose-600" />
                          </div>
                          <span className="text-sm font-medium text-foreground">المحاضرات النشطة حالياً</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-sm font-bold text-foreground flex items-center justify-center gap-1.5">
                          {usageStats.activeLectures}
                          {usageStats.activeLectures > 0 && (
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-600" />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-xs text-muted-foreground">—</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300">
                          مباشر
                        </span>
                      </td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-muted-foreground text-sm">
                      {loadingUsageStats ? (
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري تحميل الإحصائيات...
                        </div>
                      ) : (
                        'لا توجد بيانات'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* ─── Platform Overview Summary ─── */}
      <motion.div variants={itemVariants}>
        <div className="rounded-xl border bg-card shadow-sm p-5">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-300" />
            ملخص إحصائيات المنصة
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-800">
              <p className="text-2xl font-bold text-sky-800 dark:text-sky-200">{allUsers.length}</p>
              <p className="text-xs text-sky-700 dark:text-sky-300 mt-1">مستخدم</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-800">
              <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{allSubjects.length}</p>
              <p className="text-xs text-sky-700 dark:text-sky-300 mt-1">مقرر</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-100 dark:border-teal-800">
              <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{totalQuizzes}</p>
              <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">اختبار</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-800">
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{avgPlatformScore}%</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">متوسط الدرجات</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── User Distribution Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                <Shield className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">المشرفون</p>
                <p className="text-2xl font-bold text-sky-800 dark:text-sky-200">{adminCount}</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                <GraduationCap className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">المعلمون</p>
                <p className="text-2xl font-bold text-sky-800 dark:text-sky-200">{teacherCount}</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50">
                <Users className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">الطلاب</p>
                <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{studentCount}</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Main Render
  // -------------------------------------------------------
  return (
    <div className="flex min-h-screen" dir="rtl">
      {/* Header */}
      <AppHeader
        userName={profile.name}
        userId={profile.id}
        userRole={profile.role as 'student' | 'teacher' | 'admin' | 'superadmin'}
        userGender={profile.gender}
        titleId={profile.title_id}
        avatarUrl={profile.avatar_url ?? undefined}
        onSignOut={onSignOut}
        onOpenSettings={() => handleSectionChange('settings')}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        sidebarCollapsed={!sidebarOpen}
      />

      {/* Sidebar */}
      <AppSidebar
        role={profile.role as 'student' | 'teacher' | 'admin'}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        customNavItems={adminNavItemDefs.map(item => ({ ...item, label: t(item.labelKey) })).filter(item => !(item as { superadminOnly?: boolean }).superadminOnly || profile.role === 'superadmin')}
      />

      {/* Main content - dynamic offset for collapsible sidebar */}
      <main className={`flex-1 pt-14 sm:pt-16 pb-20 md:pb-0 transition-all duration-300 ${isRTL ? 'pl-0' : 'pr-0'} ${
        sidebarOpen ? (isRTL ? 'md:pr-64' : 'md:pl-64') : (isRTL ? 'md:pr-[68px]' : 'md:pl-[68px]')
      }`}>
        <div className="mx-auto max-w-6xl p-3 md:p-8">
          {loadingData ? renderLoading() : (
            <AnimatePresence mode="wait">
              {activeSection === 'dashboard' && (
                <motion.div key="dashboard" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  {renderDashboard()}
                </motion.div>
              )}
              {activeSection === 'users' && (
                <motion.div key="users" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  {renderUsers()}
                </motion.div>
              )}
              {activeSection === 'subjects' && (
                <motion.div key="subjects" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  {renderSubjects()}
                </motion.div>
              )}
              {activeSection === 'announcements' && (
                <motion.div key="announcements" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  {renderAnnouncements()}
                </motion.div>
              )}
              {activeSection === 'banned' && (
                <motion.div key="banned" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  {renderBannedUsers()}
                </motion.div>
              )}
              {activeSection === 'comments' && (
                <motion.div key="comments" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  {renderCommentModeration()}
                </motion.div>
              )}
              {activeSection === 'complaints' && (
                <motion.div key="complaints" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  <ReportsSection profile={profile} role={profile.role as 'admin' | 'superadmin'} />
                </motion.div>
              )}
              {activeSection === 'reports' && (
                <motion.div key="reports" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  {renderReports()}
                </motion.div>
              )}
              {activeSection === 'chat' && (
                <motion.div key="chat" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  <ChatSection profile={profile} role="admin" />
                </motion.div>
              )}
              {activeSection === 'settings' && (
                <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  <SettingsSection profile={profile} onUpdateProfile={handleUpdateProfile} onDeleteAccount={handleDeleteAccount} />
                </motion.div>
              )}
              {activeSection === 'institution' && (
                <motion.div key="institution" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                  <InstitutionSection profile={profile} />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        role={profile.role as 'admin' | 'superadmin'}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
    </div>
  );
}
