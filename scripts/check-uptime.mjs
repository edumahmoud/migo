// Fixed production destination, no secrets or external redirects.
const url = 'https://lms-attendo.vercel.app/api/health';
let healthy = false;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (response.status === 200 && body.status === 'ok' && body.service === 'attendo') { healthy = true; break; }
  } catch { /* Retry transient network errors without printing response contents. */ }
  if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 10000));
}
if (!healthy) { console.error('Production health check failed after three attempts. Inspect Vercel and Supabase status.'); process.exitCode = 1; }
else console.log('Production health check passed.');
