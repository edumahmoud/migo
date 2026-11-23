'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { supabase } from '@/lib/supabase';
import type { ScormVersion } from '@/lib/scorm-types';
import MascotLoader from '@/components/shared/mascot-loader';
import {
  type ScormSnapshot,
} from '@/lib/scorm-api-adapter';
import { formatClock } from '@/lib/scorm-runtime';

// ─── Props ───
interface ScormPlayerProps {
  packageId: string;
  resourceId: string;
  onClose: () => void;
  onProgressUpdate?: (trackingData: Record<string, unknown>) => void;
}

// The package runs in a sandboxed iframe with an opaque origin (no allow-same-origin), so it
// cannot reach this app's cookies, storage or window. /api/scorm/content injects the SCORM API
// engine into each HTML page; the engine reports changes here with postMessage.

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
  const [isPreview, setIsPreview] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sessionStartRef = useRef<number>(Date.now());
  const finalSentRef = useRef(false);
  const lastSnapshotRef = useRef<ScormSnapshot | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onProgressRef = useRef(onProgressUpdate);
  useEffect(() => {
    onProgressRef.current = onProgressUpdate;
  }, [onProgressUpdate]);

  // ── Send tracking to the server ──
  const sendTracking = useCallback(
    async (snap: ScormSnapshot, final: boolean, keepalive = false) => {
      if (isPreview) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        let sessionTime = snap.session_time;
        if (final && (!sessionTime || /^(0+:0+:0+(\.0+)?|PT0H0M0S|PT0S)$/.test(sessionTime))) {
          // The SCO did not report a session time: use the time the learner spent in the player
          sessionTime = formatClock((Date.now() - sessionStartRef.current) / 1000);
        }

        const response = await fetch('/api/scorm/track', {
          method: 'POST',
          keepalive,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            package_id: packageId,
            resource_id: resourceId,
            lesson_status: snap.lesson_status,
            completion_status: snap.completion_status,
            success_status: snap.success_status,
            score_raw: snap.score_raw,
            score_min: snap.score_min,
            score_max: snap.score_max,
            score_scaled: snap.score_scaled,
            session_time: sessionTime,
            suspend_data: snap.suspend_data,
            final,
          }),
        });
        const result = await response.json().catch(() => null);
        if (result?.success && result.data) onProgressRef.current?.(result.data);
      } catch (err) {
        console.error('[ScormPlayer] Tracking error:', err);
      }
    },
    [packageId, resourceId, isPreview],
  );

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
      setPackageVersion(data.packageVersion === '2004' ? '2004' : '1.2');
      setPackageTitle(data.packageTitle);
      setResourceTitle(data.resourceTitle);
      setIsPreview(!!data.isPreview);
      sessionStartRef.current = Date.now();
      finalSentRef.current = false;
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

  // ── The SCORM API runs inside the sandboxed frame; it reports to us with postMessage ──
  useEffect(() => {
    if (!launchUrl) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; final?: boolean; snapshot?: ScormSnapshot } | null;
      if (!data || data.source !== 'scorm-shim' || !data.snapshot || typeof data.snapshot !== 'object') return;
      const snap = data.snapshot;
      lastSnapshotRef.current = snap;
      if (data.type === 'change') {
        // Status and score changes are saved shortly after, not on every call
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (!finalSentRef.current) void sendTracking(snap, false);
        }, 1500);
      } else if (data.type === 'commit') {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (data.final) {
          if (finalSentRef.current) return;
          finalSentRef.current = true;
        }
        void sendTracking(snap, !!data.final);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [launchUrl, sendTracking]);

  // ── Close: make sure the final session time is saved exactly once ──
  const handleClose = useCallback(async () => {
    if (!finalSentRef.current && lastSnapshotRef.current) {
      finalSentRef.current = true;
      await sendTracking(lastSnapshotRef.current, true, true);
    } else if (!finalSentRef.current && !isPreview) {
      // The SCO never reported anything: still record the time spent
      finalSentRef.current = true;
      await sendTracking({ session_time: '', suspend_data: '', lesson_status: packageVersion === '1.2' ? 'incomplete' : undefined, completion_status: packageVersion === '2004' ? 'incomplete' : undefined }, true, true);
    }
    onClose();
  }, [sendTracking, onClose, isPreview, packageVersion]);

  // ── Leaving the page without pressing close: still save the time spent ──
  const sendTrackingRef = useRef(sendTracking);
  useEffect(() => {
    sendTrackingRef.current = sendTracking;
  }, [sendTracking]);
  useEffect(() => {
    return () => {
      if (!finalSentRef.current && lastSnapshotRef.current) {
        finalSentRef.current = true;
        void sendTrackingRef.current(lastSnapshotRef.current, true, true);
      }
    };
  }, []);

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
          <MascotLoader kind="book" size={96} />
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
          sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads"
        />
      )}
    </div>
  );
}
