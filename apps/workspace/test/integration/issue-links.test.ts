import { interactivePrincipal } from "../fixtures/principal.js";
import { randomUUID } from "node:crypto";
import type { WorktreeData } from "@univerjs-pro/collaboration-worktree-service";
import { afterEach, describe, expect, it } from "vitest";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

const refused = (code: string) => expect.objectContaining({ code, field: code === "INVALID_INPUT" ? "issueNumber" : undefined });

describe("Issue links", () => {
  it("links a Team pull request to an Issue of its Space and lists what each reader may see", async () => {
    const { application, owner, editor, viewer, team } = await setup();
    const issue = await application.issues.create(owner, team, { title: "Fix totals" });
    const plain = await createPull(application, editor, team, "Plain");
    expect(plain.issue).toBeNull();
    const linked = await createPull(application, editor, team, "Linked", { issueNumber: issue.number });
    expect(linked.issue).toEqual({ number: issue.number, title: "Fix totals", state: "open" });
    const hidden = await createPull(application, editor, team, "Private", { issueNumber: issue.number, visibility: "private" });

    const linkedView = {
      id: linked.id, number: linked.number, title: "Linked", state: "draft",
      author: expect.objectContaining({ id: editor }), mergedBy: null,
    };
    expect((await application.issues.get(viewer, team, issue.number)).pullRequests).toEqual([linkedView]);
    expect(ids((await application.issues.get(owner, team, issue.number)).pullRequests)).toEqual([hidden.id, linked.id].sort());

    expect((await application.worktrees.update(editor, plain.id, { issueNumber: issue.number })).worktree.issue)
      .toMatchObject({ number: issue.number });
    await application.worktrees.markReady(owner, plain.id);
    await application.worktrees.merge(owner, plain.id, "issue-link-merge");
    await application.issues.update(owner, team, issue.number, { state: "closed" });
    expect((await application.issues.get(viewer, team, issue.number)).pullRequests).toEqual(expect.arrayContaining([
      { ...linkedView, state: "draft" },
      expect.objectContaining({ id: plain.id, state: "merged", mergedBy: expect.objectContaining({ id: owner }) }),
    ]));
    expect((await application.worktrees.get(viewer, plain.id)).worktree.issue).toEqual({ number: issue.number, title: "Fix totals", state: "closed" });

    expect((await application.worktrees.update(editor, linked.id, { issueNumber: null })).worktree.issue).toBeNull();
    expect(ids((await application.issues.get(viewer, team, issue.number)).pullRequests)).toEqual([plain.id]);
  });

  it("refuses links across Spaces, to User Worktrees, by members who cannot manage the summary, and to unreadable Issues", async () => {
    const { application, owner, editor, viewer, team, other } = await setup();
    const issue = await application.issues.create(owner, team, { title: "Fix totals" });
    const pull = await createPull(application, editor, team, "Fix");

    await expect(createPull(application, editor, other, "Elsewhere", { issueNumber: issue.number })).rejects.toEqual(refused("INVALID_INPUT"));
    await expect(application.worktrees.update(editor, pull.id, { issueNumber: 999 })).rejects.toEqual(refused("INVALID_INPUT"));
    for (const issueNumber of [0, 1.5, "1"]) {
      await expect(application.worktrees.update(editor, pull.id, { issueNumber })).rejects.toEqual(refused("INVALID_INPUT"));
    }
    await expect(application.worktrees.create(editor, randomUUID(), { kind: "user", name: "Mine", summary: null, issueNumber: issue.number }))
      .rejects.toEqual(refused("INVALID_INPUT"));
    const mine = (await application.worktrees.create(editor, randomUUID(), { kind: "user", name: "Mine", summary: null })).body;
    await expect(application.worktrees.update(editor, mine.id, { issueNumber: issue.number })).rejects.toEqual(refused("INVALID_INPUT"));
    await expect(application.worktrees.update(viewer, pull.id, { issueNumber: issue.number })).rejects.toEqual(refused("FORBIDDEN"));

    await application.worktrees.update(editor, pull.id, { issueNumber: issue.number });
    await application.permissions.removeTeamMember(owner, team, editor);
    // The author still sees its pull request, but no longer the Issue of a Space it cannot read.
    expect((await application.worktrees.get(editor, pull.id)).worktree.issue).toBeNull();
    await expect(application.worktrees.update(editor, pull.id, { issueNumber: issue.number })).rejects.toEqual(refused("FORBIDDEN"));
    expect((await application.worktrees.get(owner, pull.id)).worktree.issue).toMatchObject({ number: issue.number });
  });

  it("keeps the link in the idempotent create intent", async () => {
    const { application, owner, editor, team } = await setup();
    const first = await application.issues.create(owner, team, { title: "First" });
    const second = await application.issues.create(owner, team, { title: "Second" });
    const input = { kind: "team", teamSpaceId: team, visibility: "space", name: "Fix", summary: null, issueNumber: first.number };
    const created = await application.worktrees.create(editor, "issue-link-create", input);
    expect((await application.worktrees.create(editor, "issue-link-create", input)).body.id).toBe(created.body.id);
    await expect(application.worktrees.create(editor, "issue-link-create", { ...input, issueNumber: second.number }))
      .rejects.toEqual(expect.objectContaining({ code: "CONFLICT", message: expect.stringMatching(/Idempotency-Key/) }));
  });
});

