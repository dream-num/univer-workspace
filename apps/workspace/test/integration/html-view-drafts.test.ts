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

const html =
  "<!doctype html><html><head><title>Draft</title></head><body><h1>Hello</h1></body></html>";
async function harness() {
  const c = await createHttpContext();
  const send = (path: string, body?: unknown, key?: string, cookie = c.cookie) =>
    fetch(`${c.origin}/api/html-view-drafts${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const submit = async (
    key = crypto.randomUUID(),
    body: unknown = { kind: "create", spaceId: c.space.id, name: "Weekly", html },
  ) => {
    const response = await send("", body, key);
    expect(response.status).toBe(201);
    return (await response.json()).draft;
  };
  return { ...c, send, submit };
}

describe("HTML View draft HTTP API", () => {
  it("validates content, byte limits and quoted strong ETags before staging", async () => {
    const c = await harness();
    const body = {
      kind: "create",
      spaceId: c.space.id,
      name: "Page",
      html: '<span data-univer-cell-text="invalid"></span>',
    };
    expect(
      (await c.send("", { ...body, html: "\t".repeat(512 * 1024) }, crypto.randomUUID())).status,
    ).toBe(201);
    expect(
      (await c.send("", { ...body, html: "a".repeat(3 * 1024 * 1024) }, crypto.randomUUID()))
        .status,
    ).toBe(413);
    expect((await c.send("", body, crypto.randomUUID())).status).toBe(400);
    expect(
      (await c.send("", { ...body, html: "中".repeat(180000) }, crypto.randomUUID())).status,
    ).toBe(413);
    expect(
      (
        await c.send(
          "",
          { kind: "replace", resourceId: "r", etag: 'W/"weak"', html },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect((await c.send("", { ...body, html }, "short")).status).toBe(400);
  });

  it("stages inert author-only bytes then publishes a visible page and replays", async () => {
    const c = await harness();
    const key = crypto.randomUUID();
    const draft = await c.submit(key);
    expect(draft).toMatchObject({ state: "pending", name: "Weekly.univer.html", published: null });
    expect(c.application.views.listHtmlViews(c.userId, {}).items).toHaveLength(0);
    const replay = await c.send(
      "",
      { kind: "create", spaceId: c.space.id, name: "Weekly", html },
      key,
    );
    expect(replay.status).toBe(200);
    expect((await replay.json()).draft).toEqual(draft);
    expect(
      (await c.send("", { kind: "create", spaceId: c.space.id, name: "Different", html }, key))
        .status,
    ).toBe(409);
    const content = await c.send(`/${draft.id}/content`);
    expect(content.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(content.headers.get("content-security-policy")).toBe("sandbox");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await content.text()).toBe(html);
    const published = await c.send(`/${draft.id}/publish`, {});
    expect(published.status).toBe(200);
    const view = (await published.json()).draft;
    expect(view.state).toBe("published");
    expect(
      c.application.database.connection
        .prepare("SELECT id FROM nodes WHERE id = ?")
        .get(view.published.nodeId),
    ).toBeDefined();
    expect(c.application.views.listHtmlViews(c.userId, {}).items).toHaveLength(1);
    const bytes = await fetch(
      `${c.origin}/api/blob-resources/${view.published.resourceId}/content`,
      { headers: { cookie: c.cookie } },
    );
    expect(await bytes.text()).toBe(html);
    expect((await (await c.send(`/${draft.id}/publish`, {})).json()).draft).toEqual(view);
  });

  it("replaces bytes, changes ETag, queues old bytes and detects a stale replacement", async () => {
    const c = await harness();
    const draft = await c.submit();
    const first = (await (await c.send(`/${draft.id}/publish`, {})).json()).draft.published;
    const body = {
      kind: "replace",
      resourceId: first.resourceId,
      etag: first.etag,
      html: html.replace("Hello", "Revised"),
    };
    const replacement = await c.submit(crypto.randomUUID(), body);
    const stale = await c.submit(crypto.randomUUID(), body);
    const old = c.application.database.connection
      .prepare("SELECT object_key FROM blob_resources WHERE resource_id = ?")
      .get(first.resourceId)!.object_key;
    const next = (await (await c.send(`/${replacement.id}/publish`, {})).json()).draft;
    expect(next.published.etag).not.toBe(first.etag);
    expect(
      c.application.database.connection
        .prepare("SELECT reason FROM object_deletion_jobs WHERE object_key = ?")
        .get(old),
    ).toMatchObject({ reason: "blob_content_replaced" });
    expect((await (await c.send(`/${stale.id}`)).json()).draft.state).toBe("conflicted");
    expect((await c.send(`/${stale.id}/publish`, {})).status).toBe(409);
    expect(
      c.application.database.connection
        .prepare("SELECT state FROM html_view_drafts WHERE id = ?")
        .get(stale.id)!.state,
    ).toBe("conflicted");
  });

  it("rejects idempotently and expires pending and receiving rows through maintenance", async () => {
    const c = await harness();
    const draft = await c.submit();
    expect((await c.send(`/${draft.id}/reject`, {})).status).toBe(200);
    expect((await c.send(`/${draft.id}/reject`, {})).status).toBe(200);
    expect((await c.send(`/${draft.id}/publish`, {})).status).toBe(409);
    const expired = await c.submit();
    c.application.database.connection
      .prepare("UPDATE html_view_drafts SET expires_at = 1 WHERE id = ?")
      .run(expired.id);
    expect((await (await c.send(`/${expired.id}`)).json()).draft.state).toBe("expired");
    const receiving = await c.submit();
    c.application.database.connection
      .prepare(
        "UPDATE html_view_drafts SET state = 'receiving', media_type = NULL, stored_etag = NULL, expires_at = 1 WHERE id = ?",
      )
      .run(receiving.id);
    expect(c.application.htmlViewDrafts.expireDue(Date.now(), 25)).toBe(2);
    for (const id of [draft.id, expired.id, receiving.id]) {
      expect(
        c.application.database.connection
          .prepare(
            "SELECT j.id FROM object_deletion_jobs j JOIN html_view_drafts d ON d.object_key = j.object_key WHERE d.id = ?",
          )
          .get(id),
      ).toBeDefined();
    }
  });

  it("retries receiving, coalesces concurrent retries and protects author and interactive decisions", async () => {
    const c = await harness();
    const key = crypto.randomUUID();
    const draft = await c.submit(key);
    c.application.database.connection
      .prepare("UPDATE html_view_drafts SET state = 'receiving' WHERE id = ?")
      .run(draft.id);
    expect((await c.send(`/${draft.id}`)).status).toBe(404);
    const body = { kind: "create", spaceId: c.space.id, name: "Weekly", html };
    const replies = await Promise.all([c.send("", body, key), c.send("", body, key)]);
    for (const response of replies) {
      expect(response.status).toBe(200);
      expect((await response.json()).draft).toMatchObject({ id: draft.id, state: "pending" });
    }
    const db = c.application.database.connection;
    db.prepare(
      "INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at) VALUES ('draft-pat', ?, 'Draft', 'draft-hash', 'read write publish', 1)",
    ).run(c.userId);
    const user = c.application.identity.requireSession(c.cookie).user;
    const tokenSession = c.application.identity.issueSession(user, "agent", {
      issuedFor: { kind: "pat", id: "draft-pat" },
    });
    const tokenCookie = `${c.application.identity.cookieName}=${tokenSession.cookieValue}`;
    expect((await c.send(`/${draft.id}`, undefined, undefined, tokenCookie)).status).toBe(200);
    expect((await c.send("", body, crypto.randomUUID(), tokenCookie)).status).toBe(201);
    for (const action of ["publish", "reject"])
      expect((await c.send(`/${draft.id}/${action}`, {}, undefined, tokenCookie)).status).toBe(403);
    const other = await c.application.identity.registerWithPassword({
      username: "other-user",
      displayName: "Other",
      password: "correct horse battery staple",
    });
    const otherCookie = `${c.application.identity.cookieName}=${other.cookieValue}`;
    for (const action of ["", "/content", "/publish", "/reject"])
      expect(
        (
          await c.send(
            `/${draft.id}${action}`,
            action === "/publish" || action === "/reject" ? {} : undefined,
            undefined,
            otherCookie,
          )
        ).status,
      ).toBe(404);
  });
});
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
    username: "draft-owner",
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
