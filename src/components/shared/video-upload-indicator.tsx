'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle, Pause, Play, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useVideoUploadStore } from '@/stores/video-upload-store';
import { useTranslations } from '@/i18n/use-translations';
import { useState } from 'react';

/**
 * Global floating upload indicator.
 * Shows at the bottom of the screen whenever there are active video uploads,
 * regardless of which page the user is on.
 * Supports pause/resume/cancel for each upload.
 */
export default function VideoUploadIndicator() {
  const { t, direction } = useTranslations('files');
  const { t: tc } = useTranslations('common');
  const { tasks, pauseTask, resumeTask, cancelTask, clearCompleted } = useVideoUploadStore();
  const [expanded, setExpanded] = useState(false);

  const activeTasks = tasks.filter((t) => t.status === 'uploading' || t.status === 'saving');
  const pausedTasks = tasks.filter((t) => t.status === 'paused');
  const completedTasks = tasks.filter((t) => t.status === 'done' || t.status === 'error');
  const allTasks = tasks.filter((t) => t.status !== 'cancelled');

  // Don't render if no tasks at all
  if (allTasks.length === 0) return null;

  // Calculate overall progress of active + paused tasks
  const progressTasks = [...activeTasks, ...pausedTasks];
  const overallProgress = progressTasks.length > 0
    ? Math.round(progressTasks.reduce((sum, t) => sum + t.progress, 0) / progressTasks.length)
    : completedTasks.length > 0 ? 100 : 0;

  const hasActive = activeTasks.length > 0;
  const hasPaused = pausedTasks.length > 0;

  // Determine header status
  const statusText = hasActive
    ? t('uploadingVideos', { count: activeTasks.length }) + (hasPaused ? ` (${t('pausedCount', { count: pausedTasks.length })})` : '')
    : hasPaused
    ? t('videosPaused', { count: pausedTasks.length })
    : completedTasks.every((task) => task.status === 'done')
    ? t('allVideosUploaded')
    : t('someUploadsFailed');

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        className="fixed bottom-20 start-4 end-4 sm:start-auto sm:end-4 sm:w-80 sm:bottom-6 z-[60] pointer-events-none"
        dir={direction}
      >
        <div className="pointer-events-auto rounded-xl border bg-background/95 backdrop-blur-md shadow-xl overflow-hidden">
          {/* Header - always visible */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
          >
            {/* Animated icon */}
            <div className="relative">
              {hasActive ? (
                <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
              ) : hasPaused ? (
                <Pause className="h-5 w-5 text-amber-500" />
              ) : completedTasks.every((t) => t.status === 'done') ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-rose-500" />
              )}
            </div>

            {/* Summary */}
            <div className="flex-1 min-w-0 text-end">
              <p className="text-sm font-medium text-foreground">
                {statusText}
              </p>
              {(hasActive || hasPaused) && (
                <p className="text-[11px] text-muted-foreground">{overallProgress}% {t('overallProgress')}</p>
              )}
            </div>

            {/* Progress ring or expand icon */}
            {(hasActive || hasPaused) ? (
              <div className="relative h-7 w-7 shrink-0">
                <svg className="h-7 w-7 -rotate-90" viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="12" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/30" />
                  <circle
                    cx="14" cy="14" r="12" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className={hasPaused ? 'text-amber-500' : 'text-sky-600'}
                    strokeDasharray={`${2 * Math.PI * 12}`}
                    strokeDashoffset={`${2 * Math.PI * 12 * (1 - overallProgress / 100)}`}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            ) : completedTasks.length > 0 ? (
              <button
                onClick={(e) => { e.stopPropagation(); clearCompleted(); }}
                className="shrink-0 p-1 hover:bg-muted rounded-md transition-colors"
                title={t('clearCompleted')}
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            ) : (
              <div className="shrink-0">
                {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
              </div>
            )}
          </button>

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
                  {allTasks.map((task) => (
                    <div key={task.id} className="px-3 py-2.5 flex items-center gap-2">
                      {/* Status icon */}
                      {task.status === 'uploading' || task.status === 'saving' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 shrink-0" />
                      ) : task.status === 'paused' ? (
                        <Pause className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      ) : task.status === 'done' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      )}

                      {/* Title + progress */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{task.title}</p>
                        {(task.status === 'uploading' || task.status === 'saving' || task.status === 'paused') && (
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                task.status === 'paused' ? 'bg-amber-500' :
                                task.status === 'saving' ? 'bg-amber-500' : 'bg-sky-600'
                              }`}
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                        )}
                        {task.status === 'error' && task.error && (
                          <p className="text-[10px] text-rose-500 truncate">{task.error}</p>
                        )}
                      </div>

                      {/* Status text */}
                      <span className="text-[10px] text-muted-foreground shrink-0 min-w-[32px] text-center">
                        {task.status === 'uploading' ? `${task.progress}%` :
                         task.status === 'paused' ? `${task.progress}%` :
                         task.status === 'saving' ? t('saving') :
                         task.status === 'done' ? tc('success') : t('failed')}
                      </span>

                      {/* Action buttons */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        {task.status === 'uploading' && (
                          <button
                            onClick={() => pauseTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={t('pause')}
                          >
                            <Pause className="h-3 w-3 text-amber-600" />
                          </button>
                        )}
                        {task.status === 'paused' && (
                          <button
                            onClick={() => resumeTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={t('resume')}
                          >
                            <Play className="h-3 w-3 text-sky-600" />
                          </button>
                        )}
                        {(task.status === 'uploading' || task.status === 'paused') && (
                          <button
                            onClick={() => cancelTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={tc('cancel')}
                          >
                            <X className="h-3 w-3 text-rose-500" />
                          </button>
                        )}
                        {(task.status === 'done' || task.status === 'error') && (
                          <button
                            onClick={() => useVideoUploadStore.getState().removeTask(task.id)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title={t('remove')}
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
