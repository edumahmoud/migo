// Fingerprint login for the Android app. The phone keeps a random device secret behind the fingerprint
// (Android Keystore, see BioBridge.java); the server only stores its hash and trades it for a one-time login token.
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface Bridge {
  isAvailable(): string;
  hasLogin(): boolean;
  enable(secret: string, id: string): void;
  unlock(id: string): void;
  authenticate(title: string, id: string): void;
  clear(): void;
}
interface BioResult { ok: boolean; secret?: string; error?: string }

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { AttendoBio?: Bridge }).AttendoBio) ?? null;
}

/** True only inside the app, on a phone with an enrolled fingerprint. */
export function bioSupported(): boolean {
  try { return bridge()?.isAvailable() === 'yes'; } catch { return false; }
}
export function bioHasLogin(): boolean {
  try { return !!bridge()?.hasLogin(); } catch { return false; }
}

function call(start: (b: Bridge, id: string) => void): Promise<BioResult> {
  const b = bridge();
  if (!b) return Promise.resolve({ ok: false, error: 'none' });
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<BioResult & { id: string }>).detail;
      if (!d || d.id !== id) return;
      window.removeEventListener('attendo-bio', h);
      resolve(d);
    };
    window.addEventListener('attendo-bio', h);
    try { start(b, id); } catch { window.removeEventListener('attendo-bio', h); resolve({ ok: false, error: 'fail' }); }
  });
}

/** Signed-in user turns fingerprint login on for this phone. */
export async function bioEnable(): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'سجّل الدخول أولاً' };
  const res = await fetch('/api/auth/bio/enroll', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.secret) return { ok: false, error: j.error || 'تعذر تفعيل البصمة' };
  const r = await call((b, id) => b.enable(j.secret, id));
  if (!r.ok) {
    await fetch('/api/auth/bio/revoke', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    return { ok: false, error: r.error === 'cancel' ? undefined : 'تعذر تفعيل البصمة' };
  }
  return { ok: true };
}

/** Asks for the fingerprint, then signs in. error is null when the user simply cancelled. */
export async function bioLogin(
  signIn: (email: string, password: string, opts?: { tokenHash?: string }) => Promise<{ error: string | null }>,
): Promise<{ ok: boolean; error: string | null }> {
  const r = await call((b, id) => b.unlock(id));
  if (!r.ok || !r.secret) {
    if (r.error === 'cancel') return { ok: false, error: null };
    if (r.error === 'invalidated') return { ok: false, error: 'البصمة اتغيرت. سجّل دخول بالباسورد وفعّل البصمة من جديد' };
    return { ok: false, error: 'فشل التحقق بالبصمة' };
  }
  const res = await fetch('/api/auth/bio/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: r.secret }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.tokenHash || !j.email) {
    if (res.status === 401) bridge()?.clear();
    return { ok: false, error: 'البصمة لم تعد صالحة. سجّل دخول بالباسورد وفعّلها من جديد' };
  }
  const out = await signIn(j.email, '', { tokenHash: j.tokenHash });
  return out.error ? { ok: false, error: out.error } : { ok: true, error: null };
}

/** After a password login inside the app: offer to turn fingerprint login on. */
export function bioOffer() {
  if (!bioSupported() || bioHasLogin()) return;
  toast('تفعّل الدخول بالبصمة؟', {
    duration: 20000,
    action: {
      label: 'تفعيل',
      onClick: () => {
        void bioEnable().then((r) => {
          if (r.ok) toast.success('تم تفعيل الدخول بالبصمة');
          else if (r.error) toast.error(r.error);
        });
      },
    },
  });
}
