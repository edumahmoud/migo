'use client';

/**
 * DropdownMenu adapter — shadcn DropdownMenu → pass-through (simplified)
 *
 * shadcn DropdownMenu uses a complex compound component pattern.
 * This adapter passes through children without the Radix popup behavior.
 * For new code, use Mantine's Menu component directly.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

function DropdownMenu({ children, dir, modal }: { children?: React.ReactNode; dir?: 'rtl' | 'ltr'; modal?: boolean }) {
  return <div dir={dir}>{children}</div>;
}

function DropdownMenuTrigger({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) {
  return <>{children}</>;
}

function DropdownMenuContent({ children, className, align, sideOffset, dir }: { children?: React.ReactNode; className?: string; align?: string; sideOffset?: number; dir?: 'rtl' | 'ltr' }) {
  return <div dir={dir} className={cn('min-w-[180px] rounded-md border bg-popover p-1 shadow-md', className)}>{children}</div>;
}

function DropdownMenuItem({ children, className, onClick, disabled, variant, asChild }: { children?: React.ReactNode; className?: string; onClick?: (e: any) => void; disabled?: boolean; variant?: string; asChild?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50', className)}
    >
      {children}
    </button>
  );
}

function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 h-px bg-border', className)} />;
}

function DropdownMenuLabel({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)}>{children}</div>;
}

function DropdownMenuGroup({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DropdownMenuShortcut({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <span className={cn('ms-auto text-xs tracking-widest opacity-60', className)}>{children}</span>;
}

function DropdownMenuCheckboxItem({ children, checked, onCheckedChange }: { children?: React.ReactNode; checked?: boolean; onCheckedChange?: (checked: boolean) => void }) {
  return <button type="button" onClick={() => onCheckedChange?.(!checked)}>{children}</button>;
}

function DropdownMenuRadioGroup({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DropdownMenuRadioItem({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick}>{children}</button>;
}

function DropdownMenuSub({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DropdownMenuSubTrigger({ children, onClick, className, asChild }: { children?: React.ReactNode; onClick?: (e: any) => void; className?: string; asChild?: boolean }) {
  return <div className={className} onClick={onClick}>{children}</div>;
}

function DropdownMenuSubContent({ children, className, dir }: { children?: React.ReactNode; className?: string; dir?: 'rtl' | 'ltr' }) {
  return <div className={className} dir={dir}>{children}</div>;
}

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuGroup,
  DropdownMenuShortcut, DropdownMenuCheckboxItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
