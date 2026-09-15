import type { BindingEngineOptions } from "@univerjs-labs/binding-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => ({ cell: vi.fn(), rows: vi.fn() }));
vi.mock("@univerjs-labs/binding-engine", () => ({
  BindingEngine: class {
    setCellValue(...args: unknown[]) {
      return writes.cell(...args);
    }
    insertRowsWithValues(...args: unknown[]) {
      return writes.rows(...args);
    }
  },
}));
vi.mock("../editor", () => ({
  withWorkspaceSnapshotServerOverride: vi.fn(),
  resolveUniverLicense: vi.fn(),
}));

import { WorkspaceBindingEngine } from "./workspace-binding-engine";

const options = {
  unitId: "unit",
  collaborationClientConfig: {},
} as BindingEngineOptions;
const cell = { sheetId: "sheet", row: 1, col: 0 };
const rows = {
  sheetId: "sheet",
  startRow: 1,
  rowCount: 1,
  startColumn: 0,
  values: [["Alice", null]],
};

beforeEach(() => vi.clearAllMocks());

describe("HTML view Workspace write permissions", () => {
  it("rejects scalar writes and row insertion for a read-only source before SDK mutation", () => {
    const engine = new WorkspaceBindingEngine(options, false);
    expect(() => engine.setCellValue(cell, "Alice")).toThrow("来源 Sheet 为只读");
    expect(() => engine.insertRowsWithValues(rows)).toThrow("来源 Sheet 为只读");
    expect(writes.cell).not.toHaveBeenCalled();
    expect(writes.rows).not.toHaveBeenCalled();
  });

  it("passes permitted scalar writes and row insertion to the SDK", () => {
    const engine = new WorkspaceBindingEngine(options, true);
    engine.setCellValue(cell, "Alice");
    engine.insertRowsWithValues(rows);
    expect(writes.cell).toHaveBeenCalledExactlyOnceWith(cell, "Alice");
    expect(writes.rows).toHaveBeenCalledExactlyOnceWith(rows);
  });

  it("preserves an SDK insertion rejection", () => {
    const engine = new WorkspaceBindingEngine(options, true);
    writes.rows.mockImplementationOnce(() => {
      throw new Error("Insertion rejected");
    });
    expect(() => engine.insertRowsWithValues(rows)).toThrow("Insertion rejected");
  });
});
