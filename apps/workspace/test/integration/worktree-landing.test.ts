import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import type { UniverCollabService } from "@univerjs-pro/collaboration-service";
import { UniverType } from "@univerjs/protocol";
import { Client } from "pg";
import { afterEach, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createBlobStore } from "../../server/src/integrations/blob/create-blob-store.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { collaborationCallOptions, createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";
import { createWorktreeBackend } from "../../server/src/integrations/univer/worktree-store.js";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const cleanups: AsyncDisposableStack[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup.disposeAsync();
});

const CHECKS_MD = "# Checks\n\n## totals-match\nB5 equals SUM(B2:B4).\n\n## header-unchanged\nRow 1 matches Trunk.\n";

it("lets an agent that does not own a checks repository merge only once every declared check passed on the current content", async () => {
  const f = await repository();
  const { worktrees, spaces } = f.application;
  expect((await spaces.get(f.owner.id, f.team)).landing).toBe("review");
  const early = await f.readyPull(f.bot.id);
  expect(await f.merge(f.bot.id, early), "a review repository lets an editor agent merge as before").toMatchObject({ worktree: { state: "merged" } });

  await expect(spaces.update(f.owner.id, f.team, { landing: "strict" })).rejects.toMatchObject({ code: "INVALID_INPUT", field: "landing" });
  const personal = (await spaces.list(f.owner.id)).spaces.find((space) => space.type === "personal")!;
  await expect(spaces.update(f.owner.id, personal.id, { landing: "checks" })).rejects.toMatchObject({ message: "Only a Team Space can require checks." });
  expect((await spaces.update(f.owner.id, f.team, { landing: "checks" })).landing).toBe("checks");

  const pull = await f.readyPull(f.bot.id);
  const mergeable = async (userId: string) => (await worktrees.get(userId, pull)).worktree.capabilities.merge;
  expect([await mergeable(f.bot.id), await mergeable(f.owner.id)]).toEqual([false, true]);
  const listed = await worktrees.list(f.bot.id, { scope: "active", kind: "team", teamSpaceId: f.team, cursor: undefined, limit: undefined });
  expect(listed.items.find((item) => item.id === pull)?.capabilities.merge).toBe(false);

  const refused = await fetch(`${f.origin}/api/worktrees/${pull}/merge`, {
    method: "POST", headers: { cookie: f.bot.cookie, "idempotency-key": randomUUID() },
  });
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: unknown }).error).toMatchObject({
    code: "CHECKS_REQUIRED",
    message: expect.stringContaining("Not passed on the current content: totals-match (missing), header-unchanged (missing)."),
  });
  expect((await f.application.access.budget(f.bot.id)).merges.used, "a refused merge takes no place in the budget").toBe(1);

  await f.report(f.reader.id, pull, "totals-match", "passed");
  await f.report(f.reader.id, pull, "header-unchanged", "passed");
  await expect(f.merge(f.bot.id, pull), "a viewer's results do not count").rejects.toMatchObject({
    code: "CHECKS_REQUIRED", message: expect.stringContaining("totals-match (missing), header-unchanged (missing)"),
  });
  await f.report(f.bot.id, pull, "totals-match", "passed");
  await f.report(f.bot.id, pull, "header-unchanged", "failed");
  await expect(f.merge(f.bot.id, pull)).rejects.toMatchObject({ message: expect.stringContaining("content: header-unchanged (failed).") });
  await f.report(f.bot.id, pull, "header-unchanged", "passed");
  expect(await mergeable(f.bot.id)).toBe(true);

  await f.commitToTrunk(f.owner.id, f.sheet.unitId);
  expect(await mergeable(f.bot.id), "a Trunk move leaves every result out of date").toBe(false);
  await expect(f.merge(f.bot.id, pull)).rejects.toMatchObject({ message: expect.stringContaining("totals-match (missing), header-unchanged (missing)") });
  await f.reportAll(f.bot.id, pull);
  expect(await f.merge(f.bot.id, pull)).toMatchObject({ worktree: { state: "merged" } });
  expect((await f.application.access.budget(f.bot.id)).merges.used).toBe(2);

  const edited = await f.readyPull(f.bot.id);
  await f.reportAll(f.bot.id, edited);
  await worktrees.reopen(f.bot.id, edited);
  const unit = (await worktrees.get(f.bot.id, edited)).worktree.units[0]!;
  await worktrees.submitChangeset(f.bot.id, edited, unit.unitId, {
    changeset: {
      unitID: unit.unitId, type: UniverType.UNIVER_SHEET, baseRev: unit.draftHeadRevision, revision: unit.draftHeadRevision + 1,
      sid: randomUUID(), reqId: 1, userID: "", memberID: "", createTime: 1, mutations: [],
    },
  });
  await worktrees.markReady(f.bot.id, edited);
  await expect(f.merge(f.bot.id, edited), "a later draft edit leaves every result out of date").rejects.toMatchObject({
    code: "CHECKS_REQUIRED", message: expect.stringContaining("totals-match (missing), header-unchanged (missing)"),
  });

  const human = await f.readyPull(f.alice.id);
  expect(await f.merge(f.alice.id, human), "a person merges without any result").toMatchObject({ worktree: { state: "merged" } });
}, 120_000);

