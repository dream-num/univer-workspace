import { interactivePrincipal } from "../fixtures/principal.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import express from "express";
import { afterEach, expect, it } from "vitest";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";
import { loadConfig } from "../../server/src/config.js";
import { createStaticSiteRouter } from "../../server/src/middleware/static-site.js";
import { createNodesRouter } from "../../server/src/modules/nodes/index.js";

let application: SqliteTestApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("previews only Nodes readable through anonymous public-repository and inherited Link Sharing access", async () => {
  directory = mkdtempSync(join(tmpdir(), "workspace-link-meta-"));
  const indexHtml = "<!doctype html><html><head><title>Univer Workspace</title></head><body>app</body></html>";
  writeFileSync(join(directory, "index.html"), indexHtml);
  const config = loadConfig({
    DATABASE_FILE: join(directory, "product.sqlite"),
    COLLABORATION_DATABASE_FILE: join(directory, "collaboration.sqlite"),
    BLOB_DIRECTORY: join(directory, "objects"),
    PUBLIC_ORIGIN: "https://workspace.example/",
  });
  const workspace = await createSqliteTestApplication(config, {
    unitStore: { async createUnit(input) { return { unitId: input.unitId, headRevision: 1 }; } },
  });
  application = workspace;
  const issued = await workspace.identity.registerWithPassword({
    username: "link-meta-owner", displayName: "Owner", password: "correct horse battery staple",
  });
  const userId = issued.view.user.id;
  const personal = (await workspace.spaces.list(userId)).spaces[0];
  if (!personal) throw new Error("Personal space is missing");
  const repository = await workspace.spaces.createTeamSpace(interactivePrincipal(userId), { name: "Public repository", publicRead: true });
  const content = Buffer.from("<!doctype html><title>HTML content is not the metadata source</title>");
  const upload = (await workspace.blobs.createUpload(interactivePrincipal(userId), crypto.randomUUID(), {
    spaceId: repository.id, parentNodeId: null, name: "Sales.univer.html",
    originalFilename: "Sales.univer.html", byteSize: content.length,
  })).body.upload;
  await workspace.blobs.upload(userId, upload.id, String(content.length), Readable.from([content]));
  await workspace.blobs.complete(interactivePrincipal(userId), upload.id);
  const parent = await workspace.nodes.create(userId, { spaceId: personal.id, parentNodeId: null, name: "Shared folder" });
  const child = await workspace.nodes.create(userId, { spaceId: personal.id, parentNodeId: parent.id, name: "Personal document" });

  const app = express();
  app.use("/api", createNodesRouter({ identity: workspace.identity, nodes: workspace.nodes }));
  app.use(createStaticSiteRouter(directory, { nodes: workspace.nodes, identity: workspace.identity, permissions: workspace.permissions, publicOrigin: config.publicOrigin }));
  const httpServer = createServer(app);
  server = httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server address is missing");
  const origin = `http://127.0.0.1:${address.port}`;
  const page = (id: string, headers?: HeadersInit) => fetch(`${origin}/nodes/${id}?view=immersive`, { headers });
  const api = (id: string) => fetch(`${origin}/api/nodes/${id}`);

  expect((await api(upload.nodeId)).status).toBe(200);
  const publicResponse = await page(upload.nodeId);
  expect(publicResponse.status).toBe(200);
  const publicHtml = await publicResponse.text();
  expect(publicHtml).toContain("<title>Sales · Univer Workspace</title>");
  expect(publicHtml).toContain('content="A live data page made with Univer Workspace"');
  expect(publicHtml).toContain(`content="https://workspace.example/nodes/${upload.nodeId}?view=immersive"`);
  expect(await (await page(child.id, { cookie: `${workspace.identity.cookieName}=${issued.cookieValue}` })).text()).toBe(indexHtml);

  await workspace.permissions.updateNodeLinkSharing(interactivePrincipal(userId), parent.id, { enabled: true, role: "editor" });
  expect((await api(child.id)).status).toBe(200);
  const sharedResponse = await page(child.id, { "Accept-Language": "zh-CN,zh;q=0.9" });
  expect(await sharedResponse.text()).toContain('content="分享自 Univer Workspace"');
  expect(sharedResponse.headers.get("vary")).toBe("Accept-Language");
  await workspace.permissions.updateNodeLinkSharing(interactivePrincipal(userId), parent.id, { enabled: false, role: "editor" });
  expect((await api(child.id)).status).toBe(404);
  expect(await (await page(child.id)).text()).toBe(indexHtml);

  await workspace.nodes.update(interactivePrincipal(userId), upload.nodeId, { name: '<Sales & "growth">.univer.html' });
  expect(await (await page(upload.nodeId)).text()).toContain("<title>&lt;Sales &amp; &quot;growth&quot;&gt; · Univer Workspace</title>");
  await workspace.spaces.update(interactivePrincipal(userId), repository.id, { publicRead: false });
  const revoked = await page(upload.nodeId, { "If-None-Match": publicResponse.headers.get("etag") ?? "" });
  expect(revoked.status).toBe(200);
  expect(await revoked.text()).toBe(indexHtml);
  expect((await api(upload.nodeId)).status).toBe(404);
  await workspace.spaces.update(interactivePrincipal(userId), repository.id, { publicRead: true });
  await workspace.trash.trashNode(userId, upload.nodeId);
  for (const id of [upload.nodeId, "missing"]) {
    expect((await api(id)).status).toBe(404);
    const response = await page(id);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(indexHtml));
  }
});
