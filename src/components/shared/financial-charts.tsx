'use client';

/**
 * Financial Charts — Reusable component for both teacher + admin
 * financial sections. Renders either:
 *   - view = 'cards'  → renders the provided cards (children)
 *   - view = 'bar'    → BarChart of the last N transactions
 *   - view = 'line'   → LineChart of the last N transactions
 *
 * Data shape: array of { date (ISO), teacher_share, platform_share,
 * gross_amount } — exactly what `/api/teacher/revenue` and
 * `/api/admin/financial-ledger` return as their `transactions` array
 * (after projection to the three numeric fields + the ISO timestamp).
 *
 * The charts show DAILY aggregation: transactions on the same day are
 * summed. The X-axis shows day labels (YYYY-MM-DD). The Y-axis shows
 * the amount in the user's currency.
 *
 * Used by:
 *   - src/components/teacher/teacher-financial-section.tsx
 *   - src/components/admin/admin-financial-section.tsx
 */

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useTranslations } from '@/i18n/use-translations';

export type ChartView = 'cards' | 'bar' | 'line';

interface TxPoint {
  created_at: string;
  teacher_share: number | string;
  platform_share: number | string;
  gross_amount: number | string;
  currency?: string;
}

interface Props {
  view: ChartView;
  transactions: TxPoint[];
  /** Currency code to display in the Y-axis + tooltip (default EGP). */
  currency?: string;
  /** Height of the chart in pixels (default 280). */
  height?: number;
}

interface AggregatedDay {
  date: string;          // YYYY-MM-DD
  label: string;         // localized short date
  teacher_share: number;
  platform_share: number;
  gross_amount: number;
  count: number;
}

/**
 * Aggregate transactions per day. Returns an array sorted ascending by
 * date, ready for XAxis. Days with no transactions are skipped (gaps
 * are normal in a sparse dataset).
 *
 * Locale-aware: uses the user's locale for label formatting.
 */
function aggregateByDay(transactions: TxPoint[], isRTL: boolean): AggregatedDay[] {
  const locale = isRTL ? 'ar-EG' : 'en-US';
  const dayMap = new Map<string, AggregatedDay>();

  for (const tx of transactions) {
    if (!tx.created_at) continue;
    const d = new Date(tx.created_at);
    if (isNaN(d.getTime())) continue;
    // Bucket by YYYY-MM-DD
    const dateKey = d.toISOString().slice(0, 10);
    const existing = dayMap.get(dateKey) ?? {
      date: dateKey,
      label: d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
      teacher_share: 0,
      platform_share: 0,
      gross_amount: 0,
      count: 0,
    };
    existing.teacher_share += Number(tx.teacher_share) || 0;
    existing.platform_share += Number(tx.platform_share) || 0;
    existing.gross_amount += Number(tx.gross_amount) || 0;
    existing.count += 1;
    dayMap.set(dateKey, existing);
  }

  // Sort ascending by date string (ISO 8601 sorts naturally)
  return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function FinancialCharts({
  view,
  transactions,
  currency = 'EGP',
  height = 280,
}: Props) {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';

  const data = useMemo(
    () => aggregateByDay(transactions, isRTL),
    [transactions, isRTL],
  );

  if (view === 'cards') {
    // The cards are rendered by the parent — this component returns null.
    return null;
  }

  if (data.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 gap-2 text-center"
        dir={direction}
        style={{ height }}
      >
        <p className="text-sm text-muted-foreground">
          {isRTL
            ? 'لا توجد بيانات كافية لعرض الرسم البياني'
            : 'Not enough data to display the chart'}
        </p>
      </div>
    );
  }

  const tooltipFormatter = (value: number, name: string) => {
    const labels: Record<string, string> = {
      teacher_share: t('financial.summary.teacherShare') || 'حصة المعلم',
      platform_share: t('adminFinancial.summary.platformShare') || 'حصة المنصة',
      gross_amount: t('financial.summary.totalGross') || 'الإجمالي',
    };
    return [`${Number(value).toFixed(2)} ${currency}`, labels[name] ?? name];
  };

  const tooltipLabelFormatter = (label: string, payload: Array<{ payload: AggregatedDay }>) => {
    const day = payload?.[0]?.payload;
    if (!day) return label;
    const count = day.count;
    return `${label} · ${count} ${isRTL ? 'عملية' : 'tx'}`;
  };

  const chartProps = {
    data,
    margin: { top: 8, right: 8, left: -10, bottom: 0 },
  };

  return (
    <div style={{ height, width: '100%' }} dir={direction}>
      <ResponsiveContainer width="100%" height="100%">
        {view === 'bar' ? (
          <BarChart {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              stroke="#94a3b8"
              reversed={isRTL}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="#94a3b8"
              orientation={isRTL ? 'right' : 'left'}
              tickFormatter={(v: number) => Number(v).toFixed(0)}
            />
            <Tooltip
              formatter={tooltipFormatter}
              labelFormatter={tooltipLabelFormatter as any}
              contentStyle={{
                background: 'rgba(255,255,255,0.96)',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: 12,
                direction,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  teacher_share: t('financial.summary.teacherShare') || 'حصة المعلم',
                  platform_share: t('adminFinancial.summary.platformShare') || 'حصة المنصة',
                  gross_amount: t('financial.summary.totalGross') || 'الإجمالي',
                };
                return labels[value] ?? value;
              }}
            />
            <Bar
              dataKey="gross_amount"
              fill="#0ea5e9"
              radius={[4, 4, 0, 0]}
              maxBarSize={42}
            />
            <Bar
              dataKey="teacher_share"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              maxBarSize={42}
            />
            <Bar
              dataKey="platform_share"
              fill="#8b5cf6"
              radius={[4, 4, 0, 0]}
              maxBarSize={42}
            />
          </BarChart>
        ) : (
          <LineChart {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              stroke="#94a3b8"
              reversed={isRTL}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="#94a3b8"
              orientation={isRTL ? 'right' : 'left'}
              tickFormatter={(v: number) => Number(v).toFixed(0)}
            />
            <Tooltip
              formatter={tooltipFormatter}
              labelFormatter={tooltipLabelFormatter as any}
              contentStyle={{
                background: 'rgba(255,255,255,0.96)',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: 12,
                direction,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  teacher_share: t('financial.summary.teacherShare') || 'حصة المعلم',
                  platform_share: t('adminFinancial.summary.platformShare') || 'حصة المنصة',
                  gross_amount: t('financial.summary.totalGross') || 'الإجمالي',
                };
                return labels[value] ?? value;
              }}
            />
            <Line
              type="monotone"
              dataKey="gross_amount"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={{ r: 3, fill: '#0ea5e9' }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="teacher_share"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 3, fill: '#10b981' }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="platform_share"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ r: 3, fill: '#8b5cf6' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * View toggle button group (cards / bar / line). Stateless — the parent
 * owns the `view` state.
 */
export function ChartViewToggle({
  view,
  onChange,
}: {
  view: ChartView;
  onChange: (v: ChartView) => void;
}) {
  const { t } = useTranslations();
  const buttons: Array<{ id: ChartView; labelKey: 'cards' | 'barChart' | 'lineChart' }> = [
    { id: 'cards', labelKey: 'cards' },
    { id: 'bar', labelKey: 'barChart' },
    { id: 'line', labelKey: 'lineChart' },
  ];
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
      {buttons.map((b) => {
        const isActive = view === b.id;
        const label = t(`financial.viewToggle.${b.labelKey}`)
          || t(`adminFinancial.viewToggle.${b.labelKey}`)
          || b.labelKey;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-pressed={isActive}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
