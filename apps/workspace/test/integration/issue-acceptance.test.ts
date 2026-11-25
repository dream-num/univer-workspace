import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { UniverType } from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { RevertPlan } from "../../server/src/modules/reverts/index.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

// Rows compare millisecond times, so each phase starts in a later millisecond than the one before.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the Issue acceptance panel's data", () => {
  it("hides a linked private pull request and its files from a member who may not see it", async () => {
    const { application, register, team, owner } = await setup();
    const editor = await register("editor");
    const viewer = await register("viewer");
    await application.permissions.upsertTeamMember(owner.id, team, editor.id, { role: "editor" });
    await application.permissions.upsertTeamMember(owner.id, team, viewer.id, { role: "viewer" });
    const sheet = await application.resources.create(owner.id, randomUUID(), {
      kind: "univer", spaceId: team, parentNodeId: null, name: "Totals", unitType: "sheet",
    });
    if (sheet.status === 202) throw new Error("Resource creation pending");
    const issue = await application.issues.create(owner.id, team, { title: "Fix totals", assigneeUserIds: [editor.id] });
    const pull = async (visibility: "space" | "private") => {
      const { id } = (await application.worktrees.create(editor.id, randomUUID(), {
        kind: "team", teamSpaceId: team, visibility, name: visibility, summary: null, issueNumber: issue.number,
      })).body;
      const { unitId } = (await application.worktrees.addUnit(editor.id, id, randomUUID(), {
        source: "trunk", resourceId: sheet.body.node.resource!.id,
      })).body.unit;
      return { id, unitId };
    };
    const shared = await pull("space");
    const hidden = await pull("private");

    expect((await application.issues.get(viewer.id, team, issue.number)).pullRequests.map((item) => item.id)).toEqual([shared.id]);
    expect((await application.worktrees.get(viewer.id, shared.id)).worktree.units.map((unit) => unit.unitId)).toEqual([shared.unitId]);
    await expect(application.worktrees.get(viewer.id, hidden.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const origin = await listen(application);
    const files = (id: string, unitId: string) =>
      fetch(`${origin}/universer-api/worktrees/${id}/units/${unitId}/comparison`, { headers: { cookie: viewer.cookie } });
    expect((await files(shared.id, shared.unitId)).status).toBe(200);
    expect((await files(hidden.id, hidden.unitId)).status).toBe(404);
    expect((await fetch(`${origin}/api/worktrees/${hidden.id}/html-view-drafts`, { headers: { cookie: viewer.cookie } })).status).toBe(404);
  }, 60_000);

  it("reads a file a merged pull request deleted by its name, without a comparison or a server error", async () => {
    const { application, register, team, owner } = await setup();
    const admin = await register("admin");
    const viewer = await register("viewer");
    await application.permissions.upsertTeamMember(owner.id, team, admin.id, { role: "admin" });
    await application.permissions.upsertTeamMember(owner.id, team, viewer.id, { role: "viewer" });
    const sheet = await application.resources.create(owner.id, randomUUID(), {
      kind: "univer", spaceId: team, parentNodeId: null, name: "Archive", unitType: "sheet",
    });
    if (sheet.status === 202) throw new Error("Resource creation pending");
    const issue = await application.issues.create(viewer.id, team, { title: "Remove the archive" });
    const { id } = (await application.worktrees.create(admin.id, randomUUID(), {
      kind: "team", teamSpaceId: team, visibility: "space", name: "Remove", summary: null, issueNumber: issue.number,
    })).body;
    const { unitId } = (await application.worktrees.addUnit(admin.id, id, randomUUID(), {
      source: "trunk", resourceId: sheet.body.node.resource!.id,
    })).body.unit;
    await application.worktrees.setUnitRemoved(admin.id, id, unitId, { removed: true });
    await application.worktrees.markReady(admin.id, id);
    await application.worktrees.merge(admin.id, id, randomUUID());

    const issueView = await application.issues.get(viewer.id, team, issue.number);
    expect(issueView.capabilities.close).toBe(true);
    expect(issueView.pullRequests).toEqual([expect.objectContaining({ id, state: "merged" })]);
    const origin = await listen(application);
    const pull = await fetch(`${origin}/api/worktrees/${id}`, { headers: { cookie: viewer.cookie } });
    expect(pull.status).toBe(200);
    expect((await pull.json()).worktree.units).toEqual([
      expect.objectContaining({ unitId, name: "Archive", change: "deleted", mergeResult: "removed" }),
    ]);
    for (const mode of ["", "?view=merged", "?baseMode=parent&view=merged", "?baseMode=base"]) {
      const comparison = await fetch(`${origin}/universer-api/worktrees/${id}/units/${unitId}/comparison${mode}`, {
        headers: { cookie: viewer.cookie },
      });
      expect([mode, comparison.status]).toEqual([mode, 409]);
    }

    await application.permissions.removeTeamMember(owner.id, team, admin.id);
    expect((await application.worktrees.get(admin.id, id)).worktree.units).toEqual([
      expect.objectContaining({ unitId, name: "Removed resource" }),
    ]);
  }, 60_000);

  it("answers 403 to a comparison of a removed file its reader can no longer open", async () => {
    const { application, register, team, owner } = await setup();
    const admin = await register("admin");
    await application.permissions.upsertTeamMember(owner.id, team, admin.id, { role: "admin" });
    const sheet = await application.resources.create(owner.id, randomUUID(), {
      kind: "univer", spaceId: team, parentNodeId: null, name: "Sales", unitType: "sheet",
    });
    if (sheet.status === 202) throw new Error("Resource creation pending");
    const { id } = (await application.worktrees.create(admin.id, randomUUID(), {
      kind: "team", teamSpaceId: team, visibility: "space", name: "Remove", summary: null,
    })).body;
    const { unitId } = (await application.worktrees.addUnit(admin.id, id, randomUUID(), {
      source: "trunk", resourceId: sheet.body.node.resource!.id,
    })).body.unit;
    await application.worktrees.setUnitRemoved(admin.id, id, unitId, { removed: true });
    await application.permissions.removeTeamMember(owner.id, team, admin.id);

    const origin = await listen(application);
    const comparison = await fetch(`${origin}/universer-api/worktrees/${id}/units/${unitId}/comparison`, {
      headers: { cookie: admin.cookie },
    });
    expect([comparison.status, (await comparison.json()).error?.code]).toEqual([403, "FORBIDDEN"]);
  }, 60_000);

  it.each([
    ["moved to Trash by hand", "inTrash", async (f: Task) => void (await f.application.trash.trashNode(f.owner.id, f.added.nodeId))],
    ["moved to Trash by a revert", "inTrash", async (f: Task) => {
      const reverted = await fetch(`${f.origin}/api/spaces/${f.team}/issues/${f.issueNumber}/revert`, {
        method: "POST", headers: { cookie: f.owner.cookie, "idempotency-key": randomUUID() },
      });
      expect(((await reverted.json()) as { operation: { state: string } }).operation.state).toBe("completed");
    }],
    ["permanently deleted", "deleted", async (f: Task) => {
      const batch = await f.application.trash.trashNode(f.owner.id, f.added.nodeId);
      await f.application.trash.removePermanently(f.owner.id, batch.id);
    }],
  ] as const)("lets every member review a merged pull request whose added file was %s", async (_case, fileState, arrange) => {
    const f = await mergedTask();
    await arrange(f);

    for (const reader of [f.owner, f.admin, f.editor, f.viewer]) {
      const read = (path: string) => fetch(`${f.origin}${path}`, { headers: { cookie: reader.cookie } });
      const { worktree } = (await (await read(`/api/worktrees/${f.pull}`)).json()) as { worktree: PullRequestView };
      expect(worktree.capabilities.review, reader.name).toBe(true);
      expect(worktree.units.map(({ name, fileState: state }) => [name, state])).toEqual([["Totals", "live"], ["Added", fileState]]);
      const listed = (await (await read(`/api/worktrees?scope=all&kind=team&teamSpaceId=${f.team}`)).json()) as { items: PullRequestView[] };
      expect(listed.items.find((item) => item.id === f.pull)?.capabilities.review).toBe(true);
      const issue = (await (await read(`/api/spaces/${f.team}/issues/${f.issueNumber}`)).json()) as { pullRequests: { id: string }[] };
      expect(issue.pullRequests.map((pull) => pull.id)).toEqual([f.pull]);
      expect((await read(`/api/worktrees/${f.pull}/checks`)).status).toBe(200);
      const compare = (unitId: string) => read(`/universer-api/worktrees/${f.pull}/units/${unitId}/comparison?baseMode=parent&view=merged`);
      expect((await compare(f.totalsUnitId)).status).toBe(200);
      expect((await compare(f.added.unitId)).status, "no one opens a file that left Trunk").toBe(409);
      expect((await read(`/universer-api/worktrees/${f.pull}/units/${f.added.unitId}/comparison`)).status).toBe(409);
      const open = (unitId: string) => fetch(`${f.origin}/api/worktrees/${f.pull}/units/${unitId}/open`, {
        method: "POST", headers: { cookie: reader.cookie, "content-type": "application/json" }, body: JSON.stringify({ mode: "draft" }),
      });
      expect((await open(f.totalsUnitId)).status).toBe(200);
      expect((await open(f.added.unitId)).status, "no draft to open for a file that left Trunk").toBe(404);
    }
  }, 60_000);

  it("still hides a merged pull request from its author once a live file in it is unreadable", async () => {
    const f = await mergedTask();
    await f.application.trash.trashNode(f.owner.id, f.added.nodeId);
    await f.application.permissions.removeTeamMember(f.owner.id, f.team, f.editor.id);

    const read = (path: string) => fetch(`${f.origin}${path}`, { headers: { cookie: f.editor.cookie } });
    const { worktree } = (await (await read(`/api/worktrees/${f.pull}`)).json()) as { worktree: PullRequestView };
    expect(worktree.capabilities.review).toBe(false);
    expect(worktree.units).toEqual([]);
    expect((await read(`/api/worktrees/${f.pull}/checks`)).status).toBe(403);
  }, 60_000);

  it("tells a reader who cannot see a file's name nothing about whether it is live, in Trash or deleted", async () => {
    const { application, register, team, owner } = await setup();
    const author = await register("author");
    await application.permissions.upsertTeamMember(owner.id, team, author.id, { role: "admin" });
    const old = await application.resources.create(owner.id, randomUUID(), {
      kind: "univer", spaceId: team, parentNodeId: null, name: "Old", unitType: "sheet",
    });
    if (old.status === 202) throw new Error("Resource creation pending");
    const { id: pull } = (await application.worktrees.create(author.id, randomUUID(), {
      kind: "team", teamSpaceId: team, visibility: "space", name: "Replace", summary: null,
    })).body;
    const removed = (await application.worktrees.addUnit(author.id, pull, randomUUID(), {
      source: "trunk", resourceId: old.body.node.resource!.id,
    })).body.unit;
    await application.worktrees.setUnitRemoved(author.id, pull, removed.unitId, { removed: true });
    const added = (await application.worktrees.addUnit(author.id, pull, randomUUID(), {
      source: "worktree", name: "Added", unitType: "sheet", targetSpaceId: team, targetParentNodeId: null,
    })).body.unit;
    await application.worktrees.markReady(author.id, pull);
    await application.worktrees.merge(author.id, pull, randomUUID());
    const oldBatch = (await application.trash.list(owner.id, team, { cursor: undefined, limit: undefined }))
      .items.find((batch) => batch.root.name === "Old")!;
    await application.trash.restore(owner.id, oldBatch.id);
    const addedBatch = await application.trash.trashNode(owner.id, added.nodeId!);
    await application.permissions.removeTeamMember(owner.id, team, author.id);

    const origin = await listen(application);
    const observe = async (reader: { readonly cookie: string }) => {
      const read = (path: string) => fetch(`${origin}${path}`, { headers: { cookie: reader.cookie } });
      const { worktree } = (await (await read(`/api/worktrees/${pull}`)).json()) as { worktree: PullRequestView };
      const compared: number[] = [];
      for (const { unitId } of worktree.units) {
        compared.push((await read(`/universer-api/worktrees/${pull}/units/${unitId}/comparison`)).status);
      }
      const plan = (await (await read(`/api/worktrees/${pull}/revert`)).json()) as RevertPlan;
      return {
        units: worktree.units.map(({ name, nodeId, freshness, fileState }) => ({ name, nodeId, freshness, fileState })),
        compared,
        plan: plan.items.map(({ action, state, name, nodeId, reason }) => ({ action, state, name, nodeId, reason })),
        refusal: plan.refusal,
      };
    };
    const hidden = { name: "Removed resource", nodeId: null, freshness: null, fileState: null };
    const unseen = {
      units: [hidden, hidden],
      compared: [403, 403],
      plan: [
        { action: "recover", state: "unavailable", name: "Removed resource", nodeId: null, reason: "You cannot open this file." },
        { action: "trash", state: "unavailable", name: "Removed resource", nodeId: null, reason: "This file is in Trash already, or you cannot see it." },
      ],
      refusal: "Only someone who may merge this pull request can revert it.",
    };

    expect(await observe(author), "Old is live and Added is in Trash").toEqual(unseen);
    const open = async (unitId: string, mode: string) => (await fetch(`${origin}/api/worktrees/${pull}/units/${unitId}/open`, {
      method: "POST", headers: { cookie: author.cookie, "content-type": "application/json" }, body: JSON.stringify({ mode }),
    })).status;
    for (const unitId of [removed.unitId, added.unitId]) {
      for (const mode of ["draft", "mergePreview", "trunk"]) expect(await open(unitId, mode), `${mode} of a file the reader cannot open`).toBe(404);
    }
    const ownerView = await observe(owner);
    expect(ownerView.units.map(({ name, fileState }) => [name, fileState])).toEqual([["Old", "live"], ["Added", "inTrash"]]);
    expect(ownerView.compared[1]).toBe(409);

    await application.trash.trashNode(owner.id, old.body.node.id);
    await application.trash.removePermanently(owner.id, addedBatch.id);
    await application.spaces.update(owner.id, team, { publicRead: true });
    expect(await observe(author), "Old is in Trash, Added is deleted, and the Space reads publicly").toEqual(unseen);
    expect((await observe(owner)).units.map(({ name, fileState }) => [name, fileState])).toEqual([["Old", "inTrash"], ["Added", "deleted"]]);
  }, 60_000);

  it("lists only the Team Space memberships an assignee granted after its assignment, as they stand now", async () => {
    const { application, register, team, owner } = await setup();
    const assignee = await register("assignee");
    const [early, later, byOwner, regranted] = [
      await register("early"), await register("later"), await register("by-owner"), await register("regranted"),
    ];
    await application.permissions.upsertTeamMember(owner.id, team, assignee.id, { role: "admin" });
    await application.permissions.upsertTeamMember(assignee.id, team, early.id, { role: "viewer" });
    await application.permissions.upsertTeamMember(assignee.id, team, regranted.id, { role: "viewer" });
    await nextMillisecond();
    const issue = await application.issues.create(owner.id, team, { title: "Invite the reviewers", assigneeUserIds: [assignee.id] });
    await nextMillisecond();
    await application.permissions.upsertTeamMember(assignee.id, team, later.id, { role: "editor" });
    await application.permissions.upsertTeamMember(owner.id, team, byOwner.id, { role: "viewer" });
    await nextMillisecond();
    await application.permissions.upsertTeamMember(assignee.id, team, regranted.id, { role: "editor" });
    await application.permissions.upsertTeamMember(assignee.id, team, byOwner.id, { role: "editor" });
    await nextMillisecond();
    await application.permissions.upsertTeamMember(owner.id, team, byOwner.id, { role: "viewer" });

    const changes = await application.issues.accessChanges(owner.id, team, issue.number);
    expect(changes.members.map((row) => [row.user.id, row.role, row.grantedBy.id])).toEqual([
      [regranted.id, "editor", assignee.id],
      [later.id, "editor", assignee.id],
    ]);
    expect(changes).toMatchObject({ publicRead: false, membersTruncated: false, personalSharing: { items: [], truncated: false } });

    await application.spaces.update(owner.id, team, { publicRead: true });
    expect((await application.issues.accessChanges(owner.id, team, issue.number)).publicRead).toBe(true);
    await application.issues.update(owner.id, team, issue.number, { assigneeUserIds: [] });
    expect((await application.issues.accessChanges(owner.id, team, issue.number)).members).toEqual([]);
  }, 60_000);

  it("shows an assignee's Personal Space sharing in full to it and its claimer, by name only to whoever may accept, and to nobody else", async () => {
    const { application, register, team, owner } = await setup();
    const claimer = await register("claimer");
    const viewer = await register("viewer");
    const grantee = await register("grantee");
    await application.permissions.upsertTeamMember(owner.id, team, claimer.id, { role: "viewer" });
    await application.permissions.upsertTeamMember(owner.id, team, viewer.id, { role: "viewer" });
    const { user: agent } = await application.identity.createAgent({ label: "worker", originIp: "203.0.113.9" });
    await application.repositories.identity.claimAgent(agent.id, claimer.id, Date.now());
    await application.permissions.upsertTeamMember(owner.id, team, agent.id, { role: "editor" });
    const personal = (await application.spaces.list(agent.id)).spaces.find((space) => space.type === "personal")!.id;
    const sheet = async (name: string) => {
      const created = await application.resources.create(agent.id, randomUUID(), {
        kind: "univer", spaceId: personal, parentNodeId: null, name, unitType: "sheet",
      });
      if (created.status === 202) throw new Error("Resource creation pending");
      return { id: created.body.node.id, resourceId: created.body.node.resource!.id };
    };
    const [before, shared, granted] = [await sheet("Before"), await sheet("Shared"), await sheet("Granted")];
    await application.permissions.updateNodeLinkSharing(agent.id, before.id, { enabled: true, role: "viewer" });
    await nextMillisecond();
    const issue = await application.issues.create(owner.id, team, { title: "Publish totals", assigneeUserIds: [agent.id] });
    await nextMillisecond();
    await application.permissions.updateNodeLinkSharing(agent.id, shared.id, { enabled: true, role: "viewer" });
    await application.permissions.upsertNodeGrant(agent.id, granted.id, grantee.id, { role: "editor" });

    const actor = expect.objectContaining({ id: agent.id });
    const user = expect.objectContaining({ id: grantee.id });
    const full = {
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "link", actor, node: { id: shared.id, name: "Shared" }, role: "viewer", enabled: true }),
        expect.objectContaining({ kind: "grant", actor, node: { id: granted.id, name: "Granted" }, role: "editor", user }),
      ]),
      truncated: false,
    };
    for (const reader of [claimer.id, agent.id]) {
      const { personalSharing } = await application.issues.accessChanges(reader, team, issue.number);
      expect(personalSharing).toEqual(full);
      expect(personalSharing!.items).toHaveLength(2);
    }

    const origin = await listen(application);
    const read = async (cookie: string) => {
      const response = await fetch(`${origin}/api/spaces/${team}/issues/${issue.number}/access-changes`, { headers: { cookie } });
      expect(response.status).toBe(200);
      return await response.text();
    };
    const summary = await read(owner.cookie);
    expect(JSON.parse(summary).personalSharing).toEqual({
      items: expect.arrayContaining([
        { kind: "link", actor, node: { name: "Shared" }, role: "viewer", enabled: true, updatedAt: expect.any(String) },
        { kind: "grant", actor, node: { name: "Granted" }, role: "editor", user, updatedAt: expect.any(String) },
      ]),
      truncated: false,
    });
    expect(JSON.parse(summary).personalSharing.items).toHaveLength(2);
    const hidden = await read(viewer.cookie);
    expect(JSON.parse(hidden).personalSharing).toBeNull();
    for (const text of [summary, hidden]) {
      for (const secret of [shared.id, shared.resourceId, granted.id, granted.resourceId, "/nodes/", "http"]) expect(text).not.toContain(secret);
    }
  }, 60_000);
});