it("refuses an agent's merge while Trunk's declaration cannot be used, and still lets a person merge", async () => {
  const f = await repository("checks");
  const { nodes, trash } = f.application;
  const pull = await f.readyPull(f.bot.id);
  await f.reportAll(f.bot.id, pull);
  const mergeable = async () => (await f.application.worktrees.get(f.bot.id, pull)).worktree.capabilities.merge;
  expect(await mergeable()).toBe(true);
  const refusesWith = async (problem: string) => {
    expect(await mergeable()).toBe(false);
    await expect(f.merge(f.bot.id, pull)).rejects.toMatchObject({
      code: "CHECKS_REQUIRED", status: 403,
      message: `This repository requires checks before an agent merges, and its declaration cannot be used: ${problem} A person can merge this pull request, or fix .agents/checks.md on Trunk.`,
    });
  };
  const owner = await f.principal(f.owner);

  await nodes.update(owner, f.declaration.nodeId, { name: "checks.txt" });
  await refusesWith("Trunk has no .agents/checks.md.");
  await nodes.update(owner, f.declaration.nodeId, { name: "checks.md" });

  const second = await f.upload(f.owner, f.folder, "checks.md", CHECKS_MD);
  await refusesWith("Trunk has more than one .agents/checks.md.");
  await trash.trashNode(f.owner.id, second.nodeId);
  expect(await mergeable(), "a declaration in Trash is not read").toBe(true);

  const folder = await nodes.create(f.owner.id, { spaceId: f.team, parentNodeId: null, name: ".agents" });
  await refusesWith("Trunk has more than one folder named .agents.");
  await trash.trashNode(f.owner.id, folder.id);

  const trashed = await trash.trashNode(f.owner.id, f.declaration.nodeId);
  await refusesWith("Trunk has no .agents/checks.md.");
  await trash.restore(f.owner.id, trashed.id);
  expect(await mergeable()).toBe(true);

  await f.sql("UPDATE blob_resources SET availability = 'quarantined' WHERE resource_id = ?", f.declaration.resourceId);
  await refusesWith(".agents/checks.md on Trunk is not ready to read.");
  await f.sql("UPDATE blob_resources SET availability = 'ready' WHERE resource_id = ?", f.declaration.resourceId);

  const objectKey = await f.objectKey(f.declaration.resourceId);
  f.unreadable.add(objectKey);
  await refusesWith(".agents/checks.md on Trunk cannot be read.");
  f.unreadable.delete(objectKey);

  const contents: [string, string][] = [
    ["", ".agents/checks.md on Trunk is empty."],
    [`## totals-match\n${"x".repeat(64 * 1024)}`, ".agents/checks.md on Trunk is larger than 64 KiB."],
    ["## totals-match\n## Totals\n", '.agents/checks.md has a heading that is not a check name: "## Totals". Name a check with lowercase letters, digits and hyphens after "## " at the start of a line, or use a level-3 heading for text.'],
    [Array.from({ length: 21 }, (_, index) => `## check-${index}\n`).join(""), ".agents/checks.md declares 21 checks; at most 20 are allowed."],
    ["## totals-match\n```\n## header-unchanged\n", ".agents/checks.md has a code fence that is never closed."],
    ["# Checks\nNothing to run yet.\n", ".agents/checks.md declares no checks."],
  ];
  for (const [text, problem] of contents) {
    await f.replace(f.owner, f.declaration.resourceId, text);
    await refusesWith(problem);
  }
  const human = await f.readyPull(f.alice.id, f.otherSheet.id);
  expect(await f.merge(f.alice.id, human), "a person merges while the declaration is broken").toMatchObject({ worktree: { state: "merged" } });

  await f.replace(f.owner, f.declaration.resourceId, CHECKS_MD);
  expect(await f.merge(f.bot.id, pull)).toMatchObject({ worktree: { state: "merged" } });
}, 120_000);

