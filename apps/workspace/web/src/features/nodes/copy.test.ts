import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToPersonalSpace } from "./copy";

const mocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), fetch: vi.fn() }));
vi.mock("../../shared/api/client", () => ({ api: { GET: mocks.GET, POST: mocks.POST } }));

const messages = { failed: "failed", continuing: "continuing", sheetUnreadable: "sheet unreadable" };
const key = "browser-key-0123456789";
const page = `<!doctype html><p data-univer-cell-text="unit-a:sheet1:B2"></p><p data-univer-cell-text="unit-a:sheet1:B3"></p>`;
const pages = { page: { kind: "blob", id: "page" }, "copy-of-page": { kind: "blob", id: "page-copy" } };

function nodes(resources: Record<string, unknown>, unreadable: readonly string[] = []) {
  mocks.GET.mockImplementation(async (path: string, { params }: { params: { path: { nodeId: string; unitId: string } } }) => {
    if (path === "/api/nodes/{nodeId}") return { data: { node: { id: params.path.nodeId, resource: resources[params.path.nodeId] } } };
    if (path === "/api/unit-resources/{unitId}") {
      return unreadable.includes(params.path.unitId)
        ? { error: { error: { code: "NOT_FOUND", message: "The resource was not found." } }, response: new Response(null, { status: 404 }) }
        : { data: { node: { id: `node-of-${params.path.unitId}` } }, response: new Response() };
    }
    throw new Error(path);
  });
}

function contents(html: string, replaceStatus = 200) {
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method === "PUT" ? new Response("{}", { status: replaceStatus }) : new Response(html, { headers: { ETag: `"${url}"` } }));
}

const copied = () => mocks.POST.mock.calls.filter(([path]) => path === "/api/nodes/{nodeId}/copies");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.POST.mockImplementation(async (path: string, { params }: { params: { path: { nodeId: string; resourceId: string } } }) => {
    if (path === "/api/nodes/{nodeId}/copies") return { data: { operation: {}, node: { id: `copy-of-${params.path.nodeId}` } } };
    if (path === "/api/resources/{resourceId}/open") {
      const id = params.path.resourceId;
      return { data: { resource: { id, kind: "blob", originalFilename: "Budget.univer.html", contentUrl: `/content/${id}` } } };
    }
    throw new Error(path);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("copyToPersonalSpace", () => {
  it("copies a Sheet into the Personal Space with the caller's key and nothing more", async () => {
    nodes({ sheet: { kind: "univer", unitId: "unit-a" }, "copy-of-sheet": { kind: "univer", unitId: "unit-b" } });
    await expect(copyToPersonalSpace("sheet", key, messages)).resolves.toBe("copy-of-sheet");
    expect(mocks.POST).toHaveBeenCalledOnce();
    expect(mocks.POST).toHaveBeenCalledWith("/api/nodes/{nodeId}/copies", {
      params: { path: { nodeId: "sheet" }, header: { "Idempotency-Key": key } },
      body: { target: { kind: "personalSpace" } },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("copies a page with the Sheets it binds and binds the page's copy to their copies", async () => {
    nodes({ ...pages, "copy-of-node-of-unit-a": { kind: "univer", unitId: "unit-b" } });
    contents(page);

    await expect(copyToPersonalSpace("page", key, messages)).resolves.toBe("copy-of-page");

    expect(mocks.POST).toHaveBeenCalledWith("/api/nodes/{nodeId}/copies", {
      params: { path: { nodeId: "node-of-unit-a" }, header: { "Idempotency-Key": `${key}-unit-a` } },
      body: { target: { kind: "personalSpace" } },
    });
    expect(copied()).toHaveLength(2);
    const [url, init] = mocks.fetch.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/blob-resources/page-copy/content");
    expect(init).toMatchObject({
      method: "PUT",
      headers: { "If-Match": '"/content/page-copy"', "Idempotency-Key": `${key}-bind` },
      body: page.replaceAll("unit-a", "unit-b"),
    });
  });

  it("creates nothing when the page binds a Sheet the caller cannot open", async () => {
    nodes(pages, ["unit-a"]);
    contents(page);
    await expect(copyToPersonalSpace("page", key, messages)).rejects.toThrow("sheet unreadable");
    expect(copied()).toHaveLength(0);
  });

  it("does not rewrite a page that binds no Sheet", async () => {
    nodes(pages);
    contents("<p>static</p>");
    await expect(copyToPersonalSpace("page", key, messages)).resolves.toBe("copy-of-page");
    expect(copied()).toHaveLength(1);
    expect(mocks.fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toHaveLength(0);
  });

  it("stops when the page's content cannot be replaced", async () => {
    nodes({ ...pages, "copy-of-node-of-unit-a": { kind: "univer", unitId: "unit-b" } });
    contents(page, 412);
    await expect(copyToPersonalSpace("page", key, messages)).rejects.toThrow("failed");
  });
});
