'use client';

/**
 * Select adapter — shadcn Select → Mantine Select
 *
 * Maps shadcn's Select/SelectTrigger/SelectValue/SelectContent/SelectItem
 * to a simplified Mantine Select wrapper.
 *
 * Note: shadcn Select uses a compound component pattern, while Mantine
 * uses a single Select with data prop. This adapter collects the SelectItem
 * children and passes them as data to Mantine Select.
 */

import * as React from 'react';
import { Select as MantineSelect } from '@mantine/core';
import { cn } from '@/lib/utils';

// Collect items from children
function collectItems(children: React.ReactNode): Array<{ value: string; label: string }> {
  const items: Array<{ value: string; label: string }> = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && (child.type as any)?.displayName === 'SelectItem') {
      const props = child.props as { value: string; children: React.ReactNode };
      items.push({ value: props.value, label: String(props.children) });
    }
  });
  return items;
}

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
  disabled?: boolean;
  dir?: 'rtl' | 'ltr';
}

function Select({ value, defaultValue, onValueChange, children, disabled }: SelectProps) {
  // Find SelectContent among children to extract items
  const contentChild = React.Children.toArray(children).find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && (child.type as any)?.displayName === 'SelectContent'
  );

  const items = contentChild ? collectItems((contentChild.props as { children: React.ReactNode }).children) : [];

  // Find trigger to get placeholder
  const triggerChild = React.Children.toArray(children).find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && (child.type as any)?.displayName === 'SelectTrigger'
  );

  const placeholder = triggerChild
    ? React.Children.toArray((triggerChild.props as { children: React.ReactNode }).children)
        .find((c): c is React.ReactElement =>
          React.isValidElement(c) && (c.type as any)?.displayName === 'SelectValue'
        )
      ? 'اختر...'
      : undefined
    : undefined;

  return (
    <MantineSelect
      value={value || defaultValue || null}
      onChange={(v) => onValueChange?.(v || '')}
      data={items}
      placeholder={placeholder}
      disabled={disabled}
      size="md"
      radius="md"
      searchable
      clearable
    />
  );
}

function SelectTrigger({ children, className, dir, ...props }: { children?: React.ReactNode; className?: string; dir?: 'rtl' | 'ltr' } & React.HTMLAttributes<HTMLButtonElement>) {
  return <div className={cn(className)} dir={dir} {...(props as any)}>{children}</div>;
}
SelectTrigger.displayName = 'SelectTrigger';

function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span>{placeholder}</span>;
}
SelectValue.displayName = 'SelectValue';

function SelectContent({ children, dir, className }: { children?: React.ReactNode; dir?: 'rtl' | 'ltr'; className?: string }) {
  return <div dir={dir} className={className}>{children}</div>;
}
SelectContent.displayName = 'SelectContent';

function SelectItem({ value, children, className }: { value: string; children?: React.ReactNode; className?: string }) {
  return null;
}
SelectItem.displayName = 'SelectItem';

function SelectGroup({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function SelectLabel({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

function SelectSeparator() {
  return <hr />;
}

export {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  SelectGroup, SelectLabel, SelectSeparator,
};