it("decides again just before Trunk moves, leaves a late refusal out of the budget, and merges when retried after new results", async () => {
  const f = await repository("checks");
  const pull = await f.readyPull(f.bot.id);
  await f.reportAll(f.bot.id, pull);
  const key = randomUUID();
  // The first read is the early gate's. Trunk moves before the second, which the reserved merge makes.
  f.beforeSecondRead(() => f.commitToTrunk(f.owner.id, f.sheet.unitId));
  await expect(f.application.worktrees.merge(f.bot.id, pull, key)).rejects.toMatchObject({
    code: "CHECKS_REQUIRED", message: expect.stringContaining("totals-match (missing), header-unchanged (missing)"),
  });
  expect(await f.application.operations.get(f.bot.id, key)).toMatchObject({ state: "failed", error: { code: "CHECKS_REQUIRED" } });
  expect((await f.application.access.budget(f.bot.id)).merges.used).toBe(0);
  await expect(f.application.operations.retry(f.bot.id, key), "a retry meets the gate again").rejects.toMatchObject({ code: "CHECKS_REQUIRED" });

  await f.reportAll(f.bot.id, pull);
  expect(await f.application.operations.retry(f.bot.id, key)).toMatchObject({ state: "completed" });
  expect((await f.application.worktrees.get(f.bot.id, pull)).worktree.state).toBe("merged");
  expect((await f.application.access.budget(f.bot.id)).merges.used).toBe(1);
}, 120_000);

it("refuses to retry a merge whose pages changed after it began, even with checks passed on the new pages", async () => {
  const f = await repository("checks");
  const { worktrees, htmlViewDrafts, operations } = f.application;
  const pull = await f.readyPull(f.bot.id);
  await f.reportAll(f.bot.id, pull);
  const key = randomUUID();
  f.beforeSecondRead(() => f.commitToTrunk(f.owner.id, f.sheet.unitId));
  await expect(worktrees.merge(f.bot.id, pull, key)).rejects.toMatchObject({ code: "CHECKS_REQUIRED" });

  await worktrees.reopen(f.bot.id, pull);
  await htmlViewDrafts.submit(f.bot.id, randomUUID(), {
    kind: "create", name: "Totals", spaceId: f.team, parentNodeId: null, sourceWorktreeId: pull,
    html: "<!doctype html><html><body><h1>Totals</h1></body></html>",
  });
  await worktrees.markReady(f.bot.id, pull);
  await f.reportAll(f.bot.id, pull);
  const trunkBefore = await f.trunkHead(f.sheet.unitId, f.owner.id);
  await expect(operations.retry(f.bot.id, key), "the merge began with no page").rejects.toMatchObject({
    code: "CHECKS_REQUIRED", message: expect.stringContaining("changed while its merge waited"),
  });
  expect((await worktrees.get(f.bot.id, pull)).worktree.state).toBe("ready");
  expect(await f.trunkHead(f.sheet.unitId, f.owner.id)).toBe(trunkBefore);
  expect(await f.merge(f.bot.id, pull), "a new merge takes the page").toMatchObject({ worktree: { state: "merged" } });
}, 120_000);

it("records on the merge the content its last check decided on", async () => {
  const f = await repository("checks");
  const { worktrees } = f.application;
  const moved = await f.readyPull(f.bot.id);
  await f.reportAll(f.bot.id, moved);
  f.beforeSecondRead(async () => {
    await f.commitToTrunk(f.owner.id, f.sheet.unitId);
    await f.reportAll(f.alice.id, moved);
  });
  expect(await f.merge(f.bot.id, moved)).toMatchObject({ worktree: { state: "merged" } });
  const current = (await worktrees.checks(f.owner.id, moved)).checks
    .map((check) => check.results.filter((result) => result.current).map((result) => result.reporter.id));
  expect(current, "only results on the content the second check read stay current").toEqual([[f.alice.id], [f.alice.id]]);
}, 120_000);

