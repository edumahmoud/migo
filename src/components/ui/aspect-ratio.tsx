'use client';

import * as React from 'react';
import { AspectRatio as MantineAspectRatio } from '@mantine/core';

const AspectRatio = React.forwardRef<HTMLDivElement, { ratio?: number; children?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>>(
  ({ ratio = 16 / 9, children, ...props }, ref) => (
    <MantineAspectRatio ref={ref} ratio={ratio} {...(props as any)}>
      {children}
    </MantineAspectRatio>
  )
);
AspectRatio.displayName = 'AspectRatio';

export { AspectRatio };
