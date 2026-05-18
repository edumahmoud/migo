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
}: {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-3 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/50">
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
          className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
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
        shuffle_questions: shuffleQuestions,
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
        toast.success('تم تحديث إعدادات الاختبار بنجاح');
        onUpdate(data.data as Partial<Quiz>);
        onClose();
      } else {
        toast.error(data.error || 'فشل تحديث إعدادات الاختبار');
      }
    } catch {
      toast.error('حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }} key={quiz.id}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-right">
            <Settings className="h-5 w-5 text-teal-600" />
            إعدادات الاختبار
          </DialogTitle>
          <DialogDescription className="text-right">
            تعديل إعدادات &quot;{quiz.title}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* ── Quiz Info ── */}
          <motion.div
            className="rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-100 p-3"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            <p className="text-xs text-teal-600 dark:text-teal-400 mb-1">الاختبار</p>
            <p className="text-sm font-medium text-teal-800 dark:text-teal-300 truncate">{quiz.title}</p>
            <p className="text-xs text-teal-600/70 mt-1">
              {quiz.questions?.length || 0} سؤال
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
              <h3 className="text-sm font-semibold text-foreground">خيارات الاختبار</h3>
            </div>

            <ToggleSwitch
              label="السماح بإعادة الاختبار"
              description="السماح للطلاب بإعادة الاختبار بعد إكماله"
              icon={<RotateCcw className="h-4 w-4 text-teal-600 dark:text-teal-400" />}
              checked={allowRetake}
              onChange={setAllowRetake}
              disabled={saving}
            />

            <ToggleSwitch
              label="عرض النتائج"
              description="إظهار النتائج والإجابات الصحيحة بعد الاختبار"
              icon={<Eye className="h-4 w-4 text-teal-600 dark:text-teal-400" />}
              checked={showResults}
              onChange={setShowResults}
              disabled={saving}
            />

            <ToggleSwitch
              label="ترتيب عشوائي للأسئلة"
              description="عرض الأسئلة بترتيب مختلف لكل طالب"
              icon={<Shuffle className="h-4 w-4 text-teal-600 dark:text-teal-400" />}
              checked={shuffleQuestions}
              onChange={setShuffleQuestions}
              disabled={saving}
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
              <h3 className="text-sm font-semibold text-foreground">المدة الزمنية</h3>
            </div>

            <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/50">
                <Clock className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">المدة بالدقائق</Label>
                <p className="text-[10px] text-muted-foreground/70">اتركه فارغاً بدون وقت محدد</p>
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
                جاري الحفظ...
              </span>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                حفظ الإعدادات
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="border-teal-300 text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:border-teal-800 dark:hover:bg-teal-950/30"
          >
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
