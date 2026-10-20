'use client';

/**
 * Badge adapter — shadcn Badge → Mantine Badge
 */

import * as React from 'react';
import { Badge as MantineBadge } from '@mantine/core';
import { cn } from '@/lib/utils';

type ShadcnVariant = 'default' | 'secondary' | 'destructive' | 'outline';

interface BadgeProps extends React.ComponentProps<'span'> {
  variant?: ShadcnVariant;
}

const variantMap: Record<ShadcnVariant, { variant: 'filled' | 'light' | 'outline'; color?: string }> = {
  default: { variant: 'filled' },
  secondary: { variant: 'light', color: 'gray' },
  destructive: { variant: 'filled', color: 'red' },
  outline: { variant: 'outline' },
};

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', children, ...props }, ref) => {
    const config = variantMap[variant] || variantMap.default;
    return (
      <MantineBadge
        ref={ref}
        variant={config.variant}
        color={config.color}
        size="sm"
        className={cn(className)}
        {...props}
      >
        {children}
      </MantineBadge>
    );
  }
);
Badge.displayName = 'Badge';

export { Badge };
