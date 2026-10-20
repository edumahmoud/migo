'use client';

import * as React from 'react';
import { RadioGroup as MantineRadioGroup, Radio } from '@mantine/core';
import { cn } from '@/lib/utils';

interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  dir?: 'rtl' | 'ltr';
}

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ value, defaultValue, onValueChange, children, disabled, className, orientation, dir }, ref) => (
    <div dir={dir} style={{ display: 'flex', flexDirection: orientation === 'horizontal' ? 'row' : 'column', gap: 8 }}>
      <MantineRadioGroup
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onChange={(v) => onValueChange?.(v)}
        disabled={disabled}
        className={cn(className)}
      >
        {children}
      </MantineRadioGroup>
    </div>
  )
);
RadioGroup.displayName = 'RadioGroup';

function RadioGroupItem({ value, disabled, id }: { value: string; disabled?: boolean; id?: string }) {
  return <Radio value={value} disabled={disabled} id={id} />;
}

function RadioGroupLabel({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <label className={cn('text-sm font-medium', className)}>{children}</label>;
}

export { RadioGroup, RadioGroupItem, RadioGroupLabel };
