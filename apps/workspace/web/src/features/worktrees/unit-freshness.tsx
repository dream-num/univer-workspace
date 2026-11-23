import type { components } from "../../../../generated/http/schema.js";
import { useI18n } from "../../shared/i18n";
import { Badge, Tooltip } from "../../shared/ui";

type Freshness = components["schemas"]["WorktreeUnit"]["freshness"];

/** Marks a Trunk file that is behind or stale. A current one needs no mark. */
export function UnitFreshnessBadge({ freshness }: { readonly freshness: Freshness }) {
  const { t } = useI18n();
  const text = unitFreshnessText(freshness, t);
  if (!text) return null;
  return (
    <Tooltip content={text.hint}>
      <Badge
        variant={freshness?.label === "stale" ? "warning" : "default"}
        role="img"
        aria-label={`${text.label}. ${text.hint}`}
        className="shrink-0 px-1.5 py-0 text-[11px]"
      >
        {text.label}
      </Badge>
    </Tooltip>
  );
}

export function unitFreshnessText(
  freshness: Freshness,
  t: ReturnType<typeof useI18n>["t"],
): { readonly label: string; readonly hint: string } | null {
  if (!freshness || freshness.label === "current") return null;
  const count = freshness.revisionsBehind;
  return freshness.label === "stale"
    ? { label: t("unitStale"), hint: t("unitStaleHint") }
    : { label: t("unitBehind", { count }), hint: t("unitBehindHint", { count }) };
}
