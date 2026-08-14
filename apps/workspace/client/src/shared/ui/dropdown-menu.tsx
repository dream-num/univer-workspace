import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { cn } from "../utils/cn";

export const MenuRoot = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

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
        className="z-50 outline-none"
        sideOffset={sideOffset}
        align={align}
        {...(side ? { side } : {})}
      >
        <BaseMenu.Popup
          className={cn(
            "min-w-44 origin-[var(--transform-origin)] rounded-lg border border-border bg-background p-1 shadow-pop outline-none",
            "transition-[scale,opacity] duration-100 ease-out",
            "data-ending-style:scale-[0.97] data-ending-style:opacity-0",
            "data-starting-style:scale-[0.97] data-starting-style:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary-foreground outline-none select-none",
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  );
}

export function MenuGroup({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Group>) {
  return <BaseMenu.Group className={cn("grid", className)} {...props} />;
}

export function MenuGroupLabel({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.GroupLabel>) {
  return (
    <BaseMenu.GroupLabel
      className={cn(
        "px-2 pt-1.5 pb-1 text-xs font-medium text-subtle-foreground",
        className
      )}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Separator>) {
  return (
    <BaseMenu.Separator
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
