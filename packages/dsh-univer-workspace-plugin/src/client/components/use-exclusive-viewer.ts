import * as React from "react";
import { claimExclusiveViewer } from "./viewer-expansion.ts";

/**
 * Keep exactly one expanded viewer for a Unit across turn cards and floating
 * windows. A newly expanded surface owns the Unit and collapses the previous
 * owner before the browser paints the new frame.
 */
export function useExclusiveViewer(
  unitId: string | undefined,
  expanded: boolean,
  collapse: () => void,
): void {
  const token = React.useRef<object>({}).current;
  const collapseRef = React.useRef(collapse);
  collapseRef.current = collapse;

  React.useLayoutEffect(() => {
    if (!expanded || unitId === undefined || unitId === "") return;

    return claimExclusiveViewer(unitId, token, () => collapseRef.current());
  }, [expanded, token, unitId]);
}
