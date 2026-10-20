'use client';

/**
 * AlertDialog adapter — shadcn AlertDialog → Mantine Modal
 *
 * Maps shadcn's AlertDialog API to Mantine's Modal component.
 */

import * as React from 'react';
import { Modal, Text, Stack, Group, Button as MantineButton } from '@mantine/core';
import { cn } from '@/lib/utils';

interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

function AlertDialog({ open, onOpenChange, children }: AlertDialogProps) {
  const contentChild = React.Children.toArray(children).find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && (child.type as any)?.displayName === 'AlertDialogContent'
  );

  return (
    <Modal
      opened={open || false}
      onClose={() => onOpenChange?.(false)}
      size="md"
      centered
      withCloseButton={false}
      styles={{ body: { padding: 0 } }}
    >
      {contentChild}
    </Modal>
  );
}

function AlertDialogContent({
  children,
  className,
  ...props
}: {
  children?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-lg', className)} {...props}>
      {children}
    </div>
  );
}
AlertDialogContent.displayName = 'AlertDialogContent';

function AlertDialogHeader({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <Stack gap="xs" className={cn('mb-md', className)}>{children}</Stack>;
}

function AlertDialogFooter({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <Group justify="flex-end" gap="sm" className={cn('mt-lg', className)}>
      {children}
    </Group>
  );
}

function AlertDialogTitle({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <Text size="lg" fw={700} className={className}>{children}</Text>;
}

function AlertDialogDescription({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <Text size="sm" c="dimmed" className={className}>{children}</Text>;
}

function AlertDialogAction({
  children,
  onClick,
  className,
  disabled,
}: {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <MantineButton color="red" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </MantineButton>
  );
}

function AlertDialogCancel({
  children,
  onClick,
  className,
  disabled,
}: {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <MantineButton variant="subtle" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </MantineButton>
  );
}

function AlertDialogTrigger({ children, asChild, className }: { children?: React.ReactNode; asChild?: boolean; className?: string }) {
  return <span className={className}>{children}</span>;
}

export {
  AlertDialog, AlertDialogPortal, AlertDialogOverlay, AlertDialogTrigger,
  AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
};

// Stubs for unused components
function AlertDialogPortal({ children }: { children?: React.ReactNode }) { return <>{children}</>; }
function AlertDialogOverlay({ children }: { children?: React.ReactNode }) { return <>{children}</>; }
