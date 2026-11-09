import { ExchangeFormat } from "@univerjs-pro/exchange-client";
import { MessageType } from "@univerjs/design";
import { ErrorCode } from "@univerjs/protocol";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceExchangeDefinition,
  WorkspaceUnitExchange,
} from "../../web/src/features/editor/features/import-export/definitions.js";
import {
  networkErrorKey,
  UploadNotificationState,
  WorkspaceImportExportService,
  type ImportExportServiceDependencies,
} from "../../web/src/features/editor/features/import-export/import-export-service.js";

const sheetDefinition = {
  unitType: "sheet",
  importExtensions: ["xls", "xlsx", "csv", "tsv"],
  exportFormats: [ExchangeFormat.XLSX, ExchangeFormat.CSV, ExchangeFormat.TSV],
} as unknown as WorkspaceExchangeDefinition;

function setup(overrides: Partial<ImportExportServiceDependencies> = {}, exchange: Partial<WorkspaceUnitExchange> = {}) {
  const requestState$ = new Subject<{ error?: { code: ErrorCode; message: string } }>();
  const messages: { type: MessageType; content: string }[] = [];
  const dependencies: ImportExportServiceDependencies = {
    definition: sheetDefinition,
    exchange: {
      currentUnit: () => ({ unitId: "unit-1", name: "Budget" }),
      importToUnit: vi.fn(async () => "imported-unit"),
      exportByUnitId: vi.fn(async () => new File(["x"], "export.xlsx")),
      ...exchange,
    },
    requestState$,
    downloadFile: vi.fn(),
    interruptImportTask: vi.fn(),
    showMessage: (message) => messages.push(message),
    translate: (key, ...args) => [key, ...args].join(":"),
    pickFile: vi.fn(async () => new File(["data"], "Report.XLSX")),
    resolveUnitLink: vi.fn(async (unitId: string) => `https://workspace.test/nodes/node-of-${unitId}`),
    resolveUnitName: vi.fn(async () => "季度预算"),
    ...overrides,
  };
  const service = new WorkspaceImportExportService(dependencies);
  const latest = <T,>(source: { subscribe(next: (value: T) => void): { unsubscribe(): void } }) => {
    let value!: T;
    source.subscribe((next) => (value = next)).unsubscribe();
    return value;
  };
  return { service, dependencies, messages, requestState$, latest };
}

