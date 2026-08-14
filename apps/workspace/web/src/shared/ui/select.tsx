import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface SelectOption<Value extends string = string> {
  readonly value: Value;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
}

export interface SelectProps<Value extends string = string> {
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly SelectOption<Value>[];
  readonly placeholder?: string;
  readonly className?: string;
  readonly popupClassName?: string;
  readonly size?: "sm" | "md";
  readonly borderless?: boolean;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

export function Select<Value extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  popupClassName,
  size = "md",
  borderless = false,
  disabled,
  ...rest
}: SelectProps<Value>) {
  return (
    <BaseSelect.Root<Value>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={rest["aria-label"]}
        className={cn(
          "group inline-flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-sm font-medium text-foreground transition-[background,border-color,box-shadow] outline-none select-none",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3",
          borderless
            ? "hover:bg-accent data-popup-open:bg-accent"
            : "border border-input bg-background shadow-xs hover:border-border-strong data-popup-open:border-ring data-popup-open:ring-2 data-popup-open:ring-ring/25",
          className
        )}
      >
        <BaseSelect.Value
          placeholder={placeholder ?? ""}
          className="truncate data-placeholder:text-subtle-foreground data-placeholder:font-normal"
        >
          {(selected: Value) =>
            options.find((option) => option.value === selected)?.label ??
            selected
          }
        </BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-subtle-foreground transition-transform group-data-popup-open:rotate-180">
          <ChevronDown className="size-3.5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="z-50 outline-none select-none"
          sideOffset={4}
        >
          <BaseSelect.Popup
            className={cn(
              "min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-lg border border-border bg-background p-1 shadow-pop outline-none",
              "transition-[scale,opacity] duration-100 ease-out",
              "data-ending-style:scale-[0.97] data-ending-style:opacity-0",
              "data-starting-style:scale-[0.97] data-starting-style:opacity-0",
              popupClassName
            )}
          >
            <BaseSelect.List className="max-h-64 scroll-py-1 overflow-y-auto outline-none">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary-foreground outline-none select-none",
                    "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                    "data-disabled:pointer-events-none data-disabled:opacity-50",
                    "[&_svg]:size-4 [&_svg]:shrink-0"
                  )}
                >
                  {option.icon}
                  <BaseSelect.ItemText className="flex-1 truncate">
                    {option.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-primary">
                    <Check className="size-3.5" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
