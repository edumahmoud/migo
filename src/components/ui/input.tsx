'use client';

/**
 * Input adapter — shadcn Input → Mantine TextInput
 *
 * Maintains the same props as shadcn Input but renders Mantine TextInput.
 */

import * as React from 'react';
import { TextInput } from '@mantine/core';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <TextInput
      ref={ref}
      type={type}
      radius="md"
      className={cn(className)}
      {...(props as any)}
    />
  )
);
Input.displayName = 'Input';

export { Input };
