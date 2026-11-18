import { describe, expect, it } from "vitest";
import {
  parseItemNumber,
  parseRepoReference,
  resolveRepoReference,
  WorkspaceHttp,
  WorkspaceSpaceFeature,
  WorkspaceWorktreeFeature,
} from "../src/index.js";
import { parseNodeReference, resolveNodeReference, resolveUnitReference, shareNode } from "../src/product.js";

interface Call { readonly method: string; readonly path: string; readonly body: unknown }

function clients(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call = { method: request.method, path: url.pathname + url.search, body: text ? JSON.parse(text) : undefined };
    calls.push(call);
    return handler(call);
  };
  const http = new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "client" });
  return {
    calls,
    spaces: new WorkspaceSpaceFeature(async () => http),
    worktrees: new WorkspaceWorktreeFeature(async () => http),
  };
}

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "The resource was not found." } }, { status: 404 });
const view = (overrides: Record<string, unknown> = {}) => ({
  id: "s1", type: "team", name: "Docs", publicRead: false, description: "d", slug: "docs", fullName: "me/docs",
  owner: { id: "u1", username: "me" }, accessRole: "owner", capabilities: {}, ...overrides,
});
const worktree = (overrides: Record<string, unknown> = {}) => ({
  id: "w1", number: 4, name: "PR", summary: "body", state: "draft", units: [], teamSpace: { id: "s1" }, ...overrides,
});

const node = (resource: unknown) => ({
  node: {
    id: "n1", spaceId: "s1", parentNodeId: null, name: "Budget", hasChildren: false, accessRole: "owner",
    updatedAt: "2026-11-14T00:00:00.000Z", resource,
    capabilities: { browseChildren: false, createChildren: false, move: true, rename: true, share: true, trash: true },
  },
  space: { id: "s1", name: "Personal" },
  breadcrumbs: [{ id: "n1", name: "Budget" }],
  navigationRootNodeId: null,
});
const sheet = {
  id: "r1", kind: "univer", unitId: "u1", unitType: "sheet",
  capabilities: { downloadContent: false, editContent: true, openContent: true },
};
const sharing = (overrides: Record<string, unknown> = {}) => ({
  enabled: false, role: "viewer", owner: { username: "budget-x7k2", kind: "agent", claimed: false },
  expiresAt: "2026-12-14T00:00:00.000Z", createdBy: null, updatedBy: null, createdAt: null, updatedAt: null,
  ...overrides,
});

