'use client';

import * as React from 'react';
import { Slider as MantineSlider } from '@mantine/core';
import { cn } from '@/lib/utils';

interface SliderProps {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ value, defaultValue, onValueChange, min = 0, max = 100, step = 1, disabled, className }, ref) => (
    <MantineSlider
      ref={ref}
      value={value?.[0] ?? defaultValue?.[0]}
      onChange={(v) => onValueChange?.([v])}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(className)}
    />
  )
);
Slider.displayName = 'Slider';

export { Slider };
