'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

// -------------------------------------------------------
// File type categories
// -------------------------------------------------------
type FileCategory = 'الكل' | 'صور' | 'مستندات' | 'فيديوهات' | 'صوتيات' | 'أخرى';

const FILE_CATEGORIES: FileCategory[] = ['الكل', 'صور', 'مستندات', 'فيديوهات', 'صوتيات', 'أخرى'];

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
    return 'صور';
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
    return 'مستندات';
  }
  if (lower.includes('video') || lower.includes('mp4') || lower.includes('avi') || lower.includes('mov') || lower.includes('webm')) {
    return 'فيديوهات';
  }
  if (lower.includes('audio') || lower.includes('mp3') || lower.includes('wav') || lower.includes('ogg') || lower.includes('mpeg')) {
    return 'صوتيات';
  }
  return 'أخرى';
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
interface SharedFileWithInfo extends UserFile {
  shared_by_user?: UserProfile;
  shared_at?: string;
  permission?: 'view' | 'edit' | 'download';
}

// -------------------------------------------------------
// Pending upload item
// -------------------------------------------------------
interface PendingUpload {
  id: string;
  file: File;
  customName: string;
  extension: string;
  progress: number; // -1 = failed, 0-100 = progress
  uploading: boolean;
  done: boolean;
  errorMessage?: string;
}

// Client-side validation constants (must match server-side in /api/files/upload/route.ts)
const CLIENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-rar-compressed',
];

