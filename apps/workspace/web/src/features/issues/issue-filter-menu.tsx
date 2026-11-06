import { Check, ChevronDown } from "lucide-react";
import { Button, MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

export function IssueFilterMenu({
  label,
  value,
  options,
  onValueChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onValueChange: (value: string) => void;
}) {
  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-muted-foreground"
            aria-label={label}
          >
            {label}
            <ChevronDown className="size-3" />
          </Button>
        }
      />
      <MenuContent align="end" className="max-h-72 overflow-y-auto">
        {options.map((option) => (
          <MenuItem
            key={option.value}
            role="menuitemradio"
            aria-checked={option.value === value}
            onClick={() => onValueChange(option.value)}
          >
            <Check className={cn("size-4", option.value !== value && "invisible")} />
            {option.label}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
