import { useLocaleStore } from './locale-store';

// Utility for direction-aware class names
// Use this to conditionally apply classes based on RTL/LTR
export function rtl(rtlClass: string, ltrClass: string): string {
  const { direction } = useLocaleStore.getState();
  return direction === 'rtl' ? rtlClass : ltrClass;
}

// Get direction-aware margin/padding classes
export function dirClasses(classes: {
  rtl?: string;
  ltr?: string;
  common?: string;
}): string {
  const { direction } = useLocaleStore.getState();
  const dirSpecific = direction === 'rtl' ? (classes.rtl || '') : (classes.ltr || '');
  return [classes.common, dirSpecific].filter(Boolean).join(' ');
}

// Direction-aware flex alignment
export function flexDir(): string {
  const { direction } = useLocaleStore.getState();
  return direction === 'rtl' ? 'flex-row-reverse' : 'flex-row';
}

// Get the start direction (left in LTR, right in RTL)
export function startDir(): 'right' | 'left' {
  const { direction } = useLocaleStore.getState();
  return direction === 'rtl' ? 'right' : 'left';
}

// Get the end direction (right in LTR, left in RTL)
export function endDir(): 'right' | 'left' {
  const { direction } = useLocaleStore.getState();
  return direction === 'rtl' ? 'left' : 'right';
}
