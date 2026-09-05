import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { cn } from "./cn.js";
import css from "./menu.module.scss";

export const MenuRoot = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;
export const ContextMenuRoot = BaseContextMenu.Root;
export const ContextMenuTrigger = BaseContextMenu.Trigger;

export function MenuContent({
  className,
  sideOffset = 6,
  align = "start",
  side,
  children,
  ...props
}: ComponentProps<typeof BaseMenu.Popup> & {
  readonly sideOffset?: number;
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        className={css.positioner}
        sideOffset={sideOffset}
        align={align}
        {...(side ? { side } : {})}
      >
        <BaseMenu.Popup className={cn(css.popup, className)} {...props}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem(props: ComponentProps<typeof BaseMenu.Item>) {
  return <BaseMenu.Item {...props} className={cn(css.item, props.className)} />;
}

export function MenuGroup(props: ComponentProps<typeof BaseMenu.Group>) {
  return <BaseMenu.Group {...props} className={cn(css.group, props.className)} />;
}

export function MenuGroupLabel(props: ComponentProps<typeof BaseMenu.GroupLabel>) {
  return <BaseMenu.GroupLabel {...props} className={cn(css.groupLabel, props.className)} />;
}

export function MenuSeparator(props: ComponentProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator {...props} className={cn(css.separator, props.className)} />;
}

export function ContextMenuContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseContextMenu.Popup>) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner className={css.positioner}>
        <BaseContextMenu.Popup className={cn(css.popup, className)} {...props}>
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

export function ContextMenuItem(props: ComponentProps<typeof BaseContextMenu.Item>) {
  return <BaseContextMenu.Item {...props} className={cn(css.item, props.className)} />;
}

export function ContextMenuSeparator(props: ComponentProps<typeof BaseContextMenu.Separator>) {
  return <BaseContextMenu.Separator {...props} className={cn(css.separator, props.className)} />;
}
