'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Plus,
  X,
  Loader2,
  Hash,
  Copy,
  Check,
  Sparkles,
  Calendar,
  User,
  UserPlus,
  Clock,
  XCircle,
  LogOut,
  UserCog,
  Shield,
  Filter,
  GraduationCap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import { useAppStore } from '@/stores/app-store';
import type { UserProfile, Subject } from '@/lib/types';
import { formatNameWithTitle } from '@/components/shared/user-avatar';

// -------------------------------------------------------
// Auth helpers
// -------------------------------------------------------

/** Check if a Supabase error is likely caused by an expired/invalid auth session (RLS failure) */
function isAuthError(error: { code?: string; message?: string; details?: string }): boolean {
  const msg = (error.message || '').toLowerCase();
  const code = error.code || '';
  return (
    code === '42501' ||
    msg.includes('row-level security') ||
    msg.includes('policy') ||
    msg.includes('jwt') ||
    msg.includes('token') ||
    msg.includes('unauthorized')
  );
}

/** Try to refresh the Supabase session. Returns true if session was refreshed successfully. */
async function tryRefreshSession(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.refreshSession();
    return !error;
  } catch {
    return false;
  }
}

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

const SUBJECT_COLORS = [
  '#0369A1', '#14b8a6', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

// -------------------------------------------------------
// Module-level cache for subjects (reduces refetch on tab switches)
// -------------------------------------------------------

const subjectsCache = new Map<string, { data: Subject[]; teacherNames: Record<string, string>; enrollmentStatuses: Record<string, string>; timestamp: number }>();
const SUBJECTS_CACHE_TTL = 30000; // 30 seconds

// -------------------------------------------------------
// Filter options
// -------------------------------------------------------

// Database-matching values (Arabic) — used as filter/select values to match DB records
const LEVEL_VALUES = ['الفرقة الأولى', 'الفرقة الثانية', 'الفرقة الثالثة', 'الفرقة الرابعة', 'الفرقة الخامسة'] as const;
const LEVEL_KEYS = ['first', 'second', 'third', 'fourth', 'fifth'] as const;

const SUB_LEVEL_VALUES = ['المستوى الأول', 'المستوى الثاني'] as const;
const SUB_LEVEL_KEYS = ['first', 'second'] as const;

/** Generate a 6-character alphanumeric join code (uppercase + digits) */
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/O/0/1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------

interface SubjectsSectionProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  },
};

const modalOverlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const modalContentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.15 },
  },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------

