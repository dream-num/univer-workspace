import { formatBaseDateValue, formatBaseNumberValue } from "@univerjs-pro/bases";
import { BaseFieldType } from "@univerjs/core";
import type { StructuralDiffItem } from "./comparison-presentation";

type DiffKind = StructuralDiffItem["kind"];

export interface BaseDiffField {
  readonly id: string;
  readonly left: Record<string, unknown> | null;
  readonly right: Record<string, unknown> | null;
  readonly label: string;
  readonly status: DiffKind | null;
}

export interface BaseDiffRecord {
  readonly cellChanges: ReadonlyMap<string, DiffKind>;
  readonly id: string;
  readonly left: Record<string, unknown> | null;
  readonly right: Record<string, unknown> | null;
  readonly label: string;
  readonly status: DiffKind | null;
}

export interface BaseTableDiff {
  readonly id: string;
  readonly label: string;
  readonly status: DiffKind;
  readonly left: Record<string, unknown> | null;
  readonly right: Record<string, unknown> | null;
  readonly fields: readonly BaseDiffField[];
  readonly records: readonly BaseDiffRecord[];
}

export interface BaseDiffCell {
  readonly displayValue: string;
  readonly present: boolean;
  readonly value: unknown;
  readonly status: DiffKind | null;
}

const ROW_HEADER_WIDTH = 44;
const DEFAULT_FIELD_WIDTH = 160;
const MIN_FIELD_WIDTH = 80;
const MAX_FIELD_WIDTH = 480;

export function baseDiffFieldLabel(
  field: BaseDiffField,
  side: "left" | "right"
): string {
  const name = field[side]?.name;
  return typeof name === "string" && name.length > 0 ? name : field.label;
}

export function buildBaseTableDiff(
  left: unknown,
  right: unknown,
  items: readonly StructuralDiffItem[]
): BaseTableDiff[] {
  const leftTables = asRecord(asRecord(left)?.tables) ?? {};
  const rightTables = asRecord(asRecord(right)?.tables) ?? {};
  const tableIds = alignStableOrder(
    orderedIds(leftTables, asRecord(left)?.tableOrder),
    orderedIds(rightTables, asRecord(right)?.tableOrder)
  );
  return tableIds.flatMap((tableId) => {
    const leftTable = asRecord(leftTables[tableId]) ?? null;
    const rightTable = asRecord(rightTables[tableId]) ?? null;
    const tableItem = items.find(
      (item) => item.entityType === "table" && item.stableId === tableId
    );
    const children = items.filter(
      (item) => baseTableIdOfDiffItem(item) === tableId
    );
    if (tableItem === undefined && children.length === 0) return [];
    const fields = buildFields(leftTable, rightTable, children);
    return [{
      id: tableId,
      label: displayName(rightTable) ?? displayName(leftTable) ?? tableId,
      status: tableItem?.kind ?? "update",
      left: leftTable,
      right: rightTable,
      fields,
      records: buildRecords(leftTable, rightTable, fields, children),
    }];
  });
}

export function getBaseDiffCell(input: {
  readonly field: BaseDiffField;
  readonly record: BaseDiffRecord;
  readonly side: "left" | "right";
}): BaseDiffCell {
  const field = input.field[input.side];
  const record = input.record[input.side];
  const present = field !== null && record !== null;
  const cellValue = asRecord(asRecord(record)?.values)?.[input.field.id];
  const kind =
    input.record.cellChanges.get(input.field.id) ??
    (input.field.status === "insert" || input.field.status === "delete"
      ? input.field.status
      : input.record.status === "insert" || input.record.status === "delete"
        ? input.record.status
        : null);
  const status =
    kind === null || kind === "update"
      ? kind
      : (kind === "insert") === (input.side === "right")
        ? "insert"
        : "delete";
  return {
    displayValue: present ? formatBaseCellValue(cellValue, field ?? undefined) : "",
    present,
    value: cellValue,
    status,
  };
}

export function buildBaseDiffGridLayout(table: BaseTableDiff): {
  readonly columnWidths: readonly number[];
  readonly gridTemplateColumns: string;
  readonly totalWidth: number;
} {
  const widths = table.fields.map((field) => resolveFieldWidth(table, field));
  return {
    columnWidths: widths,
    gridTemplateColumns: `${ROW_HEADER_WIDTH}px ${widths.map((width) => `${width}px`).join(" ")}`,
    totalWidth: ROW_HEADER_WIDTH + widths.reduce((total, width) => total + width, 0),
  };
}

export function formatBaseCellValue(
  value: unknown,
  field?: Record<string, unknown>
): string {
  if (value === undefined || value === null) return "";
  const config = asRecord(field?.config) ?? {};
  if (
    [BaseFieldType.Date, BaseFieldType.CreatedAt, BaseFieldType.UpdatedAt].some(
      (type) => field?.type === type
    )
  ) {
    return formatBaseDateValue(value, config);
  }
  if (field?.type === BaseFieldType.Number || field?.type === BaseFieldType.Currency) {
    if (value === "") return "";
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number)
      ? formatBaseNumberValue(number, config)
      : String(value);
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => formatBaseCellValue(entry)).filter(Boolean).join(", ");
  }
  const record = asRecord(value);
  if (record === undefined) return String(value);
  const label = [record.name, record.label, record.title, record.text, record.url, record.email]
    .find((candidate): candidate is string => typeof candidate === "string");
  return label ?? JSON.stringify(value);
}

