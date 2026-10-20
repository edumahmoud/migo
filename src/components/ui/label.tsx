'use client';

/**
 * Label adapter — shadcn Label → Mantine Text
 */

import * as React from 'react';
import { Text } from '@mantine/core';
import { cn } from '@/lib/utils';

const Label = React.forwardRef<HTMLLabelElement, React.ComponentProps<'label'> & { htmlFor?: string }>(
  ({ className, children, htmlFor, ...props }, ref) => (
    <Text
      component="label"
      ref={ref}
      size="sm"
      fw={500}
      htmlFor={htmlFor}
      className={cn(className)}
      style={{ display: 'block', marginBottom: 4 }}
      {...(props as any)}
    >
      {children}
    </Text>
  )
);
Label.displayName = 'Label';

export { Label };
