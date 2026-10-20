'use client';

import * as React from 'react';
import { Accordion as MantineAccordion } from '@mantine/core';
import { cn } from '@/lib/utils';

interface AccordionProps {
  type?: 'single' | 'multiple';
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  children?: React.ReactNode;
  className?: string;
  collapsible?: boolean;
}

function Accordion({ type = 'single', value, defaultValue, onValueChange, children, className, collapsible }: AccordionProps) {
  return (
    <MantineAccordion
      multiple={type === 'multiple'}
      value={value as any}
      defaultValue={defaultValue as any}
      onChange={(v) => onValueChange?.(v as any)}
      className={cn(className)}
      chevronPosition="right"
      variant="separated"
    >
      {children}
    </MantineAccordion>
  );
}

function AccordionItem({ value, children, className }: { value: string; children?: React.ReactNode; className?: string }) {
  return <MantineAccordion.Item value={value} className={cn(className)}>{children}</MantineAccordion.Item>;
}

function AccordionTrigger({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <MantineAccordion.Control className={cn(className)}>{children}</MantineAccordion.Control>;
}

function AccordionContent({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <MantineAccordion.Panel className={cn(className)}>{children}</MantineAccordion.Panel>;
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
