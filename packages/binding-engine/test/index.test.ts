import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CellValueType, IPermissionService } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { WorkbookEditablePermission } from "@univerjs/sheets";
import {
  AuthzIoHttpService,
  CollaborationStatus,
  type IUniverCollaborationClientConfig,
} from "@univerjs-pro/collaboration-client";
import { ISocketService } from "@univerjs/network";
import { BindingEngine, createDefaultBindingUniver } from "../src/index.js";

// 数据测试隔离权限 HTTP；不让 SDK 后台请求跨越测试实例的生命周期。
beforeEach(() => {
  vi.spyOn(AuthzIoHttpService.prototype, "allowed").mockResolvedValue([]);
  vi.spyOn(AuthzIoHttpService.prototype, "batchAllowed").mockResolvedValue([]);
  vi.spyOn(AuthzIoHttpService.prototype, "list").mockResolvedValue([]);
});
const engines: BindingEngine[] = [];
afterEach(() => {
  engines.splice(0).forEach((engine) => engine.dispose());
  vi.restoreAllMocks();
});
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const cell = { sheetId: "sheet", row: 0, col: 0 };
// 数据测试不创建远端连接；默认工厂仍注册真实 SDK 协同插件。
class TestSocketService {
  async createSocket() {
    return null;
  }
}
const config: IUniverCollaborationClientConfig = {
  socketService: TestSocketService,
  enableCollaboration: false,
  enableAuthServer: false,
};
function workbookData() {
  return {
    id: "unit",
    name: "Test",
    sheetOrder: ["sheet"],
    sheets: {
      sheet: {
        id: "sheet",
        name: "Sheet",
        rowCount: 20,
        columnCount: 10,
        cellData: { 0: { 0: { v: 20, t: CellValueType.NUMBER } } },
      },
    },
  };
}

function setup(useDefault = false) {
  let api!: FUniver;
  let status = CollaborationStatus.SYNCED;
  const flush = vi.fn(async () => {});
  const load = vi.fn(async (id: string) => {
    api.createWorkbook({ ...workbookData(), id });
    return api.getWorkbook(id);
  });
  vi.spyOn(FUniver.prototype, "getCollaboration").mockImplementation(function (this: FUniver) {
    api = this;
    return {
      loadSheetAsync: load,
      getCollaborationStatus: () => status,
      flush,
    } as unknown as ReturnType<FUniver["getCollaboration"]>;
  });
  const created = useDefault ? undefined : createDefaultBindingUniver(config);
  const univer = created?.univer;
  const factory = vi.fn(() => created!);
  const engine = new BindingEngine({
    unitId: "unit",
    collaborationClientConfig: config,
    ...(useDefault ? {} : { createUniver: factory }),
  });
  engines.push(engine);
  return {
    engine,
    univer,
    factory,
    load,
    flush,
    api: () => api,
    setStatus: (value: CollaborationStatus) => {
      status = value;
    },
  };
}

