// Browser helper: upload a SCORM ZIP to one of the /api/scorm upload endpoints.
// Vercel rejects request bodies over 4.5MB, so larger files go straight to Supabase
// storage through a signed upload URL and the endpoint is then asked to register them.

import { supabase } from '@/lib/supabase';

const DIRECT_LIMIT_BYTES = 3.5 * 1024 * 1024;

export interface ScormUploadResult {
  success: boolean;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

export async function uploadScormZip(opts: {
  endpoint: string;
  file: File;
  accessToken: string | undefined;
  /** Extra form fields (subjectId, title, name, description, version, link_subject_ids ...) */
  fields: Record<string, string | undefined>;
}): Promise<ScormUploadResult> {
  const { endpoint, file, accessToken, fields } = opts;
  const auth = { Authorization: `Bearer ${accessToken}` };
  const cleanFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''));

  try {
    if (file.size <= DIRECT_LIMIT_BYTES) {
      const form = new FormData();
      form.append('file', file);
      for (const [k, v] of Object.entries(cleanFields)) form.append(k, v as string);
      const res = await fetch(endpoint, { method: 'POST', headers: auth, body: form });
      return await res.json();
    }

    const initRes = await fetch(endpoint, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cleanFields, action: 'init', filename: file.name, size: file.size }),
    });
    const init = await initRes.json();
    if (!init.success) return init;

    const { path, token } = init.data as { path: string; token: string };
    const { error: uploadError } = await supabase.storage
      .from('scorm-packages')
      .uploadToSignedUrl(path, token, file, { contentType: 'application/zip' });
    if (uploadError) return { success: false, error: uploadError.message };

    const doneRes = await fetch(endpoint, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cleanFields, action: 'complete', path }),
    });
    return await doneRes.json();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Upload failed' };
  }
}
