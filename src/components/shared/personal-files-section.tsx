'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePWALifecycle } from '@/hooks/use-pwa-lifecycle';
import {
  FileText,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  File,
  Upload,
  Trash2,
  Share2,
  Search,
  X,
  Loader2,
  Eye,
  Pencil,
  Download,
  Mail,
  UserMinus,
  Calendar,
  HardDrive,
  CheckCircle2,
  MoreVertical,
  Lock,
  Globe,
  FolderPlus,
  Info,
  CheckSquare,
  Square,
  Maximize2,
  EyeOff,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { waitForSession, getAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import type { UserProfile, UserFile, FileShare, Subject } from '@/lib/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTranslations } from '@/i18n/use-translations';
import UserAvatar, { getRoleLabel, getTitleLabel, formatNameWithTitle } from '@/components/shared/user-avatar';
import { useAppStore } from '@/stores/app-store';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface PersonalFilesSectionProps {
  profile: UserProfile;
  role: 'student' | 'teacher';
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

// -------------------------------------------------------
// File type categories
// -------------------------------------------------------
type FileCategory = 'all' | 'images' | 'documents' | 'videos' | 'audio' | 'other';

const FILE_CATEGORIES: FileCategory[] = ['all', 'images', 'documents', 'videos', 'audio', 'other'];

function getFileCategory(fileType: string): FileCategory {
  const lower = fileType.toLowerCase();
  if (
    lower.includes('image') ||
    lower.includes('png') ||
    lower.includes('jpg') ||
    lower.includes('jpeg') ||
    lower.includes('gif') ||
    lower.includes('svg') ||
    lower.includes('webp')
  ) {
    return 'images';
  }
  if (
    lower.includes('pdf') ||
    lower.includes('word') ||
    lower.includes('document') ||
    lower.includes('doc') ||
    lower.includes('text') ||
    lower.includes('spreadsheet') ||
    lower.includes('excel') ||
    lower.includes('presentation') ||
    lower.includes('powerpoint') ||
    lower.includes('sheet')
  ) {
    return 'documents';
  }
  if (lower.includes('video') || lower.includes('mp4') || lower.includes('avi') || lower.includes('mov') || lower.includes('webm')) {
    return 'videos';
  }
  if (lower.includes('audio') || lower.includes('mp3') || lower.includes('wav') || lower.includes('ogg') || lower.includes('mpeg')) {
    return 'audio';
  }
  return 'other';
}

// -------------------------------------------------------
// File icon helper
// -------------------------------------------------------
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
    return <FileText className="h-5 w-5 text-rose-500 dark:text-rose-400" />;
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
    return <ImageIcon className="h-5 w-5 text-sky-600 dark:text-sky-400 dark:text-sky-400" />;
  }
  if (lower.includes('video') || lower.includes('mp4') || lower.includes('avi') || lower.includes('mov')) {
    return <FileVideo className="h-5 w-5 text-sky-600 dark:text-sky-400 dark:text-sky-400" />;
  }
  if (lower.includes('audio') || lower.includes('mp3') || lower.includes('wav') || lower.includes('ogg')) {
    return <FileAudio className="h-5 w-5 text-amber-500 dark:text-amber-400" />;
  }
  return <File className="h-5 w-5 text-muted-foreground" />;
}

// -------------------------------------------------------
// File size helper: bytes → KB / MB / GB
// -------------------------------------------------------
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// -------------------------------------------------------
// Date helper (Arabic locale)
// -------------------------------------------------------
function formatDate(dateStr: string, locale: string = 'ar'): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// -------------------------------------------------------
// Get file extension from name
// -------------------------------------------------------
function getFileExtension(fileName: string): string {
  if (!fileName.includes('.')) return '';
  return fileName.split('.').pop()?.toLowerCase() || '';
}

// -------------------------------------------------------
// Shared file with user info
// -------------------------------------------------------
interface SharedFileRecipient {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  title_id: string | null;
  gender: string | null;
  permission: string;
}

interface SharedFileWithInfo extends UserFile {
  shared_by_user?: UserProfile;
  shared_at?: string;
  permission?: 'view' | 'edit' | 'download';
  other_recipients?: SharedFileRecipient[];
  total_recipients_count?: number;
}

// -------------------------------------------------------
// Pending upload item
// -------------------------------------------------------
interface PendingUpload {
  id: string;
  file: File;
  fileData: ArrayBuffer | null; // Pre-read data (critical for mobile PWA where File objects can become invalid)
  fileName: string; // Store file name separately in case File object is invalidated
  fileType: string; // Store MIME type separately
  fileSize: number; // Store file size separately
  customName: string;
  extension: string;
  progress: number; // -1 = failed, 0-100 = progress
  uploading: boolean;
  done: boolean;
  error?: string; // Error message for failed/blocked uploads
  errorCode?: 'duplicate_name' | 'size' | 'other'; // Categorized error code
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function PersonalFilesSection({ profile, role }: PersonalFilesSectionProps) {
  const { t, direction, locale } = useTranslations();
  const { openProfile } = useAppStore();
  const isMobile = useIsMobile();

  // Category label mapping for i18n
  const categoryLabels: Record<FileCategory, string> = {
    all: t('files.categoryAll'),
    images: t('files.categoryImages'),
    documents: t('files.categoryDocuments'),
    videos: t('files.categoryVideos'),
    audio: t('files.categoryAudio'),
    other: t('files.categoryOther'),
  };

  // ─── Tab state ───
  const [activeTab, setActiveTab] = useState<'my-files' | 'shared'>('my-files');
  const [categoryFilter, setCategoryFilter] = useState<FileCategory>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');

  // ─── My files state ───
  const [files, setFiles] = useState<UserFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  // ─── Shared files state ───
  const [sharedWithMe, setSharedWithMe] = useState<SharedFileWithInfo[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);

  // ─── Upload state ───
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const pendingUploadsRef = useRef<PendingUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  // ─── PWA Lifecycle protection ───
  // Prevents page reload while upload modal is open and files are being uploaded
  usePWALifecycle({
    stateKey: `personal-files-${profile.id}`,
    isBusy: uploadModalOpen || pendingUploads.some(p => p.uploading),
    onSave: undefined,
    onRestore: undefined,
  });

  // ─── Course assignment state ───
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [selectedSubjectForUploadIds, setSelectedSubjectForUploadIds] = useState<Set<string>>(new Set());

  // ─── Delete state ───
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ─── Rename state ───
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // ─── Details modal state ───
  const [detailsFile, setDetailsFile] = useState<UserFile | null>(null);
  const [detailsFileCourses, setDetailsFileCourses] = useState<{name: string; assignedAt: string; visibility: string}[]>([]);
  const [detailsFileShares, setDetailsFileShares] = useState<(FileShare & { shared_with_user?: UserProfile })[]>([]);

  // ─── Share modal state ───
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharingFileId, setSharingFileId] = useState<string | null>(null);
  const [shareSearchQuery, setShareSearchQuery] = useState('');
  const [shareSearchResults, setShareSearchResults] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [selectedShareUsers, setSelectedShareUsers] = useState<UserProfile[]>([]);
  const [selectedPermission, setSelectedPermission] = useState<'view' | 'edit' | 'download'>('view');
  const [sharingUsers, setSharingUsers] = useState(false);

  // ─── Already shared with users ───
  const [fileShares, setFileShares] = useState<(FileShare & { shared_with_user?: UserProfile })[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [removingShareId, setRemovingShareId] = useState<string | null>(null);

  // ─── Assign to course modal ───
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assigningFileId, setAssigningFileId] = useState<string | null>(null);
  const [assignSubjectIds, setAssignSubjectIds] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [assignSubjects, setAssignSubjects] = useState<Subject[]>([]);
  const [bulkAssignMode, setBulkAssignMode] = useState(false);

  // ─── Share by email state ───
  const [shareByEmail, setShareByEmail] = useState('');
  const [shareByEmailPermission, setShareByEmailPermission] = useState<'view' | 'edit' | 'download'>('view');
  const [shareByEmailLoading, setShareByEmailLoading] = useState(false);

  // ─── Bulk share by email state ───
  const [bulkShareByEmail, setBulkShareByEmail] = useState('');
  const [bulkShareByEmailPermission, setBulkShareByEmailPermission] = useState<'view' | 'edit' | 'download'>('view');
  const [bulkShareByEmailLoading, setBulkShareByEmailLoading] = useState(false);

  // ─── Bulk share modal state ───
  const [bulkShareModalOpen, setBulkShareModalOpen] = useState(false);
  const [bulkShareSearchQuery, setBulkShareSearchQuery] = useState('');
  const [bulkShareSearchResults, setBulkShareSearchResults] = useState<UserProfile[]>([]);
  const [bulkShareSearching, setBulkShareSearching] = useState(false);
  const [bulkShareSelectedUsers, setBulkShareSelectedUsers] = useState<UserProfile[]>([]);
  const [bulkSharePermission, setBulkSharePermission] = useState<'view' | 'edit' | 'download'>('view');
  const [bulkShareLoading, setBulkShareLoading] = useState(false);

  // ─── Multi-select state ───
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // ─── File metadata (share & course counts) ───
  const [fileShareCounts, setFileShareCounts] = useState<Record<string, number>>({});
  const [fileCourseCounts, setFileCourseCounts] = useState<Record<string, number>>({});

  // ─── Preview modal state ───
  const [previewFile, setPreviewFile] = useState<(UserFile & { other_recipients?: SharedFileRecipient[]; shared_by_user?: UserProfile }) | null>(null);

  // ─── Shared file recipients modal ───
  const [showRecipientsFile, setShowRecipientsFile] = useState<SharedFileWithInfo | null>(null);

  // -------------------------------------------------------
  // Fetch my files
  // -------------------------------------------------------
  const fetchFiles = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingFiles(true);
    try {
      const { data, error } = await supabase
        .from('user_files')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching files:', error);
      } else {
        setFiles((data as UserFile[]) || []);
      }
    } catch (err) {
      console.error('Fetch files error:', err);
    } finally {
      setLoadingFiles(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Fetch shared with me files
  // -------------------------------------------------------
  const fetchSharedFiles = useCallback(async () => {
    setLoadingShared(true);
    try {
      // Get auth token — use waitForSession for mobile PWA where session hydration can be slow
      const headers = await getAuthHeaders(15000, { userId: profile.id });

      const res = await fetch('/api/files/shared-with-me', { headers });

      if (!res.ok) {
        console.error('Fetch shared files failed:', res.status);
        setSharedWithMe([]);
        return;
      }

      const data = await res.json();
      if (data.shares) {
        setSharedWithMe(data.shares as SharedFileWithInfo[]);
      } else {
        setSharedWithMe([]);
      }
    } catch (err) {
      console.error('Fetch shared files error:', err);
      setSharedWithMe([]);
    } finally {
      setLoadingShared(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Fetch file shares (for share modal)
  // -------------------------------------------------------
  const fetchFileShares = useCallback(async (fileId: string) => {
    setLoadingShares(true);
    try {
      const { data, error } = await supabase
        .from('file_shares')
        .select('*')
        .eq('file_id', fileId);

      if (error) {
        console.error('Error fetching file shares:', error);
        setFileShares([]);
      } else if (data && data.length > 0) {
        const sharesWithUsers: (FileShare & { shared_with_user?: UserProfile })[] = [];
        for (const share of data) {
          const { data: userProfile } = await supabase
            .from('users')
            .select('*')
            .eq('id', share.shared_with)
            .single();
          sharesWithUsers.push({
            ...share,
            shared_with_user: (userProfile as UserProfile) || undefined,
          });
        }
        setFileShares(sharesWithUsers);
      } else {
        setFileShares([]);
      }
    } catch (err) {
      console.error('Fetch file shares error:', err);
    } finally {
      setLoadingShares(false);
    }
  }, []);

  // -------------------------------------------------------
  // Fetch subjects for course assignment
  // -------------------------------------------------------
  const fetchSubjects = useCallback(async () => {
    setLoadingSubjects(true);
    try {
      if (role === 'teacher') {
        const { data, error } = await supabase
          .from('subjects')
          .select('*')
          .eq('teacher_id', profile.id)
          .order('created_at', { ascending: false });
        if (!error && data) {
          setSubjects(data as Subject[]);
        }
      } else {
        // Student: get enrolled subjects
        const { data: enrollments, error: enrollError } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id);
        if (!enrollError && enrollments && enrollments.length > 0) {
          const subjectIds = enrollments.map((e) => e.subject_id);
          const { data: subjectData, error: subjectError } = await supabase
            .from('subjects')
            .select('*')
            .in('id', subjectIds)
            .order('created_at', { ascending: false });
          if (!subjectError && subjectData) {
            setSubjects(subjectData as Subject[]);
          }
        }
      }
    } catch (err) {
      console.error('Fetch subjects error:', err);
    } finally {
      setLoadingSubjects(false);
    }
  }, [profile.id, role]);

  // -------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      await fetchFiles();
      // Also fetch shared files on mount so the count badge appears immediately
      fetchSharedFiles();
    };
    init();
  }, [fetchFiles, fetchSharedFiles]);

  // -------------------------------------------------------
  // Real-time subscription for user_files (personal files)
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`user-files-${profile.id}`)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'user_files', filter: `user_id=eq.${profile.id}` }, (payload) => {
        // Instant removal from state — no full refetch needed
        const deletedId = payload.old?.id;
        if (deletedId) {
          setFiles(prev => prev.filter(f => f.id !== deletedId));
          setSelectedFileIds(prev => { const next = new Set(prev); next.delete(deletedId); return next; });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_files', filter: `user_id=eq.${profile.id}` }, (payload) => {
        // Instant update in state
        const updated = payload.new as UserFile;
        if (updated) {
          setFiles(prev => prev.map(f => f.id === updated.id ? { ...f, ...updated } : f));
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_files', filter: `user_id=eq.${profile.id}` }, () => {
        // New file uploaded (possibly from another tab/device) — full refetch to get complete data
        fetchFiles(false);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile.id, fetchFiles]);

  // -------------------------------------------------------
  // Fetch file share & course counts (batch)
  // -------------------------------------------------------
  const fetchFileCounts = useCallback(async (fileList: UserFile[]) => {
    if (fileList.length === 0) return;
    try {
      const fileIds = fileList.map(f => f.id);

      // Fetch share counts
      const { data: sharesData } = await supabase
        .from('file_shares')
        .select('file_id')
        .in('file_id', fileIds);

      const shareCounts: Record<string, number> = {};
      if (sharesData) {
        for (const s of sharesData) {
          shareCounts[s.file_id] = (shareCounts[s.file_id] || 0) + 1;
        }
      }
      setFileShareCounts(shareCounts);

      // Fetch course assignment counts
      const { data: coursesData } = await supabase
        .from('subject_files')
        .select('user_file_id')
        .in('user_file_id', fileIds);

      const courseCounts: Record<string, number> = {};
      if (coursesData) {
        for (const c of coursesData) {
          if (c.user_file_id) {
            courseCounts[c.user_file_id] = (courseCounts[c.user_file_id] || 0) + 1;
          }
        }
      }
      setFileCourseCounts(courseCounts);
    } catch (err) {
      console.error('Fetch file counts error:', err);
    }
  }, []);

  // Fetch share/course counts when files change
  useEffect(() => {
    if (files.length > 0) {
      fetchFileCounts(files);
    } else {
      setFileShareCounts({});
      setFileCourseCounts({});
    }
  }, [files, fetchFileCounts]);

  // -------------------------------------------------------
  // Real-time subscription for file_shares (shared with me updates)
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`file-shares-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'file_shares', filter: `shared_with=eq.${profile.id}` }, () => {
        fetchSharedFiles();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'file_shares', filter: `shared_with=eq.${profile.id}` }, () => {
        fetchSharedFiles();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile.id, fetchSharedFiles]);

  // Keep pendingUploads ref in sync for reliable reads in async handlers
  useEffect(() => {
    pendingUploadsRef.current = pendingUploads;
  }, [pendingUploads]);

  useEffect(() => {
    if (activeTab === 'shared') {
      fetchSharedFiles();
    }
  }, [activeTab, fetchSharedFiles]);

  // -------------------------------------------------------
  // Filtered files by category and visibility
  // -------------------------------------------------------
  const filteredFiles = useMemo(() => {
    let result = files;
    // Filter by visibility
    if (visibilityFilter === 'public') {
      result = result.filter((f) => f.visibility === 'public');
    } else if (visibilityFilter === 'private') {
      result = result.filter((f) => f.visibility !== 'public');
    }
    // Filter by category
    if (categoryFilter !== 'all') {
      result = result.filter((f) => getFileCategory(f.file_type) === categoryFilter);
    }
    return result;
  }, [files, categoryFilter, visibilityFilter]);

  // -------------------------------------------------------
  // Open upload modal
  // -------------------------------------------------------
  const openUploadModal = () => {
    setPendingUploads([]);
    setSelectedSubjectForUploadIds(new Set());
    setUploadModalOpen(true);
    fetchSubjects();
  };

  // -------------------------------------------------------
  // Handle file selection for upload
  // -------------------------------------------------------
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const validFiles: File[] = [];
    const oversized: string[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        oversized.push(file.name);
      } else {
        validFiles.push(file);
      }
    }
    if (oversized.length > 0) {
      toast.error(t('files.toastOversizedFiles', { files: oversized.join(t('common.listSeparator')) }));
    }
    if (validFiles.length === 0) return;

    // Client-side pre-validation: check for duplicate file names (same name + same extension)
    // Same name + DIFFERENT extension is ALLOWED (e.g., "report.pdf" and "report.docx" can coexist)
    // Same name + SAME extension is BLOCKED — user must rename before uploading
    const duplicateNames: string[] = [];
    for (const file of validFiles) {
      const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
      const customName = file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name;
      const displayName = customName.trim() + originalExt;
      // Check only for EXACT name+extension match (case-insensitive)
      const isDuplicate = files.some(f => f.file_name.toLowerCase() === displayName.toLowerCase());
      const isDuplicateInPending = pendingUploads.some(p => {
        const pfDisplayName = p.customName.trim() + (p.extension ? '.' + p.extension : '');
        return pfDisplayName.toLowerCase() === displayName.toLowerCase();
      });
      if (isDuplicate || isDuplicateInPending) {
        duplicateNames.push(displayName);
      }
    }
    if (duplicateNames.length > 0) {
      toast.error(t('files.toastDuplicateNames', { files: duplicateNames.join(t('common.listSeparator')) }));
    }

    // ─── CRITICAL MOBILE FIX: Pre-read file data into ArrayBuffers ───
    // On mobile PWA, File objects can become invalid after the <input> is cleared
    // or the component re-renders. By reading the ArrayBuffer NOW, we ensure
    // the file data is captured in memory regardless of what happens to the File ref.
    // This is the SAME fix used in the summary/transcription flow.
    const newUploads: PendingUpload[] = await Promise.all(
      validFiles.map(async (file) => {
        let fileData: ArrayBuffer | null = null;
        try {
          fileData = await file.arrayBuffer();
          console.log(`[Upload] Pre-read file "${file.name}", size: ${fileData.byteLength} bytes`);
        } catch (readErr) {
          console.error(`[Upload] Failed to pre-read file "${file.name}":`, readErr);
        }
        // Check if this file has a duplicate name+extension
        const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
        const customName = file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name;
        const displayName = customName.trim() + originalExt;
        const isDuplicate = files.some(f => f.file_name.toLowerCase() === displayName.toLowerCase());
        const isDuplicateInPending = pendingUploads.some(p => {
          const pfDisplayName = p.customName.trim() + (p.extension ? '.' + p.extension : '');
          return pfDisplayName.toLowerCase() === displayName.toLowerCase();
        });
        const hasDuplicateName = isDuplicate || isDuplicateInPending;
        return {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          file,
          fileData,
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          customName,
          extension: getFileExtension(file.name),
          progress: 0,
          uploading: false,
          done: false,
          // Mark duplicate name+extension files as error — user must rename before upload
          error: hasDuplicateName ? t('files.toastDuplicateName', { name: displayName }) : undefined,
          errorCode: hasDuplicateName ? 'duplicate_name' as const : undefined,
        };
      })
    );
    setPendingUploads((prev) => [...prev, ...newUploads]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // -------------------------------------------------------
  // Remove a pending upload
  // -------------------------------------------------------
  const removePendingUpload = (id: string) => {
    setPendingUploads((prev) => prev.filter((p) => p.id !== id));
  };

  // -------------------------------------------------------
  // Update pending upload custom name
  // -------------------------------------------------------
  const updatePendingName = (id: string, name: string) => {
    setPendingUploads((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        // When user renames, check if the new name resolves the duplicate
        const newDisplayName = name.trim() + (p.extension ? '.' + p.extension : '');
        const stillDuplicate = files.some(f => f.file_name.toLowerCase() === newDisplayName.toLowerCase()) ||
          prev.some(other => other.id !== id && (other.customName.trim() + (other.extension ? '.' + other.extension : '')).toLowerCase() === newDisplayName.toLowerCase());
        if (stillDuplicate) {
          return { ...p, customName: name, error: t('files.toastDuplicateName', { name: newDisplayName }), errorCode: 'duplicate_name' as const };
        }
        // Name is now unique — clear the duplicate error
        return { ...p, customName: name, error: p.errorCode === 'duplicate_name' ? undefined : p.error, errorCode: p.errorCode === 'duplicate_name' ? undefined : p.errorCode };
      })
    );
  };

  // -------------------------------------------------------
  // Determine file type category (mirrors server-side logic)
  // -------------------------------------------------------
  const getFileTypeCategory = (mimeType: string): string => {
    const lower = mimeType.toLowerCase();
    if (lower.startsWith('image/')) return 'image';
    if (lower.startsWith('video/')) return 'video';
    if (lower.startsWith('audio/')) return 'audio';
    if (lower === 'application/pdf') return 'pdf';
    if (lower.includes('word') || lower.includes('document')) return 'document';
    if (lower.includes('sheet') || lower.includes('excel')) return 'spreadsheet';
    if (lower.includes('presentation') || lower.includes('powerpoint')) return 'presentation';
    if (lower === 'text/plain' || lower === 'text/csv') return 'text';
    if (lower.includes('zip') || lower.includes('rar') || lower.includes('compressed')) return 'archive';
    return 'other';
  };

  // -------------------------------------------------------
  // Upload all pending files
  // FIX: Pre-read file data into ArrayBuffers to avoid File object
  // invalidation on mobile PWA. Use Blobs created from ArrayBuffers
  // for all upload methods instead of raw File objects.
  // -------------------------------------------------------
  const handleUploadAll = async () => {
    // Reset failed uploads first so they can be retried (but NOT duplicate_name errors — those need rename)
    setPendingUploads((prev) =>
      prev.map((p) => (p.progress === -1 && p.errorCode !== 'duplicate_name' ? { ...p, progress: 0, uploading: false, error: undefined, errorCode: undefined } : p))
    );

    // Wait a tick for the state update to be processed (important on mobile)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Read the LATEST state from the ref (avoids stale closure on mobile)
    // Skip files with duplicate_name error — they must be renamed first
    const toUpload = pendingUploadsRef.current.filter((p) => !p.done && !p.uploading && p.errorCode !== 'duplicate_name' && !p.error);
    if (toUpload.length === 0) {
      toast.info(t('files.toastNoFilesToUpload'));
      return;
    }

    // Get auth token — use waitForSession for mobile PWA where session hydration can be slow
    const token = await waitForSession(15000);
    if (!token) {
      toast.error(t('files.toastLoginRequired'));
      return;
    }

    // Supabase Storage direct-upload configuration
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      toast.error(t('files.toastStorageConfigIncomplete'));
      return;
    }

    // Throttled progress updater
    const progressTimers = new Map<string, { lastPct: number; lastTime: number }>();
    const PROGRESS_THROTTLE_MS = 200;
    const PROGRESS_THROTTLE_PCT = 5;

    const throttledProgressUpdate = (id: string, pct: number) => {
      const now = Date.now();
      const prev = progressTimers.get(id);
      if (!prev || (now - prev.lastTime >= PROGRESS_THROTTLE_MS) || (Math.abs(pct - prev.lastPct) >= PROGRESS_THROTTLE_PCT) || pct === 100 || pct === 0) {
        progressTimers.set(id, { lastPct: pct, lastTime: now });
        setPendingUploads((prev) =>
          prev.map((p) => (p.id === id ? { ...p, progress: pct } : p))
        );
      }
    };

    // Simulated progress tracker for SDK uploads (no native progress)
    const startSimulatedProgress = (id: string, fileSize: number) => {
      const startTime = Date.now();
      const estimatedMs = Math.max(3000, (fileSize / (2 * 1024 * 1024)) * 1000);
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const ratio = Math.min(elapsed / estimatedMs, 0.85);
        const pct = Math.round(10 + ratio * 75);
        throttledProgressUpdate(id, pct);
      }, 500);
      return interval;
    };

    // Phase 1: Upload all personal files + create DB records
    const uploadedFileIds: string[] = [];

    for (let i = 0; i < toUpload.length; i++) {
      const item = toUpload[i];

      // Mark as uploading
      setPendingUploads((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, uploading: true, progress: 0 } : p))
      );
      throttledProgressUpdate(item.id, 5);

      // Yield to the event loop between uploads so the UI can update (critical on mobile)
      if (i > 0) {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        await new Promise((resolve) => setTimeout(resolve, isMobile ? 150 : 50));
      }

      try {
        // ─── CRITICAL FIX: Use pre-read ArrayBuffer data instead of File object ───
        // On mobile PWA, File objects can become invalid after the <input> is cleared.
        // We use the pre-read ArrayBuffer (item.fileData) to create a fresh Blob
        // for each upload attempt. This ensures the data is always available.
        // SAFETY: Only use pre-read properties (item.fileName, item.fileType, item.fileSize).
        // Never access item.file.name / item.file.type / item.file.size — on mobile PWA,
        // the File object can become invalidated after the native file picker closes,
        // and accessing its properties throws TypeError during render/execution.
        const fileName = item.fileName || 'unknown';
        const fileType = item.fileType || 'application/octet-stream';
        const fileSize = item.fileSize || 0;

        // Try to get ArrayBuffer: prefer pre-read data, fallback to reading File
        let arrayBuffer: ArrayBuffer;
        if (item.fileData && item.fileData.byteLength > 0) {
          arrayBuffer = item.fileData;
          console.log(`[Upload] Using pre-read data for "${fileName}", size: ${arrayBuffer.byteLength}`);
        } else {
          // Fallback: try to read from File object (might fail on mobile PWA)
          console.warn(`[Upload] No pre-read data for "${fileName}", reading from File object...`);
          try {
            arrayBuffer = await item.file.arrayBuffer();
          } catch (readErr) {
            console.error(`[Upload] File object is invalid for "${fileName}":`, readErr);
            throw new Error(t('files.toastFileReadFailed', { name: fileName }));
          }
        }

        // Create a fresh Blob from the ArrayBuffer — this is independent of the File object
        const uploadBlob = new Blob([arrayBuffer], { type: fileType });

        // Build the storage path
        const originalExt = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
        const displayName = item.customName.trim() ? item.customName.trim() + originalExt : fileName;
        const safeStorageName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const storagePath = `${profile.id}/${safeStorageName}`;
        const fileTypeCategory = getFileTypeCategory(fileType);

        let uploadSucceeded = false;

        // ── STEP 1 (PRIMARY): Server-side upload via same-origin fetch() ──
        const FILE_SIZE_LIMIT = 4 * 1024 * 1024; // 4MB
        if (fileSize <= FILE_SIZE_LIMIT) {
          try {
            throttledProgressUpdate(item.id, 15);
            const simInterval = startSimulatedProgress(item.id, fileSize);

            // Use Blob (from ArrayBuffer) instead of File object
            const uploadFormData = new FormData();
            uploadFormData.append('file', uploadBlob, fileName);
            uploadFormData.append('userId', profile.id);
            uploadFormData.append('customName', item.customName.trim());

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const res = await fetch('/api/files/upload', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
              },
              body: uploadFormData,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);
            clearInterval(simInterval);

            // FIX: Safely parse JSON — server may return HTML on error
            let result: { success: boolean; data?: Record<string, unknown>; error?: string };
            if (res.ok) {
              try { result = await res.json(); }
              catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
            } else {
              const errorText = await res.text();
              try { result = JSON.parse(errorText); }
              catch { result = { success: false, error: t('files.toastHttpError', { status: res.status }) }; }
            }

            if (result.success && result.data?.id) {
              uploadedFileIds.push(String(result.data.id));
              uploadSucceeded = true;
              console.log(`[Upload] Server-side upload succeeded for ${displayName}`);
            } else {
              console.warn(`[Upload] Server-side upload failed for ${displayName}:`, result.error, '— falling back to direct storage');
            }
          } catch (serverErr) {
            console.warn(`[Upload] Server-side upload error for ${displayName}:`, serverErr instanceof Error ? serverErr.message : serverErr, '— falling back to direct storage');
          }
        } else {
          console.log(`[Upload] File ${displayName} is ${Math.round(fileSize / 1024 / 1024)}MB, too large for server route, using direct storage`);
        }

        // ── STEP 2 (FALLBACK): Direct upload to Supabase Storage from client ──
        if (!uploadSucceeded) {
          let storageUploadSuccess = false;

          // Try XHR direct upload to Supabase Storage (real progress)
          try {
            await new Promise<void>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.timeout = 5 * 60 * 1000; // 5 min for large files on mobile

              xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                  const pct = Math.round((e.loaded / e.total) * 90);
                  throttledProgressUpdate(item.id, pct);
                }
              });

              xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve();
                } else {
                  reject(new Error(`HTTP ${xhr.status}`));
                }
              });

              xhr.addEventListener('error', () => reject(new Error('Network error')));
              xhr.addEventListener('abort', () => reject(new Error('Aborted')));
              xhr.addEventListener('timeout', () => reject(new Error(t('files.toastUploadTimeout'))));

              const storageUrl = `${supabaseUrl}/storage/v1/object/user-files/${storagePath}`;
              xhr.open('POST', storageUrl);
              xhr.setRequestHeader('Authorization', `Bearer ${token}`);
              xhr.setRequestHeader('apikey', supabaseAnonKey);
              xhr.setRequestHeader('x-upsert', 'false');

              // Use Blob (from ArrayBuffer) instead of File object
              const formData = new FormData();
              formData.append('cacheControl', '3600');
              formData.append('file', uploadBlob, fileName);
              xhr.send(formData);
            });

            storageUploadSuccess = true;
          } catch (xhrErr) {
            console.warn(`[Upload] XHR failed for ${item.customName}, trying SDK:`, xhrErr instanceof Error ? xhrErr.message : xhrErr);
          }

          // SDK fallback for storage upload
          if (!storageUploadSuccess) {
            const progressInterval = startSimulatedProgress(item.id, fileSize);
            throttledProgressUpdate(item.id, 10);

            try {
              // Use Blob (from ArrayBuffer) instead of File object for SDK upload
              const { error: uploadError } = await supabase.storage
                .from('user-files')
                .upload(storagePath, uploadBlob, {
                  cacheControl: '3600',
                  contentType: fileType,
                  upsert: false,
                });

              clearInterval(progressInterval);

              if (uploadError) {
                throw uploadError;
              }
              storageUploadSuccess = true;
            } catch (sdkErr) {
              clearInterval(progressInterval);
              console.error(`[Upload] SDK also failed for ${item.customName}:`, sdkErr);
            }
          }

          if (!storageUploadSuccess) {
            throw new Error(t('files.toastUploadFailed'));
          }

          throttledProgressUpdate(item.id, 92);

          // Create DB record via lightweight API (metadata only, no file body)
          const fileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${storagePath}`;

          const controller2 = new AbortController();
          const timeoutId2 = setTimeout(() => controller2.abort(), 30000);

          try {
            const res = await fetch('/api/files/create-record', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId: profile.id,
                fileName: displayName,
                fileType: fileTypeCategory,
                fileSize: fileSize,
                fileUrl,
                storagePath,
              }),
              signal: controller2.signal,
            });

            // FIX: Safely parse JSON — server may return HTML on error
            let result: { success: boolean; data?: Record<string, unknown>; error?: string };
            if (res.ok) {
              try { result = await res.json(); }
              catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
            } else {
              const errorText = await res.text();
              try { result = JSON.parse(errorText); }
              catch { result = { success: false, error: t('files.toastHttpError', { status: res.status }) }; }
            }
            clearTimeout(timeoutId2);

            if (result.success && result.data?.id) {
              uploadedFileIds.push(String(result.data.id));
              uploadSucceeded = true;
            } else {
              console.error('[Upload] Create record error:', result.error);
              await supabase.storage.from('user-files').remove([storagePath]);
              throw new Error(result.error || t('files.toastFileSaveFailed'));
            }
          } finally {
            clearTimeout(timeoutId2);
          }
        }

        // Mark as done
        if (uploadSucceeded) {
          setPendingUploads((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, progress: 100, done: true, uploading: false } : p))
          );
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Upload failed';
        console.error(`Upload error for ${item.customName}:`, errorMsg);
        setPendingUploads((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, progress: -1, uploading: false } : p))
        );
      }
    }

    // Phase 2: Bulk assign all uploaded files to courses (if subjects were selected)
    if (uploadedFileIds.length > 0 && selectedSubjectForUploadIds.size > 0) {
      try {
        await supabase
          .from('user_files')
          .update({ visibility: 'public', updated_at: new Date().toISOString() })
          .in('id', uploadedFileIds);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        try {
          const res = await fetch('/api/files/bulk-assign', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileIds: uploadedFileIds,
              subjectIds: Array.from(selectedSubjectForUploadIds),
              userId: profile.id,
            }),
            signal: controller.signal,
          });
          let result: { success: boolean; data?: { created: number; skipped: number }; error?: string };
          try { result = await res.json(); } catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
          if (result.success && result.data) {
            if (result.data.skipped > 0) {
              toast.info(t('files.toastFilesAssigned', { created: result.data.created, skipped: result.data.skipped }));
            }
          } else {
            console.error('Bulk assign error:', result.error);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (assignErr) {
        console.error('Bulk assign failed:', assignErr);
      }
    }

    // Check actual upload results
    setPendingUploads((current) => {
      const successful = current.filter((p) => p.done);
      const failed = current.filter((p) => p.progress === -1);
      const blocked = current.filter((p) => p.errorCode === 'duplicate_name');
      if (successful.length > 0 && failed.length === 0 && blocked.length === 0) {
        toast.success(t('files.toastUploadSuccess'));
      } else if (successful.length > 0 && failed.length > 0) {
        toast.error(t('files.toastUploadPartial', { success: successful.length, failed: failed.length }));
      } else if (failed.length > 0) {
        toast.error(t('files.toastUploadAllFailed'));
      }
      if (blocked.length > 0) {
        toast.error(t('files.toastBlockedFiles', { count: blocked.length }));
      }
      return current;
    });
    fetchFiles();
  };

  // -------------------------------------------------------
  // Delete file (also deletes linked course files via user_file_id)
  // -------------------------------------------------------
  const handleDeleteFile = async (fileId: string) => {
    setDeletingFileId(fileId);
    try {
      const fileToDelete = files.find((f) => f.id === fileId);
      if (fileToDelete) {
        // 1. Find all subject_files linked to this user_file via user_file_id
        const { data: linkedSubjectFiles } = await supabase
          .from('subject_files')
          .select('id, file_url')
          .eq('user_file_id', fileId);

        // 2. Delete storage for linked subject files
        if (linkedSubjectFiles && linkedSubjectFiles.length > 0) {
          for (const sf of linkedSubjectFiles) {
            const sfStoragePath = sf.file_url.split('/user-files/')[1];
            if (sfStoragePath) {
              await supabase.storage.from('user-files').remove([sfStoragePath]);
            }
          }
          // Delete linked subject_files records
          await supabase.from('subject_files').delete().eq('user_file_id', fileId);
        }

        // 3. Delete the personal file from storage
        const storagePath = fileToDelete.file_url.split('/user-files/')[1];
        if (storagePath) {
          await supabase.storage.from('user-files').remove([storagePath]);
        }
      }
      // 4. Delete file shares
      await supabase.from('file_shares').delete().eq('file_id', fileId);
      // 5. Delete the user_files record
      const { error } = await supabase.from('user_files').delete().eq('id', fileId);
      if (error) {
        toast.error(t('files.toastDeleteFailed'));
      } else {
        toast.success(t('files.toastDeleteSuccess'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setDeletingFileId(null);
      setConfirmDeleteId(null);
    }
  };

  // -------------------------------------------------------
  // Rename file
  // -------------------------------------------------------
  const handleRenameFile = async (fileId: string) => {
    if (!renameValue.trim()) return;
    setRenaming(true);
    try {
      const file = files.find((f) => f.id === fileId);
      if (!file) return;
      const ext = getFileExtension(file.file_name);
      const newName = renameValue.trim() + (ext ? '.' + ext : '');
      const { error } = await supabase
        .from('user_files')
        .update({ file_name: newName, updated_at: new Date().toISOString() })
        .eq('id', fileId);
      if (error) {
        toast.error(t('files.toastRenameFailed'));
      } else {
        toast.success(t('files.toastRenameSuccess'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setRenaming(false);
      setRenamingFileId(null);
    }
  };

  // -------------------------------------------------------
  // Toggle file visibility
  // -------------------------------------------------------
  const handleToggleVisibility = async (fileId: string, currentVisibility: string) => {
    try {
      const newVisibility = currentVisibility === 'public' ? 'private' : 'public';

      // Prevent making file private if it's assigned to courses
      if (newVisibility === 'private') {
        const { data: linkedSubjectFiles } = await supabase
          .from('subject_files')
          .select('id')
          .eq('user_file_id', fileId);
        if (linkedSubjectFiles && linkedSubjectFiles.length > 0) {
          toast.error(t('files.toastCannotMakePrivate'));
          return;
        }
      }

      const { error } = await supabase
        .from('user_files')
        .update({ visibility: newVisibility, updated_at: new Date().toISOString() })
        .eq('id', fileId);
      if (error) {
        // Column might not exist yet
        toast.error(t('files.toastVisibilityError'));
      } else {
        toast.success(t('files.toastVisibilityChanged'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    }
  };

  // -------------------------------------------------------
  // Share files with selected users (using server API to bypass RLS issues)
  // -------------------------------------------------------
  const handleShareWithSelected = async () => {
    if (!sharingFileId || selectedShareUsers.length === 0) return;
    setSharingUsers(true);
    try {
      const alreadySharedIds = new Set(fileShares.map((s) => s.shared_with));
      const newUsers = selectedShareUsers.filter((u) => !alreadySharedIds.has(u.id));

      if (newUsers.length === 0) {
        toast.info(t('files.toastAlreadyShared'));
        setSelectedShareUsers([]);
        setShareSearchQuery('');
        setShareSearchResults([]);
        return;
      }

      // Use server-side API to create shares (bypasses RLS)
      const headers = await getAuthHeaders(15000);

      const res = await fetch('/api/files/bulk-share', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileIds: [sharingFileId],
          userIds: newUsers.map((u) => u.id),
          permission: selectedPermission,
          sharedBy: profile.id,
        }),
      });

      let result: { success: boolean; data?: { created: number; skipped: number }; error?: string };
      try { result = await res.json(); } catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
      if (result.success && result.data) {
        const { created, skipped } = result.data;
        let msg = t('files.toastShareSuccess');
        if (created > 0) msg += t('files.toastShareNewCount', { created });
        if (skipped > 0) msg += t('files.toastShareSkipped', { skipped });
        toast.success(msg);
      } else {
        toast.error(result.error || t('files.toastShareFailed'));
      }

      setSelectedShareUsers([]);
      setShareSearchQuery('');
      setShareSearchResults([]);
      if (sharingFileId) fetchFileShares(sharingFileId);
    } catch {
      toast.error(t('files.toastShareFailed'));
    } finally {
      setSharingUsers(false);
    }
  };

  // -------------------------------------------------------
  // Share file by email (uses server API, works for any owned file)
  // -------------------------------------------------------
  const handleShareByEmail = async () => {
    if (!sharingFileId || !shareByEmail.trim()) return;
    setShareByEmailLoading(true);
    try {
      const headers = await getAuthHeaders(15000);

      const res = await fetch('/api/files/share-by-email', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileId: sharingFileId,
          email: shareByEmail.trim(),
          permission: shareByEmailPermission,
          sharedBy: profile.id,
        }),
      });

      let result: { success: boolean; data?: { created: number; updated: number; user: { name?: string; email?: string } }; error?: string };
      try { result = await res.json(); } catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
      if (result.success && result.data) {
        const { created, updated, user } = result.data;
        if (created > 0) {
          toast.success(t('files.toastShareWithEmailSuccess', { name: user?.name || user?.email || t('common.user') }));
        } else if (updated > 0) {
          toast.success(t('files.toastSharePermissionUpdated', { name: user?.name || user?.email || t('common.user') }));
        } else {
          toast.info(t('files.toastShareExists'));
        }
        setShareByEmail('');
        setShareByEmailPermission('view');
        if (sharingFileId) fetchFileShares(sharingFileId);
      } else {
        toast.error(result.error || t('files.toastShareFailed'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setShareByEmailLoading(false);
    }
  };

  // -------------------------------------------------------
  // Bulk share files by email
  // -------------------------------------------------------
  const handleBulkShareByEmail = async () => {
    if (selectedFileIds.size === 0 || !bulkShareByEmail.trim()) return;
    setBulkShareByEmailLoading(true);
    try {
      const headers = await getAuthHeaders(15000);

      const fileIds = Array.from(selectedFileIds);
      let totalCreated = 0;
      let totalUpdated = 0;
      let lastError = '';

      for (const fileId of fileIds) {
        const res = await fetch('/api/files/share-by-email', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            fileId,
            email: bulkShareByEmail.trim(),
            permission: bulkShareByEmailPermission,
            sharedBy: profile.id,
          }),
        });

        let result: { success: boolean; data?: { created: number; updated: number }; error?: string };
        try { result = await res.json(); } catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
        if (result.success && result.data) {
          totalCreated += result.data.created || 0;
          totalUpdated += result.data.updated || 0;
        } else {
          lastError = result.error || t('common.errorUnexpected');
        }
      }

      if (totalCreated > 0) {
        toast.success(t('files.toastBulkShareSuccess', { created: totalCreated }));
      } else if (totalUpdated > 0) {
        toast.success(t('files.toastBulkShareUpdated', { updated: totalUpdated }));
      } else if (lastError) {
        toast.error(lastError);
      }

      setBulkShareByEmail('');
      setBulkShareByEmailPermission('view');
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setBulkShareByEmailLoading(false);
    }
  };

  // -------------------------------------------------------
  // Remove share
  // -------------------------------------------------------
  const handleRemoveShare = async (shareId: string) => {
    setRemovingShareId(shareId);
    try {
      const { error } = await supabase.from('file_shares').delete().eq('id', shareId);
      if (error) {
        toast.error(t('files.toastRemoveShareFailed'));
      } else {
        toast.success(t('files.toastRemoveShareSuccess'));
        if (sharingFileId) fetchFileShares(sharingFileId);
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setRemovingShareId(null);
    }
  };

  // -------------------------------------------------------
  // Search users for sharing (with debounce)
  // -------------------------------------------------------
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchUsers = useCallback(
    (query: string) => {
      setShareSearchQuery(query);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

      if (!query.trim()) {
        setShareSearchResults([]);
        return;
      }

      searchTimerRef.current = setTimeout(async () => {
        setSearchingUsers(true);
        try {
          const alreadySharedIds = new Set([
            ...fileShares.map((s) => s.shared_with),
            ...selectedShareUsers.map((u) => u.id),
            profile.id,
          ]);

          const { data, error } = await supabase
            .from('users')
            .select('*')
            .or(`name.ilike.%${query.trim()}%,email.ilike.%${query.trim()}%`)
            .limit(10);
          if (error) {
            console.error('Error searching users:', error);
            setShareSearchResults([]);
          } else {
            setShareSearchResults(
              ((data as UserProfile[]) || []).filter((u) => !alreadySharedIds.has(u.id))
            );
          }
        } catch (err) {
          console.error('Search users error:', err);
          setShareSearchResults([]);
        } finally {
          setSearchingUsers(false);
        }
      }, 300);
    },
    [profile.id, fileShares, selectedShareUsers]
  );

  // -------------------------------------------------------
  // Add user to selected share list
  // -------------------------------------------------------
  const addShareUser = (user: UserProfile) => {
    setSelectedShareUsers((prev) => {
      if (prev.find((u) => u.id === user.id)) return prev;
      return [...prev, user];
    });
    setShareSearchQuery('');
    setShareSearchResults([]);
  };

  // -------------------------------------------------------
  // Remove user from selected share list
  // -------------------------------------------------------
  const removeShareUser = (userId: string) => {
    setSelectedShareUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  // -------------------------------------------------------
  // Open share modal
  // -------------------------------------------------------
  const openShareModal = (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    setSharingFileId(fileId);
    setShareSearchQuery('');
    setShareSearchResults([]);
    setSelectedShareUsers([]);
    setSelectedPermission('view');
    setShareByEmail('');
    setShareByEmailPermission('view');
    setShareModalOpen(true);
    fetchFileShares(fileId);
  };

  // -------------------------------------------------------
  // Close share modal
  // -------------------------------------------------------
  const closeShareModal = () => {
    setShareModalOpen(false);
    setSharingFileId(null);
    setShareSearchQuery('');
    setShareSearchResults([]);
    setSelectedShareUsers([]);
    setFileShares([]);
    setShareByEmail('');
    setShareByEmailPermission('view');
  };

  // -------------------------------------------------------
  // Open details modal with assigned courses info
  // -------------------------------------------------------
  const openDetailsModal = async (file: UserFile) => {
    setDetailsFile(file);
    // Fetch linked courses and shared users in parallel
    try {
      // Try with full columns first (user_file_id, visibility), fall back to basic query
      let coursesResult = await supabase
        .from('subject_files')
        .select('subject_id, created_at, visibility, subjects(name)')
        .eq('user_file_id', file.id);

      // If user_file_id column doesn't exist, try without it (migration not yet applied)
      if (coursesResult.error && (coursesResult.error.message?.includes('does not exist') || coursesResult.error.message?.includes('schema cache'))) {
        coursesResult = await supabase
          .from('subject_files')
          .select('subject_id, created_at, subjects(name)')
          .eq('file_url', file.file_url) as typeof coursesResult;
      }

      const sharesResult = await supabase
        .from('file_shares')
        .select('*')
        .eq('file_id', file.id);

      // Process courses
      const linkedFiles = coursesResult.data;
      if (linkedFiles && linkedFiles.length > 0) {
        setDetailsFileCourses(linkedFiles.map((sf: Record<string, unknown>) => ({
          name: (sf.subjects as Record<string, string>)?.name || t('common.deletedCourse'),
          assignedAt: sf.created_at as string,
          visibility: (sf.visibility as string) ?? 'public',
        })));
      } else {
        setDetailsFileCourses([]);
      }

      // Process shares
      const sharesData = sharesResult.data;
      if (sharesData && sharesData.length > 0) {
        const sharesWithUsers: (FileShare & { shared_with_user?: UserProfile })[] = [];
        for (const share of sharesData) {
          const { data: userProfile } = await supabase
            .from('users')
            .select('*')
            .eq('id', share.shared_with)
            .single();
          sharesWithUsers.push({
            ...share,
            shared_with_user: (userProfile as UserProfile) || undefined,
          });
        }
        setDetailsFileShares(sharesWithUsers);
      } else {
        setDetailsFileShares([]);
      }
    } catch {
      setDetailsFileCourses([]);
      setDetailsFileShares([]);
    }
  };

  // -------------------------------------------------------
  // Open assign to course modal
  // -------------------------------------------------------
  const openAssignModal = (fileId: string | null, isBulk = false) => {
    if (!isBulk) {
      const file = files.find((f) => f.id === fileId);
      if (!file || file.visibility !== 'public') {
        toast.error(t('files.toastOnlyPublicFiles'));
        return;
      }
    }
    setAssigningFileId(fileId);
    setAssignSubjectIds(new Set());
    setBulkAssignMode(isBulk);
    setAssignModalOpen(true);
    const loadSubjects = async () => {
      try {
        if (role === 'teacher') {
          const { data } = await supabase
            .from('subjects')
            .select('*')
            .eq('teacher_id', profile.id)
            .order('name');
          if (data) setAssignSubjects(data as Subject[]);
        } else {
          const { data: enrollments } = await supabase
            .from('subject_students')
            .select('subject_id')
            .eq('student_id', profile.id);
          if (enrollments && enrollments.length > 0) {
            const ids = enrollments.map((e) => e.subject_id);
            const { data: subs } = await supabase
              .from('subjects')
              .select('*')
              .in('id', ids)
              .order('name');
            if (subs) setAssignSubjects(subs as Subject[]);
          }
        }
      } catch (err) {
        console.error('Error loading subjects:', err);
      }
    };
    loadSubjects();
  };

  // -------------------------------------------------------
  // Assign file to course (using bulk-assign API - no re-upload)
  // -------------------------------------------------------
  const handleAssignToCourse = async () => {
    if (assignSubjectIds.size === 0) return;
    const fileIdsToAssign = bulkAssignMode ? Array.from(selectedFileIds) : (assigningFileId ? [assigningFileId] : []);
    if (fileIdsToAssign.length === 0) return;
    setAssigning(true);
    try {
      // Get auth token for API request
      const { waitForSession } = await import('@/lib/client-auth');
      const token = await waitForSession(10000);

      const res = await fetch('/api/files/bulk-assign', {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileIds: fileIdsToAssign,
          subjectIds: Array.from(assignSubjectIds),
          userId: profile.id,
        }),
      });
      let result: { success: boolean; data?: { created: number; skipped: number }; error?: string };
      try { result = await res.json(); } catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
      if (result.success && result.data) {
        const { created, skipped } = result.data;
        let msg = t('files.toastAssignSuccess', { created });
        if (skipped > 0) msg += t('files.toastAssignSkipped', { skipped });
        toast.success(msg);
      } else {
        toast.error(result.error || t('files.toastAssignFailed'));
      }
      setAssignModalOpen(false);
      setBulkAssignMode(false);
      setSelectedFileIds(new Set());
      fetchFiles();
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setAssigning(false);
    }
  };

  // -------------------------------------------------------
  // Open bulk share modal
  // -------------------------------------------------------
  const openBulkShareModal = () => {
    setBulkShareModalOpen(true);
    setBulkShareSearchQuery('');
    setBulkShareSearchResults([]);
    setBulkShareSelectedUsers([]);
    setBulkSharePermission('view');
    setBulkShareByEmail('');
    setBulkShareByEmailPermission('view');
  };

  // -------------------------------------------------------
  // Bulk share search users
  // -------------------------------------------------------
  const bulkShareSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBulkShareSearch = useCallback(
    (query: string) => {
      setBulkShareSearchQuery(query);
      if (bulkShareSearchTimerRef.current) clearTimeout(bulkShareSearchTimerRef.current);
      if (!query.trim()) {
        setBulkShareSearchResults([]);
        return;
      }
      bulkShareSearchTimerRef.current = setTimeout(async () => {
        setBulkShareSearching(true);
        try {
          const alreadySelectedIds = new Set([
            ...bulkShareSelectedUsers.map((u) => u.id),
            profile.id,
          ]);
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .or(`name.ilike.%${query.trim()}%,email.ilike.%${query.trim()}%`)
            .limit(10);
          if (error) {
            setBulkShareSearchResults([]);
          } else {
            setBulkShareSearchResults(
              ((data as UserProfile[]) || []).filter((u) => !alreadySelectedIds.has(u.id))
            );
          }
        } catch {
          setBulkShareSearchResults([]);
        } finally {
          setBulkShareSearching(false);
        }
      }, 300);
    },
    [profile.id, bulkShareSelectedUsers]
  );

  // -------------------------------------------------------
  // Add user to bulk share selected list
  // -------------------------------------------------------
  const addBulkShareUser = (user: UserProfile) => {
    setBulkShareSelectedUsers((prev) => {
      if (prev.find((u) => u.id === user.id)) return prev;
      return [...prev, user];
    });
    setBulkShareSearchQuery('');
    setBulkShareSearchResults([]);
  };

  // -------------------------------------------------------
  // Remove user from bulk share selected list
  // -------------------------------------------------------
  const removeBulkShareUser = (userId: string) => {
    setBulkShareSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  // -------------------------------------------------------
  // Handle bulk share submit
  // -------------------------------------------------------
  const handleBulkShare = async () => {
    if (selectedFileIds.size === 0 || bulkShareSelectedUsers.length === 0) return;
    setBulkShareLoading(true);
    try {
      const fileIdsToShare = Array.from(selectedFileIds);
      if (fileIdsToShare.length === 0) {
        toast.error(t('files.toastNoFilesToShare'));
        return;
      }
      const headers = await getAuthHeaders(15000);

      const res = await fetch('/api/files/bulk-share', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileIds: fileIdsToShare,
          userIds: bulkShareSelectedUsers.map((u) => u.id),
          permission: bulkSharePermission,
          sharedBy: profile.id,
        }),
      });
      let result: { success: boolean; data?: { created: number; skipped: number }; error?: string };
      try { result = await res.json(); } catch { result = { success: false, error: t('files.toastUnexpectedServerResponse') }; }
      if (result.success && result.data) {
        const { created, skipped } = result.data;
        let msg = t('files.toastBulkShareSuccess', { created });
        if (skipped > 0) msg += t('files.toastShareSkipped', { skipped });
        toast.success(msg);
        setBulkShareModalOpen(false);
        setBulkShareSelectedUsers([]);
        setSelectedFileIds(new Set());
      } else {
        toast.error(result.error || t('files.toastShareFailed'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setBulkShareLoading(false);
    }
  };

  // -------------------------------------------------------
  // Toggle file selection
  // -------------------------------------------------------
  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  };

  // -------------------------------------------------------
  // Toggle select all
  // -------------------------------------------------------
  const toggleSelectAll = () => {
    if (selectedFileIds.size === filteredFiles.length && filteredFiles.length > 0) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(filteredFiles.map(f => f.id)));
    }
  };

  // -------------------------------------------------------
  // Bulk delete
  // -------------------------------------------------------
  const handleBulkDelete = async () => {
    if (selectedFileIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      let deleted = 0;
      for (const fileId of selectedFileIds) {
        const fileToDelete = files.find((f) => f.id === fileId);
        if (fileToDelete) {
          const { data: linkedSubjectFiles } = await supabase
            .from('subject_files')
            .select('id, file_url')
            .eq('user_file_id', fileId);
          if (linkedSubjectFiles && linkedSubjectFiles.length > 0) {
            for (const sf of linkedSubjectFiles) {
              const sfStoragePath = sf.file_url.split('/user-files/')[1];
              if (sfStoragePath) await supabase.storage.from('user-files').remove([sfStoragePath]);
            }
            await supabase.from('subject_files').delete().eq('user_file_id', fileId);
          }
          const storagePath = fileToDelete.file_url.split('/user-files/')[1];
          if (storagePath) await supabase.storage.from('user-files').remove([storagePath]);
        }
        await supabase.from('file_shares').delete().eq('file_id', fileId);
        const { error } = await supabase.from('user_files').delete().eq('id', fileId);
        if (!error) deleted++;
      }
      toast.success(t('files.toastBulkDeleteSuccess', { count: deleted }));
      setSelectedFileIds(new Set());
      setConfirmBulkDelete(false);
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setBulkActionLoading(false);
    }
  };

  // -------------------------------------------------------
  // Bulk change visibility
  // -------------------------------------------------------
  const handleBulkVisibility = async (newVisibility: 'public' | 'private') => {
    if (selectedFileIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      if (newVisibility === 'private') {
        // Check none are assigned to courses
        for (const fileId of selectedFileIds) {
          const { data: linked } = await supabase.from('subject_files').select('id').eq('user_file_id', fileId);
          if (linked && linked.length > 0) {
            toast.error(t('files.toastSomeFilesAssigned'));
            setBulkActionLoading(false);
            return;
          }
        }
      }
      let updated = 0;
      for (const fileId of selectedFileIds) {
        const { error } = await supabase
          .from('user_files')
          .update({ visibility: newVisibility, updated_at: new Date().toISOString() })
          .eq('id', fileId);
        if (!error) updated++;
      }
      toast.success(t('files.toastBulkVisibilityChanged', { count: updated }));
      setSelectedFileIds(new Set());
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setBulkActionLoading(false);
    }
  };

  // -------------------------------------------------------
  // Download file with custom name
  // -------------------------------------------------------
  const handleDownload = async (file: UserFile | SharedFileWithInfo) => {
    try {
      const response = await fetch(file.file_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      window.open(file.file_url, '_blank');
    }
  };

  // -------------------------------------------------------
  // Preview file (works with both UserFile and SharedFileWithInfo)
  // -------------------------------------------------------
  const handlePreview = (file: UserFile | SharedFileWithInfo) => {
    const lower = file.file_type.toLowerCase();
    // Support preview for images, PDFs, videos, and audio files
    if (lower.includes('image') || lower.includes('pdf') || lower.includes('video') || lower.includes('audio')) {
      setPreviewFile(file as UserFile & { other_recipients?: SharedFileRecipient[]; shared_by_user?: UserProfile });
    } else {
      // For unsupported types, download directly
      handleDownload(file);
    }
  };

  // -------------------------------------------------------
  // Permission icon helper
  // -------------------------------------------------------
  function getPermissionIcon(permission: 'view' | 'edit' | 'download') {
    switch (permission) {
      case 'view': return <Eye className="h-4 w-4" />;
      case 'edit': return <Pencil className="h-4 w-4" />;
      case 'download': return <Download className="h-4 w-4" />;
    }
  }

  // -------------------------------------------------------
  // Permission label helper
  // -------------------------------------------------------
  function getPermissionLabel(permission: 'view' | 'edit' | 'download') {
    switch (permission) {
      case 'view': return t('common.view');
      case 'edit': return t('common.edit');
      case 'download': return t('common.download');
    }
  }

  // -------------------------------------------------------
  // Render: File Card
  // -------------------------------------------------------
  const renderFileCard = (file: UserFile) => {
    const isRenaming = renamingFileId === file.id;
    const fileCategory = getFileCategory(file.file_type);
    const shareCount = fileShareCounts[file.id] || 0;
    const courseCount = fileCourseCounts[file.id] || 0;
    const isPreviewable = file.file_type.toLowerCase().includes('image') || file.file_type.toLowerCase().includes('pdf') || file.file_type.toLowerCase().includes('video') || file.file_type.toLowerCase().includes('audio');

    return (
      <motion.div variants={itemVariants}>
        <div className="group relative rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-all">
          {/* Rename input */}
          {isRenaming ? (
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameFile(file.id);
                  if (e.key === 'Escape') setRenamingFileId(null);
                }}
                className="flex-1 rounded-md border border-sky-600 bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30"
                autoFocus
                dir={direction}
              />
              <span className="text-xs text-muted-foreground">.{getFileExtension(file.file_name)}</span>
              <button
                onClick={() => handleRenameFile(file.id)}
                disabled={renaming}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-60"
              >
                {renaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => setRenamingFileId(null)}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground hover:bg-muted/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          {/* Row 1: File icon + file name + DropdownMenu */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
              {getFileIcon(file.file_type)}
            </div>
            <h3 className="min-w-0 flex-1 text-sm font-bold text-foreground truncate" title={file.file_name}>
              {file.file_name}
            </h3>

            {/* Checkbox for multi-select — only visible in selection mode */}
            {selectionMode && (
              <button
                onClick={() => toggleFileSelection(file.id)}
                className={`touch-target shrink-0 flex items-center justify-center rounded-md transition-colors ${
                  selectedFileIds.has(file.id)
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {selectedFileIds.has(file.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              </button>
            )}

            {/* Action menu */}
            <DropdownMenu dir={direction}>
              <DropdownMenuTrigger asChild>
                <button
                  className="touch-target shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {/* Preview action — moved from inline Eye button */}
                {isPreviewable && (
                  <DropdownMenuItem onClick={() => handlePreview(file)}>
                    <Eye className="h-4 w-4 me-2" />
                    {t('files.preview')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setRenamingFileId(file.id);
                    const ext = getFileExtension(file.file_name);
                    setRenameValue(file.file_name.replace(new RegExp(`\\.${ext}$`), ''));
                  }}
                >
                  <Pencil className="h-4 w-4 me-2" />
                  {t('files.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openDetailsModal(file)}>
                  <Info className="h-4 w-4 me-2" />
                  {t('files.details')}
                </DropdownMenuItem>
                {file.visibility === 'public' && (
                  <DropdownMenuItem onClick={() => openShareModal(file.id)}>
                    <Share2 className="h-4 w-4 me-2" />
                    {t('files.share')}
                  </DropdownMenuItem>
                )}
                {(profile.role === 'teacher' || profile.role === 'admin' || profile.role === 'superadmin') && file.visibility === 'public' && (
                  <DropdownMenuItem onClick={() => openAssignModal(file.id)}>
                    <FolderPlus className="h-4 w-4 me-2" />
                    {t('files.assignToCourseShort')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleToggleVisibility(file.id, file.visibility || 'private')}>
                  {file.visibility === 'public' ? (
                    <>
                      <Lock className="h-4 w-4 me-2" />
                      {t('files.makePrivateShort')}
                    </>
                  ) : (
                    <>
                      <Globe className="h-4 w-4 me-2" />
                      {t('files.makePublicShort')}
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConfirmDeleteId(file.id)}
                  className="text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-400 focus:bg-rose-50 dark:focus:bg-rose-950/30"
                >
                  <Trash2 className="h-4 w-4 me-2" />
                  {t('common.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Row 2: Details - size • date • type badge • category badge */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
            <span className="text-xs text-muted-foreground">{formatFileSize(file.file_size)}</span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground">{formatDate(file.created_at, locale)}</span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
              {file.file_type.split('/').pop() || file.file_type}
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5 text-[10px] font-medium">
              {categoryLabels[fileCategory]}
            </span>
          </div>

          {/* Row 3: Badges - visibility + share count + course assignment count */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              file.visibility === 'public'
                ? 'bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
            }`}>
              {file.visibility === 'public' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              {file.visibility === 'public' ? t('files.public') : t('files.private')}
            </span>
            {shareCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-950/30 text-violet-800 dark:text-violet-200 px-2 py-0.5 text-[10px] font-medium">
                <Users className="h-3 w-3" />
                {shareCount}
              </span>
            )}
            {courseCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 dark:bg-orange-950/30 text-orange-800 dark:text-orange-200 px-2 py-0.5 text-[10px] font-medium">
                <FolderPlus className="h-3 w-3" />
                {courseCount}
              </span>
            )}
          </div>

          {/* Delete confirmation overlay */}
          {confirmDeleteId === file.id && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/90 backdrop-blur-sm z-20"
            >
              <div className="flex items-center gap-2 p-3">
                <span className="text-sm font-medium text-foreground">{t('files.deleteThisFile')}</span>
                <button
                  onClick={() => handleDeleteFile(file.id)}
                  disabled={deletingFileId === file.id}
                  className="flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {deletingFileId === file.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('common.confirm')}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex items-center rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: My Files Tab
  // -------------------------------------------------------
  const renderMyFiles = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold text-foreground">{t('files.title')}</h2>
          <p className="text-muted-foreground mt-1">{t('files.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openUploadModal}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 active:bg-sky-900 touch-manipulation"
          >
            <Upload className="h-4 w-4" />
            {t('files.uploadFile')}
          </button>
        </div>
      </motion.div>

      {/* Visibility filter tabs */}
      <motion.div variants={itemVariants} className="flex items-center gap-2">
        {([
          { key: 'all' as const, label: t('files.categoryAll'), icon: null, count: files.length },
          { key: 'public' as const, label: t('files.public'), icon: <Globe className="h-3 w-3" />, count: files.filter((f) => f.visibility === 'public').length },
          { key: 'private' as const, label: t('files.private'), icon: <Lock className="h-3 w-3" />, count: files.filter((f) => f.visibility !== 'public').length },
        ]).map((vf) => (
          <button
            key={vf.key}
            onClick={() => setVisibilityFilter(vf.key)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
              visibilityFilter === vf.key
                ? vf.key === 'public'
                  ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200'
                  : vf.key === 'private'
                    ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                    : 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {vf.icon}
            {vf.label}
            <span className={`text-[10px] ${visibilityFilter === vf.key ? (vf.key === 'private' ? 'text-amber-600' : 'text-sky-700 dark:text-sky-300') : 'text-muted-foreground'}`}>
              ({vf.count})
            </span>
          </button>
        ))}
      </motion.div>

      {/* Category filter tabs */}
      <motion.div variants={itemVariants} className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILE_CATEGORIES.map((cat) => {
          const count = cat === 'all' ? files.length : files.filter((f) => getFileCategory(f.file_type) === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {categoryLabels[cat]}
              <span className={`text-[10px] ${categoryFilter === cat ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground'}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Select mode toggle / Select all + count */}
      {!loadingFiles && filteredFiles.length > 0 && (
        <motion.div variants={itemVariants} className="flex items-center gap-3">
          {!selectionMode ? (
            <button
              onClick={() => setSelectionMode(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <CheckSquare className="h-4 w-4" />
              {t('course.select')}
            </button>
          ) : (
            <>
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {selectedFileIds.size === filteredFiles.length && filteredFiles.length > 0 ? (
                  <CheckSquare className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                {t('course.selectAll')}
              </button>
              {selectedFileIds.size > 0 && (
                <span className="text-xs text-sky-700 dark:text-sky-300 font-medium">
                  {t('files.selectedCount', { count: selectedFileIds.size })}
                </span>
              )}
              <button
                onClick={() => { setSelectionMode(false); setSelectedFileIds(new Set()); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('common.cancel')}
              </button>
            </>
          )}
        </motion.div>
      )}

      {/* Files grid */}
      {loadingFiles ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : filteredFiles.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/20 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <FileText className="h-8 w-8 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">{t('files.noFilesYet')}</p>
          <p className="text-sm text-muted-foreground">
            {visibilityFilter !== 'all'
              ? (visibilityFilter === 'public' ? t('files.noPublicFiles') : t('files.noPrivateFiles'))
              : categoryFilter !== 'all' ? t('files.noFilesInCategory') : t('files.uploadFirstFiles')}
          </p>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
        >
          {filteredFiles.map((file) => (
            <div key={file.id}>{renderFileCard(file)}</div>
          ))}
        </motion.div>
      )}

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selectedFileIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20, pointerEvents: 'none' as const }}
            className="fixed bottom-20 sm:bottom-6 start-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border bg-background shadow-lg px-5 py-3"
            dir={direction}
          >
            <span className="text-sm font-medium text-foreground whitespace-nowrap">
              {t('files.selectedCount', { count: selectedFileIds.size })}
            </span>
            <div className="h-6 w-px bg-border" />
            {confirmBulkDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">{t('files.deleteSelectedFiles')}</span>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {bulkActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : t('common.confirm')}
                </button>
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  className="rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                >
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <>
                <DropdownMenu dir={direction}>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1.5 rounded-md bg-sky-700 text-white px-3 py-1.5 text-xs font-medium hover:bg-sky-800 transition-colors">
                      {t('files.bulkActions')}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem
                      onClick={() => setConfirmBulkDelete(true)}
                      className="text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-400 focus:bg-rose-50 dark:focus:bg-rose-950/30 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4 me-2" />
                      {t('common.delete')}
                    </DropdownMenuItem>
                    {Array.from(selectedFileIds).some(id => files.find(f => f.id === id)?.visibility !== 'public') && (
                      <DropdownMenuItem
                        onClick={() => handleBulkVisibility('public')}
                        disabled={bulkActionLoading}
                        className="cursor-pointer"
                      >
                        <Globe className="h-4 w-4 me-2" />
                        {t('files.makePublic')}
                      </DropdownMenuItem>
                    )}
                    {Array.from(selectedFileIds).some(id => files.find(f => f.id === id)?.visibility === 'public') && (
                      <DropdownMenuItem
                        onClick={() => handleBulkVisibility('private')}
                        disabled={bulkActionLoading}
                        className="cursor-pointer"
                      >
                        <Lock className="h-4 w-4 me-2" />
                        {t('files.makePrivate')}
                      </DropdownMenuItem>
                    )}
                    {(profile.role === 'teacher' || profile.role === 'admin' || profile.role === 'superadmin') && Array.from(selectedFileIds).every(id => files.find(f => f.id === id)?.visibility === 'public') && (
                      <DropdownMenuItem
                        onClick={() => openAssignModal(null, true)}
                        className="cursor-pointer"
                      >
                        <FolderPlus className="h-4 w-4 me-2" />
                        {t('files.assignToCourses')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={async () => {
                        for (const fileId of selectedFileIds) {
                          const file = files.find(f => f.id === fileId);
                          if (file) await handleDownload(file);
                        }
                      }}
                      className="cursor-pointer"
                    >
                      <Download className="h-4 w-4 me-2" />
                      {t('files.download')}
                    </DropdownMenuItem>
                    {Array.from(selectedFileIds).every(id => files.find(f => f.id === id)?.visibility === 'public') && (
                      <DropdownMenuItem
                        onClick={() => openBulkShareModal()}
                        className="cursor-pointer"
                      >
                        <Share2 className="h-4 w-4 me-2" />
                        {t('files.shareWithUsers')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={() => setSelectedFileIds(new Set())}
                  className="flex items-center gap-1 rounded-md bg-muted text-muted-foreground px-3 py-1.5 text-xs font-medium hover:bg-muted/80 transition-colors"
                >
                  <X className="h-3 w-3" />
                  {t('files.cancelSelection')}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Shared With Me Tab
  // -------------------------------------------------------
  const renderSharedWithMe = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h2 className="text-2xl font-bold text-foreground">{t('files.sharedWithMe')}</h2>
        <p className="text-muted-foreground mt-1">{t('files.sharedWithMeDesc')}</p>
      </motion.div>

      {/* Shared files list */}
      {loadingShared ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : sharedWithMe.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/20 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <Share2 className="h-8 w-8 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">{t('files.noSharedFiles')}</p>
          <p className="text-sm text-muted-foreground">{t('files.sharedFilesWillAppear')}</p>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
        >
          {sharedWithMe.map((file) => (
            <motion.div key={`${file.id}-shared`} variants={itemVariants}>
              <div className="group relative rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-all">
                {/* Shared by info */}
                <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                  <UserAvatar name={file.shared_by_user?.name || t('common.user')} avatarUrl={file.shared_by_user?.avatar_url} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground truncate">
                      {t('files.sharedBy')}{' '}
                      <button
                        onClick={() => file.shared_by_user?.id && openProfile(file.shared_by_user.id)}
                        className="font-medium text-foreground hover:text-sky-700 dark:hover:text-sky-300 dark:text-sky-300 transition-colors cursor-pointer"
                      >
                        {formatNameWithTitle(file.shared_by_user?.name || t('common.user'), file.shared_by_user?.role, file.shared_by_user?.title_id, file.shared_by_user?.gender, t)}
                      </button>
                      {t('files.sharedBy')}
                    </p>
                  </div>
                  {file.permission && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {getPermissionIcon(file.permission)}
                      {getPermissionLabel(file.permission)}
                    </span>
                  )}
                </div>

                {/* File icon & info */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    {getFileIcon(file.file_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground truncate" title={file.file_name}>
                      {file.file_name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{formatFileSize(file.file_size)}</span>
                      <span>•</span>
                      <span>{formatDate(file.created_at, locale)}</span>
                    </div>
                  </div>
                </div>

                {/* Other recipients preview */}
                {file.other_recipients && file.other_recipients.length > 0 && (
                  <div className="mb-3">
                    <button
                      onClick={() => setShowRecipientsFile(file)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-sky-700 dark:hover:text-sky-300 dark:text-sky-300 transition-colors w-full"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span>{t('files.sharedWithCount', { count: file.total_recipients_count || (file.other_recipients.length + 1) })}</span>
                      <span className="flex -space-x-1.5 space-x-reverse ms-1">
                        {file.other_recipients.slice(0, 3).map((r) => (
                          <span key={r.id} className="inline-block h-5 w-5 rounded-full bg-muted border-2 border-background overflow-hidden">
                            {r.avatar_url ? (
                              <img src={r.avatar_url} alt={r.name} className="h-full w-full object-cover" />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center text-[8px] font-bold text-muted-foreground">
                                {r.name?.charAt(0) || '?'}
                              </span>
                            )}
                          </span>
                        ))}
                        {file.other_recipients.length > 3 && (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted border-2 border-background text-[8px] font-bold text-muted-foreground">
                            +{file.other_recipients.length - 3}
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  {/* Preview button */}
                  <button
                    onClick={() => handlePreview(file)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 px-3 py-2 text-xs font-medium hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    {t('files.preview')}
                  </button>
                  {/* Download button */}
                  <button
                    onClick={() => handleDownload(file)}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-muted text-muted-foreground px-3 py-2 text-xs font-medium hover:bg-muted/80 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('files.download')}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Upload Modal
  // -------------------------------------------------------
  const renderUploadModal = () => (
    <AnimatePresence>
      {uploadModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => {
            if (!pendingUploads.some((p) => p.uploading)) {
              setUploadModalOpen(false);
              setPendingUploads([]);
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir={direction}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b p-5 shrink-0 sticky top-0 z-10 bg-background">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Upload className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                {t('files.uploadFiles')}
              </h3>
              <button
                onClick={() => {
                  if (!pendingUploads.some((p) => p.uploading)) {
                    setUploadModalOpen(false);
                    setPendingUploads([]);
                  }
                }}
                className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4 overflow-y-auto min-h-0 custom-scrollbar">
              {/* Course assignment (optional) - only for teachers/admins */}
              {(profile.role === 'teacher' || profile.role === 'admin' || profile.role === 'superadmin') && (
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  {t('files.assignToCoursesOptional')}
                </label>
                {loadingSubjects ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : subjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('files.noCoursesAvailable')}</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar rounded-lg border p-2">
                    {subjects.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedSubjectForUploadIds.has(s.id)}
                          onChange={(e) => {
                            setSelectedSubjectForUploadIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id); else next.delete(s.id);
                              return next;
                            });
                          }}
                          className="rounded border-gray-300 dark:border-border text-sky-700 dark:text-sky-300 focus:ring-sky-600 dark:focus:ring-sky-500"
                        />
                        <span className="text-sm text-foreground">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* File picker */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp4,.webm,.mov,.mp3,.wav,.ogg,.txt,.csv,.zip,.rar"
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/20 p-6 transition-colors hover:border-sky-400 dark:hover:border-sky-600 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 active:bg-sky-50/70 dark:active:bg-sky-950/40 touch-manipulation"
                >
                  <Upload className="h-8 w-8 text-sky-400" />
                  <span className="text-sm font-medium text-muted-foreground">{t('files.clickToSelectFiles')}</span>
                  <span className="text-xs text-muted-foreground">{t('files.canSelectMultiple')}</span>
                  <span className="text-[10px] text-muted-foreground/70">{t('files.maxFileSize', { size: '50 MB' })}</span>
                </button>
              </div>

              {/* Pending uploads list */}
              {pendingUploads.length > 0 && (
                <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar">
                  {pendingUploads.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-xl border p-3 space-y-2 ${
                        item.errorCode === 'duplicate_name' ? 'border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/30' :
                        item.progress === -1 ? 'border-rose-200 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/20' :
                        item.done ? 'border-sky-200 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/20' :
                        'bg-card'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {/* File icon */}
                        <div className="shrink-0">
                          {getFileIcon(item.fileType || 'other')}
                        </div>
                        {/* Rename input */}
                        <div className="flex-1 flex items-center gap-1 min-w-0">
                          <input
                            type="text"
                            value={item.customName}
                            onChange={(e) => updatePendingName(item.id, e.target.value)}
                            disabled={item.uploading || item.done}
                            className={`flex-1 rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-1 disabled:opacity-60 min-w-0 ${
                              item.errorCode === 'duplicate_name'
                                ? 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 focus:ring-amber-500 dark:focus:ring-amber-400 focus:border-amber-500 dark:focus:border-amber-400'
                                : 'border-border bg-background text-foreground focus:ring-sky-600'
                            }`}
                            placeholder={t('files.fileNamePlaceholder')}
                            dir={direction}
                          />
                          {item.extension && (
                            <span className={`text-xs shrink-0 ${
                              item.errorCode === 'duplicate_name' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                            }`}>.{item.extension}</span>
                          )}
                        </div>
                        {/* Remove button */}
                        {!item.uploading && !item.done && (
                          <button
                            onClick={() => removePendingUpload(item.id)}
                            className="touch-target shrink-0 flex items-center justify-center rounded text-muted-foreground hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500 dark:hover:text-rose-400 dark:text-rose-400"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Status icon */}
                        {item.done && (
                          <CheckCircle2 className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                        )}
                        {item.errorCode === 'duplicate_name' && (
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                        )}
                        {item.progress === -1 && item.errorCode !== 'duplicate_name' && (
                          <X className="h-4 w-4 text-rose-500 dark:text-rose-400 shrink-0" />
                        )}
                        {item.uploading && (
                          <Loader2 className="h-4 w-4 animate-spin text-sky-700 dark:text-sky-300 shrink-0" />
                        )}
                      </div>
                      {/* Duplicate name error message */}
                      {item.error && item.errorCode === 'duplicate_name' && (
                        <div className="flex items-start gap-1.5 px-1">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-500 dark:text-amber-400" />
                          <span className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">{item.error}</span>
                        </div>
                      )}
                      {/* Progress bar */}
                      {(item.uploading || item.done || item.progress === -1) && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">
                              {formatFileSize(item.fileSize)}
                            </span>
                            <span className={`text-[10px] font-medium ${
                              item.progress === -1 ? 'text-rose-500' : item.done ? 'text-sky-700 dark:text-sky-300' : 'text-sky-700 dark:text-sky-300'
                            }`}>
                              {item.progress === -1 ? t('files.failed') : `${Math.round(item.progress)}%`}
                            </span>
                          </div>
                          <Progress
                            value={item.progress === -1 ? 0 : item.progress}
                            className={`h-1.5 ${
                              item.progress === -1
                                ? '[&>[data-slot=progress-indicator]]:bg-rose-500'
                                : item.done
                                  ? '[&>[data-slot=progress-indicator]]:bg-sky-600'
                                  : ''
                            }`}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal footer */}
            {pendingUploads.length > 0 && (
              <div className="border-t p-4 flex items-center justify-between shrink-0 sticky bottom-0 z-10 bg-background">
                <span className="text-sm text-muted-foreground">
                  {t('files.completed', { done: pendingUploads.filter((p) => p.done).length, total: pendingUploads.length })}
                  {pendingUploads.some((p) => p.errorCode === 'duplicate_name') && (
                    <span className="text-amber-600 dark:text-amber-400 text-xs ms-1">({t('files.needRename', { count: pendingUploads.filter((p) => p.errorCode === 'duplicate_name').length })})</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setUploadModalOpen(false);
                      setPendingUploads([]);
                      fetchFiles();
                    }}
                    className="rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {t('files.close')}
                  </button>
                  {/* Upload All / Retry button — visible whenever there are uploadable files (no duplicate_name errors) and nothing is currently uploading */}
                  {pendingUploads.some((p) => !p.done && !p.uploading && p.errorCode !== 'duplicate_name' && !p.error) && (
                    <button
                      type="button"
                      onClick={handleUploadAll}
                      className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-800 active:bg-sky-900 transition-colors touch-manipulation min-h-[44px]"
                    >
                      <Upload className="h-4 w-4" />
                      {pendingUploads.some((p) => p.progress === -1 && p.errorCode !== 'duplicate_name') ? t('files.retryAll') : t('files.uploadAll')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Details Modal
  // -------------------------------------------------------
  const renderDetailsModal = () => (
    <AnimatePresence>
      {detailsFile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setDetailsFile(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir={direction}
          >
            <div className="flex items-center justify-between border-b p-5 shrink-0 sticky top-0 z-10 bg-background">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Info className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                {t('files.fileDetails')}
              </h3>
              <button
                onClick={() => setDetailsFile(null)}
                className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
              {/* File icon and name */}
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                  {getFileIcon(detailsFile.file_type)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{detailsFile.file_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{detailsFile.file_type}</p>
                </div>
              </div>
              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <HardDrive className="h-3.5 w-3.5" />
                    {t('files.size')}
                  </div>
                  <p className="text-sm font-medium text-foreground">{formatFileSize(detailsFile.file_size)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {t('files.uploadDate')}
                  </div>
                  <p className="text-sm font-medium text-foreground">{formatDate(detailsFile.created_at, locale)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <File className="h-3.5 w-3.5" />
                    {t('files.type')}
                  </div>
                  <p className="text-sm font-medium text-foreground">{getFileCategory(detailsFile.file_type)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    {detailsFile.visibility === 'public' ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    {t('files.privacy')}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {detailsFile.visibility === 'public' ? t('files.public') : t('files.private')}
                  </p>
                </div>
              </div>
              {/* Assigned courses */}
              {detailsFileCourses.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <FolderPlus className="h-3.5 w-3.5" />
                    {t('files.assignedCourses')}
                  </div>
                  <div className="space-y-2">
                    {detailsFileCourses.map((course, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5">
                        <span className="text-sm font-medium text-foreground">{course.name}</span>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            course.visibility === 'public'
                              ? 'bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                              : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                          }`}>
                            {course.visibility === 'public' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                            {course.visibility === 'public' ? t('files.public') : t('files.private')}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatDate(course.assignedAt, locale)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Shared with users */}
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Users className="h-3.5 w-3.5" />
                  {t('files.sharedWithUsers')}
                </div>
                {detailsFileShares.length > 0 ? (
                  <div className="space-y-2">
                    {detailsFileShares.map((share) => (
                      <div key={share.id} className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar name={share.shared_with_user?.name || t('common.user')} avatarUrl={share.shared_with_user?.avatar_url} size="xs" />
                          <span className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(share.shared_with_user?.name || t('common.user'), share.shared_with_user?.role, share.shared_with_user?.title_id, share.shared_with_user?.gender, t)}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {getPermissionLabel(share.permission)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatDate(share.created_at, locale)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/60">{t('files.noSharedUsers')}</p>
                )}
              </div>

              {/* Download button */}
              <button
                onClick={() => handleDownload(detailsFile)}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-sky-800 transition-colors"
              >
                <Download className="h-4 w-4" />
                {t('files.downloadFile')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Share Modal
  // -------------------------------------------------------
  const renderShareModal = () => (
    <AnimatePresence>
      {shareModalOpen && sharingFileId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={closeShareModal}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir={direction}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b p-5 shrink-0 sticky top-0 z-10 bg-background">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Share2 className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                {t('files.shareFile')}
              </h3>
              <button
                onClick={closeShareModal}
                className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
              {/* File info */}
              {(() => {
                const file = files.find((f) => f.id === sharingFileId);
                if (!file) return null;
                return (
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      {getFileIcon(file.file_type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.file_size)}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Permission selection */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">{t('files.sharePermission')}</label>
                <div className="flex items-center gap-2">
                  {(['view', 'edit', 'download'] as const).map((perm) => (
                    <button
                      key={perm}
                      onClick={() => setSelectedPermission(perm)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        selectedPermission === perm
                          ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {getPermissionIcon(perm)}
                      {getPermissionLabel(perm)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search users */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.searchUser')}</label>
                <div className="relative">
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={shareSearchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    placeholder={t('files.searchUserPlaceholder')}
                    className="w-full rounded-lg border bg-background pe-10 ps-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    dir={direction}
                    disabled={searchingUsers}
                  />
                  {searchingUsers && (
                    <Loader2 className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-sky-700 dark:text-sky-300" />
                  )}
                </div>

                {/* Search results dropdown */}
                {shareSearchResults.length > 0 && (
                  <div className="mt-2 rounded-lg border bg-background shadow-lg max-h-40 overflow-y-auto custom-scrollbar">
                    {shareSearchResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => addShareUser(user)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-end"
                      >
                        <UserAvatar name={user.name || t('common.user')} avatarUrl={user.avatar_url} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender, t)}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {user.role === 'superadmin' ? t('roles.superadmin') : user.role === 'teacher' ? t('roles.teacher') : user.role === 'student' ? t('roles.student') : user.role === 'admin' ? t('roles.admin') : user.role}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">{t('files.orShareByEmail')}</span>
                </div>
              </div>

              {/* Share by email */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.email')}</label>
                  <div className="relative">
                    <Mail className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={shareByEmail}
                      onChange={(e) => setShareByEmail(e.target.value)}
                      placeholder={t('files.enterEmailPlaceholder')}
                      className="w-full rounded-lg border bg-background pe-10 ps-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                      dir="ltr"
                      disabled={shareByEmailLoading}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && shareByEmail.trim()) {
                          handleShareByEmail();
                        }
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.emailSharePermission')}</label>
                  <div className="flex items-center gap-2">
                    {(['view', 'edit', 'download'] as const).map((perm) => (
                      <button
                        key={perm}
                        onClick={() => setShareByEmailPermission(perm)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                          shareByEmailPermission === perm
                            ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {getPermissionIcon(perm)}
                        {getPermissionLabel(perm)}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleShareByEmail}
                  disabled={shareByEmailLoading || !shareByEmail.trim()}
                  className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-sky-800 transition-colors disabled:opacity-60"
                >
                  {shareByEmailLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  {t('files.shareByEmail')}
                </button>
              </div>

              {/* Selected users badges */}
              {selectedShareUsers.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.selectedUsers')}</label>
                  <div className="flex flex-wrap gap-2">
                    {selectedShareUsers.map((user) => (
                      <Badge
                        key={user.id}
                        variant="secondary"
                        className="flex items-center gap-1.5 py-1 px-2.5"
                      >
                        <span className="text-xs font-medium">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender, t)}</span>
                        <button
                          onClick={() => removeShareUser(user.id)}
                          className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <button
                    onClick={handleShareWithSelected}
                    disabled={sharingUsers}
                    className="mt-3 flex items-center justify-center gap-2 w-full rounded-lg bg-sky-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-sky-800 transition-colors disabled:opacity-60"
                  >
                    {sharingUsers ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    {t('files.shareWithCountUsers', { count: selectedShareUsers.length })}
                  </button>
                </div>
              )}

              {/* Already shared with list */}
              {loadingShares ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-sky-700 dark:text-sky-300" />
                </div>
              ) : fileShares.length > 0 ? (
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">{t('files.sharedWith')}</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                    {fileShares.map((share) => (
                      <div
                        key={share.id}
                        className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5"
                      >
                        <UserAvatar name={share.shared_with_user?.name || t('common.user')} avatarUrl={share.shared_with_user?.avatar_url} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {formatNameWithTitle(share.shared_with_user?.name || t('common.user'), share.shared_with_user?.role, share.shared_with_user?.title_id, share.shared_with_user?.gender, t)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {getPermissionLabel(share.permission)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveShare(share.id)}
                          disabled={removingShareId === share.id}
                          className="touch-target shrink-0 flex items-center justify-center rounded text-muted-foreground hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500 dark:hover:text-rose-400 disabled:opacity-60"
                          title={t('files.removeShare')}
                        >
                          {removingShareId === share.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <UserMinus className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Assign to Course Modal
  // -------------------------------------------------------
  const renderAssignModal = () => (
    <AnimatePresence>
      {assignModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!assigning) setAssignModalOpen(false); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col overflow-hidden"
            dir={direction}
          >
            <div className="flex items-center justify-between border-b p-5 shrink-0 sticky top-0 z-10 bg-background">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                {t('files.assignToCourse')}
              </h3>
              <button
                onClick={() => { if (!assigning) setAssignModalOpen(false); }}
                className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
              {/* File info */}
              {bulkAssignMode ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                    <FolderPlus className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {t('files.selectedFilesCount', { count: selectedFileIds.size })}
                  </p>
                </div>
              ) : (() => {
                const file = files.find((f) => f.id === assigningFileId);
                if (file) {
                  return (
                    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        {getFileIcon(file.file_type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.file_size)}</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Course checkboxes */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.selectCourses')}</label>
                {assignSubjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('files.noCoursesAvailable')}</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar rounded-lg border p-2">
                    {assignSubjects.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={assignSubjectIds.has(s.id)}
                          onChange={(e) => {
                            setAssignSubjectIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id); else next.delete(s.id);
                              return next;
                            });
                          }}
                          className="rounded border-gray-300 dark:border-border text-sky-700 dark:text-sky-300 focus:ring-sky-600 dark:focus:ring-sky-500"
                        />
                        <span className="text-sm text-foreground">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {role === 'student' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2">
                  {t('files.fileWillBePublic')}
                </p>
              )}

              <button
                onClick={handleAssignToCourse}
                disabled={assigning || assignSubjectIds.size === 0}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-sky-800 transition-colors disabled:opacity-60"
              >
                {assigning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                {t('files.assign')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Preview Modal
  // -------------------------------------------------------
  const renderPreviewModal = () => (
    <AnimatePresence>
      {previewFile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPreviewFile(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0, pointerEvents: 'none' as const }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[90vh] rounded-2xl border bg-background shadow-xl overflow-hidden flex flex-col"
            dir={direction}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-4 shrink-0 sticky top-0 z-10 bg-background">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-foreground truncate">{previewFile.file_name}</h3>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{formatFileSize(previewFile.file_size)}</span>
                  <span>•</span>
                  <span>{formatDate(previewFile.created_at, locale)}</span>
                </div>
                {/* Show shared by info for shared files */}
                {previewFile.shared_by_user && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <UserAvatar name={previewFile.shared_by_user.name || t('common.user')} avatarUrl={previewFile.shared_by_user.avatar_url} size="xs" />
                    <span className="text-xs text-muted-foreground">
                      {t('files.sharedBy')} {formatNameWithTitle(previewFile.shared_by_user.name || t('common.user'), previewFile.shared_by_user.role, previewFile.shared_by_user.title_id, previewFile.shared_by_user.gender, t)}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleDownload(previewFile)}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                  title={t('common.download')}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Preview content */}
            <div className="flex-1 overflow-auto min-h-0 bg-muted/20">
              {previewFile.file_type.toLowerCase().includes('image') ? (
                <div className="flex items-center justify-center p-4 min-h-[300px]">
                  <img
                    src={previewFile.file_url}
                    alt={previewFile.file_name}
                    className="max-w-full max-h-[70vh] object-contain rounded-lg"
                  />
                </div>
              ) : previewFile.file_type.toLowerCase().includes('pdf') ? (
                <iframe
                  src={previewFile.file_url}
                  className="w-full h-[70vh] border-0"
                  title={previewFile.file_name}
                />
              ) : previewFile.file_type.toLowerCase().includes('video') ? (
                <div className="flex items-center justify-center p-4 min-h-[300px] bg-black/5">
                  <video
                    src={previewFile.file_url}
                    controls
                    className="max-w-full max-h-[70vh] rounded-lg"
                  >
                    {t('files.videoNotSupported')}
                  </video>
                </div>
              ) : previewFile.file_type.toLowerCase().includes('audio') ? (
                <div className="flex items-center justify-center p-8 min-h-[200px]">
                  <div className="w-full max-w-md text-center space-y-4">
                    <FileAudio className="h-16 w-16 mx-auto text-sky-600 dark:text-sky-400 dark:text-sky-400" />
                    <p className="text-sm font-medium text-foreground truncate">{previewFile.file_name}</p>
                    <audio
                      src={previewFile.file_url}
                      controls
                      className="w-full"
                    >
                      {t('files.audioNotSupported')}
                    </audio>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 min-h-[300px] space-y-3">
                  <File className="h-16 w-16 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('files.toastCannotPreview')}</p>
                  <button
                    onClick={() => handleDownload(previewFile)}
                    className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    {t('files.downloadFile')}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Bulk Share Modal
  // -------------------------------------------------------
  const renderBulkShareModal = () => (
    <AnimatePresence>
      {bulkShareModalOpen && selectedFileIds.size > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!bulkShareLoading) setBulkShareModalOpen(false); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir={direction}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-5 shrink-0 sticky top-0 z-10 bg-background">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Share2 className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                {t('files.bulkShare')}
              </h3>
              <button
                onClick={() => { if (!bulkShareLoading) setBulkShareModalOpen(false); }}
                className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
              {/* Selected files info */}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                  <Users className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {t('files.selectedFilesCount', { count: selectedFileIds.size })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('files.shareableFilesCount', { count: selectedFileIds.size })}
                  </p>
                </div>
              </div>

              {/* Permission selection */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">{t('files.sharePermission')}</label>
                <div className="flex items-center gap-2">
                  {(['view', 'edit', 'download'] as const).map((perm) => (
                    <button
                      key={perm}
                      onClick={() => setBulkSharePermission(perm)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        bulkSharePermission === perm
                          ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {getPermissionIcon(perm)}
                      {getPermissionLabel(perm)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search users */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.searchUsers')}</label>
                <div className="relative">
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={bulkShareSearchQuery}
                    onChange={(e) => handleBulkShareSearch(e.target.value)}
                    placeholder={t('files.searchUserPlaceholder')}
                    className="w-full rounded-lg border bg-background pe-10 ps-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    dir={direction}
                    disabled={bulkShareSearching}
                  />
                  {bulkShareSearching && (
                    <Loader2 className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-sky-700 dark:text-sky-300" />
                  )}
                </div>
                {/* Search results */}
                {bulkShareSearchResults.length > 0 && (
                  <div className="mt-2 rounded-lg border bg-background shadow-lg max-h-40 overflow-y-auto custom-scrollbar">
                    {bulkShareSearchResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => addBulkShareUser(user)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-end"
                      >
                        <UserAvatar name={user.name || t('common.user')} avatarUrl={user.avatar_url} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender, t)}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {user.role === 'superadmin' ? t('roles.superadmin') : user.role === 'teacher' ? t('roles.teacher') : user.role === 'student' ? t('roles.student') : user.role === 'admin' ? t('roles.admin') : user.role}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected users badges */}
              {bulkShareSelectedUsers.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.selectedUsers')}</label>
                  <div className="flex flex-wrap gap-2">
                    {bulkShareSelectedUsers.map((user) => (
                      <Badge
                        key={user.id}
                        variant="secondary"
                        className="flex items-center gap-1.5 py-1 px-2.5"
                      >
                        <span className="text-xs font-medium">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender, t)}</span>
                        <button
                          onClick={() => removeBulkShareUser(user.id)}
                          className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Submit button for search-based sharing */}
              <button
                onClick={handleBulkShare}
                disabled={bulkShareLoading || bulkShareSelectedUsers.length === 0}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-sky-800 transition-colors disabled:opacity-60"
              >
                {bulkShareLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                {t('files.bulkShareFilesWithUsers', { fileCount: selectedFileIds.size, userCount: bulkShareSelectedUsers.length })}
              </button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">{t('files.orShareByEmail')}</span>
                </div>
              </div>

              {/* Bulk share by email */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.email')}</label>
                  <div className="relative">
                    <Mail className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={bulkShareByEmail}
                      onChange={(e) => setBulkShareByEmail(e.target.value)}
                      placeholder={t('files.enterEmailPlaceholder')}
                      className="w-full rounded-lg border bg-background pe-10 ps-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                      dir="ltr"
                      disabled={bulkShareByEmailLoading}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && bulkShareByEmail.trim()) {
                          handleBulkShareByEmail();
                        }
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('files.emailSharePermission')}</label>
                  <div className="flex items-center gap-2">
                    {(['view', 'edit', 'download'] as const).map((perm) => (
                      <button
                        key={perm}
                        onClick={() => setBulkShareByEmailPermission(perm)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                          bulkShareByEmailPermission === perm
                            ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {getPermissionIcon(perm)}
                        {getPermissionLabel(perm)}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleBulkShareByEmail}
                  disabled={bulkShareByEmailLoading || !bulkShareByEmail.trim()}
                  className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-sky-800 transition-colors disabled:opacity-60"
                >
                  {bulkShareByEmailLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  {t('files.bulkShareByEmailAction', { count: selectedFileIds.size })}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Shared Recipients Modal (who else is this file shared with)
  // -------------------------------------------------------
  const renderRecipientsModal = () => (
    <AnimatePresence>
      {showRecipientsFile && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowRecipientsFile(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir={direction}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-5 shrink-0 sticky top-0 z-10 bg-background">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Users className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                {t('files.recipients')}
              </h3>
              <button
                onClick={() => setShowRecipientsFile(null)}
                className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
              {/* File info */}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  {getFileIcon(showRecipientsFile.file_type)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{showRecipientsFile.file_name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(showRecipientsFile.file_size)}</p>
                </div>
              </div>

              {/* Owner info */}
              {showRecipientsFile.shared_by_user && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <Share2 className="h-3.5 w-3.5" />
                    {t('files.fileOwner')}
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
                    <UserAvatar name={showRecipientsFile.shared_by_user.name || t('common.user')} avatarUrl={showRecipientsFile.shared_by_user.avatar_url} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {formatNameWithTitle(showRecipientsFile.shared_by_user.name || t('common.user'), showRecipientsFile.shared_by_user.role, showRecipientsFile.shared_by_user.title_id, showRecipientsFile.shared_by_user.gender, t)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{t('files.owner')}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Other recipients */}
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Users className="h-3.5 w-3.5" />
                  {t('files.sharedWithPeople', { count: showRecipientsFile.total_recipients_count || (showRecipientsFile.other_recipients?.length || 0) + 1 })}
                </div>
                {showRecipientsFile.other_recipients && showRecipientsFile.other_recipients.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {showRecipientsFile.other_recipients.map((recipient) => (
                      <div key={recipient.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
                        <UserAvatar name={recipient.name || t('common.user')} avatarUrl={recipient.avatar_url} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {formatNameWithTitle(recipient.name || t('common.user'), recipient.role, recipient.title_id, recipient.gender, t)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {getPermissionLabel(recipient.permission as 'view' | 'edit' | 'download')}
                          </p>
                        </div>
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {getPermissionIcon(recipient.permission as 'view' | 'edit' | 'download')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/60">{t('files.soleRecipient')}</p>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Main Render
  // -------------------------------------------------------
  return (
    <div className="space-y-6" dir={direction}>
      {/* Tabs: My Files / Shared with me */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab('my-files')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
            activeTab === 'my-files'
              ? 'bg-sky-700 text-white shadow-sm'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {t('files.myFiles')}
        </button>
        <button
          onClick={() => setActiveTab('shared')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-all flex items-center gap-1.5 ${
            activeTab === 'shared'
              ? 'bg-sky-700 text-white shadow-sm'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {t('files.sharedWithMe')}
          {sharedWithMe.length > 0 && (
            <span className={`inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[18px] h-[18px] px-1 ${
              activeTab === 'shared'
                ? 'bg-white/20 dark:bg-muted/20 text-white'
                : 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200'
            }`}>
              {sharedWithMe.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'my-files' ? renderMyFiles() : renderSharedWithMe()}
        </motion.div>
      </AnimatePresence>

      {/* Modals */}
      {renderUploadModal()}
      {renderDetailsModal()}
      {renderShareModal()}
      {renderAssignModal()}
      {renderPreviewModal()}
      {renderBulkShareModal()}
      {renderRecipientsModal()}
    </div>
  );
}
