'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// xlsx is dynamically imported in handleExportExcel to reduce initial bundle size
import {
  ClipboardCheck,
  Play,
  StopCircle,
  Users,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronLeft,
  Download,
  Calendar,
  XCircle,
  UserCheck,
  UserX,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type {
  UserProfile,
  Subject,
  Lecture,
  AttendanceSession,
  AttendanceRecord,
} from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AttendanceSectionProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
}

// -------------------------------------------------------
// Extended types for enriched data
// -------------------------------------------------------
interface AttendanceRecordWithStudent extends AttendanceRecord {
  student_name?: string;
  student_email?: string;
}

interface SessionWithDetails extends AttendanceSession {
  subject_name?: string;
  lecture_title?: string;
  record_count?: number;
}

// -------------------------------------------------------
// Animation variants (matching existing codebase)
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
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

function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ar-SA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatDateTime(dateStr: string): string {
  return `${formatDate(dateStr)} - ${formatTime(dateStr)}`;
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AttendanceSection({ profile, role }: AttendanceSectionProps) {
  // ─── Shared state ───
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  // ─── Teacher state ───
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [selectedLectureId, setSelectedLectureId] = useState<string>('');
  const [loadingLectures, setLoadingLectures] = useState(false);
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [startingSession, setStartingSession] = useState(false);
  const [stoppingSession, setStoppingSession] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecordWithStudent[]>([]);
  const [enrolledStudents, setEnrolledStudents] = useState<UserProfile[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [pastSessions, setPastSessions] = useState<SessionWithDetails[]>([]);
  const [loadingPastSessions, setLoadingPastSessions] = useState(false);
  const [selectedPastSession, setSelectedPastSession] = useState<SessionWithDetails | null>(null);
  const [pastSessionRecords, setPastSessionRecords] = useState<AttendanceRecordWithStudent[]>([]);
  const [loadingPastSessionRecords, setLoadingPastSessionRecords] = useState(false);
  const [checkingActiveSession, setCheckingActiveSession] = useState(true);

  // ─── Student state ───
  const [studentActiveSession, setStudentActiveSession] = useState<AttendanceSession | null>(null);
  const [studentSessionSubject, setStudentSessionSubject] = useState<string>('');
  const [studentSessionLecture, setStudentSessionLecture] = useState<string>('');
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingStudentSession, setCheckingStudentSession] = useState(true);
  const [studentPastRecords, setStudentPastRecords] = useState<AttendanceRecord[]>([]);
  const [studentPastSessions, setStudentPastSessions] = useState<SessionWithDetails[]>([]);
  const [loadingStudentHistory, setLoadingStudentHistory] = useState(false);
  const [checkInSuccess, setCheckInSuccess] = useState(false);

  // -------------------------------------------------------
  // Fetch subjects (shared)
  // -------------------------------------------------------
  const fetchSubjects = useCallback(async () => {
    setLoadingSubjects(true);
    try {
      if (role === 'teacher') {
        const { data, error } = await supabase
          .from('subjects')
          .select('*')
          .eq('teacher_id', profile.id)
          .order('created_at', { ascending: false });
        if (error) console.error('Error fetching subjects:', error);
        else setSubjects((data as Subject[]) || []);
      } else {
        // Student: get enrolled subjects
        const { data: enrollments } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id);

        if (enrollments && enrollments.length > 0) {
          const subjectIds = enrollments.map((e) => e.subject_id);
          const { data, error } = await supabase
            .from('subjects')
            .select('*')
            .in('id', subjectIds)
            .order('created_at', { ascending: false });
          if (error) console.error('Error fetching enrolled subjects:', error);
          else setSubjects((data as Subject[]) || []);
        } else {
          setSubjects([]);
        }
      }
    } catch (err) {
      console.error('Fetch subjects error:', err);
    } finally {
      setLoadingSubjects(false);
    }
  }, [profile.id, role]);

  // -------------------------------------------------------
  // Teacher: Fetch lectures for selected subject
  // -------------------------------------------------------
  const fetchLectures = useCallback(async () => {
    if (!selectedSubjectId) {
      setLectures([]);
      return;
    }
    setLoadingLectures(true);
    try {
      const { data, error } = await supabase
        .from('lectures')
        .select('*')
        .eq('subject_id', selectedSubjectId)
        .order('lecture_date', { ascending: false, nullsFirst: false });
      if (error) console.error('Error fetching lectures:', error);
      else setLectures((data as Lecture[]) || []);
    } catch (err) {
      console.error('Fetch lectures error:', err);
    } finally {
      setLoadingLectures(false);
    }
  }, [selectedSubjectId]);

  // -------------------------------------------------------
  // Teacher: Check for active session
  // -------------------------------------------------------
  const checkActiveSession = useCallback(async () => {
    setCheckingActiveSession(true);
    try {
      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('teacher_id', profile.id)
        .eq('status', 'active')
        .maybeSingle();

      if (error) {
        console.error('Error checking active session:', error);
      } else {
        setActiveSession((data as AttendanceSession) || null);
      }
    } catch (err) {
      console.error('Check active session error:', err);
    } finally {
      setCheckingActiveSession(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Teacher: Fetch enrolled students for a subject
  // -------------------------------------------------------
  const fetchEnrolledStudents = useCallback(async (subjectId: string) => {
    try {
      const { data: enrollments, error: enrollErr } = await supabase
        .from('subject_students')
        .select('student_id')
        .eq('subject_id', subjectId);

      if (enrollErr) {
        console.error('Error fetching enrollments:', enrollErr);
        setEnrolledStudents([]);
      } else if (enrollments && enrollments.length > 0) {
        const studentIds = enrollments.map((e: { student_id: string }) => e.student_id);
        const { data: students, error: studentsErr } = await supabase
          .from('users')
          .select('*')
          .in('id', studentIds);
        if (studentsErr) {
          console.error('Error fetching students:', studentsErr);
          setEnrolledStudents([]);
        } else {
          setEnrolledStudents((students as UserProfile[]) || []);
        }
      } else {
        setEnrolledStudents([]);
      }
    } catch (err) {
      console.error('Fetch enrolled students error:', err);
      setEnrolledStudents([]);
    }
  }, []);

  // -------------------------------------------------------
  // Teacher: Fetch attendance records for active session
  // -------------------------------------------------------
  const fetchAttendanceRecords = useCallback(async () => {
    if (!activeSession) return;
    setLoadingRecords(true);
    try {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', activeSession.id)
        .order('checked_in_at', { ascending: true });

      if (error) {
        console.error('Error fetching attendance records:', error);
      } else {
        const records = (data as AttendanceRecord[]) || [];
        // Enrich with student names
        if (records.length > 0) {
          const studentIds = records.map((r) => r.student_id);
          const { data: students } = await supabase
            .from('users')
            .select('id, name, email, title_id, gender, role')
            .in('id', studentIds);

          const studentMap = new Map(
            (students || []).map((s: { id: string; name: string; email: string; title_id?: string | null; gender?: string | null; role?: string | null }) => [s.id, s])
          );

          const enriched: AttendanceRecordWithStudent[] = records.map((r) => {
            const studentData = studentMap.get(r.student_id);
            return {
              ...r,
              student_name: formatNameWithTitle(
                studentData?.name || 'طالب',
                studentData?.role,
                studentData?.title_id,
                studentData?.gender
              ),
              student_email: studentData?.email || '',
            };
          });
          setAttendanceRecords(enriched);
        } else {
          setAttendanceRecords([]);
        }
      }
    } catch (err) {
      console.error('Fetch attendance records error:', err);
    } finally {
      setLoadingRecords(false);
    }
  }, [activeSession]);

  // -------------------------------------------------------
  // Teacher: Fetch past sessions
  // -------------------------------------------------------
  const fetchPastSessions = useCallback(async () => {
    setLoadingPastSessions(true);
    try {
      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('teacher_id', profile.id)
        .eq('status', 'ended')
        .order('ended_at', { ascending: false });

      if (error) {
        console.error('Error fetching past sessions:', error);
      } else {
        const sessions = (data as AttendanceSession[]) || [];
        // Enrich with subject/lecture names and record counts
        if (sessions.length > 0) {
          const subjectIds = [...new Set(sessions.map((s) => s.subject_id))];
          const lectureIds = [...new Set(sessions.map((s) => s.lecture_id))];

          const [subjectsRes, lecturesRes] = await Promise.all([
            supabase.from('subjects').select('id, name').in('id', subjectIds),
            supabase.from('lectures').select('id, title').in('id', lectureIds),
          ]);

          const subjectMap = new Map(
            ((subjectsRes.data as { id: string; name: string }[]) || []).map((s) => [s.id, s.name])
          );
          const lectureMap = new Map(
            ((lecturesRes.data as { id: string; title: string }[]) || []).map((l) => [l.id, l.title])
          );

          // Fetch record counts
          const sessionIds = sessions.map((s) => s.id);
          const { data: allRecords } = await supabase
            .from('attendance_records')
            .select('session_id')
            .in('session_id', sessionIds);

          const countMap = new Map<string, number>();
          (allRecords || []).forEach((r: { session_id: string }) => {
            countMap.set(r.session_id, (countMap.get(r.session_id) || 0) + 1);
          });

          const enriched: SessionWithDetails[] = sessions.map((s) => ({
            ...s,
            subject_name: subjectMap.get(s.subject_id) || 'مقرر محذوف',
            lecture_title: lectureMap.get(s.lecture_id) || 'محاضرة محذوفة',
            record_count: countMap.get(s.id) || 0,
          }));
          setPastSessions(enriched);
        } else {
          setPastSessions([]);
        }
      }
    } catch (err) {
      console.error('Fetch past sessions error:', err);
    } finally {
      setLoadingPastSessions(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Student: Check for active sessions across enrolled subjects
  // -------------------------------------------------------
  const checkStudentActiveSessions = useCallback(async () => {
    setCheckingStudentSession(true);
    try {
      // Get enrolled subject IDs
      const { data: enrollments } = await supabase
        .from('subject_students')
        .select('subject_id')
        .eq('student_id', profile.id);

      if (!enrollments || enrollments.length === 0) {
        setStudentActiveSession(null);
        setCheckingStudentSession(false);
        return;
      }

      const subjectIds = enrollments.map((e) => e.subject_id);

      // Find any active session in these subjects
      const { data: sessions, error } = await supabase
        .from('attendance_sessions')
        .select('*')
        .in('subject_id', subjectIds)
        .eq('status', 'active');

      if (error) {
        console.error('Error checking student active sessions:', error);
      } else if (sessions && sessions.length > 0) {
        const session = sessions[0] as AttendanceSession;
        setStudentActiveSession(session);

        // Fetch subject and lecture names
        const [subjectRes, lectureRes] = await Promise.all([
          supabase.from('subjects').select('name').eq('id', session.subject_id).single(),
          supabase.from('lectures').select('title').eq('id', session.lecture_id).single(),
        ]);

        setStudentSessionSubject((subjectRes.data as { name: string })?.name || '');
        setStudentSessionLecture((lectureRes.data as { title: string })?.title || '');

        // Check if already checked in
        const { data: existingRecord } = await supabase
          .from('attendance_records')
          .select('id')
          .eq('session_id', session.id)
          .eq('student_id', profile.id)
          .maybeSingle();

        setAlreadyCheckedIn(!!existingRecord);
        setCheckInSuccess(!!existingRecord);
      } else {
        setStudentActiveSession(null);
        setAlreadyCheckedIn(false);
        setCheckInSuccess(false);
      }
    } catch (err) {
      console.error('Check student active sessions error:', err);
    } finally {
      setCheckingStudentSession(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Student: Fetch past attendance history
  // -------------------------------------------------------
  const fetchStudentHistory = useCallback(async () => {
    setLoadingStudentHistory(true);
    try {
      // Get all attendance records for this student
      const { data: records, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('student_id', profile.id)
        .order('checked_in_at', { ascending: false });

      if (error) {
        console.error('Error fetching student attendance history:', error);
      } else {
        const recs = (records as AttendanceRecord[]) || [];
        setStudentPastRecords(recs);

        if (recs.length > 0) {
          // Enrich with session details
          const sessionIds = [...new Set(recs.map((r) => r.session_id))];
          const { data: sessions } = await supabase
            .from('attendance_sessions')
            .select('*')
            .in('id', sessionIds);

          if (sessions && sessions.length > 0) {
            const subjectIds = [...new Set(sessions.map((s) => s.subject_id))];
            const lectureIds = [...new Set(sessions.map((s) => s.lecture_id))];

            const [subjectsRes, lecturesRes] = await Promise.all([
              supabase.from('subjects').select('id, name').in('id', subjectIds),
              supabase.from('lectures').select('id, title').in('id', lectureIds),
            ]);

            const subjectMap = new Map(
              ((subjectsRes.data as { id: string; name: string }[]) || []).map((s) => [s.id, s.name])
            );
            const lectureMap = new Map(
              ((lecturesRes.data as { id: string; title: string }[]) || []).map((l) => [l.id, l.title])
            );

            const enriched: SessionWithDetails[] = (sessions as AttendanceSession[]).map((s) => ({
              ...s,
              subject_name: subjectMap.get(s.subject_id) || 'مقرر محذوف',
              lecture_title: lectureMap.get(s.lecture_id) || 'محاضرة محذوفة',
            }));
            setStudentPastSessions(enriched);
          }
        }
      }
    } catch (err) {
      console.error('Fetch student history error:', err);
    } finally {
      setLoadingStudentHistory(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------
  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  useEffect(() => {
    if (role === 'teacher') {
      checkActiveSession();
      fetchPastSessions();
    } else {
      checkStudentActiveSessions();
      fetchStudentHistory();
    }
  }, [role, checkActiveSession, fetchPastSessions, checkStudentActiveSessions, fetchStudentHistory]);

  useEffect(() => {
    if (selectedSubjectId) {
      fetchLectures();
    }
  }, [selectedSubjectId, fetchLectures]);

  useEffect(() => {
    if (activeSession) {
      fetchAttendanceRecords();
      fetchEnrolledStudents(activeSession.subject_id);
    }
  }, [activeSession, fetchAttendanceRecords, fetchEnrolledStudents]);

  // -------------------------------------------------------
  // Real-time: Teacher - Listen for new attendance records
  // -------------------------------------------------------
  useEffect(() => {
    if (role !== 'teacher' || !activeSession) return;

    const channel = supabase
      .channel(`attendance-records-${activeSession.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_records',
          filter: `session_id=eq.${activeSession.id}`,
        },
        () => {
          fetchAttendanceRecords();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, activeSession, fetchAttendanceRecords]);

  // -------------------------------------------------------
  // Real-time: Student - Listen for new attendance sessions
  // -------------------------------------------------------
  useEffect(() => {
    if (role !== 'student') return;

    const channel = supabase
      .channel('student-attendance-sessions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_sessions',
        },
        () => {
          checkStudentActiveSessions();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'attendance_sessions',
        },
        () => {
          checkStudentActiveSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, checkStudentActiveSessions]);

  // -------------------------------------------------------
  // Teacher: Start attendance session
  // -------------------------------------------------------
  const handleStartSession = async () => {
    if (!selectedSubjectId) {
      toast.error('يرجى اختيار المقرر');
      return;
    }
    if (!selectedLectureId) {
      toast.error('يرجى اختيار المحاضرة');
      return;
    }

    // Check if already has an active session
    if (activeSession) {
      toast.error('لديك جلسة حضور نشطة بالفعل');
      return;
    }

    setStartingSession(true);
    try {
      const { data, error } = await supabase
        .from('attendance_sessions')
        .insert({
          lecture_id: selectedLectureId,
          teacher_id: profile.id,
          subject_id: selectedSubjectId,
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast.error('لديك جلسة حضور نشطة بالفعل');
        } else {
          toast.error('حدث خطأ أثناء بدء جلسة الحضور');
          console.error('Start session error:', error);
        }
      } else {
        toast.success('تم بدء جلسة الحضور بنجاح');
        setActiveSession(data as AttendanceSession);
        // Send notification to all students in the subject
        try {
          const subjectName = subjects.find((s) => s.id === selectedSubjectId)?.name || '';
          const lectureTitle = lectures.find((l) => l.id === selectedLectureId)?.title || '';
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'attendance_started',
              subjectId: selectedSubjectId,
              subjectName,
              lectureTitle,
              teacherName: profile.name,
            }),
          });
        } catch { /* notification failure is non-critical */ }
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setStartingSession(false);
    }
  };

  // -------------------------------------------------------
  // Teacher: Stop attendance session
  // -------------------------------------------------------
  const handleStopSession = async () => {
    if (!activeSession) return;

    setStoppingSession(true);
    try {
      const { error } = await supabase
        .from('attendance_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', activeSession.id);

      if (error) {
        toast.error('حدث خطأ أثناء إنهاء جلسة الحضور');
      } else {
        toast.success('تم إنهاء جلسة الحضور بنجاح');
        setActiveSession(null);
        setAttendanceRecords([]);
        setEnrolledStudents([]);
        fetchPastSessions();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setStoppingSession(false);
    }
  };

  // -------------------------------------------------------
  // Student: Check in
  // -------------------------------------------------------
  const handleCheckIn = async () => {
    if (!studentActiveSession) return;

    setCheckingIn(true);
    try {
      const { error } = await supabase.from('attendance_records').insert({
        session_id: studentActiveSession.id,
        student_id: profile.id,
      });

      if (error) {
        if (error.code === '23505') {
          toast.error('تم تسجيل حضورك بالفعل');
          setAlreadyCheckedIn(true);
          setCheckInSuccess(true);
        } else {
          toast.error('حدث خطأ أثناء تسجيل الحضور');
          console.error('Check-in error:', error);
        }
      } else {
        toast.success('تم تسجيل الحضور بنجاح');
        setAlreadyCheckedIn(true);
        setCheckInSuccess(true);
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setCheckingIn(false);
    }
  };

  // -------------------------------------------------------
  // Teacher: View past session details
  // -------------------------------------------------------
  const handleViewPastSession = async (session: SessionWithDetails) => {
    setSelectedPastSession(session);
    setLoadingPastSessionRecords(true);
    try {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', session.id)
        .order('checked_in_at', { ascending: true });

      if (error) {
        console.error('Error fetching past session records:', error);
        setPastSessionRecords([]);
      } else {
        const records = (data as AttendanceRecord[]) || [];
        if (records.length > 0) {
          const studentIds = records.map((r) => r.student_id);
          const { data: students } = await supabase
            .from('users')
            .select('id, name, email, title_id, gender, role')
            .in('id', studentIds);

          const studentMap = new Map(
            (students || []).map((s: { id: string; name: string; email: string; title_id?: string | null; gender?: string | null; role?: string | null }) => [s.id, s])
          );

          const enriched: AttendanceRecordWithStudent[] = records.map((r) => {
            const studentData = studentMap.get(r.student_id);
            return {
              ...r,
              student_name: formatNameWithTitle(
                studentData?.name || 'طالب',
                studentData?.role,
                studentData?.title_id,
                studentData?.gender
              ),
              student_email: studentData?.email || '',
            };
          });
          setPastSessionRecords(enriched);
        } else {
          setPastSessionRecords([]);
        }
      }
    } catch (err) {
      console.error('Fetch past session records error:', err);
    } finally {
      setLoadingPastSessionRecords(false);
    }
  };

  // -------------------------------------------------------
  // Teacher: Export attendance to Excel
  // -------------------------------------------------------
  const handleExportExcel = async (session: SessionWithDetails, records: AttendanceRecordWithStudent[]) => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Get enrolled students for this subject from the session
      const checkedInIds = new Set(records.map((r) => r.student_id));

      // Sheet 1: Attendance summary
      const summaryData = enrolledStudents.length > 0
        ? enrolledStudents.map((s) => ({
            'اسم الطالب': s.name,
            'البريد الإلكتروني': s.email,
            'حالة الحضور': checkedInIds.has(s.id) ? 'حاضر' : 'غائب',
            'وقت التسجيل': records.find((r) => r.student_id === s.id)
              ? formatDateTime(records.find((r) => r.student_id === s.id)!.checked_in_at)
              : '—',
          }))
        : records.map((r) => ({
            'اسم الطالب': r.student_name || 'طالب',
            'البريد الإلكتروني': r.student_email || '',
            'حالة الحضور': 'حاضر',
            'وقت التسجيل': formatDateTime(r.checked_in_at),
          }));

      const ws1 = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws1, 'سجل الحضور');

      // Sheet 2: Session info
      const infoData = [
        { 'المعلومات': 'المقرر', 'القيمة': session.subject_name || '—' },
        { 'المعلومات': 'المحاضرة', 'القيمة': session.lecture_title || '—' },
        { 'المعلومات': 'بداية الجلسة', 'القيمة': formatDateTime(session.started_at) },
        { 'المعلومات': 'نهاية الجلسة', 'القيمة': session.ended_at ? formatDateTime(session.ended_at) : '—' },
        { 'المعلومات': 'عدد الحاضرين', 'القيمة': records.length },
        { 'المعلومات': 'إجمالي الطلاب', 'القيمة': enrolledStudents.length || records.length },
      ];
      const ws2 = XLSX.utils.json_to_sheet(infoData);
      XLSX.utils.book_append_sheet(wb, ws2, 'معلومات الجلسة');

      const fileName = `حضور_${session.subject_name || 'جلسة'}_${session.lecture_title || ''}_${new Date(session.started_at).toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success('تم تصدير سجل الحضور بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تصدير البيانات');
    }
  };

  // -------------------------------------------------------
  // Teacher: Export active session attendance
  // -------------------------------------------------------
  const handleExportActiveSession = () => {
    if (!activeSession) return;

    const sessionWithDetails: SessionWithDetails = {
      ...activeSession,
      subject_name: subjects.find((s) => s.id === activeSession.subject_id)?.name || '',
      lecture_title: lectures.find((l) => l.id === activeSession.lecture_id)?.title || '',
      record_count: attendanceRecords.length,
    };

    handleExportExcel(sessionWithDetails, attendanceRecords);
  };

  // -------------------------------------------------------
  // Compute: checked-in student IDs set
  // -------------------------------------------------------
  const checkedInStudentIds = new Set(attendanceRecords.map((r) => r.student_id));

  // -------------------------------------------------------
  // Render: Teacher View
  // -------------------------------------------------------
  const renderTeacherView = () => {
    // If viewing a past session detail
    if (selectedPastSession) {
      return renderPastSessionDetail();
    }

    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
        {/* Header */}
        <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">نظام الحضور</h2>
            <p className="text-muted-foreground mt-1">إدارة حضور الطلاب وتسجيلهم</p>
          </div>
        </motion.div>

        {/* Active session check loading */}
        {checkingActiveSession ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : activeSession ? (
          // ─── Active Session Panel ───
          renderActiveSessionPanel()
        ) : (
          // ─── Start New Session ───
          <motion.div variants={itemVariants}>
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-5">
                <Play className="h-5 w-5 text-emerald-600" />
                بدء جلسة حضور جديدة
              </h3>

              <div className="space-y-4">
                {/* Subject selector */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">المقرر</label>
                  <select
                    value={selectedSubjectId}
                    onChange={(e) => {
                      setSelectedSubjectId(e.target.value);
                      setSelectedLectureId('');
                    }}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    dir="rtl"
                  >
                    <option value="">اختر المقرر...</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Lecture selector */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">المحاضرة</label>
                  <select
                    value={selectedLectureId}
                    onChange={(e) => setSelectedLectureId(e.target.value)}
                    disabled={!selectedSubjectId || loadingLectures}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    dir="rtl"
                  >
                    <option value="">
                      {loadingLectures ? 'جارٍ التحميل...' : 'اختر المحاضرة...'}
                    </option>
                    {lectures.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Start button */}
                <button
                  onClick={handleStartSession}
                  disabled={startingSession || !selectedSubjectId || !selectedLectureId}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {startingSession ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جارٍ البدء...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      بدء تسجيل الحضور
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Past Sessions */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-emerald-600" />
                سجل جلسات الحضور السابقة
              </h3>
            </div>
            {loadingPastSessions ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
              </div>
            ) : pastSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 mb-3">
                  <ClipboardCheck className="h-6 w-6 text-emerald-600" />
                </div>
                <p className="text-sm font-medium text-foreground">لا توجد جلسات سابقة</p>
                <p className="text-xs text-muted-foreground mt-1">ستظهر هنا بعد إنهاء جلسات الحضور</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto custom-scrollbar">
                <div className="divide-y">
                  {pastSessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                        <ClipboardCheck className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {session.lecture_title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {session.subject_name} • {formatDateTime(session.started_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2.5 py-0.5 font-bold">
                          {session.record_count} حاضر
                        </span>
                        <button
                          onClick={() => handleViewPastSession(session)}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                          title="عرض التفاصيل"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleExportExcel(session, [])}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                          title="تصدير Excel"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Teacher Active Session Panel
  // -------------------------------------------------------
  const renderActiveSessionPanel = () => {
    const subjectName = subjects.find((s) => s.id === activeSession!.subject_id)?.name || '';
    const lectureTitle = lectures.find((l) => l.id === activeSession!.lecture_id)?.title || '';

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="space-y-4"
      >
        {/* Active session info card */}
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </span>
                <span className="text-sm font-bold text-emerald-700">جلسة حضور نشطة</span>
              </div>
              <h3 className="text-lg font-bold text-foreground">{lectureTitle}</h3>
              <p className="text-sm text-muted-foreground mt-1">{subjectName}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                <Clock className="h-3 w-3" />
                بدأت في: {formatDateTime(activeSession!.started_at)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Live counter */}
              <div className="flex flex-col items-center rounded-xl bg-white border border-emerald-200 px-5 py-3 shadow-sm">
                <span className="text-2xl font-bold text-emerald-700">{attendanceRecords.length}</span>
                <span className="text-xs text-muted-foreground">حاضر من {enrolledStudents.length}</span>
              </div>

              {/* Stop button */}
              <button
                onClick={handleStopSession}
                disabled={stoppingSession}
                className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-rose-700 disabled:opacity-60"
              >
                {stoppingSession ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <StopCircle className="h-4 w-4" />
                )}
                إنهاء الجلسة
              </button>
            </div>
          </div>
        </div>

        {/* Student list */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b p-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-600" />
              قائمة الطلاب
            </h3>
            <button
              onClick={handleExportActiveSession}
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              تصدير Excel
            </button>
          </div>
          {loadingRecords ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
          ) : enrolledStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">لا يوجد طلاب مسجلون في هذا المقرر</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar">
              <div className="divide-y">
                {enrolledStudents.map((student) => {
                  const isCheckedIn = checkedInStudentIds.has(student.id);
                  const record = attendanceRecords.find((r) => r.student_id === student.id);
                  return (
                    <div
                      key={student.id}
                      className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
                    >
                      <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{formatNameWithTitle(student.name, student.role, student.title_id, student.gender)}</p>
                        <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                      </div>
                      <div className="shrink-0">
                        {isCheckedIn ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span className="text-xs font-medium text-emerald-700">حاضر</span>
                            {record && (
                              <span className="text-xs text-muted-foreground">
                                {formatTime(record.checked_in_at)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">لم يسجل بعد</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Teacher Past Session Detail
  // -------------------------------------------------------
  const renderPastSessionDetail = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Back button + header */}
      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <button
          onClick={() => {
            setSelectedPastSession(null);
            setPastSessionRecords([]);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-foreground">{selectedPastSession!.lecture_title}</h2>
          <p className="text-sm text-muted-foreground">{selectedPastSession!.subject_name}</p>
        </div>
      </motion.div>

      {/* Session info */}
      <motion.div variants={itemVariants} className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 overflow-x-auto">
          <div>
            <p className="text-xs text-muted-foreground mb-1">بداية الجلسة</p>
            <p className="text-sm font-medium text-foreground">{formatDateTime(selectedPastSession!.started_at)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">نهاية الجلسة</p>
            <p className="text-sm font-medium text-foreground">
              {selectedPastSession!.ended_at ? formatDateTime(selectedPastSession!.ended_at) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">عدد الحاضرين</p>
            <p className="text-sm font-bold text-emerald-700">{selectedPastSession!.record_count}</p>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => handleExportExcel(selectedPastSession!, pastSessionRecords)}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              تصدير Excel
            </button>
          </div>
        </div>
      </motion.div>

      {/* Records */}
      <motion.div variants={itemVariants} className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-600" />
            سجل الحضور
          </h3>
        </div>
        {loadingPastSessionRecords ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          </div>
        ) : pastSessionRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
              <UserX className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">لم يسجل أي طالب حضوره</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto custom-scrollbar">
            <div className="divide-y">
              {pastSessionRecords.map((record) => (
                <div key={record.id} className="flex items-center gap-3 p-3">
                  <UserAvatar name={record.student_name || 'مستخدم'} avatarUrl={record.student_avatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{record.student_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{record.student_email}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs text-muted-foreground">{formatTime(record.checked_in_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Render: Student View
  // -------------------------------------------------------
  const renderStudentView = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h2 className="text-2xl font-bold text-foreground">الحضور</h2>
        <p className="text-muted-foreground mt-1">تسجيل حضورك ومتابعة سجلاتك</p>
      </motion.div>

      {/* Active session check loading */}
      {checkingStudentSession ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : studentActiveSession ? (
        // ─── Active session - Check in ───
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
              <span className="text-sm font-bold text-emerald-700">جلسة حضور نشطة</span>
            </div>

            <h3 className="text-lg font-bold text-foreground">{studentSessionLecture}</h3>
            <p className="text-sm text-muted-foreground mt-1">{studentSessionSubject}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <Clock className="h-3 w-3" />
              بدأت في: {formatDateTime(studentActiveSession.started_at)}
            </div>

            {/* Check-in area */}
            <div className="mt-6">
              <AnimatePresence mode="wait">
                {checkInSuccess ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex flex-col items-center gap-3 rounded-xl bg-emerald-100 border border-emerald-200 p-6"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
                    >
                      <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                    </motion.div>
                    <p className="text-lg font-bold text-emerald-700">تم تسجيل حضورك بنجاح!</p>
                    <p className="text-sm text-emerald-600/80">
                      {formatDateTime(new Date().toISOString())}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="checkin-button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center gap-3"
                  >
                    <button
                      onClick={handleCheckIn}
                      disabled={checkingIn}
                      className="flex w-full sm:w-auto items-center justify-center gap-3 rounded-xl bg-emerald-600 px-6 sm:px-8 py-4 text-lg font-bold text-white shadow-lg transition-all hover:bg-emerald-700 hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                    >
                      {checkingIn ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          جارٍ التسجيل...
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-5 w-5" />
                          تسجيل الحضور
                        </>
                      )}
                    </button>
                    <p className="text-xs text-muted-foreground">اضغط لتسجيل حضورك في هذه المحاضرة</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      ) : (
        // ─── No active session ───
        <motion.div variants={itemVariants}>
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
              <ClipboardCheck className="h-8 w-8 text-emerald-600" />
            </div>
            <p className="text-lg font-semibold text-foreground mb-1">لا توجد جلسة حضور نشطة</p>
            <p className="text-sm text-muted-foreground">
              سيظهر زر التسجيل عندما يبدأ المعلم جلسة حضور
            </p>
          </div>
        </motion.div>
      )}

      {/* Student attendance history */}
      <motion.div variants={itemVariants}>
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b p-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-600" />
              سجل الحضور السابق
            </h3>
          </div>
          {loadingStudentHistory ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
          ) : studentPastRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
                <Calendar className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">لا يوجد سجل حضور بعد</p>
              <p className="text-xs text-muted-foreground mt-1">سيظهر هنا بعد تسجيل حضورك في المحاضرات</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar">
              <div className="divide-y">
                {studentPastRecords.map((record) => {
                  const sessionInfo = studentPastSessions.find((s) => s.id === record.session_id);
                  return (
                    <div key={record.id} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {sessionInfo?.lecture_title || 'محاضرة'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {sessionInfo?.subject_name || 'مقرر'} • {formatDate(record.checked_in_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs bg-emerald-100 text-emerald-700 rounded-full px-2.5 py-0.5 font-medium">
                        {formatTime(record.checked_in_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <div dir="rtl">
      {role === 'teacher' ? renderTeacherView() : renderStudentView()}
    </div>
  );
}
