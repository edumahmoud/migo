'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Circle,
  Trash2,
  Plus,
  Calendar,
  Flag,
  Filter,
  ListTodo,
  Clock,
  AlertCircle,
  X,
  Loader2,
  MoreVertical,
  Pencil,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type {
  UserProfile,
  UserTodo,
  TodoPriority,
  TodoCategory,
  TodoSource,
  Subject,
} from '@/lib/types';

// -------------------------------------------------------
// Auto-generated item from quizzes/assignments
// -------------------------------------------------------
interface AutoTodoItem {
  id: string;
  title: string;
  description: string | null;
  category: TodoCategory;
  due_date: string | null;
  subject_id: string | null;
  subject_name: string | null;
  source: 'auto';
  completed: boolean;
  autoType: 'quiz' | 'assignment';
  /** For quizzes: scheduled_time (HH:mm) */
  scheduled_time?: string | null;
  /** For quizzes: duration in minutes */
  duration?: number | null;
  /** Teacher name who created the quiz/assignment */
  teacher_name?: string | null;
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Priority badge color map
// -------------------------------------------------------
const priorityBadgeClasses: Record<TodoPriority, string> = {
  task: 'bg-rose-100 dark:bg-rose-800/40 text-rose-700 dark:text-rose-500',
  medium: 'bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-500',
  low: 'bg-emerald-100 dark:bg-emerald-800/40 text-emerald-700 dark:text-emerald-500',
};

// -------------------------------------------------------
// Category badge color map
// -------------------------------------------------------
const categoryBadgeClasses: Record<TodoCategory, string> = {
  study: 'bg-sky-100 dark:bg-sky-800/40 text-sky-700 dark:text-sky-400',
  assignment: 'bg-violet-100 dark:bg-violet-800/40 text-violet-700 dark:text-violet-500',
  task: 'bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-500',
  personal: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-500',
};

// -------------------------------------------------------
// Priority sort weight (higher = more urgent)
// -------------------------------------------------------
const priorityWeight: Record<TodoPriority, number> = {
  task: 3,
  medium: 2,
  low: 1,
};

// -------------------------------------------------------
// Filter & sort types
// -------------------------------------------------------
type StatusFilter = 'all' | 'active' | 'completed';
type SortOption = 'dueDate' | 'priority' | 'createdDate';

// -------------------------------------------------------
// Helper: format due date
// -------------------------------------------------------
function formatDueDate(dateStr: string, locale: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const isPast = diffMs < 0;

    const formatted = date.toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-SA', {
      month: 'short',
      day: 'numeric',
    }) + ' ' + date.toLocaleTimeString(locale === 'en' ? 'en-US' : 'ar-SA', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    return isPast ? formatted : formatted;
  } catch {
    return dateStr;
  }
}

function isDueSoon(dateStr: string): boolean {
  const now = new Date();
  const due = new Date(dateStr);
  const diffMs = due.getTime() - now.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return diffMs > 0 && diffMs < oneDayMs;
}

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}

// -------------------------------------------------------
// Helper: check if a quiz is completed based on time
// A quiz is considered completed if:
// current time > scheduled_date + scheduled_time + duration + 1 second
// -------------------------------------------------------
function isQuizTimeCompleted(
  scheduledDate: string | null,
  scheduledTime: string | null,
  duration: number | null | undefined
): boolean {
  if (!scheduledDate) return false;
  const now = new Date();
  // Build the end datetime: scheduled_date + scheduled_time + duration + 1s
  let endMs: number;
  if (scheduledTime && duration) {
    // Parse scheduled_date (YYYY-MM-DD) + scheduled_time (HH:mm)
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    const endDate = new Date(scheduledDate);
    endDate.setHours(hours, minutes, 0, 0);
    // Add duration in minutes + 1 second
    endMs = endDate.getTime() + duration * 60 * 1000 + 1000;
  } else if (scheduledTime) {
    // No duration, just check if start time has passed
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    const endDate = new Date(scheduledDate);
    endDate.setHours(hours, minutes, 0, 0);
    endMs = endDate.getTime() + 1000; // just start time + 1s
  } else if (duration) {
    // No scheduled time, use end of day of scheduled_date + duration
    const endDate = new Date(scheduledDate);
    endDate.setHours(23, 59, 0, 0);
    endMs = endDate.getTime() + duration * 60 * 1000 + 1000;
  } else {
    // No time or duration, check if the date has passed
    const endDate = new Date(scheduledDate);
    endDate.setHours(23, 59, 59, 0);
    endMs = endDate.getTime();
  }
  return now.getTime() > endMs;
}