const CLIENT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const CLIENT_ACCEPT_ATTR = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp4,.webm,.mov,.mp3,.wav,.ogg,.txt,.csv,.zip,.rar';

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function PersonalFilesSection({ profile, role }: PersonalFilesSectionProps) {
  const { openProfile } = useAppStore();

  // ─── Tab state ───
  const [activeTab, setActiveTab] = useState<'my-files' | 'shared'>('my-files');
  const [categoryFilter, setCategoryFilter] = useState<FileCategory>('الكل');
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
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // ─── Preview modal state ───
  const [previewFile, setPreviewFile] = useState<UserFile | null>(null);

  // -------------------------------------------------------
  // Fetch my files
  // -------------------------------------------------------
  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
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
      const { data: shares, error: sharesError } = await supabase
        .from('file_shares')
        .select('*')
        .eq('shared_with', profile.id)
        .order('created_at', { ascending: false });

      if (sharesError) {
        console.error('Error fetching shared files:', sharesError);
        setSharedWithMe([]);
      } else if (shares && shares.length > 0) {
        const sharedFiles: SharedFileWithInfo[] = [];
        for (const share of shares) {
          const { data: fileData } = await supabase
            .from('user_files')
            .select('*')
            .eq('id', share.file_id)
            .single();

          if (fileData) {
            const { data: sharerProfile } = await supabase
              .from('users')
              .select('*')
              .eq('id', share.shared_by)
              .single();

            sharedFiles.push({
              ...(fileData as UserFile),
              shared_by_user: (sharerProfile as UserProfile) || undefined,
              shared_at: share.created_at,
              permission: share.permission,
            });
          }
        }
        setSharedWithMe(sharedFiles);
      } else {
        setSharedWithMe([]);
      }
    } catch (err) {
      console.error('Fetch shared files error:', err);
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
    fetchFiles();
  }, [fetchFiles]);

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
    if (categoryFilter !== 'الكل') {
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
  const handleFileSelect = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const rejectedFiles: string[] = [];
    const newUploads: PendingUpload[] = [];

    Array.from(fileList).forEach((file) => {
      // Client-side validation: file size
      if (file.size > CLIENT_MAX_FILE_SIZE) {
        rejectedFiles.push(`${file.name}: حجم الملف يتجاوز 50 ميجابايت`);
        return;
      }
      // Client-side validation: MIME type
      if (file.type && !CLIENT_ALLOWED_MIME_TYPES.includes(file.type)) {
        rejectedFiles.push(`${file.name}: نوع الملف غير مدعوم`);
        return;
      }
      newUploads.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        customName: file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name,
        extension: getFileExtension(file.name),
        progress: 0,
        uploading: false,
        done: false,
      });
    });

    if (rejectedFiles.length > 0) {
      toast.error(`تم رفض ${rejectedFiles.length} ملف: ${rejectedFiles[0]}${rejectedFiles.length > 1 ? ` و${rejectedFiles.length - 1} أخرى` : ''}`);
    }

    if (newUploads.length > 0) {
      setPendingUploads((prev) => [...prev, ...newUploads]);
    }
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
      prev.map((p) => (p.id === id ? { ...p, customName: name } : p))
    );
  };

  // -------------------------------------------------------
  // Upload a single file using XHR (shared by handleUploadAll and retryUpload)
  // -------------------------------------------------------
  const uploadSingleFile = async (item: PendingUpload): Promise<string> => {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';

    // Mark as uploading
    setPendingUploads((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, uploading: true, progress: 0, errorMessage: undefined } : p))
    );

    const userFileId = await new Promise<string>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('userId', profile.id);
      if (item.customName.trim()) {
        formData.append('customName', item.customName.trim());
      }

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setPendingUploads((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p))
          );
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (result.success) {
              setPendingUploads((prev) =>
                prev.map((p) => (p.id === item.id ? { ...p, progress: 100, done: true, uploading: false } : p))
              );
              resolve(result.data?.id || '');
            } else {
              reject(new Error(result.error || 'فشل الرفع'));
            }
          } catch {
            reject(new Error('استجابة غير صالحة من الخادم'));
          }
        } else {
          // Try to parse error message from response
          try {
            const errResult = JSON.parse(xhr.responseText);
            reject(new Error(errResult.error || `خطأ HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`خطأ HTTP ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('خطأ في الشبكة')));
      xhr.addEventListener('abort', () => reject(new Error('تم الإلغاء')));

      xhr.open('POST', '/api/files/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });

    // If subjects are selected, also assign to courses
    if (selectedSubjectForUploadIds.size > 0) {
      const { data: { session: session2 } } = await supabase.auth.getSession();
      const token2 = session2?.access_token || '';

      for (const subjectId of selectedSubjectForUploadIds) {
        const courseFormData = new FormData();
        courseFormData.append('file', item.file);
        courseFormData.append('subjectId', subjectId);
        courseFormData.append('uploadedBy', profile.id);
        if (item.customName.trim()) {
          courseFormData.append('customName', item.customName.trim());
        }
        courseFormData.append('visibility', 'public');
        if (userFileId) {
          courseFormData.append('userFileId', userFileId);
        }

        await fetch('/api/files/course-upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token2}` },
          body: courseFormData,
        });
      }

      // Also update the user_file visibility to public
      if (userFileId) {
        await supabase
          .from('user_files')
          .update({ visibility: 'public', updated_at: new Date().toISOString() })
          .eq('id', userFileId);
      }
    }

    return userFileId;
  };

  // -------------------------------------------------------
  // Upload all pending files (including failed ones for retry)
  // -------------------------------------------------------
  const handleUploadAll = async () => {
    // Include failed uploads (progress === -1) for retry
    const toUpload = pendingUploads.filter((p) => !p.done && !p.uploading);
    if (toUpload.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const item of toUpload) {
      try {
        await uploadSingleFile(item);
        successCount++;
      } catch (err) {
        failCount++;
        const errMsg = err instanceof Error ? err.message : 'فشل الرفع';
        setPendingUploads((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, progress: -1, uploading: false, errorMessage: errMsg } : p))
        );
      }
    }

    // Show appropriate toast based on results
    if (successCount > 0 && failCount === 0) {
      toast.success(`تم رفع ${successCount} ملف بنجاح`);
    } else if (successCount > 0 && failCount > 0) {
      toast.success(`تم رفع ${successCount} ملف بنجاح (${failCount} فشل)`);
    } else if (failCount > 0) {
      toast.error(`فشل رفع ${failCount} ملف`);
    }

    // Refresh file list and close modal if all succeeded
    fetchFiles();
    if (failCount === 0 && successCount > 0) {
      // Auto-close modal after a short delay so user can see completion
      setTimeout(() => {
        setUploadModalOpen(false);
        setPendingUploads([]);
      }, 800);
    }
  };

  // -------------------------------------------------------
  // Retry a single failed upload
  // -------------------------------------------------------
  const retryUpload = async (itemId: string) => {
    const item = pendingUploads.find((p) => p.id === itemId);
    if (!item || item.uploading || item.done) return;

    try {
      await uploadSingleFile(item);
      toast.success('تم رفع الملف بنجاح');
      fetchFiles();
      // If all uploads are now done, auto-close
      const allDone = pendingUploads.every((p) => p.id === itemId ? true : p.done);
      if (allDone) {
        setTimeout(() => {
          setUploadModalOpen(false);
          setPendingUploads([]);
        }, 800);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'فشل الرفع';
      setPendingUploads((prev) =>
        prev.map((p) => (p.id === itemId ? { ...p, progress: -1, uploading: false, errorMessage: errMsg } : p))
      );
      toast.error(errMsg);
    }
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
        toast.error('حدث خطأ أثناء حذف الملف');
      } else {
        toast.success('تم حذف الملف بنجاح');
        fetchFiles();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
        toast.error('حدث خطأ أثناء إعادة التسمية');
      } else {
        toast.success('تم إعادة التسمية بنجاح');
        fetchFiles();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
          toast.error('لا يمكن جعل الملف خاصاً لأنه مسند لمقرر. يجب إزالة الإسناد أولاً.');
          return;
        }
      }

      const { error } = await supabase
        .from('user_files')
        .update({ visibility: newVisibility, updated_at: new Date().toISOString() })
        .eq('id', fileId);
      if (error) {
        // Column might not exist yet
        toast.error('حدث خطأ أثناء تغيير الخصوصية');
      } else {
        toast.success(newVisibility === 'public' ? 'تم جعل الملف عاماً' : 'تم جعل الملف خاصاً');
        fetchFiles();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    }
  };

  // -------------------------------------------------------
  // Share files with selected users
  // -------------------------------------------------------
  const handleShareWithSelected = async () => {
    if (!sharingFileId || selectedShareUsers.length === 0) return;
    setSharingUsers(true);
    try {
      const alreadySharedIds = new Set(fileShares.map((s) => s.shared_with));
      const newUsers = selectedShareUsers.filter((u) => !alreadySharedIds.has(u.id));

      for (const user of newUsers) {
        const { error } = await supabase.from('file_shares').insert({
          file_id: sharingFileId,
          shared_by: profile.id,
          shared_with: user.id,
          permission: selectedPermission,
        });
        if (error && error.code !== '23505') {
          console.error('Share error:', error);
        }
      }

      toast.success(`تمت المشاركة مع ${newUsers.length} مستخدم`);
      setSelectedShareUsers([]);
      setShareSearchQuery('');
      setShareSearchResults([]);
      if (sharingFileId) fetchFileShares(sharingFileId);
    } catch {
      toast.error('حدث خطأ أثناء المشاركة');
    } finally {
      setSharingUsers(false);
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
        toast.error('حدث خطأ أثناء إزالة المشاركة');
      } else {
        toast.success('تم إزالة المشاركة بنجاح');
        if (sharingFileId) fetchFileShares(sharingFileId);
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
    if (!file || file.visibility !== 'public') {
      toast.error('فقط الملفات العامة يمكن مشاركتها مع المستخدمين');
      return;
    }
    setSharingFileId(fileId);
    setShareSearchQuery('');
    setShareSearchResults([]);
    setSelectedShareUsers([]);
    setSelectedPermission('view');
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
          .eq('file_url', file.file_url);
      }

      const sharesResult = await supabase
        .from('file_shares')
        .select('*')
        .eq('file_id', file.id);

      // Process courses
      const linkedFiles = coursesResult.data;
      if (linkedFiles && linkedFiles.length > 0) {
        setDetailsFileCourses(linkedFiles.map((sf: Record<string, unknown>) => ({
          name: (sf.subjects as Record<string, string>)?.name || 'مقرر محذوف',
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
        toast.error('فقط الملفات العامة يمكن إسنادها للمقررات');
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
      const res = await fetch('/api/files/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: fileIdsToAssign,
          subjectIds: Array.from(assignSubjectIds),
          userId: profile.id,
        }),
      });
      const result = await res.json();
      if (result.success) {
        const { created, skipped } = result.data;
        let msg = `تم إسناد ${created} ملف بنجاح`;
        if (skipped > 0) msg += ` (تم تخطي ${skipped} إسناد موجود)`;
        toast.success(msg);
      } else {
        toast.error(result.error || 'حدث خطأ أثناء الإسناد');
      }
      setAssignModalOpen(false);
      setBulkAssignMode(false);
      setSelectedFileIds(new Set());
      fetchFiles();
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      const publicSelectedIds = Array.from(selectedFileIds).filter(
        (id) => files.find((f) => f.id === id)?.visibility === 'public'
      );
      if (publicSelectedIds.length === 0) {
        toast.error('فقط الملفات العامة يمكن مشاركتها');
        return;
      }
      const res = await fetch('/api/files/bulk-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: publicSelectedIds,
          userIds: bulkShareSelectedUsers.map((u) => u.id),
          permission: bulkSharePermission,
          sharedBy: profile.id,
        }),
      });
      const result = await res.json();
      if (result.success) {
        const { created, skipped } = result.data;
        let msg = `تمت المشاركة بنجاح (${created} مشاركة جديدة)`;
        if (skipped > 0) msg += ` - تم تخطي ${skipped} مشاركة موجودة`;
        toast.success(msg);
        setBulkShareModalOpen(false);
        setBulkShareSelectedUsers([]);
        setSelectedFileIds(new Set());
      } else {
        toast.error(result.error || 'حدث خطأ أثناء المشاركة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
      toast.success(`تم حذف ${deleted} ملف`);
      setSelectedFileIds(new Set());
      setConfirmBulkDelete(false);
      fetchFiles();
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
            toast.error('بعض الملفات المحددة مسندة لمقررات ولا يمكن جعلها خاصة');
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
      toast.success(updated > 1 ? `تم تغيير خصوصية ${updated} ملف` : 'تم تغيير خصوصية الملف');
      setSelectedFileIds(new Set());
      fetchFiles();
    } catch {
      toast.error('حدث خطأ غير متوقع');
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
  // Preview file
  // -------------------------------------------------------
  const handlePreview = (file: UserFile) => {
    const lower = file.file_type.toLowerCase();
    if (lower.includes('image') || lower.includes('pdf')) {
      setPreviewFile(file);
    } else {
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
      case 'view': return 'عرض';
      case 'edit': return 'تعديل';
      case 'download': return 'تحميل';
    }
  }

  // -------------------------------------------------------
  // Render: File Action Dropdown Menu
  // -------------------------------------------------------
  const renderFileCard = (file: UserFile) => {
    const isRenaming = renamingFileId === file.id;
    const fileCategory = getFileCategory(file.file_type);

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
                className="flex-1 rounded-md border border-emerald-500 bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                autoFocus
                dir="rtl"
              />
              <span className="text-xs text-muted-foreground">.{getFileExtension(file.file_name)}</span>
              <button
                onClick={() => handleRenameFile(file.id)}
                disabled={renaming}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
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
                <span>{formatDate(file.created_at)}</span>
              </div>
            </div>

            {/* Checkbox for multi-select */}
            <button
              onClick={() => toggleFileSelection(file.id)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                selectedFileIds.has(file.id)
                  ? 'text-emerald-600'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {selectedFileIds.has(file.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </button>

            {/* Action menu */}
            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem
                  onClick={() => {
                    setRenamingFileId(file.id);
                    const ext = getFileExtension(file.file_name);
                    setRenameValue(file.file_name.replace(new RegExp(`\\.${ext}$`), ''));
                  }}
                >
                  <Pencil className="h-4 w-4 ml-2" />
                  تعديل
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openDetailsModal(file)}>
                  <Info className="h-4 w-4 ml-2" />
                  تفاصيل
                </DropdownMenuItem>
                {file.visibility === 'public' && (
                  <DropdownMenuItem onClick={() => openShareModal(file.id)}>
                    <Share2 className="h-4 w-4 ml-2" />
                    مشاركة
                  </DropdownMenuItem>
                )}
                {file.visibility === 'public' && (
                  <DropdownMenuItem onClick={() => openAssignModal(file.id)}>
                    <FolderPlus className="h-4 w-4 ml-2" />
                    اسناد لمقرر
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handlePreview(file)}>
                  <Maximize2 className="h-4 w-4 ml-2" />
                  معاينة
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleToggleVisibility(file.id, file.visibility || 'private')}>
                  {file.visibility === 'public' ? (
                    <>
                      <Lock className="h-4 w-4 ml-2" />
                      جعله خاصاً
                    </>
                  ) : (
                    <>
                      <Globe className="h-4 w-4 ml-2" />
                      جعله عاماً
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConfirmDeleteId(file.id)}
                  className="text-rose-600 focus:text-rose-600 focus:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4 ml-2" />
                  حذف
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* File type tag, visibility badge & category */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                {file.file_type.split('/').pop() || file.file_type}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                file.visibility === 'public'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                {file.visibility === 'public' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {file.visibility === 'public' ? 'عام' : 'خاص'}
              </span>
            </div>
            {categoryFilter === 'الكل' && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">
                {fileCategory}
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
                <span className="text-sm font-medium text-foreground">حذف هذا الملف؟</span>
                <button
                  onClick={() => handleDeleteFile(file.id)}
                  disabled={deletingFileId === file.id}
                  className="flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {deletingFileId === file.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'تأكيد'}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex items-center rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                >
                  إلغاء
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
          <h2 className="text-2xl font-bold text-foreground">ملفاتي</h2>
          <p className="text-muted-foreground mt-1">إدارة ملفاتك الشخصية ومشاركتها</p>
        </div>
        <button
          onClick={openUploadModal}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
        >
          <Upload className="h-4 w-4" />
          رفع ملف
        </button>
      </motion.div>

      {/* Visibility filter tabs */}
      <motion.div variants={itemVariants} className="flex items-center gap-2">
        {([
          { key: 'all' as const, label: 'الكل', icon: null, count: files.length },
          { key: 'public' as const, label: 'عام', icon: <Globe className="h-3 w-3" />, count: files.filter((f) => f.visibility === 'public').length },
          { key: 'private' as const, label: 'خاص', icon: <Lock className="h-3 w-3" />, count: files.filter((f) => f.visibility !== 'public').length },
        ]).map((vf) => (
          <button
            key={vf.key}
            onClick={() => setVisibilityFilter(vf.key)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
              visibilityFilter === vf.key
                ? vf.key === 'public'
                  ? 'bg-emerald-100 text-emerald-700'
                  : vf.key === 'private'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {vf.icon}
            {vf.label}
            <span className={`text-[10px] ${visibilityFilter === vf.key ? (vf.key === 'private' ? 'text-amber-600' : 'text-emerald-600') : 'text-muted-foreground'}`}>
              ({vf.count})
            </span>
          </button>
        ))}
      </motion.div>

      {/* Category filter tabs */}
      <motion.div variants={itemVariants} className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILE_CATEGORIES.map((cat) => {
          const count = cat === 'الكل' ? files.length : files.filter((f) => getFileCategory(f.file_type) === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {cat}
              <span className={`text-[10px] ${categoryFilter === cat ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Select all + count */}
      {!loadingFiles && filteredFiles.length > 0 && (
        <motion.div variants={itemVariants} className="flex items-center gap-3">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {selectedFileIds.size === filteredFiles.length && filteredFiles.length > 0 ? (
              <CheckSquare className="h-4 w-4 text-emerald-600" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            تحديد الكل
          </button>
          {selectedFileIds.size > 0 && (
            <span className="text-xs text-emerald-600 font-medium">
              تم تحديد {selectedFileIds.size} ملف
            </span>
          )}
        </motion.div>
      )}

      {/* Files grid */}
      {loadingFiles ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : filteredFiles.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <FileText className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد ملفات بعد</p>
          <p className="text-sm text-muted-foreground">
            {visibilityFilter !== 'all' && categoryFilter === 'الكل'
              ? visibilityFilter === 'public' ? 'لا توجد ملفات عامة' : 'لا توجد ملفات خاصة'
              : categoryFilter !== 'الكل' ? 'لا توجد ملفات في هذا التصنيف' : 'ارفع ملفاتك الأولى من زر الرفع أعلاه'}
          </p>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
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
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border bg-background shadow-lg px-5 py-3"
            dir="rtl"
          >
            <span className="text-sm font-medium text-foreground whitespace-nowrap">
              تم تحديد {selectedFileIds.size} ملف
            </span>
            <div className="h-6 w-px bg-border" />
            {confirmBulkDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-600 font-medium">حذف الملفات المحددة؟</span>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {bulkActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'تأكيد'}
                </button>
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  className="rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <>
                <DropdownMenu dir="rtl">
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1.5 rounded-md bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 transition-colors">
                      إجراءات
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem
                      onClick={() => setConfirmBulkDelete(true)}
                      className="text-rose-600 focus:text-rose-600 focus:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4 ml-2" />
                      حذف
                    </DropdownMenuItem>
                    {Array.from(selectedFileIds).some(id => files.find(f => f.id === id)?.visibility !== 'public') && (
                      <DropdownMenuItem
                        onClick={() => handleBulkVisibility('public')}
                        disabled={bulkActionLoading}
                        className="cursor-pointer"
                      >
                        <Globe className="h-4 w-4 ml-2" />
                        جعل عاماً
                      </DropdownMenuItem>
                    )}
                    {Array.from(selectedFileIds).some(id => files.find(f => f.id === id)?.visibility === 'public') && (
                      <DropdownMenuItem
                        onClick={() => handleBulkVisibility('private')}
                        disabled={bulkActionLoading}
                        className="cursor-pointer"
                      >
                        <Lock className="h-4 w-4 ml-2" />
                        جعل خاصاً
                      </DropdownMenuItem>
                    )}
                    {Array.from(selectedFileIds).every(id => files.find(f => f.id === id)?.visibility === 'public') && (
                      <DropdownMenuItem
                        onClick={() => openAssignModal(null, true)}
                        className="cursor-pointer"
                      >
                        <FolderPlus className="h-4 w-4 ml-2" />
                        إسناد لمقررات
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
                      <Download className="h-4 w-4 ml-2" />
                      تحميل
                    </DropdownMenuItem>
                    {Array.from(selectedFileIds).every(id => files.find(f => f.id === id)?.visibility === 'public') && (
                      <DropdownMenuItem
                        onClick={() => openBulkShareModal()}
                        className="cursor-pointer"
                      >
                        <Share2 className="h-4 w-4 ml-2" />
                        مشاركة مع مستخدمين
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={() => setSelectedFileIds(new Set())}
                  className="flex items-center gap-1 rounded-md bg-muted text-muted-foreground px-3 py-1.5 text-xs font-medium hover:bg-muted/80 transition-colors"
                >
                  <X className="h-3 w-3" />
                  إلغاء التحديد
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
        <h2 className="text-2xl font-bold text-foreground">مشاركة معي</h2>
        <p className="text-muted-foreground mt-1">الملفات التي شاركها معك الآخرون</p>
      </motion.div>

      {/* Shared files list */}
      {loadingShared ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : sharedWithMe.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <Share2 className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد ملفات مشاركة</p>
          <p className="text-sm text-muted-foreground">عندما يشاركك أحد ملفاً سيظهر هنا</p>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {sharedWithMe.map((file) => (
            <motion.div key={`${file.id}-shared`} variants={itemVariants}>
              <div className="group relative rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-all">
                {/* Shared by info */}
                <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                  <UserAvatar name={file.shared_by_user?.name || 'مستخدم'} avatarUrl={file.shared_by_user?.avatar_url} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground truncate">
                      شارك معك{' '}
                      <button
                        onClick={() => file.shared_by_user?.id && openProfile(file.shared_by_user.id)}
                        className="font-medium text-foreground hover:text-emerald-600 transition-colors cursor-pointer"
                      >
                        {formatNameWithTitle(file.shared_by_user?.name || 'مستخدم', file.shared_by_user?.role, file.shared_by_user?.title_id, file.shared_by_user?.gender)}
                      </button>
                      {' هذا الملف'}
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
                      <span>{formatDate(file.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Download button */}
                <button
                  onClick={() => handleDownload(file)}
                  className="flex items-center justify-center gap-2 w-full rounded-lg bg-emerald-50 text-emerald-700 px-3 py-2 text-xs font-medium hover:bg-emerald-100 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  تحميل الملف
                </button>
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
          exit={{ opacity: 0 }}
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
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir="rtl"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b p-5 shrink-0">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Upload className="h-5 w-5 text-emerald-600" />
                رفع ملفات
              </h3>
              <button
                onClick={() => {
                  if (!pendingUploads.some((p) => p.uploading)) {
                    setUploadModalOpen(false);
                    setPendingUploads([]);
                  }
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4 overflow-y-auto min-h-0 custom-scrollbar">
              {/* Course assignment (optional) */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  اسناد لمقررات (اختياري)
                </label>
                {loadingSubjects ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جارٍ تحميل المقررات...
                  </div>
                ) : subjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">لا توجد مقررات متاحة</p>
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
                          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-sm text-foreground">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* File picker */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={CLIENT_ACCEPT_ATTR}
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
                    handleFileSelect(e.dataTransfer.files);
                  }}
                  className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
                    isDragOver
                      ? 'border-emerald-500 bg-emerald-50/60'
                      : 'border-emerald-300 bg-emerald-50/30 hover:border-emerald-400 hover:bg-emerald-50/50'
                  }`}
                >
                  <Upload className={`h-8 w-8 ${isDragOver ? 'text-emerald-600' : 'text-emerald-400'}`} />
                  <span className="text-sm text-muted-foreground">
                    {isDragOver ? 'أفلت الملفات هنا' : 'اضغط لاختيار ملفات أو اسحبها هنا'}
                  </span>
                  <span className="text-xs text-muted-foreground">يمكنك اختيار أكثر من ملف (الحد الأقصى 50 ميجابايت لكل ملف)</span>
                </div>
              </div>

              {/* Pending uploads list */}
              {pendingUploads.length > 0 && (
                <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar">
                  {pendingUploads.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border bg-card p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        {/* File icon */}
                        <div className="shrink-0">
                          {getFileIcon(item.file.type || 'other')}
                        </div>
                        {/* Rename input */}
                        <div className="flex-1 flex items-center gap-1 min-w-0">
                          <input
                            type="text"
                            value={item.customName}
                            onChange={(e) => updatePendingName(item.id, e.target.value)}
                            disabled={item.uploading || item.done}
                            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60 min-w-0"
                            placeholder="اسم الملف"
                            dir="rtl"
                          />
                          {item.extension && (
                            <span className="text-xs text-muted-foreground shrink-0">.{item.extension}</span>
                          )}
                        </div>
                        {/* Retry button for failed uploads */}
                        {item.progress === -1 && !item.uploading && (
                          <button
                            onClick={() => retryUpload(item.id)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                            title="إعادة المحاولة"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Remove button */}
                        {!item.uploading && !item.done && (
                          <button
                            onClick={() => removePendingUpload(item.id)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-rose-50 hover:text-rose-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Status icon */}
                        {item.done && (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        )}
                        {item.progress === -1 && (
                          <X className="h-4 w-4 text-rose-500 shrink-0" />
                        )}
                        {item.uploading && (
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-600 shrink-0" />
                        )}
                      </div>
                      {/* Progress bar */}
                      {(item.uploading || item.done || item.progress === -1) && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">
                              {formatFileSize(item.file.size)}
                            </span>
                            <span className={`text-[10px] font-medium ${
                              item.progress === -1 ? 'text-rose-500' : item.done ? 'text-emerald-600' : 'text-emerald-600'
                            }`}>
                              {item.progress === -1 ? 'فشل' : `${Math.round(item.progress)}%`}
                            </span>
                          </div>
                          <Progress
                            value={item.progress === -1 ? 0 : item.progress}
                            className={`h-1.5 ${
                              item.progress === -1
                                ? '[&>[data-slot=progress-indicator]]:bg-rose-500'
                                : item.done
                                  ? '[&>[data-slot=progress-indicator]]:bg-emerald-500'
                                  : ''
                            }`}
                          />
                          {/* Error message */}
                          {item.progress === -1 && item.errorMessage && (
                            <div className="flex items-center gap-1 text-[10px] text-rose-500 mt-0.5">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              <span className="truncate">{item.errorMessage}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal footer */}
            {pendingUploads.length > 0 && (
              <div className="border-t p-4 flex items-center justify-between shrink-0">
                <span className="text-sm text-muted-foreground">
                  {pendingUploads.filter((p) => p.done).length}/{pendingUploads.length} مكتمل
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
                    إغلاق
                  </button>
                  {pendingUploads.some((p) => !p.done && !p.uploading) && (
                    <button
                      onClick={handleUploadAll}
                      className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      {pendingUploads.some((p) => p.progress === -1) ? 'إعادة محاولة الكل' : 'رفع الكل'}
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
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setDetailsFile(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b p-5 shrink-0">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Info className="h-5 w-5 text-emerald-600" />
                تفاصيل الملف
              </h3>
              <button
                onClick={() => setDetailsFile(null)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
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
                    الحجم
                  </div>
                  <p className="text-sm font-medium text-foreground">{formatFileSize(detailsFile.file_size)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Calendar className="h-3.5 w-3.5" />
                    تاريخ الرفع
                  </div>
                  <p className="text-sm font-medium text-foreground">{formatDate(detailsFile.created_at)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <File className="h-3.5 w-3.5" />
                    النوع
                  </div>
                  <p className="text-sm font-medium text-foreground">{getFileCategory(detailsFile.file_type)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    {detailsFile.visibility === 'public' ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    الخصوصية
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {detailsFile.visibility === 'public' ? 'عام' : 'خاص'}
                  </p>
                </div>
              </div>
              {/* Assigned courses */}
              {detailsFileCourses.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <FolderPlus className="h-3.5 w-3.5" />
                    المقررات المسند إليها
                  </div>
                  <div className="space-y-2">
                    {detailsFileCourses.map((course, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5">
                        <span className="text-sm font-medium text-foreground">{course.name}</span>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            course.visibility === 'public'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            {course.visibility === 'public' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                            {course.visibility === 'public' ? 'عام' : 'خاص'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatDate(course.assignedAt)}</span>
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
                  مشارك مع المستخدمين
                </div>
                {detailsFileShares.length > 0 ? (
                  <div className="space-y-2">
                    {detailsFileShares.map((share) => (
                      <div key={share.id} className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <UserAvatar name={share.shared_with_user?.name || 'مستخدم'} avatarUrl={share.shared_with_user?.avatar_url} size="xs" />
                          <span className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(share.shared_with_user?.name || 'مستخدم', share.shared_with_user?.role, share.shared_with_user?.title_id, share.shared_with_user?.gender)}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {getPermissionLabel(share.permission)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatDate(share.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/60">لا يوجد مستخدمون مشاركون</p>
                )}
              </div>

              {/* Download button */}
              <button
                onClick={() => handleDownload(detailsFile)}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                تحميل الملف
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
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={closeShareModal}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir="rtl"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b p-5 shrink-0">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Share2 className="h-5 w-5 text-emerald-600" />
                مشاركة الملف
              </h3>
              <button
                onClick={closeShareModal}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
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
                <label className="text-sm font-medium text-foreground mb-2 block">صلاحية المشاركة</label>
                <div className="flex items-center gap-2">
                  {(['view', 'edit', 'download'] as const).map((perm) => (
                    <button
                      key={perm}
                      onClick={() => setSelectedPermission(perm)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        selectedPermission === perm
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
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
                <label className="text-sm font-medium text-foreground mb-1.5 block">البحث عن مستخدم</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={shareSearchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    placeholder="ابحث بالاسم أو البريد الإلكتروني..."
                    className="w-full rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    dir="rtl"
                    disabled={searchingUsers}
                  />
                  {searchingUsers && (
                    <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-emerald-600" />
                  )}
                </div>

                {/* Search results dropdown */}
                {shareSearchResults.length > 0 && (
                  <div className="mt-2 rounded-lg border bg-background shadow-lg max-h-40 overflow-y-auto custom-scrollbar">
                    {shareSearchResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => addShareUser(user)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-right"
                      >
                        <UserAvatar name={user.name || 'مستخدم'} avatarUrl={user.avatar_url} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender)}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {user.role === 'superadmin' ? 'مدير المنصة' : user.role === 'teacher' ? 'معلم' : user.role === 'student' ? 'طالب' : user.role === 'admin' ? 'مشرف' : user.role}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected users badges */}
              {selectedShareUsers.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">المستخدمون المحددون</label>
                  <div className="flex flex-wrap gap-2">
                    {selectedShareUsers.map((user) => (
                      <Badge
                        key={user.id}
                        variant="secondary"
                        className="flex items-center gap-1.5 py-1 px-2.5"
                      >
                        <span className="text-xs font-medium">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender)}</span>
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
                    className="mt-3 flex items-center justify-center gap-2 w-full rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
                  >
                    {sharingUsers ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    مشاركة مع {selectedShareUsers.length} مستخدم
                  </button>
                </div>
              )}

              {/* Already shared with list */}
              {loadingShares ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                </div>
              ) : fileShares.length > 0 ? (
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">مشارك مع</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                    {fileShares.map((share) => (
                      <div
                        key={share.id}
                        className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5"
                      >
                        <UserAvatar name={share.shared_with_user?.name || 'مستخدم'} avatarUrl={share.shared_with_user?.avatar_url} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {formatNameWithTitle(share.shared_with_user?.name || 'مستخدم', share.shared_with_user?.role, share.shared_with_user?.title_id, share.shared_with_user?.gender)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {getPermissionLabel(share.permission)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveShare(share.id)}
                          disabled={removingShareId === share.id}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-rose-50 hover:text-rose-500 disabled:opacity-60"
                          title="إزالة المشاركة"
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
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!assigning) setAssignModalOpen(false); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border bg-background shadow-xl"
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b p-5">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-emerald-600" />
                اسناد لمقرر
              </h3>
              <button
                onClick={() => { if (!assigning) setAssignModalOpen(false); }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* File info */}
              {bulkAssignMode ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <FolderPlus className="h-4 w-4 text-emerald-600" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {selectedFileIds.size} ملف محدد
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
                <label className="text-sm font-medium text-foreground mb-1.5 block">اختر المقررات</label>
                {assignSubjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">لا توجد مقررات متاحة</p>
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
                          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-sm text-foreground">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {role === 'student' && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
                  سيتم جعل الملف عاماً تلقائياً عند إسناده للمقرر
                </p>
              )}

              <button
                onClick={handleAssignToCourse}
                disabled={assigning || assignSubjectIds.size === 0}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {assigning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                اسناد
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
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPreviewFile(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[90vh] rounded-2xl border bg-background shadow-xl overflow-hidden flex flex-col"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-4 shrink-0">
              <h3 className="text-sm font-bold text-foreground truncate">{previewFile.file_name}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(previewFile)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                  title="تحميل"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
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
              ) : null}
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
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!bulkShareLoading) setBulkShareModalOpen(false); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border bg-background shadow-xl max-h-[85vh] flex flex-col"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-5 shrink-0">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Share2 className="h-5 w-5 text-emerald-600" />
                مشاركة جماعية
              </h3>
              <button
                onClick={() => { if (!bulkShareLoading) setBulkShareModalOpen(false); }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
              {/* Selected files info */}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                  <Users className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {selectedFileIds.size} ملف محدد
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Array.from(selectedFileIds).filter(id => files.find(f => f.id === id)?.visibility === 'public').length} ملف عام قابل للمشاركة
                  </p>
                </div>
              </div>

              {/* Permission selection */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">صلاحية المشاركة</label>
                <div className="flex items-center gap-2">
                  {(['view', 'edit', 'download'] as const).map((perm) => (
                    <button
                      key={perm}
                      onClick={() => setBulkSharePermission(perm)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        bulkSharePermission === perm
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
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
                <label className="text-sm font-medium text-foreground mb-1.5 block">البحث عن مستخدمين</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={bulkShareSearchQuery}
                    onChange={(e) => handleBulkShareSearch(e.target.value)}
                    placeholder="ابحث بالاسم أو البريد الإلكتروني..."
                    className="w-full rounded-lg border bg-background pr-10 pl-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    dir="rtl"
                    disabled={bulkShareSearching}
                  />
                  {bulkShareSearching && (
                    <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-emerald-600" />
                  )}
                </div>
                {/* Search results */}
                {bulkShareSearchResults.length > 0 && (
                  <div className="mt-2 rounded-lg border bg-background shadow-lg max-h-40 overflow-y-auto custom-scrollbar">
                    {bulkShareSearchResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => addBulkShareUser(user)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-right"
                      >
                        <UserAvatar name={user.name || 'مستخدم'} avatarUrl={user.avatar_url} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender)}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {user.role === 'superadmin' ? 'مدير المنصة' : user.role === 'teacher' ? 'معلم' : user.role === 'student' ? 'طالب' : user.role === 'admin' ? 'مشرف' : user.role}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected users badges */}
              {bulkShareSelectedUsers.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">المستخدمون المحددون</label>
                  <div className="flex flex-wrap gap-2">
                    {bulkShareSelectedUsers.map((user) => (
                      <Badge
                        key={user.id}
                        variant="secondary"
                        className="flex items-center gap-1.5 py-1 px-2.5"
                      >
                        <span className="text-xs font-medium">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender)}</span>
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

              {/* Submit button */}
              <button
                onClick={handleBulkShare}
                disabled={bulkShareLoading || bulkShareSelectedUsers.length === 0}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {bulkShareLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                مشاركة {selectedFileIds.size} ملف مع {bulkShareSelectedUsers.length} مستخدم
              </button>
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
    <div className="space-y-6" dir="rtl">
      {/* Tabs: My Files / Shared with me */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab('my-files')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
            activeTab === 'my-files'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          ملفاتي
        </button>
        <button
          onClick={() => setActiveTab('shared')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
            activeTab === 'shared'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          مشاركة معي
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
    </div>
  );
}
