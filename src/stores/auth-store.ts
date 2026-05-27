import { create } from 'zustand';
import type { UserProfile } from '@/lib/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { registerSession, validateSession, endSession, startSessionValidation } from '@/lib/session-tracker';

// --- Input Sanitization Helpers ---

/** Strip HTML tags and trim whitespace to prevent XSS */
function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

/** Basic email format validation */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/** Validate name: no HTML, reasonable length */
function isValidName(name: string): boolean {
  const sanitized = sanitizeInput(name);
  return sanitized.length > 0 && sanitized.length <= 100;
}

/** Auto-generate username from name (supports Arabic transliteration) */
function generateUsername(name: string, userId: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[أإآا]/g, 'a')
    .replace(/[ب]/g, 'b')
    .replace(/[ت]/g, 't')
    .replace(/[ث]/g, 'th')
    .replace(/[ج]/g, 'j')
    .replace(/[ح]/g, 'h')
    .replace(/[خ]/g, 'kh')
    .replace(/[د]/g, 'd')
    .replace(/[ذ]/g, 'dh')
    .replace(/[ر]/g, 'r')
    .replace(/[ز]/g, 'z')
    .replace(/[س]/g, 's')
    .replace(/[ش]/g, 'sh')
    .replace(/[ص]/g, 's')
    .replace(/[ض]/g, 'd')
    .replace(/[ط]/g, 't')
    .replace(/[ظ]/g, 'z')
    .replace(/[ع]/g, 'a')
    .replace(/[غ]/g, 'gh')
    .replace(/[ف]/g, 'f')
    .replace(/[ق]/g, 'q')
    .replace(/[ك]/g, 'k')
    .replace(/[ل]/g, 'l')
    .replace(/[م]/g, 'm')
    .replace(/[ن]/g, 'n')
    .replace(/[ه]/g, 'h')
    .replace(/[و]/g, 'w')
    .replace(/[ي]/g, 'y')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  const suffix = userId.substring(0, 6);
  return `${base || 'user'}_${suffix}`;
}

// --- Rate Limiting ---

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SIGN_IN_ATTEMPTS = 5;

interface RateLimitState {
  attempts: number;
  windowStart: number;
}

const signInRateLimit: RateLimitState = { attempts: 0, windowStart: Date.now() };

function checkRateLimit(): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  if (now - signInRateLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
    signInRateLimit.attempts = 0;
    signInRateLimit.windowStart = now;
  }
  if (signInRateLimit.attempts >= MAX_SIGN_IN_ATTEMPTS) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - signInRateLimit.windowStart);
    return { allowed: false, retryAfterMs };
  }
  signInRateLimit.attempts++;
  return { allowed: true, retryAfterMs: 0 };
}

// --- Safe Error Messages ---

/** Map Supabase error messages to user-friendly Arabic messages */
function getSafeErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const err = error as { message?: string; code?: string; error_code?: string; status?: number; msg?: string };
    const msg = (err.message || err.msg || '').toLowerCase();
    const code = err.code || err.error_code || '';

    if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
      return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    }
    if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
      return 'يرجى تأكيد بريدك الإلكتروني أولاً';
    }
    if (msg.includes('user already registered') || msg.includes('user_already_exists')) {
      return 'هذا البريد الإلكتروني مسجل بالفعل';
    }
    if (msg.includes('password') && msg.includes('weak')) {
      return 'كلمة المرور ضعيفة، يرجى اختيار كلمة مرور أقوى';
    }
    if (msg.includes('rate limit') || msg.includes('too many')) {
      return 'طلبات كثيرة جداً، يرجى المحاولة لاحقاً';
    }
    if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('networkerror')) {
      return 'خطأ في الاتصال بالشبكة';
    }
    // RLS policy violation - most common cause of registration errors
    if (msg.includes('row-level security') || msg.includes('rls') || code === '42501') {
      return 'خطأ في إنشاء الملف الشخصي. يرجى المحاولة مرة أخرى أو التواصل مع الدعم';
    }
    // Duplicate key error (trigger already created the profile)
    if (msg.includes('duplicate key') || msg.includes('unique constraint') || code === '23505') {
      return 'الحساب موجود بالفعل. يرجى تسجيل الدخول';
    }
    // Signup disabled or email provider disabled
    if (msg.includes('signup is disabled') || msg.includes('signups not allowed') || 
        msg.includes('email_provider_disabled') || msg.includes('email signups are disabled') ||
        code === 'email_provider_disabled') {
      return 'التسجيل بالبريد الإلكتروني غير مفعّل حالياً. يرجى التواصل مع المشرف أو تفعيل التسجيل من إعدادات Supabase';
    }
  }
  // Generic message - don't leak internal details
  return 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى';
}

