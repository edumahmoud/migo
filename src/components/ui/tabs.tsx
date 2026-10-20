'use client';

/**
 * Tabs adapter — shadcn Tabs → Mantine Tabs
 *
 * Maps shadcn's Tabs/TabsList/TabsTrigger/TabsContent to Mantine's Tabs.
 */

import * as React from 'react';
import { Tabs as MantineTabs } from '@mantine/core';
import { cn } from '@/lib/utils';

interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  dir?: 'rtl' | 'ltr';
}

function Tabs({ value, defaultValue, onValueChange, children, className, orientation, dir }: TabsProps) {
  return (
    <MantineTabs
      value={value}
      defaultValue={defaultValue}
      onChange={(v) => onValueChange?.(v || '')}
      orientation={orientation}
      variant="default"
      className={cn(className)}
    >
      {children}
    </MantineTabs>
  );
}

function TabsList({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <MantineTabs.List className={cn(className)}>{children}</MantineTabs.List>;
}

function TabsTrigger({
  value,
  children,
  className,
  disabled,
}: {
  value: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <MantineTabs.Tab value={value} disabled={disabled} className={cn(className)}>
      {children}
    </MantineTabs.Tab>
  );
}

function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <MantineTabs.Panel value={value} className={cn(className)}>
      {children}
    </MantineTabs.Panel>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
