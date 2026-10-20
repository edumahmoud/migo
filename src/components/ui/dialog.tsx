'use client';

/**
 * Dialog adapter — shadcn Dialog API → Mantine Modal
 *
 * Maps shadcn's Dialog/DialogContent/DialogHeader/DialogTitle/etc.
 * to Mantine's Modal component.
 *
 * Usage in existing code:
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>Title</DialogTitle>
 *         <DialogDescription>Description</DialogDescription>
 *       </DialogHeader>
 *       {children}
 *       <DialogFooter>
 *         <Button>Action</Button>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * This adapter wraps everything in a single Mantine Modal.
 */

import * as React from 'react';
import { Modal, Text, Stack, Group } from '@mantine/core';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  modal?: boolean;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  // Find DialogContent among children to extract props
  const contentChild = React.Children.toArray(children).find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && (child.type as any)?.displayName === 'DialogContent'
  );

  const contentProps = (contentChild?.props || {}) as { className?: string };
  const className = contentProps.className || '';
  const maxW = className.includes('max-w-sm') ? 'sm' :
               className.includes('max-w-lg') ? 'lg' :
               className.includes('max-w-2xl') ? '2xl' :
               className.includes('max-w-3xl') ? '3xl' :
               className.includes('max-w-4xl') ? '4xl' : 'md';

  const sizeMap: Record<string, string> = {
    sm: '400px', md: '500px', lg: '640px',
    '2xl': '768px', '3xl': '900px', '4xl': '1100px',
  };

  return (
    <Modal
      opened={open || false}
      onClose={() => onOpenChange?.(false)}
      size={sizeMap[maxW] || 'md'}
      centered
      withCloseButton={false}
      styles={{ body: { padding: 0 } }}
    >
      {contentChild}
    </Modal>
  );
}

function DialogContent({
  children,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  showCloseButton,
  dir,
  ...props
}: {
  children?: React.ReactNode;
  className?: string;
  onOpenAutoFocus?: (e: any) => void;
  onCloseAutoFocus?: (e: any) => void;
  onEscapeKeyDown?: (e: any) => void;
  onPointerDownOutside?: (e: any) => void;
  onInteractOutside?: (e: any) => void;
  showCloseButton?: boolean;
  dir?: 'rtl' | 'ltr';
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-lg', className)} {...props}>
      {children}
    </div>
  );
}
DialogContent.displayName = 'DialogContent';

function DialogHeader({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <Stack gap="xs" className={cn('mb-md', className)}>{children}</Stack>;
}

function DialogBody({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <Stack gap="md" className={className}>{children}</Stack>;
}

function DialogFooter({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <Group justify="flex-end" gap="sm" className={cn('mt-lg', className)}>
      {children}
    </Group>
  );
}

function DialogTitle({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <Text size="lg" fw={700} className={className}>{children}</Text>;
}

function DialogDescription({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <Text size="sm" c="dimmed" className={className}>{children}</Text>;
}

function DialogClose({ children, asChild, className }: { children?: React.ReactNode; asChild?: boolean; className?: string }) {
  return <span className={className}>{children}</span>;
}

function DialogTrigger({ children, asChild, className }: { children?: React.ReactNode; asChild?: boolean; className?: string }) {
  return <span className={className}>{children}</span>;
}

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DialogOverlay({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

// DialogScrollArea — just pass children through (Mantine Modal has built-in scroll)
function DialogScrollArea({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={className} style={{ maxHeight: '70vh', overflowY: 'auto' }}>{children}</div>;
}

export {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogBody, DialogOverlay, DialogPortal, DialogTitle,
  DialogTrigger, DialogScrollArea,
};
