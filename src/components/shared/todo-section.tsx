'use client';

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
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
  urgent: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300',
  medium: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',
  low: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300',
};

// -------------------------------------------------------
// Category badge color map
// -------------------------------------------------------
const categoryBadgeClasses: Record<TodoCategory, string> = {
  study: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300',
  assignment: 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300',
  review: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',
  personal: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
};

// -------------------------------------------------------
// Priority sort weight (higher = more urgent)
// -------------------------------------------------------
const priorityWeight: Record<TodoPriority, number> = {
  urgent: 3,
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

  // ─── Delete state ───
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
  // Initial load
  // -------------------------------------------------------
  useEffect(() => {
    fetchTodos();
    fetchSubjects();
  }, [fetchTodos, fetchSubjects]);

  // -------------------------------------------------------
  // Real-time subscription
  // -------------------------------------------------------
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
          fetchTodos();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.id, fetchTodos]);

  // -------------------------------------------------------
  // Computed: counts
  // -------------------------------------------------------
  const pendingCount = todos.filter((todo) => !todo.completed).length;
  const completedCount = todos.filter((todo) => todo.completed).length;

  // -------------------------------------------------------
  // Computed: filtered & sorted todos
  // -------------------------------------------------------
  const filteredTodos = todos
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
        toast.error(t('todos.addedSuccess') ? '' : '');
      } else {
        toast.success(t('todos.addedSuccess'));
        setAddModalOpen(false);
        resetAddForm();
        fetchTodos();
      }
    } catch {
      toast.error('');
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
  // Toggle complete/incomplete
  // -------------------------------------------------------
  const handleToggle = async (todo: UserTodo) => {
    setTogglingId(todo.id);
    try {
      const newCompleted = !todo.completed;
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
      } else {
        toast.success(t('todos.updatedSuccess'));
        // Optimistic update for faster UI
        setTodos((prev) =>
          prev.map((item) =>
            item.id === todo.id
              ? { ...item, completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null }
              : item
          )
        );
      }
    } catch {
      console.error('Toggle todo error');
    } finally {
      setTogglingId(null);
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
      {t(`todos.${category}`)}
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
        } ${overdue ? 'border-rose-300 dark:border-rose-800' : ''}`}
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

              {/* Delete button */}
              <div className="shrink-0">
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(todo.id)}
                      disabled={isDeleting}
                      className="rounded-md bg-rose-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-rose-700 transition-colors"
                    >
                      {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : t('todos.deleteConfirm')}
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(todo.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 dark:hover:text-rose-400 transition-all focus:opacity-100"
                    aria-label={t('todos.deleteConfirm')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
              {todo.due_date && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    overdue
                      ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                      : dueSoon
                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  <Calendar className="h-2.5 w-2.5" />
                  {overdue && <AlertCircle className="h-2.5 w-2.5" />}
                  {formatDueDate(todo.due_date, locale)}
                </span>
              )}

              {/* Subject name */}
              {todo.subject_name && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-[10px] font-semibold">
                  {todo.subject_name}
                </span>
              )}

              {/* Auto source indicator */}
              {todo.source === 'auto' && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 text-[9px] font-medium">
                  <Clock className="h-2 w-2" />
                  auto
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

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
            className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            dir={direction}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Plus className="h-5 w-5 text-sky-700 dark:text-sky-300" />
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
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  {t('todos.title')} *
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t('todos.titlePlaceholder')}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                  dir={direction}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !adding) handleAdd();
                  }}
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  {t('todos.descriptionPlaceholder')}
                </label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
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
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TodoPriority)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    dir={direction}
                  >
                    <option value="urgent">{t('todos.urgent')}</option>
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
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as TodoCategory)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    dir={direction}
                  >
                    <option value="study">{t('todos.study')}</option>
                    <option value="assignment">{t('todos.assignment')}</option>
                    <option value="review">{t('todos.review')}</option>
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
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                  dir="ltr"
                />
              </div>

              {/* Subject (optional) */}
              {subjects.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    Subject
                  </label>
                  <select
                    value={newSubjectId}
                    onChange={(e) => setNewSubjectId(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-colors"
                    dir={direction}
                  >
                    <option value="">{t('todos.noDueDate')}</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Submit button */}
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
  // Render: Empty state
  // -------------------------------------------------------
  const renderEmptyState = () => (
    <motion.div
      variants={itemVariants}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
        <ListTodo className="h-8 w-8 text-sky-700 dark:text-sky-300" />
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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
            <ListTodo className="h-5 w-5 text-sky-700 dark:text-sky-300" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              {t('todos.title')}
              <span className="inline-flex items-center justify-center rounded-full bg-sky-700 dark:bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('todos.pending')}: {pendingCount} · {t('todos.completed')}: {completedCount}
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
              <option value="urgent">{t('todos.urgent')}</option>
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
              <option value="review">{t('todos.review')}</option>
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
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
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
    </motion.div>
  );
}