export function baseTableIdOfDiffItem(item: StructuralDiffItem): string | null {
  if (item.scope?.entityType === "table") return item.scope.stableId;
  if (item.entityType === "table") return item.stableId;
  return item.parentStableId ?? item.category.split(":", 2)[1] ?? null;
}

function buildFields(
  leftTable: Record<string, unknown> | null,
  rightTable: Record<string, unknown> | null,
  items: readonly StructuralDiffItem[]
): BaseDiffField[] {
  const leftFields = asRecord(leftTable?.fields) ?? {};
  const rightFields = asRecord(rightTable?.fields) ?? {};
  const ids = alignStableOrder(
    orderedIds(leftFields, leftTable?.fieldOrder).filter((id) => isVisibleField(leftFields[id])),
    orderedIds(rightFields, rightTable?.fieldOrder).filter((id) => isVisibleField(rightFields[id]))
  );
  const changes = new Map(
    items.filter((item) => item.entityType === "field").map((item) => [item.stableId, item.kind])
  );
  return ids.map((id) => {
    const left = asRecord(leftFields[id]) ?? null;
    const right = asRecord(rightFields[id]) ?? null;
    return {
      id,
      left,
      right,
      label: displayName(right) ?? displayName(left) ?? id,
      status: changes.get(id) ?? null,
    };
  });
}

function buildRecords(
  leftTable: Record<string, unknown> | null,
  rightTable: Record<string, unknown> | null,
  fields: readonly BaseDiffField[],
  items: readonly StructuralDiffItem[]
): BaseDiffRecord[] {
  const leftRecords = asRecord(leftTable?.records) ?? {};
  const rightRecords = asRecord(rightTable?.records) ?? {};
  const ids = alignStableOrder(
    orderedIds(leftRecords, leftTable?.recordOrder),
    orderedIds(rightRecords, rightTable?.recordOrder)
  );
  const changes = new Map(
    items.filter((item) => item.entityType === "record").map((item) => [item.stableId, item.kind])
  );
  const cellChanges = new Map(
    items.filter((item) => item.entityType === "cell").map((item) => [item.stableId, item.kind])
  );
  const labelFieldId =
    typeof rightTable?.primaryFieldId === "string"
      ? rightTable.primaryFieldId
      : typeof leftTable?.primaryFieldId === "string"
        ? leftTable.primaryFieldId
        : fields[0]?.id;
  return ids.map((id) => {
    const left = asRecord(leftRecords[id]) ?? null;
    const right = asRecord(rightRecords[id]) ?? null;
    const value =
      asRecord(asRecord(right)?.values)?.[labelFieldId ?? ""] ??
      asRecord(asRecord(left)?.values)?.[labelFieldId ?? ""];
    return {
      id,
      left,
      right,
      label: formatBaseCellValue(value) || id,
      status: changes.get(id) ?? null,
      cellChanges: new Map(
        fields.flatMap((field) => {
          const kind = cellChanges.get(`${id}:${field.id}`);
          return kind === undefined ? [] : [[field.id, kind] as const];
        })
      ),
    };
  });
}

function isVisibleField(value: unknown): boolean {
  const field = asRecord(value);
  return field !== undefined && field.system !== true && field.type !== "recordId";
}

function resolveFieldWidth(table: BaseTableDiff, field: BaseDiffField): number {
  const widths = [
    viewFieldWidth(table.left, field.id, field.left !== null),
    viewFieldWidth(table.right, field.id, field.right !== null),
  ].filter((width): width is number => width !== null);
  const width = widths.length === 0 ? DEFAULT_FIELD_WIDTH : Math.max(...widths);
  return Math.min(MAX_FIELD_WIDTH, Math.max(MIN_FIELD_WIDTH, Math.round(width)));
}

function viewFieldWidth(
  table: Record<string, unknown> | null,
  fieldId: string,
  present: boolean
): number | null {
  if (table === null || !present) return null;
  const views = asRecord(table.views) ?? {};
  for (const id of orderedIds(views, table.viewOrder)) {
    const view = asRecord(views[id]);
    if (view?.type !== "grid") continue;
    const setting = asRecord(asRecord(view.fieldSettings)?.[fieldId]);
    if (typeof setting?.width === "number" && Number.isFinite(setting.width)) {
      return setting.width;
    }
  }
  return DEFAULT_FIELD_WIDTH;
}

function orderedIds(record: Record<string, unknown>, orderValue: unknown): string[] {
  const order = Array.isArray(orderValue)
    ? orderValue.filter((id): id is string => typeof id === "string" && id in record)
    : [];
  return [...order, ...Object.keys(record).filter((id) => !order.includes(id))];
}

function alignStableOrder(left: readonly string[], right: readonly string[]): string[] {
  const result = [...right];
  for (let index = 0; index < left.length; index += 1) {
    const id = left[index];
    if (id === undefined || result.includes(id)) continue;
    const next = left.slice(index + 1).find((candidate) => result.includes(candidate));
    if (next !== undefined) result.splice(result.indexOf(next), 0, id);
    else {
      const previous = [...left.slice(0, index)].reverse().find((candidate) => result.includes(candidate));
      if (previous === undefined) result.push(id);
      else result.splice(result.indexOf(previous) + 1, 0, id);
    }
  }
  return result;
}

function displayName(value: Record<string, unknown> | null): string | null {
  return typeof value?.name === "string" ? value.name : null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
