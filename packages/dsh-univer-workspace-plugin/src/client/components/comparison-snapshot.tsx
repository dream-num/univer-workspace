import * as React from "react";
import { ICommandService, UniverInstanceType, type IDocumentData, type LocaleType } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { SetDocZoomRatioOperation } from "@univerjs/docs-ui";
import type { UnitComparisonUniverFactory, UnitComparisonViewerValue } from "@univer/unit-comparison-viewer";
import { createComparisonUnit } from "../viewer/comparison.ts";
import css from "./review-panel.module.scss";

/** A full-size, immutable version alongside the structured comparison mode. */
export function ComparisonSnapshot(props: {
  comparison: UnitComparisonViewerValue;
  createUniver: UnitComparisonUniverFactory;
  locale: LocaleType;
}): React.ReactElement {
  const container = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const element = container.current;
    const data = props.comparison.right.unitData;
    if (!element || data === null) return;
    let canceled = false;
    let dispose: (() => void) | undefined;
    setError(null);
    void props.createUniver({ container: element, unitType: props.comparison.result.unit.type,
      locale: props.locale, darkMode: false,
    }).then(async instance => {
      if (canceled) { instance.dispose(); return; }
      dispose = () => instance.dispose();
      try {
        createComparisonUnit(instance.univer, props.comparison);
        const api = FUniver.newAPI(instance.univer);
        dispose = () => { api.dispose(); instance.dispose(); };
        if (props.comparison.result.unit.type === UniverInstanceType.UNIVER_DOC) {
          // Mounting a model alone does not establish the document viewport.
          // Initialize it once the host has a measurable render surface, as
          // the native comparison pane does before navigating its selection.
          for (let frame = 0; frame < 120; frame++) {
            if (canceled) return;
            const canvas = element.querySelector("canvas");
            if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) break;
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          }
          if (canceled) return;
          const pageWidth = (data as IDocumentData).documentStyle.pageSize?.width ?? 816;
          await instance.univer.__getInjector().get(ICommandService).executeCommand(
            SetDocZoomRatioOperation.id,
            { unitId: data.id, zoomRatio: Math.min(1, Math.max(1, element.clientWidth - 32) / pageWidth) },
            { onlyLocal: true },
          );
          if (!canceled) api.getActiveDocument()?.setSelection(0, 0);
        }
      } catch (reason) {
        dispose();
        dispose = undefined;
        throw reason;
      }
    }).catch(reason => { if (!canceled) setError(String(reason.message ?? reason)); });
    return () => { canceled = true; dispose?.(); };
  }, [props.comparison, props.createUniver, props.locale]);
  return <div className={css.viewerEditor}>
    {error === null ? null : <div role="alert">{error}</div>}
    <div ref={container} className={css.viewerContainer} />
  </div>;
}
