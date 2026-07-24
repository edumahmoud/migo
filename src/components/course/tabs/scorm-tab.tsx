'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Package, Upload, Download, Trash2, Play, Eye, Loader2,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle2,
  Clock, BarChart3, FileCheck, BookOpen, X, MoreHorizontal,
  Archive, Edit, Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import { SectionErrorBoundary } from '@/components/shared/section-error-boundary';
import type { UserProfile, Subject, CourseTab } from '@/lib/types';
import type { ScormPackage, ScormResource, ScormVersion } from '@/lib/scorm-types';
import ScormPlayer from './scorm-player';

// ─── Props ───
interface ScormTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subject: Subject;
}

// ─── Main Component ───
export default function ScormTab({ profile, role, subject }: ScormTabProps) {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';

  const [packages, setPackages] = useState<ScormPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activePlayer, setActivePlayer] = useState<{ packageId: string; resourceId: string } | null>(null);

  // ── Export modal state ──
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportContentType, setExportContentType] = useState<'quiz' | 'lesson' | 'subject'>('subject');
  const [exportVersion, setExportVersion] = useState<ScormVersion>('1.2');
  const [exporting, setExporting] = useState(false);

  // ── Delete confirmation state ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Tracking data ──
  const [trackingData, setTrackingData] = useState<Record<string, Record<string, unknown>>>({});

  // ── Upload ref ──
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch SCORM packages ──
  const fetchPackages = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch(`/api/scorm/list?subjectId=${subject.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      if (result.success) {
        setPackages(result.data || []);
      } else {
        console.error('[ScormTab] Fetch error:', result.error);
      }
    } catch (err) {
      console.error('[ScormTab] Fetch packages error:', err);
    } finally {
      setLoading(false);
    }
  }, [subject.id]);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  // ── Fetch tracking data for student view ──
  const fetchTracking = useCallback(async () => {
    if (role !== 'student' || packages.length === 0) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Fetch tracking data for all packages
      const trackingMap: Record<string, Record<string, unknown>> = {};

      for (const pkg of packages) {
        const response = await fetch(`/api/scorm/track?packageId=${pkg.id}&studentId=${profile.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        const result = await response.json();
        if (result.success && result.data) {
          for (const tracking of result.data) {
            trackingMap[tracking.resource_id] = tracking;
          }
        }
      }

      setTrackingData(trackingMap);
    } catch (err) {
      console.error('[ScormTab] Fetch tracking error:', err);
    }
  }, [role, profile.id, packages]);

  useEffect(() => {
    fetchTracking();
  }, [fetchTracking]);

  // ── Upload SCORM package ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error(t('scorm.onlyZipAllowed') || 'Only .zip files are allowed');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error(t('scorm.maxSizeExceeded') || 'File size exceeds 50MB limit');
      return;
    }

    try {
      setUploading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('subjectId', subject.id);

      const response = await fetch('/api/scorm/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        toast.success(t('scorm.uploadSuccess') || 'SCORM package uploaded successfully');
        fetchPackages();
      } else {
        toast.error(result.error || t('scorm.uploadError') || 'Failed to upload SCORM package');
      }
    } catch (err) {
      console.error('[ScormTab] Upload error:', err);
      toast.error(t('scorm.uploadError') || 'Failed to upload SCORM package');
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // ── Delete SCORM package ──
  const handleDelete = async (packageId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch(`/api/scorm/packages?packageId=${packageId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (result.success) {
        toast.success(t('scorm.deleteSuccess') || 'SCORM package deleted successfully');
        fetchPackages();
        setDeleteConfirmId(null);
      } else {
        toast.error(result.error || t('scorm.deleteError') || 'Failed to delete SCORM package');
      }
    } catch (err) {
      console.error('[ScormTab] Delete error:', err);
      toast.error(t('scorm.deleteError') || 'Failed to delete SCORM package');
    }
  };

  // ── Export content as SCORM ──
  const handleExport = async () => {
    try {
      setExporting(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/scorm/export', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subjectId: subject.id,
          contentType: exportContentType,
          version: exportVersion,
          title: subject.name,
          description: subject.description,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        toast.error(result.error || t('scorm.exportError') || 'Failed to export SCORM package');
        return;
      }

      // Download the ZIP file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${subject.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}_scorm_${exportVersion}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(t('scorm.exportSuccess') || 'SCORM package exported successfully');
      setExportModalOpen(false);
    } catch (err) {
      console.error('[ScormTab] Export error:', err);
      toast.error(t('scorm.exportError') || 'Failed to export SCORM package');
    } finally {
      setExporting(false);
    }
  };

  // ── Launch SCORM content ──
  const handleLaunch = (pkg: ScormPackage, resource: ScormResource) => {
    setActivePlayer({
      packageId: pkg.id,
      resourceId: resource.id,
    });
  };

  // ── Handle progress update from SCORM player ──
  const handleProgressUpdate = useCallback((data: Record<string, unknown>) => {
    // Update local tracking data
    if (activePlayer?.resourceId) {
      setTrackingData(prev => ({
        ...prev,
        [activePlayer.resourceId]: { ...prev[activePlayer.resourceId], ...data },
      }));
    }
  }, [activePlayer]);

  // ── Close player ──
  const handleClosePlayer = useCallback(() => {
    setActivePlayer(null);
    // Refresh tracking data
    fetchTracking();
  }, [fetchTracking]);

  // ── Render completion status badge ──
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium"><CheckCircle2 className="h-3 w-3" />{t('scorm.completed') || 'Completed'}</span>;
      case 'incomplete':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium"><Clock className="h-3 w-3" />{t('scorm.inProgress') || 'In Progress'}</span>;
      case 'passed':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium"><CheckCircle2 className="h-3 w-3" />{t('scorm.passed') || 'Passed'}</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium"><AlertCircle className="h-3 w-3" />{t('scorm.failed') || 'Failed'}</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">{t('scorm.notAttempted') || 'Not Attempted'}</span>;
    }
  };

  // ── SCORM Player View ──
  if (activePlayer) {
    return (
      <ScormPlayer
        packageId={activePlayer.packageId}
        resourceId={activePlayer.resourceId}
        onClose={handleClosePlayer}
        onProgressUpdate={handleProgressUpdate}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Teacher Actions ── */}
      {role === 'teacher' && (
        <div className="flex items-center gap-3 flex-wrap">
          {/* Upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? (t('scorm.uploading') || 'Uploading...') : (t('scorm.uploadPackage') || 'Upload SCORM Package')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={handleUpload}
            className="hidden"
          />

          {/* Export button */}
          <button
            onClick={() => setExportModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            {t('scorm.exportScorm') || 'Export as SCORM'}
          </button>
        </div>
      )}

      {/* ── Loading State ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-sky-700 mb-3" />
          <span className="text-muted-foreground text-sm">{t('scorm.loadingPackages') || 'Loading SCORM packages...'}</span>
        </div>
      )}

      {/* ── Empty State ── */}
      {!loading && packages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground mb-2">
            {t('scorm.noPackages') || 'No SCORM Packages'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {role === 'teacher'
              ? (t('scorm.noPackagesTeacher') || 'Upload a SCORM package or export your content to get started')
              : (t('scorm.noPackagesStudent') || 'No SCORM content is available yet')
            }
          </p>
          {role === 'teacher' && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors"
            >
              <Upload className="h-4 w-4" />
              {t('scorm.uploadPackage') || 'Upload SCORM Package'}
            </button>
          )}
        </div>
      )}

      {/* ── Package List ── */}
      {!loading && packages.length > 0 && (
        <div className="space-y-3">
          {packages.map(pkg => (
            <ScormPackageCard
              key={pkg.id}
              package={pkg}
              role={role}
              profileId={profile.id}
              trackingData={trackingData}
              onLaunch={handleLaunch}
              onDelete={handleDelete}
              deleteConfirmId={deleteConfirmId}
              setDeleteConfirmId={setDeleteConfirmId}
              t={t}
            />
          ))}
        </div>
      )}

      {/* ── Export Modal ── */}
      <AnimatePresence>
        {exportModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-background rounded-xl shadow-xl max-w-md w-full p-6 border border-border"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">{t('scorm.exportTitle') || 'Export as SCORM'}</h3>
                <button onClick={() => setExportModalOpen(false)} className="p-1 rounded-lg hover:bg-muted transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Content Type Selection */}
                <div>
                  <label className="text-sm font-medium mb-2 block">{t('scorm.exportContentType') || 'Content Type'}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'quiz', label: t('scorm.exportQuiz') || 'Quizzes', icon: <FileCheck className="h-4 w-4" /> },
                      { value: 'lesson', label: t('scorm.exportLesson') || 'Lessons', icon: <BookOpen className="h-4 w-4" /> },
                      { value: 'subject', label: t('scorm.exportSubject') || 'Full Course', icon: <Package className="h-4 w-4" /> },
                    ].map(option => (
                      <button
                        key={option.value}
                        onClick={() => setExportContentType(option.value as 'quiz' | 'lesson' | 'subject')}
                        className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all text-sm ${
                          exportContentType === option.value
                            ? 'border-sky-700 bg-sky-50 text-sky-700 dark:bg-sky-900/20'
                            : 'border-border hover:border-sky-700/50'
                        }`}
                      >
                        {option.icon}
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* SCORM Version Selection */}
                <div>
                  <label className="text-sm font-medium mb-2 block">{t('scorm.scormVersion') || 'SCORM Version'}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: '1.2', label: 'SCORM 1.2', desc: t('scorm.version12Desc') || 'Most widely supported' },
                      { value: '2004', label: 'SCORM 2004', desc: t('scorm.version2004Desc') || 'More advanced tracking' },
                    ].map(option => (
                      <button
                        key={option.value}
                        onClick={() => setExportVersion(option.value as ScormVersion)}
                        className={`p-3 rounded-lg border transition-all text-sm ${
                          exportVersion === option.value
                            ? 'border-sky-700 bg-sky-50 text-sky-700 dark:bg-sky-900/20'
                            : 'border-border hover:border-sky-700/50'
                        }`}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Export Button */}
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 font-medium"
                >
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {exporting ? (t('scorm.exporting') || 'Exporting...') : (t('scorm.exportButton') || 'Export SCORM Package')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Package Card Component ───

interface ScormPackageCardProps {
  package: ScormPackage;
  role: 'teacher' | 'student';
  profileId: string;
  trackingData: Record<string, Record<string, unknown>>;
  onLaunch: (pkg: ScormPackage, resource: ScormResource) => void;
  onDelete: (packageId: string) => void;
  deleteConfirmId: string | null;
  setDeleteConfirmId: (id: string | null) => void;
  t: (key: string) => string;
}

function ScormPackageCard({
  package: pkg,
  role,
  profileId,
  trackingData,
  onLaunch,
  onDelete,
  deleteConfirmId,
  setDeleteConfirmId,
  t,
}: ScormPackageCardProps) {
  const [expanded, setExpanded] = useState(false);

  const resources = pkg.resources || [];
  const sizeMB = (pkg.package_size / (1024 * 1024)).toFixed(1);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* ── Package Header ── */}
      <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex-shrink-0 p-2 rounded-lg bg-sky-100 dark:bg-sky-900/20">
            <Package className="h-5 w-5 text-sky-700 dark:text-sky-400" />
          </div>
          <div className="min-w-0">
            <h4 className="font-medium text-sm truncate">{pkg.title}</h4>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>SCORM {pkg.version}</span>
              <span>•</span>
              <span>{pkg.total_objects} {t('scorm.objects') || 'objects'}</span>
              <span>•</span>
              <span>{sizeMB} MB</span>
              {pkg.status !== 'active' && (
                <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-xs">{pkg.status}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {role === 'teacher' && (
            <div className="flex items-center gap-1">
              {/* Delete button */}
              {deleteConfirmId === pkg.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(pkg.id); }}
                    className="p-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-colors text-xs font-medium"
                  >
                    {t('scorm.confirmDelete') || 'Confirm'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-xs"
                  >
                    {t('scorm.cancel') || 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(pkg.id); }}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors"
                  title={t('scorm.delete') || 'Delete'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* ── Expanded Content ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border"
          >
            <div className="p-4 space-y-2">
              {pkg.description && (
                <p className="text-sm text-muted-foreground mb-3">{pkg.description}</p>
              )}

              {/* ── Resources List ── */}
              {resources.length > 0 ? (
                <div className="space-y-1.5">
                  {resources.map(resource => {
                    const tracking = trackingData[resource.id];
                    const completionStatus = tracking?.completion_status as string || 'not_attempted';
                    const successStatus = tracking?.success_status as string || 'unknown';
                    const scoreRaw = tracking?.score_raw as number | null;
                    const displayStatus = role === 'student'
                      ? (successStatus === 'passed' || successStatus === 'failed' ? successStatus : completionStatus)
                      : completionStatus;

                    return (
                      <div
                        key={resource.id}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`flex-shrink-0 p-1 rounded ${resource.type === 'sco' ? 'bg-sky-100 dark:bg-sky-900/20' : 'bg-gray-100 dark:bg-gray-800'}`}>
                            {resource.type === 'sco'
                              ? <Play className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400" />
                              : <Eye className="h-3.5 w-3.5 text-gray-500" />
                            }
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-medium truncate block">{resource.title}</span>
                            <span className="text-xs text-muted-foreground">{resource.type === 'sco' ? 'SCO' : 'Asset'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Status badge (for students) */}
                          {role === 'student' && (
                            <div className="flex items-center gap-2">
                              {renderStatusBadge(displayStatus)}
                              {scoreRaw !== null && scoreRaw !== undefined && (
                                <span className="text-xs font-medium">{scoreRaw}%</span>
                              )}
                            </div>
                          )}

                          {/* Launch button */}
                          {resource.type === 'sco' && pkg.status === 'active' && (
                            <button
                              onClick={() => onLaunch(pkg, resource)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 transition-colors"
                            >
                              <Play className="h-3 w-3" />
                              {role === 'student' ? (t('scorm.launch') || 'Start') : (t('scorm.preview') || 'Preview')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t('scorm.noResources') || 'No SCOs found in this package'}
                </p>
              )}

              {/* ── Package Details ── */}
              <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                <span>{t('scorm.uploadedBy') || 'Uploaded by'}: {pkg.uploader_name || 'Unknown'}</span>
                <span>{new Date(pkg.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function renderStatusBadge(status: string): React.ReactNode {
  switch (status) {
    case 'completed':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium"><CheckCircle2 className="h-3 w-3" />Completed</span>;
    case 'incomplete':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium"><Clock className="h-3 w-3" />In Progress</span>;
    case 'passed':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium"><CheckCircle2 className="h-3 w-3" />Passed</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium"><AlertCircle className="h-3 w-3" />Failed</span>;
    default:
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">Not Attempted</span>;
  }
}