describe("file links", () => {
  const origin = "https://workspace.test";

  it("parses a file link or a Node ID and refuses other URLs", () => {
    expect(parseNodeReference(`${origin}/nodes/n1`, origin)).toBe("n1");
    expect(parseNodeReference(` ${origin}/nodes/%E8%A1%A8?x=1#top `, origin)).toBe("表");
    expect(parseNodeReference("n1", origin)).toBe("n1");
    expect(() => parseNodeReference("https://other.test/nodes/n1", origin))
      .toThrowError(expect.objectContaining({ code: "workspace-origin-mismatch" }));
    for (const bad of ["", `${origin}/spaces/s1`, `${origin}/nodes`, `${origin}/nodes/%ZZ`]) {
      expect(() => parseNodeReference(bad, origin), bad)
        .toThrowError(expect.objectContaining({ code: "workspace-argument-invalid" }));
    }
  });

  it("resolves a file link to its Space, Node and Unit", async () => {
    const { spaces, calls } = clients(() => Response.json(node(sheet)));
    await expect(resolveNodeReference(spaces, `${origin}/nodes/n1`, origin)).resolves.toMatchObject({
      spaceId: "s1", nodeId: "n1", name: "Budget", resource: { kind: "univer", unitId: "u1" },
    });
    await expect(resolveNodeReference(spaces, "https://other.test/nodes/n1", origin))
      .rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    expect(calls.map(({ method, path }) => [method, path])).toEqual([["GET", "/api/nodes/n1"]]);
  });

  it("resolves a file link given as a Unit to the Unit ID and leaves an ID alone", async () => {
    const { spaces, calls } = clients(() => Response.json(node(sheet)));
    await expect(resolveUnitReference(spaces, ` ${origin}/nodes/n1`, origin)).resolves.toBe("u1");
    await expect(resolveUnitReference(spaces, "u1", origin)).resolves.toBe("u1");
    expect(calls.map(({ method, path }) => [method, path])).toEqual([["GET", "/api/nodes/n1"]]);
    const folder = clients(() => Response.json(node(null)));
    await expect(resolveUnitReference(folder.spaces, `${origin}/nodes/n1`, origin)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: 'The link names "Budget", which is not a Unit, so this tool cannot read it.',
      detail: { nodeId: "n1" },
    });
  });

  it("reads Link Sharing without writing when no link is given, with a claim link for an unclaimed owner", async () => {
    const { spaces, calls } = clients((call) =>
      call.path === "/api/agents/claim-codes"
        ? Response.json({ code: "c0de", claimUrl: "/claim/c0de", expiresIn: 600 }, { status: 201 })
        : Response.json(call.path.endsWith("/link-sharing") ? sharing() : node(sheet)));
    await expect(shareNode(spaces, origin, { node: `${origin}/nodes/n1` })).resolves.toEqual({
      url: `${origin}/nodes/n1`,
      name: "Budget",
      link: "off",
      owner: { username: "budget-x7k2", kind: "agent", claimed: false },
      expiresAt: "2026-12-14T00:00:00.000Z",
      access: "Only this agent can open the link until a person claims it. Share it again with link viewer so anyone with the link can read it.",
      claimUrl: `${origin}/claim/c0de`,
      claimHint: "Give the claim link to the user so they can keep this file. It works once, within 10 minutes.",
    });
    expect(calls.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/api/nodes/n1"],
      ["GET", "/api/nodes/n1/link-sharing"],
      ["POST", "/api/agents/claim-codes"],
    ]);
  });

  it("still returns the share when the Workspace cannot make a claim code", async () => {
    const { spaces } = clients((call) =>
      call.path === "/api/agents/claim-codes"
        ? Response.json({ error: { code: "AGENT_CLAIM_UNAVAILABLE", message: "Try again shortly." } }, { status: 503 })
        : Response.json(call.path.endsWith("/link-sharing") ? sharing() : node(sheet)));
    const shared = await shareNode(spaces, origin, { node: "n1" });
    expect(shared).toMatchObject({ link: "off", owner: { claimed: false } });
    expect(shared).not.toHaveProperty("claimUrl");
  });

  it("says until when an unclaimed agent's shared link works", async () => {
    const { spaces } = clients((call) =>
      call.path === "/api/agents/claim-codes"
        ? Response.json({ code: "c0de", claimUrl: "/claim/c0de", expiresIn: 600 }, { status: 201 })
        : Response.json(call.method === "PUT" ? sharing({ enabled: true }) : node(sheet)));
    const shared = await shareNode(spaces, origin, { node: "n1", link: "viewer" });
    expect(shared.access).toBe(
      "Anyone with the link can read the file without signing in. The link stops working on 2026-12-14T00:00:00.000Z unless budget-x7k2 stays active.",
    );
  });

  it.each([
    ["off", { enabled: false, role: "viewer" },
      "Only people with access to the repository can open the link. Share it again with link viewer so anyone with the link can read it."],
    ["viewer", { enabled: true, role: "viewer" }, "Anyone with the link can read the file without signing in."],
    ["editor", { enabled: true, role: "editor" }, "Anyone with the link can read the file, and signed-in people can edit it."],
  ] as const)("sets Link Sharing to %s and reports what the server stored and who can open the link", async (link, settings, access) => {
    const { spaces, calls } = clients((call) =>
      Response.json(call.method === "PUT"
        ? sharing({ ...(call.body as object), owner: { username: "me", kind: "human" }, expiresAt: null })
        : node(sheet)));
    await expect(shareNode(spaces, origin, { node: "n1", link })).resolves.toEqual({
      url: `${origin}/nodes/n1`, name: "Budget", link, owner: { username: "me", kind: "human" }, access,
    });
    expect(calls.at(-1)).toEqual({ method: "PUT", path: "/api/nodes/n1/link-sharing", body: settings });
  });

  it("tells a delegated session to have the user share in the browser", async () => {
    const { spaces } = clients((call) =>
      call.method === "PUT"
        ? Response.json({ error: { code: "INTERACTIVE_SESSION_REQUIRED", message: "Use the browser." } }, { status: 403 })
        : Response.json(node(sheet)));
    await expect(shareNode(spaces, origin, { node: "n1", link: "viewer" })).rejects.toMatchObject({
      code: "INTERACTIVE_SESSION_REQUIRED",
      message: expect.stringContaining(`share the file in the browser: ${origin}/nodes/n1`),
      detail: { url: `${origin}/nodes/n1` },
    });
  });

  it("tells someone who is not the owner to read the file through its link", async () => {
    const { spaces } = clients((call) =>
      call.path.endsWith("/link-sharing")
        ? Response.json({ error: { code: "FORBIDDEN", message: "Not yours." } }, { status: 403 })
        : Response.json(node(sheet)));
    await expect(shareNode(spaces, origin, { node: "n1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/^Only the owner .* pass its link as the Unit with trunk: https:\/\/workspace\.test\/nodes\/n1$/u),
      detail: { url: `${origin}/nodes/n1` },
    });
  });

  it("passes other Link Sharing refusals through and rejects a malformed response", async () => {
    const limited = clients((call) =>
      call.path.endsWith("/link-sharing")
        ? Response.json({ error: { code: "RATE_LIMITED", message: "Slow down." } }, { status: 429 })
        : Response.json(node(sheet)));
    await expect(shareNode(limited.spaces, origin, { node: "n1" }))
      .rejects.toMatchObject({ code: "RATE_LIMITED", message: "Slow down." });
    const malformed = clients((call) =>
      Response.json(call.path.endsWith("/link-sharing") ? sharing({ role: "owner" }) : node(sheet)));
    await expect(shareNode(malformed.spaces, origin, { node: "n1" }))
      .rejects.toMatchObject({ code: "workspace-invalid-response" });
  });
});