it("uses the default factory with only collaboration config and loads once", async () => {
  const { engine, load } = setup(true);
  const first = engine.load();
  expect(engine.load()).toBe(first);
  await first;
  expect(load).toHaveBeenCalledTimes(1);
  expect(engine.getCellState(cell)).toMatchObject({ value: 20, available: true });
});
it("passes SDK config to a synchronous factory and rejects access before loading", async () => {
  const { engine, factory } = setup();
  expect(factory).toHaveBeenCalledExactlyOnceWith(config);
  expect(() => engine.getCellState(cell)).toThrow("Load");
  await engine.load();
  expect(engine.getCellState(cell).value).toBe(20);
});
it("preserves scalar types, replaces formulas and emits initial state then changes", async () => {
  const { engine, api } = setup();
  await engine.load();
  const listener = vi.fn();
  engine.subscribeCell(cell, listener);
  expect(listener).toHaveBeenCalledExactlyOnceWith({ value: 20, available: true, writable: true });
  api().getWorkbook("unit")!.getSheetBySheetId("sheet")!.getRange(0, 0).setValue("=1+1");
  for (const value of ["=literal", 21, true, false]) {
    engine.setCellValue(cell, value);
    await tick();
    expect(engine.getCellState(cell).value).toBe(value);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value }));
  }
  expect(
    api().getWorkbook("unit")!.getSheetBySheetId("sheet")!.getRange(0, 0).getCellData()?.f,
  ).toBeFalsy();
  const count = listener.mock.calls.length;
  engine.setCellValue(cell, false);
  await tick();
  expect(listener).toHaveBeenCalledTimes(count);
});
it("observes formula results and coordinates after structural edits", async () => {
  const { engine, api } = setup();
  await engine.load();
  const sheet = api().getWorkbook("unit")!.getSheetBySheetId("sheet")!;
  const result = { ...cell, col: 1 };
  const listener = vi.fn();
  engine.subscribeCell(result, listener);
  sheet.getRange(0, 1).setValue("=A1*2");
  api().getFormula().executeCalculation();
  await vi.waitFor(() => expect(engine.getCellState(result).value).toBe(40));
  engine.setCellValue(cell, 7);
  await vi.waitFor(() =>
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: 14 })),
  );
  sheet.insertRowsBefore(0, 1);
  await tick();
  expect(engine.getCellState(cell).value).toBeNull();
  sheet.deleteRows(0, 1);
  await tick();
  expect(engine.getCellState(cell).value).toBe(7);
});
it("distinguishes blank and missing cells and rejects invalid input and permission changes", async () => {
  const { engine, univer } = setup();
  await engine.load();
  const listener = vi.fn();
  engine.subscribeCell(cell, listener);
  expect(engine.getCellState({ ...cell, row: 3 })).toMatchObject({ value: null, available: true });
  expect(engine.getCellState({ ...cell, sheetId: "missing" })).toEqual({
    value: null,
    available: false,
    writable: false,
  });
  expect(engine.getCellState({ ...cell, row: 20 }).available).toBe(false);
  expect(() => engine.getCellState({ ...cell, row: -1 })).toThrow();
  expect(() => engine.setCellValue(cell, NaN)).toThrow("finite");
  univer!
    .__getInjector()
    .get(IPermissionService)
    .updatePermissionPoint(new WorkbookEditablePermission("unit").id, false);
  await tick();
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ writable: false }));
  expect(() => engine.setCellValue(cell, 7)).toThrow("read-only");
});
it("cancels subscriptions independently and coalesces SDK changes", async () => {
  const { engine } = setup();
  await engine.load();
  const listener = vi.fn();
  const first = engine.subscribeCell(cell, listener);
  const second = engine.subscribeCell(cell, listener);
  first.dispose();
  first.dispose();
  listener.mockClear();
  engine.setCellValue(cell, 1);
  engine.setCellValue(cell, 2);
  await tick();
  expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 2 }));
  second.dispose();
  listener.mockClear();
  engine.setCellValue(cell, 3);
  await tick();
  expect(listener).not.toHaveBeenCalled();
  engine.subscribeCell(cell, listener);
  expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 3 }));
});
it("reports subscriber errors without changing writes or other notifications", async () => {
  const { engine } = setup();
  await engine.load();
  vi.spyOn(console, "error").mockImplementation(() => {});
  engine.subscribeCell(cell, () => {
    throw new Error("consumer");
  });
  const other = vi.fn();
  engine.subscribeCell(cell, other);
  expect(() => engine.setCellValue(cell, 12)).not.toThrow();
  await tick();
  expect(other).toHaveBeenLastCalledWith(expect.objectContaining({ value: 12 }));
});
it("forwards SDK collaboration state and flush failures without retrying", async () => {
  const { engine, api, flush, setStatus } = setup();
  await engine.load();
  const listener = vi.fn();
  const subscription = engine.subscribeCollaborationStatus(listener);
  expect(listener).toHaveBeenCalledExactlyOnceWith(CollaborationStatus.SYNCED);
  setStatus(CollaborationStatus.OFFLINE);
  api().fireEvent(api().Event.CollaborationStatusChanged, {
    unitId: "unit",
    status: CollaborationStatus.OFFLINE,
  });
  expect(listener).toHaveBeenLastCalledWith(CollaborationStatus.OFFLINE);
  expect(engine.getCollaborationStatus()).toBe(CollaborationStatus.OFFLINE);
  await engine.flush();
  expect(flush).toHaveBeenCalledExactlyOnceWith("unit");
  flush.mockRejectedValueOnce(new Error("timeout"));
  await expect(engine.flush()).rejects.toThrow("timeout");
  expect(flush).toHaveBeenCalledTimes(2);
  subscription.dispose();
  engine.dispose();
  expect(flush).toHaveBeenCalledTimes(2);
});
it("releases failed loads and ignores results arriving after disposal", async () => {
  const { engine, load, univer } = setup();
  const dispose = vi.spyOn(univer!, "dispose");
  let finish!: (value: null) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = engine.load();
  engine.dispose();
  engine.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
  finish(null);
  await expect(pending).rejects.toThrow("disposed");
  await expect(engine.load()).rejects.toThrow("disposed");
  expect(dispose).toHaveBeenCalledTimes(1);
});
it("disposes failed loads and propagates the original error", async () => {
  const { engine, load, univer } = setup();
  const dispose = vi.spyOn(univer!, "dispose");
  load.mockRejectedValueOnce(new Error("denied"));
  await expect(engine.load()).rejects.toThrow("denied");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(() => engine.subscribeCell(cell, () => {})).toThrow("disposed");
});

it("default factory provides the SDK socket transport", () => {
  const instance = createDefaultBindingUniver(config);
  try {
    expect(instance.univer.__getInjector().get(ISocketService).createSocket).toBeTypeOf("function");
  } finally {
    instance.univer.dispose();
  }
});

it("does not repeat the initial value when subscribing during a queued change", async () => {
  const { engine } = setup();
  await engine.load();
  const first = vi.fn();
  engine.subscribeCell(cell, first);
  engine.setCellValue(cell, 21);
  const second = vi.fn();
  engine.subscribeCell(cell, second);
  await tick();
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 21 }));
});
