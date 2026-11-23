// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";

const controls = vi.hoisted(() => ({ mounted: vi.fn(), start: vi.fn(), html: "", idle: false, sources: {} as Record<string, object> }));
vi.mock("../html-view", () => ({ HtmlView: ({ draft, source }: { draft: boolean; source: string }) => {
  useEffect(() => { controls.mounted({ draft, source }); }, []);
  return createElement("iframe", { title: "page" });
} }));
vi.mock("../use-html-view-sources", async () => {
  const { getHtmlViewUnitIds, parseHtmlView } = await import("@univerjs-labs/html-view");
  return { useHtmlViewSources: (html: string | undefined) => {
    const sourceIds = html === undefined ? null : getHtmlViewUnitIds(parseHtmlView(html));
    return { sourceIds, sources: (sourceIds ?? []).map((unitId) => controls.sources[unitId] ?? { isError: true }) };
  } };
});
vi.mock("./use-preview-page", () => ({ usePreviewPage: () => ({
  state: controls.idle ? { status: "idle" } : { status: "ready", page: { html: controls.html, sha256: "a".repeat(64), name: "page.univer.html", generation: 1 } },
  isFile: false, watching: false, stale: false, start: controls.start, choose: async () => true, pickInput: vi.fn(), drop: vi.fn(),
}) }));
vi.mock("./report", async (original) => ({ ...await original<typeof import("./report")>(), postReport: vi.fn(async () => true) }));

const { LocalPreview } = await import("./local-preview");
const search = { src: "http://127.0.0.1:41234/page", token: "t0123456789abcdef0123456789abcdef", file: "page.univer.html" };
const resource = (name: string, editContent: boolean) => ({ data: { node: { name }, resource: { capabilities: { editContent } } } });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  localStorage.clear();
  controls.mounted.mockClear();
  controls.start.mockClear();
  controls.idle = false;
  controls.sources = { "unit-a": resource("Sales 2025", true), "unit-b": resource("Payroll 2026", false) };
  controls.html = '<html><body><p data-univer-cell-text="unit-a:sheet-1:B3"></p><p data-univer-cell-text="unit-a:sheet-1:B2"></p></body></html>';
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

type Props = { token?: string; userId?: string | undefined };
const render = ({ token = search.token, userId = "user-1" }: Props = {}) => act(async () => root.render(createElement(LanguageProvider, null,
  createElement(LocalPreview, { search: { ...search, token }, worktree: undefined, userId }))));
const reopen = async (props?: Props) => {
  await act(async () => root.unmount());
  root = createRoot(container);
  controls.mounted.mockClear();
  await render(props);
};
const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text);
const click = (element: Element | undefined) => act(async () => (element as HTMLElement).click());
const asking = () => button("Always trust these Sheets") !== undefined;

it("names the page and its Sheets without IDs, and connects nothing until the user chooses", async () => {
  await render();
  expect(controls.mounted).not.toHaveBeenCalled();
  expect(container.querySelector("iframe")).toBeNull();
  const text = container.textContent ?? "";
  for (const expected of ["page.univer.html", "127.0.0.1:41234", "Run this page with your access?", "as you", "Will read 1 Sheet", "Sales 2025", "You can edit", "1 worksheet · 2 bindings"])
    expect(text).toContain(expected);
  for (const id of ["unit-a", "sheet-1"]) expect(text).not.toContain(id);
  expect([...container.querySelectorAll("li code")].map((chip) => chip.textContent)).toEqual(["B2", "B3"]);
  await click(button("Only this time"));
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  expect(controls.mounted.mock.calls[0]![0].draft).toBe(true);
  expect(container.querySelector("[data-write-mode]")?.getAttribute("data-write-mode")).toBe("trial");
});

it("keeps only-this-time trust for the same run, and asks again for a new token", async () => {
  await render();
  await click(button("Only this time"));
  await reopen();
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  await reopen({ token: "t-next-run-0123456789abcdef" });
  expect(controls.mounted).not.toHaveBeenCalled();
  expect(asking()).toBe(true);
});

it("keeps always trust across runs for the same user, but not for another user", async () => {
  await render();
  await click(button("Always trust these Sheets"));
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  await reopen({ token: "t-next-run-0123456789abcdef" });
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  await reopen({ token: "t-next-run-0123456789abcdef", userId: "user-2" });
  expect(controls.mounted).not.toHaveBeenCalled();
  expect(asking()).toBe(true);
});

it("asks only about a Sheet not yet trusted and names the one already trusted", async () => {
  await render();
  await click(button("Always trust these Sheets"));
  controls.html += '<p data-univer-range-subscribe="unit-b:sheet-7:A1:C9"></p>';
  await reopen({ token: "t-next-run-0123456789abcdef" });
  expect(controls.mounted).not.toHaveBeenCalled();
  const text = container.textContent ?? "";
  for (const expected of ["1 more Sheet needs your confirmation", "Payroll 2026", "View only", "A1:C9", "Already trusted Sales 2025"]) expect(text).toContain(expected);
  expect(container.querySelectorAll("li")).toHaveLength(1);
  await click(button("Only this time"));
  expect(controls.mounted).toHaveBeenCalledTimes(1);
});

it("shows a Sheet the user cannot read as inaccessible, with its ID as the only identifier", async () => {
  controls.html += '<p data-univer-cell-text="unit-gone:sheet-1:A1"></p>';
  await render();
  const card = [...container.querySelectorAll("li")].find((item) => item.textContent?.includes("Inaccessible Sheet"))!;
  expect(card.textContent).toContain("No access or missing");
  expect(card.querySelector("code")?.textContent).toBe("unit-gone");
});

it("brings the trust step back after the user stops trusting a Sheet from the header", async () => {
  await render();
  await click(button("Always trust these Sheets"));
  controls.html += '<p data-univer-cell-text="unit-b:sheet-7:C3"></p>';
  await reopen();
  await click(button("Only this time"));
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  await click(button("Trusted"));
  await click([...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "Stop trusting Sales 2025"));
  expect(asking()).toBe(true);
  expect(container.textContent).toContain("Will read 1 Sheet");
  expect(container.textContent).toContain("Already trusted Payroll 2026");
  await reopen({ token: "t-next-run-0123456789abcdef" });
  expect(asking()).toBe(true);
});

it("asks for a click before the first load, so the browser can prompt for local network access", async () => {
  controls.idle = true;
  await render();
  expect(container.textContent).toContain("Load the page from your computer");
  expect(container.textContent).toContain("Local preview process · 127.0.0.1:41234");
  expect(container.querySelector('[title="Local preview process http://127.0.0.1:41234"]')?.textContent).toBe("This computer :41234");
  expect(controls.start).not.toHaveBeenCalled();
  await click(button("Load page"));
  expect(controls.start).toHaveBeenCalledTimes(1);
  expect(controls.mounted).not.toHaveBeenCalled();
});

it("keeps a fixed preset at its width and starts a new check when the viewport changes", async () => {
  await render();
  await click(button("Only this time"));
  expect(controls.mounted).toHaveBeenCalledTimes(1);
  await click(button("1440"));
  const frame = container.querySelector("iframe")!.parentElement!;
  expect(frame.style.width).toBe("1440px");
  expect(frame.style.maxWidth).toBe("");
  expect(controls.mounted).toHaveBeenCalledTimes(2);
  await click(button("360"));
  expect(container.querySelector("iframe")!.parentElement!.style.width).toBe("360px");
  expect(controls.mounted).toHaveBeenCalledTimes(3);
});
