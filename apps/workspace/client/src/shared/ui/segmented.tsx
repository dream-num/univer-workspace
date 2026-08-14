import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface SegmentedOption<Value extends string = string> {
  readonly value: Value;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

/**
 * A pill-style segmented control (iOS-like) built on Base UI ToggleGroup.
 */
export function Segmented<Value extends string = string>({
  value,
  onValueChange,
  options,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly SegmentedOption<Value>[];
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly "aria-label"?: string;
}) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(groupValue) => {
        const next = groupValue[0] as Value | undefined;
        if (next !== undefined) onValueChange(next);
      }}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5",
        className
      )}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap text-muted-foreground transition-all outline-none select-none",
            "hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring/40",
            "data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-xs",
            "disabled:pointer-events-none disabled:opacity-50",
            "[&_svg]:size-3.5",
            size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-sm"
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
