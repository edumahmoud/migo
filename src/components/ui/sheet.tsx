'use client';

/**
 * Sheet adapter — shadcn Sheet → Mantine Drawer
 */

import * as React from 'react';
import { Drawer } from '@mantine/core';
import { cn } from '@/lib/utils';

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

function Sheet({ open, onOpenChange, children }: SheetProps) {
  // Find SheetContent among children to extract side + className
  const contentChild = React.Children.toArray(children).find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && (child.type as any)?.displayName === 'SheetContent'
  );

  const props = (contentChild?.props || {}) as { side?: string; className?: string };
  const side = props.side || 'right';
  const position = side === 'left' ? 'left' : side === 'top' ? 'top' : side === 'bottom' ? 'bottom' : 'right';

  return (
    <Drawer
      opened={open || false}
      onClose={() => onOpenChange?.(false)}
      position={position as any}
      size="md"
      withCloseButton={false}
      styles={{ body: { padding: 0 } }}
    >
      {contentChild}
    </Drawer>
  );
}

function SheetContent({
  children,
  className,
  side = 'right',
  ...props
}: {
  children?: React.ReactNode;
  className?: string;
  side?: 'left' | 'right' | 'top' | 'bottom';
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-md', className)} {...props}>
      {children}
    </div>
  );
}
SheetContent.displayName = 'SheetContent';

function SheetHeader({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('mb-md', className)}>{children}</div>;
}

function SheetFooter({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('mt-md', className)}>{children}</div>;
}

function SheetTitle({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <h2 className={cn('text-lg font-bold', className)}>{children}</h2>;
}

function SheetDescription({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;
}

function SheetTrigger({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function SheetClose({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export {
  Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader,
  SheetFooter, SheetTitle, SheetDescription,
};
