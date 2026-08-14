import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { Button } from "./button";

export interface ConfirmDialogProps {
  readonly trigger?: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly confirmText: string;
  readonly cancelText: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
}

/**
 * A destructive/confirmation gate around any trigger element, replacing the
 * old antd Popconfirm pattern with a focused alert dialog.
 */
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  danger,
  disabled,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <BaseAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <BaseAlertDialog.Trigger
          disabled={disabled}
          render={trigger as React.ReactElement}
        />
      ) : null}
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseAlertDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background p-6 shadow-lg outline-none",
            "transition-[scale,opacity] duration-150 ease-out",
            "data-ending-style:scale-[0.97] data-ending-style:opacity-0",
            "data-starting-style:scale-[0.97] data-starting-style:opacity-0"
          )}
        >
          <BaseAlertDialog.Title className="text-base font-semibold tracking-tight">
            {title}
          </BaseAlertDialog.Title>
          {description ? (
            <BaseAlertDialog.Description className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </BaseAlertDialog.Description>
          ) : null}
          <div className="mt-6 flex items-center justify-end gap-2.5">
            <BaseAlertDialog.Close
              render={
                <Button variant="secondary" size="sm">
                  {cancelText}
                </Button>
              }
            />
            <BaseAlertDialog.Close
              render={
                <Button
                  variant={danger ? "destructive" : "primary"}
                  size="sm"
                  disabled={disabled}
                  onClick={onConfirm}
                >
                  {confirmText}
                </Button>
              }
            />
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
