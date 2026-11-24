import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { UniverCollabService } from "@univerjs-pro/collaboration-service";
import { UniverType } from "@univerjs/protocol";
import { afterEach, expect, it } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { collaborationCallOptions, createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";
import { createWorktreeBackend } from "../../server/src/integrations/univer/worktree-store.js";
import { interactivePrincipal } from "../fixtures/principal.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const cleanups: AsyncDisposableStack[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup.disposeAsync();
});

const CHECKS_MD = `# Checks for agents

## totals-match
B5 equals SUM(B2:B4).

\`\`\`markdown
## not-a-check
\`\`\`

## Header Unchanged
A heading that is not a check name is text for agents.

## header-unchanged
Row 1 matches Trunk.
`;

it("records check results on the ready content, counts only those of someone who may merge, and keeps them through merge", async () => {
  const { application, trunk } = await start();
  const { worktrees } = application;
  const register = async (username: string) => (await application.identity.registerWithPassword({
    username, displayName: username, password: "correct horse battery staple",
  })).view.user.id;
  const [owner, viewer, editor] = [await register("owner"), await register("viewer"), await register("editor")];
  const { id: team } = await application.spaces.createTeamSpace(owner, { name: "Sales" });
  await application.permissions.upsertTeamMember(owner, team, viewer, { role: "viewer" });
  await application.permissions.upsertTeamMember(owner, team, editor, { role: "editor" });
  const folder = await application.nodes.create(owner, { spaceId: team, parentNodeId: null, name: ".agents" });
  const bytes = Buffer.from(CHECKS_MD);
  const { body: upload } = await application.blobs.createUpload(interactivePrincipal(owner), randomUUID(), {
    spaceId: team, parentNodeId: folder.id, name: "checks.md", originalFilename: "checks.md", byteSize: bytes.length,
  });
  await application.blobs.upload(owner, upload.upload.id, String(bytes.length), Readable.from([bytes]));
  await application.blobs.complete(interactivePrincipal(owner), upload.upload.id);
  const created = await application.resources.create(owner, randomUUID(), {
    kind: "univer", spaceId: team, parentNodeId: null, name: "North", unitType: "sheet",
  });
  if (created.status === 202 || !created.body.node.resource) throw new Error("Sheet missing");
  const sheet = created.body.node.resource;

  const pull = (await worktrees.create(viewer, randomUUID(), {
    kind: "team", teamSpaceId: team, name: "Fix totals", summary: null, visibility: "space",
  })).body.id;
  await worktrees.addUnit(viewer, pull, randomUUID(), { source: "trunk", resourceId: sheet.id });
  const report = (userId: string, name: string, body: unknown) => worktrees.reportCheck(userId, pull, name, body);
  const checks = async (userId = owner) => (await worktrees.checks(userId, pull)).checks;
  const summary = async () => (await worktrees.get(owner, pull, true)).worktree.checks;

  await expect(report(viewer, "totals-match", { state: "passed" })).rejects.toMatchObject({
    code: "CONFLICT",
    status: 409,
    message: "Check results are reported on a ready pull request, and this one is draft. Mark it ready first.",
  });
  expect(await checks(), "a draft lists the declared checks with nothing reported").toEqual([
    { name: "totals-match", declared: true, state: "missing", results: [] },
    { name: "header-unchanged", declared: true, state: "missing", results: [] },
  ]);
  await worktrees.markReady(viewer, pull);

  await expect(report(viewer, "Totals", { state: "passed" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(report(viewer, "totals-match", { state: "skipped" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(report(viewer, "totals-match", { state: "passed", summary: "x".repeat(1001) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const viewed = await report(viewer, "totals-match", { state: "passed", summary: "B5 = 60" });
  expect(viewed.check, "a viewer's result is shown but does not count").toMatchObject({
    name: "totals-match", declared: true, state: "missing",
    results: [{ reporter: { id: viewer }, state: "passed", summary: "B5 = 60", current: true, counts: false }],
  });
  expect((await report(viewer, "smoke", { state: "failed" })).check).toMatchObject({ name: "smoke", declared: false, state: "missing" });
  expect(await summary(), "an undeclared check is not required").toEqual({ passed: 0, failed: 0, missing: 2 });

  // The body names no content; a key the client sends is ignored.
  const counted = await report(editor, "totals-match", { state: "passed", contentKey: "forged" });
  expect(counted.check).toMatchObject({ state: "passed", results: [{ reporter: { id: editor }, current: true, counts: true }, { reporter: { id: viewer } }] });
  const failed = await report(editor, "header-unchanged", { state: "failed", summary: "A1 renamed" });
  expect((await report(editor, "header-unchanged", { state: "failed", summary: "A1 renamed" })).check, "a repeated report changes nothing")
    .toEqual(failed.check);
  expect(await summary()).toEqual({ passed: 1, failed: 1, missing: 0 });
  expect((await checks(viewer)).map((check) => [check.name, check.state])).toEqual([
    ["totals-match", "passed"], ["header-unchanged", "failed"], ["smoke", "missing"],
  ]);

  const unit = (await worktrees.get(owner, pull)).worktree.units[0]!;
  await commitToTrunk(trunk, owner, sheet.unitId, unit.freshness!.baselineTrunkRevision);
  const stale = await checks();
  expect(stale.flatMap((check) => check.results).every((result) => !result.current && !result.counts), "a Trunk edit to its Unit leaves every result out of date")
    .toBe(true);
  expect(stale.map((check) => [check.name, check.state, check.results.length])).toEqual([
    ["totals-match", "missing", 2], ["header-unchanged", "missing", 1], ["smoke", "missing", 1],
  ]);
  expect(await summary()).toEqual({ passed: 0, failed: 0, missing: 2 });

  await report(editor, "totals-match", { state: "passed" });
  await report(editor, "header-unchanged", { state: "passed" });
  await worktrees.merge(editor, pull, randomUUID());
  const merged = await checks();
  expect(merged.map((check) => [check.name, check.state, check.results.filter((result) => result.current).length])).toEqual([
    ["totals-match", "passed", 1], ["header-unchanged", "passed", 1], ["smoke", "missing", 0],
  ]);
  await expect(report(editor, "totals-match", { state: "failed" })).rejects.toMatchObject({
    code: "CONFLICT",
    message: "Check results are reported on a ready pull request, and this one is merged.",
  });
}, 60_000);

async function start() {
  const cleanup = new AsyncDisposableStack();
  cleanups.push(cleanup);
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const postgres = url ? await createPostgresTestDatabase(url) : undefined;
  if (postgres) cleanup.defer(postgres.close);
  const config: WorkspaceConfig = {
    ...loadConfig({}),
    host: "127.0.0.1",
    port: 0,
    secureCookies: false,
    passwordAuthEnabled: true,
    ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
    database: postgres
      ? { provider: "postgres", connectionString: postgres.connectionString }
      : { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
  };
  const database = await openProductDatabase(config.database);
  cleanup.defer(() => database.close());
  const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
  cleanup.defer(() => collaboration.close());
  // The test holds the runtime so that it can commit to Trunk directly.
  const runtime = createCollaborationRuntime(collaboration);
  cleanup.defer(() => runtime.dispose());
  const application = createWorkspaceApplication(config, database.repositories, collaboration, {
    unitStore: runtime.unitStore,
    unitSnapshotStore: runtime.unitSnapshotStore,
    worktreeBackend: createWorktreeBackend(runtime.worktreeService, runtime.service),
  });
  cleanup.defer(() => application.close());
  await application.initialize();
  return { application, trunk: runtime.service as UniverCollabService };
}

async function commitToTrunk(trunk: UniverCollabService, userId: string, unitId: string, head: number): Promise<void> {
  const options = collaborationCallOptions(userId);
  const result = await trunk.submitChangeset({
    changeset: {
      unitID: unitId, type: UniverType.UNIVER_SHEET, baseRev: head, revision: head + 1, sid: randomUUID(), reqId: 1,
      userID: userId, memberID: options.memberID, mutations: [],
    },
  }, options);
  if (result.status !== "committed") throw new Error(`Trunk commit was ${result.status}`);
}
