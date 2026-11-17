import { useId } from "react";
import { cn } from "../shared/utils/cn";
import { useI18n } from "../shared/i18n";
import { MODE_IDS, modes, type WorkspaceMode } from "./registry";

export function ModeChoiceCards({ value, onChange, compact = false }: {
  readonly compact?: boolean;
  readonly value: string;
  readonly onChange: (mode: WorkspaceMode) => void;
}) {
  const { t } = useI18n();
  const groupId = useId();
  return (
    <div className={cn("grid", compact ? "grid-cols-2 gap-2" : "gap-4 sm:grid-cols-2")}>
      {MODE_IDS.map((id) => {
        const { label, description, shortDescription, preview } = modes[id];
        return (
          <label
            key={id}
            className="flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-background transition-colors hover:border-primary/50 has-checked:border-primary has-checked:ring-1 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-ring"
          >
            <img
              alt=""
              src={preview}
              width={1024}
              height={560}
              className="block h-auto w-full border-b border-border"
            />
            <span className={cn("flex items-center justify-between font-semibold", compact ? "gap-1 px-2.5 pt-2 text-sm" : "gap-3 px-4 pt-3 text-lg")}>
              {t(label)}
              <input
                type="radio"
                name={groupId}
                value={id}
                checked={value === id}
                onChange={() => onChange(id)}
                aria-label={t(label)}
                aria-describedby={`${groupId}-${id}`}
                className={cn("shrink-0 accent-primary", compact ? "size-3.5" : "size-4")}
              />
            </span>
            <span id={`${groupId}-${id}`} className={cn("text-muted-foreground", compact ? "px-2.5 pt-0.5 pb-2 text-xs" : "px-4 pt-1 pb-4 text-sm")}>
              {t(compact ? shortDescription : description)}
            </span>
          </label>
        );
      })}
    </div>
  );
}
