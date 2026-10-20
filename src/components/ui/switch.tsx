'use client';

/**
 * Switch adapter — shadcn Switch → Mantine Switch
 */

import * as React from 'react';
import { Switch as MantineSwitch } from '@mantine/core';
import { cn } from '@/lib/utils';

interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, className, id, ...props }, ref) => (
    <MantineSwitch
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
Switch.displayName = 'Switch';

export { Switch };
