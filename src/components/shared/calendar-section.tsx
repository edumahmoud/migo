'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  BookOpen,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Star,
  Vote,
  X,
  ListTodo,
  Plus,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type {
  CalendarEvent,
  CalendarEventType,
  UserProfile,
  UserTodo,
} from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogScrollArea,
} from '@/components/ui/dialog';

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

const cellVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
};

const slideUpVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
  exit: { opacity: 0, y: 40, transition: { duration: 0.2 } },
};

// -------------------------------------------------------
// Event type configuration (color + icon mapping)
// -------------------------------------------------------
interface EventTypeConfig {
  dotClass: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  icon: CalendarEventType;
}

const eventTypeConfig: Record<CalendarEventType, EventTypeConfig> = {
  lecture: {
    dotClass: 'bg-sky-500',
    bgClass: 'bg-sky-100 dark:bg-sky-900/40',
    textClass: 'text-sky-700 dark:text-sky-300',
    borderClass: 'border-sky-200 dark:border-sky-800',
    icon: 'lecture',
  },
  quiz: {
    dotClass: 'bg-rose-500',
    bgClass: 'bg-rose-100 dark:bg-rose-900/40',
    textClass: 'text-rose-700 dark:text-rose-300',
    borderClass: 'border-rose-200 dark:border-rose-800',
    icon: 'quiz',
  },
  assignment: {
    dotClass: 'bg-amber-500',
    bgClass: 'bg-amber-100 dark:bg-amber-900/40',
    textClass: 'text-amber-700 dark:text-amber-300',
    borderClass: 'border-amber-200 dark:border-amber-800',
    icon: 'assignment',
  },
  todo: {
    dotClass: 'bg-emerald-500',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/40',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    icon: 'todo',
  },
  poll: {
    dotClass: 'bg-violet-500',
    bgClass: 'bg-violet-100 dark:bg-violet-900/40',
    textClass: 'text-violet-700 dark:text-violet-300',
    borderClass: 'border-violet-200 dark:border-violet-800',
    icon: 'poll',
  },
  attendance: {
    dotClass: 'bg-teal-500',
    bgClass: 'bg-teal-100 dark:bg-teal-900/40',
    textClass: 'text-teal-700 dark:text-teal-300',
    borderClass: 'border-teal-200 dark:border-teal-800',
    icon: 'attendance',
  },
};

// -------------------------------------------------------
// Icon renderer per event type
// -------------------------------------------------------
function EventIcon({ type, className }: { type: CalendarEventType; className?: string }) {
  const cls = className || 'h-4 w-4';
  switch (type) {
    case 'lecture':
      return <BookOpen className={cls} />;
    case 'quiz':
      return <Star className={cls} />;
    case 'assignment':
      return <FileText className={cls} />;
    case 'todo':
      return <ListTodo className={cls} />;
    case 'poll':
      return <Vote className={cls} />;
    case 'attendance':
      return <CheckCircle2 className={cls} />;
    default:
      return <CalendarIcon className={cls} />;
  }
}

// -------------------------------------------------------
// View mode type
// -------------------------------------------------------
type ViewMode = 'month' | 'week';

// -------------------------------------------------------
// Helper: format date key YYYY-MM-DD
// -------------------------------------------------------
function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// -------------------------------------------------------
// Helper: extract time from ISO datetime or HH:mm string
// -------------------------------------------------------
function formatEventTime(time: string | null | undefined, locale: string): string | null {
  if (!time) return null;
  try {
    // If it's a full ISO datetime
    if (time.includes('T') || time.includes('Z')) {
      const d = new Date(time);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString(locale === 'en' ? 'en-US' : 'ar-SA', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
      }
    }
    // If it's HH:mm format
    if (/^\d{2}:\d{2}/.test(time)) {
      const [h, m] = time.split(':').map(Number);
      if (h !== undefined && m !== undefined) {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        return d.toLocaleTimeString(locale === 'en' ? 'en-US' : 'ar-SA', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
      }
    }
    return time;
  } catch {
    return time;
  }
}

// -------------------------------------------------------
// Helper: get day names for the calendar header
// Uses Intl.DateTimeFormat with locale
// -------------------------------------------------------
function getWeekDayNames(locale: string, weekStartsOn: number): string[] {
  const localeStr = locale === 'en' ? 'en-US' : 'ar-SA';
  const baseDate = new Date(2023, 0, 1); // Sunday, Jan 1 2023
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dayIndex = (weekStartsOn + i) % 7;
    // Jan 1, 2023 is a Sunday (day 0)
    const date = new Date(2023, 0, 1 + dayIndex);
    names.push(
      date.toLocaleDateString(localeStr, { weekday: 'short' })
    );
  }
  return names;
}

