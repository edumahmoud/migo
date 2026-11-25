/**
 * AttenDo — Firebase Cloud Messaging sender (HTTP v1), keyless.
 *
 * Auth: Vercel OIDC token -> Google STS (Workload Identity Federation)
 *       -> impersonate the Firebase service account -> OAuth access token.
 * No service-account key exists anywhere.
 *
 * Env (all non-secret identifiers):
 *   FCM_PROJECT_ID, GCP_PROJECT_NUMBER, GCP_WIF_POOL, GCP_WIF_PROVIDER, GCP_SERVICE_ACCOUNT_EMAIL
 */
import { supabaseServer } from '@/lib/supabase-server';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

let cached: { token: string; expiresAt: number } | null = null;

export function isFcmConfigured(): boolean {
  return !!(
    process.env.FCM_PROJECT_ID &&
    process.env.GCP_PROJECT_NUMBER &&
    process.env.GCP_WIF_POOL &&
    process.env.GCP_WIF_PROVIDER &&
    process.env.GCP_SERVICE_ACCOUNT_EMAIL
  );
}

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const { getVercelOidcToken } = await import('@vercel/oidc');
  const oidc = await getVercelOidcToken();

  const audience =
    `//iam.googleapis.com/projects/${process.env.GCP_PROJECT_NUMBER}` +
    `/locations/global/workloadIdentityPools/${process.env.GCP_WIF_POOL}` +
    `/providers/${process.env.GCP_WIF_PROVIDER}`;

  const sts = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience,
      scope: SCOPE,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: oidc,
    }),
  });
  if (!sts.ok) throw new Error(`STS exchange failed: ${sts.status} ${await sts.text()}`);
  const { access_token: federated } = (await sts.json()) as { access_token: string };

  const sa = encodeURIComponent(process.env.GCP_SERVICE_ACCOUNT_EMAIL!);
  const imp = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${sa}:generateAccessToken`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${federated}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: [SCOPE], lifetime: '3600s' }),
    },
  );
  if (!imp.ok) throw new Error(`Impersonation failed: ${imp.status} ${await imp.text()}`);
  const { accessToken } = (await imp.json()) as { accessToken: string };
  cached = { token: accessToken, expiresAt: Date.now() + 55 * 60_000 };
  return accessToken;
}

export interface FcmPayload {
  title: string;
  body: string;
  link?: string;
  type?: string;
  id?: string;
}

async function sendOne(
  accessToken: string,
  target: { token: string } | { topic: string },
  p: FcmPayload,
): Promise<'ok' | 'invalid' | 'error'> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${process.env.FCM_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          ...target,
          // Data-only: the Android app builds the notification itself (channel, tap -> deep link).
          data: {
            kind: 'user',
            title: p.title,
            body: p.body,
            link: p.link || '',
            type: p.type || 'system',
            nid: p.id || '',
          },
          android: { priority: 'HIGH', ttl: '86400s' },
        },
      }),
    },
  );
  if (res.ok) return 'ok';
  const txt = await res.text();
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt)) return 'invalid';
  console.error('[fcm] send failed', res.status, txt.slice(0, 300));
  return 'error';
}

/** Push to every registered device of a user. Removes tokens FCM says are dead. */
export async function pushFcmToUser(userId: string, p: FcmPayload): Promise<{ sent: number; devices: number }> {
  if (!isFcmConfigured()) return { sent: 0, devices: 0 };
  const { data: rows } = await supabaseServer.from('device_tokens').select('token').eq('user_id', userId);
  const tokens = (rows || []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return { sent: 0, devices: 0 };
  const at = await getAccessToken();
  let sent = 0;
  for (const token of tokens) {
    const r = await sendOne(at, { token }, p);
    if (r === 'ok') sent++;
    else if (r === 'invalid') await supabaseServer.from('device_tokens').delete().eq('token', token);
  }
  return { sent, devices: tokens.length };
}

/** Broadcast to every installed app (topic "announcements"). */
export async function pushFcmTopic(topic: string, p: FcmPayload): Promise<boolean> {
  if (!isFcmConfigured()) return false;
  const at = await getAccessToken();
  return (await sendOne(at, { topic }, p)) === 'ok';
}
