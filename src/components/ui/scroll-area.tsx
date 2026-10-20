'use client';

/**
 * ScrollArea adapter — shadcn ScrollArea → Mantine ScrollArea
 */

import * as React from 'react';
import { ScrollArea as MantineScrollArea } from '@mantine/core';
import { cn } from '@/lib/utils';

const ScrollArea = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'> & { className?: string }>(
  ({ className, children, ...props }, ref) => (
    <MantineScrollArea
      ref={ref}
      className={cn(className)}
      {...(props as any)}
    >
      {children}
    </MantineScrollArea>
  )
);
ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
