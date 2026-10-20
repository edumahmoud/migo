'use client';

import * as React from 'react';
import { Popover as MantinePopover } from '@mantine/core';
import { cn } from '@/lib/utils';

function Popover({ children, open, onOpenChange }: { children?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <MantinePopover opened={open} onChange={onOpenChange}>
      {children as any}
    </MantinePopover>
  );
}

function PopoverTrigger({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) {
  return <MantinePopover.Target>{children as any}</MantinePopover.Target>;
}

function PopoverContent({ children, className, align, sideOffset }: { children?: React.ReactNode; className?: string; align?: string; sideOffset?: number }) {
  return <MantinePopover.Dropdown className={cn(className)}>{children}</MantinePopover.Dropdown>;
}

export { Popover, PopoverTrigger, PopoverContent };
