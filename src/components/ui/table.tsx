'use client';

/**
 * Table adapter — shadcn Table → Mantine Table
 */

import * as React from 'react';
import { Table as MantineTable } from '@mantine/core';
import { cn } from '@/lib/utils';

const Table = React.forwardRef<HTMLTableElement, React.ComponentProps<'table'>>(
  ({ className, ...props }, ref) => (
    <MantineTable ref={ref} className={cn(className)} {...(props as any)} />
  )
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'thead'>>(
  ({ className, ...props }, ref) => (
    <MantineTable.Thead ref={ref} className={cn(className)} {...props} />
  )
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'tbody'>>(
  ({ className, ...props }, ref) => (
    <MantineTable.Tbody ref={ref} className={cn(className)} {...props} />
  )
);
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'tfoot'>>(
  ({ className, ...props }, ref) => (
    <MantineTable.Tfoot ref={ref} className={cn(className)} {...props} />
  )
);
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.ComponentProps<'tr'>>(
  ({ className, ...props }, ref) => (
    <MantineTable.Tr ref={ref} className={cn(className)} {...props} />
  )
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<HTMLTableCellElement, React.ComponentProps<'th'>>(
  ({ className, ...props }, ref) => (
    <MantineTable.Th ref={ref} className={cn(className)} {...props} />
  )
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, React.ComponentProps<'td'>>(
  ({ className, ...props }, ref) => (
    <MantineTable.Td ref={ref} className={cn(className)} {...props} />
  )
);
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.ComponentProps<'caption'>>(
  ({ className, ...props }, ref) => (
    <MantineTable.Caption ref={ref} className={cn(className)} {...props} />
  )
);
TableCaption.displayName = 'TableCaption';

export {
  Table, TableHeader, TableBody, TableFooter, TableHead,
  TableRow, TableCell, TableCaption,
};
