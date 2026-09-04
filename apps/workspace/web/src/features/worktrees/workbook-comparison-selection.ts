import type { IUnitComparisonItem } from "@univerjs-pro/edit-history";
import type { LocalSheetSelection } from "../editor/collaboration-editor";

export function comparisonSheetSelection(
  item: IUnitComparisonItem | null,
  side: "left" | "right"
): LocalSheetSelection | undefined {
  if (item === null) return undefined;
  const location = item.locations[side];
  if (location === null) return undefined;
  const sheetId =
    item.scope?.stableId ?? location.parentStableId ?? item.parentStableId;
  if (sheetId === undefined) return undefined;
  const target = location.target;
  if (target?.kind === "sheet-range") {
    const range = target.range ?? target.ranges?.[0];
    return range === undefined ? undefined : { sheetId, ...range, kind: item.kind };
  }
  if (target?.kind === "sheet-axis") {
    return target.axis === "row"
      ? {
          sheetId,
          startRow: target.start,
          endRow: target.end,
          startColumn: 0,
          endColumn: 0,
          kind: item.kind,
        }
      : {
          sheetId,
          startRow: 0,
          endRow: 0,
          startColumn: target.start,
          endColumn: target.end,
          kind: item.kind,
        };
  }
  const address = parseCellAddress(location.stableId);
  if (address !== undefined) {
    return {
      sheetId,
      startRow: address.row,
      endRow: address.row,
      startColumn: address.column,
      endColumn: address.column,
      kind: item.kind,
    };
  }
  if (location.position === undefined || location.position === null) {
    return undefined;
  }
  const row = Math.floor(location.position / 16_384);
  const column = location.position % 16_384;
  return {
    sheetId,
    startRow: row,
    endRow: row,
    startColumn: column,
    endColumn: column,
    kind: item.kind,
  };
}

function parseCellAddress(
  address: string
): { readonly row: number; readonly column: number } | undefined {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address);
  if (match === null) return undefined;
  let column = 0;
  for (const character of match[1]!.toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}
