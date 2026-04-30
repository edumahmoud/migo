"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

/**
 * Inert cleanup hook — removes stale `inert` attributes from the page.
 *
 * Radix UI Dialog adds `inert` to sibling elements when a dialog opens (modal behavior).
 * This blocks ALL user interaction (click, focus, keyboard) but NOT CSS :hover.
 * When a dialog's parent component unmounts during navigation (conditional rendering),
 * the Dialog cleanup may not complete, leaving `inert` stuck on the page root.
 *
 * This hook:
 *   1. Removes `inert` from all non-portal elements immediately on mount
 *   2. Sets up a MutationObserver to remove `inert` as soon as it's added
 *   3. Runs a periodic check (every 300ms) as a belt-and-suspenders fallback
 *
 * Trade-off: Users CAN interact with background content while a dialog is open.
 * This is acceptable because:
 *   - The dialog overlay still visually covers the background
 *   - Clicking the overlay closes the dialog (via onPointerDownOutside)
 *   - Escape key still closes the dialog
 *   - The alternative (broken clicks everywhere) is much worse
 */
function useInertCleanup() {
  React.useEffect(() => {
    if (typeof document === 'undefined') return;

    // Immediately remove any existing inert attributes
    function removeAllInert() {
      document.documentElement.removeAttribute('inert');
      document.body.removeAttribute('inert');
      document.querySelectorAll('[inert]').forEach((el) => {
        // Don't remove inert from inside a Radix portal (dialog content itself)
        if (!el.closest('[data-radix-portal]')) {
          el.removeAttribute('inert');
        }
      });
      // Fix body pointer-events
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = '';
      }
    }

    // Run immediately
    removeAllInert();

    // MutationObserver: remove inert as soon as it's added
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'inert') {
          const target = mutation.target;
          if (target instanceof HTMLElement && target.hasAttribute('inert')) {
            // Don't remove inert from inside dialog portals (that's the dialog content)
            if (!target.closest('[data-radix-portal]')) {
              // Use microtask to avoid interfering with Radix's internal state
              queueMicrotask(() => {
                target.removeAttribute('inert');
              });
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['inert'],
      subtree: true,
    });

    // Periodic cleanup as fallback (catches edge cases)
    const interval = setInterval(removeAllInert, 300);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // Remove stale inert attributes caused by Radix Dialog modal behavior
  useInertCleanup();

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
