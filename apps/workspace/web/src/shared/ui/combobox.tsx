import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../utils/cn";

/**
 * Async-search single-select combobox built on Base UI Combobox.
 * The caller owns fetching; `filter={null}` disables client filtering.
 * The input itself is uncontrolled: Base UI renders the selected item's
 * label when the popup closes, while `onInputValueChange` drives search.
 */
export interface SearchSelectProps<Item> {
  readonly items: readonly Item[];
  readonly value: Item | null;
  readonly onValueChange: (value: Item | null) => void;
  readonly onInputValueChange: (value: string, reason: string) => void;
  readonly itemToStringLabel: (item: Item) => string;
  readonly itemKey: (item: Item) => string;
  readonly renderItem: (item: Item) => React.ReactNode;
  readonly placeholder?: string;
  readonly emptyContent?: React.ReactNode;
  readonly "aria-label"?: string;
}

export function SearchSelect<Item>({
  items,
  value,
  onValueChange,
  onInputValueChange,
  itemToStringLabel,
  itemKey,
  renderItem,
  placeholder,
  emptyContent,
  ...rest
}: SearchSelectProps<Item>) {
  return (
    <BaseCombobox.Root<Item>
      items={items}
      value={value}
      onValueChange={onValueChange}
      onInputValueChange={(next, details) =>
        onInputValueChange(next, details.reason)
      }
      itemToStringLabel={itemToStringLabel}
      filter={null}
    >
      <BaseCombobox.InputGroup
        className={cn(
          "relative flex h-9 w-full items-center rounded-md border border-input bg-background shadow-xs transition-[border-color,box-shadow]",
          "hover:border-border-strong focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25"
        )}
      >
        <BaseCombobox.Input
          aria-label={rest["aria-label"]}
          placeholder={placeholder}
          className="h-full w-full min-w-0 rounded-md bg-transparent px-3 pr-8 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
        />
        <BaseCombobox.Trigger
          aria-label="Toggle options"
          className="absolute inset-y-0 right-0 flex w-8 cursor-pointer items-center justify-center text-subtle-foreground transition-colors hover:text-muted-foreground"
        >
          <ChevronDown className="size-3.5" />
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner
          className="z-50 outline-none select-none"
          sideOffset={4}
        >
          <BaseCombobox.Popup
            className={cn(
              "w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-border bg-background shadow-pop outline-none",
              "transition-[scale,opacity] duration-100 ease-out",
              "data-ending-style:scale-[0.97] data-ending-style:opacity-0",
              "data-starting-style:scale-[0.97] data-starting-style:opacity-0"
            )}
          >
            <BaseCombobox.Empty className="px-3 py-6 text-center text-[13px] text-muted-foreground data-empty:p-0">
              {emptyContent}
            </BaseCombobox.Empty>
            <BaseCombobox.List className="max-h-60 scroll-py-1 overflow-y-auto overscroll-contain p-1 outline-none data-empty:p-0">
              {(item: Item) => (
                <BaseCombobox.Item
                  key={itemKey(item)}
                  value={item}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary-foreground outline-none select-none",
                    "data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  )}
                >
                  <span className="min-w-0 flex-1">{renderItem(item)}</span>
                  <BaseCombobox.ItemIndicator className="text-primary">
                    <Check className="size-3.5" />
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
