import { useState } from "react";
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
  return (
    <div className="grid gap-2">
      <div role="tablist" aria-label={t("issueComposerMode")} className="flex gap-1 border-b border-border">
        {([false, true] as const).map((isPreview) => (
          <button
            key={String(isPreview)}
            type="button"
            role="tab"
            aria-selected={preview === isPreview}
            onClick={() => setPreview(isPreview)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors",
              preview === isPreview
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {isPreview ? t("issuePreview") : t("issueWrite")}
          </button>
        ))}
      </div>
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
      <p className="m-0 text-xs text-subtle-foreground">{t("issueMarkdownHint")}</p>
    </div>
  );
}
