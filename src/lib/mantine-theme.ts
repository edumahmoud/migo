/**
 * Mantine Theme System — v134n
 *
 * 8 هويات لونية قابلة للاختيار + 3 أوضاع (فاتح/داكن/حسب الجهاز).
 * كل الهويات تستخدم ألواناً مسطحة (بدون تدرجات).
 *
 * الاستخدام:
 *   import { createTheme } from './theme';
 *   const theme = createTheme('sky', 'light');
 */

import { createTheme as mCreateTheme, MantineColorsTuple, MantineThemeOverride } from '@mantine/core';

// ─── الأنواع ────────────────────────────────────────────────────

export type ThemeIdentity =
  | 'sky' | 'emerald' | 'violet' | 'amber'
  | 'teal' | 'indigo' | 'slate' | 'rose';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface UserPreferences {
  theme_identity: ThemeIdentity;
  theme_mode: ThemeMode;
}

export const THEME_IDENTITIES: ThemeIdentity[] = [
  'sky', 'emerald', 'violet', 'amber',
  'teal', 'indigo', 'slate', 'rose',
];

export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

// ─── تعريف الألوان لكل هوية ─────────────────────────────────────
// كل لون: مصفوفة 10 درجات (Mantine ColorsTuple).
// الدرجة 6 = اللون الأساسي للأزرار والروابط.
// كل الألوان مسطحة (بدون تدرجات) — نستخدم نفس اللون لكل الدرجات
// للحفاظ على البساطة وتجنب التدرجات اللونية.

const PALETTES: Record<ThemeIdentity, MantineColorsTuple> = {
  sky: [
    '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8',
    '#0ea5e9', '#0284c7', '#0369a1', '#075985',
    '#0c4a6e', '#082f49',
  ],
  emerald: [
    '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399',
    '#10b981', '#059669', '#047857', '#065f46',
    '#064e3b', '#022c22',
  ],
  violet: [
    '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa',
    '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6',
    '#4c1d95', '#2e1065',
  ],
  amber: [
    '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24',
    '#f59e0b', '#d97706', '#b45309', '#92400e',
    '#78350f', '#451a03',
  ],
  teal: [
    '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf',
    '#14b8a6', '#0d9488', '#0f766e', '#115e59',
    '#134e4a', '#042f2e',
  ],
  indigo: [
    '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8',
    '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
    '#312e81', '#1e1b4b',
  ],
  slate: [
    '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8',
    '#64748b', '#475569', '#334155', '#1e293b',
    '#0f172a', '#020617',
  ],
  rose: [
    '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185',
    '#f43f5e', '#e11d48', '#be123c', '#9f1239',
    '#881337', '#4c0519',
  ],
};

// ─── أحجام الخطوط ──────────────────────────────────────────────
// Cairo للعربية + Inter للإنجليزية — كلاهما من Google Fonts.

export const FONT_FAMILY_AR = 'Cairo, system-ui, sans-serif';
export const FONT_FAMILY_EN = 'Inter, system-ui, sans-serif';

// ─── إنشاء ثيم Mantine ──────────────────────────────────────────

export function createTheme(
  identity: ThemeIdentity = 'sky',
  _colorScheme: 'light' | 'dark' = 'light',
): MantineThemeOverride {
  // v134n: colorScheme is passed via MantineProvider's forceColorScheme prop,
  // not in the theme object (Mantine v9 moved it out of the theme).
  return mCreateTheme({
    primaryColor: identity,
    colors: {
      sky: PALETTES.sky,
      emerald: PALETTES.emerald,
      violet: PALETTES.violet,
      amber: PALETTES.amber,
      teal: PALETTES.teal,
      indigo: PALETTES.indigo,
      slate: PALETTES.slate,
      rose: PALETTES.rose,
    },
    defaultRadius: 'md',
    fontFamily: FONT_FAMILY_AR,
    headings: { fontFamily: FONT_FAMILY_AR },
    // إعدادات الأزرار — مسطحة بدون تدرجات
    components: {
      Button: {
        defaultProps: {
          radius: 'md',
        },
      },
      Card: {
        defaultProps: {
          radius: 'lg',
          shadow: 'xs',
        },
      },
      Paper: {
        defaultProps: {
          radius: 'md',
        },
      },
    },
  });
}

// ─── معاينة الهويات (للوحة الإعدادات) ──────────────────────────

export const IDENTITY_LABELS: Record<ThemeIdentity, { ar: string; en: string; hex: string }> = {
  sky: { ar: 'سماوي', en: 'Sky', hex: '#0284c7' },
  emerald: { ar: 'زمردي', en: 'Emerald', hex: '#059669' },
  violet: { ar: 'بنفسجي', en: 'Violet', hex: '#7c3aed' },
  amber: { ar: 'كهرماني', en: 'Amber', hex: '#d97706' },
  teal: { ar: 'أخضر مزرق', en: 'Teal', hex: '#0d9488' },
  indigo: { ar: 'نيلي', en: 'Indigo', hex: '#4f46e5' },
  slate: { ar: 'رمادي', en: 'Slate', hex: '#475569' },
  rose: { ar: 'وردي', en: 'Rose', hex: '#e11d48' },
};