// -------------------------------------------------------
// Helper: convert ISO date to datetime-local value
// -------------------------------------------------------
function toDatetimeLocalValue(isoStr: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    // Format: YYYY-MM-DDTHH:MM
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function TodoSection({ profile }: { profile: UserProfile }) {
  const { t, direction, locale } = useTranslations();

  // ─── Data state ───
  const [todos, setTodos] = useState<UserTodo[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Filter & sort state ───
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<TodoPriority | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<TodoCategory | 'all'>('all');
  const [sortOption, setSortOption] = useState<SortOption>('createdDate');

  // ─── Add modal state ───
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<TodoPriority>('medium');
  const [newCategory, setNewCategory] = useState<TodoCategory>('personal');
  const [newDueDate, setNewDueDate] = useState('');
  const [newSubjectId, setNewSubjectId] = useState('');
  const [adding, setAdding] = useState(false);

  // ─── Edit modal state ───
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTodoId, setEditTodoId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<TodoPriority>('medium');
  const [editCategory, setEditCategory] = useState<TodoCategory>('personal');
  const [editDueDate, setEditDueDate] = useState('');
  const [editSubjectId, setEditSubjectId] = useState('');
  const [saving, setSaving] = useState(false);

  // ─── Delete state ───
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ─── Auto todos (quizzes/assignments) ───
  const [autoTodos, setAutoTodos] = useState<AutoTodoItem[]>([]);
  const [fetchingAuto, setFetchingAuto] = useState(false);

  // ─── Toggling state ───
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // -------------------------------------------------------
  // Fetch todos
  // -------------------------------------------------------
  const fetchTodos = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_todos')
        .select('*, subjects(name)')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching todos:', error);
      } else {
        const mapped: UserTodo[] = (data || []).map((row: Record<string, unknown>) => ({
          id: row.id as string,
          user_id: row.user_id as string,
          title: row.title as string,
          description: (row.description as string) || null,
          priority: row.priority as TodoPriority,
          category: row.category as TodoCategory,
          due_date: (row.due_date as string) || null,
          subject_id: (row.subject_id as string) || null,
          subject_name:
            (row.subjects as { name: string } | null)?.name || null,
          source: (row.source as TodoSource) || 'manual',
          completed: row.completed as boolean,
          completed_at: (row.completed_at as string) || null,
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
        }));
        setTodos(mapped);
      }
    } catch (err) {
      console.error('Fetch todos error:', err);
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Fetch subjects for the optional subject selector
  // -------------------------------------------------------
  const fetchSubjects = useCallback(async () => {
    try {
      // Get enrolled or owned subjects
      const { data: enrollments } = await supabase
        .from('subject_students')
        .select('subject_id')
        .eq('student_id', profile.id);

      const enrolledIds = (enrollments || []).map((e: { subject_id: string }) => e.subject_id);

      // Also get teacher-owned subjects
      const { data: owned } = await supabase
        .from('subjects')
        .select('id')
        .eq('teacher_id', profile.id);

      const ownedIds = (owned || []).map((s: { id: string }) => s.id);

      const allIds = [...new Set([...enrolledIds, ...ownedIds])];

      if (allIds.length === 0) {
        setSubjects([]);
        return;
      }

      const { data, error } = await supabase
        .from('subjects')
        .select('*')
        .in('id', allIds)
        .order('name', { ascending: true });

      if (error) console.error('Error fetching subjects:', error);
      else setSubjects((data as Subject[]) || []);
    } catch (err) {
      console.error('Fetch subjects error:', err);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Fetch auto todos from quizzes and assignments
  // -------------------------------------------------------
  const fetchAutoTodos = useCallback(async () => {
    setFetchingAuto(true);
    try {
      // Get enrolled subject IDs
      const { data: enrollments } = await supabase
        .from('subject_students')
        .select('subject_id')
        .eq('student_id', profile.id);

      const enrolledIds = (enrollments || []).map((e: { subject_id: string }) => e.subject_id);

      // Also teacher-owned subjects
      const { data: owned } = await supabase
        .from('subjects')
        .select('id')
        .eq('teacher_id', profile.id);

      const ownedIds = (owned || []).map((s: { id: string }) => s.id);

      const allSubjectIds = [...new Set([...enrolledIds, ...ownedIds])];

      if (allSubjectIds.length === 0) {
        setAutoTodos([]);
        return;
      }

      // Build subject name map + teacher name map
      const subjectNameMap: Record<string, string> = {};
      const subjectTeacherMap: Record<string, string> = {}; // subject_id -> teacher_name
      const { data: subjectsData } = await supabase.from('subjects').select('id, name, teacher_id').in('id', allSubjectIds);
      if (subjectsData) {
        for (const s of subjectsData) {
          subjectNameMap[s.id] = s.name;
          subjectTeacherMap[s.id] = s.teacher_id;
        }
      }

      // Fetch teacher names for all teacher_ids
      const teacherIds = [...new Set(Object.values(subjectTeacherMap))];
      const teacherNameMap: Record<string, string> = {};
      if (teacherIds.length > 0) {
        const { data: teachersData } = await supabase.from('users').select('id, name').in('id', teacherIds);
        if (teachersData) {
          for (const t of teachersData) {
            teacherNameMap[t.id] = t.name;
          }
        }
      }

      const items: AutoTodoItem[] = [];
      const now = new Date();

      // Fetch upcoming quizzes
      const { data: quizzes } = await supabase
        .from('quizzes')
        .select('*')
        .in('subject_id', allSubjectIds);

      if (quizzes) {
        for (const q of quizzes) {
          if (q.scheduled_date) {
            const scheduledDate = new Date(q.scheduled_date);
            // Only include future or recent quizzes
            const diffDays = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays > -7) { // Include quizzes up to 7 days old
              // Mark completed if: is_finished in DB OR time has passed (start_time + duration + 1s)
              const timeCompleted = isQuizTimeCompleted(q.scheduled_date, q.scheduled_time, q.duration);
              items.push({
                id: `auto-quiz-${q.id}`,
                title: q.title || '',
                description: null,
                category: 'task' as TodoCategory,
                due_date: q.scheduled_date,
                subject_id: q.subject_id,
                subject_name: q.subject_id ? subjectNameMap[q.subject_id] || null : null,
                source: 'auto',
                completed: q.is_finished || timeCompleted,
                autoType: 'quiz',
                scheduled_time: q.scheduled_time || null,
                duration: q.duration || null,
                teacher_name: q.subject_id ? teacherNameMap[subjectTeacherMap[q.subject_id]] || null : null,
              });
            }
          }
        }
      }

      // Fetch upcoming assignments
      const { data: assignments } = await supabase
        .from('assignments')
        .select('*')
        .in('subject_id', allSubjectIds);

      if (assignments) {
        for (const a of assignments) {
          if (a.due_date) {
            const dueDate = new Date(a.due_date);
            const diffDays = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays > -7) {
              items.push({
                id: `auto-assignment-${a.id}`,
                title: a.title || '',
                description: a.description || null,
                category: 'assignment' as TodoCategory,
                due_date: a.due_date,
                subject_id: a.subject_id,
                subject_name: a.subject_id ? subjectNameMap[a.subject_id] || null : null,
                source: 'auto',
                completed: false,
                autoType: 'assignment',
                teacher_name: a.subject_id ? teacherNameMap[subjectTeacherMap[a.subject_id]] || null : null,
              });
            }
          }
        }
      }

      setAutoTodos(items);
    } catch (err) {
      console.error('Fetch auto todos error:', err);
    } finally {
      setFetchingAuto(false);
    }
  }, [profile.id]);

  // -------------------------------------------------------
  // Initial load
  // -------------------------------------------------------
  useEffect(() => {
    fetchTodos();
    fetchSubjects();
    fetchAutoTodos();
  }, [fetchTodos, fetchSubjects, fetchAutoTodos]);

  // -------------------------------------------------------
  // Periodic re-check: update auto todo completion based on time
  // Re-evaluates every 30 seconds to catch time-based completions
  // -------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      setAutoTodos((prev) =>
        prev.map((item) => {
          if (item.autoType === 'quiz' && !item.completed) {
            const timeCompleted = isQuizTimeCompleted(
              item.due_date,
              item.scheduled_time ?? null,
              item.duration ?? null
            );
            if (timeCompleted) {
              return { ...item, completed: true };
            }
          }
          return item;
        })
      );
    }, 30_000); // every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // -------------------------------------------------------
  // Real-time subscription
  // NOTE: We debounce the re-fetch to avoid overwriting optimistic
  // toggles. When a realtime event fires right after a toggle,
  // the fetchTodos would overwrite the optimistic state.
  // We use a flag to skip the re-fetch if a toggle is in progress.
  // -------------------------------------------------------
  const togglingInProgress = useRef(false);

  useEffect(() => {
    const channel = supabase
      .channel('user-todos-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_todos',
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          // Skip re-fetch if a toggle is in progress to avoid overwriting optimistic state
          if (togglingInProgress.current) return;
          fetchTodos();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id, fetchTodos]);

  // -------------------------------------------------------
  // Computed: combined todos (manual + auto) for display
  // -------------------------------------------------------
  const allDisplayTodos = useMemo(() => {
    // Convert auto todos to UserTodo-like format for display
    const autoAsUserTodos: UserTodo[] = autoTodos.map((at) => ({
      id: at.id,
      user_id: profile.id,
      title: at.title,
      description: at.description,
      priority: 'medium' as TodoPriority,
      category: at.category,
      due_date: at.due_date,
      subject_id: at.subject_id,
      subject_name: at.subject_name,
      source: 'auto' as TodoSource,
      completed: at.completed,
      completed_at: null,
      created_at: at.due_date || new Date().toISOString(),
      updated_at: at.due_date || new Date().toISOString(),
      teacher_name: at.teacher_name,
    }));
    return [...todos, ...autoAsUserTodos];
  }, [todos, autoTodos, profile.id]);

  // -------------------------------------------------------
  // Computed: counts
  // -------------------------------------------------------
  const pendingCount = allDisplayTodos.filter((todo) => !todo.completed).length;
  const completedCount = allDisplayTodos.filter((todo) => todo.completed).length;

  // -------------------------------------------------------
  // Computed: filtered & sorted todos
  // -------------------------------------------------------
  const filteredTodos = allDisplayTodos
    .filter((todo) => {
      // Status filter
      if (statusFilter === 'active' && todo.completed) return false;
      if (statusFilter === 'completed' && !todo.completed) return false;
      // Priority filter
      if (priorityFilter !== 'all' && todo.priority !== priorityFilter) return false;
      // Category filter
      if (categoryFilter !== 'all' && todo.category !== categoryFilter) return false;
      return true;
    })
    .sort((a, b) => {
      // Always put completed items at the bottom
      if (a.completed !== b.completed) return a.completed ? 1 : -1;

      switch (sortOption) {
        case 'dueDate': {
          // No due date goes to bottom
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        }
        case 'priority': {
          return priorityWeight[b.priority] - priorityWeight[a.priority];
        }
        case 'createdDate':
        default: {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
      }
    });

  // -------------------------------------------------------
  // Add todo
  // -------------------------------------------------------
  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) {
      toast.error(t('todos.titlePlaceholder'));
      return;
    }

    setAdding(true);
    try {
      const insertData: Record<string, unknown> = {
        user_id: profile.id,
        title,
        description: newDescription.trim() || null,
        priority: newPriority,
        category: newCategory,
        due_date: newDueDate ? new Date(newDueDate).toISOString() : null,
        subject_id: newSubjectId || null,
        source: 'manual',
        completed: false,
      };

      const { error } = await supabase.from('user_todos').insert(insertData);

      if (error) {
        console.error('Error adding todo:', error);
        toast.error(t('common.error'));
      } else {
        toast.success(t('todos.addedSuccess'));
        setAddModalOpen(false);
        resetAddForm();
        fetchTodos();
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setAdding(false);
    }
  };

  const resetAddForm = () => {
    setNewTitle('');
    setNewDescription('');
    setNewPriority('medium');
    setNewCategory('personal');
    setNewDueDate('');
    setNewSubjectId('');
  };

  // -------------------------------------------------------
  // Open edit modal with pre-filled data
  // -------------------------------------------------------
  const openEditModal = (todo: UserTodo) => {
    setEditTodoId(todo.id);
    setEditTitle(todo.title);
    setEditDescription(todo.description || '');
    setEditPriority(todo.priority);
    setEditCategory(todo.category);
    setEditDueDate(toDatetimeLocalValue(todo.due_date ?? null));
    setEditSubjectId(todo.subject_id || '');
    setEditModalOpen(true);
  };

  // -------------------------------------------------------
  // Save edited todo
  // -------------------------------------------------------
  const handleEdit = async () => {
    if (!editTodoId) return;
    const title = editTitle.trim();
    if (!title) {
      toast.error(t('todos.titlePlaceholder'));
      return;
    }

    setSaving(true);
    try {
      const updateData: Record<string, unknown> = {
        title,
        description: editDescription.trim() || null,
        priority: editPriority,
        category: editCategory,
        due_date: editDueDate ? new Date(editDueDate).toISOString() : null,
        subject_id: editSubjectId || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('user_todos')
        .update(updateData)
        .eq('id', editTodoId);

      if (error) {
        console.error('Error editing todo:', error);
        toast.error(t('common.error'));
      } else {
        toast.success(t('todos.updatedSuccess'));
        setEditModalOpen(false);
        setEditTodoId(null);
        // Optimistic update
        setTodos((prev) =>
          prev.map((item) =>
            item.id === editTodoId
              ? {
                  ...item,
                  title,
                  description: editDescription.trim() || null,
                  priority: editPriority,
                  category: editCategory,
                  due_date: editDueDate ? new Date(editDueDate).toISOString() : null,
                  subject_id: editSubjectId || null,
                }
              : item
          )
        );
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------
  // Toggle complete/incomplete
  // FIX: Do optimistic update IMMEDIATELY before API call,
  // and skip realtime re-fetch during toggle to prevent overwrite.
  // -------------------------------------------------------
  const handleToggle = async (todo: UserTodo) => {
    const newCompleted = !todo.completed;
    const isAuto = todo.source === 'auto' && todo.id.startsWith('auto-');

    // Optimistic update BEFORE API call
    if (isAuto) {
      // Auto todos are not in the DB, just toggle local state
      setAutoTodos((prev) =>
        prev.map((item) =>
          item.id === todo.id
            ? { ...item, completed: newCompleted }
            : item
        )
      );
      return;
    }

    // Set flag to prevent realtime from overwriting
    togglingInProgress.current = true;
    setTogglingId(todo.id);

    // Optimistic update for DB todos
    setTodos((prev) =>
      prev.map((item) =>
        item.id === todo.id
          ? { ...item, completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null }
          : item
      )
    );

    try {
      const updateData: Record<string, unknown> = {
        completed: newCompleted,
        completed_at: newCompleted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('user_todos')
        .update(updateData)
        .eq('id', todo.id);

      if (error) {
        console.error('Error toggling todo:', error);
        // Revert optimistic update on error
        setTodos((prev) =>
          prev.map((item) =>
            item.id === todo.id
              ? { ...item, completed: !newCompleted, completed_at: !newCompleted ? new Date().toISOString() : null }
              : item
          )
        );
      } else {
        toast.success(t('todos.updatedSuccess'));
      }
    } catch {
      console.error('Toggle todo error');
      // Revert
      setTodos((prev) =>
        prev.map((item) =>
          item.id === todo.id
            ? { ...item, completed: !newCompleted, completed_at: !newCompleted ? new Date().toISOString() : null }
            : item
        )
      );
    } finally {
      setTogglingId(null);
      // Delay clearing the flag to allow the realtime event to pass
      setTimeout(() => {
        togglingInProgress.current = false;
      }, 500);
    }
  };

  // -------------------------------------------------------
  // Delete todo
  // -------------------------------------------------------
  const handleDelete = async (todoId: string) => {
    setDeletingId(todoId);
    try {
      const { error } = await supabase.from('user_todos').delete().eq('id', todoId);

      if (error) {
        console.error('Error deleting todo:', error);
      } else {
        toast.success(t('todos.deletedSuccess'));
        // Optimistic removal
        setTodos((prev) => prev.filter((item) => item.id !== todoId));
      }
    } catch {
      console.error('Delete todo error');
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  // -------------------------------------------------------
  // Priority badge renderer
  // -------------------------------------------------------
  const renderPriorityBadge = (priority: TodoPriority) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${priorityBadgeClasses[priority]}`}
    >
      <Flag className="h-2.5 w-2.5" />
      {t(`todos.${priority}`)}
    </span>
  );

  // -------------------------------------------------------
  // Category badge renderer
  // -------------------------------------------------------
  const renderCategoryBadge = (category: TodoCategory) => (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${categoryBadgeClasses[category]}`}
    >
      {category === 'task' ? t('todos.taskCat') : t(`todos.${category}`)}
    </span>
  );

  // -------------------------------------------------------
  // Render: Todo card
  // -------------------------------------------------------
  const renderTodoCard = (todo: UserTodo) => {
    const isDeleting = deletingId === todo.id;
    const isToggling = togglingId === todo.id;
    const showDeleteConfirm = deleteConfirmId === todo.id;
    const overdue = todo.due_date ? isOverdue(todo.due_date) && !todo.completed : false;
    const dueSoon = todo.due_date ? isDueSoon(todo.due_date) && !todo.completed : false;

    return (
      <motion.div
        key={todo.id}
        variants={itemVariants}
        layout
        className={`group relative rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md ${
          todo.completed ? 'opacity-60' : ''
        } ${overdue ? 'border-rose-300 dark:border-rose-900/60' : ''}`}
      >
        <div className="flex items-start gap-3" dir={direction}>
          {/* Checkbox */}
          <button
            onClick={() => handleToggle(todo)}
            disabled={isToggling}
            className="mt-0.5 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-full"
            aria-label={todo.completed ? t('todos.completed') : t('todos.active')}
          >
            {isToggling ? (
              <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
            ) : todo.completed ? (
              <CheckCircle2 className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground hover:text-sky-600 dark:hover:text-sky-400 transition-colors" />
            )}
          </button>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {/* Title row */}
            <div className="flex items-start justify-between gap-2">
              <p
                className={`text-sm font-medium leading-snug ${
                  todo.completed
                    ? 'line-through text-muted-foreground'
                    : 'text-foreground'
                }`}
              >
                {todo.title}
              </p>

              {/* Actions Dropdown Menu - always visible on all screen sizes */}
              <div className="shrink-0" dir={direction}>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(todo.id)}
                      disabled={isDeleting}
                      className="rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700 transition-colors"
                    >
                      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('todos.deleteConfirm')}
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded-md bg-muted px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <DropdownMenu dir={direction}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                        aria-label={t('todos.actions')}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align={direction === 'rtl' ? 'start' : 'end'}
                      sideOffset={4}
                      className="w-48"
                    >
                      <DropdownMenuItem
                        onClick={() => openEditModal(todo)}
                        className="cursor-pointer gap-2"
                      >
                        <Pencil className="h-4 w-4" />
                        <span>{t('todos.editTodo')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteConfirmId(todo.id)}
                        className="cursor-pointer gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>{t('todos.deleteTodo')}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Description */}
            {todo.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {todo.description}
              </p>
            )}

            {/* Badges & meta row */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {renderPriorityBadge(todo.priority)}
              {renderCategoryBadge(todo.category)}

              {/* Due date */}
              {todo.due_date ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    overdue
                      ? 'bg-rose-100 dark:bg-rose-800/40 text-rose-700 dark:text-rose-500'
                      : dueSoon
                        ? 'bg-amber-100 dark:bg-amber-800/40 text-amber-700 dark:text-amber-500'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-500'
                  }`}
                >
                  <Calendar className="h-2.5 w-2.5" />
                  {overdue && <AlertCircle className="h-2.5 w-2.5" />}
                  {formatDueDate(todo.due_date, locale)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 dark:bg-gray-800/40 text-gray-400 dark:text-gray-500 px-2 py-0.5 text-[10px] font-medium">
                  <Calendar className="h-2.5 w-2.5" />
                  {t('todos.noDueDate')}
                </span>
              )}

              {/* Subject name */}
              {todo.subject_name && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-800/40 text-sky-700 dark:text-sky-400 px-2 py-0.5 text-[10px] font-semibold">
                  {todo.subject_name}
                </span>
              )}

              {/* Auto source indicator - show teacher name */}
              {todo.source === 'auto' && (
                <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                  todo.id.startsWith('auto-quiz')
                    ? 'bg-rose-100 dark:bg-rose-800/30 text-rose-600 dark:text-rose-400'
                    : todo.id.startsWith('auto-assignment')
                      ? 'bg-violet-100 dark:bg-violet-800/30 text-violet-600 dark:text-violet-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500'
                }`}>
                  <Clock className="h-2 w-2" />
                  {todo.teacher_name
                    ? t('todos.byTeacher', { name: todo.teacher_name })
                    : (todo.id.startsWith('auto-quiz') ? t('todos.autoQuiz') : todo.id.startsWith('auto-assignment') ? t('todos.autoAssignment') : 'auto')
                  }
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Shared form fields (used by Add & Edit modals)
  // -------------------------------------------------------
  const renderFormFields = (
    title: string,
    setTitle: (v: string) => void,
    description: string,
    setDescription: (v: string) => void,
    priority: TodoPriority,
    setPriority: (v: TodoPriority) => void,
    category: TodoCategory,
    setCategory: (v: TodoCategory) => void,
    dueDate: string,
    setDueDate: (v: string) => void,
    subjectId: string,
    setSubjectId: (v: string) => void,
    isSubmitting: boolean,
  ) => (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <label className="text-sm font-medium text-foreground mb-1.5 block">
          {t('todos.title')} *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('todos.titlePlaceholder')}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
          dir={direction}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isSubmitting) {
              // Allow submit on Enter
            }
          }}
        />
      </div>

      {/* Description */}
      <div>
        <label className="text-sm font-medium text-foreground mb-1.5 block">
          {t('todos.descriptionPlaceholder')}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('todos.descriptionPlaceholder')}
          rows={2}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors resize-none"
          dir={direction}
        />
      </div>

      {/* Priority & Category row */}
      <div className="grid grid-cols-2 gap-3">
        {/* Priority */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            {t('todos.priority')}
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TodoPriority)}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir={direction}
          >
            <option value="task">{t('todos.task')}</option>
            <option value="medium">{t('todos.medium')}</option>
            <option value="low">{t('todos.low')}</option>
          </select>
        </div>

        {/* Category */}
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            {t('todos.category')}
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TodoCategory)}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir={direction}
          >
            <option value="study">{t('todos.study')}</option>
            <option value="assignment">{t('todos.assignment')}</option>
            <option value="task">{t('todos.taskCat')}</option>
            <option value="personal">{t('todos.personal')}</option>
          </select>
        </div>
      </div>

      {/* Due date */}
      <div>
        <label className="text-sm font-medium text-foreground mb-1.5 block">
          {t('todos.dueDate')}
        </label>
        <input
          type="datetime-local"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
          dir="ltr"
        />
      </div>

      {/* Subject (optional) */}
      {subjects.length > 0 && (
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            {t('todos.subject')}
          </label>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
            dir={direction}
          >
            <option value="">{t('todos.noSubject')}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  // -------------------------------------------------------
  // Render: Add modal
  // -------------------------------------------------------
  const renderAddModal = () => (
    <AnimatePresence>
      {addModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAddModalOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            dir={direction}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Plus className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                {t('todos.addTodo')}
              </h3>
              <button
                onClick={() => setAddModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            {renderFormFields(
              newTitle, setNewTitle,
              newDescription, setNewDescription,
              newPriority, setNewPriority,
              newCategory, setNewCategory,
              newDueDate, setNewDueDate,
              newSubjectId, setNewSubjectId,
              adding,
            )}

            {/* Submit button */}
            <div className="mt-5">
              <button
                onClick={handleAdd}
                disabled={adding || !newTitle.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {adding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('todos.addTodo')}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {t('todos.addTodo')}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Edit modal
  // -------------------------------------------------------
  const renderEditModal = () => (
    <AnimatePresence>
      {editModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditModalOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            dir={direction}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Pencil className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                {t('todos.editTodo')}
              </h3>
              <button
                onClick={() => setEditModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            {renderFormFields(
              editTitle, setEditTitle,
              editDescription, setEditDescription,
              editPriority, setEditPriority,
              editCategory, setEditCategory,
              editDueDate, setEditDueDate,
              editSubjectId, setEditSubjectId,
              saving,
            )}

            {/* Save button */}
            <div className="mt-5">
              <button
                onClick={handleEdit}
                disabled={saving || !editTitle.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('common.saving')}
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4" />
                    {t('todos.saveChanges')}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // -------------------------------------------------------
  // Render: Empty state
  // -------------------------------------------------------
  const renderEmptyState = () => (
    <motion.div
      variants={itemVariants}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-16"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 mb-4">
        <ListTodo className="h-8 w-8 text-sky-700 dark:text-sky-400" />
      </div>
      <p className="text-lg font-semibold text-foreground mb-1">
        {t('todos.noTodos')}
      </p>
      <p className="text-sm text-muted-foreground max-w-sm text-center">
        {t('todos.noTodosDesc')}
      </p>
      <button
        onClick={() => setAddModalOpen(true)}
        className="mt-4 flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
      >
        <Plus className="h-4 w-4" />
        {t('todos.addTodo')}
      </button>
    </motion.div>
  );

  // -------------------------------------------------------
  // Main render
  // -------------------------------------------------------
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-5">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-800/40">
            <ListTodo className="h-5 w-5 text-sky-700 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              {t('todos.title')}
              <span className="inline-flex items-center justify-center rounded-full bg-sky-700 dark:bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {`${t('todos.pending')}: ${pendingCount} · ${t('todos.completed')}: ${completedCount}`}
            </p>
          </div>
        </div>

        <button
          onClick={() => setAddModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800"
        >
          <Plus className="h-4 w-4" />
          {t('todos.addTodo')}
        </button>
      </motion.div>

      {/* Filter bar */}
      <motion.div variants={itemVariants} className="space-y-3">
        {/* Status filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status tabs */}
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            {([
              { key: 'all' as StatusFilter, label: t('todos.all'), count: todos.length },
              { key: 'active' as StatusFilter, label: t('todos.active'), count: pendingCount },
              { key: 'completed' as StatusFilter, label: t('todos.completed'), count: completedCount },
            ]).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setStatusFilter(opt.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  statusFilter === opt.key
                    ? 'bg-sky-700 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {opt.label}
                <span
                  className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                    statusFilter === opt.key ? 'bg-white/20' : 'bg-muted'
                  }`}
                >
                  {opt.count}
                </span>
              </button>
            ))}
          </div>

          {/* Priority filter */}
          <div className="relative">
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as TodoPriority | 'all')}
              className="appearance-none rounded-lg border bg-background pe-8 ps-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors cursor-pointer"
              dir={direction}
            >
              <option value="all">{t('todos.filter')}: {t('todos.priority')}</option>
              <option value="task">{t('todos.task')}</option>
              <option value="medium">{t('todos.medium')}</option>
              <option value="low">{t('todos.low')}</option>
            </select>
            <Filter className="pointer-events-none absolute end-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Category filter */}
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as TodoCategory | 'all')}
              className="appearance-none rounded-lg border bg-background pe-8 ps-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors cursor-pointer"
              dir={direction}
            >
              <option value="all">{t('todos.filter')}: {t('todos.category')}</option>
              <option value="study">{t('todos.study')}</option>
              <option value="assignment">{t('todos.assignment')}</option>
              <option value="task">{t('todos.taskCat')}</option>
              <option value="personal">{t('todos.personal')}</option>
            </select>
            <Filter className="pointer-events-none absolute end-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Sort */}
          <div className="relative">
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="appearance-none rounded-lg border bg-background pe-8 ps-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors cursor-pointer"
              dir={direction}
            >
              <option value="createdDate">{t('todos.sort')}: {t('todos.count')}</option>
              <option value="dueDate">{t('todos.dueDate')}</option>
              <option value="priority">{t('todos.priority')}</option>
            </select>
            <Filter className="pointer-events-none absolute end-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </motion.div>

      {/* Todo list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
        </div>
      ) : filteredTodos.length === 0 ? (
        renderEmptyState()
      ) : (
        <motion.div variants={containerVariants} className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pe-1">
          {filteredTodos.map((todo) => renderTodoCard(todo))}
        </motion.div>
      )}

      {/* Add modal */}
      {renderAddModal()}

      {/* Edit modal */}
      {renderEditModal()}
    </motion.div>
  );
}