// --- First User Check ---

/**
 * After registration, check if this user is the first on the platform.
 * If so, promote them to 'superadmin'.
 * This runs silently in the background after signup.
 */
async function checkAndPromoteFirstUser(userId: string): Promise<UserProfile | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    const res = await fetch('/api/auth/check-first-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId }),
    });
    const result = await res.json();
    if (result.success && result.promoted && result.user) {
      return result.user as UserProfile;
    }
    return null;
  } catch {
    return null;
  }
}

// --- Fallback Profile Helper ---

type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin';

/** Create a fallback profile from auth metadata when RLS blocks DB reads */
function createFallbackProfile(authUser: { id: string; email?: string; user_metadata?: Record<string, unknown>; created_at?: string; updated_at?: string }): UserProfile {
  const userName = (authUser.user_metadata?.full_name as string) || (authUser.user_metadata?.name as string) || authUser.email?.split('@')[0] || 'مستخدم';
  const avatarUrl = (authUser.user_metadata?.avatar_url as string) || null;
  // SECURITY: Never trust user_metadata.role — it's user-modifiable in Supabase.
  // A malicious user could set their metadata role to 'superadmin' and get
  // elevated privileges when the API is unreachable. Always default to 'student'.
  const userRole: UserRole = 'student';
  const userGender = (authUser.user_metadata?.gender as string) || null;
  const userTitleId = (authUser.user_metadata?.title_id as string) || null;

  return {
    id: authUser.id,
    email: authUser.email || '',
    name: userName,
    username: generateUsername(userName, authUser.id),
    role: userRole,
    avatar_url: avatarUrl,
    gender: userGender,
    title_id: userTitleId,
    teacher_code: undefined, // Never grant teacher_code from fallback
    created_at: authUser.created_at || new Date().toISOString(),
    updated_at: authUser.updated_at || new Date().toISOString(),
  };
}

// --- Role-based dashboard helper ---

function getDashboardForRole(role: string): string {
  if (role === 'superadmin' || role === 'admin') return 'admin-dashboard';
  if (role === 'teacher') return 'teacher-dashboard';
  return 'student-dashboard';
}

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  initialized: boolean;
  sessionKickedMessage: string | null;
  banInfo: { reason?: string; bannedAt?: string; banUntil?: string | null; isPermanent?: boolean } | null;
  passwordRecoveryMode: boolean;
  
  // Actions
  setUser: (user: UserProfile | null) => void;
  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  checkBanStatus: () => Promise<void>;
  cleanup: () => void;
  clearPasswordRecovery: () => void;
}

// Cleanup function for session validation interval
let sessionCheckCleanup: (() => void) | null = null;

// Auth state change subscription (must be unsubscribed to prevent memory leaks)
let authSubscription: { data: { subscription: { unsubscribe: () => void } } } | null = null;

