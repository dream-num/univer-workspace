import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactElement, ReactNode } from "react";
import { Button } from "./button.js";
import css from "./confirm-dialog.module.scss";

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
        <BaseAlertDialog.Trigger disabled={disabled} render={trigger as ReactElement} />
      ) : null}
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className={css.backdrop} />
        <BaseAlertDialog.Popup className={css.popup}>
          <BaseAlertDialog.Title className={css.title}>{title}</BaseAlertDialog.Title>
          {description ? (
            <BaseAlertDialog.Description className={css.description}>
              {description}
            </BaseAlertDialog.Description>
          ) : null}
          <div className={css.footer}>
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