export default function SubjectsSection({ profile, role }: SubjectsSectionProps) {
  const { t, direction, locale } = useTranslations();

  // Filter options for level/sub_level dropdowns - uses DB values for filtering, translated labels for display
  const LEVEL_OPTIONS = LEVEL_VALUES.map((val, i) => ({
    value: val,
    label: t(`course.level${i + 1}`),
  }));
  const SUB_LEVEL_OPTIONS = SUB_LEVEL_VALUES.map((val, i) => ({
    value: val,
    label: t(`course.subLevel${i + 1}`),
  }));

  // ─── Translation helpers for level/sub_level (DB stores Arabic, need to translate for English locale) ───
  const translateLevel = (level: string): string => {
    const idx = LEVEL_VALUES.indexOf(level as typeof LEVEL_VALUES[number]);
    if (idx !== -1) return t(`course.level${idx + 1}`);
    // Fallback: return as-is if not a known value
    return level;
  };
  const translateSubLevel = (subLevel: string): string => {
    const idx = SUB_LEVEL_VALUES.indexOf(subLevel as typeof SUB_LEVEL_VALUES[number]);
    if (idx !== -1) return t(`course.subLevel${idx + 1}`);
    return subLevel;
  };

  // ─── App store ───
  const { setSelectedSubjectId: setStoreSelectedSubjectId } = useAppStore();

  // ─── Data state ───
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});

  // ─── Copy code state ───
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // ─── Enrollment status map (student only) ───
  const [enrollmentStatuses, setEnrollmentStatuses] = useState<Record<string, string>>({});

  // ─── Create subject modal ───
  const [createSubjectOpen, setCreateSubjectOpen] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectDesc, setNewSubjectDesc] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);
  const [newSubjectLevel, setNewSubjectLevel] = useState('');
  const [newSubjectSubLevel, setNewSubjectSubLevel] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [newSubjectThumb, setNewSubjectThumb] = useState<File | null>(null);
  const newSubjectThumbRef = useRef<HTMLInputElement>(null);

  // ─── Join by code modal (student only) ───
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joiningSubject, setJoiningSubject] = useState(false);
  const [subjectPreview, setSubjectPreview] = useState<{ id: string; name: string; description?: string; color: string; teacher_name?: string } | null>(null);
  const [searchingSubject, setSearchingSubject] = useState(false);

  // ─── Cancel / Leave loading state ───
  const [leavingSubjectId, setLeavingSubjectId] = useState<string | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState<{ subjectId: string; subjectName: string } | null>(null);

  // ─── Filter state ───
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [filterSubLevel, setFilterSubLevel] = useState<string>('');

  // ─── Refs for stable real-time callbacks ───
  const fetchSubjectsRef = useRef<((forceRefresh?: boolean) => Promise<void>) | undefined>(undefined);

  // ─── Enrollment ID → Subject ID mapping (student only, for surgical Realtime DELETE) ───
  const enrollmentIdMapRef = useRef<Record<string, string>>({});

  // -------------------------------------------------------
  // Fetch teacher names (student only, non-blocking)
  // -------------------------------------------------------
  const fetchTeacherNames = useCallback(async (subjectsList: Subject[]): Promise<Record<string, string> | undefined> => {
    if (role !== 'student') return;
    try {
      const teacherIds = [...new Set(subjectsList.map((s) => s.teacher_id).filter(Boolean))];
      if (teacherIds.length > 0) {
        const { data: teachers, error: tError } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .in('id', teacherIds);
        if (tError) {
          console.error('Error fetching teacher names:', tError.message);
          return;
        }
        if (teachers) {
          const nameMap: Record<string, string> = {};
          (teachers as { id: string; name: string; title_id?: string | null; gender?: string | null; role?: string | null }[]).forEach((teacher) => {
            nameMap[teacher.id] = formatNameWithTitle(teacher.name, teacher.role, teacher.title_id, teacher.gender, t);
          });
          setTeacherNames(nameMap);
          return nameMap;
        }
      }
    } catch (err) {
      console.error('Fetch teacher names error:', err);
    }
    return undefined;
  }, [role]);

  // -------------------------------------------------------
  // Fetch subjects — OPTIMIZED: parallel queries + cache
  // -------------------------------------------------------
  const fetchSubjects = useCallback(async (forceRefresh = false) => {
    // Check cache first (skip if forceRefresh is true)
    const cacheKey = `${profile.id}-${role}`;
    if (!forceRefresh) {
      const cached = subjectsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < SUBJECTS_CACHE_TTL) {
        setSubjects(cached.data);
        setTeacherNames(cached.teacherNames);
        setEnrollmentStatuses(cached.enrollmentStatuses);
        setLoadingSubjects(false);
        return;
      }
    }

    setLoadingSubjects(true);
    try {
      if (role === 'teacher') {
        // Run both queries in parallel
        const [ownedResult, coTeacherResult] = await Promise.all([
          supabase
            .from('subjects')
            .select('*')
            .eq('teacher_id', profile.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('subject_teachers')
            .select('subject_id, role, subjects(*)')
            .eq('teacher_id', profile.id)
            .eq('role', 'co_teacher'),
        ]);

        // Process owned subjects
        let ownedSubjects: Subject[] = [];
        if (ownedResult.error) {
          console.error('Error fetching owned subjects:', ownedResult.error.message, ownedResult.error.code, ownedResult.error.details);
          if (isAuthError(ownedResult.error)) {
            const refreshed = await tryRefreshSession();
            if (refreshed) {
              const retry = await supabase
                .from('subjects')
                .select('*')
                .eq('teacher_id', profile.id)
                .order('created_at', { ascending: false });
              if (!retry.error) ownedSubjects = (retry.data as Subject[]) || [];
            }
          }
        } else {
          ownedSubjects = (ownedResult.data as Subject[]) || [];
        }

        // Mark owned subjects
        ownedSubjects = ownedSubjects.map(s => ({ ...s, is_co_teacher: false }));

        // Process co-taught subjects
        let coTaughtSubjects: Subject[] = [];
        if (!coTeacherResult.error && coTeacherResult.data) {
          (coTeacherResult.data as Record<string, unknown>[]).forEach((entry) => {
            const subject = entry.subjects as Subject | null;
            if (subject && !ownedSubjects.find(s => s.id === subject.id)) {
              coTaughtSubjects.push({ ...subject, is_co_teacher: true });
            }
          });
        }

        // Combine and sort: owned first, then co-taught
        const allSubjects = [...ownedSubjects, ...coTaughtSubjects];
        setSubjects(allSubjects);

        // Save to cache
        subjectsCache.set(cacheKey, {
          data: allSubjects,
          teacherNames: {},
          enrollmentStatuses: {},
          timestamp: Date.now(),
        });
      } else {
        // Student: single join query — also fetch enrollment status
        const { data, error } = await supabase
          .from('subject_students')
          .select('id, subject_id, status, subjects(*)')
          .eq('student_id', profile.id);

        if (error) {
          console.error('Error fetching enrolled subjects:', error.message, error.code);
        } else if (data && data.length > 0) {
          // Build enrollment status map and enrollment ID map
          const statusMap: Record<string, string> = {};
          const subjectsList: Subject[] = [];
          const enrollmentMap: Record<string, string> = {};

          (data as Record<string, unknown>[]).forEach((e) => {
            const subject = e.subjects as Subject | null;
            if (subject) {
              subjectsList.push(subject);
              // status might be undefined if column doesn't exist yet
              statusMap[subject.id] = (e.status as string) || 'approved';
              // Map enrollment ID → subject ID for Realtime DELETE handling
              if (e.id) enrollmentMap[e.id as string] = subject.id;
            }
          });

          setSubjects(subjectsList);
          setEnrollmentStatuses(statusMap);
          enrollmentIdMapRef.current = enrollmentMap;

          // Save to cache (teacherNames will be updated after fetchTeacherNames completes)
          subjectsCache.set(cacheKey, {
            data: subjectsList,
            teacherNames: {},
            enrollmentStatuses: statusMap,
            timestamp: Date.now(),
          });

          // Fetch teacher names separately (non-blocking)
          // Set loading to false first so subjects render immediately
          setLoadingSubjects(false);
          fetchTeacherNames(subjectsList).then((nameMap) => {
            if (nameMap) {
              // Update cache with teacher names
              const cached = subjectsCache.get(cacheKey);
              if (cached) {
                cached.teacherNames = nameMap;
              }
            }
          });
          return; // Early return — loadingSubjects already set to false above
        } else {
          setSubjects([]);
          setEnrollmentStatuses({});
          enrollmentIdMapRef.current = {};

          // Save empty result to cache
          subjectsCache.set(cacheKey, {
            data: [],
            teacherNames: {},
            enrollmentStatuses: {},
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      console.error('Fetch subjects error:', err);
    } finally {
      setLoadingSubjects(false);
    }
  }, [profile.id, role, fetchTeacherNames]);

  // ─── Keep ref updated for stable real-time callbacks ───
  useEffect(() => {
    fetchSubjectsRef.current = fetchSubjects;
  }, [fetchSubjects]);

  // -------------------------------------------------------
  // Initial data load — force refresh to bypass stale cache on remount
  // -------------------------------------------------------
  useEffect(() => {
    fetchSubjects(true);
  }, [fetchSubjects]);

  // -------------------------------------------------------
  // Real-time subscription for subjects — SURGICAL updates
  // -------------------------------------------------------
  useEffect(() => {
    const cacheKey = `${profile.id}-${role}`;

    if (role === 'teacher') {
      // ─── Teacher: subscribe to subjects table for instant CRUD ───
      const channel = supabase
        .channel(`subjects-${profile.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'subjects',
            filter: `teacher_id=eq.${profile.id}`,
          },
          (payload) => {
            const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
            const newRecord = payload.new as Subject | null;
            const oldRecord = payload.old as { id: string } | null;

            if (eventType === 'INSERT' && newRecord) {
              setSubjects(prev => {
                const exists = prev.some(s => s.id === newRecord.id);
                if (exists) return prev;
                return [{ ...newRecord, is_co_teacher: false } as Subject, ...prev];
              });
              subjectsCache.delete(cacheKey);
            } else if (eventType === 'UPDATE' && newRecord) {
              setSubjects(prev => prev.map(s =>
                s.id === newRecord.id
                  ? { ...newRecord, is_co_teacher: s.is_co_teacher } as Subject
                  : s
              ));
              subjectsCache.delete(cacheKey);
            } else if (eventType === 'DELETE' && oldRecord) {
              setSubjects(prev => prev.filter(s => s.id !== oldRecord.id));
              subjectsCache.delete(cacheKey);
            } else {
              // Fallback for unknown events
              fetchSubjectsRef.current?.(true);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }

    // ─── Student: subscribe to subject_students for enrollment changes ───
    const enrollmentChannel = supabase
      .channel(`student-subjects-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'subject_students',
          filter: `student_id=eq.${profile.id}`,
        },
        (payload) => {
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          const newRecord = payload.new as { id: string; subject_id: string; status: string } | null;
          const oldRecord = payload.old as { id: string } | null;

          if (eventType === 'INSERT' && newRecord) {
            // New enrollment — fetch the subject data and add to state
            const subjectId = newRecord.subject_id;
            supabase
              .from('subjects')
              .select('*')
              .eq('id', subjectId)
              .single()
              .then(({ data }) => {
                if (data) {
                  setSubjects(prev => {
                    const exists = prev.some(s => s.id === data.id);
                    if (exists) return prev;
                    return [data as Subject, ...prev];
                  });
                  setEnrollmentStatuses(prev => ({
                    ...prev,
                    [subjectId]: newRecord.status || 'pending'
                  }));
                  enrollmentIdMapRef.current = {
                    ...enrollmentIdMapRef.current,
                    [newRecord.id]: subjectId
                  };
                  fetchTeacherNames([data as Subject]);
                }
              });
            subjectsCache.delete(cacheKey);
          } else if (eventType === 'UPDATE' && newRecord) {
            // Enrollment status changed (e.g., approved/rejected)
            setEnrollmentStatuses(prev => ({
              ...prev,
              [newRecord.subject_id]: newRecord.status || 'approved'
            }));
            subjectsCache.delete(cacheKey);
          } else if (eventType === 'DELETE' && oldRecord) {
            // Enrollment removed — look up subject ID from our mapping
            const subjectId = enrollmentIdMapRef.current[oldRecord.id];
            if (subjectId) {
              setSubjects(prev => prev.filter(s => s.id !== subjectId));
              setEnrollmentStatuses(prev => {
                const updated = { ...prev };
                delete updated[subjectId];
                return updated;
              });
              // Clean up the enrollment map
              const newMap = { ...enrollmentIdMapRef.current };
              delete newMap[oldRecord.id];
              enrollmentIdMapRef.current = newMap;
            } else {
              // Fallback if mapping not found
              fetchSubjectsRef.current?.(true);
            }
            subjectsCache.delete(cacheKey);
          } else {
            fetchSubjectsRef.current?.(true);
          }
        }
      )
      .subscribe();

    // ─── Student: also subscribe to subjects table for data changes by teacher ───
    // When a teacher updates a course name/description/color, students see it instantly.
    // When a teacher or admin deletes a course, students see it removed instantly.
    const subjectsDataChannel = supabase
      .channel(`student-subjects-data-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'subjects',
        },
        (payload) => {
          const newRecord = payload.new as Subject | null;
          if (!newRecord) return;
          // Only update if this subject is in the student's enrolled list
          setSubjects(prev => {
            const idx = prev.findIndex(s => s.id === newRecord.id);
            if (idx === -1) return prev; // Not in our list, ignore
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...newRecord } as Subject;
            subjectsCache.delete(cacheKey);
            return updated;
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'subjects',
        },
        (payload) => {
          const oldRecord = payload.old as { id: string } | null;
          if (!oldRecord) return;
          // Only remove if this subject is in the student's enrolled list
          setSubjects(prev => {
            const exists = prev.some(s => s.id === oldRecord.id);
            if (!exists) return prev; // Not in our list, ignore
            subjectsCache.delete(cacheKey);
            return prev.filter(s => s.id !== oldRecord.id);
          });
          setEnrollmentStatuses(prev => {
            if (!(oldRecord.id in prev)) return prev;
            const updated = { ...prev };
            delete updated[oldRecord.id];
            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(enrollmentChannel);
      supabase.removeChannel(subjectsDataChannel);
    };
  }, [profile.id, role, fetchTeacherNames]);

  // -------------------------------------------------------
  // Copy join code to clipboard
  // -------------------------------------------------------
  const handleCopyCode = useCallback((code: string, subjectId: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCodeId(subjectId);
      toast.success(t('common.copied'));
      setTimeout(() => setCopiedCodeId(null), 2000);
    });
  }, []);

  // -------------------------------------------------------
  // Create subject — OPTIMIZED: no getSession(), no redundant fetch
  // -------------------------------------------------------
  const handleCreateSubject = async () => {
    const name = newSubjectName.trim();
    if (!name) {
      toast.error(t('course.subjectName') + ': ' + t('common.required'));
      return;
    }
    setCreatingSubject(true);
    try {
      const joinCode = generateJoinCode();

      // Upload thumbnail first (if provided)
      let thumbnailUrl: string | null = null;
      if (newSubjectThumb) {
        const ext = newSubjectThumb.name.split('.').pop() || 'jpg';
        const thumbPath = `${profile.id}/thumbnails/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: thumbError } = await supabase.storage
          .from('video-files')
          .upload(thumbPath, newSubjectThumb, { cacheControl: '3600', upsert: false });
        if (thumbError) {
          console.error('Thumbnail upload error:', thumbError);
          // Non-fatal — continue without thumbnail
        } else {
          const { data: urlData } = supabase.storage.from('video-files').getPublicUrl(thumbPath);
          thumbnailUrl = urlData.publicUrl;
        }
      }

      let { data, error } = await supabase
        .from('subjects')
        .insert({
          teacher_id: profile.id,
          name,
          description: newSubjectDesc.trim() || null,
          color: newSubjectColor,
          join_code: joinCode,
          level: newSubjectLevel || null,
          sub_level: newSubjectSubLevel || null,
          thumbnail_url: thumbnailUrl,
        })
        .select()
        .single();

      // If RLS/auth error, try refreshing the session and retry once
      if (error && isAuthError(error)) {
        console.warn('Auth error creating subject, refreshing session...');
        const refreshed = await tryRefreshSession();
        if (refreshed) {
          const retry = await supabase
            .from('subjects')
            .insert({
              teacher_id: profile.id,
              name,
              description: newSubjectDesc.trim() || null,
              color: newSubjectColor,
              join_code: joinCode,
              level: newSubjectLevel || null,
              sub_level: newSubjectSubLevel || null,
              thumbnail_url: thumbnailUrl,
            })
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (error) {
        console.error('Create subject error:', error.message, error.code, error.details, error.hint);
        if (isAuthError(error)) {
          toast.error(t('common.accessDenied'));
        } else if (error.code === '23503') {
          toast.error(t('common.unexpectedError'));
        } else {
          toast.error(t('common.unexpectedError'));
        }
      } else {
        toast.success(t('course.subjectCreated'));
        setCreateSubjectOpen(false);
        setNewSubjectName('');
        setNewSubjectDesc('');
        setNewSubjectColor(SUBJECT_COLORS[0]);
        setNewSubjectLevel('');
        setNewSubjectSubLevel('');
        setNewSubjectThumb(null);
        if (newSubjectThumbRef.current) newSubjectThumbRef.current.value = '';

        // Optimistic update — real-time subscription will sync if needed
        if (data) {
          setSubjects((prev) => [data as Subject, ...prev]);
        }
      }
    } catch (err) {
      console.error('Create subject catch error:', err);
      toast.error(t('common.unexpectedError'));
    } finally {
      setCreatingSubject(false);
    }
  };

  // ─── Keep auth cache fresh ───
  // Initialize the auth state listener so the token cache stays up-to-date.
  // This prevents getSession() from hanging on mobile/PWA after backgrounding.
  useEffect(() => {
    initAuthCacheListener();
  }, []);

  const handleSearchSubject = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      toast.error(t('dashboard.joinSubjectCode') + ': ' + t('common.required'));
      return;
    }
    // Guard against double-clicks / race conditions
    if (searchingSubject || joiningSubject) return;
    setSearchingSubject(true);
    setSubjectPreview(null);

    try {
      // Use AbortController with timeout to prevent infinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('/api/join-subject', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ joinCode: code, action: 'search' }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('course.subjectNotFound'));
        return;
      }

      // Show subject preview
      setSubjectPreview(data.subject);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        toast.error(t('common.connectionError'));
      } else {
        console.error('[handleSearchSubject] Unexpected error:', err);
        toast.error(t('common.unexpectedError'));
      }
    } finally {
      setSearchingSubject(false);
    }
  };

  // -------------------------------------------------------
  // Join subject by code - Step 2: Confirm enrollment
  // -------------------------------------------------------
  const handleConfirmJoinSubject = async () => {
    if (!subjectPreview) return;
    // Guard against double-clicks / race conditions
    if (joiningSubject || searchingSubject) return;
    setJoiningSubject(true);

    try {
      // Use AbortController with timeout to prevent infinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('/api/join-subject', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ joinCode: joinCodeInput.trim().toUpperCase() }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok || data.error) {
        toast.error(data.error || t('common.unexpectedError'));
        return;
      }

      toast.success(data.message || t('common.success'));

      // Optimistically add the subject to local state so it appears immediately
      if (subjectPreview) {
        const newSubject: Subject = {
          id: subjectPreview.id,
          name: subjectPreview.name,
          description: subjectPreview.description || '',
          color: subjectPreview.color,
          teacher_id: '', // will be filled on re-fetch
          join_code: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          level: '',
          sub_level: '',
        };
        setSubjects(prev => [...prev, newSubject]);
        setEnrollmentStatuses(prev => ({ ...prev, [subjectPreview.id]: 'pending' }));
      }

      setJoinCodeOpen(false);
      setJoinCodeInput('');
      setSubjectPreview(null);

      // Immediate re-fetch to show updated data (forceRefresh to bypass cache after mutation)
      fetchSubjects(true);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        toast.error(t('common.connectionError'));
      } else {
        console.error('[handleConfirmJoinSubject] Unexpected error:', err);
        toast.error(t('common.unexpectedError'));
      }
    } finally {
      setJoiningSubject(false);
    }
  };

  // -------------------------------------------------------
  // Cancel / Dismiss / Leave subject (student only)
  // -------------------------------------------------------
  const handleSubjectAction = async (subjectId: string, action: 'cancel' | 'dismiss' | 'leave') => {
    // For 'leave', show confirmation first
    if (action === 'leave') {
      const subjectObj = subjects.find(s => s.id === subjectId);
      setLeaveConfirmOpen({ subjectId, subjectName: subjectObj?.name || t('course.coursePage') });
      return;
    }
    setLeavingSubjectId(subjectId);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/leave-subject', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, subjectId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message);
        fetchSubjects(true); // forceRefresh after mutation
      } else {
        toast.error(data.error || t('common.unexpectedError'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLeavingSubjectId(null);
    }
  };

  const handleConfirmLeave = async () => {
    if (!leaveConfirmOpen) return;
    const subjectId = leaveConfirmOpen.subjectId;
    setLeaveConfirmOpen(null);
    setLeavingSubjectId(subjectId);
    try {
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/leave-subject', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'leave', subjectId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.message);
        fetchSubjects(true); // forceRefresh after mutation
      } else {
        toast.error(data.error || t('common.unexpectedError'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLeavingSubjectId(null);
    }
  };

  // -------------------------------------------------------
  // Helper: format date
  // -------------------------------------------------------
  function formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  // -------------------------------------------------------
  // Helper: Convert hex color to rgba
  // -------------------------------------------------------
  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* ─── Header ─── */}
      <motion.div
        variants={cardVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold text-foreground">{t('nav.subjects')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {role === 'teacher' ? t('course.coursePage') : t('course.enrolledStudents')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {role === 'student' && (
            <button
              onClick={() => setJoinCodeOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-200 transition-all hover:bg-teal-700 hover:shadow-md hover:shadow-teal-200 active:scale-[0.97]"
            >
              <UserPlus className="h-4 w-4" />
              {t('dashboard.joinSubject')}
            </button>
          )}
          {role === 'teacher' && (
            <button
              onClick={() => setCreateSubjectOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-sky-200 transition-all hover:bg-sky-800 hover:shadow-md hover:shadow-sky-200 active:scale-[0.97]"
            >
              <Plus className="h-4 w-4" />
              {t('dashboard.createSubject')}
            </button>
          )}
        </div>
      </motion.div>

      {/* ─── Filters ─── */}
      {!loadingSubjects && subjects.length > 0 && (
        <motion.div
          variants={cardVariants}
          className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground shrink-0">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span>{t('common.search')}</span>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {/* الفرقة filter */}
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value)}
                className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all appearance-none cursor-pointer min-w-[140px]"
                dir={direction}
              >
                <option value="">{t('common.all')}</option>
                {LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* المستوى filter */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                value={filterSubLevel}
                onChange={(e) => setFilterSubLevel(e.target.value)}
                className="rounded-lg border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all appearance-none cursor-pointer min-w-[140px]"
                dir={direction}
              >
                <option value="">{t('common.all')}</option>
                {SUB_LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Clear filters button */}
            {(filterLevel || filterSubLevel) && (
              <button
                onClick={() => { setFilterLevel(''); setFilterSubLevel(''); }}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3 w-3" />
                {t('common.reset')}
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* ─── Loading State ─── */}
      {loadingSubjects && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700" />
          <p className="mt-3 text-sm text-muted-foreground">{t('common.loading')}</p>
        </div>
      )}

      {/* ─── Empty State ─── */}
      {!loadingSubjects && subjects.length === 0 && (
        <motion.div
          variants={cardVariants}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sky-200 dark:border-sky-900/60 bg-gradient-to-b from-sky-50/50 dark:from-sky-900/20 to-transparent py-20"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-100 dark:bg-sky-800/40 mb-5">
            <BookOpen className="h-10 w-10 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-lg font-bold text-foreground mb-1.5">
            {role === 'teacher' ? t('dashboard.noSubjectsYet') : t('course.noStudents')}
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            {role === 'teacher'
              ? t('dashboard.noSubjectsYetDesc')
              : t('dashboard.joinSubjectDesc')}
          </p>
          <div className="flex items-center gap-3">
            {role === 'student' && (
              <button
                onClick={() => setJoinCodeOpen(true)}
                className="flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-teal-700 active:scale-[0.97]"
              >
                <UserPlus className="h-4 w-4" />
                {t('dashboard.joinSubject')}
              </button>
            )}
            {role === 'teacher' && (
              <button
                onClick={() => setCreateSubjectOpen(true)}
                className="flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sky-800 active:scale-[0.97]"
              >
                <Plus className="h-4 w-4" />
                {t('dashboard.createSubject')}
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* ─── Compute filtered subject lists ─── */}
      {(() => {
        // Apply level/sub_level filters first
        // Backward compatibility: map old values to new ones
        const mapSubLevel = (val: string | undefined): string | undefined => {
          if (!val) return val;
          if (val === 'مستوى أول') return 'المستوى الأول';
          if (val === 'مستوى ثاني') return 'المستوى الثاني';
          return val;
        };
        let filteredSubjects = subjects.map((s) => ({ ...s, sub_level: mapSubLevel(s.sub_level) }));
        if (filterLevel) {
          filteredSubjects = filteredSubjects.filter((s) => s.level === filterLevel);
        }
        if (filterSubLevel) {
          filteredSubjects = filteredSubjects.filter((s) => s.sub_level === filterSubLevel);
        }

        // For students: split into approved / pending / rejected
        const approvedSubjects = role === 'student'
          ? filteredSubjects.filter((s) => (enrollmentStatuses[s.id] || 'approved') === 'approved')
          : filteredSubjects;
        const pendingSubjects = role === 'student'
          ? filteredSubjects.filter((s) => enrollmentStatuses[s.id] === 'pending')
          : [];
        const rejectedSubjects = role === 'student'
          ? filteredSubjects.filter((s) => enrollmentStatuses[s.id] === 'rejected')
          : [];

        return (
          <>
            {/* ─── Approved Subjects Grid ─── */}
            {!loadingSubjects && approvedSubjects.length > 0 && (
              <motion.div
                variants={containerVariants}
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-5"
              >
                {approvedSubjects.map((subject) => {
                  const color = subject.color || '#0D9488';
                  const hasCover = !!subject.thumbnail_url;
                  return (
                    <motion.div key={subject.id} variants={cardVariants}>
                      <div
                        className="group relative rounded-2xl border bg-card shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden hover:-translate-y-0.5"
                        onClick={() => {
                          setStoreSelectedSubjectId(subject.id);
                        }}
                      >
                        {/* ── Cover Image Section ── */}
                        {hasCover ? (
                          <div className="relative h-36 sm:h-40 overflow-hidden">
                            <img
                              src={subject.thumbnail_url!}
                              alt={subject.name}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            {/* Gradient overlay for text readability */}
                            <div
                              className="absolute inset-0"
                              style={{
                                background: `linear-gradient(to top, ${hexToRgba(color, 0.85)} 0%, ${hexToRgba(color, 0.4)} 40%, transparent 100%)`,
                              }}
                            />
                            {/* Subject name on top of cover */}
                            <div className="absolute bottom-0 start-0 end-0 p-4">
                              <h3 className="font-bold text-white text-base leading-tight drop-shadow-sm line-clamp-2">
                                {subject.name}
                              </h3>
                              {subject.description && (
                                <p className="text-sm text-white/80 mt-1 line-clamp-1 leading-relaxed">
                                  {subject.description}
                                </p>
                              )}
                            </div>
                            {/* Join code pill on cover (teacher) */}
                            {role === 'teacher' && subject.join_code && !subject.is_co_teacher && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyCode(subject.join_code!, subject.id);
                                }}
                                className="absolute top-3 start-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur-sm px-2.5 py-1 text-xs transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] shadow-sm"
                              >
                                <Hash
                                  className="h-3 w-3 shrink-0"
                                  style={{ color }}
                                />
                                <span
                                  className="font-mono font-semibold tracking-wider text-xs"
                                  style={{ color }}
                                >
                                  {subject.join_code}
                                </span>
                                {copiedCodeId === subject.id ? (
                                  <Check className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                                ) : (
                                  <Copy
                                    className="h-3.5 w-3.5 shrink-0 opacity-50"
                                    style={{ color }}
                                  />
                                )}
                              </button>
                            )}
                          </div>
                        ) : (
                          /* ── No cover: colored header with initial ── */
                          <div
                            className="relative h-28 sm:h-32 overflow-hidden flex items-center justify-center"
                            style={{
                              background: `linear-gradient(135deg, ${hexToRgba(color, 0.25)} 0%, ${hexToRgba(color, 0.08)} 100%)`,
                            }}
                          >
                            <span
                              className="text-6xl font-bold opacity-20 select-none"
                              style={{ color }}
                            >
                              {subject.name.charAt(0)}
                            </span>
                            {/* Subject name at bottom */}
                            <div className="absolute bottom-0 start-0 end-0 p-4"
                              style={{
                                background: `linear-gradient(to top, ${hexToRgba(color, 0.6)} 0%, transparent 100%)`,
                              }}
                            >
                              <h3 className="font-bold text-foreground text-base leading-tight line-clamp-2">
                                {subject.name}
                              </h3>
                            </div>
                            {/* Join code pill (teacher) */}
                            {role === 'teacher' && subject.join_code && !subject.is_co_teacher && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyCode(subject.join_code!, subject.id);
                                }}
                                className="absolute top-3 start-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur-sm px-2.5 py-1 text-xs transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] shadow-sm"
                              >
                                <Hash className="h-3 w-3 shrink-0" style={{ color }} />
                                <span className="font-mono font-semibold tracking-wider text-xs" style={{ color }}>
                                  {subject.join_code}
                                </span>
                                {copiedCodeId === subject.id ? (
                                  <Check className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5 shrink-0 opacity-50" style={{ color }} />
                                )}
                              </button>
                            )}
                          </div>
                        )}

                        {/* ── Card Body ── */}
                        <div className="relative p-4">
                          {/* Description (only when no cover, since cover already shows it) */}
                          {!hasCover && subject.description && (
                            <p className="text-sm text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                              {subject.description}
                            </p>
                          )}

                          {/* Level & Sub-level badges */}
                          {(subject.level || subject.sub_level) && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {subject.level && (
                                <div className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs text-blue-700">
                                  <GraduationCap className="h-3 w-3 shrink-0" />
                                  <span className="font-medium">{translateLevel(subject.level)}</span>
                                </div>
                              )}
                              {subject.sub_level && (
                                <div className="inline-flex items-center gap-1 rounded-full bg-sky-50 dark:bg-sky-900/15 border border-sky-200 dark:border-sky-900/60 px-2.5 py-1 text-xs text-sky-800 dark:text-sky-400">
                                  <Calendar className="h-3 w-3 shrink-0" />
                                  <span className="font-medium">{translateSubLevel(subject.sub_level)}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Co-teacher badge */}
                          {role === 'teacher' && subject.is_co_teacher && (
                            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-teal-50 border border-teal-200 px-2.5 py-1 text-xs text-teal-700">
                              <Shield className="h-3 w-3 shrink-0" />
                              <span className="font-medium">{t('roles.teacher')}</span>
                            </div>
                          )}

                          {/* Footer: creation date + teacher name + leave button */}
                          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(subject.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {role === 'student' && teacherNames[subject.teacher_id] && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <User className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{teacherNames[subject.teacher_id]}</span>
                                </div>
                              )}
                              {role === 'student' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSubjectAction(subject.id, 'leave'); }}
                                  disabled={leavingSubjectId === subject.id}
                                  className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50"
                                  title={t('course.leaveSubject')}
                                >
                                  {leavingSubjectId === subject.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                                  {t('course.leaveSubject')}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}

            {/* ─── Pending / Rejected Subjects Section (student only) ─── */}
            {!loadingSubjects && role === 'student' && (pendingSubjects.length > 0 || rejectedSubjects.length > 0) && (
              <motion.div variants={cardVariants} className="space-y-4">
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground">{t('pendingRequests')}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-5">
                  {/* Pending subjects */}
                  {pendingSubjects.map((subject) => {
                    const color = subject.color || '#0D9488';
                    return (
                      <motion.div key={subject.id} variants={cardVariants}>
                        <div className="group relative rounded-2xl border border-amber-200 bg-card shadow-sm overflow-hidden opacity-90">
                          {/* Gradient background overlay */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: `linear-gradient(135deg, ${hexToRgba(color, 0.08)} 0%, transparent 100%)`,
                            }}
                          />

                          <div className="relative p-5 pt-6">
                            {/* Subject icon + name */}
                            <div className="flex items-start gap-3.5 mb-3">
                              <div
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg shadow-sm"
                                style={{ backgroundColor: color }}
                              >
                                {subject.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                <h3 className="font-bold text-foreground text-base leading-tight truncate">
                                  {subject.name}
                                </h3>
                                {subject.description && (
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                    {subject.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Pending badge + cancel button */}
                            <div className="mt-3 flex items-center gap-2">
                              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs text-amber-700">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span className="font-medium">{t('course.pending')}</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSubjectAction(subject.id, 'cancel'); }}
                                disabled={leavingSubjectId === subject.id}
                                className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                              >
                                {leavingSubjectId === subject.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                {t('cancelRequest')}
                              </button>
                            </div>

                            {/* Footer */}
                            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                <span>{formatDate(subject.created_at)}</span>
                              </div>
                              {teacherNames[subject.teacher_id] && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <User className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{teacherNames[subject.teacher_id]}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}

                  {/* Rejected subjects */}
                  {rejectedSubjects.map((subject) => {
                    const color = subject.color || '#0D9488';
                    return (
                      <motion.div key={subject.id} variants={cardVariants}>
                        <div className="group relative rounded-2xl border border-rose-200 bg-card shadow-sm overflow-hidden opacity-80">
                          {/* Gradient background overlay */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: `linear-gradient(135deg, ${hexToRgba(color, 0.05)} 0%, transparent 100%)`,
                            }}
                          />

                          <div className="relative p-5 pt-6">
                            {/* Subject icon + name */}
                            <div className="flex items-start gap-3.5 mb-3">
                              <div
                                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg shadow-sm opacity-60"
                                style={{ backgroundColor: color }}
                              >
                                {subject.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                <h3 className="font-bold text-foreground text-base leading-tight truncate">
                                  {subject.name}
                                </h3>
                                {subject.description && (
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                    {subject.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Rejected badge + dismiss button */}
                            <div className="mt-3 flex items-center gap-2">
                              <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs text-rose-700">
                                <XCircle className="h-3 w-3 shrink-0" />
                                <span className="font-medium">{t('reports.statuses.dismissed')}</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSubjectAction(subject.id, 'dismiss'); }}
                                disabled={leavingSubjectId === subject.id}
                                className="inline-flex items-center gap-1 rounded-full bg-gray-50 dark:bg-muted/50 border border-gray-200 dark:border-border px-2.5 py-1 text-xs text-gray-600 dark:text-muted-foreground hover:bg-gray-100 dark:hover:bg-muted transition-colors disabled:opacity-50"
                              >
                                {leavingSubjectId === subject.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                {t('common.delete')}
                              </button>
                            </div>

                            {/* Footer */}
                            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                <span>{formatDate(subject.created_at)}</span>
                              </div>
                              {teacherNames[subject.teacher_id] && (
                                <div className="flex items-center gap-1.5 truncate">
                                  <User className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{teacherNames[subject.teacher_id]}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </>
        );
      })()}

      {/* ─── Create Subject Modal ─── */}
      <AnimatePresence>
        {createSubjectOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !creatingSubject && setCreateSubjectOpen(false)}
            />

            {/* Modal content */}
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-md max-h-[90vh] rounded-2xl border bg-background shadow-2xl overflow-hidden my-4 sm:my-0 flex flex-col"
            >
              {/* Modal gradient header */}
              <div
                className="px-6 pt-6 pb-4 shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${hexToRgba(newSubjectColor, 0.12)} 0%, transparent 100%)`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-white font-bold shadow-sm"
                      style={{ backgroundColor: newSubjectColor }}
                    >
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">{t('dashboard.createSubject')}</h3>
                      <p className="text-xs text-muted-foreground">{t('dashboard.noSubjectsYetDesc')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => !creatingSubject && setCreateSubjectOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                {/* Subject name */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    {t('course.subjectName')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    placeholder={t('course.subjectName')}
                    className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
                    dir={direction}
                    disabled={creatingSubject}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !creatingSubject) handleCreateSubject();
                    }}
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    {t('course.description')}
                  </label>
                  <textarea
                    value={newSubjectDesc}
                    onChange={(e) => setNewSubjectDesc(e.target.value)}
                    placeholder={t('subjectDescPlaceholder')}
                    rows={2}
                    className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all resize-none"
                    dir={direction}
                    disabled={creatingSubject}
                  />
                </div>

                {/* Thumbnail picker */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    {t('course.coursePage')}
                  </label>
                  <input
                    ref={newSubjectThumbRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      setNewSubjectThumb(file || null);
                    }}
                    className="w-full rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2.5 text-sm text-foreground file:me-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-xs file:font-medium file:cursor-pointer file:transition-colors"
                    style={{
                      // @ts-expect-error — file button color style
                      '--file-bg': newSubjectColor,
                    }}
                    disabled={creatingSubject}
                  />
                  {newSubjectThumb && (
                    <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-2.5">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                        <img
                          src={URL.createObjectURL(newSubjectThumb)}
                          alt={t('course.coursePage')}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{newSubjectThumb.name}</p>
                        <p className="text-[11px] text-muted-foreground">{(newSubjectThumb.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button
                        onClick={() => { setNewSubjectThumb(null); if (newSubjectThumbRef.current) newSubjectThumbRef.current.value = ''; }}
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                        title="{t('common.delete')}"
                        disabled={creatingSubject}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* {t('course.semester')} & {t('course.subjectCode')} */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      {t('subjects.levelLabel')}
                    </label>
                    <select
                      value={newSubjectLevel}
                      onChange={(e) => setNewSubjectLevel(e.target.value)}
                      className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all appearance-none cursor-pointer"
                      dir={direction}
                      disabled={creatingSubject}
                    >
                      <option value="">{t('common.none')}</option>
                      {LEVEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      {t('subjects.sublevelLabel')}
                    </label>
                    <select
                      value={newSubjectSubLevel}
                      onChange={(e) => setNewSubjectSubLevel(e.target.value)}
                      className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all appearance-none cursor-pointer"
                      dir={direction}
                      disabled={creatingSubject}
                    >
                      <option value="">{t('subjects.noSublevel')}</option>
                      {SUB_LEVEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Color picker — visual swatches */}
                <div className="space-y-2.5">
                  <label className="text-sm font-semibold text-foreground">
                    {t('subjects.subjectColor')}
                  </label>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {SUBJECT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewSubjectColor(color)}
                        disabled={creatingSubject}
                        className="relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-110 active:scale-95"
                        style={{
                          backgroundColor: color,
                          boxShadow:
                            newSubjectColor === color
                              ? `0 0 0 3px ${hexToRgba(color, 0.3)}, 0 2px 8px ${hexToRgba(color, 0.3)}`
                              : 'none',
                        }}
                      >
                        {newSubjectColor === color && (
                          <Check className="h-4 w-4 text-white" strokeWidth={3} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Join code preview */}
                <div
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5"
                  style={{
                    backgroundColor: hexToRgba(newSubjectColor, 0.06),
                    border: `1px solid ${hexToRgba(newSubjectColor, 0.15)}`,
                  }}
                >
                  <Hash className="h-4 w-4 shrink-0" style={{ color: newSubjectColor }} />
                  <span className="text-xs text-muted-foreground">{t('subjects.autoJoinCode')}</span>
                </div>

                {/* Create button */}
                <button
                  onClick={handleCreateSubject}
                  disabled={creatingSubject || !newSubjectName.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                  style={{
                    backgroundColor: newSubjectColor,
                    boxShadow: `0 2px 12px ${hexToRgba(newSubjectColor, 0.35)}`,
                  }}
                >
                  {creatingSubject ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('subjects.creating')}
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      {t('subjects.createSubject')}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Join by Code Modal (student only) ─── */}
      <AnimatePresence>
        {joinCodeOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => {
                if (!joiningSubject && !searchingSubject) {
                  setJoinCodeOpen(false);
                  setSubjectPreview(null);
                }
              }}
            />

            {/* Modal content */}
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-md rounded-2xl border bg-background shadow-2xl overflow-hidden"
              dir={direction}
            >
              {/* Modal gradient header */}
              <div
                className="px-6 pt-6 pb-4"
                style={{
                  background: `linear-gradient(135deg, ${hexToRgba('#14b8a6', 0.12)} 0%, transparent 100%)`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white font-bold shadow-sm">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">{t('subjects.joinCourse')}</h3>
                      <p className="text-xs text-muted-foreground">
                        {subjectPreview ? `${t('common.confirm')} ${t('dashboard.joinSubject')}` : `${t('dashboard.joinSubjectCode')}`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!joiningSubject && !searchingSubject) {
                        setJoinCodeOpen(false);
                        setSubjectPreview(null);
                      }
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-5">
                {/* Step 1: Enter code */}
                {!subjectPreview && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-foreground">
                        {t('subjects.joinCode')} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => {
                          setJoinCodeInput(e.target.value.toUpperCase());
                          setSubjectPreview(null);
                        }}
                        placeholder={t('subjects.enterJoinCode')}
                        className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all font-mono tracking-widest text-center"
                        maxLength={6}
                        disabled={searchingSubject}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !searchingSubject && joinCodeInput.trim()) handleSearchSubject();
                        }}
                      />
                    </div>

                    {/* Info hint */}
                    <div
                      className="flex items-center gap-2 rounded-xl px-4 py-2.5"
                      style={{
                        backgroundColor: hexToRgba('#14b8a6', 0.06),
                        border: `1px solid ${hexToRgba('#14b8a6', 0.15)}`,
                      }}
                    >
                      <Hash className="h-4 w-4 shrink-0 text-teal-600" />
                      <span className="text-xs text-muted-foreground">{t('subjects.getCodeFromTeacher')}</span>
                    </div>

                    {/* Search button */}
                    <button
                      onClick={handleSearchSubject}
                      disabled={searchingSubject || joiningSubject || !joinCodeInput.trim()}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-teal-700 active:scale-[0.98]"
                      style={{
                        boxShadow: `0 2px 12px ${hexToRgba('#14b8a6', 0.35)}`,
                      }}
                    >
                      {searchingSubject ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('subjects.searching')}
                        </>
                      ) : (
                        <>
                          <Hash className="h-4 w-4" />
                          {t('subjects.searchSubject')}
                        </>
                      )}
                    </button>
                  </>
                )}

                {/* Step 2: Subject preview card */}
                {subjectPreview && (
                  <>
                    <div
                      className="rounded-xl border p-4 space-y-3"
                      style={{
                        borderColor: hexToRgba(subjectPreview.color, 0.4),
                        backgroundColor: hexToRgba(subjectPreview.color, 0.04),
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white font-bold text-lg shadow-sm"
                          style={{ backgroundColor: subjectPreview.color }}
                        >
                          {subjectPreview.name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-foreground text-base leading-tight truncate">
                            {subjectPreview.name}
                          </h4>
                          {subjectPreview.description && (
                            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                              {subjectPreview.description}
                            </p>
                          )}
                        </div>
                      </div>
                      {subjectPreview.teacher_name && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <User className="h-3.5 w-3.5 shrink-0" />
                          <span>{t('subjects.teacher')}: {subjectPreview.teacher_name}</span>
                        </div>
                      )}
                      <div
                        className="flex items-center gap-2 rounded-lg px-3 py-2"
                        style={{
                          backgroundColor: hexToRgba('#14b8a6', 0.08),
                        }}
                      >
                        <Clock className="h-4 w-4 text-teal-600 shrink-0" />
                        <span className="text-xs text-teal-700 font-medium">{t('subjects.joinRequestPending')}</span>
                      </div>
                      <button
                        onClick={() => {
                          setSubjectPreview(null);
                          setJoinCodeInput('');
                        }}
                        disabled={joiningSubject}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                      >
                        {t('subjects.changeCode')}
                      </button>
                    </div>

                    {/* Confirm button */}
                    <button
                      onClick={handleConfirmJoinSubject}
                      disabled={joiningSubject || searchingSubject}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-teal-700 active:scale-[0.98]"
                      style={{
                        boxShadow: `0 2px 12px ${hexToRgba('#14b8a6', 0.35)}`,
                      }}
                    >
                      {joiningSubject ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('subjects.sendingRequest')}
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          {t('subjects.confirmJoin')}
                        </>
                      )}
                    </button>
                  </>
                )}

                {/* Cancel button */}
                <button
                  onClick={() => {
                    if (!joiningSubject && !searchingSubject) {
                      setJoinCodeOpen(false);
                      setSubjectPreview(null);
                    }
                  }}
                  disabled={joiningSubject || searchingSubject}
                  className="w-full rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Leave Course Confirm Dialog (student only) ─── */}
      <AnimatePresence>
        {leaveConfirmOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalOverlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !leavingSubjectId && setLeaveConfirmOpen(null)}
            />
            <motion.div
              variants={modalContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-sm rounded-2xl border bg-background shadow-2xl p-6"
              dir={direction}
            >
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 mb-4">
                  <LogOut className="h-7 w-7 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t('subjects.leaveCourse')}</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  {t('subjects.leaveConfirmDesc')} &quot;{leaveConfirmOpen.subjectName}&quot;?
                </p>
                <p className="text-xs text-muted-foreground/70 mb-6">
                  {t('leaveSubjectWarning')}
                </p>
                <div className="flex items-center gap-3 w-full">
                  <button
                    onClick={handleConfirmLeave}
                    disabled={leavingSubjectId !== null}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
                  >
                    {leavingSubjectId ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('subjects.leaving')}
                      </>
                    ) : (
                      <>
                        <LogOut className="h-4 w-4" />
                        {t('subjects.confirmLeave')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setLeaveConfirmOpen(null)}
                    disabled={leavingSubjectId !== null}
                    className="flex-1 rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
