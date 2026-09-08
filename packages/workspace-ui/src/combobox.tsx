import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import type { ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons.js";
import css from "./combobox.module.scss";

export interface SearchSelectProps<Item> {
  readonly items: readonly Item[];
  readonly value: Item | null;
  readonly onValueChange: (value: Item | null) => void;
  readonly onInputValueChange: (value: string, reason: string) => void;
  readonly itemToStringLabel: (item: Item) => string;
  readonly itemKey: (item: Item) => string;
  readonly renderItem: (item: Item) => ReactNode;
  readonly placeholder?: string;
  readonly emptyContent?: ReactNode;
  readonly "aria-label"?: string;
}

export function SearchSelect<Item>(props: SearchSelectProps<Item>) {
  return (
    <BaseCombobox.Root<Item>
      items={props.items}
      value={props.value}
      onValueChange={props.onValueChange}
      onInputValueChange={(value, details) => props.onInputValueChange(value, details.reason)}
      itemToStringLabel={props.itemToStringLabel}
      filter={null}
    >
      <BaseCombobox.InputGroup className={css.inputGroup}>
        <BaseCombobox.Input
          aria-label={props["aria-label"]}
          placeholder={props.placeholder}
          className={css.input}
        />
        <BaseCombobox.Trigger aria-label="Toggle options" className={css.trigger}>
          <ChevronDownIcon />
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className={css.positioner} sideOffset={4}>
          <BaseCombobox.Popup className={css.popup}>
            <BaseCombobox.Empty className={css.empty}>{props.emptyContent}</BaseCombobox.Empty>
            <BaseCombobox.List className={css.list}>
              {(item: Item) => (
                <BaseCombobox.Item key={props.itemKey(item)} value={item} className={css.item}>
                  <span className={css.itemContent}>{props.renderItem(item)}</span>
                  <BaseCombobox.ItemIndicator className={css.indicator}>
                    <CheckIcon />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
