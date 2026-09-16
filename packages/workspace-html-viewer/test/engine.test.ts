import type { BindingEngineOptions } from "@univerjs-labs/binding-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => ({
  cell: vi.fn(),
  rows: vi.fn(),
  load: vi.fn(),
  dispose: vi.fn(),
}));
// Permission checks do not need the browser collaboration UI runtime.
vi.mock("@univerjs-pro/collaboration-client-ui", () => ({
  BrowserCollaborationSocketService: class {},
}));
vi.mock("@univerjs-labs/binding-engine", () => ({
  BindingEngine: class {
    load() {
      return writes.load();
    }
    dispose() {
      writes.dispose();
    }
    setCellValue(...args: unknown[]) {
      return writes.cell(...args);
    }
    insertRowsWithValues(...args: unknown[]) {
      return writes.rows(...args);
    }
  },
}));
import { createWorkspaceHtmlEngine, WorkspaceBindingEngine } from "../src/engine.js";

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
  it.each([false, true])("asks guests to sign in regardless of canEdit=%s", (canEdit) => {
    const engine = new WorkspaceBindingEngine(options, canEdit, true);
    expect(() => engine.setCellValue(cell, "Alice")).toThrow("当前为访客模式，请登录后再操作");
    expect(() => engine.insertRowsWithValues(rows)).toThrow("当前为访客模式，请登录后再操作");
    expect(writes.cell).not.toHaveBeenCalled();
    expect(writes.rows).not.toHaveBeenCalled();
  });

  it("rejects scalar writes and row insertion for a read-only source before SDK mutation", () => {
    const engine = new WorkspaceBindingEngine(options, false);
    expect(() => engine.setCellValue(cell, "Alice")).toThrow("你没有此表格的编辑权限，请联系所有者申请权限。");
    expect(() => engine.insertRowsWithValues(rows)).toThrow("你没有此表格的编辑权限，请联系所有者申请权限。");
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

describe("HTML source runtime ownership", () => {
  const config = {
    unitId: "unit",
    canEdit: true,
    user: { id: "user", displayName: "User" },
    license: "",
    collaborationClientConfig: {} as BindingEngineOptions["collaborationClientConfig"],
    registerEmbed: vi.fn(),
  };
  it("does not load an already-aborted source", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(createWorkspaceHtmlEngine(config, abort.signal)).rejects.toThrow();
    expect(writes.load).not.toHaveBeenCalled();
  });
  it("disposes once when cancellation races with load rejection", async () => {
    let reject!: (error: Error) => void;
    writes.load.mockImplementationOnce(
      () =>
        new Promise((_, rejectLoad) => {
          reject = rejectLoad;
        }),
    );
    const abort = new AbortController();
    const loading = createWorkspaceHtmlEngine(config, abort.signal);
    abort.abort();
    reject(new Error("load interrupted"));
    await expect(loading).rejects.toThrow("load interrupted");
    expect(writes.dispose).toHaveBeenCalledTimes(1);
  });
  it("disposes a failed load", async () => {
    writes.load.mockRejectedValueOnce(new Error("source unavailable"));
    await expect(createWorkspaceHtmlEngine(config, new AbortController().signal)).rejects.toThrow(
      "source unavailable",
    );
    expect(writes.dispose).toHaveBeenCalledTimes(1);
  });
  it("transfers a loaded engine to the host and removes the loading abort listener", async () => {
    writes.load.mockResolvedValueOnce(undefined);
    const abort = new AbortController();
    const engine = await createWorkspaceHtmlEngine(config, abort.signal);
    abort.abort();
    expect(writes.dispose).not.toHaveBeenCalled();
    engine.dispose();
    expect(writes.dispose).toHaveBeenCalledTimes(1);
  });
});
