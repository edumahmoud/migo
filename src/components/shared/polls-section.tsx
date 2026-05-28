'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  Vote,
  Plus,
  Clock,
  Eye,
  EyeOff,
  Trash2,
  Users,
  CheckCircle,
  AlertCircle,
  MessageSquare,
  Star,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type {
  Poll,
  PollOption,
  PollResponse,
  PollType,
  PollStatus,
  UserProfile,
  Subject,
} from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogScrollArea,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface PollsSectionProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  subject: Subject;
}

// -------------------------------------------------------
// Extended types for joined data
// -------------------------------------------------------
interface PollWithOptions extends Poll {
  options?: PollOption[];
  responses?: PollResponse[];
}

// -------------------------------------------------------
// Animation variants
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
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function toLocalDatetimeValue(isoStr: string): string {
  try {
    const d = new Date(isoStr);
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

function toUTCISOString(localDatetime: string): string {
  const d = new Date(localDatetime);
  if (isNaN(d.getTime())) return localDatetime;
  return d.toISOString();
}

// -------------------------------------------------------
// Badge color maps
// -------------------------------------------------------
const typeBadgeColors: Record<PollType, string> = {
  vote: 'bg-sky-100 text-sky-700 dark:bg-sky-800/40 dark:text-sky-400',
  rating: 'bg-amber-100 text-amber-700 dark:bg-amber-800/40 dark:text-amber-500',
  open: 'bg-violet-100 text-violet-700 dark:bg-violet-800/40 dark:text-violet-500',
};

const statusBadgeColors: Record<PollStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-800/40 dark:text-emerald-500',
  closed: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-500',
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function PollsSection({ profile, role, subjectId, subject }: PollsSectionProps) {
  const { t, direction } = useTranslations('polls');
  const { t: tc } = useTranslations('common');

  // ─── Data state ───
  const [polls, setPolls] = useState<PollWithOptions[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPollId, setExpandedPollId] = useState<string | null>(null);

  // ─── Filter state ───
  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active');

  // ─── Create poll modal ───
  const [createOpen, setCreateOpen] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState<PollType>('vote');
  const [newOptions, setNewOptions] = useState<string[]>(['', '']);
  const [newIsAnonymous, setNewIsAnonymous] = useState(true);
  const [newClosesAt, setNewClosesAt] = useState('');
  const [creating, setCreating] = useState(false);

  // ─── Vote/Response state ───
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ─── Delete state ───
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // -------------------------------------------------------
  // Fetch polls
  // -------------------------------------------------------
  const fetchPolls = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch polls for this subject
      const { data: pollsData, error: pollsError } = await supabase
        .from('polls')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });

      if (pollsError) {
        console.error('Error fetching polls:', pollsError);
        setPolls([]);
        setLoading(false);
        return;
      }

      const pollsList = (pollsData as Poll[]) || [];
      if (pollsList.length === 0) {
        setPolls([]);
        setLoading(false);
        return;
      }

      // Fetch options for all polls
      const pollIds = pollsList.map((p) => p.id);
      const { data: optionsData } = await supabase
        .from('poll_options')
        .select('*')
        .in('poll_id', pollIds)
        .order('sort_order', { ascending: true });

      // Fetch responses for all polls
      const { data: responsesData } = await supabase
        .from('poll_responses')
        .select('*')
        .in('poll_id', pollIds);

      // Fetch creator names for non-anonymous polls
      const creatorIds = [...new Set(pollsList.map((p) => p.created_by))];
      const { data: creatorsData } = await supabase
        .from('users')
        .select('id, name')
        .in('id', creatorIds);

      const creatorsMap = new Map<string, string>();
      (creatorsData || []).forEach((c: { id: string; name: string }) => {
        creatorsMap.set(c.id, c.name);
      });

      // Assemble enriched polls
      const enriched: PollWithOptions[] = pollsList.map((poll) => {
        const pollOptions = ((optionsData as PollOption[]) || []).filter(
          (o) => o.poll_id === poll.id
        );
        const pollResponses = ((responsesData as PollResponse[]) || []).filter(
          (r) => r.poll_id === poll.id
        );

        // Calculate response counts per option
        const optionResponseCounts: Record<string, number> = {};
        pollResponses.forEach((r) => {
          if (r.option_id) {
            optionResponseCounts[r.option_id] = (optionResponseCounts[r.option_id] || 0) + 1;
          }
        });

        // Add response_count to options
        const optionsWithCounts = pollOptions.map((o) => ({
          ...o,
          response_count: optionResponseCounts[o.id] || 0,
        }));

        // Check if current user has responded
        const userHasResponded = pollResponses.some((r) => r.user_id === profile.id);

        return {
          ...poll,
          creator_name: poll.is_anonymous ? undefined : creatorsMap.get(poll.created_by),
          total_responses: pollResponses.length,
          user_has_responded: userHasResponded,
          options: optionsWithCounts,
          responses: pollResponses,
        };
      });

      setPolls(enriched);
    } catch (err) {
      console.error('Fetch polls error:', err);
      setPolls([]);
    } finally {
      setLoading(false);
    }
  }, [subjectId, profile.id]);

  // -------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------
  useEffect(() => {
    fetchPolls();
  }, [fetchPolls]);

  // -------------------------------------------------------
  // Real-time subscription for polls
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`polls-${subjectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'polls',
          filter: `subject_id=eq.${subjectId}`,
        },
        () => {
          fetchPolls();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'poll_options',
        },
        () => {
          fetchPolls();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'poll_responses',
        },
        () => {
          fetchPolls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [subjectId, fetchPolls]);

  // -------------------------------------------------------
  // Derived: active vs closed polls
  // -------------------------------------------------------
  const activePolls = polls.filter((p) => p.status === 'active');
  const closedPolls = polls.filter((p) => p.status === 'closed');
  const filteredPolls = activeTab === 'active' ? activePolls : closedPolls;

  // -------------------------------------------------------
  // Reset form state
  // -------------------------------------------------------
  const resetCreateForm = () => {
    setNewQuestion('');
    setNewDescription('');
    setNewType('vote');
    setNewOptions(['', '']);
    setNewIsAnonymous(true);
    setNewClosesAt('');
  };

  // -------------------------------------------------------
  // Create poll
  // -------------------------------------------------------
  const handleCreate = async () => {
    const question = newQuestion.trim();
    if (!question) {
      toast.error(t('question') || 'Question is required');
      return;
    }

    if (newType === 'vote') {
      const validOptions = newOptions.filter((o) => o.trim());
      if (validOptions.length < 2) {
        toast.error(t('options') || 'At least 2 options required');
        return;
      }
    }

    setCreating(true);
    try {
      // Insert poll
      const { data: pollData, error: pollError } = await supabase
        .from('polls')
        .insert({
          subject_id: subjectId,
          created_by: profile.id,
          question,
          description: newDescription.trim() || null,
          type: newType,
          is_anonymous: newIsAnonymous,
          status: 'active',
          closes_at: newClosesAt ? toUTCISOString(newClosesAt) : null,
        })
        .select('id')
        .single();

      if (pollError) {
        console.error('Error creating poll:', pollError);
        toast.error(tc('unexpectedError'));
        return;
      }

      // Insert options for vote type
      if (newType === 'vote' && pollData) {
        const validOptions = newOptions
          .filter((o) => o.trim())
          .map((o, i) => ({
            poll_id: pollData.id,
            option_text: o.trim(),
            sort_order: i,
          }));

        const { error: optionsError } = await supabase
          .from('poll_options')
          .insert(validOptions);

        if (optionsError) {
          console.error('Error creating options:', optionsError);
          toast.error(tc('unexpectedError'));
          return;
        }
      }

      toast.success(tc('success'));
      setCreateOpen(false);
      resetCreateForm();
      fetchPolls();
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setCreating(false);
    }
  };

  // -------------------------------------------------------
  // Submit vote (vote type)
  // -------------------------------------------------------
  const handleVote = async (pollId: string) => {
    if (!selectedOptionId) {
      toast.error(t('voteNow') || 'Please select an option');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('poll_responses').insert({
        poll_id: pollId,
        option_id: selectedOptionId,
        user_id: profile.id,
      });

      if (error) {
        if (error.code === '23505') {
          toast.error(t('alreadyResponded') || 'You have already responded');
        } else {
          console.error('Error voting:', error);
          toast.error(tc('unexpectedError'));
        }
      } else {
        toast.success(tc('success'));
        setSelectedOptionId(null);
        fetchPolls();
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Submit rating (rating type)
  // -------------------------------------------------------
  const handleRate = async (pollId: string) => {
    if (ratingValue < 1 || ratingValue > 5) {
      toast.error(t('submitRating') || 'Please select a rating');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('poll_responses').insert({
        poll_id: pollId,
        user_id: profile.id,
        rating_value: ratingValue,
      });

      if (error) {
        if (error.code === '23505') {
          toast.error(t('alreadyResponded') || 'You have already responded');
        } else {
          console.error('Error rating:', error);
          toast.error(tc('unexpectedError'));
        }
      } else {
        toast.success(tc('success'));
        setRatingValue(0);
        setHoverRating(0);
        fetchPolls();
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Submit text response (open type)
  // -------------------------------------------------------
  const handleOpenResponse = async (pollId: string) => {
    if (!responseText.trim()) {
      toast.error(t('submitResponse') || 'Please enter a response');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('poll_responses').insert({
        poll_id: pollId,
        user_id: profile.id,
        response_text: responseText.trim(),
      });

      if (error) {
        if (error.code === '23505') {
          toast.error(t('alreadyResponded') || 'You have already responded');
        } else {
          console.error('Error submitting response:', error);
          toast.error(tc('unexpectedError'));
        }
      } else {
        toast.success(tc('success'));
        setResponseText('');
        fetchPolls();
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------
  // Close poll (creator only)
  // -------------------------------------------------------
  const handleClosePoll = async (pollId: string) => {
    try {
      const { error } = await supabase
        .from('polls')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('id', pollId);

      if (error) {
        console.error('Error closing poll:', error);
        toast.error(tc('unexpectedError'));
      } else {
        toast.success(tc('success'));
        fetchPolls();
      }
    } catch {
      toast.error(tc('unexpectedError'));
    }
  };

  // -------------------------------------------------------
  // Delete poll (creator only)
  // -------------------------------------------------------
  const handleDeletePoll = async (pollId: string) => {
    setDeletingId(pollId);
    try {
      const { error } = await supabase.from('polls').delete().eq('id', pollId);

      if (error) {
        console.error('Error deleting poll:', error);
        toast.error(tc('unexpectedError'));
      } else {
        toast.success(tc('success'));
        if (expandedPollId === pollId) setExpandedPollId(null);
        fetchPolls();
      }
    } catch {
      toast.error(tc('unexpectedError'));
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  // -------------------------------------------------------
  // Add/remove options in create form
  // -------------------------------------------------------
  const handleAddOption = () => {
    setNewOptions([...newOptions, '']);
  };

  const handleRemoveOption = (index: number) => {
    if (newOptions.length <= 2) return;
    setNewOptions(newOptions.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, value: string) => {
    const updated = [...newOptions];
    updated[index] = value;
    setNewOptions(updated);
  };

  // -------------------------------------------------------
  // Calculate rating average
  // -------------------------------------------------------
  const getAverageRating = (poll: PollWithOptions): number => {
    if (!poll.responses || poll.responses.length === 0) return 0;
    const sum = poll.responses.reduce((acc, r) => acc + (r.rating_value || 0), 0);
    return Math.round((sum / poll.responses.length) * 10) / 10;
  };

  // -------------------------------------------------------
  // Toggle expanded poll
  // -------------------------------------------------------
  const handleToggleExpand = (pollId: string) => {
    if (expandedPollId === pollId) {
      setExpandedPollId(null);
    } else {
      setExpandedPollId(pollId);
      setSelectedOptionId(null);
      setRatingValue(0);
      setHoverRating(0);
      setResponseText('');
    }
  };

  // -------------------------------------------------------
  // Render: Type icon
  // -------------------------------------------------------
  const getTypeIcon = (type: PollType) => {
    switch (type) {
      case 'vote':
        return <Vote className="h-3.5 w-3.5" />;
      case 'rating':
        return <Star className="h-3.5 w-3.5" />;
      case 'open':
        return <MessageSquare className="h-3.5 w-3.5" />;
    }
  };

  // -------------------------------------------------------
  // Render: Create Poll Modal
  // -------------------------------------------------------
  const renderCreateModal = () => (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="sm:max-w-lg" dir={direction}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-800/40">
              <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" />
            </div>
            {t('create')}
          </DialogTitle>
          <DialogDescription>
            {t('createDesc') || 'Create a new poll for this subject'}
          </DialogDescription>
        </DialogHeader>

        <DialogScrollArea className="space-y-5">
          {/* Question */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              {t('question')} <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder={t('questionPlaceholder') || 'Enter your question...'}
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
              dir={direction}
              disabled={creating}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              {t('description') || 'Description'}
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder') || 'Optional description...'}
              rows={2}
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all resize-none"
              dir={direction}
              disabled={creating}
            />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              {t('type')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['vote', 'rating', 'open'] as PollType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setNewType(type);
                    if (type !== 'vote') setNewOptions(['', '']);
                  }}
                  disabled={creating}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-sm font-medium transition-all ${
                    newType === type
                      ? 'border-sky-600 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-500'
                      : 'border-border text-muted-foreground hover:border-foreground/20 hover:bg-muted/50'
                  }`}
                >
                  {getTypeIcon(type)}
                  {t(type)}
                </button>
              ))}
            </div>
          </div>

          {/* Options (vote type only) */}
          {newType === 'vote' && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                {t('options')} <span className="text-rose-500">*</span>
              </label>
              <div className="space-y-2">
                {newOptions.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`${t('option') || 'Option'} ${index + 1}`}
                      className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
                      dir={direction}
                      disabled={creating}
                    />
                    {newOptions.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(index)}
                        disabled={creating}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddOption}
                disabled={creating || newOptions.length >= 10}
                className="flex items-center gap-1.5 text-sm font-medium text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200 transition-colors disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {t('addOption')}
              </button>
            </div>
          )}

          {/* Anonymous toggle */}
          <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-3">
              {newIsAnonymous ? (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {newIsAnonymous ? t('anonymous') : t('public')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {newIsAnonymous
                    ? (t('anonymousDesc') || 'Responses are anonymous')
                    : (t('publicDesc') || 'Responses are visible to the creator')}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={newIsAnonymous}
              onClick={() => setNewIsAnonymous(!newIsAnonymous)}
              disabled={creating}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600/30 ${
                newIsAnonymous ? 'bg-sky-700' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                  newIsAnonymous ? 'translate-x-5' : 'translate-x-0.5'
                } mt-0.5`}
              />
            </button>
          </div>

          {/* Close date */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              {t('closesAt')} <span className="text-xs text-muted-foreground font-normal">({t('optional') || 'optional'})</span>
            </label>
            <input
              type="datetime-local"
              value={newClosesAt}
              onChange={(e) => setNewClosesAt(e.target.value)}
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
              dir="ltr"
              disabled={creating}
            />
          </div>
        </DialogScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setCreateOpen(false)}
            disabled={creating}
          >
            {tc('cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !newQuestion.trim()}
            className="bg-sky-700 hover:bg-sky-800 text-white"
          >
            {creating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {tc('creating')}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t('create')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // -------------------------------------------------------
  // Render: Delete Confirm Dialog
  // -------------------------------------------------------
  const renderDeleteConfirm = () => (
    <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
      <DialogContent className="sm:max-w-sm" dir={direction}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-800/40">
              <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-500" />
            </div>
            {t('deleteConfirm') || 'Delete Poll?'}
          </DialogTitle>
          <DialogDescription>
            {t('deleteConfirmDesc') || 'This action cannot be undone. All responses will be deleted.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteConfirmId(null)}
            disabled={!!deletingId}
          >
            {tc('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteConfirmId && handleDeletePoll(deleteConfirmId)}
            disabled={!!deletingId}
          >
            {deletingId ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {tc('deleting')}
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                {tc('delete')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // -------------------------------------------------------
  // Render: Vote Results (bar chart)
  // -------------------------------------------------------
  const renderVoteResults = (poll: PollWithOptions) => {
    const options = poll.options || [];
    const totalResponses = poll.total_responses || 0;

    return (
      <div className="space-y-3 mt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" />
          {t('results')}
          <span className="text-muted-foreground font-normal">
            ({t('totalResponses')}: {totalResponses})
          </span>
        </div>

        {options.map((option) => {
          const count = option.response_count || 0;
          const percentage = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;

          return (
            <div key={option.id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground font-medium truncate me-2">
                  {option.option_text}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {count} ({percentage}%)
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted/60 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="h-full rounded-full bg-sky-600 dark:bg-sky-500"
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Rating Results
  // -------------------------------------------------------
  const renderRatingResults = (poll: PollWithOptions) => {
    const avg = getAverageRating(poll);
    const totalResponses = poll.total_responses || 0;

    // Count per star
    const starCounts = [0, 0, 0, 0, 0];
    (poll.responses || []).forEach((r) => {
      if (r.rating_value && r.rating_value >= 1 && r.rating_value <= 5) {
        starCounts[r.rating_value - 1]++;
      }
    });

    return (
      <div className="space-y-3 mt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Star className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          {t('results')}
        </div>

        {/* Average display */}
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <div className="text-3xl font-bold text-foreground">{avg}</div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-4 w-4 ${
                    star <= Math.round(avg)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-muted-foreground/40'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('averageRating')}: {avg}/5 · {t('totalResponses')}: {totalResponses}
            </p>
          </div>
        </div>

        {/* Star distribution */}
        <div className="space-y-1.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = starCounts[star - 1];
            const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;

            return (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-3 text-muted-foreground">{star}</span>
                <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="h-full rounded-full bg-amber-400"
                  />
                </div>
                <span className="text-muted-foreground w-8 text-end">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Open Results (text list)
  // -------------------------------------------------------
  const renderOpenResults = (poll: PollWithOptions) => {
    const responses = poll.responses || [];

    return (
      <div className="space-y-3 mt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MessageSquare className="h-4 w-4 text-violet-600 dark:text-violet-500" />
          {t('results')}
          <span className="text-muted-foreground font-normal">
            ({t('totalResponses')}: {responses.length})
          </span>
        </div>

        {responses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('noResponses') || 'No responses yet'}
          </p>
        ) : (
          <div className="max-h-60 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {responses.map((r, i) => (
              <div
                key={r.id}
                className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-foreground"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {poll.is_anonymous
                      ? `${t('anonymous') || 'Anonymous'} ${i + 1}`
                      : (t('response') || 'Response') + ` ${i + 1}`}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words">{r.response_text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------
  // Render: Vote input (for non-responded active polls)
  // -------------------------------------------------------
  const renderVoteInput = (poll: PollWithOptions) => (
    <div className="space-y-3 mt-4">
      <p className="text-sm font-medium text-foreground">{t('voteNow')}:</p>
      <div className="space-y-2">
        {(poll.options || []).map((option) => (
          <label
            key={option.id}
            className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
              selectedOptionId === option.id
                ? 'border-sky-600 bg-sky-50 dark:bg-sky-900/30 dark:border-sky-500'
                : 'border-border hover:border-foreground/20 hover:bg-muted/30'
            }`}
          >
            <input
              type="radio"
              name={`poll-${poll.id}`}
              value={option.id}
              checked={selectedOptionId === option.id}
              onChange={() => setSelectedOptionId(option.id)}
              disabled={submitting}
              className="h-4 w-4 text-sky-600 focus:ring-sky-600/30 border-muted"
            />
            <span className="text-sm text-foreground">{option.option_text}</span>
          </label>
        ))}
      </div>
      <Button
        onClick={() => handleVote(poll.id)}
        disabled={submitting || !selectedOptionId}
        className="bg-sky-700 hover:bg-sky-800 text-white w-full sm:w-auto"
      >
        {submitting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {tc('submitting')}
          </>
        ) : (
          <>
            <Vote className="h-4 w-4" />
            {t('voteNow')}
          </>
        )}
      </Button>
    </div>
  );

  // -------------------------------------------------------
  // Render: Rating input
  // -------------------------------------------------------
  const renderRatingInput = (poll: PollWithOptions) => (
    <div className="space-y-3 mt-4">
      <p className="text-sm font-medium text-foreground">{t('submitRating')}:</p>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRatingValue(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
            disabled={submitting}
            className="transition-transform hover:scale-110 active:scale-95"
          >
            <Star
              className={`h-8 w-8 transition-colors ${
                star <= (hoverRating || ratingValue)
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/30 hover:text-amber-300'
              }`}
            />
          </button>
        ))}
        {ratingValue > 0 && (
          <span className="text-sm font-medium text-foreground ms-2">{ratingValue}/5</span>
        )}
      </div>
      <Button
        onClick={() => handleRate(poll.id)}
        disabled={submitting || ratingValue < 1}
        className="bg-sky-700 hover:bg-sky-800 text-white w-full sm:w-auto"
      >
        {submitting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {tc('submitting')}
          </>
        ) : (
          <>
            <Star className="h-4 w-4" />
            {t('submitRating')}
          </>
        )}
      </Button>
    </div>
  );

  // -------------------------------------------------------
  // Render: Open text input
  // -------------------------------------------------------
  const renderOpenInput = (poll: PollWithOptions) => (
    <div className="space-y-3 mt-4">
      <p className="text-sm font-medium text-foreground">{t('submitResponse')}:</p>
      <textarea
        value={responseText}
        onChange={(e) => setResponseText(e.target.value)}
        placeholder={t('responsePlaceholder') || 'Type your response...'}
        rows={3}
        className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all resize-none"
        dir={direction}
        disabled={submitting}
      />
      <Button
        onClick={() => handleOpenResponse(poll.id)}
        disabled={submitting || !responseText.trim()}
        className="bg-sky-700 hover:bg-sky-800 text-white w-full sm:w-auto"
      >
        {submitting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {tc('submitting')}
          </>
        ) : (
          <>
            <MessageSquare className="h-4 w-4" />
            {t('submitResponse')}
          </>
        )}
      </Button>
    </div>
  );

  // -------------------------------------------------------
  // Render: Expanded poll detail
  // -------------------------------------------------------
  const renderExpandedPoll = (poll: PollWithOptions) => {
    const isCreator = poll.created_by === profile.id;
    const isClosed = poll.status === 'closed';
    const hasResponded = poll.user_has_responded;
    const canRespond = !isClosed && !hasResponded;

    return (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="overflow-hidden border-t bg-muted/20 px-4 py-4"
      >
        {/* Description */}
        {poll.description && (
          <p className="text-sm text-muted-foreground mb-3">{poll.description}</p>
        )}

        {/* Response area or results */}
        {canRespond ? (
          <>
            {poll.type === 'vote' && renderVoteInput(poll)}
            {poll.type === 'rating' && renderRatingInput(poll)}
            {poll.type === 'open' && renderOpenInput(poll)}
          </>
        ) : null}

        {/* Already responded message */}
        {hasResponded && !isClosed && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500 mb-2">
            <CheckCircle className="h-4 w-4" />
            {t('alreadyResponded') || 'You have already responded'}
          </div>
        )}

        {/* Show results always for responded/closed polls, or for teacher/creator */}
        {(hasResponded || isClosed || isCreator) && (
          <>
            {poll.type === 'vote' && renderVoteResults(poll)}
            {poll.type === 'rating' && renderRatingResults(poll)}
            {poll.type === 'open' && renderOpenResults(poll)}
          </>
        )}

        {/* Creator actions */}
        {isCreator && (
          <div className="flex items-center gap-2 mt-4 pt-3 border-t">
            {!isClosed && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClosePoll(poll.id)}
                className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-500 dark:border-amber-700 dark:hover:bg-amber-900/30"
              >
                <Clock className="h-3.5 w-3.5" />
                {t('closePoll')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmId(poll.id)}
              className="text-rose-600 border-rose-300 hover:bg-rose-50 dark:text-rose-500 dark:border-rose-700 dark:hover:bg-rose-900/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {tc('delete')}
            </Button>
          </div>
        )}
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render: Poll Card
  // -------------------------------------------------------
  const renderPollCard = (poll: PollWithOptions) => {
    const isExpanded = expandedPollId === poll.id;
    const isCreator = poll.created_by === profile.id;
    const isClosed = poll.status === 'closed';

    return (
      <motion.div key={poll.id} variants={itemVariants}>
        <div
          className={`group rounded-xl border bg-card shadow-sm transition-all overflow-hidden ${
            isExpanded
              ? 'ring-2 ring-sky-600/30 shadow-md'
              : 'hover:shadow-md cursor-pointer'
          }`}
        >
          {/* Card header (clickable) */}
          <div
            className="p-4"
            onClick={() => handleToggleExpand(poll.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggleExpand(poll.id);
              }
            }}
          >
            {/* Top row: badges */}
            <div className="flex items-center flex-wrap gap-1.5 mb-2">
              {/* Type badge */}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${typeBadgeColors[poll.type]}`}
              >
                {getTypeIcon(poll.type)}
                {t(poll.type)}
              </span>

              {/* Status badge */}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeColors[poll.status]}`}
              >
                {isClosed ? (
                  <Clock className="h-2.5 w-2.5" />
                ) : (
                  <CheckCircle className="h-2.5 w-2.5" />
                )}
                {t(poll.status)}
              </span>

              {/* Anonymous badge */}
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-500">
                {poll.is_anonymous ? (
                  <EyeOff className="h-2.5 w-2.5" />
                ) : (
                  <Eye className="h-2.5 w-2.5" />
                )}
                {poll.is_anonymous ? t('anonymous') : t('public')}
              </span>

              {/* Already responded indicator */}
              {poll.user_has_responded && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-800/40 dark:text-emerald-500">
                  <CheckCircle className="h-2.5 w-2.5" />
                  {t('responded') || 'Responded'}
                </span>
              )}
            </div>

            {/* Question */}
            <h3 className="text-sm font-semibold text-foreground mb-2 line-clamp-2">
              {poll.question}
            </h3>

            {/* Bottom row: metadata */}
            <div className="flex items-center flex-wrap gap-3 text-xs text-muted-foreground">
              {/* Creator name */}
              {!poll.is_anonymous && poll.creator_name && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {t('createdBy')}: {poll.creator_name}
                </span>
              )}

              {/* Response count */}
              <span className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                {poll.total_responses || 0}
              </span>

              {/* Closes at */}
              {poll.closes_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t('closesAt')}: {formatDate(poll.closes_at)}
                </span>
              )}
            </div>
          </div>

          {/* Expanded content */}
          <AnimatePresence>
            {isExpanded && renderExpandedPoll(poll)}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Main Render
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
      dir={direction}
    >
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold text-foreground">{t('title')}</h2>
          <p className="text-muted-foreground mt-1">
            {polls.length} {t('title').toLowerCase()}
          </p>
        </div>
        {role === 'teacher' && (
          <button
            onClick={() => {
              resetCreateForm();
              setCreateOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-800 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            {t('create')}
          </button>
        )}
      </motion.div>

      {/* Active / Closed Tabs */}
      <motion.div
        variants={itemVariants}
        className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit"
      >
        <button
          onClick={() => setActiveTab('active')}
          className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all ${
            activeTab === 'active'
              ? 'bg-sky-700 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          <CheckCircle className="h-3.5 w-3.5" />
          {t('active')}
          <span
            className={`text-xs rounded-full px-1.5 py-0.5 ${
              activeTab === 'active' ? 'bg-white/20' : 'bg-muted'
            }`}
          >
            {activePolls.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('closed')}
          className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all ${
            activeTab === 'closed'
              ? 'bg-gray-600 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          {t('closed')}
          <span
            className={`text-xs rounded-full px-1.5 py-0.5 ${
              activeTab === 'closed' ? 'bg-white/20' : 'bg-muted'
            }`}
          >
            {closedPolls.length}
          </span>
        </button>
      </motion.div>

      {/* Polls grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="h-8 w-8 animate-spin rounded-full border-3 border-sky-700 border-t-transparent dark:border-sky-300" />
        </div>
      ) : filteredPolls.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 mb-4">
            <BarChart3 className="h-8 w-8 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">{t('noPolls')}</p>
          <p className="text-sm text-muted-foreground">{t('noPollsDesc')}</p>
        </motion.div>
      ) : (
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {filteredPolls.map(renderPollCard)}
        </motion.div>
      )}

      {/* Create Poll Modal */}
      {renderCreateModal()}

      {/* Delete Confirm Dialog */}
      {renderDeleteConfirm()}
    </motion.div>
  );
}
