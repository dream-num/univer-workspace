import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

/**
 * Left-anchored overlay panel built on the Dialog primitive, used for the
 * compact-viewport navigation drawer. Backdrop press and Escape close it,
 * and the modal Dialog keeps the background from scrolling while open.
 */
export function Drawer({
  open,
  onOpenChange,
  label,
  className,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseDialog.Popup
          aria-label={label}
          className={cn(
            "workspace-nav-drawer fixed inset-y-0 left-0 z-50 flex w-[min(280px,85vw)] flex-col overflow-hidden border-r border-border bg-surface shadow-lg outline-none",
            "transition-transform duration-150 ease-out",
            "data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
            className
          )}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