it("lands only the content the last check decided on, whatever the agent does after it", async () => {
  const f = await repository("checks");
  const { worktrees } = f.application;
  const held = await f.readyPull(f.bot.id, f.sheet.id, f.team, true);
  await f.reportAll(f.bot.id, held);
  f.beforeSdkMerge(async () => {
    await expect(worktrees.reopen(f.bot.id, held), "a running merge holds the pull request in ready").rejects.toMatchObject({
      code: "CONFLICT", status: 409, message: "This pull request is being merged. View it again once the merge finishes.",
    });
  });
  expect(await f.merge(f.bot.id, held)).toMatchObject({ worktree: { state: "merged" } });

  const slipped = await f.readyPull(f.bot.id, f.otherSheet.id, f.team, true);
  await f.reportAll(f.bot.id, slipped);
  const trunkBefore = await f.trunkHead(f.otherSheet.unitId, f.owner.id);
  f.beforeSdkMerge(async () => {
    // Requests that passed the product's own checks before this merge began reach the Collaboration Service late.
    await f.sdk.reopen(slipped, f.bot.id);
    await f.editDraft(f.bot.id, slipped);
    await f.sdk.markReady(slipped, f.bot.id);
  });
  await expect(f.merge(f.bot.id, slipped)).rejects.toMatchObject({
    code: "CONFLICT", message: expect.stringContaining("changed after its checks were decided, so nothing was merged"),
  });
  expect(await f.trunkHead(f.otherSheet.unitId, f.owner.id), "Trunk keeps what it had").toBe(trunkBefore);
  expect((await worktrees.get(f.bot.id, slipped)).worktree).toMatchObject({ state: "ready", capabilities: { merge: false } });
}, 120_000);

it("lets only a person or the agent that owns the repository merge a pull request that changes .agents/", async () => {
  const f = await repository("checks");
  const { worktrees, htmlViewDrafts, forks, permissions, spaces, nodes, resources } = f.application;
  const rules = await f.sheetNamed("Rules", f.folder);
  const html = "<!doctype html><html><body><h1>Rules</h1></body></html>";
  const changes: [string, () => Promise<string>][] = [
    ["change a file in .agents/", () => f.readyPull(f.bot.id, rules.id, f.team, true)],
    ["add a file to .agents/", async () => {
      const pull = await f.openPull(f.bot.id);
      await worktrees.addUnit(f.bot.id, pull, randomUUID(), {
        source: "worktree", name: "More rules", unitType: "sheet", targetSpaceId: f.team, targetParentNodeId: f.folder,
      });
      await worktrees.markReady(f.bot.id, pull);
      return pull;
    }],
    ["add a page to .agents/", async () => {
      const pull = await f.openPull(f.bot.id);
      await htmlViewDrafts.submit(f.bot.id, randomUUID(), {
        kind: "create", name: "Rules page", spaceId: f.team, parentNodeId: f.folder, html, sourceWorktreeId: pull,
      });
      await worktrees.markReady(f.bot.id, pull);
      return pull;
    }],
    ["replace .agents/checks.md", async () => {
      const { body: fork } = await forks.create(f.bot.id, { upstreamSpaceId: f.team, name: "rules" });
      const declaration = await f.application.access.resolveResource(f.owner.id, f.declaration.resourceId);
      if (declaration?.kind !== "blob") throw new Error("Blob missing");
      const bytes = Buffer.from(`${CHECKS_MD}\nRevised by an agent.\n`);
      const { body } = await forks.replaceBlob(await f.principal(f.bot), fork.id, f.declaration.resourceId, randomUUID(), {
        ifMatch: `"${declaration.etag}"`, contentLength: String(bytes.length),
      }, Readable.from([bytes]));
      await worktrees.markReady(f.bot.id, body.worktree.id);
      return body.worktree.id;
    }],
  ];
  for (const [change, open] of changes) {
    const pull = await open();
    await f.reportAll(f.bot.id, pull);
    expect((await worktrees.get(f.bot.id, pull)).worktree.capabilities.merge, change).toBe(false);
    await expect(f.merge(f.bot.id, pull), change).rejects.toMatchObject({
      code: "CHECKS_REQUIRED", status: 403, message: expect.stringContaining("This pull request changes .agents/."),
    });
    expect(await f.merge(f.alice.id, pull), `a person can ${change}`).toMatchObject({ worktree: { state: "merged" } });
  }
  const children = await nodes.listChildren(f.owner.id, f.folder, { cursor: undefined, limit: undefined });
  expect(children.nodes.map((node) => node.name).sort(), "every change landed through a person").toEqual(["More rules", "Rules", "Rules page.univer.html", "checks.md"]);

  // Only an admin proposes removing a file, and an agent is an admin only where an agent owns the repository.
  const lead = await f.agent(f.owner, "lead");
  const { id: crew } = await spaces.createTeamSpace(lead.id, { name: "Crew" });
  await spaces.update(lead.id, crew, { landing: "checks" });
  await permissions.upsertTeamMember(lead.id, crew, f.bot.id, { role: "admin" });
  const crewFolder = (await nodes.create(lead.id, { spaceId: crew, parentNodeId: null, name: ".agents" })).id;
  const created = await resources.create(lead.id, randomUUID(), { kind: "univer", spaceId: crew, parentNodeId: crewFolder, name: "Rules", unitType: "sheet" });
  if (created.status === 202 || !created.body.node.resource) throw new Error("Sheet missing");
  const removal = await f.openPull(f.bot.id, crew);
  const { body } = await worktrees.addUnit(f.bot.id, removal, randomUUID(), { source: "trunk", resourceId: created.body.node.resource.id });
  await worktrees.setUnitRemoved(f.bot.id, removal, body.unit.unitId, { removed: true });
  await worktrees.markReady(f.bot.id, removal);
  await expect(f.merge(f.bot.id, removal), "remove a file from .agents/").rejects.toMatchObject({
    code: "CHECKS_REQUIRED", message: expect.stringContaining("This pull request changes .agents/."),
  });
  expect(await f.merge(lead.id, removal), "the agent that owns the repository can").toMatchObject({ worktree: { state: "merged" } });
  expect((await nodes.listChildren(lead.id, crewFolder, { cursor: undefined, limit: undefined })).nodes).toEqual([]);
}, 120_000);

