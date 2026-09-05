import { Select as BaseSelect } from "@base-ui/react/select";
import type { ReactNode } from "react";
import { cn } from "./cn.js";
import { CheckIcon, ChevronDownIcon } from "./icons.js";
import css from "./select.module.scss";

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
  readonly placeholder?: string | undefined;
  readonly className?: string | undefined;
  readonly popupClassName?: string | undefined;
  readonly size?: "sm" | "md";
  readonly borderless?: boolean;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

export function Select<Value extends string = string>(props: SelectProps<Value>) {
  const size = props.size ?? "md";
  return (
    <BaseSelect.Root<Value>
      value={props.value}
      onValueChange={(value) => value !== null && props.onValueChange(value)}
      disabled={props.disabled}
    >
      <BaseSelect.Trigger
        aria-label={props["aria-label"]}
        className={cn(
          css.trigger,
          css[size],
          props.borderless ? css.borderless : css.bordered,
          props.className,
        )}
      >
        <BaseSelect.Value placeholder={props.placeholder ?? ""} className={css.value}>
          {(selected: Value) =>
            props.options.find((option) => option.value === selected)?.label ?? selected
          }
        </BaseSelect.Value>
        <BaseSelect.Icon className={css.icon}>
          <ChevronDownIcon />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className={css.positioner} sideOffset={4}>
          <BaseSelect.Popup className={cn(css.popup, props.popupClassName)}>
            <BaseSelect.List className={css.list}>
              {props.options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={css.item}
                >
                  {option.icon}
                  <BaseSelect.ItemText className={css.itemText}>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className={css.indicator}>
                    <CheckIcon />
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
