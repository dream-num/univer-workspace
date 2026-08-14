import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "../utils/cn";

export const TooltipProvider = BaseTooltip.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  sideOffset = 6,
  className,
}: {
  readonly content: ReactNode;
  readonly children: ReactElement;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly align?: "start" | "center" | "end";
  readonly sideOffset?: number;
  readonly className?: string;
}) {
  if (!content) return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-50"
        >
          <BaseTooltip.Popup
            className={cn(
              "max-w-64 origin-[var(--transform-origin)] rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md",
              "transition-[scale,opacity] duration-100 ease-out",
              "data-ending-style:scale-[0.96] data-ending-style:opacity-0",
              "data-starting-style:scale-[0.96] data-starting-style:opacity-0",
              className
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
