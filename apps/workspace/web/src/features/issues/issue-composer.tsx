import { useId, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Textarea } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { IssueMarkdown } from "./issue-markdown";

/** Write/Preview textarea shared by new Issues, edits and comments. */
export function IssueComposer({
  id,
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  invalid,
  rows = 6,
  onSubmit,
}: {
  readonly id?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly rows?: number;
  /** Called on Ctrl/Cmd+Enter. */
  readonly onSubmit?: () => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState(false);
  const tabId = useId();
  return (
    <div className="grid gap-2">
      <div
        role="tablist"
        aria-label={t("issueComposerMode")}
        className="flex gap-1 rounded-t-sm border border-border bg-surface px-2 pt-2"
      >
        {([false, true] as const).map((isPreview) => (
          <button
            key={String(isPreview)}
            type="button"
            role="tab"
            id={`${tabId}-${isPreview}`}
            aria-controls={`${tabId}-panel`}
            aria-selected={preview === isPreview}
            tabIndex={preview === isPreview ? 0 : -1}
            onClick={() => setPreview(isPreview)}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? false : event.key === "End" ? true : !preview;
                setPreview(next);
                document.getElementById(`${tabId}-${next}`)?.focus();
              }
            }}
            className={cn(
              "-mb-px rounded-t-sm border px-4 py-2 text-sm transition-colors",
              preview === isPreview
                ? "border-border border-b-background bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {isPreview ? t("issuePreview") : t("issueWrite")}
          </button>
        ))}
      </div>
      <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${preview}`}>
        {preview ? (
          <div className="min-h-24 rounded-md border border-border px-3 py-2">
            {value.trim() ? (
              <IssueMarkdown text={value} />
            ) : (
              <p className="m-0 text-sm text-muted-foreground">{t("issueNothingToPreview")}</p>
            )}
          </div>
        ) : (
          <Textarea
            {...(id ? { id } : {})}
            aria-label={ariaLabel ?? t("issueWrite")}
            className="rounded-sm bg-background"
            rows={rows}
            value={value}
            {...(placeholder ? { placeholder } : {})}
            {...(disabled ? { disabled } : {})}
            {...(invalid ? { invalid } : {})}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (onSubmit && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
        )}
      </div>
      <p className="m-0 text-xs text-subtle-foreground">{t("issueMarkdownHint")}</p>
    </div>
  );
}
