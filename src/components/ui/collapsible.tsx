'use client';

/**
 * Collapsible adapter — shadcn Collapsible → Mantine Accordion (simplified)
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

function Collapsible({ open, onOpenChange, children, className }: CollapsibleProps) {
  return <div className={cn(className)}>{children}</div>;
}

function CollapsibleTrigger({ children, asChild, className, onClick, variant }: { children?: React.ReactNode; asChild?: boolean; className?: string; onClick?: (e: any) => void; variant?: string }) {
  return <div className={className} onClick={onClick}>{children}</div>;
}

function CollapsibleContent({ children, className, dir }: { children?: React.ReactNode; className?: string; dir?: 'rtl' | 'ltr' }) {
  return <div className={className} dir={dir}>{children}</div>;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
