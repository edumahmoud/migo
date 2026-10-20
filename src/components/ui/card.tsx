'use client';

/**
 * Card adapter — shadcn Card API → Mantine Card
 *
 * Wraps Mantine Card with shadcn-compatible sub-components.
 * All existing code that uses <Card>, <CardHeader>, <CardContent>,
 * <CardTitle>, <CardDescription>, <CardFooter> works unchanged.
 */

import * as React from 'react';
import { Card as MantineCard, Text, Box } from '@mantine/core';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <MantineCard
      ref={ref}
      shadow="xs"
      radius="md"
      withBorder
      className={cn(className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <Box ref={ref} className={cn('p-md pb-xs', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.ComponentProps<'h3'>>(
  ({ className, ...props }, ref) => (
    <Text ref={ref} fw={600} size="lg" className={cn(className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.ComponentProps<'p'>>(
  ({ className, ...props }, ref) => (
    <Text ref={ref} size="sm" c="dimmed" className={cn(className)} {...props} />
  )
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <Box ref={ref} className={cn('p-md pt-xs', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <Box ref={ref} className={cn('p-md pt-xs', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
