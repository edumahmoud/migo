'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface ToggleGroupProps {
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  type?: 'single' | 'multiple';
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

function ToggleGroup({ value, defaultValue, onValueChange, type = 'single', children, className, disabled }: ToggleGroupProps) {
  return (
    <div className={cn('inline-flex items-center gap-1', className)} data-disabled={disabled || undefined}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as any, {
            'data-state': Array.isArray(value) ? (value.includes((child.props as any).value) ? 'on' : 'off') : (value === (child.props as any).value ? 'on' : 'off'),
            onClick: () => {
              const childValue = (child.props as any).value;
              if (type === 'single') {
                onValueChange?.(childValue);
              } else {
                const currentArr = Array.isArray(value) ? value : [];
                const newVal = currentArr.includes(childValue)
                  ? currentArr.filter(v => v !== childValue)
                  : [...currentArr, childValue];
                onValueChange?.(newVal);
              }
            },
          });
        }
        return child;
      })}
    </div>
  );
}

function ToggleGroupItem({ value, children, className, disabled, 'aria-label': ariaLabel, ...props }: { value: string; children?: React.ReactNode; className?: string; disabled?: boolean; 'aria-label'?: string; 'data-state'?: string; onClick?: () => void } & Record<string, any>) {
  const isOn = props['data-state'] === 'on';
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        isOn ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={props.onClick}
    >
      {children}
    </button>
  );
}

export { ToggleGroup, ToggleGroupItem };
