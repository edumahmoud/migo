'use client';

/**
 * Alert adapter — shadcn Alert → Mantine Alert
 */

import * as React from 'react';
import { Alert as MantineAlert } from '@mantine/core';
import { cn } from '@/lib/utils';

type ShadcnVariant = 'default' | 'destructive';

interface AlertProps extends React.ComponentProps<'div'> {
  variant?: ShadcnVariant;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'default', children, ...props }, ref) => (
    <MantineAlert
      ref={ref}
      color={variant === 'destructive' ? 'red' : 'blue'}
      variant="light"
      className={cn(className)}
      {...(props as any)}
    >
      {children}
    </MantineAlert>
  )
);
Alert.displayName = 'Alert';

const AlertDescription = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn(className)}>{children}</div>
);

export { Alert, AlertDescription };
