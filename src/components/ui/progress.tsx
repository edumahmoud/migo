'use client';

/**
 * Progress adapter — shadcn Progress → Mantine Progress
 */

import * as React from 'react';
import { Progress as MantineProgress } from '@mantine/core';
import { cn } from '@/lib/utils';

interface ProgressProps extends React.ComponentProps<'div'> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => (
    <MantineProgress
      ref={ref}
      value={value}
      size="sm"
      radius="md"
      className={cn(className)}
      {...(props as any)}
    />
  )
);
Progress.displayName = 'Progress';

export { Progress };
