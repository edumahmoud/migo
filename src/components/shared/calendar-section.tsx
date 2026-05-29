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
  Circle,
  Star,
  Vote,
  X,
  ListTodo,
  Loader2,
  RefreshCw,
  LayoutGrid,
  List,
  AlertCircle,
  MinusCircle,
  ArrowDownCircle,
  BookMarked,
  ClipboardList,
  User,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type {
  CalendarEvent,
  CalendarEventType,
  UserProfile,
  TodoPriority,
  TodoCategory,
} from '@/lib/types';

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

const cellVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.15 } },
};

// -------------------------------------------------------
// Event type configuration
// -------------------------------------------------------
interface EventTypeConfig {
  dotClass: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  pillClass: string;
}

const eventTypeConfig: Record<CalendarEventType, EventTypeConfig> = {
  lecture: {
    dotClass: 'bg-sky-500',
    bgClass: 'bg-sky-100 dark:bg-sky-800/30',
    textClass: 'text-sky-700 dark:text-sky-400',
    borderClass: 'border-sky-200 dark:border-sky-900/60',
    pillClass: 'bg-sky-500',
  },
  quiz: {
    dotClass: 'bg-rose-500',
    bgClass: 'bg-rose-100 dark:bg-rose-800/30',
    textClass: 'text-rose-700 dark:text-rose-500',
    borderClass: 'border-rose-200 dark:border-rose-900/60',
    pillClass: 'bg-rose-500',
  },
  assignment: {
    dotClass: 'bg-amber-500',
    bgClass: 'bg-amber-100 dark:bg-amber-800/30',
    textClass: 'text-amber-700 dark:text-amber-500',
    borderClass: 'border-amber-200 dark:border-amber-900/60',
    pillClass: 'bg-amber-500',
  },
  todo: {
    dotClass: 'bg-emerald-500',
    bgClass: 'bg-emerald-100 dark:bg-emerald-800/30',
    textClass: 'text-emerald-700 dark:text-emerald-500',
    borderClass: 'border-emerald-200 dark:border-emerald-900/60',
    pillClass: 'bg-emerald-500',
  },
  poll: {
    dotClass: 'bg-violet-500',
    bgClass: 'bg-violet-100 dark:bg-violet-800/30',
    textClass: 'text-violet-700 dark:text-violet-500',
    borderClass: 'border-violet-200 dark:border-violet-900/60',
    pillClass: 'bg-violet-500',
  },
  attendance: {
    dotClass: 'bg-teal-500',
    bgClass: 'bg-teal-100 dark:bg-teal-800/30',
    textClass: 'text-teal-700 dark:text-teal-500',
    borderClass: 'border-teal-200 dark:border-teal-900/60',
    pillClass: 'bg-teal-500',
  },
};

