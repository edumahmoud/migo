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
//
// NO business logic here — all API calls go to server routes.
// ============================================================

'use client';

import { useState, useCallback, useEffect } from 'react';
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

  const startIncrementalAuth = useCallback(() => {
    if (authStatus?.authUrl) {
      // Open the Google OAuth consent screen in a new tab
      window.open(authStatus.authUrl, '_blank', 'width=600,height=700');
    }
  }, [authStatus]);

  // ─── Reset State ───

  const reset = useCallback(() => {
    setExportResult(null);
    setError(null);
    setExportProgress(INITIAL_PROGRESS);
  }, []);

  // ─── Auto-check auth when hook mounts ──
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return {
    authStatus,
    isLoadingAuth,
    isLoadingForms,
    isExporting,
    exportProgress,
    userForms,
    exportResult,
    error,
    checkAuth,
    loadUserForms,
    exportToGoogleForm,
    startIncrementalAuth,
    reset,
  };
}
