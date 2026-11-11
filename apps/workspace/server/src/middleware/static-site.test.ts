import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ANONYMOUS_USER_ID } from "../modules/identity/index.js";
import type { NodeSummary } from "../modules/nodes/index.js";
import { createStaticSiteRouter } from "./static-site.js";

let directory: string;
let server: Server;
let origin: string;
const indexHtml = '<!doctype html><html><head><title>app</title></head><body>app</body></html>';
const getNode = vi.fn((userId: string, nodeId: string) => {
  if (["private", "missing", "deleted", "failure"].includes(nodeId)) {
    throw new Error("No metadata may escape this lookup");
  }
  const names: Record<string, string> = {
    public: "Dashboard.univer.html",
    escaped: '<Sales & "growth" \'now\'>.univer.html',
    sheet: "Budget.univer.html",
    folder: "Folder.univer.html",
  };
  const node: NodeSummary = {
    id: nodeId, spaceId: "space", parentNodeId: null,
    name: names[nodeId] ?? "report.txt",
    resource: nodeId === "folder" ? null : nodeId === "sheet"
      ? { id: "resource", kind: "univer", unitId: "unit", unitType: "sheet",
          capabilities: { openContent: true, editContent: false, downloadContent: true } }
      : { id: "resource", kind: "blob", mediaType: "text/html", byteSize: 10, availability: "ready",
          capabilities: { openContent: true, editContent: false, downloadContent: true } },
    hasChildren: false, updatedAt: "2026-11-11T00:00:00Z", accessRole: "viewer",
    capabilities: { browseChildren: false, createChildren: false, rename: false, move: false, trash: false, share: false },
  };
  return { node, space: { id: "space", type: "team" as const, name: "Public" }, breadcrumbs: [], navigationRootNodeId: null };
});

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "static-site-"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "index.html"), indexHtml);
  writeFileSync(join(directory, "assets", "index-abc123.js"), "export {};");
  writeFileSync(join(directory, "favicon.ico"), "icon");

  const app = express();
  app.use("/without-origin", createStaticSiteRouter(directory, { nodes: { get: getNode } }));
  app.use(createStaticSiteRouter(directory, { nodes: { get: getNode }, publicOrigin: "https://workspace.example" }));
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe("public Node link metadata", () => {
  it.each(["", "?view=immersive&source=chat"])("renders an HTML view title and metadata for %s", async (query) => {
    const response = await fetch(`${origin}/nodes/public${query}`, { headers: { host: "untrusted.example" } });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("<title>Dashboard · Univer Workspace</title>");
    expect(html).toContain('<meta property="og:title" content="Dashboard · Univer Workspace" />');
    expect(html).toContain('<meta property="og:description" content="A live data page made with Univer Workspace" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:site_name" content="Univer Workspace" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html).toContain(`<meta property="og:url" content="https://workspace.example/nodes/public${query.replaceAll("&", "&amp;")}" />`);
    expect(html.indexOf('property="og:title"')).toBeLessThan(html.indexOf("</head>"));
    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
    expect(response.headers.get("vary")).toBe("Accept-Language");
    expect(getNode).toHaveBeenCalledWith(ANONYMOUS_USER_ID, "public");
  });

  it.each(["private", "missing", "deleted", "failure"])("leaves the shell byte-identical for %s", async (nodeId) => {
    const response = await fetch(`${origin}/nodes/${nodeId}`, { headers: { cookie: "session=owner", "Accept-Language": "zh" } });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(indexHtml));
    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
    expect(response.headers.get("vary")).toBeNull();
  });

  it("escapes names in both title text and attribute values", async () => {
    const html = await (await fetch(`${origin}/nodes/escaped`)).text();
    const title = "&lt;Sales &amp; &quot;growth&quot; &#39;now&#39;&gt; · Univer Workspace";
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${title}" />`);
  });

  it.each([
    ["zh-CN,zh;q=0.9,en;q=0.8", "使用 Univer Workspace 制作的实时数据页面"],
    ["en-US,en;q=0.9,zh;q=0.5", "A live data page made with Univer Workspace"],
    ["zh;q=0,en", "A live data page made with Univer Workspace"],
  ])("negotiates the description for %s", async (language, description) => {
    const response = await fetch(`${origin}/nodes/public`, { headers: { "Accept-Language": language } });
    expect(await response.text()).toContain(`content="${description}"`);
    expect(response.headers.get("vary")).toBe("Accept-Language");
  });

  it.each(["sheet", "folder", "text"])("keeps the name and generic description for %s", async (nodeId) => {
    const response = await fetch(`${origin}/nodes/${nodeId}`, { headers: { "Accept-Language": "zh-TW" } });
    const html = await response.text();
    expect(html).toContain(`<title>${nodeId === "text" ? "report.txt" : nodeId === "sheet" ? "Budget.univer.html" : "Folder.univer.html"} · Univer Workspace</title>`);
    expect(html).toContain('content="分享自 Univer Workspace"');
    const english = await (await fetch(`${origin}/nodes/${nodeId}`)).text();
    expect(english).toContain('content="Shared from Univer Workspace"');
  });

  it("omits og:url without a configured public origin", async () => {
    const html = await (await fetch(`${origin}/without-origin/nodes/public`)).text();
    expect(html).toContain("<title>Dashboard · Univer Workspace</title>");
    expect(html).not.toContain("og:url");
  });

  it.each(["/nodes/public/children", "/worktrees", "/spaces/public"])("leaves other routes unchanged at %s", async (path) => {
    const response = await fetch(`${origin}${path}`);
    expect(await response.text()).toBe(indexHtml);
    expect(response.headers.get("vary")).toBeNull();
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe("static site caching", () => {
  it("caches content-hashed assets as immutable", async () => {
    const response = await fetch(`${origin}/assets/index-abc123.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("answers a missing asset with 404 instead of the app shell", async () => {
    const response = await fetch(`${origin}/assets/index-stale99.js`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it.each(["/", "/index.html", "/worktrees?view=agent"])(
    "revalidates the app shell at %s",
    async (path) => {
      const response = await fetch(`${origin}${path}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<title>app</title>");
      expect(response.headers.get("cache-control")).toBe("public, max-age=0");
    }
  );

  it("revalidates unhashed public files", async () => {
    const response = await fetch(`${origin}/favicon.ico`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
  });
});
