'use client';

/**
 * Checkbox adapter — shadcn Checkbox → Mantine Checkbox
 */

import * as React from 'react';
import { Checkbox as MantineCheckbox } from '@mantine/core';
import { cn } from '@/lib/utils';

interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, onCheckedChange, disabled, id, className, ...props }, ref) => (
    <MantineCheckbox
      ref={ref}
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.currentTarget.checked)}
      disabled={disabled}
      id={id}
      className={cn(className)}
      {...props}
    />
  )
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
