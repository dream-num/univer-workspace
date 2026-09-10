import * as React from "react";
import { createPortal } from "react-dom";
import { Segmented } from "@univerjs/univer-workspace-ui";
import { LocaleType } from "@univerjs/core";
import { UnitComparisonViewer, type UnitComparisonViewerValue } from "@univer/unit-comparison-viewer";
import type { UniverLocaleKey } from "../locales.ts";
import { comparisonUniverFactory } from "../viewer/comparison.ts";
import { loadComparison, type ComparisonView } from "../api/comparison-api.ts";
import { ComparisonSnapshot } from "./comparison-snapshot.tsx";
import css from "./review-panel.module.scss";
import "../comparison.css";

export function WorktreeComparison(props: {
  controlsContainer?: HTMLElement | null | undefined;
  presentation?: "diff" | "version" | undefined;
  worktreeId: string;
  unitId: string;
  status: string;
  initialView: ComparisonView;
  locale: LocaleType;
  license: string;
  t: (key: UniverLocaleKey) => string;
}): React.ReactElement {
  const [view, setView] = React.useState<ComparisonView>(props.initialView);
  const [localPresentation, setPresentation] = React.useState<"diff" | "version">("diff");
  const presentation = props.presentation ?? localPresentation;
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<
    { value: UnitComparisonViewerValue; error?: never } | { value?: never; error: string } | null
  >(null);
  const selected = view === "merged" && props.status !== "merged" ||
    view === "preview" && props.status !== "ready" ? "draft" : view;
  const factory = React.useMemo(() => comparisonUniverFactory(props.license), [props.license]);
  const baseLabel = props.t("comparison.base");
  const resultLabel = props.t(`comparison.${selected}`);
  React.useEffect(() => { setView(props.initialView); }, [props.worktreeId, props.unitId, props.status, props.initialView]);
  React.useEffect(() => {
    const controller = new AbortController();
    setState(null);
    void loadComparison(props.worktreeId, props.unitId, selected,
      { base: baseLabel, result: resultLabel }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setState({ value }); })
      .catch(error => { if (!controller.signal.aborted) setState({ error: String(error.message ?? error) }); });
    return () => controller.abort();
  }, [props.worktreeId, props.unitId, selected, baseLabel, resultLabel, attempt]);
  return <div className={css.comparisonContainer}>
    {props.controlsContainer && props.presentation === undefined ? createPortal(<>
      {props.status === "merged" ? <select className={css.comparisonSelect}
        aria-label={props.t("comparison.title")} value={selected}
        onChange={event => setView(event.target.value as ComparisonView)}>
        <option value="draft">{props.t("comparison.draft")}</option>
        <option value="merged">{props.t("comparison.merged")}</option>
      </select> : null}
      <Segmented size="sm" aria-label={props.t("comparison.title")}
        value={presentation} onValueChange={setPresentation}
        options={[
          { value: "diff", label: props.t("comparison.diff") },
          { value: "version", label: props.t("comparison.version") },
        ]} />
    </>, props.controlsContainer) : null}
    {state?.value ? presentation === "version" ? <ComparisonSnapshot
      comparison={state.value} createUniver={factory} locale={props.locale}
    /> : <div className={css.comparisonScroll}><div className={css.comparisonSurface}><UnitComparisonViewer
      key={state.value.result.comparisonId}
      comparison={state.value} createUniver={factory} locale={props.locale} darkMode={false}
      messages={{
        ...(state.value.left.unitData === null ? { snapshotUnavailable: props.t("comparison.emptyBase") } : {}),
        comparingMaterializedSnapshots: props.t("comparison.snapshotNotice"),
      }}
    /></div></div> : <div className={css.viewerStatus} role={state?.error ? "alert" : "status"}>
      <span>{state?.error ?? props.t("window.loading")}</span>
      {state?.error ? <button type="button" onClick={() => setAttempt(value => value + 1)}>{props.t("window.retry")}</button> : null}
    </div>}
  </div>;
}
