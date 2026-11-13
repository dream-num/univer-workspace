import { Readable } from "node:stream";
import { zipSync } from "fflate";
import { interactivePrincipal } from "../fixtures/principal.js";
import { skillEntry } from "@modelcontextprotocol/server/ext/skills";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import type { SkillDraftView } from "../../server/src/modules/skill-drafts/drafts.types.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  for (const application of applications.splice(0)) await application.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const skill = (body = "Use Workspace.") =>
  `---\nname: weekly-report\ndescription: Build weekly reports.\n---\n${body}\n`;
const initialFiles = () => [
  { path: "SKILL.md", text: skill() },
  { path: "references/guide.md", text: "Guide" },
  { path: "assets/note.txt", text: "Note" },
];

async function harness() {
  const directory = mkdtempSync(join(tmpdir(), "workspace-skill-drafts-"));
  directories.push(directory);
  const application = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: join(directory, "product.sqlite"),
      collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
      blobDirectory: join(directory, "objects"),
      secureCookies: false,
      sessionTtlMs: 600000,
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
    username: "skill-author",
    displayName: "Skill author",
    password: "correct horse battery staple",
  });
  const userId = issued.view.user.id;
  const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
  const space = application.spaces.list(userId).spaces[0]!;
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const origin = `http://127.0.0.1:${address.port}`;
  const send = (path: string, body?: unknown, key?: string, session = cookie) =>
    fetch(`${origin}/api/skill-drafts${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: session,
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const body = (files = initialFiles(), replace = false, keep: string[] = []) => ({
    name: "weekly-report",
    spaceId: space.id,
    files,
    replace,
    keep,
    review: [],
  });
  const submit = async (
    input: unknown = body(),
    key = crypto.randomUUID(),
    session = cookie,
  ): Promise<SkillDraftView> => {
    const response = await send("", input, key, session);
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).draft;
  };
  const publish = (draft: SkillDraftView, session = cookie) =>
    send(`/${draft.id}/publish`, {}, undefined, session);
  const db = application.database.connection;
  const files = () =>
    db
      .prepare(
        `SELECT n.id AS nodeId, n.name, r.id AS resourceId, b.object_key AS objectKey, b.etag FROM nodes n JOIN resources r ON r.node_id = n.id JOIN blob_resources b ON b.resource_id = r.id WHERE n.trash_batch_id IS NULL ORDER BY n.name`,
      )
      .all();
  const folders = () =>
    db
      .prepare(
        "SELECT n.id, n.parent_id, n.name FROM nodes n LEFT JOIN resources r ON r.node_id = n.id WHERE r.id IS NULL AND n.trash_batch_id IS NULL ORDER BY n.name",
      )
      .all();
  const delegated = () => {
    db.prepare(
      "INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scopes, created_at) VALUES ('pat', ?, 'Agent', 'hash', 'read write publish', 1)",
    ).run(userId);
    const issued = application.identity.issueSession(
      application.identity.requireSession(cookie).user,
      "agent",
      { issuedFor: { kind: "pat", id: "pat" } },
    );
    return `${application.identity.cookieName}=${issued.cookieValue}`;
  };
  return {
    sourceRead: (body: unknown, session = cookie) => fetch(`${origin}/api/skill-sources/read`, { method: "POST", headers: { cookie: session, "content-type": "application/json" }, body: JSON.stringify(body) }),
    application,
    directory,
    userId,
    cookie,
    space,
    send,
    body,
    submit,
    publish,
    db,
    files,
    folders,
    delegated,
  };
}

describe("Skill draft HTTP and atomic publication", () => {
  it("creates an idempotent author-private draft with evidence, preview and per-file content", async () => {
    const c = await harness();
    const key = crypto.randomUUID();
    const body = {
      ...c.body([{ path: "SKILL.md", text: skill("Run python for this report.") }]),
      review: [
        {
          rule: "requires-shell",
          path: "SKILL.md",
          quote: "Run python",
          impact: "Needs shell",
          suggestion: "Use execute",
        },
        {
          rule: "requires-shell",
          path: "SKILL.md",
          quote: "made up quote",
          impact: "Missing",
          suggestion: "Ignore",
        },
      ],
    };
    const draft = await c.submit(body, key);
    expect(draft).toMatchObject({
      state: "pending",
      kind: "create",
      compatibility: "degraded",
      unverifiedReviewCount: 1,
      source: null,
      base: null,
    });
    expect(draft.review[0]).toMatchObject({ line: 5, severity: "warn" });
    expect(draft.previewPath).toBe(`/drafts/skills/${draft.id}`);
    expect(draft.files[0]).not.toHaveProperty("objectKey");
    const replay = await c.send("", body, key);
    expect(replay.status).toBe(200);
    expect((await replay.json()).draft.id).toBe(draft.id);
    expect(
      (await c.send("", { ...body, files: [{ path: "SKILL.md", text: skill("Changed") }] }, key))
        .status,
    ).toBe(409);
    expect((await c.send("", { ...body, review: [] }, key)).status).toBe(409);
    const content = await c.send(`/${draft.id}/content?path=SKILL.md`);
    expect(await content.text()).toBe(body.files[0]!.text);
    expect(content.headers.get("content-security-policy")).toBe("sandbox");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(content.headers.get("cache-control")).toBe("private, no-store");
    expect(c.files()).toHaveLength(0);
    const other = await c.application.identity.registerWithPassword({
      username: "other",
      displayName: "Other",
      password: "correct horse battery staple",
    });
    const otherCookie = `${c.application.identity.cookieName}=${other.cookieValue}`;
    expect((await c.send(`/${draft.id}`, undefined, undefined, otherCookie)).status).toBe(404);
    expect(
      (await c.send(`/${draft.id}/content?path=SKILL.md`, undefined, undefined, otherCookie))
        .status,
    ).toBe(404);
    expect((await c.publish(draft, otherCookie)).status).toBe(404);
    expect((await c.send(`/${draft.id}/reject`, {}, undefined, otherCookie)).status).toBe(404);
  });
  it("publishes every file into the tree, adopts objects and reuses destination folders", async () => {
    const c = await harness();
    const agents = c.application.nodes.create(c.userId, {
      spaceId: c.space.id,
      parentNodeId: null,
      name: ".agents",
    });
    const skills = c.application.nodes.create(c.userId, {
      spaceId: c.space.id,
      parentNodeId: agents.id,
      name: "skills",
    });
    const draft = await c.submit();
    const stored = readdirSync(join(c.directory, "objects")).sort();
    const response = await c.publish(draft);
    expect(response.status, await response.clone().text()).toBe(200);
    const published = (await response.json()).draft;
    expect(published).toMatchObject({
      state: "published",
      published: { folderNodeId: expect.any(String) },
    });
    expect(c.files()).toHaveLength(3);
    expect(
      c
        .files()
        .map((file) => file.objectKey)
        .sort(),
    ).toEqual(stored);
    expect(c.folders().filter((folder) => folder.name === ".agents")).toEqual([
      expect.objectContaining({ id: agents.id }),
    ]);
    expect(c.folders().filter((folder) => folder.name === "skills")).toEqual([
      expect.objectContaining({ id: skills.id }),
    ]);
    expect(c.db.prepare("SELECT count(*) AS n FROM operations").get()?.n).toBe(0);
    expect((await c.publish(draft)).status).toBe(200);
    expect(c.files()).toHaveLength(3);
    expect((await c.send(`/${draft.id}/content?path=SKILL.md`)).status).toBe(409);
  });
  it("rolls back a forced failure after some files and retries successfully", async () => {
    const c = await harness();
    const draft = await c.submit();
    c.db.exec(
      "CREATE TRIGGER fail_skill_insert BEFORE INSERT ON nodes WHEN NEW.name = 'guide.md' BEGIN SELECT RAISE(ABORT, 'forced publish failure'); END",
    );
    expect((await c.publish(draft)).status).toBe(500);
    expect(c.db.prepare("SELECT count(*) AS n FROM nodes").get()?.n).toBe(0);
    expect(c.db.prepare("SELECT count(*) AS n FROM resources").get()?.n).toBe(0);
    expect(c.db.prepare("SELECT state FROM skill_drafts WHERE id = ?").get(draft.id)?.state).toBe(
      "pending",
    );
    expect(c.db.prepare("SELECT count(*) AS n FROM object_deletion_jobs").get()?.n).toBe(0);
    c.db.exec("DROP TRIGGER fail_skill_insert");
    expect((await c.publish(draft)).status).toBe(200);
    expect(c.files()).toHaveLength(3);
  });
  it("conflicts when create meets a nonempty same-named Skill and writes nothing", async () => {
    const c = await harness();
    expect((await c.publish(await c.submit())).status).toBe(200);
    const before = c.files();
    const draft = await c.submit();
    expect(draft.scan).toContainEqual(
      expect.objectContaining({ rule: "name-conflict", severity: "warn" }),
    );
    expect((await c.publish(draft)).status).toBe(409);
    expect(c.files()).toEqual(before);
    expect(c.application.skillDrafts.get(c.userId, draft.id).state).toBe("conflicted");
    expect(c.db.prepare("SELECT count(*) AS n FROM object_deletion_jobs").get()?.n).toBe(3);
  });
  it.each(["etag", "vanished", "added"])(
    "conflicts on replacement when a base file is %s",
    async (change) => {
      const c = await harness();
      const original = await c.submit();
      expect((await c.publish(original)).status).toBe(200);
      const draft = await c.submit(c.body([{ path: "SKILL.md", text: skill("Revised") }], true));
      const target = c.files().find((file) => file.name === "guide.md")!;
      if (change === "etag")
        c.db
          .prepare("UPDATE blob_resources SET etag = 'changed' WHERE resource_id = ?")
          .run(String(target.resourceId));
      if (change === "vanished")
        c.db.prepare("DELETE FROM nodes WHERE id = ?").run(String(target.nodeId));
      if (change === "added") {
        const parentId = c.db
          .prepare("SELECT parent_id FROM nodes WHERE id = ?")
          .get(String(target.nodeId))!.parent_id;
        c.db
          .prepare("UPDATE nodes SET parent_id = ? WHERE id = ?")
          .run(parentId!, String(c.files().find((file) => file.name === "note.txt")!.nodeId));
        c.db
          .prepare("UPDATE nodes SET name = 'new.txt' WHERE id = ?")
          .run(String(c.files().find((file) => file.name === "note.txt")!.nodeId));
      }
      const before = c.files();
      expect((await c.publish(draft)).status).toBe(409);
      expect(c.files()).toEqual(before);
      expect(c.application.skillDrafts.get(c.userId, draft.id).state).toBe("conflicted");
    },
  );
  it("replaces in place, preserves keep files and moves removed files to Trash", async () => {
    const c = await harness();
    expect((await c.publish(await c.submit())).status).toBe(200);
    const before = c.files();
    const guide = before.find((file) => file.name === "guide.md")!;
    const originalSkill = before.find((file) => file.name === "SKILL.md")!;
    const draft = await c.submit(
      c.body(
        [
          { path: "SKILL.md", text: skill("Changed report") },
          { path: "references/new.md", text: "New guide" },
        ],
        true,
        ["references/guide.md"],
      ),
    );
    expect(draft.removedPaths).toEqual(["assets/note.txt"]);
    expect(draft.base).toHaveLength(3);
    const current = await c.send(`/${draft.id}/content?path=SKILL.md&version=current`);
    expect(await current.text()).toBe(skill());
    expect((await c.publish(draft)).status).toBe(200);
    expect(c.files().find((file) => file.name === "guide.md")).toEqual(guide);
    expect(c.files().find((file) => file.name === "SKILL.md")).toMatchObject({
      resourceId: originalSkill.resourceId,
      nodeId: originalSkill.nodeId,
    });
    expect(c.files().find((file) => file.name === "SKILL.md")!.etag).not.toBe(originalSkill.etag);
    expect(c.files().some((file) => file.name === "note.txt")).toBe(false);
    expect(
      c.db
        .prepare(
          "SELECT n.name, t.created_by FROM nodes n JOIN trash_batches t ON t.id = n.trash_batch_id",
        )
        .all(),
    ).toEqual([expect.objectContaining({ name: "note.txt", created_by: c.userId })]);
    expect(
      c.db
        .prepare("SELECT reason FROM object_deletion_jobs WHERE object_key = ?")
        .get(String(originalSkill.objectKey))?.reason,
    ).toBe("blob_content_replaced");
  });
  it.each([".agents", "skills", "weekly-report", "SKILL.md"])(
    "leaves pending when destination has duplicate %s",
    async (name) => {
      const c = await harness();
      const draft = await c.submit();
      let parentId: string | null = null;
      for (const segment of [".agents", "skills", "weekly-report"]) {
        const folder = c.application.nodes.create(c.userId, {
          spaceId: c.space.id,
          parentNodeId: parentId,
          name: segment,
        });
        if (segment === name)
          c.application.nodes.create(c.userId, {
            spaceId: c.space.id,
            parentNodeId: parentId,
            name: segment,
          });
        parentId = folder.id;
      }
      if (name === "SKILL.md") {
        // Duplicate file identities matter independently of extension or content.
        for (let i = 0; i < 2; i++) {
          const node = c.application.nodes.create(c.userId, {
            spaceId: c.space.id,
            parentNodeId: parentId,
            name,
          });
          c.db
            .prepare(
              "INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES (?, ?, 'blob', 1, 1)",
            )
            .run(`resource${i}`, node.id);
          c.db
            .prepare(
              "INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at) VALUES (?, ?, 'SKILL.md', 'text/plain', 0, ?, 'e', 'ready', 1, 1)",
            )
            .run(`resource${i}`, `object${i}`, "a".repeat(64));
        }
      }
      const before = c.files();
      expect((await c.publish(draft)).status).toBe(409);
      expect(c.application.skillDrafts.get(c.userId, draft.id).state).toBe("pending");
      expect(c.files()).toEqual(before);
    },
  );
  it("allows delegated create/read but only the author's interactive session can decide", async () => {
    const c = await harness();
    const delegated = c.delegated();
    const draft = await c.submit(c.body(), crypto.randomUUID(), delegated);
    expect((await c.send(`/${draft.id}`, undefined, undefined, delegated)).status).toBe(200);
    expect((await c.publish(draft, delegated)).status).toBe(403);
    expect((await c.send(`/${draft.id}/reject`, {}, undefined, delegated)).status).toBe(403);
    expect((await c.send(`/${draft.id}/reject`, {})).status).toBe(200);
    expect((await c.send(`/${draft.id}/reject`, {})).status).toBe(200);
    expect(c.db.prepare("SELECT count(*) AS n FROM object_deletion_jobs").get()?.n).toBe(3);
    expect((await c.publish(await c.submit())).status).toBe(200);
  });
  it("expires pending and receiving drafts and enqueues every file object", async () => {
    const c = await harness();
    const pending = await c.submit();
    const receiving = await c.submit();
    c.db.prepare("UPDATE skill_drafts SET expires_at = 1 WHERE id = ?").run(pending.id);
    c.db
      .prepare("UPDATE skill_drafts SET state = 'receiving', expires_at = 1 WHERE id = ?")
      .run(receiving.id);
    expect((await c.send(`/${receiving.id}`)).status).toBe(404);
    expect(c.application.skillDrafts.expireDue(Date.now(), 25)).toBe(2);
    expect(c.db.prepare("SELECT state FROM skill_drafts").all()).toEqual([
      { state: "expired" },
      { state: "expired" },
    ]);
    expect(c.db.prepare("SELECT count(*) AS n FROM object_deletion_jobs").get()?.n).toBe(6);
    expect(c.application.skillDrafts.expireDue(Date.now(), 25)).toBe(0);
    expect((await c.publish(pending)).status).toBe(409);
  });
  it("blocks unsafe content at publish, enforces byte limits and rejects invalid evidence", async () => {
    const c = await harness();
    const draft = await c.submit(c.body([{ path: "SKILL.md", text: "bad frontmatter" }]));
    expect(draft.compatibility).toBe("blocked");
    expect((await c.publish(draft)).status).toBe(409);
    expect(c.application.skillDrafts.get(c.userId, draft.id).state).toBe("pending");
    expect(c.files()).toHaveLength(0);
    expect(
      (
        await c.send(
          "",
          c.body([{ path: "SKILL.md", text: "中".repeat(22000) }]),
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await c.send(
          "",
          c.body(Array.from({ length: 101 }, (_, i) => ({ path: `${i}.txt`, text: "" }))),
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(413);
    const oversizedReview = {
      rule: "requires-shell",
      path: "SKILL.md",
      quote: "a".repeat(201),
      impact: "Impact",
      suggestion: "Suggestion",
    };
    expect(
      (await c.send("", { ...c.body(), review: [oversizedReview] }, crypto.randomUUID())).status,
    ).toBe(400);
    expect(
      (await c.send("", c.body([{ path: "SKILL.md", text: "\u0000" }]), crypto.randomUUID()))
        .status,
    ).toBe(400);
    expect((await c.send(`/${draft.id}/content?path=../secret`)).status).toBe(400);
  });
});

async function uploadSource(c: Awaited<ReturnType<typeof harness>>, name: string, bytes: Uint8Array, parentNodeId: string | null = null) {
  const actor = interactivePrincipal(c.userId);
  const reserved = c.application.blobs.createUpload(actor, crypto.randomUUID(), {
    spaceId: c.space.id, parentNodeId, name, originalFilename: name, byteSize: bytes.byteLength,
  });
  await c.application.blobs.upload(c.userId, reserved.body.upload.id, String(bytes.byteLength), Readable.from([bytes]));
  await c.application.blobs.complete(actor, reserved.body.upload.id);
  return reserved.body.upload;
}

describe("Skill source HTTP and draft imports", () => {
  it("lists, scans and imports a Space zip with binary bytes, text overrides, deletions and provenance", async () => {
    const c = await harness();
    const original = skill("Read [guide](references/guide.md).\n");
    const binary = new Uint8Array([0, 255, 128, 50]);
    const zip = zipSync({
      "weekly-report/SKILL.md": Buffer.from(original),
      "weekly-report/scripts/run.py": Buffer.from("print('hello')"),
      "weekly-report/references/guide.md": Buffer.from("original guide"),
      "weekly-report/assets/sample.png": binary,
    });
    const uploaded = await uploadSource(c, "source.zip", zip);
    expect((await c.sourceRead({ source: uploaded.nodeId }, "")).status).toBe(401);
    const listing = await c.sourceRead({ source: uploaded.nodeId });
    expect(listing.status, await listing.clone().text()).toBe(200);
    const { source, candidates } = await listing.json();
    expect(candidates).toEqual([{ name: "weekly-report", description: "Build weekly reports.", path: "weekly-report", fileCount: 4, problems: [] }]);
    expect(listing.headers.get("cache-control")).toBe("private, no-store");
    const scanned = await c.sourceRead({ source, skill: "weekly-report" });
    expect((await scanned.json()).scan).toContainEqual(expect.objectContaining({ rule: "script-file", path: "scripts/run.py" }));
    const body = { name: "weekly-report", spaceId: c.space.id, from: { source, skill: "weekly-report", overrides: [
      { path: "references/guide.md", text: "adapted guide" }, { path: "scripts/run.py", text: null },
    ] }, review: [] };
    const key = crypto.randomUUID();
    const draft = await c.submit(body, key);
    expect(draft.source).toEqual(source);
    expect(draft.files.find((f) => f.path === "assets/sample.png")).toMatchObject({ kind: "binary", byteSize: 4 });
    expect(draft.files.some((f) => f.path === "scripts/run.py")).toBe(false);
    const content = await c.send(`/${draft.id}/content?path=SKILL.md`);
    const stamped = await content.text();
    expect(stamped.slice(stamped.indexOf("\n---\n") + 5)).toBe(original.slice(original.indexOf("\n---\n") + 5));
    const parsed = await skillEntry("weekly-report", { "SKILL.md": stamped });
    expect(parsed.frontmatter.metadata).toMatchObject({ source: "source.zip", "source-hub": "space", "imported-at": new Date().toISOString().slice(0, 10) });
    expect(await (await c.send(`/${draft.id}/content?path=references/guide.md`)).text()).toBe("adapted guide");
    expect(new Uint8Array(await (await c.send(`/${draft.id}/content?path=assets/sample.png`)).arrayBuffer())).toEqual(binary);
    expect((await c.send("", { ...body, files: initialFiles() }, crypto.randomUUID())).status).toBe(400);
    expect((await c.send("", { ...body, from: { ...body.from, overrides: [{ path: "../bad", text: "bad" }] } }, crypto.randomUUID())).status).toBe(400);
    expect((await c.send("", { ...body, from: { ...body.from, overrides: [{ path: "SKILL.md", text: null }] } }, crypto.randomUUID())).status).toBe(400);
    const actor = interactivePrincipal(c.userId);
    const resource = c.application.access.resolveResource(c.userId, uploaded.resourceId);
    if (!resource || resource.kind !== "blob") throw new Error("Missing source blob");
    await c.application.blobs.replace(actor, resource.id, crypto.randomUUID(), `"${resource.etag}"`, "7", Readable.from([Buffer.from("changed")]));
    expect((await c.sourceRead({ source })).status).toBe(409);
    expect((await c.send("", body, crypto.randomUUID())).status).toBe(409);
    const replay = await c.send("", body, key);
    expect(replay.status).toBe(200);
    expect((await replay.json()).draft.id).toBe(draft.id);
    expect((await c.publish(draft)).status).toBe(200);
    const adopted = c.application.database.connection.prepare("SELECT b.sha256 FROM blob_resources b JOIN resources r ON r.id=b.resource_id JOIN nodes n ON n.id=r.node_id WHERE n.name='sample.png'").get();
    expect(adopted?.sha256).toBe(draft.files.find((f) => f.path === "assets/sample.png")!.sha256);
  });
  it("pins a folder manifest and pages text with source-bound cursors", async () => {
    const c = await harness();
    const folder = c.application.nodes.create(c.userId, { spaceId: c.space.id, name: "source-folder", parentNodeId: null });
    await uploadSource(c, "SKILL.md", Buffer.from(skill()), folder.id);
    const text = "😀\"\n".repeat(24000);
    await uploadSource(c, "guide.txt", Buffer.from(text), folder.id);
    const listing = await c.sourceRead({ source: folder.id });
    expect(listing.status, await listing.clone().text()).toBe(200);
    const { source } = await listing.json();
    const page = await (await c.sourceRead({ source, skill: ".", path: "guide.txt" })).json();
    expect(page.truncated).toBe(true);
    expect(JSON.stringify(page).length).toBeLessThan(100000);
    let joined = page.content;
    let cursor: string | undefined = page.cursor;
    while (cursor) {
      const next = await (await c.sourceRead({ source, skill: ".", path: "guide.txt", cursor })).json();
      joined += next.content;
      cursor = next.cursor;
    }
    expect(joined).toBe(text);
    expect((await c.sourceRead({ source, skill: ".", path: "SKILL.md", cursor: page.cursor })).status).toBe(400);
    await uploadSource(c, "extra.md", Buffer.from("new"), folder.id);
    expect((await c.sourceRead({ source, skill: "." })).status).toBe(409);
    const outsider = await c.application.identity.registerWithPassword({ username: "source-outsider", displayName: "Other", password: "correct horse battery staple" });
    expect((await c.sourceRead({ source: folder.id }, `${c.application.identity.cookieName}=${outsider.cookieValue}`)).status).toBe(404);
  });
});
