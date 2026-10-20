'use client';

/**
 * Button adapter — shadcn Button API → Mantine Button
 *
 * This file replaces the shadcn Button with a Mantine Button wrapper
 * that accepts the same props (variant, size, className, asChild, etc.)
 * but renders using Mantine under the hood.
 *
 * This allows ALL existing code that imports { Button } from '@/components/ui/button'
 * to automatically use Mantine without any code changes.
 */

import * as React from 'react';
import { Button as MantineButton } from '@mantine/core';
import { cn } from '@/lib/utils';

type ShadcnVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ShadcnSize = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ShadcnVariant;
  size?: ShadcnSize;
  asChild?: boolean;
  loading?: boolean;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
}

const variantMap: Record<ShadcnVariant, 'filled' | 'outline' | 'subtle' | 'transparent' | 'light'> = {
  default: 'filled',
  destructive: 'filled',
  outline: 'outline',
  secondary: 'light',
  ghost: 'subtle',
  link: 'transparent',
};

const sizeMap: Record<ShadcnSize, 'xs' | 'sm' | 'md' | 'lg'> = {
  default: 'md',
  sm: 'sm',
  lg: 'lg',
  icon: 'md',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild, children, loading, leftSection, rightSection, ...props }, ref) => {
    const mantineVariant = variantMap[variant] || 'filled';
    const mantineSize = sizeMap[size] || 'md';
    const mantineColor = variant === 'destructive' ? 'red' : undefined;
    const isFullWidth = typeof className === 'string' && className.includes('w-full');

    if (asChild) {
      return <>{children}</>;
    }

    return (
      <MantineButton
        ref={ref}
        variant={mantineVariant}
        size={mantineSize}
        color={mantineColor}
        loading={loading}
        leftSection={leftSection}
        rightSection={rightSection}
        className={cn(className)}
        fullWidth={isFullWidth}
        {...props}
      >
        {children}
      </MantineButton>
    );
  }
);

Button.displayName = 'Button';

// Keep buttonVariants for backward compatibility (returns empty string)
export const buttonVariants = () => '';
