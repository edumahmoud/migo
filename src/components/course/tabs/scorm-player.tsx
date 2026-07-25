'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, X, Maximize2, Minimize2, ChevronRight } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { supabase } from '@/lib/supabase';
import type { ScormVersion, ScormCompletionStatus, ScormSuccessStatus } from '@/lib/scorm-types';

// ─── Props ───
interface ScormPlayerProps {
  packageId: string;
  resourceId: string;
  onClose: () => void;
  onProgressUpdate?: (trackingData: Record<string, unknown>) => void;
}

// ─── SCORM API Adapter ───
// This creates the window.API (SCORM 1.2) or window.API_1484_11 (SCORM 2004)
// object that the SCO content will call through its iframe.

interface ScormCmiState {
  // SCORM 1.2 core fields
  core_lesson_status: string;
  core_score_raw: string;
  core_score_min: string;
  core_score_max: string;
  core_session_time: string;
  core_total_time: string;
  core_lesson_location: string;
  core_suspend_data: string;
  core_entry: string;
  core_credit: string;
  core_mode: string;
  core_student_id: string;
  core_student_name: string;
  // SCORM 2004 additional fields
  completion_status?: string;
  success_status?: string;
  score_scaled?: string;
  progress_measure?: string;
  location?: string;
  learner_id?: string;
  learner_name?: string;
  learner_preference_language?: string;
}

function createScorm12API(
  initialCmi: Record<string, unknown>,
  trackingCallback: (data: Record<string, unknown>) => void
): Record<string, unknown> {
  const cmiState: Record<string, string> = {
    'cmi.core.lesson_status': String(initialCmi.cmi_core_lesson_status || 'not_attempted'),
    'cmi.core.score.raw': String(initialCmi.cmi_core_score_raw || '0'),
    'cmi.core.score.min': String(initialCmi.cmi_core_score_min || '0'),
    'cmi.core.score.max': String(initialCmi.cmi_core_score_max || '100'),
    'cmi.core.session_time': String(initialCmi.cmi_core_session_time || '00:00:00'),
    'cmi.core.total_time': String(initialCmi.cmi_core_total_time || '00:00:00'),
    'cmi.core.lesson_location': String(initialCmi.cmi_core_lesson_location || ''),
    'cmi.core.suspend_data': String(initialCmi.cmi_core_suspend_data || ''),
    'cmi.core.entry': String(initialCmi.cmi_core_entry || 'ab-initio'),
    'cmi.core.credit': String(initialCmi.cmi_core_credit || 'credit'),
    'cmi.core.mode': String(initialCmi.cmi_core_mode || 'normal'),
    'cmi.core.student_id': String(initialCmi.cmi_core_student_id || ''),
    'cmi.core.student_name': String(initialCmi.cmi_core_student_name || ''),
    'cmi.student_preference.language': 'en',
    'cmi.launch_data': '',
  };

  let initialized = false;
  let finished = false;

  return {
    LMSInitialize: (param: string): string => {
      if (param !== '' && param !== 'true') return 'false';
      initialized = true;
      return 'true';
    },
    LMSFinish: (param: string): string => {
      if (!initialized) return 'false';
      finished = true;
      // Send final tracking data
      trackingCallback({
        completion_status: cmiState['cmi.core.lesson_status'],
        score_raw: parseFloat(cmiState['cmi.core.score.raw']),
        score_min: parseFloat(cmiState['cmi.core.score.min']),
        score_max: parseFloat(cmiState['cmi.core.score.max']),
        session_time: cmiState['cmi.core.session_time'],
        suspend_data: cmiState['cmi.core.suspend_data'],
        success_status: cmiState['cmi.core.lesson_status'] === 'passed' ? 'passed' : cmiState['cmi.core.lesson_status'] === 'failed' ? 'failed' : 'unknown',
      });
      return 'true';
    },
    LMSGetValue: (element: string): string => {
      if (!initialized) return '';
      return cmiState[element] || '';
    },
    LMSSetValue: (element: string, value: string): string => {
      if (!initialized) return 'false';
      cmiState[element] = value;
      // Send tracking update on significant changes
      if (element.includes('lesson_status') || element.includes('score') || element.includes('completion_status')) {
        trackingCallback({
          completion_status: cmiState['cmi.core.lesson_status'],
          score_raw: parseFloat(cmiState['cmi.core.score.raw']),
          score_min: parseFloat(cmiState['cmi.core.score.min']),
          score_max: parseFloat(cmiState['cmi.core.score.max']),
          session_time: cmiState['cmi.core.session_time'],
          suspend_data: cmiState['cmi.core.suspend_data'],
          success_status: cmiState['cmi.core.lesson_status'] === 'passed' ? 'passed' : cmiState['cmi.core.lesson_status'] === 'failed' ? 'failed' : 'unknown',
        });
      }
      return 'true';
    },
    LMSCommit: (param: string): string => {
      if (!initialized) return 'false';
      // Send tracking data to the server
      trackingCallback({
        completion_status: cmiState['cmi.core.lesson_status'],
        score_raw: parseFloat(cmiState['cmi.core.score.raw']),
        score_min: parseFloat(cmiState['cmi.core.score.min']),
        score_max: parseFloat(cmiState['cmi.core.score.max']),
        session_time: cmiState['cmi.core.session_time'],
        suspend_data: cmiState['cmi.core.suspend_data'],
        success_status: cmiState['cmi.core.lesson_status'] === 'passed' ? 'passed' : cmiState['cmi.core.lesson_status'] === 'failed' ? 'failed' : 'unknown',
      });
      return 'true';
    },
    LMSGetLastError: (): string => '0',
    LMSGetErrorString: (errorCode: string): string => {
      if (errorCode === '0') return 'No error';
      return 'Unknown error';
    },
    LMSGetDiagnostic: (errorCode: string): string => {
      if (errorCode === '0') return 'No error';
      return 'Unknown error diagnostic';
    },
  };
}

