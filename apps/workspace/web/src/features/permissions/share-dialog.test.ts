// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { ShareDialog } from "./share-dialog";

const http = vi.hoisted(() => {
  const NativeRequest = globalThis.Request;
  vi.stubGlobal("Request", class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return { fetch, Request: globalThis.Request };
});
let root: Root;
let container: HTMLDivElement;
let queries: QueryClient;
let metadataFails: boolean;
let linkEnabled: boolean;
let publicPage: boolean;
let publicPrivateSheet: boolean;
let publicCheckFails: boolean;
const requests: Request[] = [];
const html = '<!doctype html><html><body><p data-univer-cell-text="public-unit:Sheet1:A1"></p><p data-univer-cell-text="private-unit:Sheet1:A1"></p></body></html>';

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Request", http.Request);
  vi.stubGlobal("fetch", http.fetch);
  window.localStorage.setItem("univer-workspace-language", "en-US");
  metadataFails = false; linkEnabled = true; publicPage = false; publicPrivateSheet = false; publicCheckFails = false;
  requests.length = 0;
  http.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const path = new URL(request.url).pathname;
    const denied = () => Response.json({ error: { message: "Not found" } }, { status: 404 });
    if (path === "/page-content") return new Response(html);
    if (path.endsWith("/grants")) return Response.json({ grants: [] });
    if (path.endsWith("/link-sharing")) return Response.json({ enabled: linkEnabled, role: "viewer" });
    if (path === "/api/nodes/page") {
      if (request.credentials === "omit" && !publicPage) return denied();
      return Response.json({ node: { id: "page", resource: { id: "page-resource", kind: "blob" } } });
    }
    if (path === "/api/resources/page-resource/open") return Response.json({ resource: { kind: "blob", contentUrl: "/page-content" } });
    if (path.startsWith("/api/unit-resources/")) {
      const unitId = path.split("/").at(-1);
      if (request.credentials === "omit") {
        if (publicCheckFails) return Response.json({ error: { message: "Unavailable" } }, { status: 503 });
        if (unitId === "private-unit" && !publicPrivateSheet) return denied();
      } else if (metadataFails && unitId === "private-unit") return denied();
      return Response.json({ node: { id: `${unitId}-node`, name: unitId === "public-unit" ? "Public Sheet" : "Private Sheet" } });
    }
    throw new Error(`Unexpected request ${request.method} ${path}`);
  });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); queries.clear(); container.remove(); vi.unstubAllGlobals();
});
async function render(page = true) {
  await act(async () => root.render(createElement(LanguageProvider, null,
    createElement(QueryClientProvider, { client: queries }, createElement(ShareDialog, {
      node: page ? { id: "page", name: "Report.univer.html", resource: { kind: "blob" } } : { id: "sheet", name: "Sheet", resource: { kind: "univer" } },
      onClose: vi.fn(),
    })))));
}
async function waitFor(check: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    try { check(); return; } catch (error) { if (attempt === 99) throw error; }
  }
}
function section() { return document.querySelector('section[aria-label="Source Sheets"]'); }

it("keeps an ordinary Sheet's dialog unchanged and does not fetch sources", async () => {
  await render(false);
  await waitFor(() => expect(document.body.textContent).toContain("Link access is on"));
  expect(section()).toBeNull();
  expect(requests.some((request) => request.url.includes("unit-resources") || request.url.endsWith("/page-content"))).toBe(false);
});
it.each(["en-US", "zh-CN"])("marks public and private sources for link visitors and warns in %s", async (language) => {
  window.localStorage.setItem("univer-workspace-language", language);
  await render();
  await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain(language === "en-US" ? "Enable link sharing on the source Sheets too" : "请同时开启来源表格的链接分享"));
  const links = [...document.querySelectorAll("section li a")];
  expect(links.map((link) => link.textContent)).toEqual(["Public Sheet", "Private Sheet"]);
  expect(links[0]?.getAttribute("href")).toBe("/nodes/public-unit-node");
  expect(links[0]?.parentElement?.textContent).toContain(language === "en-US" ? "Readable by link visitors" : "链接访客可读取");
  expect(links[1]?.parentElement?.textContent).toContain(language === "en-US" ? "Not readable by link visitors" : "链接访客不可读取");
  expect(requests.filter((request) => request.url.includes("unit-resources") && request.credentials === "omit")).toHaveLength(2);
});
it("shows the unit ID and a Sheet link when metadata cannot be read", async () => {
  metadataFails = true;
  await render();
  await waitFor(() => expect(section()?.textContent).toContain("You cannot read this source's metadata."));
  const link = [...document.querySelectorAll("section a")].find((item) => item.textContent === "private-unit");
  expect(link?.getAttribute("href")).toBe("/preview/private-unit");
});
it("checks sources for a public page even with link sharing off", async () => {
  linkEnabled = false; publicPage = true;
  await render();
  await waitFor(() => expect(section()?.textContent).toContain("Not readable by link visitors"));
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});
it("recognizes a publicly readable source in a private repository", async () => {
  publicPrivateSheet = true;
  await render();
  await waitFor(() => expect(section()?.textContent?.match(/Readable by link visitors/g)).toHaveLength(2));
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it("reminds individually invited people to obtain source access", async () => {
  linkEnabled = false;
  await render();
  await waitFor(() => expect(section()?.textContent).toContain("Check invited people's read access"));
  expect(section()?.textContent).toContain("Each person invited individually also needs read access");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it("does not call a failed public access check a permission denial", async () => {
  publicCheckFails = true;
  await render();
  await waitFor(() => expect(section()?.textContent).toContain("Unable to check source Sheets"));
  expect(section()?.textContent).not.toContain("Not readable by link visitors");
});
