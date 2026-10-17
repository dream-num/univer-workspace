import { Readable } from "node:stream";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(applications.splice(0).map((application) => application.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("standalone HTML Apps", () => {
  it("serves a top-level sandbox, enforces the existing ACL after revocation, and preserves identity", async () => {
    const ctx = await createHttpContext();
    const html = '<!doctype html><title>Example</title><script>document.title=location.hash</script><h1>Hello</h1>';
    const published = await publish(ctx, html);
    const url = `${ctx.origin}/apps/${published.nodeId}/run?prd=refund#refundFaq`;
    const privateEntry = await fetch(url);
    expect(privateEntry.status).toBe(200);
    const handoff = await privateEntry.text();
    expect(handoff).toContain('location.pathname+location.search+location.hash');
    expect(handoff).not.toContain('<h1>Hello</h1>');
    expect(privateEntry.headers.get('content-security-policy')).toContain("script-src 'sha256-");
    const entry = await fetch(url, {headers: {cookie: ctx.cookie, range: 'bytes=0-1'}});
    expect(entry.status).toBe(200);
    expect(entry.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(entry.headers.get('cache-control')).toBe('private, no-store');
    const policy = entry.headers.get('content-security-policy')!;
    expect(policy).toContain('sandbox allow-scripts');
    expect(policy).not.toContain('allow-same-origin');
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(await entry.text()).toBe(html);
    ctx.application.permissions.updateNodeLinkSharing(ctx.userId, published.nodeId, {enabled: true, role: 'viewer'});
    expect(await (await fetch(url)).text()).toBe(html);
    ctx.application.permissions.updateNodeLinkSharing(ctx.userId, published.nodeId, {enabled: false, role: 'viewer'});
    const revoked = await fetch(url);
    expect(revoked.status).toBe(200);
    const revokedBody = await revoked.text();
    expect(revokedBody).toContain("location.replace('/login?returnTo='");
    expect(revokedBody).not.toContain('<h1>Hello</h1>');
    const denied = await ctx.application.identity.registerWithPassword({username: 'other', displayName: 'Other', password: 'correct horse battery staple'});
    expect((await fetch(url, {headers: {cookie: `${ctx.application.identity.cookieName}=${denied.cookieValue}`}})).status).toBe(404);
    expect((await fetch(`${ctx.origin}/api/blob-resources/${published.resourceId}/content`)).status).toBe(404);
    expect(ctx.application.access.resolveNode(ctx.userId, published.nodeId)?.resourceId).toBe(published.resourceId);
  });

  it("does not execute ordinary uploads or live-bound Apps and rejects oversized documents", async () => {
    const ctx = await createHttpContext();
    const text = await publish(ctx, '<script>alert(1)</script>', 'ordinary.html');
    expect((await fetch(`${ctx.origin}/apps/${text.nodeId}/run`, {headers: {cookie: ctx.cookie}})).status).toBe(404);
    const bound = await publish(ctx, '<p data-univer-cell-text="book:sheet:A1">value</p>');
    const response = await fetch(`${ctx.origin}/apps/${bound.nodeId}/run`, {headers: {cookie: ctx.cookie}});
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(`/nodes/${bound.nodeId}?view=immersive`);
    const invalid = await publish(ctx, '<p data-univer-cell-text="invalid">value</p>');
    expect((await fetch(`${ctx.origin}/apps/${invalid.nodeId}/run`, {headers: {cookie: ctx.cookie}})).status).toBe(400);
    const large = await publish(ctx, ' '.repeat(5 * 1024 * 1024 + 1));
    expect((await fetch(`${ctx.origin}/apps/${large.nodeId}/run`, {headers: {cookie: ctx.cookie}})).status).toBe(413);
    expect((await fetch(`${ctx.origin}/apps/missing/run`, {headers: {cookie: ctx.cookie}})).status).toBe(404);
  });
});

async function publish(ctx: Awaited<ReturnType<typeof createHttpContext>>, html: string, filename = 'example.univer.html') {
  const content = Buffer.from(html);
  const { body } = ctx.application.blobs.createUpload(ctx.userId, crypto.randomUUID(), {
    spaceId: ctx.space.id, parentNodeId: null, name: filename,
    originalFilename: filename, byteSize: content.length,
  });
  await ctx.application.blobs.upload(ctx.userId, body.upload.id, String(content.length), Readable.from([content]));
  await ctx.application.blobs.complete(ctx.userId, body.upload.id);
  return {nodeId: body.upload.nodeId, resourceId: body.upload.resourceId};
}

async function createHttpContext() {
  const directory = mkdtempSync(join(tmpdir(), "workspace-http-blob-"));
  directories.push(directory);
  const application = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: join(directory, "product.sqlite"),
      collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
      blobDirectory: join(directory, "objects"),
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
    {
      unitStore: {
        async createUnit(input) {
          return { unitId: input.unitId, headRevision: 1 };
        },
      },
    },
  );
  applications.push(application);
  const issued = await application.identity.registerWithPassword({
    username: "http-blob",
    displayName: "HTTP Blob",
    password: "correct horse battery staple",
  });
  const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
  const space = application.spaces.list(issued.view.user.id).spaces[0];
  if (!space) throw new Error("Personal space is missing");
  const server = createServer(application.app);
  servers.push(server);
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address is missing");
  const origin = `http://127.0.0.1:${address.port}`;
  return { application, cookie, space, origin, userId: issued.view.user.id };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
