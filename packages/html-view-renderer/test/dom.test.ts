// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { CellState, CellValue } from "@univerjs/binding-engine";
import { mountCellBindings, type CellBindingEngine } from "../src/dom.js";
let mounted: ReturnType<typeof mountCellBindings> | undefined;
afterEach(() => {
  mounted?.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});
const reference = { sheetId: "sheet", row: 0, col: 0 };
function setup(type = "range") {
  document.body.innerHTML = `<output></output><input type="${type}" min="0" max="40" step="1">`;
  let state: CellState = {
    value: type === "checkbox" ? true : 20,
    available: true,
    writable: true,
  };
  let listener = (_state: CellState) => {};
  const update = (value: CellValue | null, writable = true, available = true) => {
    state = { value, writable, available };
    listener(state);
  };
  const engine: CellBindingEngine = {
    getCellState: () => state,
    subscribeCell(_ref, callback) {
      listener = callback;
      callback(state);
      return {
        dispose: () => {
          listener = () => {};
        },
      };
    },
    setCellValue: vi.fn((_ref, value) => {
      update(value);
    }),
  };
  const input = document.querySelector("input")!;
  const output = document.querySelector("output")!;
  mounted = mountCellBindings([
    { kind: "model", element: input, engine, reference },
    { kind: "text", element: output, engine, reference },
  ]);
  const change = (value: string, event = "input") => {
    input.value = value;
    input.dispatchEvent(new Event(event));
  };
  return { engine, input, output, change, update };
}
it("throttles input and writes the latest final value on change", async () => {
  vi.useFakeTimers();
  const { change, engine, output } = setup();
  change("21");
  change("22");
  change("23");
  expect(engine.setCellValue).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(engine.setCellValue).toHaveBeenLastCalledWith(reference, 23);
  change("24");
  change("25", "change");
  expect(engine.setCellValue).toHaveBeenLastCalledWith(reference, 25);
  expect(output.textContent).toBe("25");
});
it("preserves dirty drafts on remote updates and Escape restores the latest value", () => {
  const { change, input, output, update, engine } = setup("number");
  change("21");
  update(12);
  expect(input.value).toBe("21");
  expect(output.textContent).toBe("12");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(input.value).toBe("12");
  expect(engine.setCellValue).not.toHaveBeenCalled();
});
it("keeps invalid numeric drafts and never writes blank as zero", () => {
  const { change, input, engine } = setup("number");
  change("", "change");
  expect(engine.setCellValue).not.toHaveBeenCalled();
  expect(input.value).toBe("");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  change("42", "change");
  expect(engine.setCellValue).not.toHaveBeenCalled();
});
it("reports a rejected write and allows the next user edit without retry UI", () => {
  const { change, engine, input } = setup("number");
  vi.mocked(engine.setCellValue).mockImplementationOnce(() => {
    throw new Error("denied");
  });
  change("21", "change");
  expect(input.value).toBe("21");
  expect(document.querySelector('[role="alert"]')!.textContent).toBe("denied");
  expect(document.querySelector("button")).toBeNull();
  change("22", "change");
  expect(engine.setCellValue).toHaveBeenLastCalledWith(reference, 22);
  expect(input.hasAttribute("aria-invalid")).toBe(false);
});
it("cancels pending writes and subscriptions on disposal without owning the engine", async () => {
  vi.useFakeTimers();
  const { change, engine, output, update } = setup();
  change("21");
  change("22");
  mounted!.dispose();
  mounted = undefined;
  await vi.advanceTimersByTimeAsync(200);
  change("23", "change");
  update(30);
  expect(engine.setCellValue).toHaveBeenCalledTimes(1);
  expect(output.textContent).toBe("21");
});
it("disables controls for permission changes and missing cells", () => {
  const { input, update, change, engine } = setup("number");
  update(20, false);
  change("22", "change");
  expect(input.disabled).toBe(true);
  expect(engine.setCellValue).not.toHaveBeenCalled();
  update(null, false, false);
  expect(document.querySelector('[role="alert"]')!.textContent).toContain("不可用");
});
it("writes checkbox booleans and rejects incompatible cell types", () => {
  const { input, engine, update } = setup("checkbox");
  input.checked = false;
  input.dispatchEvent(new Event("change"));
  expect(engine.setCellValue).toHaveBeenLastCalledWith(reference, false);
  update(1);
  expect(input.disabled).toBe(true);
});
it("releases listeners after partial mount failure", () => {
  const { input, output, engine } = setup("number");
  mounted!.dispose();
  mounted = undefined;
  input.disabled = false;
  const release = vi.fn();
  engine.subscribeCell = vi.fn(() => ({ dispose: release }));
  const broken = {
    ...engine,
    subscribeCell() {
      throw new Error("failed");
    },
  };
  expect(() =>
    mountCellBindings([
      { kind: "model", element: input, engine, reference },
      { kind: "text", element: output, engine: broken, reference },
    ]),
  ).toThrow("failed");
  expect(release).toHaveBeenCalledTimes(1);
  input.dispatchEvent(new Event("change"));
  expect(engine.setCellValue).not.toHaveBeenCalled();
});
it("shares one subscription and throttle across controls for the same cell", async () => {
  vi.useFakeTimers();
  const { input, output, engine } = setup();
  mounted!.dispose();
  input.disabled = false;
  const second = document.createElement("input");
  second.type = "range";
  document.body.append(second);
  const subscribe = vi.spyOn(engine, "subscribeCell");
  mounted = mountCellBindings([
    { kind: "model", element: input, engine, reference },
    { kind: "model", element: second, engine, reference: { ...reference } },
    { kind: "text", element: output, engine, reference },
  ]);
  for (const value of ["21", "22"]) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }
  second.value = "23";
  second.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(100);
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(engine.setCellValue).toHaveBeenLastCalledWith(reference, 23);
  expect(input.value).toBe("23");
  expect(second.value).toBe("23");
});
it("Escape cancels a throttled write", async () => {
  vi.useFakeTimers();
  const { change, input, engine } = setup();
  change("21");
  change("22");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await vi.advanceTimersByTimeAsync(200);
  expect(engine.setCellValue).toHaveBeenCalledTimes(1);
  expect(input.value).toBe("21");
});

