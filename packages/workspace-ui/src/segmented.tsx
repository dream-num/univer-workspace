import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { ReactNode } from "react";
import { cn } from "./cn.js";
import css from "./segmented.module.scss";

export interface SegmentedOption<Value extends string = string> {
  readonly value: Value;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export function Segmented<Value extends string = string>(props: {
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly SegmentedOption<Value>[];
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly "aria-label"?: string;
}) {
  return (
    <ToggleGroup
      aria-label={props["aria-label"]}
      value={[props.value]}
      onValueChange={(values) => {
        const value = values[0] as Value | undefined;
        if (value !== undefined) props.onValueChange(value);
      }}
      className={cn(css.group, props.className)}
    >
      {props.options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(css.item, props.size === "sm" ? css.sm : css.md)}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