it("opens Trunk files read-only for an agent that lands by checks, as Trunk refuses its edits", async () => {
  const f = await repository();
  const { resources, worktrees, spaces } = f.application;
  const editorMode = async (userId: string) => (await resources.open(userId, f.sheet.id)).resource;
  expect(await editorMode(f.bot.id)).toMatchObject({ editorMode: "edit" });
  await spaces.update(f.owner.id, f.team, { landing: "checks" });
  expect(await editorMode(f.bot.id)).toMatchObject({ editorMode: "readOnly" });
  expect(await editorMode(f.alice.id), "a person is not gated").toMatchObject({ editorMode: "edit" });
  const pull = await f.openPull(f.bot.id);
  const { body } = await worktrees.addUnit(f.bot.id, pull, randomUUID(), { source: "trunk", resourceId: f.sheet.id });
  expect((await worktrees.openUnit(f.bot.id, pull, body.unit.unitId, { mode: "trunk" })).unit.editorMode).toBe("readOnly");
  expect((await worktrees.openUnit(f.bot.id, pull, body.unit.unitId, { mode: "draft" })).unit.editorMode, "its own draft stays editable").toBe("edit");
}, 120_000);

it("keeps such an agent from changing Trunk's files outside a merge, its check declaration included", async () => {
  const f = await repository();
  const { nodes, blobs, resources, trash, htmlViewDrafts, skillDrafts, access } = f.application;
  const bot = await f.principal(f.bot);
  const notes = Buffer.from("notes");
  const { body: started } = await blobs.createUpload(bot, randomUUID(), {
    spaceId: f.team, parentNodeId: null, name: "notes.md", originalFilename: "notes.md", byteSize: notes.length,
  });
  await blobs.upload(f.bot.id, started.upload.id, String(notes.length), Readable.from([notes]));
  const old = await f.upload(f.owner, null, "old.md", "old");
  const removed = await trash.trashNode(f.owner.id, old.nodeId);
  await f.application.spaces.update(f.owner.id, f.team, { landing: "checks" });

  expect((await access.resolveResourceContent(f.bot.id, f.sheet.id))?.landsByChecks).toBe(true);
  expect((await access.resolveResourceContent(f.alice.id, f.sheet.id))?.landsByChecks).toBe(false);
  const refused = { code: "AGENT_NOT_ALLOWED", status: 403 };
  const writes: [string, () => Promise<unknown>][] = [
    ["finish an upload started before", () => blobs.complete(bot, started.upload.id)],
    ["create a second .agents folder", () => nodes.create(f.bot.id, { spaceId: f.team, parentNodeId: null, name: ".agents" })],
    ["create a folder in .agents", () => nodes.create(f.bot.id, { spaceId: f.team, parentNodeId: f.folder, name: "more" })],
    ["create a Unit", () => resources.create(f.bot.id, randomUUID(), { kind: "univer", spaceId: f.team, parentNodeId: null, name: "South", unitType: "sheet" })],
    ["upload a second checks.md", () => blobs.createUpload(bot, randomUUID(), {
      spaceId: f.team, parentNodeId: f.folder, name: "checks.md", originalFilename: "checks.md", byteSize: 3,
    })],
    ["rename checks.md", () => nodes.update(bot, f.declaration.nodeId, { name: "checks.txt" })],
    ["rename .agents", () => nodes.update(bot, f.folder, { name: "agents" })],
    ["move checks.md", () => nodes.update(bot, f.declaration.nodeId, { parentNodeId: null })],
    ["move a file into .agents", async () => nodes.update(bot, (await access.resolveResource(f.owner.id, f.sheet.id))!.node.id, { parentNodeId: f.folder })],
    ["replace checks.md", () => f.replace(f.bot, f.declaration.resourceId, "## anything\n")],
    ["trash checks.md", () => trash.trashNode(f.bot.id, f.declaration.nodeId)],
    ["trash .agents", () => trash.trashNode(f.bot.id, f.folder)],
    ["restore from Trash", () => trash.restore(f.bot.id, removed.id)],
    ["remove from Trash", () => trash.removePermanently(f.bot.id, removed.id)],
    ["publish a page", async () => {
      const { draft } = await htmlViewDrafts.submit(f.bot.id, randomUUID(), {
        kind: "create", name: "Weekly", spaceId: f.team, html: "<!doctype html><html><body><h1>Report</h1></body></html>",
      });
      return htmlViewDrafts.publish(f.bot.id, draft.id);
    }],
    ["publish a Skill", async () => {
      const { draft } = await skillDrafts.submit(f.bot.id, randomUUID(), {
        name: "weekly-report", spaceId: f.team, replace: false, keep: [], review: [],
        files: [{ path: "SKILL.md", text: "---\nname: weekly-report\ndescription: Build weekly reports.\n---\nUse Workspace." }],
      });
      return skillDrafts.publish(f.bot.id, draft.id);
    }],
  ];
  for (const [write, run] of writes) await expect(run(), write).rejects.toMatchObject(refused);

  const children = await nodes.listChildren(f.owner.id, f.folder, {});
  expect(children.nodes.map((node) => [node.id, node.name])).toEqual([[f.declaration.nodeId, "checks.md"]]);
  expect(await f.objectKey(f.declaration.resourceId)).toBe(f.declaration.objectKey);
  const alice = await f.principal(f.alice);
  await nodes.update(alice, f.declaration.nodeId, { name: "checks.md" });
  expect((await nodes.create(f.alice.id, { spaceId: f.team, parentNodeId: null, name: "Drafts" })).name, "a person is not gated").toBe("Drafts");
}, 120_000);

