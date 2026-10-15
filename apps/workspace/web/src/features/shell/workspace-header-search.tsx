import { Search, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Button, Input, Tooltip } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

export function WorkspaceHeaderSearch({
  value,
  placeholder,
  onChange,
}: {
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const activeSearch = value.length > 0;
  const searchLabel = activeSearch ? t("searchWithQuery", { query: value }) : placeholder;
  if (!open) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip content={searchLabel}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={searchLabel}
            className={cn("relative", activeSearch && "bg-brand-50 text-brand-700")}
            onClick={() => setOpen(true)}
          >
            <Search />
            {activeSearch ? (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 size-1.5 rounded-full bg-brand-700"
              />
            ) : null}
          </Button>
        </Tooltip>
        {activeSearch ? (
          <Tooltip content={t("clearSearch")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("clearSearch")}
              onClick={() => onChange("")}
            >
              <X />
            </Button>
          </Tooltip>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex w-[min(320px,45vw)] min-w-44 items-center gap-1 max-[720px]:w-[min(260px,calc(100vw-132px))]">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
          aria-hidden="true"
        />
        <Input
          autoFocus
          aria-label={placeholder}
          className="h-9 rounded-full border-transparent bg-muted pl-9 shadow-none hover:bg-accent focus:border-ring focus:bg-background"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("close")}
        onClick={() => {
          onChange("");
          setOpen(false);
        }}
      >
        <X />
      </Button>
    </div>
  );
}