describe("an open pull request whose file moved to Trash", () => {
  it("keeps its other files reviewable for every member and refuses the merge, naming the file", async () => {
    const f = await openTask();
    await f.application.trash.trashNode(f.owner.id, f.summary.nodeId);

    for (const reader of [f.owner, f.author, f.editor, f.viewer]) {
      const read = (path: string) => fetch(`${f.origin}${path}`, { headers: { cookie: reader.cookie } });
      const { worktree } = (await (await read(`/api/worktrees/${f.pull}`)).json()) as { worktree: PullRequestView };
      expect(worktree.capabilities, reader.name).toMatchObject({ review: true, merge: false });
      expect(worktree.units.map(({ name, change, fileState }) => [name, change, fileState])).toEqual([
        ["North", "modified", "live"], ["Summary", "modified", "inTrash"],
      ]);
      const listed = (await (await read(`/api/worktrees?scope=all&kind=team&teamSpaceId=${f.team}`)).json()) as { items: PullRequestView[] };
      expect(listed.items.find((item) => item.id === f.pull)?.capabilities.review).toBe(true);
      const issue = (await (await read(`/api/spaces/${f.team}/issues/${f.issueNumber}`)).json()) as { pullRequests: { id: string }[] };
      expect(issue.pullRequests.map((pull) => pull.id)).toEqual([f.pull]);
      expect((await read(`/api/worktrees/${f.pull}/checks`)).status).toBe(200);
      expect((await read(`/universer-api/worktrees/${f.pull}/units/${f.north.unitId}/comparison`)).status).toBe(200);
      expect((await read(`/universer-api/worktrees/${f.pull}/units/${f.summary.unitId}/comparison`)).status).toBe(409);
      const protocol = (unitId: string) => f.application.worktrees.authorizeProtocol({ userId: reader.id, worktreeId: f.pull, unitId, write: false });
      expect([await protocol(f.north.unitId), await protocol(f.summary.unitId)], "no one reads the draft of a file in Trash").toEqual([true, false]);

      const merge = await fetch(`${f.origin}/api/worktrees/${f.pull}/merge`, {
        method: "POST", headers: { cookie: reader.cookie, "idempotency-key": randomUUID() },
      });
      const { error } = (await merge.json()) as { error: { code: string; message: string } };
      expect([merge.status, error.code], reader.name).toEqual([409, "FILES_IN_TRASH"]);
      expect(error.message).toContain("Summary");
    }
  }, 60_000);

  it("merges the other files once its author leaves the file out, and leaves that file in Trash", async () => {
    const f = await openTask();
    const batch = await f.application.trash.trashNode(f.owner.id, f.summary.nodeId);
    const post = (path: string, body: object = {}) => fetch(`${f.origin}${path}`, {
      method: "POST",
      headers: { cookie: f.author.cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify(body),
    });

    expect((await post(`/api/worktrees/${f.pull}/reopen`)).status).toBe(200);
    expect((await post(`/api/worktrees/${f.pull}/units/${f.summary.unitId}/removal`, { removed: true })).status).toBe(200);
    expect((await post(`/api/worktrees/${f.pull}/ready`)).status).toBe(200);
    expect((await post(`/api/worktrees/${f.pull}/merge`)).status).toBe(200);

    const { worktree } = await f.application.worktrees.get(f.viewer.id, f.pull);
    expect([worktree.state, worktree.capabilities.review]).toEqual(["merged", true]);
    expect(worktree.units.map(({ name, mergeResult, fileState }) => [name, mergeResult, fileState])).toEqual([
      ["North", "merged", "live"], ["Summary", "removed", "inTrash"],
    ]);
    expect((await f.application.trash.list(f.owner.id, f.team, {})).items.map((item) => item.id), "Summary stays where the person put it").toEqual([batch.id]);
    const plan = await f.application.reverts.plan(f.owner.id, true, { kind: "pullRequest", worktreeId: f.pull });
    expect(plan.items.map((item) => item.unitId), "the pull request did not remove Summary, so a revert leaves it").toEqual([f.north.unitId]);
  }, 60_000);

  it("refuses the merge without naming the files its reader cannot see", async () => {
    const f = await openTask();
    await f.application.trash.trashNode(f.owner.id, f.north.nodeId);
    await f.application.trash.trashNode(f.owner.id, f.summary.nodeId);
    await f.application.permissions.removeTeamMember(f.owner.id, f.team, f.author.id);

    const merge = await fetch(`${f.origin}/api/worktrees/${f.pull}/merge`, {
      method: "POST", headers: { cookie: f.author.cookie, "idempotency-key": randomUUID() },
    });
    const { error } = (await merge.json()) as { error: { code: string; message: string } };
    expect([merge.status, error.code]).toEqual([409, "FILES_IN_TRASH"]);
    expect(error.message).toMatch(/^No one can merge changes to files that are no longer in the repository: 2 files you cannot open\. /u);
  }, 60_000);

  it("still hides an open pull request from its author once a live file in it is unreadable", async () => {
    const f = await openTask();
    await f.application.trash.trashNode(f.owner.id, f.summary.nodeId);
    await f.application.permissions.removeTeamMember(f.owner.id, f.team, f.author.id);

    const { worktree } = await f.application.worktrees.get(f.author.id, f.pull);
    expect(worktree.capabilities.review).toBe(false);
    expect(worktree.units).toEqual([]);
  }, 60_000);
});

async function listen(application: ProductTestApplication): Promise<string> {
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

type PullRequestView = {
  readonly id: string;
  readonly capabilities: { readonly review: boolean };
  readonly units: readonly {
    readonly unitId: string;
    readonly name: string;
    readonly change: string;
    readonly nodeId: string | null;
    readonly freshness: unknown;
    readonly fileState: string | null;
  }[];
};
type Task = Awaited<ReturnType<typeof mergedTask>>;

/** An Issue whose ready pull request, by the editor author, edits the Sheets North and Summary. */
async function openTask() {
  const { application, register, team, owner } = await setup();
  const [author, editor, viewer] = [await register("author"), await register("editor"), await register("viewer")];
  for (const [member, role] of [[author, "editor"], [editor, "editor"], [viewer, "viewer"]] as const) {
    await application.permissions.upsertTeamMember(owner.id, team, member.id, { role });
  }
  const issue = await application.issues.create(owner.id, team, { title: "Update the report", assigneeUserIds: [author.id] });
  const { id: pull } = (await application.worktrees.create(author.id, randomUUID(), {
    kind: "team", teamSpaceId: team, visibility: "space", name: "Report", summary: null, issueNumber: issue.number,
  })).body;
  const origin = await listen(application);
  const files: { unitId: string; nodeId: string }[] = [];
  for (const name of ["North", "Summary"]) {
    const sheet = await application.resources.create(owner.id, randomUUID(), {
      kind: "univer", spaceId: team, parentNodeId: null, name, unitType: "sheet",
    });
    if (sheet.status === 202) throw new Error("Resource creation pending");
    const { unitId } = (await application.worktrees.addUnit(author.id, pull, randomUUID(), {
      source: "trunk", resourceId: sheet.body.node.resource!.id,
    })).body.unit;
    await editSheet(application, origin, author, pull, unitId);
    files.push({ unitId, nodeId: sheet.body.node.id });
  }
  await application.worktrees.markReady(author.id, pull);
  return { application, team, owner, author, editor, viewer, pull, issueNumber: issue.number, north: files[0]!, summary: files[1]!, origin };
}

async function editSheet(application: ProductTestApplication, origin: string, author: { id: string; cookie: string }, pull: string, unitId: string) {
  const draft = (await (await fetch(`${origin}/universer-api/worktrees/${pull}/units/${unitId}/comparison`, {
    headers: { cookie: author.cookie },
  })).json()) as { right: { revision: number; unitData: { sheetOrder: string[] } } };
  await application.worktrees.submitChangeset(author.id, pull, unitId, {
    changeset: {
      unitID: unitId, type: UniverType.UNIVER_SHEET, baseRev: draft.right.revision, revision: draft.right.revision + 1,
      sid: randomUUID(), reqId: 1, userID: "", memberID: "", createTime: 1,
      mutations: [{
        id: "sheet.mutation.set-range-values",
        data: JSON.stringify({ unitId, subUnitId: draft.right.unitData.sheetOrder[0], cellValue: { 0: { 0: { v: "fixed" } } } }),
      }],
    },
  });
}

/** An Issue whose one merged pull request, by the editor, edits the Sheet Totals and adds a Sheet named Added. */
async function mergedTask() {
  const { application, register, team, owner } = await setup();
  const [admin, editor, viewer] = [await register("admin"), await register("editor"), await register("viewer")];
  for (const [member, role] of [[admin, "admin"], [editor, "editor"], [viewer, "viewer"]] as const) {
    await application.permissions.upsertTeamMember(owner.id, team, member.id, { role });
  }
  const sheet = await application.resources.create(owner.id, randomUUID(), {
    kind: "univer", spaceId: team, parentNodeId: null, name: "Totals", unitType: "sheet",
  });
  if (sheet.status === 202) throw new Error("Resource creation pending");
  const issue = await application.issues.create(owner.id, team, { title: "Fix totals", assigneeUserIds: [editor.id] });
  const { id: pull } = (await application.worktrees.create(editor.id, randomUUID(), {
    kind: "team", teamSpaceId: team, visibility: "space", name: "Totals", summary: null, issueNumber: issue.number,
  })).body;
  const { unitId: totalsUnitId } = (await application.worktrees.addUnit(editor.id, pull, randomUUID(), {
    source: "trunk", resourceId: sheet.body.node.resource!.id,
  })).body.unit;
  const added = (await application.worktrees.addUnit(editor.id, pull, randomUUID(), {
    source: "worktree", name: "Added", unitType: "sheet", targetSpaceId: team, targetParentNodeId: null,
  })).body.unit;
  const origin = await listen(application);
  await editSheet(application, origin, editor, pull, totalsUnitId);
  await application.worktrees.markReady(editor.id, pull);
  await application.worktrees.merge(owner.id, pull, randomUUID());
  return {
    application, team, owner, admin, editor, viewer, pull, totalsUnitId, issueNumber: issue.number,
    added: { unitId: added.unitId, nodeId: added.nodeId! }, origin,
  };
}

async function setup() {
  const application = await createProductTestApplication({
    host: "127.0.0.1", port: 0, productFilename: ":memory:", collaborationDatabaseFilename: ":memory:",
    secureCookies: false, sessionTtlMs: 60_000, passwordAuthEnabled: true, agentCreateLimitPerHour: 100,
  });
  applications.push(application);
  const register = async (username: string) => {
    const issued = await application.identity.registerWithPassword({
      username, displayName: username, password: "correct horse battery staple",
    });
    return { id: issued.view.user.id, name: username, cookie: `${application.identity.cookieName}=${issued.cookieValue}` };
  };
  const owner = await register("owner");
  const { id: team } = await application.spaces.createTeamSpace(owner.id, { name: "Team" });
  return { application, register, owner, team };
}
