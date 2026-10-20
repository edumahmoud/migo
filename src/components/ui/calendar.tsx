'use client';

import * as React from 'react';
import { MonthPickerInput, DateInput } from '@mantine/dates';
import 'dayjs/locale/ar';
import { cn } from '@/lib/utils';

interface CalendarProps {
  mode?: 'single' | 'range';
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  initialFocus?: boolean;
  className?: string;
  disabled?: boolean;
  locale?: string;
}

const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>(
  ({ mode = 'single', selected, onSelect, className, disabled, locale = 'ar' }, ref) => {
    if (mode === 'single') {
      return (
        <div ref={ref} className={cn(className)}>
          <DateInput
            value={selected ?? null}
            onChange={(v) => onSelect?.(v as unknown as Date | undefined)}
            disabled={disabled}
            locale={locale}
            valueFormat="YYYY-MM-DD"
            clearable
          />
        </div>
      );
    }
    return (
      <div ref={ref} className={cn(className)}>
        <MonthPickerInput
          value={selected ?? null}
          onChange={(v) => onSelect?.(v as unknown as Date | undefined)}
          disabled={disabled}
          locale={locale}
          clearable
        />
      </div>
    );
  }
);
Calendar.displayName = 'Calendar';

export { Calendar };
