import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToPersonalSpace } from "./copy";

const mocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), fetch: vi.fn() }));
vi.mock("../../shared/api/client", () => ({ api: { GET: mocks.GET, POST: mocks.POST } }));

const messages = { failed: "failed", continuing: "continuing" };
const key = "browser-key-0123456789";
const page = `<!doctype html><p data-univer-cell-text="unit-a:sheet1:B2"></p><p data-univer-cell-text="unit-a:sheet1:B3"></p>`;

function nodes(resources: Record<string, unknown>) {
  mocks.GET.mockImplementation(async (path: string, { params }: { params: { path: { nodeId: string; unitId: string } } }) => {
    if (path === "/api/nodes/{nodeId}") return { data: { node: { id: params.path.nodeId, resource: resources[params.path.nodeId] } } };
    if (path === "/api/unit-resources/{unitId}") return { data: { node: { id: `node-of-${params.path.unitId}` } } };
    throw new Error(path);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.POST.mockImplementation(async (path: string, { params }: { params: { path: { nodeId: string } } }) => {
    if (path === "/api/nodes/{nodeId}/copies") return { data: { operation: {}, node: { id: `copy-of-${params.path.nodeId}` } } };
    if (path === "/api/resources/{resourceId}/open") {
      return { data: { resource: { id: "page-copy", kind: "blob", originalFilename: "Budget.univer.html", contentUrl: "/content/page-copy" } } };
    }
    throw new Error(path);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("copyToPersonalSpace", () => {
  it("copies a Sheet into the Personal Space with the caller's key and nothing more", async () => {
    nodes({ "copy-of-sheet": { kind: "univer", unitId: "unit-b" } });
    await expect(copyToPersonalSpace("sheet", key, messages)).resolves.toBe("copy-of-sheet");
    expect(mocks.POST).toHaveBeenCalledOnce();
    expect(mocks.POST).toHaveBeenCalledWith("/api/nodes/{nodeId}/copies", {
      params: { path: { nodeId: "sheet" }, header: { "Idempotency-Key": key } },
      body: { target: { kind: "personalSpace" } },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("copies a page with the Sheets it binds and binds the page's copy to their copies", async () => {
    nodes({ "copy-of-page": { kind: "blob", id: "page-copy" }, "copy-of-node-of-unit-a": { kind: "univer", unitId: "unit-b" } });
    mocks.fetch
      .mockResolvedValueOnce(new Response(page, { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(new Response("{}"));

    await expect(copyToPersonalSpace("page", key, messages)).resolves.toBe("copy-of-page");

    expect(mocks.POST).toHaveBeenCalledWith("/api/nodes/{nodeId}/copies", {
      params: { path: { nodeId: "node-of-unit-a" }, header: { "Idempotency-Key": `${key}-unit-a` } },
      body: { target: { kind: "personalSpace" } },
    });
    expect(mocks.POST.mock.calls.filter(([path]) => path === "/api/nodes/{nodeId}/copies")).toHaveLength(2);
    const [url, init] = mocks.fetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/blob-resources/page-copy/content");
    expect(init).toMatchObject({
      method: "PUT",
      headers: { "If-Match": '"v1"', "Idempotency-Key": `${key}-bind` },
      body: page.replaceAll("unit-a", "unit-b"),
    });
  });

  it("does not rewrite a page that binds no Sheet", async () => {
    nodes({ "copy-of-page": { kind: "blob", id: "page-copy" } });
    mocks.fetch.mockResolvedValueOnce(new Response("<p>static</p>", { headers: { ETag: '"v1"' } }));
    await expect(copyToPersonalSpace("page", key, messages)).resolves.toBe("copy-of-page");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("stops when the page's content cannot be replaced", async () => {
    nodes({ "copy-of-page": { kind: "blob", id: "page-copy" }, "copy-of-node-of-unit-a": { kind: "univer", unitId: "unit-b" } });
    mocks.fetch
      .mockResolvedValueOnce(new Response(page, { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(new Response("{}", { status: 412 }));
    await expect(copyToPersonalSpace("page", key, messages)).rejects.toThrow("failed");
  });
});
