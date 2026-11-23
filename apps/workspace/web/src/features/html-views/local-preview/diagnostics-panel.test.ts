// @vitest-environment jsdom
import { parseHtmlView } from "@univerjs-labs/html-view";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";
import { sampleBindings, type BindingProbe } from "./bindings";
import type { BoundUnits } from "./bound-units";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { buildReport } from "./report";

const { bindings } = parseHtmlView(`<html><body>
  <p data-univer-cell-text="unit-a:sheet-1:B9"></p>
  <table data-univer-range-subscribe="unit-a:sheet-1:A1:F6"></table>
  <p data-univer-cell-subscribe="unit-a:sheet-1:B12"></p>
  <p data-univer-cell-text="unit-b:sheet-9:C3"></p>
</body></html>`);
const values: Record<string, unknown> = { "8,1": 1698, "11,1": 0.3407821229050279, "2,2": "Total" };
const probe: BindingProbe = {
  cell: ({ row, col }) => ({ value: values[`${row},${col}`], below: row === 2 ? 5 : null, formula: false, dateFormat: false }),
  range: () => [["Region", "Q1", "Q2", "Q3", "Q4", "Total"], ["East", 120, 135, 150, 160, 565]],
  sheetName: ({ sheetId }) => sheetId === "sheet-1" ? "Summary" : undefined,
};
const units: BoundUnits = new Map([
  ["unit-a", { unitId: "unit-a", name: "Quarterly sales", canEdit: true, status: "ready" }],
  ["unit-b", { unitId: "unit-b", status: "denied" }],
]);
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const render = (samples: ReturnType<typeof sampleBindings>, status: "passed" | "failed" = "passed") => act(async () => root.render(createElement(LanguageProvider, null,
  createElement(DiagnosticsPanel, { units, result: { samples, delivery: "sent", report: buildReport({
    token: "t0123", sha256: "5d80e2e1cc10".padEnd(64, "0"), writeMode: "trial", bindings: samples, leftoverPlaceholders: [], viewport: { width: 1448, height: 953 },
    renderCheck: { status, issues: [], durationMs: 1800, ...(status === "failed" ? { reason: "Render check exceeded 20 seconds." } : {}) },
  }) } }))));

it("names each Sheet and worksheet, lists bindings by address in reading order, and shows no Unit or Sheet IDs", async () => {
  await render(sampleBindings(bindings, probe));
  const text = container.textContent ?? "";
  for (const expected of ["Quarterly sales", "› Summary", "Inaccessible Sheet", "1,698", "0.3408", "Region · Q1 · Q2 · Q3 · Q4 · Total", "+5 rows", "1448 × 953", "5d80e2e1cc10"])
    expect(text).toContain(expected);
  for (const id of ["unit-a", "unit-b", "sheet-1", "sheet-9"]) expect(text).not.toContain(id);
  const addresses = [...container.querySelectorAll("tbody tr td:first-child")].map((cell) => cell.textContent);
  expect(addresses).toEqual(["A1:F6", "B9", "B12", "C3"]);
  expect(container.querySelector("tr[title]")?.getAttribute("title")).toBe("data-univer-range-subscribe unit-a:sheet-1:A1:F6");
});

it("counts binding warnings as problems even when the render check passed, and shows a failed check's reason", async () => {
  await render(sampleBindings(bindings, probe));
  const status = container.querySelector('[data-testid="preview-status"]')!;
  expect(status.getAttribute("data-status")).toBe("passed");
  expect(status.textContent).toContain("1 problem found");
  expect(container.textContent).toContain("Read header text");
  expect(container.textContent).toContain("3 / 4 OK");

  await render(sampleBindings(bindings.slice(0, 3), probe));
  expect(container.querySelector('[data-testid="preview-status"]')!.textContent).toContain("Check passed");

  await render([], "failed");
  expect(container.querySelector('[data-testid="preview-status"]')!.textContent).toContain("Render check exceeded 20 seconds.");
});
