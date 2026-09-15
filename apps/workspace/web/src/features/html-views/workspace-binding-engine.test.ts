import type { BindingEngineOptions } from "@univerjs-labs/binding-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => ({
  cell: vi.fn(),
  rows: vi.fn(),
  options: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../../shared/api/client", () => ({ api: { GET: writes.get, POST: writes.post } }));
vi.mock("@univerjs-labs/binding-engine", () => ({
  BindingEngine: class {
    constructor(options: unknown) {
      writes.options(options);
    }
    async load() {}
    dispose() {}
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

import { createWorkspaceBindingEngine, WorkspaceBindingEngine } from "./workspace-binding-engine";
import { withWorkspaceSnapshotServerOverride } from "../editor";

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
  it("uses HTML authorization for every collaboration and snapshot endpoint", async () => {
    vi.stubGlobal("location", {
      protocol: "https:",
      host: "workspace.test",
      origin: "https://workspace.test",
    });
    writes.get.mockResolvedValueOnce({ data: { unitId: "unit", editorMode: "edit" } });
    const signal = new AbortController().signal;
    try {
      const engine = await createWorkspaceBindingEngine(
        "unit",
        { id: "editor", displayName: "Editor" },
        signal,
        "html",
      );
      expect(writes.get).toHaveBeenCalledExactlyOnceWith(
        "/api/html-views/{resourceId}/sources/{unitId}",
        {
          params: { path: { resourceId: "html", unitId: "unit" } },
          signal,
        },
      );
      expect(writes.post).not.toHaveBeenCalled();
      expect(writes.options).toHaveBeenCalledWith(
        expect.objectContaining({
          collaborationClientConfig: expect.objectContaining({
            snapshotServerUrl: "/universer-api/html-views/html/snapshot",
            collabSubmitChangesetUrl: "/universer-api/html-views/html/comb",
            collabWebSocketUrl: "wss://workspace.test/universer-api/html-views/html/comb/connect",
            wsSessionTicketUrl: "/universer-api/html-views/html/user/session-ticket",
            authzUrl: "/universer-api/html-views/html/authz",
          }),
        }),
      );
      expect(withWorkspaceSnapshotServerOverride).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          trunkSnapshotServerUrl: "/universer-api/html-views/html/snapshot",
        }),
      );
      engine.setCellValue(cell, "shared edit");
      expect(writes.cell).toHaveBeenCalledWith(cell, "shared edit");
      engine.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not fall back to direct Sheet permissions when HTML authorization fails", async () => {
    writes.get.mockResolvedValueOnce({
      error: { error: { code: "FORBIDDEN", message: "HTML view access denied." } },
    });
    await expect(
      createWorkspaceBindingEngine(
        "unit",
        { id: "viewer", displayName: "Viewer" },
        new AbortController().signal,
        "html",
      ),
    ).rejects.toThrow("HTML view access denied");
    expect(writes.options).not.toHaveBeenCalled();
    expect(writes.post).not.toHaveBeenCalled();
  });
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
