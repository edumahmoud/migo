'use client';

/**
 * Separator adapter — shadcn Separator → Mantine Divider
 */

import * as React from 'react';
import { Divider } from '@mantine/core';
import { cn } from '@/lib/utils';

interface SeparatorProps extends React.ComponentProps<'div'> {
  orientation?: 'horizontal' | 'vertical';
}

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => (
    <Divider
      ref={ref}
      orientation={orientation}
      className={cn(className)}
      {...(props as any)}
    />
  )
);
Separator.displayName = 'Separator';

export { Separator };
