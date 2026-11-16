'use client';

// =====================================================
// DifficultySelector (v136) — shared quiz-difficulty picker
// =====================================================
//
// Five modes: easy / medium / hard / very_hard / mixed.
// - 'mixed' = teacher-controlled combination: exact per-level counts
//   (question types are then auto-distributed by the AI to fit each level).
// - Content scope: file_only (default) or beyond_file — available at ALL
//   difficulty levels (v136d). beyond_file lets the AI exceed the literal
//   text at any level, but every question stays anchored to the content's
//   topic (enforced in the prompt — no unrelated questions).

import { Layers, Minus, Plus } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';

export type DifficultyMode = 'easy' | 'medium' | 'hard' | 'very_hard' | 'mixed';
export type ContentScope = 'file_only' | 'beyond_file';

export interface DifficultyMixCounts {
  easy: number;
  medium: number;
  hard: number;
  very_hard: number;
}

export const DEFAULT_MIX_COUNTS: DifficultyMixCounts = { easy: 2, medium: 3, hard: 2, very_hard: 1 };

export function mixTotal(counts: DifficultyMixCounts): number {
  return counts.easy + counts.medium + counts.hard + counts.very_hard;
}

interface DifficultySelectorProps {
  difficulty: DifficultyMode;
  onDifficultyChange: (mode: DifficultyMode) => void;
  mixCounts: DifficultyMixCounts;
  onMixCountsChange: (counts: DifficultyMixCounts) => void;
  contentScope: ContentScope;
  onContentScopeChange: (scope: ContentScope) => void;
  disabled?: boolean;
}

/** Per-level tailwind classes (badge-style buttons). */
const LEVEL_STYLES: Record<Exclude<DifficultyMode, 'mixed'>, { active: string; dot: string }> = {
  easy: {
    active: 'bg-emerald-100 border-emerald-500 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  medium: {
    active: 'bg-sky-100 border-sky-500 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  hard: {
    active: 'bg-amber-100 border-amber-500 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  very_hard: {
    active: 'bg-rose-100 border-rose-500 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
};

const MIX_STYLE = {
  active: 'bg-violet-100 border-violet-500 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  dot: 'bg-violet-500',
};

export function DifficultySelector({
  difficulty,
  onDifficultyChange,
  mixCounts,
  onMixCountsChange,
  contentScope,
  onContentScopeChange,
  disabled = false,
}: DifficultySelectorProps) {
  const { t } = useTranslations();

  const levels: Array<{ key: Exclude<DifficultyMode, 'mixed'>; label: string }> = [
    { key: 'easy', label: t('quiz.difficultyEasy') },
    { key: 'medium', label: t('quiz.difficultyMedium') },
    { key: 'hard', label: t('quiz.difficultyHard') },
    { key: 'very_hard', label: t('quiz.difficultyVeryHard') },
  ];

  const handleDifficultyChange = (mode: DifficultyMode) => {
    if (disabled) return;
    onDifficultyChange(mode);
    // v136d: beyond_file is allowed at every level — no auto-downgrade.
    // The prompt layer keeps every question anchored to the content's topic.
  };

  return (
    <div className="space-y-3">
      {/* Difficulty level buttons */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('quiz.difficultyLevel')}</label>
        <div className="grid grid-cols-5 gap-1.5">
          {levels.map((lv) => {
            const isActive = difficulty === lv.key;
            return (
              <button
                key={lv.key}
                type="button"
                disabled={disabled}
                onClick={() => handleDifficultyChange(lv.key)}
                aria-pressed={isActive}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-1.5 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isActive
                    ? LEVEL_STYLES[lv.key].active
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? LEVEL_STYLES[lv.key].dot : 'bg-muted-foreground/40'}`} />
                {lv.label}
              </button>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleDifficultyChange('mixed')}
            aria-pressed={difficulty === 'mixed'}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-1.5 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              difficulty === 'mixed'
                ? MIX_STYLE.active
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            {t('quiz.difficultyMixed')}
          </button>
        </div>
      </div>

      {/* Mixed-mode distribution (teacher-controlled) */}
      {difficulty === 'mixed' && (
        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 dark:border-violet-900 dark:bg-violet-950/30">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">{t('quiz.mixDistribution')}</label>
            <span className="text-xs font-bold text-violet-700 dark:text-violet-300">
              {t('quiz.mixTotal', { count: mixTotal(mixCounts) })}
            </span>
          </div>
          {levels.map((lv) => (
            <div key={lv.key} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_STYLES[lv.key].dot}`} />
                {lv.label}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onMixCountsChange({ ...mixCounts, [lv.key]: Math.max(0, mixCounts[lv.key] - 1) })}
                  className="flex h-6 w-6 items-center justify-center rounded border text-muted-foreground hover:bg-muted transition-colors"
                  aria-label={`${lv.label} -`}
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-6 text-center text-sm font-bold text-foreground">{mixCounts[lv.key]}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onMixCountsChange({ ...mixCounts, [lv.key]: Math.min(30, mixCounts[lv.key] + 1) })}
                  className="flex h-6 w-6 items-center justify-center rounded border text-muted-foreground hover:bg-muted transition-colors"
                  aria-label={`${lv.label} +`}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t('quiz.mixAutoNote')}</p>
        </div>
      )}

      {/* Content scope */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('quiz.contentScope')}</label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onContentScopeChange('file_only')}
            aria-pressed={contentScope === 'file_only'}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              contentScope === 'file_only'
                ? 'border-teal-500 bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {t('quiz.scopeFileOnly')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onContentScopeChange(contentScope === 'beyond_file' ? 'file_only' : 'beyond_file')}
            aria-pressed={contentScope === 'beyond_file'}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              contentScope === 'beyond_file'
                ? 'border-fuchsia-500 bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {t('quiz.scopeBeyondFile')}
          </button>
        </div>
        {contentScope === 'beyond_file' && (
          <p className="text-xs text-muted-foreground">{t('quiz.scopeBeyondHint')}</p>
        )}
      </div>
    </div>
  );
}
