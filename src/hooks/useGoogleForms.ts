// ============================================================
// useGoogleForms Hook — Client-side State Management
// ============================================================
//
// This hook manages all client-side state for the Google Forms
// export feature. It handles:
// - Auth status checking
// - User's Google Forms listing
// - Export execution with progress tracking
// - Error handling and retry
// - OAuth callback URL parameter detection
//
// NO business logic here — all API calls go to server routes.
// ============================================================

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import type {
  GoogleAuthStatus,
  GoogleFormListItem,
  ExportGoogleFormConfig,
  ExportGoogleFormResult,
  ExportProgress,
  ExportGoogleFormResponse,
  ListGoogleFormsResponse,
} from '@/types/googleForms';

// ─── Initial State ───

const INITIAL_PROGRESS: ExportProgress = {
  stage: 'idle',
  currentStep: 0,
  totalSteps: 0,
  message: '',
};

// ─── Hook ───

export function useGoogleForms() {
  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [isLoadingForms, setIsLoadingForms] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress>(INITIAL_PROGRESS);
  const [userForms, setUserForms] = useState<GoogleFormListItem[]>([]);
  const [exportResult, setExportResult] = useState<ExportGoogleFormResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authJustCompleted, setAuthJustCompleted] = useState(false);

  // Track popup window for polling
  const popupRef = useRef<Window | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Auth Headers Helper ───

  const getHeaders = useCallback(async () => {
    const headers = await getCachedAuthHeaders();
    return {
      'Content-Type': 'application/json',
      ...headers,
    };
  }, []);

  // ─── Check Auth Status ───

  const checkAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setError(null);

    try {
      const headers = await getHeaders();
      const response = await fetch('/api/google/auth/check', { headers });
      const data = await response.json();

      if (data.success) {
        setAuthStatus(data.data);
      } else {
        setError(data.error || 'Failed to check Google authorization');
        setAuthStatus(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setAuthStatus(null);
    } finally {
      setIsLoadingAuth(false);
    }
  }, [getHeaders]);

  // ─── Load User's Google Forms ───

  const loadUserForms = useCallback(async () => {
    setIsLoadingForms(true);
    setError(null);

    try {
      const headers = await getHeaders();
      const response = await fetch('/api/google/forms/list', { headers });
      const data: ListGoogleFormsResponse = await response.json();

      if (data.success && data.forms) {
        setUserForms(data.forms);
      } else if (data.authRequired && data.authUrl) {
        // User needs to authorize — store the auth URL
        setAuthStatus({
          isAuthorized: false,
          hasFormsScope: false,
          needsIncrementalAuth: true,
          authUrl: data.authUrl,
        });
        setError('Google authorization required');
      } else {
        setError(data.error || 'Failed to load Google Forms');
        setUserForms([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setUserForms([]);
    } finally {
      setIsLoadingForms(false);
    }
  }, [getHeaders]);

  // ─── Export Questions ───

  const exportToGoogleForm = useCallback(async (
    questionIds: string[],
    bankIds: string[],
    config: ExportGoogleFormConfig
  ) => {
    setIsExporting(true);
    setExportResult(null);
    setError(null);

    // Set up progress tracking
    const totalSteps = 5;
    setExportProgress({ stage: 'preparing', currentStep: 1, totalSteps, message: 'Preparing export...' });

    try {
      setExportProgress({ stage: 'authenticating', currentStep: 2, totalSteps, message: 'Verifying Google authorization...' });

      const headers = await getHeaders();
      const response = await fetch('/api/google/forms/export', {
        method: 'POST',
        headers,
        body: JSON.stringify({ questionIds, bankIds, config }),
      });

      const data: ExportGoogleFormResponse = await response.json();

      if (data.success && data.data) {
        setExportProgress({ stage: 'complete', currentStep: 5, totalSteps, message: 'Export completed!' });
        setExportResult(data.data);
        return data.data;
      }

      if (data.authRequired && data.authUrl) {
        // User needs incremental authorization
        setAuthStatus({
          isAuthorized: false,
          hasFormsScope: false,
          needsIncrementalAuth: true,
          authUrl: data.authUrl,
        });
        setError('Google authorization required. Click "Authorize" to grant access.');
        setExportProgress({ stage: 'error', currentStep: 2, totalSteps, message: 'Authorization required' });
        return null;
      }

      // Export failed with an error
      setError(data.error || 'Export failed');
      setExportProgress({ stage: 'error', currentStep: 3, totalSteps, message: data.error || 'Export failed' });
      return null;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      setError(message);
      setExportProgress({ stage: 'error', currentStep: 3, totalSteps, message });
      return null;
    } finally {
      setIsExporting(false);
    }
  }, [getHeaders]);

  // ─── Start Incremental Authorization ───
  //
  // Two strategies:
  // 1. Same-tab redirect (default) — user goes to Google in same tab,
  //    then comes back with URL params that we detect
  // 2. Popup + polling — opens a popup window and polls auth status
  //    every 3 seconds until the popup closes or auth completes
  //
  // We use the popup + polling approach as it preserves the current
  // page state. After the popup redirects back, we detect auth
  // changes through polling.

  const startIncrementalAuth = useCallback(() => {
    if (!authStatus?.authUrl) return;

    // Open popup window for Google OAuth
    const popup = window.open(authStatus.authUrl, 'google_oauth_popup', 'width=600,height=700,left=200,top=100');

    if (!popup) {
      // Popup blocked — fall back to same-tab redirect
      window.location.href = authStatus.authUrl;
      return;
    }

    popupRef.current = popup;

    // Start polling auth status every 3 seconds while popup is open
    // This detects when the user completes authorization in the popup
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      // Check if popup has been closed
      if (!popupRef.current || popupRef.current.closed) {
        // Popup closed — stop polling and re-check auth
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        popupRef.current = null;
        // Re-check auth status now that popup is closed
        await checkAuth();
        return;
      }

      // Poll auth status even while popup is open
      // If the callback already stored tokens, auth check will succeed
      try {
        const headers = await getHeaders();
        const response = await fetch('/api/google/auth/check', { headers });
        const data = await response.json();

        if (data.success && data.data?.isAuthorized && data.data?.hasFormsScope) {
          // Auth completed! Stop polling, close popup, update state
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          try { popupRef.current.close(); } catch { /* ignore */ }
          popupRef.current = null;
          setAuthStatus(data.data);
          setAuthJustCompleted(true);
          setError(null);
        }
      } catch {
        // Network error during polling — ignore and keep polling
      }
    }, 3000);

  }, [authStatus, checkAuth, getHeaders]);

  // ─── Detect URL params from OAuth callback (same-tab fallback) ───

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authSuccess = urlParams.get('google_auth_success');
    const authError = urlParams.get('google_auth_error');

    if (authSuccess === 'true') {
      // Clean URL params
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      // Mark auth as just completed and re-check
      setAuthJustCompleted(true);
      checkAuth();
    }

    if (authError) {
      // Clean URL params
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      setError(authError);
    }
  }, [checkAuth]);

  // ─── Auto-check auth when hook mounts ──

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // ─── Cleanup polling on unmount ───

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ─── Reset State ───

  const reset = useCallback(() => {
    setExportResult(null);
    setError(null);
    setExportProgress(INITIAL_PROGRESS);
    setAuthJustCompleted(false);
  }, []);

  return {
    authStatus,
    isLoadingAuth,
    isLoadingForms,
    isExporting,
    exportProgress,
    userForms,
    exportResult,
    error,
    authJustCompleted,
    checkAuth,
    loadUserForms,
    exportToGoogleForm,
    startIncrementalAuth,
    reset,
  };
}
