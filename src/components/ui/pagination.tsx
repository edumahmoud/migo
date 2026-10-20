'use client';

import * as React from 'react';
import { Pagination as MantinePagination } from '@mantine/core';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  className?: string;
  showEdges?: boolean;
}

const Pagination = React.forwardRef<HTMLDivElement, PaginationProps>(
  ({ page = 1, totalPages = 1, onPageChange, className, showEdges }, ref) => (
    <div ref={ref} className={cn(className)}>
      <MantinePagination
        value={page}
        total={totalPages}
        onChange={onPageChange}
        withEdges={showEdges}
        size="md"
        radius="md"
      />
    </div>
  )
);
Pagination.displayName = 'Pagination';

const PaginationContent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const PaginationItem = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const PaginationLink = ({ children, onClick, isActive }: { children?: React.ReactNode; onClick?: () => void; isActive?: boolean }) => (
  <button onClick={onClick} className={isActive ? 'font-bold' : ''}>{children}</button>
);
const PaginationPrevious = ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
  <button onClick={onClick}>{children || 'Previous'}</button>
);
const PaginationNext = ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
  <button onClick={onClick}>{children || 'Next'}</button>
);
const PaginationEllipsis = () => <span>...</span>;

export {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationPrevious, PaginationNext, PaginationEllipsis,
};
