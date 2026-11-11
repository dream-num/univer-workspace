import type { BindingEngineOptions } from "@univerjs-labs/binding-engine";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => ({
  cell: vi.fn(),
  rows: vi.fn(),
  load: vi.fn(),
  dispose: vi.fn(),
  flush: vi.fn(),
  config: vi.fn(),
  editable: vi.fn(),
  service: { setCurrentUser: vi.fn(), dispose: vi.fn(), updatePermissionPoint: vi.fn() },
}));
// Exercise factory policy without opening a browser collaboration runtime.
vi.mock("@univerjs/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@univerjs/core")>(),
  Univer: class {
    registerPlugin() {}
    __getInjector() { return { add() {}, get: () => writes.service }; }
    dispose() {}
  },
}));
vi.mock("@univerjs/core/facade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@univerjs/core/facade")>();
  return {
    ...actual,
    FUniver: class {
      static extend = actual.FUniver.extend.bind(actual.FUniver);
      static newAPI() { return { getWorkbook: () => ({ setEditable: writes.editable }) }; }
    },
  };
});
vi.mock("@univerjs-pro/collaboration-client-ui", () => ({
  BrowserCollaborationSocketService: class {},
}));
vi.mock("@univerjs-labs/binding-engine", () => ({
  BindingEngine: class {
    constructor(private readonly options: BindingEngineOptions) {
      writes.config(options.collaborationClientConfig);
    }
    load() {
      this.options.createUniver?.(this.options.collaborationClientConfig);
      return writes.load();
    }
    dispose() {
      writes.dispose();
    }
    flush() { return writes.flush(); }
    getCollaborationStatus() { return CollaborationStatus.SYNCED; }
    subscribeCollaborationStatus(listener: (status: CollaborationStatus) => void) {
      listener(CollaborationStatus.SYNCED);
      return { dispose() {} };
    }
    setCellValue(...args: unknown[]) {
      return writes.cell(...args);
    }
    insertRowsWithValues(...args: unknown[]) {
      return writes.rows(...args);
    }
  },
}));
import { createWorkspaceHtmlEngine, WorkspaceBindingEngine, type WorkspaceHtmlEngineOptions } from "../src/engine.js";

const options = {
  unitId: "unit",
  collaborationClientConfig: {},
} as BindingEngineOptions;
const translateError = (code: string) => `translated:${code}`;
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
    const engine = new WorkspaceBindingEngine(options, canEdit, true, translateError);
    expect(() => engine.setCellValue(cell, "Alice")).toThrow("translated:signInRequired");
    expect(() => engine.insertRowsWithValues(rows)).toThrow("translated:signInRequired");
    expect(writes.cell).not.toHaveBeenCalled();
    expect(writes.rows).not.toHaveBeenCalled();
  });

  it("rejects scalar writes and row insertion for a read-only source before SDK mutation", () => {
    const engine = new WorkspaceBindingEngine(options, false, false, translateError);
    expect(() => engine.setCellValue(cell, "Alice")).toThrow("translated:editPermissionRequired");
    expect(() => engine.insertRowsWithValues(rows)).toThrow("translated:editPermissionRequired");
    expect(writes.cell).not.toHaveBeenCalled();
    expect(writes.rows).not.toHaveBeenCalled();
  });

  it("uses the current language on every write without recreating the engine", () => {
    let language = "en";
    const engine = new WorkspaceBindingEngine(
      options,
      false,
      false,
      (code) => `${language}:${code}`,
    );
    expect(() => engine.setCellValue(cell, "Alice")).toThrow("en:editPermissionRequired");
    language = "zh";
    expect(() => engine.insertRowsWithValues(rows)).toThrow("zh:editPermissionRequired");
    try {
      engine.setCellValue(cell, "Alice");
    } catch (error) {
      expect(error).toMatchObject({ name: "HtmlViewWriteError", code: "editPermissionRequired" });
    }
  });

  it("passes permitted scalar writes and row insertion to the SDK", () => {
    const engine = new WorkspaceBindingEngine(options, true, false, translateError);
    engine.setCellValue(cell, "Alice");
    engine.insertRowsWithValues(rows);
    expect(writes.cell).toHaveBeenCalledExactlyOnceWith(cell, "Alice");
    expect(writes.rows).toHaveBeenCalledExactlyOnceWith(rows);
  });

  it("preserves an SDK insertion rejection", () => {
    const engine = new WorkspaceBindingEngine(options, true, false, translateError);
    writes.rows.mockImplementationOnce(() => {
      throw new Error("Insertion rejected");
    });
    expect(() => engine.insertRowsWithValues(rows)).toThrow("Insertion rejected");
  });

  it.each([[false, true], [true, true], [false, false]])(
    "detaches once before trial writes (canEdit=%s, anonymous=%s) and never flushes to the server",
    async (canEdit, anonymous) => {
      const detach = vi.fn();
      const engine = new WorkspaceBindingEngine(options, canEdit, anonymous, translateError, detach);
      engine.setCellValue(cell, "Alice");
      engine.insertRowsWithValues(rows);
      await engine.flush();
      expect(detach).toHaveBeenCalledTimes(1);
      expect(detach.mock.invocationCallOrder[0]).toBeLessThan(writes.cell.mock.invocationCallOrder[0]!);
      expect(writes.cell).toHaveBeenCalledWith(cell, "Alice");
      expect(writes.rows).toHaveBeenCalledWith(rows);
      expect(writes.flush).not.toHaveBeenCalled();
    },
  );

  it("fails closed when detaching fails", () => {
    const engine = new WorkspaceBindingEngine(options, false, true, translateError, () => {
      throw new Error("detach failed");
    });
    expect(() => engine.setCellValue(cell, "Alice")).toThrow("detach failed");
    expect(writes.cell).not.toHaveBeenCalled();
  });

  it("reports the transition to local state to existing and new subscribers", () => {
    const engine = new WorkspaceBindingEngine(options, false, true, translateError, vi.fn());
    const listener = vi.fn();
    const subscription = engine.subscribeCollaborationStatus(listener);
    expect(listener).toHaveBeenLastCalledWith(CollaborationStatus.SYNCED);
    engine.setCellValue(cell, "Alice");
    expect(listener).toHaveBeenLastCalledWith(CollaborationStatus.NOT_COLLAB);
    expect(engine.getCollaborationStatus()).toBe(CollaborationStatus.NOT_COLLAB);
    const later = vi.fn();
    engine.subscribeCollaborationStatus(later);
    expect(later).toHaveBeenLastCalledWith(CollaborationStatus.NOT_COLLAB);
    subscription.dispose();
  });

  it("keeps owner writes and flush on collaboration", async () => {
    const detach = vi.fn();
    const engine = new WorkspaceBindingEngine(options, true, false, translateError, detach);
    engine.setCellValue(cell, "Alice");
    await engine.flush();
    expect(detach).not.toHaveBeenCalled();
    expect(writes.cell).toHaveBeenCalledWith(cell, "Alice");
    expect(writes.flush).toHaveBeenCalledTimes(1);
  });
});

