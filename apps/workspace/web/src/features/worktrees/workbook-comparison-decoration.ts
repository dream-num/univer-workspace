import type { IUnitComparisonItem } from "@univerjs-pro/edit-history";

const TONE_COLOR = {
  delete: "rgba(220, 38, 38, 0.28)",
  insert: "rgba(22, 163, 74, 0.28)",
  update: "rgba(37, 99, 235, 0.24)",
} as const;

const EMPHASIZED_TONE_COLOR = {
  delete: "rgba(220, 38, 38, 0.46)",
  insert: "rgba(22, 163, 74, 0.46)",
  update: "rgba(37, 99, 235, 0.42)",
} as const;

/** Paint semantic Sheet cell differences into a local read-only workbook copy. */
export function decorateWorkbookComparisonSide(
  data: Readonly<Record<string, unknown>>,
  side: "left" | "right",
  items: readonly IUnitComparisonItem[],
  selectedItemId?: string
): Record<string, unknown> {
  const decorated = structuredClone(data) as Record<string, unknown>;
  const sheets = asRecord(decorated.sheets);
  if (sheets === undefined) return decorated;

  for (const item of items) {
    if (item.entityType !== "cell" || !isVisibleOnSide(item, side)) continue;
    const sheetId = item.scope?.stableId ?? item.parentStableId;
    const location = item.locations[side];
    const address = location?.stableId ?? item.stableId;
    const position = parseCellAddress(address);
    const sheet = sheetId === undefined ? undefined : asRecord(sheets[sheetId]);
    const cellData = asRecord(sheet?.cellData);
    if (position === undefined || cellData === undefined) continue;

    const row = (asRecord(cellData[String(position.row)]) ?? {}) as Record<
      string,
      unknown
    >;
    cellData[String(position.row)] = row;
    const cell = (asRecord(row[String(position.column)]) ?? {}) as Record<
      string,
      unknown
    >;
    row[String(position.column)] = cell;
    const tone = item.kind === "update" ? "update" : item.kind;
    const style = asRecord(cell.s) ?? {};
    cell.s = {
      ...style,
      bg: {
        rgb:
          item.id === selectedItemId
            ? EMPHASIZED_TONE_COLOR[tone]
            : TONE_COLOR[tone],
      },
    };
  }
  return decorated;
}

function isVisibleOnSide(
  item: IUnitComparisonItem,
  side: "left" | "right"
): boolean {
  return (
    item.kind === "update" ||
    (item.kind === "delete" && side === "left") ||
    (item.kind === "insert" && side === "right")
  );
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
