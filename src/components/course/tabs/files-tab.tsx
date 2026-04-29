'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  File,
  FileText,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  X,
  Loader2,
  Trash2,
  Download,
  Eye,
  EyeOff,
  User,
  Globe,
  Lock,
  Maximize2,
  CheckSquare,
  Square,
  MoreVertical,
  FolderPlus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { UserProfile, Subject, SubjectFile } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface FilesTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  subject: Subject;
  teacherName: string;
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
// File type categories (Arabic)
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
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

// -------------------------------------------------------
// Extended file type with uploader info
// -------------------------------------------------------
interface SubjectFileWithUploader extends SubjectFile {
  uploader_name?: string;
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function FilesTab({ profile, role, subjectId }: FilesTabProps) {
  const [files, setFiles] = useState<SubjectFileWithUploader[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<FileCategory>('الكل');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<SubjectFileWithUploader | null>(null);
  const [togglingVisibilityId, setTogglingVisibilityId] = useState<string | null>(null);

  // ─── Multi-select state ───
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // ─── Assign to other courses modal ───
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignSubjectIds, setAssignSubjectIds] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [assignSubjects, setAssignSubjects] = useState<{id: string; name: string}[]>([]);

  // -------------------------------------------------------
  // Fetch files with uploader names
  // -------------------------------------------------------
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('subject_files')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching files:', error);
      } else if (data && data.length > 0) {
        // Fetch uploader profiles
        const uploaderIds = [...new Set(data.map((f: SubjectFile) => f.uploaded_by))];
        const uploaderMap = new Map<string, { name: string; title_id?: string | null; gender?: string | null; role?: string | null }>();

        const { data: uploaders } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .in('id', uploaderIds);

        if (uploaders) {
          for (const u of uploaders as { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }[]) {
            uploaderMap.set(u.id, u);
          }
        }

        const filesWithUploaders: SubjectFileWithUploader[] = (data as SubjectFile[]).map((f) => {
          const uploader = uploaderMap.get(f.uploaded_by);
          return {
            ...f,
            uploader_name: uploader ? formatNameWithTitle(uploader.name, uploader.role, uploader.title_id, uploader.gender) : 'مستخدم',
          };
        });

        // Filter: students see only public (visible) files
        // Teachers see all files
        if (role === 'student') {
          setFiles(filesWithUploaders.filter(f => (f.visibility ?? 'public') === 'public'));
        } else {
          setFiles(filesWithUploaders);
        }
      } else {
        setFiles([]);
      }
    } catch (err) {
      console.error('Fetch files error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId, role]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // -------------------------------------------------------
  // Real-time subscription for files
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`subject-files-${subjectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'subject_files', filter: `subject_id=eq.${subjectId}` }, () => fetchFiles())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'subject_files', filter: `subject_id=eq.${subjectId}` }, () => fetchFiles())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'subject_files', filter: `subject_id=eq.${subjectId}` }, () => fetchFiles())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [subjectId, fetchFiles]);

  // -------------------------------------------------------
  // Filter files by category only (no visibility filter for courses)
  // -------------------------------------------------------
  const filteredFiles = useMemo(() => {
    let result = files;
    if (categoryFilter !== 'الكل') {
      result = result.filter((f) => getFileCategory(f.file_type) === categoryFilter);
    }
    return result;
  }, [files, categoryFilter]);

  // -------------------------------------------------------
  // Toggle file visibility for students in this course
  // -------------------------------------------------------
  const handleToggleStudentVisibility = async (fileId: string, currentVisibility: string) => {
    setTogglingVisibilityId(fileId);
    try {
      const newVisibility = currentVisibility === 'public' ? 'private' : 'public';
      const { error } = await supabase
        .from('subject_files')
        .update({ visibility: newVisibility })
        .eq('id', fileId);
      if (error) {
        if (error.message?.includes('does not exist') || error.message?.includes('schema cache')) {
          toast.error('هذه الميزة تحتاج تحديث قاعدة البيانات. يرجى تشغيل الترحيل v6.');
        } else {
          toast.error('حدث خطأ أثناء تغيير ظهور الملف');
        }
      } else {
        toast.success(newVisibility === 'public' ? 'تم إظهار الملف للطلاب' : 'تم إخفاء الملف عن الطلاب');
        fetchFiles();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setTogglingVisibilityId(null);
    }
  };

  // -------------------------------------------------------
  // Delete file (teacher only)
  // -------------------------------------------------------
  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId);
    try {
      const file = files.find((f) => f.id === fileId);
      if (file) {
        const storagePath = file.file_url.split('/user-files/')[1];
        if (storagePath) {
          await supabase.storage.from('user-files').remove([storagePath]);
        }
      }
      const { error } = await supabase.from('subject_files').delete().eq('id', fileId);
      if (error) toast.error('حدث خطأ أثناء حذف الملف');
      else { toast.success('تم حذف الملف'); fetchFiles(); }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  // -------------------------------------------------------
  // Download file
  // -------------------------------------------------------
  const handleDownload = async (file: SubjectFileWithUploader) => {
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
      window.open(file.file_url, '_blank');
    }
  };

  // -------------------------------------------------------
  // Preview file
  // -------------------------------------------------------
  const handlePreview = (file: SubjectFileWithUploader) => {
    const lower = file.file_type.toLowerCase();
    if (lower.includes('image') || lower.includes('pdf')) {
      setPreviewFile(file);
    } else {
      handleDownload(file);
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
        const file = files.find((f) => f.id === fileId);
        if (file) {
          const storagePath = file.file_url.split('/user-files/')[1];
          if (storagePath) {
            await supabase.storage.from('user-files').remove([storagePath]);
          }
        }
        const { error } = await supabase.from('subject_files').delete().eq('id', fileId);
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
  // Bulk toggle visibility
  // -------------------------------------------------------
  const handleBulkVisibility = async (newVisibility: 'public' | 'private') => {
    if (selectedFileIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      let updated = 0;
      for (const fileId of selectedFileIds) {
        const { error } = await supabase
          .from('subject_files')
          .update({ visibility: newVisibility })
          .eq('id', fileId);
        if (!error) updated++;
      }
      toast.success(updated > 1 ? `تم تغيير ظهور ${updated} ملف` : 'تم تغيير ظهور الملف');
      setSelectedFileIds(new Set());
      fetchFiles();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setBulkActionLoading(false);
    }
  };

  // -------------------------------------------------------
  // Open assign to other courses modal
  // -------------------------------------------------------
  const openAssignToOtherModal = async () => {
    setAssignSubjectIds(new Set());
    setAssignModalOpen(true);
    try {
      const { data } = await supabase
        .from('subjects')
        .select('id, name')
        .eq('teacher_id', profile.id)
        .neq('id', subjectId)
        .order('name');
      if (data) setAssignSubjects(data);
    } catch (err) {
      console.error('Error loading subjects:', err);
    }
  };

  // -------------------------------------------------------
  // Assign selected files to other courses
  // -------------------------------------------------------
  const handleAssignToOtherCourses = async () => {
    if (assignSubjectIds.size === 0 || selectedFileIds.size === 0) return;
    setAssigning(true);
    try {
      const selectedFiles = files.filter(f => selectedFileIds.has(f.id));
      let created = 0;
      let skipped = 0;

      for (const file of selectedFiles) {
        for (const targetSubjectId of assignSubjectIds) {
          // Check if already exists
          const { data: existing } = await supabase
            .from('subject_files')
            .select('id')
            .eq('subject_id', targetSubjectId)
            .eq('file_url', file.file_url);

          if (existing && existing.length > 0) {
            skipped++;
            continue;
          }

          const insertData: Record<string, unknown> = {
            subject_id: targetSubjectId,
            uploaded_by: file.uploaded_by,
            file_name: file.file_name,
            file_type: file.file_type,
            file_size: file.file_size,
            file_url: file.file_url,
            visibility: file.visibility || 'public',
            user_file_id: file.user_file_id || null,
          };

          const { error } = await supabase
            .from('subject_files')
            .insert(insertData);

          if (error) {
            // Try without optional columns
            if (error.message?.includes('does not exist') || error.message?.includes('schema cache')) {
              const basicData: Record<string, unknown> = {
                subject_id: targetSubjectId,
                uploaded_by: file.uploaded_by,
                file_name: file.file_name,
                file_type: file.file_type,
                file_size: file.file_size,
                file_url: file.file_url,
              };
              const { error: basicError } = await supabase
                .from('subject_files')
                .insert(basicData);
              if (!basicError) created++;
              else skipped++;
            } else {
              skipped++;
            }
          } else {
            created++;
          }
        }
      }

      let msg = `تم إسناد ${created} ملف بنجاح`;
      if (skipped > 0) msg += ` (تم تخطي ${skipped})`;
      toast.success(msg);
      setAssignModalOpen(false);
      setSelectedFileIds(new Set());
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setAssigning(false);
    }
  };

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6" dir="rtl">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground">الملفات</h3>
          <p className="text-muted-foreground text-sm mt-1">{files.length} ملف</p>
        </div>
      </motion.div>

      {/* Category filter tabs */}
      <motion.div variants={itemVariants} className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILE_CATEGORIES.map((cat) => {
          const count = cat === 'الكل'
            ? files.length
            : files.filter((f) => getFileCategory(f.file_type) === cat).length;
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

      {/* Select all + count (teacher only) */}
      {role === 'teacher' && !loading && filteredFiles.length > 0 && (
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

      {/* Files list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : filteredFiles.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
            <File className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد ملفات</p>
          <p className="text-sm text-muted-foreground">
            {categoryFilter !== 'الكل' ? 'لا توجد ملفات في هذا التصنيف' : 'لم يتم رفع ملفات بعد'}
          </p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="space-y-3">
          {filteredFiles.map((file) => (
            <motion.div key={file.id} variants={itemVariants}>
              <div className="group relative flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-all">
                {/* Checkbox for multi-select (teacher only) */}
                {role === 'teacher' && (
                  <button
                    onClick={() => toggleFileSelection(file.id)}
                    className={`touch-target shrink-0 flex items-center justify-center rounded-md transition-colors ${
                      selectedFileIds.has(file.id)
                        ? 'text-emerald-600'
                        : 'text-muted-foreground/40 hover:text-foreground'
                    }`}
                  >
                    {selectedFileIds.has(file.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                )}

                {/* File icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                  {getFileIcon(file.file_type)}
                </div>

                {/* File info */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    <span>{formatFileSize(file.file_size)}</span>
                    <span title="تاريخ الإسناد للمقرر">{formatDate(file.created_at)}</span>
                    {file.category && (
                      <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">
                        {file.category}
                      </span>
                    )}
                    {/* Uploader name */}
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {file.uploader_name}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Toggle student visibility (teacher only) */}
                  {role === 'teacher' && (
                    <button
                      onClick={() => handleToggleStudentVisibility(file.id, file.visibility || 'public')}
                      disabled={togglingVisibilityId === file.id}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        (file.visibility ?? 'public') === 'public'
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-amber-50 hover:text-amber-600'
                          : 'bg-amber-50 text-amber-700 hover:bg-emerald-50 hover:text-emerald-600'
                      } disabled:opacity-60`}
                      title={(file.visibility ?? 'public') === 'public' ? 'إخفاء عن الطلاب' : 'إظهار للطلاب'}
                    >
                      {togglingVisibilityId === file.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (file.visibility ?? 'public') === 'public' ? (
                        <Eye className="h-3.5 w-3.5" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5" />
                      )}
                      {(file.visibility ?? 'public') === 'public' ? 'مرئي' : 'مخفي'}
                    </button>
                  )}
                  {/* Preview button */}
                  <button
                    onClick={() => handlePreview(file)}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                    title="معاينة"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                  {/* Download button */}
                  <button
                    onClick={() => handleDownload(file)}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                    title="تحميل"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {/* Delete button (teacher only) */}
                  {role === 'teacher' && (
                    confirmDeleteId === file.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(file.id)}
                          disabled={deletingId === file.id}
                          className="flex h-8 items rounded-md bg-rose-600 px-2 text-[10px] font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                        >
                          {deletingId === file.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'تأكيد'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="flex h-8 items rounded-md bg-muted px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted/80"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(file.id)}
                        className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        title="حذف"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Bulk Action Bar (teacher only) */}
      {role === 'teacher' && (
        <AnimatePresence>
          {selectedFileIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20, pointerEvents: 'none' as const }}
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
                          <Eye className="h-4 w-4 ml-2" />
                          إظهار للطلاب
                        </DropdownMenuItem>
                      )}
                      {Array.from(selectedFileIds).some(id => files.find(f => f.id === id)?.visibility === 'public') && (
                        <DropdownMenuItem
                          onClick={() => handleBulkVisibility('private')}
                          disabled={bulkActionLoading}
                          className="cursor-pointer"
                        >
                          <EyeOff className="h-4 w-4 ml-2" />
                          إخفاء عن الطلاب
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => openAssignToOtherModal()}
                        className="cursor-pointer"
                      >
                        <FolderPlus className="h-4 w-4 ml-2" />
                        إسناد لمقررات أخرى
                      </DropdownMenuItem>
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
      )}

      {/* Assign to Other Courses Modal */}
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
              className="w-full max-w-sm rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <FolderPlus className="h-5 w-5 text-emerald-600" />
                  إسناد لمقررات أخرى
                </h3>
                <button
                  onClick={() => { if (!assigning) setAssignModalOpen(false); }}
                  className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <FolderPlus className="h-4 w-4 text-emerald-600" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {selectedFileIds.size} ملف محدد
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">اختر المقررات</label>
                  {assignSubjects.length === 0 ? (
                    <p className="text-xs text-muted-foreground">لا توجد مقررات أخرى متاحة</p>
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

                <button
                  onClick={handleAssignToOtherCourses}
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

      {/* Preview Modal */}
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
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-4 shrink-0">
                <h3 className="text-sm font-bold text-foreground truncate">{previewFile.file_name}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownload(previewFile)}
                    className="touch-target flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                    title="تحميل"
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
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