it("does not gate the agent that owns a checks repository, and gates an agent admin there", async () => {
  const f = await repository();
  const owner = await f.agent(f.owner, "builder");
  const admin = await f.agent(f.owner, "helper");
  const { id: space } = await f.application.spaces.createTeamSpace(owner.id, { name: "Bots" });
  await f.application.permissions.upsertTeamMember(owner.id, space, admin.id, { role: "admin" });
  await expect(f.application.spaces.update(admin.id, space, { landing: "checks" })).rejects.toMatchObject({ code: "AGENT_NOT_ALLOWED" });
  expect((await f.application.spaces.update(owner.id, space, { landing: "checks" })).landing).toBe("checks");
  const created = await f.application.resources.create(owner.id, randomUUID(), {
    kind: "univer", spaceId: space, parentNodeId: null, name: "Totals", unitType: "sheet",
  });
  if (created.status === 202 || !created.body.node.resource) throw new Error("Sheet missing");
  await expect(f.application.resources.create(admin.id, randomUUID(), {
    kind: "univer", spaceId: space, parentNodeId: null, name: "Other", unitType: "sheet",
  })).rejects.toMatchObject({ code: "AGENT_NOT_ALLOWED" });
  const resourceId = created.body.node.resource.id;

  const byAdmin = await f.readyPull(admin.id, resourceId, space);
  await expect(f.merge(admin.id, byAdmin)).rejects.toMatchObject({
    code: "CHECKS_REQUIRED", message: expect.stringContaining("cannot be used: Trunk has no .agents/checks.md."),
  });
  const byOwner = await f.readyPull(owner.id, resourceId, space);
  expect(await f.merge(owner.id, byOwner)).toMatchObject({ worktree: { state: "merged" } });
}, 120_000);

interface Actor {
  readonly id: string;
  readonly cookie: string;
}

/**
 * A Team Space with a sheet and Trunk's `.agents/checks.md`, its owner and a person editor, an editor agent and a
 * viewer agent, both claimed by the owner.
 */
