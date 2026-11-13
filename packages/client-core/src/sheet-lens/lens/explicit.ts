// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/src/lens/explicit.ts
// (reference implementation, read-only; ADR-0006). uxl changes: strict-null typing, no `any`, snapshot types from engine/types,
// stateless refs and sheet counts.
import type { Rect } from "./ranges.js";

export interface ExplicitRegion {
  kind: "table" | "autofilter" | "definedName" | "pivot" | "label";
  name?: string;
  range: string;
  regionKind?: "table" | "matrix" | "form" | "text" | "kpi" | "block";
  headerRows?: number;
}
export interface ExplicitObject {
  type: "table" | "filter" | "name" | "cf" | "dv" | "chart" | "image" | "shape" | "pivot";
  id: string;
  scope?: string;
  ranges: Rect[];
  summary: string;
  /** Where the object's data comes from, printed as `src=` (a sheet-qualified A1 range, e.g. `s1!A1:L453`). */
  source?: string;
}
export interface WorkbookStructure {
  sheets: { id: string; regions: ExplicitRegion[]; objects: ExplicitObject[] }[];
}

export function objectRef(type: string, id: string, scope?: string): string {
  const source = scope === undefined ? id : JSON.stringify([scope, id]);
  const encoded =
    scope === undefined && /^[A-Za-z0-9_.-]+$/.test(id) && !id.startsWith("b64_")
      ? id
      : "b64_" +
        btoa(unescape(encodeURIComponent(source)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "");
  return `obj:${type}/${encoded}`;
}