function createScorm2004API(
  initialCmi: Record<string, unknown>,
  trackingCallback: (data: Record<string, unknown>) => void
): Record<string, unknown> {
  const cmiState: Record<string, string> = {
    'cmi.completion_status': String(initialCmi.cmi_completion_status || 'not_attempted'),
    'cmi.success_status': String(initialCmi.cmi_success_status || 'unknown'),
    'cmi.score.scaled': String(initialCmi.cmi_score_scaled || '0'),
    'cmi.score.raw': String(initialCmi.cmi_score_raw || '0'),
    'cmi.score.min': String(initialCmi.cmi_score_min || '0'),
    'cmi.score.max': String(initialCmi.cmi_score_max || '100'),
    'cmi.progress_measure': String(initialCmi.cmi_progress_measure || '0'),
    'cmi.total_time': String(initialCmi.cmi_total_time || '00:00:00'),
    'cmi.session_time': String(initialCmi.cmi_session_time || '00:00:00'),
    'cmi.suspend_data': String(initialCmi.cmi_suspend_data || ''),
    'cmi.location': String(initialCmi.cmi_location || ''),
    'cmi.entry': String(initialCmi.cmi_entry || 'ab-initio'),
    'cmi.mode': String(initialCmi.cmi_mode || 'normal'),
    'cmi.credit': String(initialCmi.cmi_credit || 'credit'),
    'cmi.learner_id': String(initialCmi.cmi_learner_id || ''),
    'cmi.learner_name': String(initialCmi.cmi_learner_name || ''),
    'cmi.learner_preference.language': 'en',
  };

  let initialized = false;
  let finished = false;

  return {
    Initialize: (param: string): string => {
      if (param !== '' && param !== 'true') return 'false';
      initialized = true;
      return 'true';
    },
    Terminate: (param: string): string => {
      if (!initialized) return 'false';
      finished = true;
      trackingCallback({
        completion_status: cmiState['cmi.completion_status'],
        success_status: cmiState['cmi.success_status'],
        score_raw: parseFloat(cmiState['cmi.score.raw']),
        score_min: parseFloat(cmiState['cmi.score.min']),
        score_max: parseFloat(cmiState['cmi.score.max']),
        score_scaled: parseFloat(cmiState['cmi.score.scaled']),
        session_time: cmiState['cmi.session_time'],
        suspend_data: cmiState['cmi.suspend_data'],
      });
      return 'true';
    },
    GetValue: (element: string): string => {
      if (!initialized) return '';
      return cmiState[element] || '';
    },
    SetValue: (element: string, value: string): string => {
      if (!initialized) return 'false';
      cmiState[element] = value;
      if (element.includes('completion_status') || element.includes('success_status') || element.includes('score')) {
        trackingCallback({
          completion_status: cmiState['cmi.completion_status'],
          success_status: cmiState['cmi.success_status'],
          score_raw: parseFloat(cmiState['cmi.score.raw']),
          score_min: parseFloat(cmiState['cmi.score.min']),
          score_max: parseFloat(cmiState['cmi.score.max']),
          score_scaled: parseFloat(cmiState['cmi.score.scaled']),
          session_time: cmiState['cmi.session_time'],
          suspend_data: cmiState['cmi.suspend_data'],
        });
      }
      return 'true';
    },
    Commit: (param: string): string => {
      if (!initialized) return 'false';
      trackingCallback({
        completion_status: cmiState['cmi.completion_status'],
        success_status: cmiState['cmi.success_status'],
        score_raw: parseFloat(cmiState['cmi.score.raw']),
        score_min: parseFloat(cmiState['cmi.score.min']),
        score_max: parseFloat(cmiState['cmi.score.max']),
        score_scaled: parseFloat(cmiState['cmi.score.scaled']),
        session_time: cmiState['cmi.session_time'],
        suspend_data: cmiState['cmi.suspend_data'],
      });
      return 'true';
    },
    GetLastError: (): string => '0',
    GetErrorString: (errorCode: string): string => {
      if (errorCode === '0') return 'No error';
      return 'Unknown error';
    },
    GetDiagnostic: (errorCode: string): string => {
      if (errorCode === '0') return 'No error';
      return 'Unknown error diagnostic';
    },
  };
}