it("flushes the last throttled value before disposal without writing it twice", async () => {
  vi.useFakeTimers();
  const { change, engine } = setup();
  change("21");
  change("22");
  expect(engine.getCellState(reference).value).toBe(21);
  expect(mounted!.hasPendingChanges()).toBe(true);
  mounted!.flush();
  expect(engine.getCellState(reference).value).toBe(22);
  expect(mounted!.hasPendingChanges()).toBe(false);
  mounted!.flush();
  mounted!.dispose();
  await vi.advanceTimersByTimeAsync(200);
  expect(engine.setCellValue).toHaveBeenCalledTimes(2);
});

it("keeps a failed pending write dirty until another edit or Escape", async () => {
  vi.useFakeTimers();
  const { change, engine, input } = setup();
  change("21");
  change("22");
  vi.mocked(engine.setCellValue).mockImplementationOnce(() => {
    throw new Error("denied");
  });
  expect(() => mounted!.flush()).toThrow("denied");
  expect(mounted!.hasPendingChanges()).toBe(true);
  expect(input.value).toBe("22");
  await vi.advanceTimersByTimeAsync(200);
  expect(engine.setCellValue).toHaveBeenCalledTimes(2);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(mounted!.hasPendingChanges()).toBe(false);
  expect(input.value).toBe("21");
  expect(() => mounted!.flush()).not.toThrow();
});

it("flushes uncommitted drafts but refuses invalid values", () => {
  const { change, engine, input } = setup("number");
  change("22");
  expect(mounted!.hasPendingChanges()).toBe(true);
  mounted!.flush();
  expect(engine.getCellState(reference).value).toBe(22);
  change("");
  expect(() => mounted!.flush()).toThrow("有效数字");
  expect(mounted!.hasPendingChanges()).toBe(true);
  expect(input.value).toBe("");
  change("23");
  mounted!.flush();
  expect(engine.getCellState(reference).value).toBe(23);
  expect(mounted!.hasPendingChanges()).toBe(false);
});
