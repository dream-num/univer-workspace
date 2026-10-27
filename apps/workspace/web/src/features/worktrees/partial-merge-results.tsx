import type { components } from "../../../../generated/http/schema.js";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Alert } from "../../shared/ui";

type WorktreeUnit = Pick<components["schemas"]["WorktreeUnit"],
  "unitId" | "name" | "source" | "mergeResult" | "activationState">;

/** Report the Server's individual results when a multi-unit merge is partial. */
export function PartialMergeResults({ units }: { readonly units: readonly WorktreeUnit[] }) {
  const { t } = useI18n();
  const pendingPublication = units.some((unit) =>
    unit.source === "worktree" && unit.mergeResult === "merged" &&
    ["waitingForMerge", "pending", "failed"].includes(unit.activationState));
  const partial = units.length > 1 && (pendingPublication || (
    units.some((unit) => ["merged", "unchanged", "removed"].includes(unit.mergeResult)) &&
    units.some((unit) => ["pending", "conflict", "failed"].includes(unit.mergeResult))));
  if (!partial) return null;
  return (
    <Alert className="mx-4.5 mt-3" variant="warning">
      <p>{t("partialMergeNotice")}</p>
      <ul>
        {units.map((unit) => (
          <li key={unit.unitId}>
            {unit.name}: {t("mergeResultLabel", { value: t(unit.mergeResult) })}
            {unit.source === "worktree" && (
              <> · {t("mergeActivationLabel", { value: t(activationLabel(unit.activationState)) })}</>
            )}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function activationLabel(state: WorktreeUnit["activationState"]): MessageKey {
  return {
    notApplicable: "activationNotApplicable",
    waitingForMerge: "activationWaitingForMerge",
    pending: "activationPending",
    completed: "activationCompleted",
    failed: "activationFailed",
    discarded: "activationDiscarded",
  }[state] as MessageKey;
}