// -------------------------------------------------------
// Helper: get month name
// -------------------------------------------------------
function getMonthName(year: number, month: number, locale: string): string {
  const localeStr = locale === 'en' ? 'en-US' : 'ar-SA';
  return new Date(year, month).toLocaleDateString(localeStr, { month: 'long', year: 'numeric' });
}

// -------------------------------------------------------
// Helper: get days in month
// -------------------------------------------------------
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// -------------------------------------------------------
// Helper: get first day of month (0=Sun, 6=Sat)
// -------------------------------------------------------
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function CalendarSection({ profile }: { profile: UserProfile }) {
  const { t, direction, locale } = useTranslations();
  const isRTL = direction === 'rtl';

  // ─── Calendar navigation state ───
  const today = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  // ─── Selected day for detail panel ───
  const [selectedDate, setSelectedDate] = useState<string | null>(toDateString(today));
  const [detailOpen, setDetailOpen] = useState(false);

  // ─── Event filter state ───
  const [activeFilters, setActiveFilters] = useState<Set<CalendarEventType>>(
    new Set(['lecture', 'quiz', 'assignment', 'todo', 'poll', 'attendance'])
  );

  // ─── Data state ───
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Determine week start day based on locale ───
  // Arabic: Saturday (6), English: Sunday (0)
  const weekStartsOn = isRTL ? 6 : 0;

  // ─── Week day names ───
  const weekDayNames = useMemo(
    () => getWeekDayNames(locale, weekStartsOn),
    [locale, weekStartsOn]
  );

  // -------------------------------------------------------
  // Fetch all events from multiple sources
  // -------------------------------------------------------
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const allEvents: CalendarEvent[] = [];

      // 1. Fetch user's todos
      const { data: todos, error: todosError } = await supabase
        .from('user_todos')
        .select('*')
        .eq('user_id', profile.id);

      if (todosError) console.error('Error fetching todos:', todosError);

      if (todos && todos.length > 0) {
        for (const todo of todos) {
          if (todo.due_date) {
            const dueDate = new Date(todo.due_date);
            const dateKey = toDateString(dueDate);
            allEvents.push({
              id: `todo-${todo.id}`,
              type: 'todo',
              title: todo.title || '',
              description: todo.description || null,
              date: dateKey,
              time: todo.due_date || null,
              subject_id: todo.subject_id || null,
              subject_name: todo.subject_name || null,
              color: 'emerald',
              icon: 'ListTodo',
              completed: todo.completed || false,
              meta: { priority: todo.priority, category: todo.category },
            });
          }
        }
      }

      // 2. Get user's subject IDs (enrolled + teaching)
      const subjectIdsSet = new Set<string>();

      // For students: enrolled subjects
      if (profile.role === 'student') {
        const { data: enrollments } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id);

        if (enrollments) {
          for (const e of enrollments) {
            subjectIdsSet.add(e.subject_id);
          }
        }
      }

      // For teachers: owned subjects
      if (profile.role === 'teacher' || profile.role === 'admin' || profile.role === 'superadmin') {
        const { data: owned } = await supabase
          .from('subjects')
          .select('id')
          .eq('teacher_id', profile.id);

        if (owned) {
          for (const s of owned) {
            subjectIdsSet.add(s.id);
          }
        }

        // Also check co-teacher subjects
        const { data: coTeaching } = await supabase
          .from('subject_teachers')
          .select('subject_id')
          .eq('teacher_id', profile.id);

        if (coTeaching) {
          for (const ct of coTeaching) {
            subjectIdsSet.add(ct.subject_id);
          }
        }
      }

      // Students should also get subjects they're enrolled in even if role check was done
      if (profile.role !== 'student') {
        const { data: enrollments } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id);

        if (enrollments) {
          for (const e of enrollments) {
            subjectIdsSet.add(e.subject_id);
          }
        }
      }

      const subjectIds = Array.from(subjectIdsSet);

      // Fetch subject names map
      const subjectNameMap: Record<string, string> = {};
      if (subjectIds.length > 0) {
        const { data: subjects } = await supabase
          .from('subjects')
          .select('id, name')
          .in('id', subjectIds);

        if (subjects) {
          for (const s of subjects) {
            subjectNameMap[s.id] = s.name;
          }
        }
      }

      if (subjectIds.length > 0) {
        // 3. Fetch lectures
        const { data: lectures, error: lecturesError } = await supabase
          .from('lectures')
          .select('*')
          .in('subject_id', subjectIds);

        if (lecturesError) console.error('Error fetching lectures:', lecturesError);

        if (lectures && lectures.length > 0) {
          for (const lec of lectures) {
            if (lec.lecture_date) {
              const lecDate = new Date(lec.lecture_date);
              const dateKey = toDateString(lecDate);
              allEvents.push({
                id: `lecture-${lec.id}`,
                type: 'lecture',
                title: lec.title || '',
                description: lec.description || null,
                date: dateKey,
                time: null,
                subject_id: lec.subject_id || null,
                subject_name: lec.subject_id ? subjectNameMap[lec.subject_id] || null : null,
                color: 'sky',
                icon: 'BookOpen',
                completed: false,
                meta: { lecture_id: lec.id },
              });
            }
          }
        }

        // 4. Fetch assignments
        const { data: assignments, error: assignmentsError } = await supabase
          .from('assignments')
          .select('*')
          .in('subject_id', subjectIds);

        if (assignmentsError) console.error('Error fetching assignments:', assignmentsError);

        if (assignments && assignments.length > 0) {
          for (const asg of assignments) {
            if (asg.due_date) {
              const dueDate = new Date(asg.due_date);
              const dateKey = toDateString(dueDate);
              allEvents.push({
                id: `assignment-${asg.id}`,
                type: 'assignment',
                title: asg.title || '',
                description: asg.description || null,
                date: dateKey,
                time: asg.due_date || null,
                subject_id: asg.subject_id || null,
                subject_name: asg.subject_id ? subjectNameMap[asg.subject_id] || null : null,
                color: 'amber',
                icon: 'FileText',
                completed: false,
                meta: { assignment_id: asg.id, max_score: asg.max_score },
              });
            }
          }
        }

        // 5. Fetch quizzes
        const { data: quizzes, error: quizzesError } = await supabase
          .from('quizzes')
          .select('*')
          .in('subject_id', subjectIds);

        if (quizzesError) console.error('Error fetching quizzes:', quizzesError);

        if (quizzes && quizzes.length > 0) {
          for (const q of quizzes) {
            if (q.scheduled_date) {
              const qDate = new Date(q.scheduled_date);
              const dateKey = toDateString(qDate);
              allEvents.push({
                id: `quiz-${q.id}`,
                type: 'quiz',
                title: q.title || '',
                description: null,
                date: dateKey,
                time: q.scheduled_time || null,
                subject_id: q.subject_id || null,
                subject_name: q.subject_id ? subjectNameMap[q.subject_id] || null : null,
                color: 'rose',
                icon: 'Star',
                completed: q.is_finished || false,
                meta: { quiz_id: q.id, duration: q.duration },
              });
            }
          }
        }

        // 6. Fetch active polls
        const { data: polls, error: pollsError } = await supabase
          .from('polls')
          .select('*')
          .in('subject_id', subjectIds)
          .eq('status', 'active');

        if (pollsError) console.error('Error fetching polls:', pollsError);

        if (polls && polls.length > 0) {
          for (const poll of polls) {
            if (poll.closes_at) {
              const closeDate = new Date(poll.closes_at);
              const dateKey = toDateString(closeDate);
              allEvents.push({
                id: `poll-${poll.id}`,
                type: 'poll',
                title: poll.question || '',
                description: poll.description || null,
                date: dateKey,
                time: poll.closes_at || null,
                subject_id: poll.subject_id || null,
                subject_name: poll.subject_id ? subjectNameMap[poll.subject_id] || null : null,
                color: 'violet',
                icon: 'Vote',
                completed: false,
                meta: { poll_id: poll.id, poll_type: poll.type },
              });
            }
          }
        }

        // 7. Fetch active attendance sessions
        const { data: sessions, error: sessionsError } = await supabase
          .from('attendance_sessions')
          .select('*')
          .in('subject_id', subjectIds)
          .eq('status', 'active');

        if (sessionsError) console.error('Error fetching attendance sessions:', sessionsError);

        if (sessions && sessions.length > 0) {
          for (const session of sessions) {
            if (session.started_at) {
              const startDate = new Date(session.started_at);
              const dateKey = toDateString(startDate);
              allEvents.push({
                id: `attendance-${session.id}`,
                type: 'attendance',
                title: session.subject_id ? subjectNameMap[session.subject_id] || '' : '',
                description: null,
                date: dateKey,
                time: session.started_at || null,
                subject_id: session.subject_id || null,
                subject_name: session.subject_id ? subjectNameMap[session.subject_id] || null : null,
                color: 'teal',
                icon: 'CheckCircle2',
                completed: session.status === 'ended',
                meta: { session_id: session.id },
              });
            }
          }
        }
      }

      setEvents(allEvents);
    } catch (err) {
      console.error('Error fetching calendar events:', err);
      setError(t('calendar.failedToLoad'));
      toast.error(t('calendar.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [profile.id, profile.role, t]);

  // -------------------------------------------------------
  // Initial load
  // -------------------------------------------------------
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // -------------------------------------------------------
  // Group events by date
  // -------------------------------------------------------
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of events) {
      if (!activeFilters.has(event.type)) continue;
      if (!map[event.date]) {
        map[event.date] = [];
      }
      map[event.date].push(event);
    }
    // Sort events within each day by time
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        // All-day events (no time) go first
        if (!a.time && b.time) return -1;
        if (a.time && !b.time) return 1;
        if (!a.time && !b.time) return 0;
        // Compare times (both are non-null here due to guards above)
        const aTime = a.time as string;
        const bTime = b.time as string;
        const timeA = aTime.includes('T') ? new Date(aTime).getTime() : parseTimeToMinutes(aTime);
        const timeB = bTime.includes('T') ? new Date(bTime).getTime() : parseTimeToMinutes(bTime);
        return timeA - timeB;
      });
    }
    return map;
  }, [events, activeFilters]);

  // -------------------------------------------------------
  // Helper: parse HH:mm to minutes
  // -------------------------------------------------------
  function parseTimeToMinutes(time: string): number {
    try {
      if (/^\d{2}:\d{2}/.test(time)) {
        const [h, m] = time.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      }
      return new Date(time).getTime();
    } catch {
      return 0;
    }
  }

  // -------------------------------------------------------
  // Calendar grid computation (month view)
  // -------------------------------------------------------
  const monthGrid = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const offset = (firstDay - weekStartsOn + 7) % 7;
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

    const cells: { date: string; day: number; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

    for (let i = offset - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const date = new Date(prevYear, prevMonth, day);
      cells.push({
        date: toDateString(date),
        day,
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(currentYear, currentMonth, d);
      cells.push({
        date: toDateString(date),
        day: d,
        isCurrentMonth: true,
      });
    }

    // Next month padding
    const remaining = totalCells - cells.length;
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(nextYear, nextMonth, d);
      cells.push({
        date: toDateString(date),
        day: d,
        isCurrentMonth: false,
      });
    }

    return cells;
  }, [currentYear, currentMonth, weekStartsOn]);

  // -------------------------------------------------------
  // Week view computation
  // -------------------------------------------------------
  const weekDays = useMemo(() => {
    const referenceDate = selectedDate ? new Date(selectedDate + 'T00:00:00') : today;
    const dayOfWeek = referenceDate.getDay();
    const diff = (dayOfWeek - weekStartsOn + 7) % 7;
    const startOfWeek = new Date(referenceDate);
    startOfWeek.setDate(referenceDate.getDate() - diff);

    const days: { date: string; day: number; dayName: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      days.push({
        date: toDateString(d),
        day: d.getDate(),
        dayName: d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-SA', { weekday: 'short' }),
      });
    }
    return days;
  }, [selectedDate, today, weekStartsOn, locale]);

  // -------------------------------------------------------
  // Selected day events
  // -------------------------------------------------------
  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return eventsByDate[selectedDate] || [];
  }, [selectedDate, eventsByDate]);

  // -------------------------------------------------------
  // Navigation handlers
  // -------------------------------------------------------
  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDate(toDateString(now));
  };

  // -------------------------------------------------------
  // Filter toggle
  // -------------------------------------------------------
  const toggleFilter = (type: CalendarEventType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const showAllFilters = () => {
    setActiveFilters(new Set(['lecture', 'quiz', 'assignment', 'todo', 'poll', 'attendance']));
  };

  const hideAllFilters = () => {
    setActiveFilters(new Set());
  };

  // -------------------------------------------------------
  // Day click handler
  // -------------------------------------------------------
  const handleDayClick = (dateStr: string) => {
    setSelectedDate(dateStr);
    setDetailOpen(true);
  };

  // -------------------------------------------------------
  // Check if a date is in the past
  // -------------------------------------------------------
  const isDatePast = (dateStr: string): boolean => {
    const todayStr = toDateString(today);
    return dateStr < todayStr;
  };

  const isDateToday = (dateStr: string): boolean => {
    return dateStr === toDateString(today);
  };

  // -------------------------------------------------------
  // Render: Event type filter chips
  // -------------------------------------------------------
  const renderFilters = () => {
    const filterTypes: { type: CalendarEventType; label: string }[] = [
      { type: 'lecture', label: t('calendar.lectures') },
      { type: 'quiz', label: t('calendar.quizzes') },
      { type: 'assignment', label: t('calendar.assignments') },
      { type: 'todo', label: t('calendar.todos') },
      { type: 'poll', label: t('calendar.polls') },
      { type: 'attendance', label: t('calendar.attendance') },
    ];

    return (
      <div className="flex flex-wrap items-center gap-2">
        {filterTypes.map((ft) => {
          const config = eventTypeConfig[ft.type];
          const isActive = activeFilters.has(ft.type);
          return (
            <button
              key={ft.type}
              onClick={() => toggleFilter(ft.type)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? `${config.bgClass} ${config.textClass} ring-1 ${config.borderClass}`
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
              aria-pressed={isActive}
            >
              <span className={`h-2 w-2 rounded-full ${isActive ? config.dotClass : 'bg-muted-foreground/30'}`} />
              {ft.label}
            </button>
          );
        })}
        <div className="flex gap-1 ms-2">
          <button
            onClick={showAllFilters}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('calendar.showAll')}
          </button>
          <span className="text-muted-foreground/50">|</span>
          <button
            onClick={hideAllFilters}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('calendar.hideAll')}
          </button>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Month view calendar grid
  // -------------------------------------------------------
  const renderMonthView = () => {
    const weeks: typeof monthGrid[] = [];
    for (let i = 0; i < monthGrid.length; i += 7) {
      weeks.push(monthGrid.slice(i, i + 7));
    }

    return (
      <div className="space-y-0">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-0 mb-1">
          {weekDayNames.map((name, i) => (
            <div
              key={i}
              className="py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {name}
            </div>
          ))}
        </div>

        {/* Day cells */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0">
            {week.map((cell) => {
              const dayEvents = eventsByDate[cell.date] || [];
              const isPast = isDatePast(cell.date);
              const isToday = isDateToday(cell.date);
              const isSelected = selectedDate === cell.date;
              const hasEvents = dayEvents.length > 0;

              // Get unique event types for dot display (max 3 dots)
              const uniqueTypes = [...new Set(dayEvents.map((e) => e.type))].slice(0, 3);

              // Check if all events are completed
              const allCompleted = dayEvents.length > 0 && dayEvents.every((e) => e.completed);

              return (
                <motion.button
                  key={cell.date}
                  variants={cellVariants}
                  onClick={() => handleDayClick(cell.date)}
                  className={`relative flex flex-col items-center justify-center min-h-[44px] sm:min-h-[56px] py-1.5 px-0.5 transition-all rounded-lg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                    !cell.isCurrentMonth
                      ? 'text-muted-foreground/40'
                      : isPast && !isToday
                        ? allCompleted
                          ? 'text-muted-foreground/60'
                          : 'text-muted-foreground/80'
                        : 'text-foreground'
                  } ${
                    isToday
                      ? 'bg-sky-50 dark:bg-sky-900/20 font-bold text-sky-700 dark:text-sky-300'
                      : ''
                  } ${
                    isSelected && !isToday
                      ? 'bg-muted/80 ring-1 ring-sky-400/50'
                      : ''
                  } ${
                    !isToday && !isSelected ? 'hover:bg-muted/40' : ''
                  }`}
                  aria-label={`${cell.day} - ${dayEvents.length} ${t('calendar.eventCount', { count: dayEvents.length })}`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  <span className={`text-xs sm:text-sm leading-none ${isToday ? 'font-bold' : ''}`}>
                    {cell.day}
                  </span>

                  {/* Event dots */}
                  {hasEvents && cell.isCurrentMonth && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {uniqueTypes.map((type) => (
                        <span
                          key={type}
                          className={`h-1.5 w-1.5 rounded-full ${eventTypeConfig[type].dotClass} ${
                            isPast && !isToday ? 'opacity-40' : ''
                          }`}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[8px] text-muted-foreground ms-0.5">
                          +{dayEvents.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Completed indicator for past days */}
                  {isPast && allCompleted && cell.isCurrentMonth && (
                    <CheckCircle2 className="absolute top-0.5 end-0.5 h-2.5 w-2.5 text-emerald-500/60" />
                  )}

                  {/* Today indicator */}
                  {isToday && (
                    <span className="absolute bottom-0.5 h-0.5 w-4 rounded-full bg-sky-600 dark:bg-sky-400" />
                  )}
                </motion.button>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Week view
  // -------------------------------------------------------
  const renderWeekView = () => (
    <div className="space-y-2">
      {weekDays.map((day) => {
        const dayEvents = eventsByDate[day.date] || [];
        const isPast = isDatePast(day.date);
        const isToday = isDateToday(day.date);
        const isSelected = selectedDate === day.date;

        return (
          <motion.div
            key={day.date}
            variants={itemVariants}
            onClick={() => {
              setSelectedDate(day.date);
              setDetailOpen(true);
            }}
            className={`rounded-xl border p-3 cursor-pointer transition-all hover:shadow-sm ${
              isToday
                ? 'border-sky-300 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20'
                : isSelected
                  ? 'border-sky-200 dark:border-sky-900 bg-muted/30'
                  : 'border-border/50 bg-card hover:border-border'
            } ${isPast ? 'opacity-70' : ''}`}
          >
            {/* Day header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${isToday ? 'text-sky-700 dark:text-sky-300' : 'text-foreground'}`}>
                  {day.dayName}
                </span>
                <span className={`text-xs ${isToday ? 'text-sky-600 dark:text-sky-400 font-medium' : 'text-muted-foreground'}`}>
                  {day.date}
                </span>
                {isToday && (
                  <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    {t('calendar.today')}
                  </span>
                )}
              </div>
              {dayEvents.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {dayEvents.length}
                </span>
              )}
            </div>

            {/* Events */}
            {dayEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-2 text-center">
                {t('calendar.noEvents')}
              </p>
            ) : (
              <div className="space-y-1.5">
                {dayEvents.slice(0, 4).map((event) => {
                  const config = eventTypeConfig[event.type];
                  return (
                    <div
                      key={event.id}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${config.bgClass} ${event.completed ? 'opacity-50' : ''}`}
                    >
                      <EventIcon type={event.type} className={`h-3.5 w-3.5 ${config.textClass}`} />
                      <span className={`text-xs font-medium ${config.textClass} truncate flex-1`}>
                        {event.title}
                      </span>
                      {event.time && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatEventTime(event.time, locale)}
                        </span>
                      )}
                      {event.completed && (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                      )}
                    </div>
                  );
                })}
                {dayEvents.length > 4 && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    +{dayEvents.length - 4} {t('calendar.more') || ''}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );

  // -------------------------------------------------------
  // Render: Day detail panel content
  // -------------------------------------------------------
  const renderDayDetail = () => {
    if (!selectedDate) return null;

    const dateObj = new Date(selectedDate + 'T00:00:00');
    const localeStr = locale === 'en' ? 'en-US' : 'ar-SA';
    const formattedDate = dateObj.toLocaleDateString(localeStr, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return (
      <div className="space-y-3" dir={direction}>
        {/* Date header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground">
              {formattedDate}
            </h3>
            {isDateToday(selectedDate) && (
              <span className="text-xs text-sky-600 dark:text-sky-400 font-medium">
                {t('calendar.today')}
              </span>
            )}
          </div>
          <button
            onClick={() => setDetailOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Events list */}
        {selectedDayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10">
            <CalendarIcon className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {t('calendar.noEventsForDay')}
            </p>
          </div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar"
          >
            {selectedDayEvents.map((event) => {
              const config = eventTypeConfig[event.type];
              const isPast = isDatePast(selectedDate) && !isDateToday(selectedDate);
              const eventTime = formatEventTime(event.time, locale);

              return (
                <motion.div
                  key={event.id}
                  variants={itemVariants}
                  className={`flex items-start gap-3 rounded-xl border p-3 transition-all ${
                    config.borderClass
                  } ${config.bgClass} ${
                    event.completed || (isPast && event.type !== 'todo')
                      ? 'opacity-60'
                      : ''
                  }`}
                >
                  {/* Icon */}
                  <div className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg ${config.bgClass} ${config.textClass}`}>
                    <EventIcon type={event.type} className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${config.textClass} ${event.completed ? 'line-through' : ''}`}>
                        {event.title}
                      </p>
                      {event.completed && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {eventTime && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {eventTime}
                        </span>
                      )}
                      {!eventTime && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {t('calendar.allDay')}
                        </span>
                      )}
                      {event.subject_name && (
                        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">
                          {event.subject_name}
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    {event.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {event.description}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------
  // Compute event counts for the current visible period
  // -------------------------------------------------------
  const currentMonthEventCount = useMemo(() => {
    let count = 0;
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateString(new Date(currentYear, currentMonth, d));
      count += (eventsByDate[dateStr] || []).length;
    }
    return count;
  }, [currentYear, currentMonth, eventsByDate]);

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-4"
      dir={direction}
    >
      {/* ─── Header ─── */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
            <CalendarIcon className="h-5 w-5 text-sky-700 dark:text-sky-300" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              {t('calendar.title')}
              <span className="inline-flex items-center justify-center rounded-full bg-sky-700 dark:bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">
                {currentMonthEventCount}
              </span>
            </h2>
          </div>
        </div>

        {/* Refresh */}
        <button
          onClick={fetchEvents}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('calendar.refresh')}
        </button>
      </motion.div>

      {/* ─── Event type filters ─── */}
      <motion.div variants={itemVariants}>
        {renderFilters()}
      </motion.div>

      {/* ─── Navigation bar ─── */}
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-2">
        {/* Prev/Next + Month name */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={t('calendar.prevMonth')}
          >
            {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          <h3 className="text-sm sm:text-base font-semibold text-foreground min-w-[140px] text-center">
            {getMonthName(currentYear, currentMonth, locale)}
          </h3>

          <button
            onClick={goToNextMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={t('calendar.nextMonth')}
          >
            {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        {/* Today + View mode toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {t('calendar.today')}
          </button>

          <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
            <button
              onClick={() => setViewMode('month')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                viewMode === 'month'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('calendar.month')}
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                viewMode === 'week'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('calendar.week')}
            </button>
          </div>
        </div>
      </motion.div>

      {/* ─── Calendar content ─── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/30">
          <AlertTriangle className="h-10 w-10 text-rose-500 mb-3" />
          <p className="text-sm text-rose-700 dark:text-rose-300 font-medium">{error}</p>
          <button
            onClick={fetchEvents}
            className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700 transition-colors"
          >
            {t('calendar.refresh')}
          </button>
        </div>
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          {viewMode === 'month' ? renderMonthView() : renderWeekView()}
        </motion.div>
      )}

      {/* ─── Day detail panel (dialog on mobile, side panel on desktop) ─── */}
      {/* On mobile: Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              {t('calendar.dayEvents')}
            </DialogTitle>
          </DialogHeader>
          <DialogScrollArea>
            {renderDayDetail()}
          </DialogScrollArea>
        </DialogContent>
      </Dialog>

      {/* ─── Desktop side panel (visible when a day is selected) ─── */}
      {selectedDate && selectedDayEvents.length > 0 && (
        <motion.div
          variants={slideUpVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="hidden lg:block rounded-xl border bg-card p-4 shadow-sm mt-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <CalendarIcon className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('calendar.dayEvents')}
            </h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {selectedDayEvents.length}
            </span>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
            {selectedDayEvents.map((event) => {
              const config = eventTypeConfig[event.type];
              const eventTime = formatEventTime(event.time, locale);

              return (
                <div
                  key={event.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${config.borderClass} ${config.bgClass} ${
                    event.completed ? 'opacity-50' : ''
                  }`}
                >
                  <EventIcon type={event.type} className={`h-4 w-4 shrink-0 ${config.textClass}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-medium ${config.textClass} truncate ${event.completed ? 'line-through' : ''}`}>
                      {event.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {eventTime ? (
                        <span className="text-[10px] text-muted-foreground">{eventTime}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">{t('calendar.allDay')}</span>
                      )}
                      {event.subject_name && (
                        <span className="text-[10px] text-muted-foreground">· {event.subject_name}</span>
                      )}
                    </div>
                  </div>
                  {event.completed && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
