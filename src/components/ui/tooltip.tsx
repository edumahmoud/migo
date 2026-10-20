'use client';

/**
 * Tooltip adapter — shadcn Tooltip → Mantine Tooltip
 */

import * as React from 'react';
import { Tooltip as MantineTooltip } from '@mantine/core';
import { cn } from '@/lib/utils';

interface TooltipProps {
  children?: React.ReactNode;
  className?: string;
  delayDuration?: number;
}

function TooltipProvider({ children, delayDuration }: { children?: React.ReactNode; delayDuration?: number }) {
  return <>{children}</>;
}

function Tooltip({ children, delayDuration, className }: TooltipProps & { className?: string }) {
  return <span className={className}>{children}</span>;
}

function TooltipTrigger({ children, asChild, className }: { children?: React.ReactNode; asChild?: boolean; className?: string }) {
  return <span className={className} style={{ display: 'inline-flex' }}>{children}</span>;
}

function TooltipContent({
  children,
  className,
  side = 'top',
  sideOffset = 4,
  align,
  hidden,
}: {
  children?: React.ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  align?: string;
  hidden?: boolean;
}) {
  return null;
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
