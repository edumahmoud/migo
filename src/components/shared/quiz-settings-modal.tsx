'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Loader2,
  CheckCircle2,
  Clock,
  Shuffle,
  RotateCcw,
  Eye,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import type { Quiz } from '@/lib/types';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface QuizSettingsModalProps {
  quiz: Quiz;
  open: boolean;
  onClose: () => void;
  onUpdate: (updates: Partial<Quiz>) => void;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const sectionVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3, ease: 'easeOut' as const },
  }),
};

// -------------------------------------------------------
// Toggle Switch Sub-component
// -------------------------------------------------------
function ToggleSwitch({
  label,
  description,
  icon,
  checked,
  onChange,
  disabled,
  dir,
}: {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  dir: 'rtl' | 'ltr';
}) {
  const isRTL = dir === 'rtl';

  // RTL: OFF = thumb on right (translate-x-5), ON = thumb on left (translate-x-0)
  // LTR: OFF = thumb on left (translate-x-0), ON = thumb on right (translate-x-5)
  const thumbTranslate = checked
    ? isRTL ? 'translate-x-0' : 'translate-x-5'
    : isRTL ? 'translate-x-5' : 'translate-x-0';

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-3 gap-3" dir={dir}>
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-800/40">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-teal-600' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${thumbTranslate}`}
        />
      </button>
    </div>
  );
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------
export default function QuizSettingsModal({
  quiz,
  open,
  onClose,
  onUpdate,
}: QuizSettingsModalProps) {
  const { t, direction } = useTranslations();
  const [allowRetake, setAllowRetake] = useState(quiz.allow_retake ?? true);
  const [showResults, setShowResults] = useState(quiz.show_results ?? true);
  const [shuffleQuestions, setShuffleQuestions] = useState(quiz.shuffle_questions ?? true);
  const [duration, setDuration] = useState(quiz.duration?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  // Reset local state when quiz prop changes (using key pattern on the Dialog instead)
  // This avoids the lint error about calling setState in useEffect

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        allow_retake: allowRetake,
        show_results: showResults,
        // NOTE: shuffle_questions is NOT a DB column — it's client-side only.
        // We do NOT send it to the server. The quiz-view.tsx handles shuffling locally.
      };

      const dur = parseInt(duration, 10);
      if (!isNaN(dur) && dur > 0) {
        updates.duration = dur;
      } else if (duration === '') {
        updates.duration = null;
      }

      const res = await fetch('/api/quizzes', {
        method: 'PUT',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ quizId: quiz.id, updates }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Merge the local shuffle setting with the server response
        const updatedQuiz = { ...data.data, shuffle_questions: shuffleQuestions } as Partial<Quiz>;
        toast.success(t('quiz.quizUpdated'));
        onUpdate(updatedQuiz);
        onClose();
      } else {
        toast.error(data.error || t('common.unexpectedError'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }} key={quiz.id}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" dir={direction}>
        <DialogHeader className="text-end">
          <DialogTitle className="flex items-center gap-2 text-end">
            <Settings className="h-5 w-5 text-teal-600" />
            {t('quiz.quizSettings')}
          </DialogTitle>
          <DialogDescription className="text-end">
            {t('quiz.editQuiz')}: &quot;{quiz.title}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* ── Quiz Info ── */}
          <motion.div
            className="rounded-lg bg-teal-50/70 dark:bg-teal-900/20 border border-teal-100 p-3"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            <p className="text-xs text-teal-600 dark:text-teal-500 mb-1">{t('quiz.quiz')}</p>
            <p className="text-sm font-medium text-teal-800 dark:text-teal-500 truncate">{quiz.title}</p>
            <p className="text-xs text-teal-600/70 mt-1">
              {quiz.questions?.length || 0} {t('quiz.question')}
            </p>
          </motion.div>

          {/* ── Toggles Section ── */}
          <motion.div
            className="space-y-3"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={1}
          >
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-teal-600" />
              <h3 className="text-sm font-semibold text-foreground">{t('quiz.quizSettings')}</h3>
            </div>

            <ToggleSwitch
              label={t('quiz.allowRetake')}
              description={t('quiz.allowRetake')}
              icon={<RotateCcw className="h-4 w-4 text-teal-600 dark:text-teal-500" />}
              checked={allowRetake}
              onChange={setAllowRetake}
              disabled={saving}
              dir={direction}
            />

            <ToggleSwitch
              label={t('quiz.showResults')}
              description={t('quiz.showResultsAfter')}
              icon={<Eye className="h-4 w-4 text-teal-600 dark:text-teal-500" />}
              checked={showResults}
              onChange={setShowResults}
              disabled={saving}
              dir={direction}
            />

            <ToggleSwitch
              label={t('quiz.shuffleQuestions')}
              description={t('quiz.shuffleOptions')}
              icon={<Shuffle className="h-4 w-4 text-teal-600 dark:text-teal-500" />}
              checked={shuffleQuestions}
              onChange={setShuffleQuestions}
              disabled={saving}
              dir={direction}
            />
          </motion.div>

          <Separator />

          {/* ── Duration Section ── */}
          <motion.div
            className="space-y-3"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={2}
          >
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-teal-600" />
              <h3 className="text-sm font-semibold text-foreground">{t('quiz.quizDuration')}</h3>
            </div>

            <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-800/40">
                <Clock className="h-4 w-4 text-teal-600 dark:text-teal-500" />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">{t('quiz.duration')}</Label>
                <p className="text-[10px] text-muted-foreground/70">{t('quiz.noDuration')}</p>
              </div>
              <Input
                type="number"
                min="1"
                max="180"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="—"
                className="w-20 text-center"
                dir="ltr"
                disabled={saving}
              />
            </div>
          </motion.div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-teal-600 hover:bg-teal-700 text-white gap-2"
          >
                {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common.loading')}...
              </span>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {t('common.save')}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="border-teal-300 text-teal-700 hover:bg-teal-50 dark:text-teal-500 dark:border-teal-900/60 dark:hover:bg-teal-900/20"
          >
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