function ids(items: readonly { readonly id: string }[]): string[] {
  return items.map((item) => item.id).sort();
}

async function createPull(
  application: ProductTestApplication,
  userId: string,
  teamSpaceId: string,
  name: string,
  extra: { readonly issueNumber?: number; readonly visibility?: "private" | "space" } = {},
) {
  return (await application.worktrees.create(userId, randomUUID(), {
    kind: "team", teamSpaceId, visibility: "space", name, summary: null, ...extra,
  })).body;
}

async function setup() {
  const states = new Map<string, WorktreeData>();
  const transition = async (id: string, status: WorktreeData["status"]): Promise<WorktreeData> => {
    const value = { worktreeID: id, status, units: [] };
    states.set(id, value);
    return value;
  };
  const unused = async (): Promise<never> => { throw new Error("Unused by Issue link tests"); };
  const worktreeBackend: WorktreeBackend = {
    createWorktree: (id) => transition(id, "draft"),
    getWorktree: async (id) => states.get(id) ?? Promise.reject(new Error("Unknown worktree")),
    markReady: (id) => transition(id, "ready"), merge: (id) => transition(id, "merged"),
    discard: (id) => transition(id, "discarded"), reopen: (id) => transition(id, "draft"),
    addUnit: unused, createUnit: unused, setUnitRemoved: unused, submitChangeset: unused, trunkRevision: unused, trunkChangesets: unused, restoreTrunk: unused,
  };
  const application = await createProductTestApplication(
    {
      host: "127.0.0.1", port: 0, productFilename: ":memory:", collaborationDatabaseFilename: ":memory:",
      secureCookies: false, sessionTtlMs: 60_000,
    },
    { unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) }, worktreeBackend },
  );
  applications.push(application);
  const register = async (username: string) => (await application.identity.registerWithPassword({
    username, displayName: username, password: "correct horse battery staple",
  })).view.user.id;
  const [owner, editor, viewer] = [await register("owner"), await register("editor"), await register("viewer")];
  const { id: team } = await application.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Team" });
  const { id: other } = await application.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Other" });
  for (const space of [team, other]) {
    await application.permissions.upsertTeamMember(interactivePrincipal(owner), space, editor, { role: "editor" });
    await application.permissions.upsertTeamMember(interactivePrincipal(owner), space, viewer, { role: "viewer" });
  }
  return { application, owner, editor, viewer, team, other };
}
