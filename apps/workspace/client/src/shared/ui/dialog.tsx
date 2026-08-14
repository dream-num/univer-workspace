import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../utils/cn";

export const DialogRoot = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogContent({
  className,
  children,
  width = "md",
  hideClose = false,
  closeLabel = "Close",
  ...props
}: ComponentProps<typeof BaseDialog.Popup> & {
  readonly width?: "sm" | "md" | "lg" | "xl";
  readonly hideClose?: boolean;
  readonly closeLabel?: string;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <BaseDialog.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-2.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-lg outline-none",
          "transition-[scale,opacity] duration-150 ease-out",
          "data-ending-style:scale-[0.97] data-ending-style:opacity-0",
          "data-starting-style:scale-[0.97] data-starting-style:opacity-0",
          width === "sm" && "max-w-sm",
          width === "md" && "max-w-md",
          width === "lg" && "max-w-lg",
          width === "xl" && "max-w-2xl",
          className
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <BaseDialog.Close
            aria-label={closeLabel}
            className="absolute top-4 right-4 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-accent hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <X className="size-4" />
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("mb-5 flex flex-col gap-1 pr-8", className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-6 flex items-center justify-end gap-2.5", className)}
      {...props}
    />
  );
}

export interface SimpleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: "sm" | "md" | "lg" | "xl";
  readonly children: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  width = "md",
  children,
}: SimpleDialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent width={width}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </BaseDialog.Root>
  );
}