// ─── Main Component ───

export default function ScormPlayer({ packageId, resourceId, onClose, onProgressUpdate }: ScormPlayerProps) {
  const { t } = useTranslations();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launchUrl, setLaunchUrl] = useState<string>('');
  const [packageVersion, setPackageVersion] = useState<ScormVersion>('1.2');
  const [packageTitle, setPackageTitle] = useState<string>('');
  const [resourceTitle, setResourceTitle] = useState<string>('');
  const [cmiData, setCmiData] = useState<Record<string, unknown>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sessionStartTime] = useState(Date.now());

  // ── Fetch launch data ──
  const fetchLaunchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch(`/api/scorm/launch?packageId=${packageId}&resourceId=${resourceId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || t('scorm.launchError') || 'Failed to load SCORM content');
        return;
      }

      const data = result.data;
      setLaunchUrl(data.launchUrl);
      setPackageVersion(data.packageVersion);
      setPackageTitle(data.packageTitle);
      setResourceTitle(data.resourceTitle);
      setCmiData(data.cmiData || {});
    } catch (err) {
      console.error('[ScormPlayer] Fetch launch data error:', err);
      setError(t('scorm.launchError') || 'Failed to load SCORM content');
    } finally {
      setLoading(false);
    }
  }, [packageId, resourceId, t]);

  useEffect(() => {
    fetchLaunchData();
  }, [fetchLaunchData]);

  // ── Inject SCORM API into iframe ──
  useEffect(() => {
    if (!launchUrl || !iframeRef.current) return;

    const iframe = iframeRef.current;

    const handleLoad = () => {
      try {
        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) return;

        // Create tracking callback that sends data to our API
        const trackingCallback = async (data: Record<string, unknown>) => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            await fetch('/api/scorm/track', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                student_id: session?.user?.id,
                package_id: packageId,
                resource_id: resourceId,
                completion_status: data.completion_status,
                success_status: data.success_status,
                score_raw: data.score_raw,
                score_min: data.score_min,
                score_max: data.score_max,
                score_scaled: data.score_scaled,
                session_time: data.session_time,
                suspend_data: data.suspend_data,
              }),
            });

            // Notify parent component of progress update
            if (onProgressUpdate) {
              onProgressUpdate(data);
            }
          } catch (err) {
            console.error('[ScormPlayer] Tracking callback error:', err);
          }
        };

        // Inject SCORM API based on version
        if (packageVersion === '1.2') {
          const api = createScorm12API(cmiData, trackingCallback);
          (iframeWindow as unknown as Record<string, unknown>).API = api;
        } else {
          const api = createScorm2004API(cmiData, trackingCallback);
          (iframeWindow as unknown as Record<string, unknown>).API_1484_11 = api;
        }

        console.log('[ScormPlayer] SCORM API injected:', packageVersion === '1.2' ? 'window.API' : 'window.API_1484_11');
      } catch (err) {
        console.error('[ScormPlayer] API injection error:', err);
        // Cross-origin iframe — API injection may fail. 
        // In this case, the SCORM content needs to find the API from the parent window.
      }
    };

    iframe.addEventListener('load', handleLoad);

    // Also set API on the parent window as fallback
    // SCORM content typically searches parent windows for the API
    const trackingCallback = async (data: Record<string, unknown>) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        await fetch('/api/scorm/track', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            student_id: session?.user?.id,
            package_id: packageId,
            resource_id: resourceId,
            completion_status: data.completion_status,
            success_status: data.success_status,
            score_raw: data.score_raw,
            score_min: data.score_min,
            score_max: data.score_max,
            score_scaled: data.score_scaled,
            session_time: data.session_time,
            suspend_data: data.suspend_data,
          }),
        });

        if (onProgressUpdate) {
          onProgressUpdate(data);
        }
      } catch (err) {
        console.error('[ScormPlayer] Parent window tracking error:', err);
      }
    };

    if (packageVersion === '1.2') {
      (window as unknown as Record<string, unknown>).API = createScorm12API(cmiData, trackingCallback);
    } else {
      (window as unknown as Record<string, unknown>).API_1484_11 = createScorm2004API(cmiData, trackingCallback);
    }

    return () => {
      iframe.removeEventListener('load', handleLoad);
      // Clean up parent window API
      delete (window as unknown as Record<string, unknown>).API;
      delete (window as unknown as Record<string, unknown>).API_1484_11;
    };
  }, [launchUrl, packageVersion, cmiData, packageId, resourceId, onProgressUpdate]);

  // ── Calculate session time on close ──
  const handleClose = useCallback(async () => {
    const elapsedMs = Date.now() - sessionStartTime;
    const hours = Math.floor(elapsedMs / 3600000);
    const minutes = Math.floor((elapsedMs % 3600000) / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    const sessionTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Final session time update
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      await fetch('/api/scorm/track', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          student_id: session?.user?.id,
          package_id: packageId,
          resource_id: resourceId,
          session_time: sessionTime,
        }),
      }).catch(() => {});
    } catch {
      // Ignore tracking errors on close
    }

    onClose();
  }, [sessionStartTime, packageId, resourceId, onClose]);

  // ── Toggle fullscreen ──
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
        <div className="text-red-500 text-lg font-medium mb-4">{error}</div>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
        >
          {t('scorm.close') || 'Close'}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-black' : 'relative'} transition-all duration-300`}>
      {/* ── Header Bar ── */}
      <div className={`flex items-center justify-between px-4 py-2 bg-gradient-to-r from-sky-700 to-sky-800 text-white ${isFullscreen ? 'sticky top-0' : ''}`}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate max-w-[300px]">
            {packageTitle} — {resourceTitle}
          </span>
          <span className="text-xs opacity-75">
            SCORM {packageVersion}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title={isFullscreen ? t('scorm.exitFullscreen') || 'Exit Fullscreen' : t('scorm.fullscreen') || 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title={t('scorm.close') || 'Close'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Loading Overlay ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 mb-4" />
          <span className="text-muted-foreground">{t('scorm.loading') || 'Loading SCORM content...'}</span>
        </div>
      )}

      {/* ── SCORM Content iframe ── */}
      {!loading && launchUrl && (
        <iframe
          ref={iframeRef}
          src={launchUrl}
          className={`flex-1 ${isFullscreen ? 'h-[calc(100vh-48px)]' : 'min-h-[500px]'} border-0 bg-white`}
          title={`${packageTitle} - ${resourceTitle}`}
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      )}
    </div>
  );
}
