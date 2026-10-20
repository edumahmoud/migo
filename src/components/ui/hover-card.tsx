'use client';

import * as React from 'react';
import { HoverCard as MantineHoverCard } from '@mantine/core';

function HoverCard({ children, openDelay, closeDelay }: { children?: React.ReactNode; openDelay?: number; closeDelay?: number }) {
  return <MantineHoverCard openDelay={openDelay} closeDelay={closeDelay}>{children as any}</MantineHoverCard>;
}

function HoverCardTrigger({ children }: { children?: React.ReactNode }) {
  return <MantineHoverCard.Target>{children as any}</MantineHoverCard.Target>;
}

function HoverCardContent({ children, className, align, sideOffset }: { children?: React.ReactNode; className?: string; align?: string; sideOffset?: number }) {
  return <MantineHoverCard.Dropdown className={className}>{children}</MantineHoverCard.Dropdown>;
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
