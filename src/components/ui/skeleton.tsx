'use client';

/**
 * Skeleton adapter — shadcn Skeleton → Mantine Skeleton
 */

import * as React from 'react';
import { Skeleton as MantineSkeleton } from '@mantine/core';
import { cn } from '@/lib/utils';

const Skeleton = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <MantineSkeleton
      ref={ref}
      className={cn(className)}
      {...(props as any)}
    />
  )
);
Skeleton.displayName = 'Skeleton';

export { Skeleton };
