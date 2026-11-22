import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";

const applications: SqliteTestApplication[] = [];
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
  it.each(["create", "replace"] as const)("revises a pending %s draft, links its successor and retries idempotently", async (kind) => {
    const c = await harness();
    const first = await c.submit();
    const published = kind === "replace" ? (await (await c.send(`/${first.id}/publish`, {})).json()).draft.published : null;
    const previous = published ? await c.submit(crypto.randomUUID(), { kind, resourceId: published.resourceId, etag: published.etag, html }) : first;
    const key = crypto.randomUUID();
    const body = { kind: "revise", draftId: previous.id, html: html.replace("Hello", "New revision") };
    const next = await c.submit(key, body);
    expect(next).toMatchObject({ kind, state: "pending", spaceId: previous.spaceId, name: previous.name,
      parentNodeId: previous.parentNodeId, targetResourceId: previous.targetResourceId, baseEtag: previous.baseEtag });
    expect((await (await c.send(`/${previous.id}`)).json()).draft).toMatchObject({ state: "superseded", supersededBy: next.id });
    const refused = await c.send(`/${previous.id}/publish`, {});
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toContain("superseded");
    const replay = await c.send("", body, key);
    expect(replay.status).toBe(200);
    expect((await replay.json()).draft).toEqual(next);
    expect((await c.send("", { ...body, html }, key)).status).toBe(409);
    const wrongKey = await c.send("", body, crypto.randomUUID());
    expect(wrongKey.status).toBe(409);
    expect((await wrongKey.json()).error.message).toContain(next.id);
    expect(await (await c.send(`/${next.id}/content`)).text()).toBe(body.html);
    expect((await c.send(`/${next.id}/publish`, {})).status).toBe(200);
    const nonpending = await c.send("", { ...body, draftId: next.id }, crypto.randomUUID());
    expect(nonpending.status).toBe(409);
    expect((await nonpending.json()).error.message).toContain("published");
  });

  it.each([true, false])("concurrent revisions produce one successor (sameKey=%s)", async (sameKey) => {
    const c = await harness();
    const previous = await c.submit();
    const key = crypto.randomUUID();
    const body = { kind: "revise", draftId: previous.id, html };
    const responses = await Promise.all([c.send("", body, key), c.send("", body, sameKey ? key : crypto.randomUUID())]);
    expect(responses.map((response) => response.status).sort()).toEqual(sameKey ? [200, 201] : [201, 409]);
    const old = (await (await c.send(`/${previous.id}`)).json()).draft;
    expect(old.state).toBe("superseded");
    const successor = (await (await c.send(`/${old.supersededBy}`)).json()).draft;
    expect(successor.state).toBe("pending");
    if (sameKey) for (const response of responses) expect((await response.json()).draft.id).toBe(successor.id);
  });

  it("only lets the author revise pending, unexpired drafts and retains the source PR", async () => {
    const c = await harness();
    const worktree = (await c.application.worktrees.create(c.userId, crypto.randomUUID(), { kind: "user", name: "Source", summary: null })).body;
    const previous = await c.submit(crypto.randomUUID(), { kind: "create", spaceId: c.space.id, parentNodeId: null, name: "Page", html, sourceWorktreeId: worktree.id });
    const body = { kind: "revise", draftId: previous.id, html };
    const other = await c.application.identity.registerWithPassword({ username: "draft-outsider", displayName: "Other", password: "correct horse battery staple" });
    const otherCookie = `${c.application.identity.cookieName}=${other.cookieValue}`;
    expect((await c.send("", body, crypto.randomUUID(), otherCookie)).status).toBe(404);
    expect((await c.send(`/${previous.id}/content`, undefined, undefined, otherCookie)).status).toBe(404);
    const next = await c.submit(crypto.randomUUID(), body);
    expect(next.sourceWorktreeId).toBe(worktree.id);
    const superseded = await c.send("", body, crypto.randomUUID());
    expect(superseded.status).toBe(409);
    expect((await superseded.json()).error.message).toContain(next.id);
    expect((await c.application.repositories.htmlViewDrafts.pendingForWorktree(worktree.id)).map((row) => row.id)).toEqual([next.id]);
    const override = (await c.application.worktrees.create(c.userId, crypto.randomUUID(), { kind: "user", name: "Override", summary: null })).body;
    const newest = await c.submit(crypto.randomUUID(), { ...body, draftId: next.id, sourceWorktreeId: override.id });
    expect(newest.sourceWorktreeId).toBe(override.id);
    c.application.database.connection.prepare("UPDATE html_view_drafts SET expires_at = 1 WHERE id = ?").run(newest.id);
    const expired = await c.send("", { ...body, draftId: newest.id }, crypto.randomUUID());
    expect(expired.status).toBe(409);
    expect((await expired.json()).error.message).toContain("expired");
    await c.application.worktrees.discard(c.userId, worktree.id, crypto.randomUUID());
    const terminal = await c.send("", body, crypto.randomUUID());
    expect(terminal.status).toBe(409);
    expect((await terminal.json()).error.message).toContain(`superseded. Successor draft: ${next.id}`);
  });

  it("keeps the old draft pending after an interrupted upload completion and supersedes it on retry", async () => {
    const c = await harness();
    const previous = await c.submit();
    const upload = vi.spyOn(c.application.repositories.htmlViewDrafts, "markPending").mockRejectedValueOnce(new Error("Upload failed"));
    const key = crypto.randomUUID();
    const body = { kind: "revise", draftId: previous.id, html };
    expect((await c.send("", body, key)).status).toBe(500);
    upload.mockRestore();
    expect((await (await c.send(`/${previous.id}`)).json()).draft.state).toBe("pending");
    const retry = await c.send("", body, key);
    expect(retry.status).toBe(200);
    const next = (await retry.json()).draft;
    expect((await (await c.send(`/${previous.id}`)).json()).draft).toMatchObject({ state: "superseded", supersededBy: next.id });
  });


  it("links create and replace drafts to a reviewable pull request and includes it in intent", async () => {
    const c = await harness();
    const source = (await c.application.worktrees.create(c.userId, crypto.randomUUID(), { kind: "user", name: "Source", summary: null })).body;
    const body = { kind: "create", spaceId: c.space.id, name: "Page", html, sourceWorktreeId: source.id };
    const key = crypto.randomUUID();
    const draft = await c.submit(key, body);
    expect(draft.sourceWorktreeId).toBe(source.id);
    expect((await (await c.send(`/${draft.id}`)).json()).draft.sourceWorktreeId).toBe(source.id);
    expect((await c.send("", body, key)).status).toBe(200);
    const { sourceWorktreeId: _, ...unlinked } = body;
    expect((await c.send("", unlinked, key)).status).toBe(409);
    const other = (await c.application.worktrees.create(c.userId, crypto.randomUUID(), { kind: "user", name: "Another", summary: null })).body;
    expect((await c.send("", { ...body, sourceWorktreeId: other.id }, key)).status).toBe(409);
    const waiting = await c.send(`/${draft.id}/publish`, {});
    expect(waiting.status).toBe(409);
    expect((await waiting.json()).error.message).toContain(`#${source.number}`);
    await c.application.worktrees.markReady(c.userId, source.id);
    const merge = await fetch(`${c.origin}/api/worktrees/${source.id}/merge`, {
      method: "POST", headers: { cookie: await delegatedCookie(c), "idempotency-key": crypto.randomUUID() },
    });
    expect(merge.status).toBe(200);
    expect((await merge.json()).publishedPages).toEqual([]);
    expect((await (await c.send(`/${draft.id}`)).json()).draft.state).toBe("pending");
    const published = await c.send(`/${draft.id}/publish`, {});
    expect(published.status).toBe(200);
    const first = (await published.json()).draft.published;
    const replacement = await c.submit(crypto.randomUUID(), { kind: "replace", resourceId: first.resourceId, etag: first.etag, html, sourceWorktreeId: source.id });
    expect(replacement.sourceWorktreeId).toBe(source.id);
    expect((await c.send(`/${replacement.id}/publish`, {})).status).toBe(200);
    const newOnMerged = await c.submit(crypto.randomUUID(), body);
    expect((await c.send(`/${newOnMerged.id}/publish`, {})).status).toBe(200);
  });

  it("rejects discarded or unreadable sources and derives conflicts after discard", async () => {
    const c = await harness();
    const source = (await c.application.worktrees.create(c.userId, crypto.randomUUID(), { kind: "user", name: "Discarded", summary: null })).body;
    const body = { kind: "create", spaceId: c.space.id, name: "Page", html, sourceWorktreeId: source.id };
    const draft = await c.submit(crypto.randomUUID(), body);
    await c.application.worktrees.discard(c.userId, source.id, crypto.randomUUID());
    expect((await (await c.send(`/${draft.id}`)).json()).draft.state).toBe("conflicted");
    const refused = await c.send(`/${draft.id}/publish`, {});
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toContain("conflicted");
    expect((await c.send("", body, crypto.randomUUID())).status).toBe(409);
    const other = await c.application.identity.registerWithPassword({ username: "source-outsider", displayName: "Other", password: "correct horse battery staple" });
    const hidden = (await c.application.worktrees.create(other.view.user.id, crypto.randomUUID(), { kind: "user", name: "Private", summary: null })).body;
    expect((await c.send("", { ...body, sourceWorktreeId: hidden.id }, crypto.randomUUID())).status).toBe(404);
    expect((await c.send("", { ...body, sourceWorktreeId: "missing" }, crypto.randomUUID())).status).toBe(404);
    const team = await c.application.spaces.createTeamSpace(other.view.user.id, { name: "Summary only" });
    await c.application.permissions.upsertTeamMember(other.view.user.id, team.id, c.userId, { role: "admin" });
    const restricted = (await c.application.worktrees.create(other.view.user.id, crypto.randomUUID(), { kind: "team", teamSpaceId: team.id, name: "Summary", visibility: "private", summary: null })).body;
    expect((await c.application.worktrees.get(c.userId, restricted.id)).worktree.capabilities.review).toBe(false);
    expect((await c.send("", { ...body, sourceWorktreeId: restricted.id }, crypto.randomUUID())).status).toBe(404);
  });

  it("publishes linked drafts only through an interactive HTTP merge and omits them on replay", async () => {
    const c = await harness();
    const source = (await c.application.worktrees.create(c.userId, crypto.randomUUID(), { kind: "user", name: "Source", summary: null })).body;
    const draft = await c.submit(crypto.randomUUID(), { kind: "create", spaceId: c.space.id, name: "Page", html, sourceWorktreeId: source.id });
    await c.application.worktrees.markReady(c.userId, source.id);
    const key = crypto.randomUUID();
    const merge = () => fetch(`${c.origin}/api/worktrees/${source.id}/merge`, { method: "POST", headers: { cookie: c.cookie, "idempotency-key": key } });
    const first = await merge();
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result.publishedPages).toEqual([{ draftId: draft.id, name: draft.name, nodeId: expect.any(String) }]);
    expect(result.worktree.pendingPageDrafts).toBe(0);
    const replay = await merge();
    expect(replay.status).toBe(200);
    expect((await replay.json()).publishedPages).toEqual([]);
    expect((await c.application.views.listHtmlViews(c.userId, {})).items).toHaveLength(1);
  });

  it.each([false, true])("resumes an interrupted merge through operation retry (tokenIssued=%s)", async (tokenIssued) => {
    const c = await harness();
    const source = (await c.application.worktrees.create(c.userId, crypto.randomUUID(), { kind: "user", name: "Resume", summary: null })).body;
    const draft = await c.submit(crypto.randomUUID(), { kind: "create", spaceId: c.space.id, name: "Page", html, sourceWorktreeId: source.id });
    await c.application.worktrees.markReady(c.userId, source.id);
    const key = crypto.randomUUID();
    const failure = vi.spyOn(c.application.repositories.worktrees, "completeOperation").mockRejectedValueOnce(new Error("Interrupted after merge"));
    await expect(c.application.worktrees.merge(c.userId, source.id, key)).rejects.toThrow("Interrupted after merge");
    failure.mockRestore();
    const retry = await fetch(`${c.origin}/api/operations/${key}/retry`, {
      method: "POST", headers: { cookie: tokenIssued ? await delegatedCookie(c) : c.cookie },
    });
    expect(retry.status).toBe(202);
    expect((await retry.json()).state).toBe("completed");
    expect((await (await c.send(`/${draft.id}`)).json()).draft.state).toBe(tokenIssued ? "pending" : "published");
  });

  it("requires drafts for delegated upload names and original filenames, ignoring case", async () => {
    const c = await harness();
    const tokenCookie = await delegatedCookie(c);
    for (const names of [
      { name: "Page.univer.html", originalFilename: "source.txt" },
      { name: "ordinary.txt", originalFilename: "Page.UnIvEr.HtMl" },
      { name: "PAGE.UNIVER.HTML", originalFilename: "source.txt" },
    ]) {
      await expectDraftRequired(await reserveBlob(c, tokenCookie, names));
      const interactive = await reserveBlob(c, c.cookie, names);
      expect(interactive.status).toBe(201);
    }
  });

  it("requires drafts for delegated replacement of either page filename", async () => {
    const c = await harness();
    const tokenCookie = await delegatedCookie(c);
    for (const names of [
      { name: "PAGE.UNIVER.HTML", originalFilename: "source.txt" },
      { name: "ordinary.txt", originalFilename: "Page.UnIvEr.HtMl" },
    ]) {
      const upload = await uploadBlob(c, c.cookie, names);
      const replace = (cookie: string) => fetch(
        `${c.origin}/api/blob-resources/${upload.resourceId}/content`,
        {
          method: "PUT",
          headers: { cookie, "idempotency-key": crypto.randomUUID(), "if-match": upload.etag },
          body: "revised",
        },
      );
      await expectDraftRequired(await replace(tokenCookie));
      expect((await replace(c.cookie)).status).toBe(200);
    }
  });

  it("guards delegated Blob renames while allowing ordinary Blob writes and folder names", async () => {
    const c = await harness();
    const tokenCookie = await delegatedCookie(c);
    const upload = await uploadBlob(c, tokenCookie, { name: "notes.txt", originalFilename: "notes.txt" });
    const replaced = await fetch(`${c.origin}/api/blob-resources/${upload.resourceId}/content`, {
      method: "PUT",
      headers: { cookie: tokenCookie, "idempotency-key": crypto.randomUUID(), "if-match": upload.etag },
      body: "revised",
    });
    expect(replaced.status).toBe(200);
    const rename = (nodeId: string, name: string, cookie = tokenCookie) => fetch(
      `${c.origin}/api/nodes/${nodeId}`,
      { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name }) },
    );
    expect((await rename(upload.nodeId, "renamed.txt")).status).toBe(200);
    await expectDraftRequired(await rename(upload.nodeId, "Page.UnIvEr.HtMl"));
    expect((await rename(upload.nodeId, "Page.UnIvEr.HtMl", c.cookie)).status).toBe(200);
    const trashed = await fetch(`${c.origin}/api/nodes/${upload.nodeId}/trash`, {
      method: "POST", headers: { cookie: tokenCookie },
    });
    expect(trashed.status).toBe(201);
    const batch = await trashed.json();
    expect((await fetch(`${c.origin}/api/trash-batches/${batch.id}/restore`, {
      method: "POST", headers: { cookie: tokenCookie },
    })).status).toBe(200);
    const folder = await c.application.nodes.create(c.userId, { spaceId: c.space.id, parentNodeId: null, name: "Folder" });
    expect((await rename(folder.id, "Folder.univer.html")).status).toBe(200);
  });

  it("prevents delegated completion of an interactive page reservation", async () => {
    const c = await harness();
    const tokenCookie = await delegatedCookie(c);
    const reserved = await reserveBlob(c, c.cookie, { name: "Page.univer.html", originalFilename: "source.txt" });
    const { upload } = await reserved.json();
    expect((await fetch(`${c.origin}/api/blob-upload-sessions/${upload.id}/content`, {
      method: "PUT", headers: { cookie: c.cookie }, body: html,
    })).status).toBe(204);
    const complete = (cookie: string) => fetch(`${c.origin}/api/blob-upload-sessions/${upload.id}/complete`, {
      method: "POST", headers: { cookie },
    });
    await expectDraftRequired(await complete(tokenCookie));
    expect((await c.application.views.listHtmlViews(c.userId, {})).items).toHaveLength(0);
    expect((await complete(c.cookie)).status).toBe(201);
  });

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

  it.each([
    ["same intent", "Weekly", 200],
    ["different intent", "Another name", 409],
  ] as const)("handles a concurrent reservation for the %s", async (_case, name, status) => {
    const c = await harness();
    const key = crypto.randomUUID();
    const body = { kind: "create", name: "Weekly", spaceId: c.space.id, html };
    const repository = c.application.repositories.htmlViewDrafts;
    const find = repository.findKey.bind(repository);
    let winningId: string | undefined;
    const overlap = vi.spyOn(repository, "findKey").mockImplementationOnce(async (...args) => {
      const beforeReservation = await find(...args);
      expect(beforeReservation).toBeUndefined();
      const winner = await c.send("", body, key);
      expect(winner.status).toBe(201);
      winningId = (await winner.json()).draft.id;
      return beforeReservation;
    });
    try {
      const response = await c.send("", { ...body, name }, key);
      expect(response.status).toBe(status);
      if (status === 200) expect((await response.json()).draft.id).toBe(winningId);
      expect((await find(c.userId, key))?.id).toBe(winningId);
    } finally {
      overlap.mockRestore();
    }
  });

  it("stages inert author-only bytes then publishes a visible page and replays", async () => {
    const c = await harness();
    const key = crypto.randomUUID();
    const draft = await c.submit(key);
    expect(draft).toMatchObject({ sourceWorktreeId: null, state: "pending", name: "Weekly.univer.html", published: null });
    expect((await c.application.views.listHtmlViews(c.userId, {})).items).toHaveLength(0);
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
    expect((await c.application.views.listHtmlViews(c.userId, {})).items).toHaveLength(1);
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
    expect(await c.application.htmlViewDrafts.expireDue(Date.now(), 25)).toBe(2);
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
    const user = (await c.application.identity.requireSession(c.cookie)).user;
    const tokenSession = await c.application.identity.issueSession(user, "agent", {
      issuedFor: { kind: "pat", id: "draft-pat" },
    });
    const tokenCookie = `${c.application.identity.cookieName}=${tokenSession.cookieValue}`;
    expect((await c.send(`/${draft.id}`, undefined, undefined, tokenCookie)).status).toBe(200);
    const submitted = await c.send("", body, crypto.randomUUID(), tokenCookie);
    expect(submitted.status).toBe(201);
    const delegatedDraft = (await submitted.json()).draft;
    const published = await c.send(`/${delegatedDraft.id}/publish`, {});
    expect(published.status).toBe(200);
    const publishedDraft = (await published.json()).draft;
    expect(publishedDraft.state).toBe("published");
    const replacement = await c.send("", {
      kind: "replace", resourceId: publishedDraft.published.resourceId,
      etag: publishedDraft.published.etag, html: html.replace("Hello", "Revised"),
    }, crypto.randomUUID(), tokenCookie);
    expect(replacement.status).toBe(201);
    const replacementDraft = (await replacement.json()).draft;
    expect((await c.send(`/${replacementDraft.id}/publish`, {})).status).toBe(200);
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
  const application = await createSqliteTestApplication(
    {
      host: "127.0.0.1",
      port: 0,
      database: { provider: "sqlite", filename: join(directory, "product.sqlite"), collaborationFilename: join(directory, "collaboration.sqlite") },
      blobDirectory: join(directory, "objects"),
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
  );
  applications.push(application);
  const issued = await application.identity.registerWithPassword({
    username: "draft-owner",
    displayName: "HTTP Blob",
    password: "correct horse battery staple",
  });
  const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
  const space = (await application.spaces.list(issued.view.user.id)).spaces[0];
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

async function delegatedCookie(c: Awaited<ReturnType<typeof createHttpContext>>): Promise<string> {
  c.application.database.connection.prepare(
    "INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at) VALUES ('guard-pat', ?, 'Guard', 'guard-hash', 'read write publish', 1)",
  ).run(c.userId);
  const issued = await c.application.identity.issueSession((await c.application.identity.requireSession(c.cookie)).user, "agent", {
    issuedFor: { kind: "pat", id: "guard-pat" },
  });
  return `${c.application.identity.cookieName}=${issued.cookieValue}`;
}

async function expectDraftRequired(response: Response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: {
    code: "HTML_VIEW_DRAFT_REQUIRED",
    message: "Pages (.univer.html) from Agents must go through html_view_save drafts.",
  } });
}

function reserveBlob(
  c: Awaited<ReturnType<typeof createHttpContext>>,
  cookie: string,
  names: { name: string; originalFilename: string },
) {
  return fetch(`${c.origin}/api/blob-upload-sessions`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ spaceId: c.space.id, parentNodeId: null, ...names, byteSize: Buffer.byteLength(html) }),
  });
}

async function uploadBlob(
  c: Awaited<ReturnType<typeof createHttpContext>>,
  cookie: string,
  names: { name: string; originalFilename: string },
) {
  const reserved = await reserveBlob(c, cookie, names);
  expect(reserved.status).toBe(201);
  const { upload } = await reserved.json();
  expect((await fetch(`${c.origin}/api/blob-upload-sessions/${upload.id}/content`, {
    method: "PUT", headers: { cookie }, body: html,
  })).status).toBe(204);
  expect((await fetch(`${c.origin}/api/blob-upload-sessions/${upload.id}/complete`, {
    method: "POST", headers: { cookie },
  })).status).toBe(201);
  const content = await fetch(`${c.origin}/api/blob-resources/${upload.resourceId}/content`, { headers: { cookie } });
  expect(content.status).toBe(200);
  const etag = content.headers.get("etag");
  await content.text();
  if (!etag) throw new Error("Blob ETag is missing");
  return { ...upload, etag };
}