describe("repository references", () => {
  it("parses full names, IDs and Browser URLs", () => {
    expect(parseRepoReference("me/docs")).toEqual({ kind: "full-name", owner: "me", slug: "docs" });
    expect(parseRepoReference("me/personal")).toEqual({ kind: "full-name", owner: "me", slug: "personal" });
    expect(parseRepoReference("0c0c7a04-ca20")).toEqual({ kind: "id", spaceId: "0c0c7a04-ca20" });
    expect(parseRepoReference("https://workspace.test/spaces/s1")).toEqual({ kind: "url", spaceId: "s1" });
    expect(parseRepoReference("https://workspace.test/spaces/s1/issues/12?x=1")).toEqual({
      kind: "url", spaceId: "s1", item: { kind: "issue", number: 12 },
    });
    expect(parseRepoReference("https://workspace.test/spaces/s1/pulls/3#files")).toEqual({
      kind: "url", spaceId: "s1", item: { kind: "pr", number: 3 },
    });
    expect(parseRepoReference("https://workspace.test/spaces/s1/pulls")).toEqual({ kind: "url", spaceId: "s1" });
    expect(parseRepoReference("https://workspace.test/worktrees?worktree=w9&section=files")).toEqual({
      kind: "worktree-url", worktreeId: "w9",
    });
    for (const bad of ["", "a/b/c", "/b", "a/", "https://workspace.test/nodes/n1"]) {
      expect(() => parseRepoReference(bad), bad).toThrowError(expect.objectContaining({ code: "workspace-argument-invalid" }));
    }
  });

  it("parses item numbers", () => {
    expect(parseItemNumber("12")).toBe(12);
    expect(parseItemNumber("#12")).toBe(12);
    expect(parseItemNumber("https://workspace.test/spaces/s1/pulls/7")).toBe(7);
    expect(parseItemNumber("https://workspace.test/spaces/s1")).toBeUndefined();
    for (const other of ["0", "-1", "1.5", "w-1", "0c0c7a04-ca20", "#"]) expect(parseItemNumber(other), other).toBeUndefined();
  });

  it.each(["%", "%ZZ", "%C3%28"])("rejects malformed path encoding %s as an argument error", async (encoded) => {
    const { spaces, calls } = clients(() => Response.json(view()));
    for (const path of [`/spaces/${encoded}/issues/3`, `/spaces/s1/pulls/${encoded}`]) {
      const url = `https://workspace.test${path}`;
      for (const parse of [parseRepoReference, parseItemNumber]) {
        expect(() => parse(url)).toThrowError(expect.objectContaining({ code: "workspace-argument-invalid" }));
      }
      await expect(resolveRepoReference(spaces, url, "https://workspace.test"))
        .rejects.toMatchObject({ code: "workspace-argument-invalid" });
    }
    expect(calls).toEqual([]);
  });

  it.each(["issues", "pulls"])("preserves valid Unicode and percent encoding in %s URLs", async (route) => {
    const { spaces, calls } = clients(() => Response.json(view()));
    const url = `https://workspace.test/%73paces/%E7%A9%BA%E9%97%B4%25/${route}/%33`;
    const item = { kind: route === "issues" ? "issue" : "pr", number: 3 };
    expect(parseRepoReference(url)).toEqual({ kind: "url", spaceId: "空间%", item });
    expect(parseItemNumber(url)).toBe(3);
    await expect(resolveRepoReference(spaces, url, "https://workspace.test"))
      .resolves.toEqual({ spaceId: "空间%", item });
    await expect(resolveRepoReference(spaces, url, "https://other.test"))
      .rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    expect(calls).toEqual([]);
  });

  it("resolves through the server lookup only when needed and rejects other origins", async () => {
    const { spaces, calls } = clients(() => Response.json(view()));
    await expect(resolveRepoReference(spaces, "Me/Docs")).resolves.toEqual({ spaceId: "s1" });
    expect(calls.map((call) => call.path)).toEqual(["/api/spaces/lookup?owner=Me&slug=Docs"]);
    await expect(resolveRepoReference(spaces, "08c0a307-edab-42f5-8f08-2852641fab0e")).resolves.toEqual({ spaceId: "08c0a307-edab-42f5-8f08-2852641fab0e" });
    await expect(resolveRepoReference(spaces, "https://workspace.test/spaces/s3/issues/5", "https://workspace.test"))
      .resolves.toEqual({ spaceId: "s3", item: { kind: "issue", number: 5 } });
    await expect(resolveRepoReference(spaces, "https://other.test/spaces/s3", "https://workspace.test"))
      .rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    await expect(resolveRepoReference(spaces, "https://workspace.test/worktrees?worktree=w1"))
      .rejects.toMatchObject({ code: "workspace-argument-invalid" });
    expect(calls).toHaveLength(1);
  });

  it("resolves UUID Space IDs without a list or get request", async () => {
    const { spaces, calls } = clients(() => { throw new Error("No request expected"); });
    const id = "08c0a307-edab-42f5-8f08-2852641fab0e";
    await expect(resolveRepoReference(spaces, id)).resolves.toEqual({ spaceId: id });
    expect(calls).toEqual([]);
  });

  it("resolves a unique bare slug among listed repositories", async () => {
    const { spaces, calls } = clients((call) => call.path === "/api/spaces"
      ? Response.json({ spaces: [view(), view({ id: "old", slug: null, fullName: null })] })
      : notFound());
    await expect(resolveRepoReference(spaces, "docs")).resolves.toEqual({ spaceId: "s1" });
    expect(calls.map((call) => call.path)).toEqual(["/api/spaces/docs", "/api/spaces"]);
  });

  it("hints owner/slug when a bare slug is unknown", async () => {
    const { spaces } = clients((call) => call.path === "/api/spaces"
      ? Response.json({ spaces: [view()] }) : notFound());
    await expect(resolveRepoReference(spaces, "missing")).rejects.toMatchObject({
      code: "workspace-argument-invalid", message: expect.stringContaining("Use owner/slug"),
    });
  });

  it("lists owner/slug candidates when a bare slug is ambiguous", async () => {
    const { spaces } = clients((call) => call.path === "/api/spaces"
      ? Response.json({ spaces: [view(), view({ id: "s2", fullName: "other/docs", owner: { id: "u2", username: "other" } })] })
      : notFound());
    await expect(resolveRepoReference(spaces, "docs")).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: expect.stringMatching(/Use owner\/slug.*me\/docs.*other\/docs/),
    });
  });

  it("keeps non-UUID historical Space IDs without listing repositories", async () => {
    const { spaces, calls } = clients(() => Response.json(view({ id: "legacy", slug: null, fullName: null })));
    await expect(resolveRepoReference(spaces, "legacy")).resolves.toEqual({ spaceId: "legacy" });
    expect(calls.map((call) => call.path)).toEqual(["/api/spaces/legacy"]);
  });

  it.each([401, 403, 503])("does not reinterpret an ID lookup failure with status %s", async (status) => {
    const { spaces, calls } = clients(() => Response.json({ error: { code: "DENIED", message: "Unavailable" } }, { status }));
    await expect(resolveRepoReference(spaces, "docs")).rejects.toBeInstanceOf(Error);
    expect(calls.map((call) => call.path)).toEqual(["/api/spaces/docs"]);
  });

  it("reports a missing server capability only when the server predates Space full names", async () => {
    const oldServer = clients((call) =>
      call.path === "/api/spaces" ? Response.json({ spaces: [{ id: "p", name: "Personal", type: "personal" }] }) : notFound());
    await expect(oldServer.spaces.lookup("me", "docs")).rejects.toMatchObject({ code: "workspace-server-capability-missing" });
    await expect(oldServer.worktrees.getByNumber("s1", 4)).rejects.toMatchObject({ code: "workspace-server-capability-missing" });

    const newServer = clients((call) =>
      call.path === "/api/spaces" ? Response.json({ spaces: [view({ id: "p", type: "personal", slug: null, fullName: "me/personal" })] }) : notFound());
    await expect(newServer.spaces.lookup("me", "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newServer.worktrees.getByNumber("s1", 9)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Errors other than 404 are never reinterpreted, and the probe is skipped.
    const failing = clients(() => Response.json({ error: { code: "INVALID_INPUT", message: "no" } }, { status: 400 }));
    await expect(failing.spaces.lookup("me", "x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(failing.calls).toHaveLength(1);
  });

  it.each(["lookup", "numbered PR"] as const)("preserves a capability probe authentication failure after %s returns 404", async (operation) => {
    const { spaces, worktrees, calls } = clients((call) =>
      call.path === "/api/spaces"
        ? Response.json({ error: { code: "UNAUTHENTICATED", message: "Session expired." } }, { status: 401 })
        : notFound());

    const result = operation === "lookup" ? spaces.lookup("me", "hidden") : worktrees.getByNumber("s1", 9);
    await expect(result).rejects.toMatchObject({
      code: "workspace-authentication-required",
      message: "Workspace Session is missing or expired.",
      detail: { path: "/api/spaces", status: 401 },
    });
    expect(calls).toHaveLength(2);
  });

  it.each([
    { name: "forbidden", probe: () => Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }) },
    { name: "unavailable", probe: () => Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 }) },
    { name: "invalid response", probe: () => new Response("not JSON", { status: 200 }) },
    { name: "network failure", probe: () => { throw new TypeError("Connection closed."); } },
  ])("keeps the original 404 when the capability probe has a non-authentication $name", async ({ probe }) => {
    for (const operation of ["lookup", "numbered PR"] as const) {
      const { spaces, worktrees } = clients((call) => call.path === "/api/spaces" ? probe() : notFound());
      const result = operation === "lookup" ? spaces.lookup("me", "hidden") : worktrees.getByNumber("s1", 9);
      await expect(result).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "The resource was not found.",
        detail: { path: operation === "lookup" ? "/api/spaces/lookup" : "/api/spaces/s1/worktrees/9", status: 404 },
      });
    }
  });
});

