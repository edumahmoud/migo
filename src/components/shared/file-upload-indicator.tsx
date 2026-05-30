'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
  X,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  FileText,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  File,
} from 'lucide-react';
import { useFileUploadStore, formatFileSize } from '@/stores/file-upload-store';
import { useVideoUploadStore } from '@/stores/video-upload-store';
import { useTranslations } from '@/i18n/use-translations';
import { useState, useEffect } from 'react';

/**
 * Global floating file upload indicator.
 * Rendered in layout.tsx so it's visible on ALL pages.
 * Handles IndexedDB hydration on mount so interrupted uploads
 * are restored even if the user navigated away from the files page.
 * Supports pause/resume/cancel/retry for each upload.
 * Automatically offsets itself when the VideoUploadIndicator is also visible.
 */
export default function FileUploadIndicator() {
  const { t, direction, locale } = useTranslations();
  const {
    tasks,
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    removeTask,
    clearCompleted,
    hydrateFromPersistence,
  } = useFileUploadStore();

  // ─── Track video upload indicator visibility to avoid overlap ───
  const videoTasks = useVideoUploadStore((s) => s.tasks);
  const videoVisible = videoTasks.filter((t) => t.status !== 'cancelled').length > 0;

  const [expanded, setExpanded] = useState(false);

  // ─── Hydrate from IndexedDB on mount (global) ───
  // This ensures uploads are restored regardless of which page the user lands on
  useEffect(() => {
    hydrateFromPersistence();
  }, [hydrateFromPersistence]);

  // Filter out cancelled tasks — they're not interesting to show
  const visibleTasks = tasks.filter((t) => t.status !== 'cancelled');
  const activeTasks = visibleTasks.filter((t) => t.status === 'uploading');
  const pausedTasks = visibleTasks.filter((t) => t.status === 'paused');
  const interruptedTasks = visibleTasks.filter((t) => t.status === 'interrupted');
  const completedTasks = visibleTasks.filter((t) => t.status === 'success');
  const errorTasks = visibleTasks.filter((t) => t.status === 'error');

  // Don't render if no visible tasks
  if (visibleTasks.length === 0) return null;

  // Calculate overall progress of active + paused tasks
  const progressTasks = [...activeTasks, ...pausedTasks];
  const overallProgress =
    progressTasks.length > 0
      ? Math.round(progressTasks.reduce((sum, t) => sum + t.progress, 0) / progressTasks.length)
      : completedTasks.length > 0 && activeTasks.length === 0 && pausedTasks.length === 0
        ? 100
        : 0;

  const hasActive = activeTasks.length > 0;
  const hasPaused = pausedTasks.length > 0;
  const hasInterrupted = interruptedTasks.length > 0;
  const allDone = !hasActive && !hasPaused && !hasInterrupted;

  // Status text
  const statusText = hasActive
    ? locale === 'ar'
      ? `جارٍ رفع ${activeTasks.length} ملف(ات)...`
      : `Uploading ${activeTasks.length} file(s)...`
    : hasInterrupted
      ? locale === 'ar'
        ? `${interruptedTasks.length} رفع(ات) متقطع(ة)`
        : `${interruptedTasks.length} upload(s) interrupted`
      : hasPaused
        ? locale === 'ar'
          ? `${pausedTasks.length} ملف(ات) متوقف(ة) مؤقتاً`
          : `${pausedTasks.length} file(s) paused`
        : errorTasks.length > 0
          ? locale === 'ar'
            ? 'بعض الرفعات فشلت'
            : 'Some uploads failed'
          : locale === 'ar'
            ? `تم الرفع — ${completedTasks.length} ملف(ات)`
            : `Upload complete — ${completedTasks.length} file(s)`;

  // File icon helper
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
      return <FileText className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400 shrink-0" />;
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
      return <ImageIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />;
    }
    if (lower.includes('video') || lower.includes('mp4') || lower.includes('avi') || lower.includes('mov')) {
      return <FileVideo className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />;
    }
    if (lower.includes('audio') || lower.includes('mp3') || lower.includes('wav') || lower.includes('ogg')) {
      return <FileAudio className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0" />;
    }
    return <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }

  // Offset positioning: when video indicator is visible, stack above it
  // Video indicator is ~60px tall (collapsed), so we offset by that amount
  const bottomOffset = videoVisible ? 'bottom-[7.5rem] sm:bottom-[4.5rem]' : 'bottom-20 sm:bottom-6';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        className={`fixed ${bottomOffset} start-4 end-4 sm:start-auto sm:end-4 sm:w-80 z-[60] pointer-events-none transition-all duration-300`}
        dir={direction}
      >
        <div className="pointer-events-auto rounded-xl border bg-background/95 backdrop-blur-md shadow-xl overflow-hidden">
          {/* Header — always visible */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
          >
            {/* Animated icon */}
            <div className="relative">
              {hasActive ? (
                <Loader2 className="h-5 w-5 animate-spin text-sky-600 dark:text-sky-400" />
              ) : hasInterrupted ? (
                <RotateCcw className="h-5 w-5 text-orange-500" />
              ) : hasPaused ? (
                <Pause className="h-5 w-5 text-amber-500" />
              ) : errorTasks.length > 0 ? (
                <AlertCircle className="h-5 w-5 text-rose-500" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              )}
            </div>

            {/* Summary */}
            <div className="flex-1 min-w-0 text-end">
              <p className="text-sm font-medium text-foreground">{statusText}</p>
              {(hasActive || hasPaused) && (
                <p className="text-[11px] text-muted-foreground">
                  {overallProgress}% {locale === 'ar' ? 'إجمالي التقدم' : 'overall'}
                </p>
              )}
            </div>

            {/* Progress ring or action icon */}
            {(hasActive || hasPaused || hasInterrupted) ? (
              <div className="relative h-7 w-7 shrink-0">
                <svg className="h-7 w-7 -rotate-90" viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="12" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/30" />
                  <circle
                    cx="14"
                    cy="14"
                    r="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className={hasInterrupted ? 'text-orange-500' : hasPaused ? 'text-amber-500' : 'text-sky-600'}
                    strokeDasharray={`${2 * Math.PI * 12}`}
                    strokeDashoffset={`${2 * Math.PI * 12 * (1 - overallProgress / 100)}`}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            ) : allDone && visibleTasks.length > 0 ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearCompleted();
                }}
                className="shrink-0 p-1 hover:bg-muted rounded-md transition-colors"
                title={locale === 'ar' ? 'مسح المكتمل' : 'Clear completed'}
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            ) : (
              <div className="shrink-0">
                {expanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            )}
          </button>

          {/* Bulk action buttons */}
          {(hasActive || hasPaused || hasInterrupted) && (
            <div className="flex items-center gap-1 px-4 pb-2">
              {hasActive && (
                <button
                  onClick={() => {
                    for (const task of activeTasks) pauseTask(task.id);
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                >
                  <Pause className="h-3 w-3" />
                  {locale === 'ar' ? 'إيقاف الكل' : 'Pause All'}
                </button>
              )}
              {hasPaused && (
                <button
                  onClick={() => {
                    for (const task of pausedTasks) resumeTask(task.id);
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                >
                  <Play className="h-3 w-3" />
                  {locale === 'ar' ? 'استئناف الكل' : 'Resume All'}
                </button>
              )}
              {hasInterrupted && (
                <button
                  onClick={() => {
                    for (const task of interruptedTasks) retryTask(task.id);
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  {locale === 'ar' ? 'إعادة الكل' : 'Retry All'}
                </button>
              )}
              <button
                onClick={() => {
                  const toCancel = [...activeTasks, ...pausedTasks, ...interruptedTasks];
                  for (const task of toCancel) cancelTask(task.id);
                }}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors ms-auto"
              >
                <X className="h-3 w-3" />
                {locale === 'ar' ? 'إلغاء الكل' : 'Cancel All'}
              </button>
            </div>
          )}

          {/* Expandable details */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="border-t divide-y max-h-64 overflow-y-auto custom-scrollbar">
                  {visibleTasks.map((task) => (
                    <div key={task.id} className="px-3 py-2.5 flex items-center gap-2">
                      {/* Status icon */}
                      {task.status === 'uploading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 dark:text-sky-400 shrink-0" />
                      ) : task.status === 'paused' ? (
                        <Pause className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      ) : task.status === 'interrupted' ? (
                        <RotateCcw className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      ) : task.status === 'success' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      )}

                      {/* Title + progress */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {task.customName}
                        </p>
                        {(task.status === 'uploading' || task.status === 'paused') && (
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                task.status === 'paused' ? 'bg-amber-500' : 'bg-sky-600'
                              }`}
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                        )}
                        {task.status === 'interrupted' && (
                          <p className="text-[10px] text-orange-500 truncate">
                            {locale === 'ar' ? 'تمت مقاطعة الرفع — اضغط إعادة المحاولة' : 'Upload interrupted — tap retry'}
                          </p>
                        )}
                        {task.status === 'error' && task.error && (
                          <p className="text-[10px] text-rose-500 truncate">{task.error}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatFileSize(task.fileSize)}
                        </p>
                      </div>

                      {/* Status text */}
                      <span className="text-[10px] text-muted-foreground shrink-0 min-w-[32px] text-center">
                        {task.status === 'uploading'
                          ? `${task.progress}%`
                          : task.status === 'paused'
                            ? `${task.progress}%`
                            : task.status === 'interrupted'
                              ? '⚠'
                              : task.status === 'success'
                                ? locale === 'ar'
                                  ? 'تم'
                                  : 'Done'
                                : locale === 'ar'
                                  ? 'فشل'
                                  : 'Failed'}
                      </span>

                      {/* Action buttons */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        {task.status === 'uploading' && (
                          <button
                            onClick={() => pauseTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={locale === 'ar' ? 'إيقاف مؤقت' : 'Pause'}
                          >
                            <Pause className="h-3 w-3 text-amber-600" />
                          </button>
                        )}
                        {task.status === 'paused' && (
                          <button
                            onClick={() => resumeTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={locale === 'ar' ? 'استئناف' : 'Resume'}
                          >
                            <Play className="h-3 w-3 text-sky-600" />
                          </button>
                        )}
                        {task.status === 'interrupted' && (
                          <button
                            onClick={() => retryTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={locale === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                          >
                            <RotateCcw className="h-3 w-3 text-orange-600" />
                          </button>
                        )}
                        {(task.status === 'uploading' || task.status === 'paused') && (
                          <button
                            onClick={() => cancelTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={locale === 'ar' ? 'إلغاء' : 'Cancel'}
                          >
                            <X className="h-3 w-3 text-rose-500" />
                          </button>
                        )}
                        {(task.status === 'success' || task.status === 'error') && (
                          <button
                            onClick={() => removeTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={locale === 'ar' ? 'إزالة' : 'Remove'}
                          >
                            <X className="h-3 w-3 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