async function repository(landing: "review" | "checks" = "review") {
  const { application, origin, trunk, trunkHead, unreadable, beforeSecondRead, beforeSdkMerge, sdk, sql } = await start();
  const person = async (username: string): Promise<Actor> => {
    const issued = await application.identity.registerWithPassword({ username, displayName: username, password: "correct horse battery staple" });
    return { id: issued.view.user.id, cookie: `${application.identity.cookieName}=${issued.cookieValue}` };
  };
  const send = (path: string, cookie: string, body?: unknown) => fetch(`${origin}${path}`, {
    method: "POST",
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const agent = async (claimer: Actor, label: string): Promise<Actor> => {
    const { user } = await application.identity.createAgent({ label, originIp: undefined });
    const issued = await application.identity.issueSession(user, "agent");
    const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
    const { code } = (await (await send("/api/agents/claim-codes", cookie)).json()) as { code: string };
    const claimed = await send("/api/agents/claim", claimer.cookie, { code });
    if (claimed.status !== 200) throw new Error(`Claim answered ${claimed.status}: ${await claimed.text()}`);
    return { id: user.id, cookie };
  };
  const principal = (actor: Actor) => application.identity.requireSession(actor.cookie);
  const upload = async (actor: Actor, parentNodeId: string | null, name: string, text: string) => {
    const bytes = Buffer.from(text);
    const by = await principal(actor);
    const { body } = await application.blobs.createUpload(by, randomUUID(), {
      spaceId: team, parentNodeId, name, originalFilename: name, byteSize: bytes.length,
    });
    await application.blobs.upload(actor.id, body.upload.id, String(bytes.length), Readable.from([bytes]));
    const { node } = (await application.blobs.complete(by, body.upload.id)).body;
    return { nodeId: node.id, resourceId: node.resource!.id };
  };
  const objectKey = async (resourceId: string) => {
    const resource = await application.access.resolveResource(owner.id, resourceId);
    if (resource?.kind !== "blob") throw new Error("Blob missing");
    return resource.objectKey;
  };
  const sheetNamed = async (name: string, parentNodeId: string | null = null) => {
    const created = await application.resources.create(owner.id, randomUUID(), {
      kind: "univer", spaceId: team, parentNodeId, name, unitType: "sheet",
    });
    if (created.status === 202 || created.body.node.resource?.kind !== "univer") throw new Error("Sheet missing");
    return created.body.node.resource;
  };

  const owner = await person("owner");
  const alice = await person("alice");
  const bot = await agent(owner, "bot");
  const reader = await agent(owner, "reader");
  const { id: team } = await application.spaces.createTeamSpace(owner.id, { name: "Sales" });
  for (const [member, role] of [[alice, "editor"], [bot, "editor"], [reader, "viewer"]] as const) {
    await application.permissions.upsertTeamMember(owner.id, team, member.id, { role });
  }
  const folder = (await application.nodes.create(owner.id, { spaceId: team, parentNodeId: null, name: ".agents" })).id;
  const uploaded = await upload(owner, folder, "checks.md", CHECKS_MD);
  const declaration = { ...uploaded, objectKey: await objectKey(uploaded.resourceId) };
  const sheet = await sheetNamed("North");
  const otherSheet = await sheetNamed("South");
  if (landing === "checks") await application.spaces.update(owner.id, team, { landing });

  /** Moves the draft head of the pull request's first Unit by one changeset. */
  const editDraft = async (userId: string, pull: string) => {
    const unit = (await application.worktrees.get(userId, pull)).worktree.units[0]!;
    const result = await application.worktrees.submitChangeset(userId, pull, unit.unitId, {
      changeset: {
        unitID: unit.unitId, type: UniverType.UNIVER_SHEET, baseRev: unit.draftHeadRevision, revision: unit.draftHeadRevision + 1,
        sid: randomUUID(), reqId: 1, userID: "", memberID: "", createTime: 1, mutations: [],
      },
    });
    if (result.status !== "committed") throw new Error(`Draft write was ${result.status}`);
  };
  const openPull = async (userId: string, teamSpaceId: string = team) => (await application.worktrees.create(userId, randomUUID(), {
    kind: "team", teamSpaceId, name: "Fix totals", summary: null, visibility: "space",
  })).body.id;

  return {
    application, origin, team, folder, declaration, sheet, otherSheet, owner, alice, bot, reader, unreadable, beforeSecondRead,
    beforeSdkMerge, sdk, sql, agent, principal, upload, objectKey, sheetNamed, editDraft, openPull, trunkHead,
    async readyPull(userId: string, resourceId: string = sheet.id, teamSpaceId: string = team, edit = false) {
      const id = await openPull(userId, teamSpaceId);
      await application.worktrees.addUnit(userId, id, randomUUID(), { source: "trunk", resourceId });
      if (edit) await editDraft(userId, id);
      await application.worktrees.markReady(userId, id);
      return id;
    },
    merge: (userId: string, worktreeId: string) => application.worktrees.merge(userId, worktreeId, randomUUID()),
    report: (userId: string, worktreeId: string, name: string, state: "passed" | "failed") =>
      application.worktrees.reportCheck(userId, worktreeId, name, { state }),
    async reportAll(userId: string, worktreeId: string) {
      for (const name of ["totals-match", "header-unchanged"]) await this.report(userId, worktreeId, name, "passed");
    },
    async replace(actor: Actor, resourceId: string, text: string) {
      const resource = await application.access.resolveResource(owner.id, resourceId);
      if (resource?.kind !== "blob") throw new Error("Blob missing");
      const bytes = Buffer.from(text);
      return application.blobs.replace(await principal(actor), resourceId, randomUUID(), `"${resource.etag}"`, String(bytes.length), Readable.from([bytes]));
    },
    async commitToTrunk(userId: string, unitId: string) {
      const options = collaborationCallOptions(userId);
      const head = (await trunkHead(unitId, userId))!;
      const result = await trunk.submitChangeset({
        changeset: {
          unitID: unitId, type: UniverType.UNIVER_SHEET, baseRev: head, revision: head + 1, sid: randomUUID(), reqId: 1,
          userID: userId, memberID: options.memberID, mutations: [],
        },
      }, options);
      if (result.status !== "committed") throw new Error(`Trunk commit was ${result.status}`);
    },
  };
}

async function start() {
  const cleanup = new AsyncDisposableStack();
  cleanups.push(cleanup);
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const postgres = url ? await createPostgresTestDatabase(url) : undefined;
  if (postgres) cleanup.defer(postgres.close);
  const directory = mkdtempSync(join(tmpdir(), "workspace-landing-"));
  cleanup.defer(() => rmSync(directory, { recursive: true, force: true }));
  const config: WorkspaceConfig = {
    ...loadConfig({}),
    host: "127.0.0.1",
    port: 0,
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
    blobDirectory: join(directory, "blobs"),
    ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
    database: postgres
      ? { provider: "postgres", connectionString: postgres.connectionString }
      : { provider: "sqlite", filename: join(directory, "product.sqlite"), collaborationFilename: ":memory:" },
  };
  const database = await openProductDatabase(config.database);
  cleanup.defer(() => database.close());
  const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
  cleanup.defer(() => collaboration.close());
  // The test holds the runtime so that it can commit to Trunk directly.
  const runtime = createCollaborationRuntime(collaboration);
  cleanup.defer(() => runtime.dispose());

  const unreadable = new Set<string>();
  const blobStore = createBlobStore(config);
  const open = blobStore.open.bind(blobStore);
  blobStore.open = async (input) => {
    if (unreadable.has(input.objectKey)) throw new Error("The object store is unavailable.");
    return open(input);
  };
  const backend = createWorktreeBackend(runtime.worktreeService, runtime.service);
  let hook: { run: () => Promise<void>; reads: number } | undefined;
  let mergeHook: (() => Promise<void>) | undefined;
  const worktreeBackend: WorktreeBackend = {
    ...backend,
    async getWorktree(worktreeId, userId) {
      if (hook && ++hook.reads === 2) {
        const { run } = hook;
        hook = undefined;
        await run();
      }
      return backend.getWorktree(worktreeId, userId);
    },
    async merge(worktreeId, userId, checkedDraft) {
      const run = mergeHook;
      mergeHook = undefined;
      await run?.();
      return backend.merge(worktreeId, userId, checkedDraft);
    },
  };
  const application: WorkspaceApplication = createWorkspaceApplication(config, database.repositories, collaboration, {
    unitStore: runtime.unitStore,
    unitSnapshotStore: runtime.unitSnapshotStore,
    worktreeBackend,
    blobStore,
  });
  cleanup.defer(() => application.close());
  await application.initialize();
  const server = createServer(application.app);
  cleanup.defer(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  async function sql(statement: string, value: string): Promise<void> {
    if (config.database.provider === "postgres") {
      const client = new Client({ connectionString: config.database.connectionString });
      await client.connect();
      try {
        await client.query(statement.replace("?", "$1"), [value]);
      } finally {
        await client.end();
      }
      return;
    }
    const connection = new DatabaseSync(config.database.filename);
    try {
      connection.prepare(statement).run(value);
    } finally {
      connection.close();
    }
  }

  return {
    application,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    trunk: runtime.service as UniverCollabService,
    trunkHead: backend.trunkRevision,
    unreadable,
    beforeSecondRead(run: () => Promise<void>) {
      hook = { run, reads: 0 };
    },
    /** Runs once the second gate decided, just before the product asks the Collaboration Service to merge. */
    beforeSdkMerge(run: () => Promise<void>) {
      mergeHook = run;
    },
    sdk: backend,
    sql,
  };
}
