'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package,
  Upload,
  Loader2,
  Trash2,
  Edit3,
  Link2,
  Unlink,
  Search,
  Filter,
  BookOpen,
  Check,
  X,
  AlertCircle,
  MoreVertical,
  HardDrive,
  Calendar,
  Layers,
  Plus,
  ChevronDown,
  Users,
  FileBox,
} from 'lucide-react';
import { getCachedAuthHeaders, getAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
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
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UserProfile } from '@/lib/types';
import type { ScormPackage } from '@/lib/scorm-types';
import { useTranslations } from '@/i18n/use-translations';

interface ScormLibrarySectionProps {
  profile: UserProfile;
  onNavigateToCourse?: () => void;
}

interface SubjectOption {
  id: string;
  name: string;
  color?: string | null;
  is_owner: boolean;
}

interface EnrichedPackage extends ScormPackage {
  uploader_name?: string;
  linked_subjects?: { id: string; name: string; color?: string | null; linked_by?: string; linked_at?: string }[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function ScormLibrarySection({ profile }: ScormLibrarySectionProps) {
  const { t } = useTranslations('scormLibrary');
  const { t: tCommon } = useTranslations('common');
  const [packages, setPackages] = useState<EnrichedPackage[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'archived'>('all');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingPackage, setEditingPackage] = useState<EnrichedPackage | null>(null);
  const [deletePackage, setDeletePackage] = useState<EnrichedPackage | null>(null);
  const [linkDialogPackage, setLinkDialogPackage] = useState<EnrichedPackage | null>(null);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadVersion, setUploadVersion] = useState<'1.2' | '2004'>('1.2');
  const [uploadLinkIds, setUploadLinkIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'draft' | 'archived'>('active');
  const [saving, setSaving] = useState(false);

  const isAdmin = profile.role === 'admin' || profile.role === 'superadmin';

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/scorm/library', { headers: await getCachedAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch SCORM library');
      const data = await res.json();
      setPackages(data.data || []);
    } catch (err) {
      console.error('[SCORM Library] Fetch error:', err);
      toast.error(t('fetchError') || 'Failed to load SCORM packages');
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchSubjects = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher/subjects', { headers: await getCachedAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch subjects');
      const data = await res.json();
      setSubjects(data.data || []);
    } catch (err) {
      console.error('[SCORM Library] Subjects fetch error:', err);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
    fetchSubjects();
  }, [fetchPackages, fetchSubjects]);

  const filteredPackages = packages.filter((p) => {
    const matchesSearch =
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadTitle('');
    setUploadDesc('');
    setUploadVersion('1.2');
    setUploadLinkIds([]);
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error(t('selectFile') || 'Please select a ZIP file');
      return;
    }
    if (!uploadTitle.trim()) {
      toast.error(t('titleRequired') || 'Title is required');
      return;
    }
    if (!uploadFile.name.toLowerCase().endsWith('.zip')) {
      toast.error(t('onlyZip') || 'Only ZIP files are allowed');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('title', uploadTitle.trim());
      if (uploadDesc.trim()) formData.append('description', uploadDesc.trim());
      formData.append('version', uploadVersion);
      if (uploadLinkIds.length > 0) formData.append('link_subject_ids', uploadLinkIds.join(','));

      const res = await fetch('/api/scorm/library/upload', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      toast.success(t('uploadSuccess') || 'SCORM package uploaded successfully');
      setShowUploadDialog(false);
      resetUploadForm();
      fetchPackages();
    } catch (err: any) {
      console.error('[SCORM Library] Upload error:', err);
      toast.error(err.message || t('uploadError') || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const openEditDialog = (pkg: EnrichedPackage) => {
    setEditingPackage(pkg);
    setEditTitle(pkg.title);
    setEditDesc(pkg.description || '');
    setEditStatus(pkg.status);
    setShowEditDialog(true);
  };

  const handleEditSave = async () => {
    if (!editingPackage) return;
    if (!editTitle.trim()) {
      toast.error(t('titleRequired') || 'Title is required');
      return;
    }
    setSaving(true);
    try {
      const authHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/scorm/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          packageId: editingPackage.id,
          title: editTitle.trim(),
          description: editDesc.trim() || null,
          status: editStatus,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Update failed');
      }
      toast.success(t('updateSuccess') || 'Package updated');
      setShowEditDialog(false);
      setEditingPackage(null);
      fetchPackages();
    } catch (err: any) {
      console.error('[SCORM Library] Edit error:', err);
      toast.error(err.message || 'Failed to update package');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletePackage) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/scorm/packages?packageId=${deletePackage.id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Delete failed');
      }
      toast.success(t('deleteSuccess') || 'Package deleted');
      setDeletePackage(null);
      fetchPackages();
    } catch (err: any) {
      console.error('[SCORM Library] Delete error:', err);
      toast.error(err.message || 'Failed to delete package');
    } finally {
      setSaving(false);
    }
  };

  const handleLink = async (pkg: EnrichedPackage, subjectId: string) => {
    try {
      const linkHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/scorm/library/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...linkHeaders },
        body: JSON.stringify({ package_id: pkg.id, subject_id: subjectId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Link failed');
      }
      toast.success(t('linkedSuccess') || 'Package linked to subject');
      fetchPackages();
    } catch (err: any) {
      console.error('[SCORM Library] Link error:', err);
      toast.error(err.message || 'Failed to link package');
    }
  };

  const handleUnlink = async (pkg: EnrichedPackage, subjectId: string) => {
    try {
      const unlinkHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/scorm/library/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...unlinkHeaders },
        body: JSON.stringify({ package_id: pkg.id, subject_id: subjectId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Unlink failed');
      }
      toast.success(t('unlinkedSuccess') || 'Package unlinked from subject');
      fetchPackages();
    } catch (err: any) {
      console.error('[SCORM Library] Unlink error:', err);
      toast.error(err.message || 'Failed to unlink package');
    }
  };

  const toggleLinkId = (id: string) => {
    setUploadLinkIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-5 p-4 sm:p-6 max-w-7xl mx-auto"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            {t('title') || 'SCORM Library'}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {t('description') || 'Platform-level SCORM packages that can be linked to multiple courses. Upload once, use everywhere.'}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowUploadDialog(true)}>
            <Upload className="h-4 w-4 me-1" />
            {t('uploadPackage') || 'Upload Package'}
          </Button>
        )}
      </motion.div>

      {/* Filters */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder') || 'Search packages...'}
            className="ps-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="h-4 w-4 me-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses') || 'All statuses'}</SelectItem>
            <SelectItem value="active">{t('active') || 'Active'}</SelectItem>
            <SelectItem value="draft">{t('draft') || 'Draft'}</SelectItem>
            <SelectItem value="archived">{t('archived') || 'Archived'}</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      {/* Packages grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredPackages.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-lg font-semibold mb-1">
              {packages.length === 0 ? (t('noPackages') || 'No SCORM packages yet') : (t('noMatches') || 'No matching packages')}
            </h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              {packages.length === 0
                ? (t('emptyHint') || 'Upload your first SCORM ZIP package to build a reusable library.')
                : (t('adjustFilters') || 'Try adjusting your search or filters.')}
            </p>
            {isAdmin && packages.length === 0 && (
              <Button onClick={() => setShowUploadDialog(true)}>
                <Upload className="h-4 w-4 me-1" />
                {t('uploadFirst') || 'Upload First Package'}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPackages.map((pkg) => {
            const linkedSubjects = pkg.linked_subjects || [];
            return (
              <motion.div key={pkg.id} variants={itemVariants} layout>
                <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base font-semibold line-clamp-2 flex items-center gap-2">
                          <FileBox className="h-4 w-4 text-primary shrink-0" />
                          {pkg.title}
                        </CardTitle>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">SCORM {pkg.version}</Badge>
                          <Badge
                            variant="outline"
                            className={
                              pkg.status === 'active'
                                ? 'text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                                : pkg.status === 'draft'
                                ? 'text-[10px] border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                                : 'text-[10px] border-gray-300 bg-gray-50 text-gray-600 dark:bg-gray-900/20 dark:text-gray-300'
                            }
                          >
                            {pkg.status}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            <Layers className="h-2.5 w-2.5 me-1" />
                            {pkg.total_objects} {t('objects') || 'objects'}
                          </Badge>
                        </div>
                      </div>
                      {isAdmin && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(pkg)}>
                              <Edit3 className="h-4 w-4 me-2" />
                              {tCommon('edit') || 'Edit'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLinkDialogPackage(pkg)}>
                              <Link2 className="h-4 w-4 me-2" />
                              {t('manageLinks') || 'Manage Links'}
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger className="gap-2">
                                <Plus className="h-4 w-4 me-2" />
                                {t('quickLink') || 'Quick Link'}
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {subjects.length === 0 ? (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    {t('noSubjects') || 'No subjects available'}
                                  </div>
                                ) : (
                                  subjects
                                    .filter((s) => !linkedSubjects.some((ls) => ls.id === s.id))
                                    .map((s) => (
                                      <DropdownMenuItem key={s.id} onClick={() => handleLink(pkg, s.id)}>
                                        <BookOpen className="h-4 w-4 me-2" />
                                        <span className="truncate">{s.name}</span>
                                      </DropdownMenuItem>
                                    ))
                                )}
                                {subjects.filter((s) => !linkedSubjects.some((ls) => ls.id === s.id)).length === 0 && subjects.length > 0 && (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    {t('allLinked') || 'All subjects linked'}
                                  </div>
                                )}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeletePackage(pkg)}
                            >
                              <Trash2 className="h-4 w-4 me-2" />
                              {tCommon('delete') || 'Delete'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3">
                    {pkg.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{pkg.description}</p>
                    )}

                    {/* Linked subjects */}
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">
                        {t('linkedCourses') || 'Linked Courses'} ({linkedSubjects.length})
                      </div>
                      {linkedSubjects.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic">
                          {t('notLinked') || 'Not linked to any course'}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {linkedSubjects.slice(0, 4).map((ls) => (
                            <Badge key={ls.id} variant="secondary" className="text-[10px]">
                              <BookOpen className="h-2.5 w-2.5 me-1" />
                              {ls.name}
                            </Badge>
                          ))}
                          {linkedSubjects.length > 4 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{linkedSubjects.length - 4}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="mt-auto pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground gap-2">
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-3 w-3" />
                        {formatBytes(pkg.package_size)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(pkg.created_at)}
                      </span>
                    </div>

                    {/* Teacher quick-link button */}
                    {!isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setLinkDialogPackage(pkg)}
                      >
                        <Link2 className="h-4 w-4 me-1" />
                        {t('manageLinks') || 'Manage Links'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t('uploadPackage') || 'Upload SCORM Package'}
            </DialogTitle>
            <DialogDescription>
              {t('uploadDesc') || 'Upload a SCORM 1.2 or 2004 ZIP package. It will be stored in the platform library and can be linked to multiple courses.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="upload-file">{t('zipFile') || 'ZIP File'}</Label>
              <Input
                id="upload-file"
                type="file"
                accept=".zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setUploadFile(f || null);
                  if (f && !uploadTitle) {
                    setUploadTitle(f.name.replace(/\.zip$/i, ''));
                  }
                }}
                disabled={uploading}
              />
              {uploadFile && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-600" />
                  {uploadFile.name} ({formatBytes(uploadFile.size)})
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="upload-title">{t('title') || 'Title'} *</Label>
              <Input
                id="upload-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                disabled={uploading}
                placeholder={t('titlePlaceholder') || 'e.g. Introduction to Physics'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="upload-desc">{t('description') || 'Description'}</Label>
              <Textarea
                id="upload-desc"
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                rows={2}
                disabled={uploading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="upload-version">{t('scormVersion') || 'SCORM Version'}</Label>
              <Select value={uploadVersion} onValueChange={(v) => setUploadVersion(v as any)} disabled={uploading}>
                <SelectTrigger id="upload-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1.2">SCORM 1.2</SelectItem>
                  <SelectItem value="2004">SCORM 2004</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Link to subjects on upload */}
            {subjects.length > 0 && (
              <div className="space-y-2">
                <Label>{t('linkToCourses') || 'Link to Courses (optional)'}</Label>
                <div className="border rounded-lg max-h-[160px] overflow-y-auto p-2 space-y-1">
                  {subjects.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={uploadLinkIds.includes(s.id)}
                        onChange={() => toggleLinkId(s.id)}
                        disabled={uploading}
                        className="rounded"
                      />
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">{s.name}</span>
                      {!s.is_owner && (
                        <Badge variant="outline" className="text-[9px] ms-auto">
                          {t('coTeacher') || 'Co-teacher'}
                        </Badge>
                      )}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('linkHint') || 'Package will be available immediately in linked courses.'}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)} disabled={uploading}>
              {tCommon('cancel') || 'Cancel'}
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadFile || !uploadTitle.trim()}>
              {uploading && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              <Upload className="h-4 w-4 me-1" />
              {t('upload') || 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              {t('editPackage') || 'Edit Package'}
            </DialogTitle>
            <DialogDescription>
              {t('editDesc') || 'Update package metadata and status.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-title">{t('title') || 'Title'}</Label>
              <Input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc">{t('description') || 'Description'}</Label>
              <Textarea id="edit-desc" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">{t('status') || 'Status'}</Label>
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as any)} disabled={saving}>
                <SelectTrigger id="edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('active') || 'Active'}</SelectItem>
                  <SelectItem value="draft">{t('draft') || 'Draft'}</SelectItem>
                  <SelectItem value="archived">{t('archived') || 'Archived'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={saving}>
              {tCommon('cancel') || 'Cancel'}
            </Button>
            <Button onClick={handleEditSave} disabled={saving || !editTitle.trim()}>
              {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              {tCommon('save') || 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Manager Dialog */}
      <Dialog open={!!linkDialogPackage} onOpenChange={(o) => !o && setLinkDialogPackage(null)}>
        <DialogContent className="sm:max-w-[520px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              {t('manageLinks') || 'Manage Course Links'}
            </DialogTitle>
            <DialogDescription>
              {t('manageLinksDesc') || 'Link this SCORM package to one or more courses. Students in linked courses will see this package in their course SCORM tab.'}
            </DialogDescription>
          </DialogHeader>
          {linkDialogPackage && (
            <div className="space-y-2 py-2">
              <div className="text-sm font-medium pb-2 border-b">
                {linkDialogPackage.title}
              </div>
              {subjects.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  {t('noSubjectsAvailable') || 'No subjects available. Create a subject first.'}
                </div>
              ) : (
                subjects.map((s) => {
                  const isLinked = (linkDialogPackage.linked_subjects || []).some((ls) => ls.id === s.id);
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-lg border"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{s.name}</div>
                          {!s.is_owner && (
                            <div className="text-[10px] text-muted-foreground">
                              {t('coTeacher') || 'Co-teacher'}
                            </div>
                          )}
                        </div>
                      </div>
                      {isLinked ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => handleUnlink(linkDialogPackage, s.id)}
                          disabled={saving}
                        >
                          <Unlink className="h-3.5 w-3.5 me-1" />
                          {t('unlink') || 'Unlink'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleLink(linkDialogPackage, s.id)}
                          disabled={saving}
                        >
                          <Link2 className="h-3.5 w-3.5 me-1" />
                          {t('link') || 'Link'}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogPackage(null)}>
              {tCommon('done') || 'Done'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletePackage} onOpenChange={(o) => !o && setDeletePackage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle') || 'Delete Package'}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm') || 'Are you sure you want to delete this SCORM package? This will remove all tracking data and unlink it from all courses. This action cannot be undone.'}
              <br />
              <strong>{deletePackage?.title}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('cancel') || 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              {tCommon('delete') || 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!isAdmin && (
        <div className="text-center text-xs text-muted-foreground py-4">
          {t('teacherNotice') || 'As a teacher, you can link and unlink platform packages to your courses. Only admins can upload or delete packages.'}
        </div>
      )}
    </motion.div>
  );
}
