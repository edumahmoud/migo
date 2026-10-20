'use client';

/**
 * Avatar adapter — shadcn Avatar → Mantine Avatar
 */

import * as React from 'react';
import { Avatar as MantineAvatar } from '@mantine/core';
import { cn } from '@/lib/utils';

interface AvatarProps extends React.ComponentProps<'div'> {
  src?: string;
  alt?: string;
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt, children, ...props }, ref) => (
    <MantineAvatar
      ref={ref}
      src={src}
      alt={alt}
      size="md"
      radius="full"
      className={cn(className)}
      {...props}
    >
      {children}
    </MantineAvatar>
  )
);
Avatar.displayName = 'Avatar';

const AvatarImage = ({ src, alt, className }: { src?: string; alt?: string; className?: string }) => null;

const AvatarFallback = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn(className)}>{children}</span>
);

export { Avatar, AvatarImage, AvatarFallback };
