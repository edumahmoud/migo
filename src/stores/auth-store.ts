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

/** Create a fallback profile from auth metadata when API/DB fetch fails.
 *
 * ⚠️ SECURITY: This function ALWAYS assigns role='student' regardless of
 * what user_metadata.role says. The user_metadata object is CLIENT-MODIFIABLE
 * in Supabase — a malicious user could set their metadata role to 'admin'
 * and gain unauthorized access if we trusted it.
 *
 * The REAL role is always fetched from the database via /api/auth/me.
 * This fallback is only used when that API call fails (network error, etc.),
 * and in that case, the safest default is 'student' (least privilege).
 *
 * When the API recovers, the correct role will be fetched and this fallback
 * will be replaced.
 */
function createFallbackProfile(authUser: { id: string; email?: string; user_metadata?: Record<string, unknown>; created_at?: string; updated_at?: string }): UserProfile {
  const userName = (authUser.user_metadata?.full_name as string) || (authUser.user_metadata?.name as string) || authUser.email?.split('@')[0] || 'مستخدم';
  const avatarUrl = (authUser.user_metadata?.avatar_url as string) || null;
  // SECURITY: Always default to 'student' — NEVER trust user_metadata.role
  // user_metadata is client-modifiable and can be tampered with
  const safeDefaultRole: UserRole = 'student';

  return {
    id: authUser.id,
    email: authUser.email || '',
    name: userName,
    username: generateUsername(userName, authUser.id),
    role: safeDefaultRole,
    avatar_url: avatarUrl,
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
}

// Cleanup function for session validation interval
let sessionCheckCleanup: (() => void) | null = null;

// Auth state change subscription (must be unsubscribed to prevent memory leaks)
let authSubscription: { data: { subscription: { unsubscribe: () => void } } } | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  initialized: false,
  sessionKickedMessage: null,
  banInfo: null,
  
  setUser: (user) => set({ user, loading: false }),
  
  initialize: async () => {
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

      const { data: { session } } = await supabase.auth.getSession();
      
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
      if (event === 'SIGNED_IN' && session?.user) {
        // ─── Use server-side API to fetch profile (bypasses RLS) ───
        try {
          const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          });
          
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
      } else if (event === 'SIGNED_OUT') {
        // Clean up session validation interval
        if (sessionCheckCleanup) {
          sessionCheckCleanup();
          sessionCheckCleanup = null;
        }
        set({ user: null, loading: false, banInfo: null });
      }
    });
    })();

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Auth init timeout')), 10000);
    });
    try {
      await Promise.race([initPromise, timeoutPromise]);
    } catch (error) {
      set({ user: null, loading: false, initialized: true });
    }
  },
  
  signInWithEmail: async (email, password) => {
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
    }
  },
  
  signUpWithEmail: async (email, password, name) => {
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

    // Unsubscribe auth state listener to prevent memory leaks
    if (authSubscription) {
      authSubscription.data.subscription.unsubscribe();
      authSubscription = null;
    }
  },
}));

// Export helper for use in components
export { getDashboardForRole };
