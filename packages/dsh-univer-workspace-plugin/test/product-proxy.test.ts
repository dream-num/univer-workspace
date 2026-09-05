import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserApiHandler, productProxyTarget } from "../src/webServer/plugin.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("Workspace product proxy allowlist", () => {
  it.each([
    ["POST", "/team-spaces", "/api/team-spaces"],
    ["GET", "/users/search", "/api/users/search"],
    ["GET", "/nodes/node-1", "/api/nodes/node-1"],
    ["GET", "/nodes/node-1/grants", "/api/nodes/node-1/grants"],
    ["PUT", "/nodes/node-1/grants/user-1", "/api/nodes/node-1/grants/user-1"],
    ["DELETE", "/nodes/node-1/grants/user-1", "/api/nodes/node-1/grants/user-1"],
    ["GET", "/nodes/node-1/link-sharing", "/api/nodes/node-1/link-sharing"],
    ["PUT", "/nodes/node-1/link-sharing", "/api/nodes/node-1/link-sharing"],
    ["POST", "/blob-upload-sessions", "/api/blob-upload-sessions"],
    ["PUT", "/blob-upload-sessions/upload-1/content", "/api/blob-upload-sessions/upload-1/content"],
    [
      "POST",
      "/blob-upload-sessions/upload-1/complete",
      "/api/blob-upload-sessions/upload-1/complete",
    ],
    ["DELETE", "/blob-upload-sessions/upload-1", "/api/blob-upload-sessions/upload-1"],
    ["GET", "/resources/resource-1", "/api/resources/resource-1"],
    ["GET", "/resources/resource-1/open", "/api/resources/resource-1/open"],
    ["POST", "/resources/resource-1/open", "/api/resources/resource-1/open"],
    ["GET", "/blob-resources/resource-1/content", "/api/blob-resources/resource-1/content"],
    ["GET", "/blob-resources/resource-1/download", "/api/blob-resources/resource-1/download"],
    ["GET", "/recent-resources", "/api/recent-resources"],
    ["GET", "/owned-by-me", "/api/owned-by-me"],
    ["GET", "/shared-with-me", "/api/shared-with-me"],
  ])("allows %s %s", (method, path, target) => {
    expect(productProxyTarget(method, path)).toBe(target);
  });

  it.each([
    ["GET", "/team-spaces"],
    ["POST", "/users/search"],
    ["PATCH", "/nodes/node-1/grants/user-1"],
    ["POST", "/resources/resource-1"],
    ["GET", "/blob-upload-sessions/upload-1/content"],
    ["PATCH", "/resources/resource-1/open"],
    ["PUT", "/blob-resources/resource-1/content"],
    ["GET", "/blob-resources/resource-1/content/extra"],
    ["POST", "/recent-resources"],
    ["POST", "/owned-by-me"],
    ["POST", "/shared-with-me"],
    ["GET", "/admin/users"],
    ["POST", "/auth/logout"],
  ])("rejects %s %s", (method, path) => {
    expect(productProxyTarget(method, path)).toBeUndefined();
  });

  it("streams Blob ranges without losing conditional or download headers", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/blob-resources/resource-1/download");
      const headers = new Headers(init?.headers);
      expect(headers.get("range")).toBe("bytes=3-9");
      expect(headers.get("if-none-match")).toBe('"blob-etag"');
      return new Response("partial", {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-disposition": 'attachment; filename="notes.txt"',
          "content-length": "7",
          "content-range": "bytes 3-9/20",
          "content-type": "text/plain",
          etag: '"blob-etag"',
        },
      });
    });
    const server = await serve(request);

    const result = await fetch(
      `${server.origin}/univer-workspace/api/blob-resources/resource-1/download`,
      {
        headers: { Range: "bytes=3-9", "If-None-Match": '"blob-etag"' },
      },
    );

    expect(result.status).toBe(206);
    expect(await result.text()).toBe("partial");
    expect(result.headers.get("accept-ranges")).toBe("bytes");
    expect(result.headers.get("content-disposition")).toBe('attachment; filename="notes.txt"');
    expect(result.headers.get("content-range")).toBe("bytes 3-9/20");
    expect(result.headers.get("etag")).toBe('"blob-etag"');
    expect(request).toHaveBeenCalledOnce();
  });

  it("proxies the authenticated read-only Resource descriptor without changing the method", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/resources/resource-1");
      expect(init?.method).toBe("GET");
      return new Response(
        JSON.stringify({
          resource: { id: "resource-1", kind: "univer", unitId: "unit-1", unitType: "sheet" },
          node: {
            id: "node-1",
            spaceId: "space-1",
            parentNodeId: null,
            name: "Q3 Budget",
            hasChildren: false,
            updatedAt: "2026-09-04T00:00:00.000Z",
            accessRole: "editor",
            resource: {
              id: "resource-1",
              kind: "univer",
              unitId: "unit-1",
              unitType: "sheet",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const server = await serve(request);

    const result = await fetch(`${server.origin}/univer-workspace/api/resources/resource-1`, {
      headers: { accept: "application/json" },
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      resource: { id: "resource-1", kind: "univer", unitId: "unit-1" },
      node: { id: "node-1", name: "Q3 Budget" },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("proxies the Blob open descriptor with its POST contract", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/resources/resource-blob/open");
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          resource: {
            id: "resource-blob",
            kind: "blob",
            name: "notes.txt",
            mediaType: "text/plain",
            byteSize: 5,
            contentUrl: "/api/blob-resources/resource-blob/content",
            downloadUrl: "/api/blob-resources/resource-blob/download",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const server = await serve(request);

    const result = await fetch(
      `${server.origin}/univer-workspace/api/resources/resource-blob/open`,
      { method: "POST", headers: { accept: "application/json" } },
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      resource: { id: "resource-blob", kind: "blob", mediaType: "text/plain" },
    });
    expect(request).toHaveBeenCalledOnce();
  });
});

async function serve(
  request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<{ origin: string }> {
  const context = {
    get(name: string) {
      if (name === "workspaceAuth") {
        return {
          currentIdentity: () => ({ userId: "user-1", username: "alice" }),
          currentClient: () => ({ request }),
        };
      }
      return undefined;
    },
  } as unknown as Context;
  const handler = createBrowserApiHandler(context, {
    license: "",
    workspaceRoot: "/tmp/product-proxy-test",
    workspaceOrigin: "https://workspace.test",
    publicOrigin: "http://127.0.0.1",
    templates: [],
  });
  const server = createServer((incoming, outgoing) => {
    void handler(incoming, outgoing);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${address.port}` };
}