describe("Space and Worktree additions", () => {
  it("parses slug, full name and owner on Space views and keeps summaries unchanged", async () => {
    const { spaces } = clients(() => Response.json(view()));
    await expect(spaces.get("s1")).resolves.toEqual({
      id: "s1", type: "team", name: "Docs", publicRead: false, description: "d", slug: "docs",
      fullName: "me/docs", owner: { id: "u1", username: "me" }, accessRole: "owner",
    });
    const { spaces: summaryOnly } = clients(() => Response.json({ spaces: [{ id: "s", name: "N" }] }));
    await expect(summaryOnly.list()).resolves.toEqual([{ id: "s", name: "N" }]);
  });

  it("creates and updates Spaces with a slug and reads stars", async () => {
    const { spaces, calls } = clients((call) =>
      call.path.endsWith("/star") ? Response.json({ starred: true, starCount: 2 }) : Response.json(view()));
    await spaces.create({ name: "Docs", slug: "docs", publicRead: true });
    await spaces.update("s 1", { slug: "new", description: "x" });
    await expect(spaces.getStar("s1")).resolves.toEqual({ starCount: 2, starred: true });
    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["POST", "/api/team-spaces", { name: "Docs", slug: "docs", publicRead: true }],
      ["PATCH", "/api/spaces/s%201", { slug: "new", description: "x" }],
      ["GET", "/api/spaces/s1/star", undefined],
    ]);
  });

  it("numbers, summaries and state filters on Worktrees", async () => {
    const { worktrees, calls } = clients((call) => {
      if (call.path.startsWith("/api/worktrees?")) return Response.json({ items: [worktree()], nextCursor: null });
      if (call.method === "POST") return Response.json(worktree());
      return Response.json({ worktree: worktree() });
    });
    await expect(worktrees.getByNumber("s 1", 4)).resolves.toMatchObject({ id: "w1", number: 4, summary: "body" });
    await worktrees.list({ view: "all", scope: "space", spaceId: "s1", states: ["merged", "discarded"] });
    await worktrees.create({ name: "PR", scope: { kind: "space", spaceId: "s1" }, summary: "why", idempotencyKey: "k" });
    await worktrees.update("w1", { summary: null });
    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["GET", "/api/spaces/s%201/worktrees/4", undefined],
      ["GET", "/api/worktrees?scope=all&kind=team&teamSpaceId=s1&state=merged&state=discarded", undefined],
      ["POST", "/api/worktrees", { kind: "team", name: "PR", summary: "why", teamSpaceId: "s1", visibility: "private" }],
      ["PATCH", "/api/worktrees/w1", { summary: null }],
    ]);
  });
});