// Flag to indicate that signInWithEmail is in progress.
// This prevents the onAuthStateChange handler from overwriting the user
// profile during login (race condition) and protects against SIGNED_OUT
// events that Supabase may fire when replacing a stale session.
let _loginInProgress = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  initialized: false,
  sessionKickedMessage: null,
  banInfo: null,
  passwordRecoveryMode: false,
  
  setUser: (user) => set({ user, loading: false }),
  
  clearPasswordRecovery: () => set({ passwordRecoveryMode: false }),
  
  initialize: async () => {
    // Prevent double initialization
    if (get().initialized) {
      console.log('[Auth] Already initialized, skipping');
      return;
    }

    const initPromise = (async () => {
    try {
      // If Supabase is not configured, skip initialization and show auth page
      if (!isSupabaseConfigured) {
        console.warn(
          '[Auth] Supabase is not configured. Missing environment variables: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY. The app will show a configuration error page.'
        );
        set({ user: null, loading: false, initialized: true });
        return;
      }

      // ─── CRITICAL MOBILE FIX: Retry getSession() for mobile PWA ───
      // On mobile PWA, after Android kills the WebView process and restores it,
      // the Supabase session in localStorage may not be fully hydrated yet.
      // getSession() can return null even though a valid session exists.
      // This causes the user to be logged out, which they perceive as "infinity loading"
      // or a stuck app.
      //
      // FIX: If getSession() returns null on the first try, retry up to 3 times
      // with a 1-second delay between each attempt. This gives localStorage time
      // to hydrate on mobile devices.
      let { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // ─── Session Recovery: Retry getSession() ───
        // On mobile PWA, after Android kills the WebView process and restores it,
        // the Supabase session in localStorage may not be fully hydrated yet.
        // On desktop, browser extensions or privacy settings can delay cookie/localStorage reads.
        // FIX: Retry getSession() with delays on ALL platforms (more retries on mobile).
        const isMobile = typeof navigator !== 'undefined' &&
          /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const maxRetries = isMobile ? 3 : 2;
        const retryDelay = isMobile ? 800 : 500;
        
        console.log(`[Auth] No session on first try, retrying up to ${maxRetries} times (${isMobile ? 'mobile' : 'desktop'})...`);
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          await new Promise(r => setTimeout(r, retryDelay));
          const retryResult = await supabase.auth.getSession();
          session = retryResult.data.session;
          if (session) {
            console.log(`[Auth] Session recovered on retry ${attempt}`);
            break;
          }
          console.log(`[Auth] Retry ${attempt}/${maxRetries}: still no session`);
        }
      }
      
      if (session?.user) {
        // ─── Use server-side API to fetch profile (bypasses RLS) ───
        // The /api/auth/me endpoint uses the service role key, so it's not affected
        // by RLS policies that might block client-side queries.
        const meController = new AbortController();
        const meTimeoutId = setTimeout(() => meController.abort(), 8000);
        try {
            const res = await fetch('/api/auth/me', {
              headers: { 'Authorization': `Bearer ${session.access_token}` },
              signal: meController.signal,
            });
            clearTimeout(meTimeoutId);
            
            if (res.ok) {
              const data = await res.json();
              const profile = data.profile as UserProfile | null;
              const banInfo = data.banInfo as { reason?: string; bannedAt?: string; banUntil?: string | null; isPermanent?: boolean } | null;
              
              if (profile) {
                // Check if user is banned
                if (banInfo) {
                  set({ 
                    user: profile, 
                    loading: false, 
                    initialized: true,
                    banInfo
                  });

                  if (sessionCheckCleanup) sessionCheckCleanup();
                  sessionCheckCleanup = startSessionValidation(profile.id, async () => {
                    await supabase.auth.signOut();
                    set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
                  });
                  return;
                }

                // Start periodic session validation
                if (sessionCheckCleanup) sessionCheckCleanup();
                sessionCheckCleanup = startSessionValidation(profile.id, async () => {
                  await supabase.auth.signOut();
                  set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر' });
                });

                set({ user: profile, loading: false, initialized: true, banInfo: null });
              } else {
                // Profile couldn't be created — use fallback from auth metadata
                const fallbackProfile = createFallbackProfile(session.user);
                if (sessionCheckCleanup) sessionCheckCleanup();
                sessionCheckCleanup = startSessionValidation(fallbackProfile.id, async () => {
                  await supabase.auth.signOut();
                  set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر' });
                });
                set({ user: fallbackProfile, loading: false, initialized: true, banInfo: null });
              }
            } else {
              // API call failed — use fallback from auth metadata
              const fallbackProfile = createFallbackProfile(session.user);
              set({ user: fallbackProfile, loading: false, initialized: true, banInfo: null });
            }
          } catch {
            // Network error / timeout — use fallback from auth metadata
            clearTimeout(meTimeoutId);
            const fallbackProfile = createFallbackProfile(session.user);
            set({ user: fallbackProfile, loading: false, initialized: true, banInfo: null });
          }
      } else {
        set({ user: null, loading: false, initialized: true, banInfo: null });
      }
    } catch {
      set({ user: null, loading: false, initialized: true, banInfo: null });
    }
    
    // Unsubscribe previous listener before creating a new one
    if (authSubscription) {
      authSubscription.data.subscription.unsubscribe();
      authSubscription = null;
    }

    // Listen for auth changes
    authSubscription = supabase.auth.onAuthStateChange(async (event, session) => {
      // Handle INITIAL_SESSION: This fires when the listener is first registered.
      // On page refresh, if getSession() returned null but the session exists in cookies,
      // the INITIAL_SESSION event provides the valid session. Without handling this,
      // the user gets redirected to the login page on refresh.
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        // ─── Password Recovery Detection (prevents race condition) ───
        // When the user clicks a password reset link, Supabase fires INITIAL_SESSION
        // or SIGNED_IN first, then PASSWORD_RECOVERY later. If we process the
        // SIGNED_IN normally, the routing useEffect redirects to the dashboard
        // before PASSWORD_RECOVERY has a chance to set passwordRecoveryMode.
        //
        // There are two flows to detect:
        // 1. Implicit flow: URL hash contains #type=recovery (legacy, deprecated)
        // 2. PKCE flow: URL contains ?code=xxx but NO type=recovery
        //    In PKCE flow, we must WAIT for the PASSWORD_RECOVERY event
        //    because we can't distinguish recovery from normal sign-in from the URL alone.

        // Also skip if passwordRecoveryMode is already set (PASSWORD_RECOVERY fired first)
        if (get().passwordRecoveryMode) {
          return;
        }

        // Check 1: Implicit flow — type=recovery in URL hash or query params
        const isRecoveryUrl = typeof window !== 'undefined' && (
          window.location.hash.includes('type=recovery') ||
          new URLSearchParams(window.location.search).get('type') === 'recovery'
        );
        if (isRecoveryUrl) {
          console.log('[Auth] Recovery URL detected (implicit flow) — setting passwordRecoveryMode');
          set({ passwordRecoveryMode: true, loading: false });
          // Clean the URL to prevent re-detection
          try {
            window.history.replaceState({}, '', window.location.pathname);
          } catch {}
          return; // Skip normal sign-in processing
        }

        // Check 2: PKCE flow — ?code=xxx in URL
        // When a PKCE code is present, this could be a password recovery link.
        // We can't tell from the URL alone, so we wait for PASSWORD_RECOVERY event.
        // The await yields to the event loop, allowing PASSWORD_RECOVERY to fire
        // and set passwordRecoveryMode before we continue.
        const hasCodeParam = typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).has('code');

        if (hasCodeParam) {
          console.log('[Auth] PKCE code detected — waiting up to 2s for PASSWORD_RECOVERY event...');
          await new Promise(resolve => setTimeout(resolve, 2000));

          if (get().passwordRecoveryMode) {
            console.log('[Auth] PASSWORD_RECOVERY detected after wait — skipping normal sign-in');
            // Clean the URL
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('code');
              url.searchParams.delete('type');
              url.searchParams.delete('token_hash');
              window.history.replaceState({}, '', url.pathname + url.search + url.hash);
            } catch {}
            return;
          }

          console.log('[Auth] No PASSWORD_RECOVERY after wait — proceeding with normal sign-in');
          // Clean the URL (code has been consumed)
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('code');
            url.searchParams.delete('type');
            url.searchParams.delete('token_hash');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
          } catch {}
        }

        // ─── Prevent race condition with signInWithEmail ───
        // If signInWithEmail is in progress, it will set the user itself.
        // We must NOT overwrite it here — especially with a fallback profile
        // that has role='student', which would override the correct profile.
        if (_loginInProgress && event === 'SIGNED_IN') {
          console.log('[Auth] SIGNED_IN skipped — signInWithEmail is in progress');
          return;
        }

        // If the user was already set (by signInWithEmail or initialize),
        // skip this update to avoid overwriting the correct profile with a fallback.
        // Only skip for SIGNED_IN (not INITIAL_SESSION which may be the only source on refresh).
        const currentUser = get().user;
        if (currentUser && currentUser.id === session.user.id && event === 'SIGNED_IN') {
          // User already set for this session — skip to avoid race condition
          console.log('[Auth] SIGNED_IN skipped — user already set');
          return;
        }

        // ─── Use server-side API to fetch profile (bypasses RLS) ───
        try {
          const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          });

          // Re-check: if signInWithEmail already set the user while we were fetching,
          // don't overwrite it (especially not with a fallback profile)
          const userAfterFetch = get().user;
          if (userAfterFetch && userAfterFetch.id === session.user.id && event === 'SIGNED_IN') {
            console.log('[Auth] SIGNED_IN: user was set while fetching profile — skipping update');
            return;
          }
          
          if (res.ok) {
            const data = await res.json();
            const profile = data.profile as UserProfile | null;
            const banInfo = data.banInfo as { reason?: string; bannedAt?: string; banUntil?: string | null; isPermanent?: boolean } | null;
            
            if (profile) {
              await registerSession(profile.id);
              if (sessionCheckCleanup) sessionCheckCleanup();
              sessionCheckCleanup = startSessionValidation(profile.id, async () => {
                await supabase.auth.signOut();
                set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
              });
              set({ user: profile, loading: false, banInfo: banInfo || null });
            } else {
              // Fallback from auth metadata
              const fallbackProfile = createFallbackProfile(session.user);
              await registerSession(fallbackProfile.id);
              if (sessionCheckCleanup) sessionCheckCleanup();
              sessionCheckCleanup = startSessionValidation(fallbackProfile.id, async () => {
                await supabase.auth.signOut();
                set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
              });
              set({ user: fallbackProfile, loading: false, banInfo: null });
            }
          } else {
            // API failed - use fallback
            const fallbackProfile = createFallbackProfile(session.user);
            set({ user: fallbackProfile, loading: false, banInfo: null });
          }
        } catch {
          // Network error - use fallback
          const fallbackProfile = createFallbackProfile(session.user);
          set({ user: fallbackProfile, loading: false, banInfo: null });
        }
      } else if (event === 'PASSWORD_RECOVERY') {
        // User clicked the password reset link from the email.
        // Set passwordRecoveryMode so the UI shows the UpdatePasswordForm
        // instead of the dashboard. We still need the session (user) to call
        // updateUser({ password }), so we keep the session active but prevent
        // the routing useEffect from redirecting to the dashboard.
        console.log('[Auth] PASSWORD_RECOVERY event detected');
        set({ passwordRecoveryMode: true, loading: false });
        // Clean the URL to prevent re-detection
        try {
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', window.location.pathname);
          }
        } catch {}
      } else if (event === 'SIGNED_OUT') {
        // ─── Guard: Don't null out user during login ───
        // Supabase may fire SIGNED_OUT when replacing an old session during
        // signInWithPassword(). If login is in progress, the SIGNED_IN event
        // will follow immediately and set the correct user. Setting user=null
        // here would cause a brief redirect to the auth page.
        if (_loginInProgress) {
          console.log('[Auth] SIGNED_OUT skipped — signInWithEmail is in progress');
          return;
        }

        // Clean up session validation interval
        if (sessionCheckCleanup) {
          sessionCheckCleanup();
          sessionCheckCleanup = null;
        }
        // Clean up notification store — stop polling + unsubscribe realtime
        // Use dynamic import instead of require() for ESM/Next.js App Router compatibility
        try {
          import('@/stores/notification-store').then(({ useNotificationStore }) => {
            useNotificationStore.getState().cleanup();
          }).catch(() => { /* non-critical */ });
        } catch { /* non-critical */ }
        set({ user: null, loading: false, banInfo: null, passwordRecoveryMode: false });
      }
    });
    })();

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Auth init timeout')), 15000);
    });
    try {
      await Promise.race([initPromise, timeoutPromise]);
    } catch (error) {
      // FIX: Don't force logout on timeout — if we have a persisted session,
      // the user was logged in before. Give the auth listener more time to recover.
      // Only set user to null if we have NO indication of a previous session.
      const currentState = get();
      if (!currentState.user) {
        // Check if there's a persisted app store with a non-auth page
        try {
          const raw = localStorage.getItem('attendo-app-store');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.state?.currentPage && parsed.state.currentPage !== 'auth') {
              // User was logged in before — don't force logout, just mark as initialized
              // The onAuthStateChange listener will eventually provide the user
              console.warn('[Auth] Init timed out but persisted session exists — waiting for auth listener');
              set({ loading: false, initialized: true });
              return;
            }
          }
        } catch {}
      }
      set({ user: null, loading: false, initialized: true });
    }
  },
  
  signInWithEmail: async (email, password) => {
    // Set login-in-progress flag to prevent onAuthStateChange from
    // interfering (overwriting user with fallback, or processing SIGNED_OUT)
    _loginInProgress = true;
    try {
      // Rate limiting check
      const { allowed, retryAfterMs } = checkRateLimit();
      if (!allowed) {
        const minutesLeft = Math.ceil(retryAfterMs / 60000);
        return { error: `طلبات كثيرة جداً. يرجى المحاولة بعد ${minutesLeft} دقيقة` };
      }

      // Input validation & sanitization
      const sanitizedEmail = sanitizeInput(email).toLowerCase();
      if (!isValidEmail(sanitizedEmail)) {
        return { error: 'صيغة البريد الإلكتروني غير صالحة' };
      }
      if (!password || password.length < 1) {
        return { error: 'يرجى إدخال كلمة المرور' };
      }

      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email: sanitizedEmail, password });
      if (error) return { error: getSafeErrorMessage(error) };
      
      const authUser = signInData?.user;
      if (!authUser) return { error: 'فشل في الحصول على بيانات المستخدم' };
      
      // ─── Use server-side API to fetch profile (bypasses RLS) ───
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${signInData.session?.access_token || ''}` },
        });
        
        if (res.ok) {
          const data = await res.json();
          const profile = data.profile as UserProfile | null;
          const banInfo = data.banInfo as { reason?: string; bannedAt?: string; banUntil?: string | null; isPermanent?: boolean } | null;
          
          if (profile) {
            await registerSession(authUser.id);
            if (sessionCheckCleanup) sessionCheckCleanup();
            sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
              await supabase.auth.signOut();
              set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
            });
            signInRateLimit.attempts = 0;
            set({ user: profile, loading: false, banInfo: banInfo || null });
            return { error: null };
          }
        }
      } catch {
        // API call failed, fall through to fallback
      }
      
      // Fallback: create profile from auth metadata
      const fallbackProfile = createFallbackProfile(authUser);
      await registerSession(authUser.id);
      if (sessionCheckCleanup) sessionCheckCleanup();
      sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
        await supabase.auth.signOut();
        set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
      });
      signInRateLimit.attempts = 0;
      set({ user: fallbackProfile, loading: false, banInfo: null });
      return { error: null };
    } catch {
      return { error: 'حدث خطأ غير متوقع' };
    } finally {
      // Clear the flag after a short delay to ensure SIGNED_IN has been processed
      // by the onAuthStateChange listener (or skipped by our guard)
      setTimeout(() => { _loginInProgress = false; }, 500);
    }
  },
  
  signUpWithEmail: async (email, password, name) => {
    _loginInProgress = true;
    try {
      // Input validation & sanitization
      const sanitizedEmail = sanitizeInput(email).toLowerCase();
      const sanitizedName = sanitizeInput(name);

      if (!isValidEmail(sanitizedEmail)) {
        return { error: 'صيغة البريد الإلكتروني غير صالحة' };
      }
      if (!isValidName(sanitizedName)) {
        return { error: 'يرجى إدخال اسم صالح (1-100 حرف)' };
      }
      if (!password || password.length < 6) {
        return { error: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل' };
      }

      // All new users register as 'student' by default
      const defaultRole = 'student';

      const { data: signUpData, error: authError } = await supabase.auth.signUp({ 
        email: sanitizedEmail, 
        password,
        options: {
          data: { name: sanitizedName, role: defaultRole }
        }
      });
      
      if (authError) return { error: getSafeErrorMessage(authError) };

      // Check if email confirmation is required
      // If signUpData.user exists but session is null, user needs to confirm email
      const needsConfirmation = !!signUpData.user && !signUpData.session;
      
      if (needsConfirmation) {
        // The auth trigger (if set up) will auto-create the profile.
        // If no trigger, the profile will be created on first login.
        return { error: null, needsConfirmation: true };
      }

      // Auto-confirmed: session is available immediately
      const authUser = signUpData.user;
      if (!authUser) return { error: 'فشل في إنشاء الحساب' };
      
      // Try to fetch existing profile first (may have been created by auth trigger)
      let { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      
      if (profile) {
        // Profile already exists (created by auth trigger)
        // Check if this is the first user (promote to superadmin)
        const promotedProfile = await checkAndPromoteFirstUser(authUser.id);
        const finalProfile = promotedProfile || profile;
        set({ user: (finalProfile || profile) as UserProfile, loading: false });
        return { error: null, needsConfirmation: false };
      }

      // Profile doesn't exist yet - create it manually
      // This handles the case where the auth trigger hasn't been set up
      const { error: profileError } = await supabase
        .from('users')
        .insert({
          id: authUser.id,
          email: sanitizedEmail,
          name: sanitizedName,
          username: generateUsername(sanitizedName, authUser.id),
          role: defaultRole,
        });
      
      if (profileError) {
        // If duplicate key error, the profile was created by the trigger
        // after our select but before our insert - just fetch it
        const err = profileError as { code?: string; message?: string };
        if (err.code === '23505' || (err.message || '').includes('duplicate key')) {
          const { data: retryProfile } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();
          
          if (retryProfile) {
            // Check if first user
            const promotedProfile = await checkAndPromoteFirstUser(authUser.id);
            const finalProfile = promotedProfile || retryProfile;
            set({ user: (finalProfile || retryProfile) as UserProfile, loading: false });
            return { error: null, needsConfirmation: false };
          }
        }
        // Profile operations failed but auth signup succeeded - create fallback profile from auth data
        // The real profile exists in DB (created by trigger) but RLS may prevent client from reading it yet
        const fallbackProfile: UserProfile = {
          id: authUser.id,
          email: sanitizedEmail,
          name: sanitizedName,
          username: generateUsername(sanitizedName, authUser.id),
          role: defaultRole as UserRole,
          avatar_url: null,
          created_at: authUser.created_at || new Date().toISOString(),
          updated_at: authUser.updated_at || new Date().toISOString(),
        };
        const promotedProfile = await checkAndPromoteFirstUser(authUser.id);
        const finalProfile = promotedProfile || fallbackProfile;
        set({ user: (finalProfile || fallbackProfile) as UserProfile, loading: false });
        return { error: null, needsConfirmation: false };
      }
      
      // Fetch the created profile (with teacher_code if teacher)
      const { data: newProfile } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      
      if (newProfile) {
        // Check if this is the first user (promote to superadmin)
        const promotedProfile = await checkAndPromoteFirstUser(authUser.id);
        const finalProfile = promotedProfile || newProfile;
        set({ user: (finalProfile || newProfile) as UserProfile, loading: false });
      }
      
      return { error: null, needsConfirmation: false };
    } catch {
      return { error: 'حدث خطأ غير متوقع أثناء التسجيل' };
    } finally {
      setTimeout(() => { _loginInProgress = false; }, 500);
    }
  },
  
  signInWithGoogle: async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      
      if (error) return { error: getSafeErrorMessage(error) };
      return { error: null };
    } catch {
      return { error: 'حدث خطأ غير متوقع أثناء تسجيل الدخول بجوجل' };
    }
  },
  
  signOut: async () => {
    const currentUser = get().user;

    // If the user is a student, remove their attendance records from active sessions
    // so they are marked as absent if they log out during attendance
    if (currentUser && currentUser.role === 'student') {
      try {
        await fetch('/api/attendance/mark-absent-on-logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: currentUser.id }),
        });
      } catch {
        // Non-critical: don't block sign-out if this fails
      }
    }

    // Immediately clear user state for instant UI feedback
    set({ user: null, loading: false, sessionKickedMessage: null, banInfo: null });

    // Clean up subscriptions and intervals
    get().cleanup();

    // Clean up notification store — unsubscribe realtime + stop polling timer
    // This prevents ghost subscriptions and timers from running after sign-out
    try {
      const { useNotificationStore } = await import('@/stores/notification-store');
      useNotificationStore.getState().cleanup();
    } catch {
      // Non-critical: notification store cleanup failure shouldn't block sign-out
    }

    // FIX: Clean up institution store — reset to prevent stale data
    // from previous user persisting after switching accounts
    try {
      const { useInstitutionStore } = await import('@/stores/institution-store');
      useInstitutionStore.getState().reset();
    } catch {
      // Non-critical: institution store cleanup failure shouldn't block sign-out
    }

    // Clean up summaries cache from localStorage to prevent showing
    // another user's cached summaries after switching accounts
    if (currentUser?.id) {
      try {
        // Remove summaries cache for the current user
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`summaries_${currentUser.id}`)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
      } catch {
        // Non-critical: localStorage might be unavailable
      }
    }

    // End session tracking in the background (don't block UI)
    endSession().catch(() => {});

    // Sign out from Supabase
    try {
      await supabase.auth.signOut();
    } catch {
      // State is already cleared, ignore signOut errors
    }
  },
  
  updateProfile: async (updates) => {
    const { user } = get();
    if (!user) return { error: 'لم يتم تسجيل الدخول' };
    
    // Sanitize text fields in updates
    const sanitizedUpdates: Partial<UserProfile> = { ...updates };

    // Guard: prevent institution logo URLs from being stored as user avatar_url
    if (sanitizedUpdates.avatar_url && (
      sanitizedUpdates.avatar_url.includes('/institution/logos/') ||
      sanitizedUpdates.avatar_url.includes('/institution%2Flogos%2F')
    )) {
      delete sanitizedUpdates.avatar_url;
    }

    if (sanitizedUpdates.name) {
      sanitizedUpdates.name = sanitizeInput(sanitizedUpdates.name);
      if (!isValidName(sanitizedUpdates.name)) {
        return { error: 'يرجى إدخال اسم صالح' };
      }
    }
    if (sanitizedUpdates.email) {
      sanitizedUpdates.email = sanitizeInput(sanitizedUpdates.email).toLowerCase();
      if (!isValidEmail(sanitizedUpdates.email)) {
        return { error: 'صيغة البريد الإلكتروني غير صالحة' };
      }
    }

    try {
      const { error } = await supabase
        .from('users')
        .update(sanitizedUpdates)
        .eq('id', user.id);
      
      if (error) return { error: getSafeErrorMessage(error) };
      
      set({ user: { ...user, ...sanitizedUpdates } });
      return { error: null };
    } catch {
      return { error: 'حدث خطأ غير متوقع' };
    }
  },
  
  refreshProfile: async () => {
    const { user } = get();
    if (!user) return;
    
    try {
      // Use server-side API first (bypasses RLS, more reliable)
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      if (token) {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.profile) {
            set({ user: data.profile as UserProfile });
            return;
          }
        }
      }

      // Fallback: try client-side Supabase
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        set({ user: profile as UserProfile });
        return;
      }

      // Last fallback: use the profile/[userId] API
      const res2 = await fetch(`/api/profile/${user.id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res2.ok) {
        const data = await res2.json();
        if (data.profile) {
          set({ user: { ...user, ...data.profile } as UserProfile });
        }
      }
    } catch {
      // Silently fail — keep existing user data
    }
  },
  
  checkBanStatus: async () => {
    const { user } = get();
    if (!user) return;
    
    try {
      const res = await fetch(`/api/check-ban?email=${encodeURIComponent(user.email)}`);
      const data = await res.json();
      if (data.success && data.isBanned) {
        set({ 
          banInfo: {
            reason: data.ban?.reason,
            bannedAt: data.ban?.bannedAt,
            banUntil: data.ban?.banUntil,
            isPermanent: data.ban?.isPermanent,
          }
        });
      } else {
        set({ banInfo: null });
      }
    } catch {
      // Silently fail - keep current banInfo state
    }
  },
  
  cleanup: () => {
    // Clean up session validation interval
    if (sessionCheckCleanup) {
      sessionCheckCleanup();
      sessionCheckCleanup = null;
    }

    // NOTE: We intentionally do NOT unsubscribe the auth listener here.
    // Unsubscribing breaks the re-login flow: after sign-out, the listener
    // is gone, so when the user signs in again, the SIGNED_IN event is not
    // detected, and the profile isn't fetched via onAuthStateChange.
    // The auth listener should stay active for the lifetime of the app.

    // Reset user state but keep initialized=true and auth listener active.
    // This is critical: setting initialized=false would prevent the routing
    // useEffect from redirecting to the dashboard after re-login, because
    // initialize() is only called once on mount.
    set({ loading: false, user: null, banInfo: null, sessionKickedMessage: null });
  },
}));

// Export helper for use in components
export { getDashboardForRole };