describe("HTML source runtime ownership", () => {
  const config = {
    unitId: "unit",
    canEdit: true,
    translateError,
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

describe("HTML host trial opt-in", () => {
  const config: WorkspaceHtmlEngineOptions = {
    unitId: "unit",
    canEdit: false,
    translateError,
    user: { id: "user", displayName: "User" },
    license: "",
    collaborationClientConfig: { snapshotServerUrl: "/snapshot" },
    registerEmbed: vi.fn(),
  };

  it.each([undefined, false])("rejects anonymous and non-member writes when trial is %s", async (enableReadOnlyTrial) => {
    for (const anonymous of [true, false]) {
      const onTrialStarted = vi.fn();
      const engine = await createWorkspaceHtmlEngine({
        ...config,
        ...(enableReadOnlyTrial === undefined ? {} : { enableReadOnlyTrial }),
        user: { ...config.user, anonymous },
        onTrialStarted,
      }, new AbortController().signal);
      const code = anonymous ? "signInRequired" : "editPermissionRequired";
      expect(engine.writeMode).toBe("rejected");
      expect(() => engine.setCellValue(cell, "Alice")).toThrow(`translated:${code}`);
      expect(() => engine.insertRowsWithValues(rows)).toThrow(`translated:${code}`);
      expect(onTrialStarted).not.toHaveBeenCalled();
      engine.dispose();
    }
    expect(writes.cell).not.toHaveBeenCalled();
    expect(writes.rows).not.toHaveBeenCalled();
    expect(writes.service.dispose).not.toHaveBeenCalled();
  });

  it.each([true, false])("enables local trial only for an opted-in reader (anonymous=%s)", async (anonymous) => {
    const onTrialStarted = vi.fn();
    const engine = await createWorkspaceHtmlEngine({
      ...config,
      enableReadOnlyTrial: true,
      user: { ...config.user, anonymous },
      onTrialStarted,
    }, new AbortController().signal);
    expect(engine.writeMode).toBe("trial");
    expect(writes.editable).toHaveBeenLastCalledWith(false);
    engine.setCellValue(cell, "Alice");
    engine.insertRowsWithValues(rows);
    await engine.flush();
    expect(onTrialStarted).toHaveBeenCalledTimes(1);
    expect(writes.service.dispose).toHaveBeenCalledTimes(2);
    expect(writes.editable).toHaveBeenLastCalledWith(true);
    expect(writes.cell).toHaveBeenCalledWith(cell, "Alice");
    expect(writes.rows).toHaveBeenCalledWith(rows);
    expect(writes.flush).not.toHaveBeenCalled();
    engine.dispose();
  });

  it.each([undefined, false, true])("preserves caller config except for opted-in readers (offline=%s)", async (enableOfflineEditing) => {
    for (const canEdit of [true, false]) {
      for (const enableReadOnlyTrial of [false, true]) {
        const collaborationClientConfig = {
          ...config.collaborationClientConfig,
          enableAuthServer: false,
          enableSingleActiveInstanceLock: true,
          sendChangesetTimeout: 987,
          ...(enableOfflineEditing === undefined ? {} : { enableOfflineEditing }),
        };
        const original = { ...collaborationClientConfig };
        const onTrialStarted = vi.fn();
        const engine = await createWorkspaceHtmlEngine({
          ...config, canEdit, enableReadOnlyTrial, collaborationClientConfig, onTrialStarted,
        }, new AbortController().signal);
        const trial = !canEdit && enableReadOnlyTrial;
        expect(engine.writeMode).toBe(canEdit ? "saved" : trial ? "trial" : "rejected");
        expect(writes.config).toHaveBeenLastCalledWith({
          socketService: expect.any(Function),
          ...original,
          ...(trial ? { enableOfflineEditing: false } : {}),
        });
        expect(collaborationClientConfig).toEqual(original);
        if (canEdit) {
          engine.setCellValue(cell, "Alice");
          await engine.flush();
          expect(onTrialStarted).not.toHaveBeenCalled();
          expect(writes.flush).toHaveBeenCalled();
        }
        engine.dispose();
      }
    }
  });
});
