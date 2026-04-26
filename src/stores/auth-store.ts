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
}

// Cleanup function for session validation interval
let sessionCheckCleanup: (() => void) | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  initialized: false,
  sessionKickedMessage: null,
  banInfo: null,
  
  setUser: (user) => set({ user, loading: false }),
  
  initialize: async () => {
    try {
      // If Supabase is not configured, skip initialization and show auth page
      if (!isSupabaseConfigured) {
        set({ user: null, loading: false, initialized: true });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        let { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();
        
        // If profile doesn't exist, try to create it from auth metadata
        if (!profile) {
          const userName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'مستخدم';
          const avatarUrl = session.user.user_metadata?.avatar_url || null;
          // Default role is 'student' for all new users
          const userRole = session.user.user_metadata?.role || 'student';
          
          const { error: insertError } = await supabase.from('users').insert({
            id: session.user.id,
            email: session.user.email || '',
            name: userName,
            username: generateUsername(userName, session.user.id),
            role: userRole,
            avatar_url: avatarUrl,
          });
          
          if (insertError) {
            // Handle duplicate key (race condition with auth trigger)
            const err = insertError as { code?: string; message?: string };
            if (err.code === '23505' || (err.message || '').includes('duplicate key')) {
              const { data: retryProfile } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();
              profile = retryProfile;
            }
          } else {
            // Fetch the newly created profile (with teacher_code if teacher)
            const { data: newProfile } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();
            
            profile = newProfile;

            // Check if this is the first user (promote to superadmin)
            if (profile) {
              const promotedProfile = await checkAndPromoteFirstUser(session.user.id);
              if (promotedProfile) {
                profile = promotedProfile;
              }
            }
          }
        }
        
        if (profile) {
          // Check if user's email is banned (check for active ban)
          // Handle both old schema (no is_active column) and new schema
          const { data: bannedRecord } = await supabase
            .from('banned_users')
            .select('id, reason, banned_at, ban_until, is_active')
            .eq('email', profile.email)
            .maybeSingle();

          if (bannedRecord) {
            // Old schema: is_active doesn't exist (undefined), treat as active
            // New schema: check is_active
            const isActive = bannedRecord.is_active === undefined || bannedRecord.is_active === true;
            
            // Check if ban has expired
            const isExpired = bannedRecord.ban_until && new Date(bannedRecord.ban_until) <= new Date();
            
            if (isActive && !isExpired) {
              // User has an active ban - let them log in but set ban flag
              set({ 
                user: profile as UserProfile, 
                loading: false, 
                initialized: true,
                banInfo: {
                  reason: bannedRecord.reason,
                  bannedAt: bannedRecord.banned_at,
                  banUntil: bannedRecord.ban_until,
                  isPermanent: !bannedRecord.ban_until,
                }
              });

              // Start session validation even for banned users
              if (sessionCheckCleanup) sessionCheckCleanup();
              sessionCheckCleanup = startSessionValidation(profile.id, async () => {
                await supabase.auth.signOut();
                set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
              });
              return;
            }
            // Ban expired - user can proceed normally
          }

          // Validate session (check if another device took over)
          const isValid = await validateSession(profile.id);
          if (!isValid) {
            // Another session took over — sign out
            await supabase.auth.signOut();
            set({ user: null, loading: false, initialized: true, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر' });
            return;
          }

          // Start periodic session validation
          // Clean up any previous interval
          if (sessionCheckCleanup) sessionCheckCleanup();
          sessionCheckCleanup = startSessionValidation(profile.id, async () => {
            // Session invalidated by another login
            await supabase.auth.signOut();
            set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر' });
          });

          set({ user: profile as UserProfile, loading: false, initialized: true, banInfo: null });
        } else {
          set({ loading: false, initialized: true });
        }
      } else {
        set({ user: null, loading: false, initialized: true, banInfo: null });
      }
    } catch {
      set({ user: null, loading: false, initialized: true, banInfo: null });
    }
    
    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        // Check if user's email is banned (check for active ban)
        // Handle both old schema (no is_active column) and new schema
        const { data: bannedRecord } = await supabase
          .from('banned_users')
          .select('id, reason, banned_at, ban_until, is_active')
          .eq('email', session.user.email || '')
          .maybeSingle();

        if (bannedRecord) {
          // Old schema: is_active doesn't exist (undefined), treat as active
          // New schema: check is_active
          const isActive = bannedRecord.is_active === undefined || bannedRecord.is_active === true;

          // Check if ban has expired
          const isExpired = bannedRecord.ban_until && new Date(bannedRecord.ban_until) <= new Date();

          if (isActive && !isExpired) {
            // User has an active ban - let them log in but set ban flag
            let { data: profile } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();

            if (profile) {
              if (event === 'SIGNED_IN') {
                await registerSession(profile.id);
                if (sessionCheckCleanup) sessionCheckCleanup();
                sessionCheckCleanup = startSessionValidation(profile.id, async () => {
                  await supabase.auth.signOut();
                  set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
                });
              }
              set({ 
                user: profile as UserProfile, 
                loading: false, 
                banInfo: {
                  reason: bannedRecord.reason,
                  bannedAt: bannedRecord.banned_at,
                  banUntil: bannedRecord.ban_until,
                  isPermanent: !bannedRecord.ban_until,
                }
              });
              return;
            }
          }
          // Ban expired - user can proceed normally
        }

        let { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();
        
        // If profile doesn't exist, try to create it from auth metadata
        if (!profile) {
          const userName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'مستخدم';
          const avatarUrl = session.user.user_metadata?.avatar_url || null;
          const userRole = session.user.user_metadata?.role || 'student';
          
          const { error: insertError } = await supabase.from('users').insert({
            id: session.user.id,
            email: session.user.email || '',
            name: userName,
            username: generateUsername(userName, session.user.id),
            role: userRole,
            avatar_url: avatarUrl,
          });
          
          if (insertError) {
            const err = insertError as { code?: string; message?: string };
            if (err.code === '23505' || (err.message || '').includes('duplicate key')) {
              const { data: retryProfile } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();
              profile = retryProfile;
            }
          } else {
            const { data: newProfile } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();
            profile = newProfile;

            // Check if this is the first user (promote to superadmin)
            if (profile) {
              const promotedProfile = await checkAndPromoteFirstUser(session.user.id);
              if (promotedProfile) {
                profile = promotedProfile;
              }
            }
          }
        }
        
        if (profile) {
          // Register session for Google OAuth sign-ins
          if (event === 'SIGNED_IN') {
            await registerSession(profile.id);

            // Start periodic session validation
            if (sessionCheckCleanup) sessionCheckCleanup();
            sessionCheckCleanup = startSessionValidation(profile.id, async () => {
              await supabase.auth.signOut();
              set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر' });
            });
          }
          set({ user: profile as UserProfile, loading: false, banInfo: null });
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
      
      let { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      
      if (profile) {
        // Check if user's email is banned (check for active ban)
        // Handle both old schema (no is_active column) and new schema
        const { data: bannedRecord } = await supabase
          .from('banned_users')
          .select('id, reason, banned_at, ban_until, is_active')
          .eq('email', profile.email)
          .maybeSingle();

        if (bannedRecord) {
          // Old schema: is_active doesn't exist (undefined), treat as active
          // New schema: check is_active
          const isActive = bannedRecord.is_active === undefined || bannedRecord.is_active === true;

          // Check if ban has expired
          const isExpired = bannedRecord.ban_until && new Date(bannedRecord.ban_until) <= new Date();

          if (isActive && !isExpired) {
            // User has an active ban - let them in but with restricted access
            await registerSession(authUser.id);
            if (sessionCheckCleanup) sessionCheckCleanup();
            sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
              await supabase.auth.signOut();
              set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
            });
            signInRateLimit.attempts = 0;
            set({ 
              user: profile as UserProfile, 
              loading: false,
              banInfo: {
                reason: bannedRecord.reason,
                bannedAt: bannedRecord.banned_at,
                banUntil: bannedRecord.ban_until,
                isPermanent: !bannedRecord.ban_until,
              }
            });
            return { error: null };
          }
          // Ban expired - user can proceed normally
        }

        // Register session on successful sign-in
        await registerSession(authUser.id);

        // Start periodic session validation
        if (sessionCheckCleanup) sessionCheckCleanup();
        sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
          await supabase.auth.signOut();
          set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر' });
        });

        // Reset rate limit on successful login
        signInRateLimit.attempts = 0;
        set({ user: profile as UserProfile, loading: false, banInfo: null });
        return { error: null };
      }
      
      // Profile doesn't exist yet - try to create it
      // This handles users who signed up but profile wasn't created (e.g. email confirmation flow)
      const userName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'مستخدم';
      const userRole = authUser.user_metadata?.role || 'student';
      
      const { error: createError } = await supabase
        .from('users')
        .insert({
          id: authUser.id,
          email: authUser.email || sanitizedEmail,
          name: userName,
          username: generateUsername(userName, authUser.id),
          role: userRole,
        });
      
      if (createError) {
        // If duplicate key, the profile was just created (race condition) - fetch it
        const err = createError as { code?: string; message?: string };
        if (err.code === '23505' || (err.message || '').includes('duplicate key')) {
          const { data: retryProfile } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();
          
          if (retryProfile) {
            await registerSession(authUser.id);
            if (sessionCheckCleanup) sessionCheckCleanup();
            sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
              await supabase.auth.signOut();
              set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر' });
            });
            signInRateLimit.attempts = 0;
            set({ user: retryProfile as UserProfile, loading: false, banInfo: null });
            return { error: null };
          }
        }
        // Profile exists in DB (created by trigger) but RLS prevents client from reading it
        // Create fallback profile from auth data so user can proceed
        const fallbackProfile: UserProfile = {
          id: authUser.id,
          email: authUser.email || sanitizedEmail,
          name: userName,
          username: generateUsername(userName, authUser.id),
          role: (userRole === 'teacher' || userRole === 'admin' || userRole === 'superadmin' ? userRole : 'student') as UserRole,
          avatar_url: authUser.user_metadata?.avatar_url || null,
          created_at: authUser.created_at || new Date().toISOString(),
          updated_at: authUser.updated_at || new Date().toISOString(),
        };
        await registerSession(authUser.id);
        if (sessionCheckCleanup) sessionCheckCleanup();
        sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
          await supabase.auth.signOut();
          set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
        });
        signInRateLimit.attempts = 0;
        set({ user: fallbackProfile, loading: false, banInfo: null });
        return { error: null };
      }
      
      // Fetch the newly created profile
      const { data: newProfile } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      
      if (newProfile) {
        // Register session on successful sign-in (newly created profile)
        await registerSession(authUser.id);

        // Start periodic session validation
        if (sessionCheckCleanup) sessionCheckCleanup();
        sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
          await supabase.auth.signOut();
          set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
        });

        // Check if this is the first user (promote to superadmin)
        const promotedProfile = await checkAndPromoteFirstUser(authUser.id);
        const finalProfile = promotedProfile || newProfile;

        signInRateLimit.attempts = 0;
        set({ user: (finalProfile || newProfile) as UserProfile, loading: false, banInfo: null });
        return { error: null };
      }
      
      // Profile was inserted but can't be fetched (RLS) - use fallback from auth data
      const fallbackProfile2: UserProfile = {
        id: authUser.id,
        email: authUser.email || sanitizedEmail,
        name: userName,
        username: generateUsername(userName, authUser.id),
        role: (userRole === 'teacher' || userRole === 'admin' || userRole === 'superadmin' ? userRole : 'student') as UserRole,
        avatar_url: authUser.user_metadata?.avatar_url || null,
        created_at: authUser.created_at || new Date().toISOString(),
        updated_at: authUser.updated_at || new Date().toISOString(),
      };
      await registerSession(authUser.id);
      if (sessionCheckCleanup) sessionCheckCleanup();
      sessionCheckCleanup = startSessionValidation(authUser.id, async () => {
        await supabase.auth.signOut();
        set({ user: null, loading: false, sessionKickedMessage: 'تم تسجيل دخولك من جهاز آخر', banInfo: null });
      });
      signInRateLimit.attempts = 0;
      set({ user: fallbackProfile2, loading: false, banInfo: null });
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

    // Clean up session validation interval
    if (sessionCheckCleanup) {
      sessionCheckCleanup();
      sessionCheckCleanup = null;
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
      // Try client-side Supabase first (faster, works if RLS allows)
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        set({ user: profile as UserProfile });
        return;
      }

      // Fallback: use server-side API if client-side fetch fails
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch(`/api/profile/${user.id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          // Merge with existing user data to preserve all fields
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
}));

// Export helper for use in components
export { getDashboardForRole };
