import { describe, expect, it } from "vitest";
import {
  baseDiffFieldLabel,
  buildBaseDiffGridLayout,
  buildBaseTableDiff,
  formatBaseCellValue,
  getBaseDiffCell,
} from "../../web/src/features/worktrees/base-table-diff.js";
import type { StructuralDiffItem } from "../../web/src/features/worktrees/comparison-presentation.js";

function change(
  entityType: string,
  stableId: string,
  kind: "insert" | "delete" | "update",
  tableId = "t1"
): StructuralDiffItem {
  return {
    id: `${entityType}:${stableId}`,
    stableId,
    entityType,
    category: `${entityType}:${tableId}`,
    parentStableId: tableId,
    path: [entityType, tableId, stableId],
    label: stableId,
    kind,
    moved: false,
    changes: [],
    position: { left: null, right: null },
    values: {},
  };
}

describe("Base comparison table", () => {
  it("formats product values and preserves renamed labels per side", () => {
    expect(
      formatBaseCellValue(44927, {
        type: "date",
        config: { pattern: "yyyy-mm-dd" },
      })
    ).toBe("2023-01-01");
    expect(
      formatBaseCellValue(1234.5, {
        type: "currency",
        config: {
          currencySymbol: "€",
          decimalPlaces: 2,
          separatorStyle: "periodComma",
        },
      })
    ).toBe("€1.234,50");
    const field = {
      id: "f",
      left: { name: "Planned budget" },
      right: { name: "Approved budget" },
      label: "Approved budget",
      status: "update" as const,
    };
    expect(baseDiffFieldLabel(field, "left")).toBe("Planned budget");
    expect(baseDiffFieldLabel(field, "right")).toBe("Approved budget");
  });

  it("aligns fields and records by stable ID", () => {
    const left = snapshot(120, false);
    const right = snapshot(236, true);
    const [table] = buildBaseTableDiff(left, right, [
      change("cell", "r1:title", "update"),
      change("cell", "r1:risk", "insert"),
      change("field", "risk", "insert"),
      change("record", "r2", "insert"),
    ]);
    expect(table?.fields.map((field) => field.id)).toEqual([
      "title",
      "risk",
      "owner",
    ]);
    expect(table?.records.map((record) => record.id)).toEqual(["r1", "r2"]);
    const title = table!.fields.find((field) => field.id === "title")!;
    const risk = table!.fields.find((field) => field.id === "risk")!;
    const record = table!.records[0]!;
    expect(getBaseDiffCell({ field: title, record, side: "left" })).toMatchObject({
      displayValue: "Alpha",
      status: "update",
    });
    expect(getBaseDiffCell({ field: title, record, side: "right" })).toMatchObject({
      displayValue: "ALPHA",
      status: "update",
    });
    expect(getBaseDiffCell({ field: risk, record, side: "left" })).toMatchObject({
      present: false,
      status: "delete",
    });
  });

  it("uses one shared grid geometry and excludes internal IDs", () => {
    const [table] = buildBaseTableDiff(snapshot(120, false), snapshot(236, true), [
      change("cell", "r1:title", "update"),
    ]);
    expect(table?.fields.map((field) => field.id)).toEqual([
      "title",
      "risk",
      "owner",
    ]);
    expect(buildBaseDiffGridLayout(table!)).toEqual({
      columnWidths: [236, 160, 160],
      gridTemplateColumns: "44px 236px 160px 160px",
      totalWidth: 600,
    });
  });
});

function snapshot(width: number, expanded: boolean) {
  return {
    tableOrder: ["t1"],
    tables: {
      t1: {
        id: "t1",
        name: "Tasks",
        primaryFieldId: "title",
        fieldOrder: expanded
          ? ["record-id", "title", "risk", "owner"]
          : ["record-id", "title", "owner"],
        fields: {
          "record-id": {
            id: "record-id",
            name: "Record ID",
            type: "recordId",
            system: true,
          },
          title: { id: "title", name: "Title", type: "text" },
          ...(expanded
            ? { risk: { id: "risk", name: "Risk", type: "text" } }
            : {}),
          owner: { id: "owner", name: "Owner", type: "text" },
        },
        recordOrder: expanded ? ["r1", "r2"] : ["r1"],
        records: {
          r1: {
            id: "r1",
            values: {
              title: expanded ? "ALPHA" : "Alpha",
              owner: "Mina",
              ...(expanded ? { risk: "High" } : {}),
            },
          },
          ...(expanded ? { r2: { id: "r2", values: { title: "New" } } } : {}),
        },
        viewOrder: ["grid"],
        views: {
          grid: {
            id: "grid",
            type: "grid",
            fieldSettings: { title: { width } },
          },
        },
      },
    },
  };
}
