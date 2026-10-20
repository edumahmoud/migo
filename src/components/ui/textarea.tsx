'use client';

/**
 * Textarea adapter — shadcn Textarea → Mantine Textarea
 */

import * as React from 'react';
import { Textarea as MantineTextarea } from '@mantine/core';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <MantineTextarea
      ref={ref}
      size="md"
      radius="md"
      autosize
      className={cn(className)}
      {...(props as any)}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
