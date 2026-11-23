// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";

const controls = vi.hoisted(() => ({ mounted: vi.fn(), start: vi.fn(), html: "", idle: false }));
vi.mock("../html-view", () => ({ HtmlView: ({ draft, source }: { draft: boolean; source: string }) => {
  useEffect(() => { controls.mounted({ draft, source }); }, []);
  return createElement("iframe", { title: "page" });
} }));
vi.mock("../use-html-view-sources", () => ({ useHtmlViewSources: () => ({ sourceIds: ["unit-a"], sources: [{ data: { node: { name: "Sales 2025" }, resource: { capabilities: { editContent: true } } } }] }) }));
vi.mock("./use-preview-page", () => ({ usePreviewPage: () => ({
  state: controls.idle ? { status: "idle" } : { status: "ready", page: { html: controls.html, sha256: "a".repeat(64), name: "page.univer.html", generation: 1 } },
  isFile: false, watching: false, stale: false, start: controls.start, choose: async () => true, pickInput: vi.fn(), drop: vi.fn(),
}) }));
vi.mock("./report", async (original) => ({ ...await original<typeof import("./report")>(), postReport: vi.fn(async () => true) }));

const { LocalPreview } = await import("./local-preview");
const search = { src: "http://127.0.0.1:41234/page", token: "t0123456789abcdef0123456789abcdef", file: "page.univer.html" };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  controls.mounted.mockClear();
  controls.start.mockClear();
  controls.idle = false;
  controls.html = '<html><body><p data-univer-cell-text="unit-a:sheet-1:B2"></p><p data-univer-cell-text="unit-a:sheet-1:B3"></p></body></html>';
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const render = () => act(async () => root.render(createElement(LanguageProvider, null, createElement(LocalPreview, { search, worktree: undefined }))));
const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text);

it("shows the file, source, Sheets and worksheets first, and connects nothing until the user confirms", async () => {
  await render();
  expect(controls.mounted).not.toHaveBeenCalled();
  expect(container.querySelector("iframe")).toBeNull();
  const text = container.textContent ?? "";
  for (const expected of ["page.univer.html", "http://127.0.0.1:41234", "Sales 2025", "unit-a", "sheet-1", "2 bindings", "as you"]) expect(text).toContain(expected);
  await act(async () => button("Trust and preview")!.click());
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  expect(controls.mounted.mock.calls[0]![0].draft).toBe(true);
  expect(container.querySelector("[data-write-mode]")?.getAttribute("data-write-mode")).toBe("trial");
});

it("remembers the confirmation for the same source and token, but asks again when the page names another Sheet", async () => {
  await render();
  await act(async () => button("Trust and preview")!.click());
  await act(async () => root.unmount());
  root = createRoot(container);
  controls.mounted.mockClear();
  await render();
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  controls.mounted.mockClear();
  controls.html += '<p data-univer-cell-text="unit-b:sheet-1:A1"></p>';
  await render();
  expect(controls.mounted).not.toHaveBeenCalled();
  expect(button("Trust and preview")).toBeTruthy();
});

it("asks for a click before the first load, so the browser can prompt for local network access", async () => {
  controls.idle = true;
  await render();
  expect(container.textContent).toContain("Load the page from your computer");
  expect(container.textContent).toContain("http://127.0.0.1:41234");
  expect(controls.start).not.toHaveBeenCalled();
  await act(async () => button("Load page")!.click());
  expect(controls.start).toHaveBeenCalledTimes(1);
  expect(controls.mounted).not.toHaveBeenCalled();
});

it("keeps a fixed preset at its width and starts a new check when the viewport changes", async () => {
  await render();
  await act(async () => button("Trust and preview")!.click());
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  await act(async () => button("1440")!.click());
  const frame = container.querySelector("iframe")!.parentElement!;
  expect(frame.style.width).toBe("1440px");
  expect(frame.style.maxWidth).toBe("");
  expect(controls.mounted).toHaveBeenCalledTimes(2);
  await act(async () => button("360")!.click());
  expect(container.querySelector("iframe")!.parentElement!.style.width).toBe("360px");
  expect(controls.mounted).toHaveBeenCalledTimes(3);
});