// -------------------------------------------------------
// Todo priority badge helpers
// -------------------------------------------------------
const priorityConfig: Record<TodoPriority, { icon: typeof AlertCircle; className: string; label: string }> = {
  urgent: { icon: AlertCircle, className: 'text-red-600 dark:text-red-500 bg-red-100 dark:bg-red-800/30', label: '🔴' },
  medium: { icon: MinusCircle, className: 'text-amber-600 dark:text-amber-500 bg-amber-100 dark:bg-amber-800/30', label: '🟡' },
  low: { icon: ArrowDownCircle, className: 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-800/30', label: '🔵' },
};

const categoryConfig: Record<TodoCategory, { icon: typeof BookMarked; className: string }> = {
  study: { icon: BookMarked, className: 'text-purple-600 dark:text-purple-400' },
  assignment: { icon: FileText, className: 'text-amber-600 dark:text-amber-500' },
  review: { icon: ClipboardList, className: 'text-teal-600 dark:text-teal-500' },
  personal: { icon: User, className: 'text-gray-600 dark:text-gray-500' },
};

// -------------------------------------------------------
// Icon renderer per event type
// -------------------------------------------------------
function EventIcon({ type, className }: { type: CalendarEventType; className?: string }) {
  const cls = className || 'h-4 w-4';
  switch (type) {
    case 'lecture': return <BookOpen className={cls} />;
    case 'quiz': return <Star className={cls} />;
    case 'assignment': return <FileText className={cls} />;
    case 'todo': return <ListTodo className={cls} />;
    case 'poll': return <Vote className={cls} />;
    case 'attendance': return <CheckCircle2 className={cls} />;
    default: return <CalendarIcon className={cls} />;
  }
}

// -------------------------------------------------------
// View mode type
// -------------------------------------------------------
type ViewMode = 'month' | 'week';

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a date-only string (YYYY-MM-DD) safely as local time.
 * Avoids the UTC midnight bug where `new Date("2025-03-15")` is parsed as UTC
 * and can shift to the previous day in negative-UTC-offset timezones.
 */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatEventTime(time: string | null | undefined, locale: string): string | null {
  if (!time) return null;
  try {
    if (time.includes('T') || time.includes('Z')) {
      const d = new Date(time);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString(locale === 'en' ? 'en-US' : 'ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true });
      }
    }
    if (/^\d{2}:\d{2}/.test(time)) {
      const [h, m] = time.split(':').map(Number);
      if (h !== undefined && m !== undefined) {
        const d = new Date(); d.setHours(h, m, 0, 0);
        return d.toLocaleTimeString(locale === 'en' ? 'en-US' : 'ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true });
      }
    }
    return time;
  } catch { return time; }
}

function getWeekDayNames(locale: string, weekStartsOn: number): string[] {
  const localeStr = locale === 'en' ? 'en-US' : 'ar-SA';
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dayIndex = (weekStartsOn + i) % 7;
    const date = new Date(2023, 0, 1 + dayIndex);
    let name = date.toLocaleDateString(localeStr, { weekday: 'short' });
    // Strip Arabic article prefix 'ال' from day names
    if (locale !== 'en') {
      name = name.replace(/^ال/, '');
    }
    names.push(name);
  }
  return names;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function parseTimeToMinutes(time: string): number {
  try {
    if (/^\d{2}:\d{2}/.test(time)) {
      const [h, m] = time.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    }
    return new Date(time).getTime();
  } catch { return 0; }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function CalendarSection({ profile }: { profile: UserProfile }) {
  const { t, direction, locale } = useTranslations();
  const isRTL = direction === 'rtl';

  const today = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<string | null>(toDateString(today));
  const [activeFilters, setActiveFilters] = useState<Set<CalendarEventType>>(
    new Set(['lecture', 'quiz', 'assignment', 'todo', 'poll', 'attendance'])
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBadge, setExpandedBadge] = useState<CalendarEventType | 'all'>('all');

  const weekStartsOn = isRTL ? 6 : 0;
  const weekDayNames = useMemo(() => getWeekDayNames(locale, weekStartsOn), [locale, weekStartsOn]);

  // -------------------------------------------------------
  // Fetch all events
  // -------------------------------------------------------
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const allEvents: CalendarEvent[] = [];

      // 1. Todos — join subjects to get subject_name
      const { data: todos, error: todosError } = await supabase.from('user_todos').select('*, subjects(name)').eq('user_id', profile.id);
      if (todosError) console.error('Error fetching todos:', todosError);
      if (todos && todos.length > 0) {
        for (const todo of todos) {
          if (todo.due_date) {
            const subjectName = (todo.subjects as { name: string } | null)?.name || null;
            allEvents.push({
              id: `todo-${todo.id}`, type: 'todo', title: todo.title || '',
              description: todo.description || null, date: toDateString(parseLocalDate(todo.due_date.split('T')[0])),
              time: todo.due_date || null, subject_id: todo.subject_id || null,
              subject_name: subjectName, color: 'emerald', icon: 'ListTodo',
              completed: todo.completed || false, meta: { priority: todo.priority, category: todo.category, todoId: todo.id },
            });
          }
        }
      }

      // 2. Subject IDs
      const subjectIdsSet = new Set<string>();
      if (profile.role === 'student') {
        const { data: enrollments } = await supabase.from('subject_students').select('subject_id').eq('student_id', profile.id);
        if (enrollments) for (const e of enrollments) subjectIdsSet.add(e.subject_id);
      }
      if (profile.role === 'teacher' || profile.role === 'admin' || profile.role === 'superadmin') {
        const { data: owned } = await supabase.from('subjects').select('id').eq('teacher_id', profile.id);
        if (owned) for (const s of owned) subjectIdsSet.add(s.id);
        const { data: coTeaching } = await supabase.from('subject_teachers').select('subject_id').eq('teacher_id', profile.id);
        if (coTeaching) for (const ct of coTeaching) subjectIdsSet.add(ct.subject_id);
      }
      if (profile.role !== 'student') {
        const { data: enrollments } = await supabase.from('subject_students').select('subject_id').eq('student_id', profile.id);
        if (enrollments) for (const e of enrollments) subjectIdsSet.add(e.subject_id);
      }
      const subjectIds = Array.from(subjectIdsSet);

      const subjectNameMap: Record<string, string> = {};
      if (subjectIds.length > 0) {
        const { data: subjects } = await supabase.from('subjects').select('id, name').in('id', subjectIds);
        if (subjects) for (const s of subjects) subjectNameMap[s.id] = s.name;
      }

      if (subjectIds.length > 0) {
        // 3. Lectures
        const { data: lectures } = await supabase.from('lectures').select('*').in('subject_id', subjectIds);
        if (lectures && lectures.length > 0) {
          for (const lec of lectures) {
            if (lec.lecture_date) {
              allEvents.push({
                id: `lecture-${lec.id}`, type: 'lecture', title: lec.title || '',
                description: lec.description || null, date: toDateString(parseLocalDate(lec.lecture_date)),
                time: null, subject_id: lec.subject_id || null,
                subject_name: lec.subject_id ? subjectNameMap[lec.subject_id] || null : null,
                color: 'sky', icon: 'BookOpen', completed: false, meta: { lecture_id: lec.id },
              });
            }
          }
        }

        // 4. Assignments
        const { data: assignments } = await supabase.from('assignments').select('*').in('subject_id', subjectIds);
        if (assignments && assignments.length > 0) {
          for (const asg of assignments) {
            if (asg.due_date) {
              allEvents.push({
                id: `assignment-${asg.id}`, type: 'assignment', title: asg.title || '',
                description: asg.description || null, date: toDateString(parseLocalDate(asg.due_date.split('T')[0])),
                time: asg.due_date || null, subject_id: asg.subject_id || null,
                subject_name: asg.subject_id ? subjectNameMap[asg.subject_id] || null : null,
                color: 'amber', icon: 'FileText', completed: false, meta: { assignment_id: asg.id },
              });
            }
          }
        }

        // 5. Quizzes
        const { data: quizzes } = await supabase.from('quizzes').select('*').in('subject_id', subjectIds);
        if (quizzes && quizzes.length > 0) {
          for (const q of quizzes) {
            if (q.scheduled_date) {
              allEvents.push({
                id: `quiz-${q.id}`, type: 'quiz', title: q.title || '',
                description: null, date: toDateString(parseLocalDate(q.scheduled_date)),
                time: q.scheduled_time || null, subject_id: q.subject_id || null,
                subject_name: q.subject_id ? subjectNameMap[q.subject_id] || null : null,
                color: 'rose', icon: 'Star', completed: q.is_finished || false, meta: { quiz_id: q.id },
              });
            }
          }
        }

        // 6. Polls
        const { data: polls } = await supabase.from('polls').select('*').in('subject_id', subjectIds).eq('status', 'active');
        if (polls && polls.length > 0) {
          for (const poll of polls) {
            if (poll.closes_at) {
              allEvents.push({
                id: `poll-${poll.id}`, type: 'poll', title: poll.question || '',
                description: poll.description || null, date: toDateString(new Date(poll.closes_at)),
                time: poll.closes_at || null, subject_id: poll.subject_id || null,
                subject_name: poll.subject_id ? subjectNameMap[poll.subject_id] || null : null,
                color: 'violet', icon: 'Vote', completed: false, meta: { poll_id: poll.id },
              });
            }
          }
        }

        // 7. Attendance
        const { data: sessions } = await supabase.from('attendance_sessions').select('*').in('subject_id', subjectIds).eq('status', 'active');
        if (sessions && sessions.length > 0) {
          for (const session of sessions) {
            if (session.started_at) {
              allEvents.push({
                id: `attendance-${session.id}`, type: 'attendance',
                title: session.subject_id ? subjectNameMap[session.subject_id] || '' : '',
                description: null, date: toDateString(new Date(session.started_at)),
                time: session.started_at || null, subject_id: session.subject_id || null,
                subject_name: session.subject_id ? subjectNameMap[session.subject_id] || null : null,
                color: 'teal', icon: 'CheckCircle2', completed: session.status === 'ended',
                meta: { session_id: session.id },
              });
            }
          }
        }
      }

      setEvents(allEvents);
    } catch (err) {
      console.error('Error fetching calendar events:', err);
      toast.error(t('calendar.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [profile.id, profile.role, t]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // -------------------------------------------------------
  // Realtime: listen for todo changes and refresh calendar
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel('calendar-todos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_todos', filter: `user_id=eq.${profile.id}` },
        () => { fetchEvents(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id, fetchEvents]);

  // -------------------------------------------------------
  // Toggle todo completion from calendar
  // -------------------------------------------------------
  const [togglingTodoId, setTogglingTodoId] = useState<string | null>(null);

  const handleToggleTodo = useCallback(async (todoId: string, currentCompleted: boolean) => {
    setTogglingTodoId(todoId);
    try {
      const newCompleted = !currentCompleted;
      const { error } = await supabase
        .from('user_todos')
        .update({
          completed: newCompleted,
          completed_at: newCompleted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', todoId);

      if (error) {
        console.error('Error toggling todo from calendar:', error);
      } else {
        // Optimistic update: update the event in place
        setEvents((prev) =>
          prev.map((e) =>
            e.id === `todo-${todoId}`
              ? { ...e, completed: newCompleted }
              : e
          )
        );
      }
    } catch {
      console.error('Toggle todo error from calendar');
    } finally {
      setTogglingTodoId(null);
    }
  }, []);

  // -------------------------------------------------------
  // Events by date
  // -------------------------------------------------------
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of events) {
      if (!activeFilters.has(event.type)) continue;
      if (!map[event.date]) map[event.date] = [];
      map[event.date].push(event);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (!a.time && b.time) return -1;
        if (a.time && !b.time) return 1;
        if (!a.time && !b.time) return 0;
        const aTime = a.time as string; const bTime = b.time as string;
        const timeA = aTime.includes('T') ? new Date(aTime).getTime() : parseTimeToMinutes(aTime);
        const timeB = bTime.includes('T') ? new Date(bTime).getTime() : parseTimeToMinutes(bTime);
        return timeA - timeB;
      });
    }
    return map;
  }, [events, activeFilters]);

  // -------------------------------------------------------
  // Month grid
  // -------------------------------------------------------
  const monthGrid = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const offset = (firstDay - weekStartsOn + 7) % 7;
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const cells: { date: string; day: number; isCurrentMonth: boolean }[] = [];

    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);
    for (let i = offset - 1; i >= 0; i--) {
      cells.push({ date: toDateString(new Date(prevYear, prevMonth, daysInPrevMonth - i)), day: daysInPrevMonth - i, isCurrentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: toDateString(new Date(currentYear, currentMonth, d)), day: d, isCurrentMonth: true });
    }
    const remaining = totalCells - cells.length;
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ date: toDateString(new Date(nextYear, nextMonth, d)), day: d, isCurrentMonth: false });
    }
    return cells;
  }, [currentYear, currentMonth, weekStartsOn]);

  // -------------------------------------------------------
  // Week view
  // -------------------------------------------------------
  const weekDays = useMemo(() => {
    const referenceDate = selectedDate ? new Date(selectedDate + 'T00:00:00') : today;
    const dayOfWeek = referenceDate.getDay();
    const diff = (dayOfWeek - weekStartsOn + 7) % 7;
    const startOfWeek = new Date(referenceDate);
    startOfWeek.setDate(referenceDate.getDate() - diff);
    const days: { date: string; day: number; dayName: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate() + i);
      let dayName = d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-SA', { weekday: 'short' });
      if (locale !== 'en') dayName = dayName.replace(/^ال/, '');
      days.push({ date: toDateString(d), day: d.getDate(), dayName });
    }
    return days;
  }, [selectedDate, today, weekStartsOn, locale]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return eventsByDate[selectedDate] || [];
  }, [selectedDate, eventsByDate]);

  // -------------------------------------------------------
  // Navigation
  // -------------------------------------------------------
  const goToPrevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
    else setCurrentMonth((m) => m - 1);
  };
  const goToNextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
    else setCurrentMonth((m) => m + 1);
  };
  const goToToday = () => {
    const now = new Date(); setCurrentYear(now.getFullYear()); setCurrentMonth(now.getMonth()); setSelectedDate(toDateString(now));
  };

  const isDatePast = (dateStr: string): boolean => toDateString(today) > dateStr;
  const isDateToday = (dateStr: string): boolean => dateStr === toDateString(today);

  const monthName = new Date(currentYear, currentMonth).toLocaleDateString(
    locale === 'en' ? 'en-US' : 'ar-SA', { month: 'long', year: 'numeric' }
  );

  // Total filtered events count
  const totalEvents = events.filter((e) => activeFilters.has(e.type)).length;

  // -------------------------------------------------------
  // Render: Filter chips
  // -------------------------------------------------------
  const renderFilters = () => {
    const allFilterTypes: CalendarEventType[] = ['lecture', 'quiz', 'assignment', 'todo', 'poll', 'attendance'];
    const isExpandedAll = expandedBadge === 'all';
    const totalCount = events.length;

    return (
      <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 scrollbar-none">
        {/* "All" badge */}
        <button
          onClick={() => setExpandedBadge('all')}
          className={`inline-flex items-center rounded-full text-xs font-medium transition-all duration-200 bg-sky-100 dark:bg-sky-800/30 text-sky-700 dark:text-sky-400 ring-1 border-sky-200 dark:border-sky-900/60 ${
            isExpandedAll ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1.5 sm:gap-1.5 sm:px-2.5'
          }`}
        >
          <span className="h-2 w-2 rounded-full shrink-0 bg-sky-500" />
          <span className={`${isExpandedAll ? 'inline' : 'hidden sm:inline'}`}>{t('calendar.all') || 'الكل'}</span>
          {totalCount > 0 && <span className="text-[10px] rounded-full px-0.5 opacity-80">{totalCount}</span>}
        </button>

        {/* Individual filter badges - always active/lit */}
        {allFilterTypes.map((type) => {
          const config = eventTypeConfig[type];
          const count = events.filter((e) => e.type === type).length;
          const isExpanded = expandedBadge === type;
          const label = t(`calendar.${type === 'lecture' ? 'lectures' : type === 'quiz' ? 'quizzes' : type === 'assignment' ? 'assignments' : type === 'todo' ? 'todos' : type === 'poll' ? 'polls' : 'attendance'}`);
          return (
            <button
              key={type}
              onClick={() => setExpandedBadge(type)}
              className={`inline-flex items-center rounded-full text-xs font-medium transition-all duration-200 ${config.bgClass} ${config.textClass} ring-1 ${config.borderClass} ${
                isExpanded ? 'gap-1.5 px-2.5 py-1.5' : 'gap-1 px-1.5 py-1.5 sm:gap-1.5 sm:px-2.5'
              }`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${config.dotClass}`} />
              <span className={`${isExpanded ? 'inline' : 'hidden sm:inline'}`}>{label}</span>
              {count > 0 && <span className="text-[10px] rounded-full px-0.5 opacity-80">{count}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Month grid (full-width, responsive)
  // -------------------------------------------------------
  const renderMonthView = () => {
    const weeks: typeof monthGrid[] = [];
    for (let i = 0; i < monthGrid.length; i += 7) weeks.push(monthGrid.slice(i, i + 7));

    return (
      <div className="select-none">
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {weekDayNames.map((name, i) => (
            <div key={i} className="py-2 text-center text-xs sm:text-sm font-semibold text-muted-foreground">
              <span>{name}</span>
            </div>
          ))}
        </div>

        {/* Day cells */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0.5 sm:gap-1">
            {week.map((cell) => {
              const dayEvents = eventsByDate[cell.date] || [];
              const isPast = isDatePast(cell.date);
              const isToday = isDateToday(cell.date);
              const isSelected = selectedDate === cell.date;
              const hasEvents = dayEvents.length > 0;
              const uniqueTypes = [...new Set(dayEvents.map((e) => e.type))].slice(0, 3);
              const allCompleted = dayEvents.length > 0 && dayEvents.every((e) => e.completed);
              const hasOverdue = dayEvents.length > 0 && isPast && !isToday && !allCompleted;
              const isFuture = !isPast && !isToday;

              return (
                <motion.button
                  key={cell.date}
                  variants={cellVariants}
                  onClick={() => setSelectedDate(cell.date)}
                  className={`relative flex flex-col items-center justify-start py-1.5 sm:py-2 px-0.5 transition-all rounded-lg sm:rounded-xl text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 min-h-[44px] sm:min-h-[72px] md:min-h-[90px] lg:min-h-[100px] ${
                    !cell.isCurrentMonth ? 'text-muted-foreground/30' : isPast && !isToday ? (allCompleted ? 'text-emerald-600/60 dark:text-emerald-400/60' : 'text-foreground') : 'text-foreground'
                  } ${isToday ? 'bg-sky-50 dark:bg-sky-900/15 ring-2 ring-sky-500 dark:ring-sky-400' : ''} ${
                    isSelected && !isToday ? 'bg-muted/60 ring-1 ring-sky-400/50' : ''
                  } ${!isToday && !isSelected ? 'hover:bg-muted/30' : ''} ${
                    hasOverdue && cell.isCurrentMonth ? 'bg-rose-50/50 dark:bg-rose-900/10 ring-1 ring-rose-300/50 dark:ring-rose-800/40' : ''
                  } ${allCompleted && isPast && !isToday && cell.isCurrentMonth ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : ''}`}
                  aria-label={`${cell.day} - ${dayEvents.length} ${t('calendar.eventCount', { count: dayEvents.length })}`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  {/* Day number */}
                  <span className={`text-[11px] sm:text-sm md:text-base leading-none mb-0.5 ${isToday ? 'font-bold text-sky-700 dark:text-sky-400' : ''} ${isSelected && !isToday ? 'font-semibold' : ''} ${allCompleted && isPast && !isToday ? 'text-emerald-500 dark:text-emerald-400' : ''}`}>
                    {cell.day}
                  </span>

                  {/* Today dot */}
                  {isToday && <span className="h-1 w-4 rounded-full bg-sky-600 dark:bg-sky-400 mb-0.5" />}

                  {/* Status indicator for past dates with events */}
                  {hasEvents && cell.isCurrentMonth && isPast && !isToday && (
                    <span className={`h-1 w-3 rounded-full mb-0.5 ${allCompleted ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  )}

                  {/* Event indicators - mobile: dots, desktop: mini pills */}
                  {hasEvents && cell.isCurrentMonth && (
                    <>
                      {/* Mobile: dots only */}
                      <div className="flex sm:hidden items-center gap-0.5 mt-0.5">
                        {dayEvents.slice(0, 3).map((ev) => {
                          const isOverdue = isPast && !isToday && !ev.completed && ev.type !== 'quiz';
                          const isDone = ev.completed;
                          return (
                            <span key={ev.id} className={`h-1.5 w-1.5 rounded-full ${isOverdue ? 'bg-rose-500' : isDone ? 'bg-emerald-500' : eventTypeConfig[ev.type].dotClass}`} />
                          );
                        })}
                        {dayEvents.length > 3 && <span className="text-[7px] text-muted-foreground">+{dayEvents.length - 3}</span>}
                      </div>
                      {/* Desktop: mini event pills */}
                      <div className="hidden sm:flex flex-col gap-0.5 mt-0.5 w-full px-0.5 overflow-hidden">
                        {dayEvents.slice(0, 2).map((ev) => {
                          const cfg = eventTypeConfig[ev.type];
                          const isOverdue = isPast && !isToday && !ev.completed && ev.type !== 'quiz';
                          const isDone = ev.completed;
                          return (
                            <div key={ev.id} className={`flex items-center gap-1 rounded px-1 py-px ${
                              isOverdue ? 'bg-rose-100 dark:bg-rose-800/30' : isDone ? 'bg-emerald-100 dark:bg-emerald-800/30' : cfg.bgClass
                            } ${isDone ? 'opacity-60' : ''}`}>
                              <span className={`h-1 w-1 rounded-full shrink-0 ${isOverdue ? 'bg-rose-500' : isDone ? 'bg-emerald-500' : cfg.dotClass}`} />
                              <span className={`text-[9px] md:text-[10px] truncate leading-tight ${
                                isOverdue ? 'text-rose-700 dark:text-rose-400' : isDone ? 'text-emerald-700 dark:text-emerald-400 line-through' : cfg.textClass
                              }`}>
                                {ev.title}
                              </span>
                            </div>
                          );
                        })}
                        {dayEvents.length > 2 && (
                          <span className="text-[8px] md:text-[9px] text-muted-foreground text-center">+{dayEvents.length - 2}</span>
                        )}
                      </div>
                    </>
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
            onClick={() => setSelectedDate(day.date)}
            className={`rounded-xl border p-3 sm:p-4 cursor-pointer transition-all hover:shadow-sm ${
              isToday ? 'border-sky-300 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-900/15' :
              isSelected ? 'border-sky-200 dark:border-sky-900 bg-muted/30' :
              'border-border/50 bg-card hover:border-border'
            } ${isPast ? 'opacity-70' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${isToday ? 'text-sky-700 dark:text-sky-400' : 'text-foreground'}`}>{day.dayName}</span>
                <span className={`text-xs ${isToday ? 'text-sky-600 dark:text-sky-400 font-medium' : 'text-muted-foreground'}`}>{day.date}</span>
                {isToday && <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white">{t('calendar.today')}</span>}
              </div>
              {dayEvents.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{dayEvents.length}</span>}
            </div>
            {dayEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-2 text-center">{t('calendar.noEvents')}</p>
            ) : (
              <div className="space-y-1.5">
                {dayEvents.slice(0, 5).map((event) => {
                  const config = eventTypeConfig[event.type];
                  const isTodo = event.type === 'todo';
                  const todoId = isTodo ? event.id.replace('todo-', '') : null;
                  const todoMeta = isTodo ? event.meta as { priority?: TodoPriority } : null;
                  const priorityLabel = todoMeta?.priority ? priorityConfig[todoMeta.priority].label : null;

                  return (
                    <div key={event.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                      isPast && !isToday && !event.completed && event.type !== 'quiz' ? 'bg-rose-100 dark:bg-rose-800/30' : isPast && !isToday && !event.completed && event.type === 'quiz' ? config.bgClass : event.completed ? 'bg-emerald-100 dark:bg-emerald-800/30' : config.bgClass
                    } ${event.completed ? 'opacity-60' : ''}`}>
                      {isTodo && todoId ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleTodo(todoId, !!event.completed); }}
                          className="shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
                          aria-label={event.completed ? 'Mark incomplete' : 'Mark complete'}
                        >
                          {event.completed ? (
                            <CheckCircle2 className={`h-3.5 w-3.5 text-emerald-500`} />
                          ) : isPast && !isToday && event.type !== 'quiz' ? (
                            <AlertCircle className={`h-3.5 w-3.5 text-rose-500`} />
                          ) : (
                            <Circle className={`h-3.5 w-3.5 ${config.textClass}`} />
                          )}
                        </button>
                      ) : (
                        event.completed ? (
                          <CheckCircle2 className={`h-3.5 w-3.5 text-emerald-500`} />
                        ) : isPast && !isToday && event.type !== 'quiz' ? (
                          <AlertCircle className={`h-3.5 w-3.5 text-rose-500`} />
                        ) : (
                          <EventIcon type={event.type} className={`h-3.5 w-3.5 ${config.textClass}`} />
                        )
                      )}
                      <span className={`text-xs font-medium truncate flex-1 ${
                        isPast && !isToday && !event.completed && event.type !== 'quiz' ? 'text-rose-700 dark:text-rose-400' : event.completed ? 'text-emerald-700 dark:text-emerald-400 line-through' : config.textClass
                      } ${event.completed && isTodo ? 'line-through' : ''}`}>
                        {priorityLabel && <span className="me-0.5">{priorityLabel}</span>}
                        {event.title}
                      </span>
                      {event.time && <span className="text-[10px] text-muted-foreground shrink-0">{formatEventTime(event.time, locale)}</span>}
                      {/* Status badge */}
                      {isPast && !isToday && !event.completed && event.type !== 'quiz' && (
                        <span className="shrink-0 text-[8px] font-bold rounded-full px-1.5 py-0.5 bg-rose-500 text-white">{t('calendar.overdue')}</span>
                      )}
                      {isPast && !isToday && !event.completed && event.type === 'quiz' && (
                        <span className="shrink-0 text-[8px] font-bold rounded-full px-1.5 py-0.5 bg-muted-foreground/60 text-white">{t('exams.finished')}</span>
                      )}
                      {event.completed && (
                        <span className="shrink-0 text-[8px] font-bold rounded-full px-1.5 py-0.5 bg-emerald-500 text-white">{t('calendar.completed')}</span>
                      )}
                    </div>
                  );
                })}
                {dayEvents.length > 5 && <p className="text-[10px] text-muted-foreground text-center">+{dayEvents.length - 5}</p>}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );

  // -------------------------------------------------------
  // Render: Day detail panel (sidebar on desktop, below on mobile)
  // -------------------------------------------------------
  const renderDayDetail = () => {
    if (!selectedDate) return null;
    const dateObj = new Date(selectedDate + 'T00:00:00');
    const localeStr = locale === 'en' ? 'en-US' : 'ar-SA';
    const formattedDate = dateObj.toLocaleDateString(localeStr, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const isToday = isDateToday(selectedDate);
    const isPast = isDatePast(selectedDate) && !isToday;

    return (
      <div className="space-y-3" dir={direction}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-foreground">{formattedDate}</h3>
            {isToday && <span className="text-xs text-sky-600 dark:text-sky-400 font-medium">{t('calendar.today')}</span>}
          </div>
          <button onClick={() => setSelectedDate(null)} className="lg:hidden flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {selectedDayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 sm:py-12">
            <CalendarIcon className="h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">{t('calendar.noEventsForDay')}</p>
          </div>
        ) : (
          <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-2 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto custom-scrollbar">
            {selectedDayEvents.map((event) => {
              const config = eventTypeConfig[event.type];
              const eventTime = formatEventTime(event.time, locale);
              const isTodo = event.type === 'todo';
              const todoMeta = isTodo ? event.meta as { priority?: TodoPriority; category?: TodoCategory; todoId?: string } : null;
              const priorityInfo = todoMeta?.priority ? priorityConfig[todoMeta.priority] : null;
              const categoryInfo = todoMeta?.category ? categoryConfig[todoMeta.category] : null;
              const todoId = todoMeta?.todoId || (isTodo ? event.id.replace('todo-', '') : null);
              const isToggling = todoId ? togglingTodoId === todoId : false;
              const isOverdue = isPast && !event.completed && event.type !== 'quiz';

              return (
                <motion.div
                  key={event.id}
                  variants={itemVariants}
                  className={`flex items-start gap-3 rounded-xl border p-3 transition-all ${
                    isOverdue ? 'border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-900/15' : event.completed ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/15' : config.borderClass + ' ' + config.bgClass
                  } ${event.completed ? 'opacity-70' : ''}`}
                >
                  {/* Todo: interactive checkbox | Others: static icon */}
                  {isTodo && todoId ? (
                    <button
                      onClick={() => handleToggleTodo(todoId, !!event.completed)}
                      disabled={isToggling}
                      className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-lg ${
                        isOverdue ? 'bg-rose-100 dark:bg-rose-800/30 text-rose-600 dark:text-rose-400' : event.completed ? 'bg-emerald-100 dark:bg-emerald-800/30 text-emerald-600 dark:text-emerald-400' : config.bgClass + ' ' + config.textClass
                      } hover:opacity-80 transition-opacity cursor-pointer ${isToggling ? 'animate-pulse' : ''}`}
                      aria-label={event.completed ? t('todos.markIncomplete') || 'Mark incomplete' : t('todos.markComplete') || 'Mark complete'}
                    >
                      {event.completed ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : isOverdue ? (
                        <AlertCircle className="h-5 w-5 text-rose-500" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </button>
                  ) : (
                    <div className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-lg ${
                      isOverdue ? 'bg-rose-100 dark:bg-rose-800/30 text-rose-600 dark:text-rose-400' : event.completed ? 'bg-emerald-100 dark:bg-emerald-800/30 text-emerald-600 dark:text-emerald-400' : config.bgClass + ' ' + config.textClass
                    }`}>
                      {event.completed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : isOverdue ? (
                        <AlertCircle className="h-4 w-4 text-rose-500" />
                      ) : (
                        <EventIcon type={event.type} className="h-4 w-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${
                        isOverdue ? 'text-rose-700 dark:text-rose-400' : event.completed ? 'text-emerald-700 dark:text-emerald-400 line-through' : config.textClass
                      } ${event.completed ? 'line-through' : ''}`}>{event.title}</p>
                      {/* Status badge */}
                      {isOverdue && (
                        <span className="shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-rose-500 text-white">{t('calendar.overdue')}</span>
                      )}
                      {event.completed && (
                        <span className="shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-emerald-500 text-white">{t('calendar.completed')}</span>
                      )}
                      {!isOverdue && !event.completed && !isPast && (
                        <span className={`shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 text-white ${event.type === 'quiz' ? 'bg-rose-500' : 'bg-sky-500'}`}>{event.type === 'quiz' ? t('exams.quiz') : t('calendar.upcoming')}</span>
                      )}
                      {!isOverdue && !event.completed && isPast && event.type === 'quiz' && (
                        <span className="shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-muted-foreground/60 text-white">{t('exams.finished')}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {eventTime || t('calendar.allDay')}
                      </span>
                      {event.subject_name && (
                        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">{event.subject_name}</span>
                      )}
                      {/* Todo: priority badge */}
                      {isTodo && priorityInfo && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium rounded-full px-1.5 py-0.5 ${priorityInfo.className}`}>
                          {priorityInfo.label} {todoMeta!.priority}
                        </span>
                      )}
                      {/* Todo: category badge */}
                      {isTodo && categoryInfo && todoMeta!.category && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${categoryInfo.className}`}>
                          {todoMeta!.category}
                        </span>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{event.description}</p>
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
  // Main render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-0 -mx-4 sm:-mx-6 px-4 sm:px-6">
      {/* ============================================ */}
      {/* GRADIENT HEADER BANNER                       */}
      {/* ============================================ */}
      <motion.div variants={itemVariants} className="relative overflow-hidden rounded-2xl mb-4 sm:mb-6" style={{ background: 'linear-gradient(135deg, #0c4a6e 0%, #0369a1 40%, #0891b2 100%)' }}>
        {/* Decorative circles */}
        <div className="absolute -top-16 -start-16 h-48 w-48 rounded-full opacity-[0.07] bg-white" />
        <div className="absolute -bottom-12 -end-12 h-36 w-36 rounded-full opacity-[0.05] bg-white" />

        <div className="relative z-10 p-3 sm:p-6">
          {/* Top row: title + refresh */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <CalendarIcon className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <h2 className="text-base sm:text-xl font-bold text-white">{t('calendar.title')}</h2>
                <p className="text-xs text-sky-200">{t('calendar.eventCount', { count: totalEvents })}</p>
              </div>
            </div>
            <button
              onClick={fetchEvents}
              disabled={loading}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label={t('calendar.refresh')}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Navigation row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mb-3">
            {/* Row 1 on mobile: Month navigation */}
            <div className="flex items-center justify-center gap-2">
              <button onClick={goToPrevMonth} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors" aria-label={t('calendar.prevMonth')}>
                <ChevronLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
              </button>
              <h3 className="text-base sm:text-lg font-bold text-white min-w-[100px] sm:min-w-[140px] text-center">{monthName}</h3>
              <button onClick={goToNextMonth} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors" aria-label={t('calendar.nextMonth')}>
                <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {/* Row 2 on mobile: Today + view toggle */}
            <div className="flex items-center justify-center gap-1.5">
              <button onClick={goToToday} className="rounded-lg bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs font-medium text-white transition-colors">
                {t('calendar.today')}
              </button>
              <div className="flex rounded-lg bg-white/10 p-0.5">
                <button onClick={() => setViewMode('month')} className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === 'month' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'}`}>
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setViewMode('week')} className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === 'week' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'}`}>
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Filter chips */}
          {renderFilters()}
        </div>
      </motion.div>

      {/* ============================================ */}
      {/* CALENDAR BODY: grid + detail panel            */}
      {/* ============================================ */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
        </div>
      ) : (
        <motion.div variants={itemVariants} className="flex flex-col lg:flex-row gap-4">
          {/* Calendar grid - full width on mobile, left side on desktop */}
          <div className="flex-1 min-w-0 bg-card rounded-2xl border p-3 sm:p-4 shadow-sm">
            {viewMode === 'month' ? renderMonthView() : renderWeekView()}
          </div>

          {/* Day detail panel - below on mobile/tablet, right sidebar on desktop */}
          <div className="lg:w-[340px] xl:w-[380px] shrink-0">
            {selectedDate ? (
              <div className="bg-card rounded-2xl border p-2 sm:p-4 shadow-sm sm:sticky top-4">
                {renderDayDetail()}
              </div>
            ) : (
              <div className="bg-card rounded-2xl border p-6 shadow-sm hidden lg:flex flex-col items-center justify-center text-center min-h-[200px]">
                <CalendarIcon className="h-10 w-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">{t('calendar.noEventsForDay')}</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
