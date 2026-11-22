// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreviewPage } from "./use-preview-page";

const search = { src: "http://127.0.0.1:41234/page", token: "t0123456789abcdef0123456789abcdef", file: "page.univer.html" };
let latest: ReturnType<typeof usePreviewPage>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const fetchMock = vi.fn();

function Probe() { latest = usePreviewPage(search); return null; }
const settle = (ms = 80) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const mount = async () => { await act(async () => root.render(createElement(Probe))); await settle(); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("does not touch the loopback host until a click starts it, then loads the page with the token", async () => {
  fetchMock.mockResolvedValue(new Response("<p>one</p>"));
  await mount();
  expect(latest.state).toEqual({ status: "idle" });
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => latest.start());
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toBe(`${search.src}?token=${search.token}`);
  expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "omit", redirect: "error" });
  expect(latest.state).toMatchObject({ status: "ready", page: { html: "<p>one</p>", name: "page.univer.html" } });
  expect(localStorage.getItem("html-view-preview-loopback-granted")).toBe("1");
});

it("starts without a click only after an earlier load proved the browser grant", async () => {
  localStorage.setItem("html-view-preview-loopback-granted", "1");
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await mount();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(latest.state).toMatchObject({ status: "error", kind: "blocked" });
  expect(localStorage.getItem("html-view-preview-loopback-granted")).toBeNull();
});

it("tells a refusal from a blocked or absent host", async () => {
  fetchMock.mockResolvedValue(new Response("no", { status: 403 }));
  await mount();
  await act(async () => latest.start());
  await settle();
  expect(latest.state).toMatchObject({ status: "error", kind: "refused", httpStatus: 403 });
});

it.each(["NotReadableError", "NotFoundError"])("treats a picked File that throws %s as changed on disk", async (name) => {
  await mount();
  const file = new File(["<p>x</p>"], "a.html");
  await act(async () => latest.pickInput(file));
  await settle();
  expect(latest.state).toMatchObject({ status: "ready" });
  expect(latest.stale).toBe(false);
  vi.spyOn(Blob.prototype, "slice").mockReturnValue({ arrayBuffer: () => Promise.reject(new DOMException("changed", name)) } as Blob);
  await settle(650);
  expect(latest.stale).toBe(true);
});
