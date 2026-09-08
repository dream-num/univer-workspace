import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.js";
import { CloseIcon } from "./icons.js";
import css from "./dialog.module.scss";

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
      <BaseDialog.Backdrop className={css.backdrop} />
      <BaseDialog.Popup className={cn(css.popup, css[width], className)} {...props}>
        {children}
        {hideClose ? null : (
          <BaseDialog.Close aria-label={closeLabel} className={css.close}>
            <CloseIcon />
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader(props: ComponentProps<"div">) {
  return <div {...props} className={cn(css.header, props.className)} />;
}

export function DialogTitle(props: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title {...props} className={cn(css.title, props.className)} />;
}

export function DialogDescription(props: ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description {...props} className={cn(css.description, props.className)} />;
}

export function DialogFooter(props: ComponentProps<"div">) {
  return <div {...props} className={cn(css.footer, props.className)} />;
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
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </BaseDialog.Root>
  );
}
