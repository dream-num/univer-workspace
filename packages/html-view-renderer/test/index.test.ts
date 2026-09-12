// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { parseHtmlView } from "@univerjs/workspace-html-view";
import { mountHtmlView, type CellBindingEngine } from "../src/index.js";
let mounted: ReturnType<typeof mountHtmlView> | undefined;
afterEach(() => {
  mounted?.dispose();
  document.body.replaceChildren();
});
function fixture() {
  const template = parseHtmlView(
    '<input type="number" data-univer-cell-model="u:s:A1"><output data-univer-cell-text="u:s:A1"></output><input disabled data-univer-cell-model="v:s:B2">',
  );
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    template.html,
    "text/html",
  ).documentElement.innerHTML;
  const create = (value: number | string) => {
    const state = { value, available: true, writable: true };
    return {
      getCellState: () => state,
      subscribeCell: vi.fn((_ref, fn) => {
        fn(state);
        return { dispose: vi.fn() };
      }),
      setCellValue: vi.fn(),
    } satisfies CellBindingEngine;
  };
  const engines = new Map<string, CellBindingEngine>([
    ["u", create(20)],
    ["v", create("text")],
  ]);
  return { template, engines };
}
it("uses already loaded engines and shares subscriptions for repeated references", () => {
  const { template, engines } = fixture();
  mounted = mountHtmlView({ document, template, engines });
  expect(engines.get("u")!.subscribeCell).toHaveBeenCalledTimes(1);
  expect(document.querySelector("output")!.textContent).toBe("20");
  expect(document.querySelector("input")!.disabled).toBe(false);
  expect(document.querySelectorAll("input")[1]!.disabled).toBe(true);
});
it("restores template disabled state when remounting the same document", () => {
  const { template, engines } = fixture();
  mounted = mountHtmlView({ document, template, engines });
  mounted.dispose();
  expect(document.querySelector("input")!.disabled).toBe(true);
  mounted = mountHtmlView({ document, template, engines });
  expect(document.querySelector("input")!.disabled).toBe(false);
  expect(document.querySelectorAll("input")[1]!.disabled).toBe(true);
});
it("rejects missing engines before binding any controls", () => {
  const { template, engines } = fixture();
  engines.delete("v");
  expect(() => mountHtmlView({ document, template, engines })).toThrow("Engine is missing");
  expect(engines.get("u")!.subscribeCell).not.toHaveBeenCalled();
});

it("exposes local flush before the host waits for collaboration", async () => {
  const { template, engines } = fixture();
  const engine = engines.get("u")!;
  let savedValue: unknown;
  const sync = vi.fn(async () => {
    savedValue = vi.mocked(engine.setCellValue).mock.calls.at(-1)?.[1];
  });
  mounted = mountHtmlView({ document, template, engines });
  const input = document.querySelector("input")!;
  input.value = "22";
  input.dispatchEvent(new Event("input"));
  expect(mounted.hasPendingChanges()).toBe(true);
  mounted.flush();
  await sync();
  mounted.dispose();
  expect(savedValue).toBe(22);
  expect(mounted.hasPendingChanges()).toBe(false);
});
