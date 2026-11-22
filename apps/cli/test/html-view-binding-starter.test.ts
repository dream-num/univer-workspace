import { readFile, readdir } from "node:fs/promises";
import { Script } from "node:vm";
import { parseHtmlView } from "@univerjs-labs/html-view";
import { expect, it, vi } from "vitest";

const root = new URL("../skill-data/html-view/", import.meta.url);
const starter = await readFile(new URL("examples/binding-starter.univer.html", root), "utf8");

it("parses the neutral starter and built-in templates with the HTML View binding parser", async () => {
  expect([...starter].length).toBeLessThanOrEqual(3500);
  const parsed = parseHtmlView(starter);
  expect(parsed.bindings.map(({ kind }) => kind)).toEqual(["text", "model", "range", "range"]);
  expect(parsed.bindings[1]?.reference).toEqual({
    unitId: "REPLACE_UNIT_ID", sheetId: "REPLACE_SHEET_ID", row: 1, col: 1,
  });
  for (const file of await readdir(new URL("templates/", root))) {
    if (file.endsWith(".univer.html"))
      expect(parseHtmlView(await readFile(new URL(`templates/${file}`, root), "utf8")).bindings.length, file).toBeGreaterThan(0);
  }
});

interface TestElement {
  textContent: string;
  disabled: boolean;
  valueAsNumber: number;
  children: TestElement[];
  append(child: TestElement): void;
  replaceChildren(...children: TestElement[]): void;
}

function runStarter(mode = "saved", chartFails = false) {
  const element = (): TestElement => ({
    textContent: "", disabled: false, valueAsNumber: 42,
    children: [],
    append(child: TestElement) { this.children.push(child); },
    replaceChildren(...children: TestElement[]) { this.children = children; },
  });
  const elements = Object.fromEntries(["rows", "chart", "chart-state", "error", "save", "write", "input", "edit"].map(id => [id, element()]));
  const callbacks = new Map<string, (state: { value: (string | number | null)[][] }) => void>();
  const setOption = vi.fn();
  const binding = {
    subscribeRangeById: vi.fn(async (id: string, callback: (state: { value: (string | number | null)[][] }) => void) => {
      callbacks.set(id, callback);
      callback({ value: [[null, null], [null, null]] });
      return { dispose() {} };
    }),
    setCellValue: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  };
  const echarts = { init: vi.fn((container: TestElement) => {
    expect(container.children).toEqual([]);
    expect(container.textContent).toBe("");
    if (chartFails) throw new Error("Library unavailable");
    return { setOption, resize() {} };
  }) };
  const source = [...starter.matchAll(/<script>([\s\S]*?)<\/script>/gu)][0]?.[1];
  if (!source) throw new Error("Missing starter script");
  new Script(source).runInNewContext({
    window: { univerBinding: binding, univerWorkspace: { capabilities: ["write-mode"], getWriteMode: async () => mode }, addEventListener() {} },
    document: { getElementById: (id: string) => elements[id], createElement: element }, echarts,
  });
  const form = elements["edit"];
  if (!form || !("onsubmit" in form) || typeof form.onsubmit !== "function") throw new Error("Missing submit handler");
  return { elements, callbacks, binding, setOption, submit: form.onsubmit };
}

it("replaces table rows on every full matrix and keeps chart loading outside its container", () => {
  const page = runStarter();
  expect(page.elements["chart-state"]?.textContent).toBe("No chart values");
  for (const callback of page.callbacks.values()) callback({ value: [["Alpha", 12], ["Beta", 8]] });
  expect(page.elements["rows"]?.children.map(row => row.children.map(cell => cell.textContent))).toEqual([["Alpha", "12"], ["Beta", "8"]]);
  expect(page.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ series: [{ type: "bar", data: [12, 8] }] }));
  page.callbacks.get("rows")?.({ value: [["Gamma", 3]] });
  expect(page.elements["rows"]?.children).toHaveLength(1);
  expect(page.elements["chart-state"]?.textContent).toBe("");
});

it("keeps the table usable and shows chart errors", () => {
  const page = runStarter("saved", true);
  expect(page.elements["rows"]?.children).toHaveLength(2);
  expect(page.elements["chart-state"]?.textContent).toContain("see table");
  expect(page.elements["error"]?.textContent).toContain("Library unavailable");
});

it.each(["saved", "trial"])("waits for flush and labels %s writes honestly", async mode => {
  const page = runStarter(mode);
  let confirm = () => {};
  const confirmation = new Promise<void>(resolve => { confirm = resolve; });
  page.binding.flush.mockImplementationOnce(() => confirmation);
  const event = { preventDefault: vi.fn() };
  const saving = page.submit(event);
  await Promise.resolve();
  expect(event.preventDefault).toHaveBeenCalled();
  expect(page.binding.setCellValue).toHaveBeenCalledWith({ unitId: "REPLACE_UNIT_ID", sheetId: "REPLACE_SHEET_ID", row: 1, col: 1 }, 42);
  expect(page.elements["write"]?.textContent).toBe("Saving");
  expect(page.elements["save"]?.disabled).toBe(true);
  confirm();
  await saving;
  expect(page.elements["write"]?.textContent).toBe(mode === "trial" ? "Trial only, not saved" : "Saved");
  expect(page.elements["save"]?.disabled).toBe(false);
});

it.each(["setCellValue", "flush"] as const)("retains input and reports a rejected %s", async method => {
  const page = runStarter();
  page.binding[method].mockRejectedValueOnce(new Error("Write denied"));
  await page.submit({ preventDefault() {} });
  expect(page.elements["write"]?.textContent).toBe("Not saved; input retained");
  expect(page.elements["input"]?.valueAsNumber).toBe(42);
  expect(page.elements["error"]?.textContent).toContain("Write denied");
  expect(page.elements["save"]?.disabled).toBe(false);
});
