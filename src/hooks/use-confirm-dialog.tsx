'use client';

/**
 * useConfirmDialog — Reusable hook that replaces native `window.confirm()`
 * with a proper AlertDialog (radix-ui based).
 *
 * Usage:
 *   const { confirmDialog, confirm } = useConfirmDialog();
 *
 *   // Trigger a confirmation:
 *   const ok = await confirm({
 *     title: 'تأكيد الإلغاء',
 *     description: 'هل أنت متأكد من إلغاء هذا الطلب؟',
 *     confirmLabel: 'إلغاء',
 *     cancelLabel: 'تراجع',
 *     variant: 'destructive',
 *   });
 *   if (!ok) return;
 *
 *   // Render the dialog (place at the end of your component):
 *   {confirmDialog}
 *
 * The dialog is stateless from the caller's perspective — `confirm()`
 * returns a Promise<boolean> that resolves when the user clicks
 * "confirm" (true) or "cancel" / outside-click (false).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({
    title: '',
  });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resolveRef.current = null;
    };
  }, []);

  const confirmDialog = (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description && (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {options.cancelLabel || 'تراجع'}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={options.variant === 'destructive'
              ? 'bg-red-600 text-white hover:bg-red-700'
              : undefined
            }
          >
            {options.confirmLabel || 'تأكيد'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmDialog, confirm };
}