describe("Workspace import/export service", () => {
  it("imports through the server and links the new Workspace node", async () => {
    const { service, dependencies, latest } = setup();

    await expect(service.importFile()).resolves.toBe("imported-unit");

    expect(dependencies.pickFile).toHaveBeenCalledWith(".xls,.xlsx,.csv,.tsv");
    expect(dependencies.exchange.importToUnit).toHaveBeenCalledWith(expect.any(File));
    expect(dependencies.resolveUnitLink).toHaveBeenCalledWith("imported-unit");
    expect(latest(service.visible$)).toBe(true);
    expect(latest(service.state$)).toBe(UploadNotificationState.SUCCESS);
    expect(latest(service.links$)).toEqual([
      { name: "Report.XLSX", type: "sheet", link: "https://workspace.test/nodes/node-of-imported-unit" },
    ]);
    expect(latest(service.progress$)).toEqual({ done: 4, count: 4 });
  });

  it("keeps the imported file listed when its node cannot be resolved", async () => {
    const { service, latest } = setup({ resolveUnitLink: async () => { throw new Error("offline"); } });

    await service.importFile();

    expect(latest(service.links$)).toEqual([{ name: "Report.XLSX", type: "sheet" }]);
    expect(latest(service.state$)).toBe(UploadNotificationState.SUCCESS);
  });

  it("rejects unsupported files before uploading", async () => {
    const pickFile = vi.fn(async () => new File([""], "notes.docx"));
    const { service, dependencies, messages } = setup({ pickFile });

    await expect(service.importFile()).resolves.toBeUndefined();

    expect(dependencies.exchange.importToUnit).not.toHaveBeenCalled();
    expect(messages).toEqual([
      { type: MessageType.Error, content: "workspace-import-export.fileTypeError:notes.docx" },
    ]);
    // A rejected file does not arm "Upload again".
    await service.retryImport();
    expect(pickFile).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the file picker is dismissed", async () => {
    const { service, dependencies, latest } = setup({ pickFile: async () => undefined });

    await expect(service.importFile()).resolves.toBeUndefined();

    expect(dependencies.exchange.importToUnit).not.toHaveBeenCalled();
    expect(latest(service.visible$)).toBe(false);
  });

  it("shows the failure state and retries the import", async () => {
    const importToUnit = vi.fn()
      .mockRejectedValueOnce(new Error("task failed"))
      .mockResolvedValueOnce("second-unit");
    const { service, latest } = setup({}, { importToUnit });

    await expect(service.importFile()).resolves.toBeUndefined();
    expect(latest(service.state$)).toBe(UploadNotificationState.ERROR);
    expect(latest(service.progress$)).toEqual({ done: 0, count: 0 });

    await expect(service.retryImport()).resolves.toBe("second-unit");
    expect(latest(service.state$)).toBe(UploadNotificationState.SUCCESS);
  });

  it("refuses a second import while one is uploading and can interrupt it", async () => {
    let finish!: (unitId: string | undefined) => void;
    const importToUnit = vi.fn(() => new Promise<string | undefined>((resolve) => (finish = resolve)));
    const { service, dependencies, messages, latest } = setup({}, { importToUnit });

    const running = service.importFile();
    await vi.waitFor(() => expect(importToUnit).toHaveBeenCalled());
    await service.importFile();
    expect(messages).toEqual([{ type: MessageType.Warning, content: "workspace-import-export.uploading" }]);

    service.interrupt();
    expect(dependencies.interruptImportTask).toHaveBeenCalledOnce();
    expect(latest(service.state$)).toBe(UploadNotificationState.ERROR);
    finish(undefined);
    await running;
  });

  it("counts successful requests and reports failed ones", () => {
    const { service, messages, requestState$, latest } = setup();
    requestState$.next({ error: { code: ErrorCode.LICENSE_EXPORT_QUOTA_EXCEEDED, message: "" } });
    expect(messages).toEqual([
      { type: MessageType.Error, content: "workspace-import-export.exportQuotaExceeded" },
    ]);
    requestState$.next({ error: { code: ErrorCode.OK, message: "" } });
    // No upload in flight, so a completed request cannot overshoot the total.
    expect(latest(service.progress$)).toEqual({ done: 0, count: 0 });
  });

  it("exports the current Unit and downloads it under the Workspace Node name", async () => {
    const { service, dependencies, messages } = setup();

    await expect(service.exportUnit(ExchangeFormat.CSV, "sheet-2")).resolves.toBe(true);

    expect(dependencies.exchange.exportByUnitId).toHaveBeenCalledWith("unit-1", ExchangeFormat.CSV, "sheet-2");
    expect(dependencies.resolveUnitName).toHaveBeenCalledWith("unit-1");
    expect(dependencies.downloadFile).toHaveBeenCalledWith(expect.any(File), "季度预算", ExchangeFormat.CSV);
    expect(messages.map((message) => message.content)).toEqual([
      "workspace-import-export.downloading",
      "workspace-import-export.downloadSuccess",
    ]);
  });

  it("ignores the SDK's misparsed Content-Disposition filename", async () => {
    // A slide snapshot has no title, and SDK 1.3.1 names the File from the
    // whole header tail after `filename=`.
    const sdkName = `"____.pptx"; filename*=UTF-8''%E5%AD%A3%E5%BA%A6.pptx`;
    const { service, dependencies } = setup(
      { resolveUnitName: async () => { throw new Error("offline"); } },
      {
        currentUnit: () => ({ unitId: "slide-1", name: "" }),
        exportByUnitId: async () => new File(["x"], sdkName),
      }
    );

    await expect(service.exportUnit(ExchangeFormat.PPTX)).resolves.toBe(true);

    expect(dependencies.downloadFile).toHaveBeenCalledWith(expect.any(File), "slide-1", ExchangeFormat.PPTX);
  });

  it("falls back to the Unit name when the Node cannot be resolved", async () => {
    const { service, dependencies } = setup({ resolveUnitName: async () => undefined });

    await service.exportUnit(ExchangeFormat.XLSX);

    expect(dependencies.downloadFile).toHaveBeenCalledWith(expect.any(File), "Budget", ExchangeFormat.XLSX);
  });

  it("does not download when the server returns no file", async () => {
    const { service, dependencies } = setup({}, { exportByUnitId: async () => undefined });

    await expect(service.exportUnit(ExchangeFormat.XLSX)).resolves.toBe(false);

    expect(dependencies.downloadFile).not.toHaveBeenCalled();
  });

  it("maps license and transport errors to messages", () => {
    expect(networkErrorKey({ code: ErrorCode.CONNECTOR_DATA_TOO_LARGE, message: "" })).toBe("tooLarge");
    expect(networkErrorKey({ code: ErrorCode.LICENSE_INVALID, message: "" })).toBe("licensePolicyInvalid");
    expect(networkErrorKey({ code: ErrorCode.INTERNAL_ERROR, message: "" })).toBe("internalError");
    expect(networkErrorKey(undefined)).toBe("networkError");
  });
});

describe("Workspace import/export definitions", () => {
  it("registers the SDK 1.1 operation ids that SDK packages still reference", async () => {
    const { exchangeIds, WORKSPACE_EXCHANGE_DEFINITIONS } = await import(
      "../../web/src/features/editor/features/import-export/definitions.js"
    );
    const ids = Object.fromEntries(
      Object.entries(WORKSPACE_EXCHANGE_DEFINITIONS).map(([type, definition]) => [type, exchangeIds(definition)])
    );
    // @univerjs/docs maps export-doc to its Export permission action;
    // @univerjs-pro/bases dispatches export-base(-by-format); @univerjs-pro/embed-ui
    // hides the four import operations inside embedded child Units.
    expect(ids.doc!.exportUnit).toBe("docs-exchange-client.operation.export-doc");
    expect(ids.base!.exportUnit).toBe("bases-exchange-client.operation.export-base");
    expect(ids.base!.exportByFormat).toBe("bases-exchange-client.operation.export-base-by-format");
    expect([ids.sheet!.importUnit, ids.doc!.importUnit, ids.slide!.importUnit, ids.base!.importUnit]).toEqual([
      "sheets-exchange-client.operation.import-sheet",
      "docs-exchange-client.operation.import-doc",
      "slides-exchange-client.operation.import-slide",
      "bases-exchange-client.operation.import-base",
    ]);
    expect(ids.sheet!.menu).toBe("sheets-exchange-client.operation.exchange");
    expect(ids.sheet!.exportDialog).toBe("sheets-exchange-client.dialog.export-format");

    expect(WORKSPACE_EXCHANGE_DEFINITIONS.doc.exportFormats).toEqual([ExchangeFormat.DOCX]);
    expect(WORKSPACE_EXCHANGE_DEFINITIONS.slide.exportFormats).toEqual([ExchangeFormat.PPTX]);
    expect(WORKSPACE_EXCHANGE_DEFINITIONS.base.placement).toEqual({ kind: "base-toolbar" });
  }, 30_000);
});
