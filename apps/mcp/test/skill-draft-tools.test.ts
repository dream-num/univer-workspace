import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { testStagingDirectory } from "./staging-directory.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import type { ToolScope } from "../src/gateway/tools/definition.js";
import { skillDraftResult } from "../src/gateway/tools/core/skill-draft-support.js";
import { skillDraftCreateTool } from "../src/gateway/tools/core/skill-draft-create.js";

const origin = "https://workspace.example";
const text = "---\nname: weekly-report\ndescription: Write the weekly report.\n---\nReview source data.\n";
const review = [{ rule: "requires-shell", path: "SKILL.md", quote: "Review source data.", impact: "Check availability.", suggestion: "Read using MCP." }];
const input = {
  name: "weekly-report", destination: { personal: true },
  files: [{ path: "SKILL.md", text }], review: [], idempotency_key: "skill-draft-key-1234",
};
const rawDraft = (state = "pending", spaceId = "personal-1") => ({
  id: "draft-1", kind: "create", state, name: "weekly-report", spaceId,
  previewPath: "/drafts/skills/draft-1", files: [{ path: "SKILL.md", byteSize: 80, sha256: "hash", kind: "text", mediaType: "text/markdown" }],
  base: null, keep: [], removedPaths: [], scan: [], review: [], source: null,
  unverifiedReviewCount: 0, compatibility: "ready", createdAt: "2026-11-13T00:00:00Z",
  expiresAt: "2026-11-14T00:00:00Z", decidedAt: state === "pending" ? null : "2026-11-13T01:00:00Z",
  published: state === "published" ? { folderNodeId: "folder-1" } : null,
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function setup(scopes?: ReadonlySet<ToolScope>) {
  let logs = "";
  let draft = rawDraft();
  let failure: { status: number; code: string; message: string } | undefined;
  const posts: { body: unknown; key: string | null }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const req = new Request(url, init);
    const path = new URL(req.url).pathname;
    if (path === "/api/session") return Response.json({ authenticated: true, user: { id: "u1", username: "alice", displayName: "Alice" } });
    const personal = { id: "personal-1", name: "Alice", type: "personal", affiliation: "owner", accessRole: "owner", owner: { id: "u1", username: "alice" }, fullName: "alice/personal", slug: null };
    const repo = { ...personal, id: "repo-1", type: "team", fullName: "alice/reports", slug: "reports" };
    if (path === "/api/spaces") return Response.json({ spaces: [personal, repo] });
    if (path === "/api/spaces/lookup" || path === "/api/spaces/repo-1") return Response.json(repo);
    if (path.startsWith("/api/skill-drafts")) {
      if (failure) return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status });
      if (req.method === "POST") {
        const body = await req.json();
        posts.push({ body, key: req.headers.get("idempotency-key") });
        draft = { ...draft, spaceId: body.spaceId };
      }
      return Response.json({ draft });
    }
    throw new Error(`Unexpected request ${req.method} ${path}`);
  });
  const { gateway, url } = await listenGateway((url) => createGateway(parseGatewayConfig({
    MCP_DEV_SESSION_PASSTHROUGH: "1", WORKSPACE_ORIGIN: origin,
    WORKSPACE_TRANSPORT_URL: "http://transport.internal", MCP_PUBLIC_URL: url,
    MCP_STAGING_DIRECTORY: testStagingDirectory(),
  }), {
    fetcher, ...(scopes === undefined ? {} : { scopes }),
    logger: pino({}, new Writable({ write(chunk, _encoding, done) { logs += chunk.toString(); done(); } })),
  }));
  cleanups.push(async () => {
    await gateway.close(); gateway.server.closeAllConnections();
    await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
  });
  const client = new Client({ name: "skill-draft-tests", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: "Bearer test-session-secret" } } }));
  cleanups.push(() => client.close());
  return {
    client, posts, fetcher,
    setDraft: (value: typeof draft) => { draft = value; },
    fail: (value: typeof failure) => { failure = value; },
    events: () => logs.trim().split("\n").map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line))).filter((line) => line["event"] === "mcp.tool_call"),
    logs: () => logs,
  };
}

it.each([{ personal: true }, { repo: "alice/reports" }])("resolves %j, forwards replace/keep/review and returns identity preview metadata", async (destination) => {
  const f = await setup();
  f.setDraft({ ...rawDraft(), scan: [], review: [] });
  const result = await f.client.callTool({ name: "skill_draft_create", arguments: { ...input, destination, replace: true, keep: ["guide.md"], review } });
  expect(result.isError).not.toBe(true);
  const spaceId = "repo" in destination ? "repo-1" : "personal-1";
  expect(f.posts).toEqual([{ body: { name: input.name, spaceId, files: input.files, replace: true, keep: ["guide.md"], review }, key: input.idempotency_key }]);
  expect(result.structuredContent).toMatchObject({ draft: { id: "draft-1", state: "pending", previewUrl: `${origin}/drafts/skills/draft-1`, spaceId, expiresAt: "2026-11-14T00:00:00Z", scan: [], review: [], unverifiedReviewCount: 0, compatibility: "ready", removedPaths: [] } });
  await vi.waitFor(() => expect(f.events()).toHaveLength(1));
  expect(f.events()[0]).toMatchObject({ tool: "skill_draft_create", repo: spaceId, outcome: "ok", executor: "none" });
  for (const secret of [text, "Review source data.", "Check availability.", input.idempotency_key, "test-session-secret"]) expect(f.logs()).not.toContain(secret);
});

it("replays the same key and returns the same server-owned draft", async () => {
  const f = await setup();
  const first = await f.client.callTool({ name: "skill_draft_create", arguments: input });
  const retry = await f.client.callTool({ name: "skill_draft_create", arguments: input });
  expect(retry.structuredContent).toEqual(first.structuredContent);
  expect(f.posts.map(({ key }) => key)).toEqual([input.idempotency_key, input.idempotency_key]);
});

it.each(["pending", "published", "rejected", "expired", "conflicted"])("reads %s with metadata", async (state) => {
  const f = await setup(new Set(["read"]));
  f.setDraft(rawDraft(state));
  const result = await f.client.callTool({ name: "skill_draft_get", arguments: { draft: "draft-1" } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ draft: { state, previewUrl: `${origin}/drafts/skills/draft-1`, published: state === "published" ? { folderNodeId: "folder-1" } : null } });
});

it.each([
  [400, "BAD_REQUEST", "Invalid Skill files."], [403, "FORBIDDEN", "Cannot create files in this repository."],
  [404, "NOT_FOUND", "Skill draft not found."], [409, "CONFLICT", "Idempotency key conflicts with another request."],
  [413, "PAYLOAD_TOO_LARGE", "Skill exceeds the size limit."],
] as const)("preserves clear Workspace %i errors", async (status, code, message) => {
  const f = await setup();
  f.fail({ status, code, message });
  for (const name of ["skill_draft_create", "skill_draft_get"]) {
    const result = await f.client.callTool({ name, arguments: name === "skill_draft_create" ? input : { draft: "draft-1" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code, message });
    expect(JSON.stringify(result.content)).toContain(message);
  }
});

it("rejects Ask-style read-only creation before HTTP and tells the user to switch to Auto", async () => {
  const f = await setup(new Set(["read"]));
  const result = await f.client.callTool({ name: "skill_draft_create", arguments: input });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({ code: "workspace-scope-required" });
  expect(JSON.stringify(result.content)).toContain("switch to Auto");
  expect(f.posts).toEqual([]);
  expect(f.fetcher.mock.calls.some(([url]) => String(url).includes("/api/skill-drafts"))).toBe(false);
});

it("requires review and rejects ambiguous destinations and the future from form", () => {
  for (const invalid of [
    { ...input, review: undefined }, { ...input, destination: { personal: true, repo: "alice/reports" } },
    { ...input, from: { source: "anything" } },
  ]) expect(skillDraftCreateTool.inputSchema.safeParse(invalid).success).toBe(false);
});

it.each(["https://attacker.example/drafts/skills/draft-1", "//attacker.example/drafts/skills/draft-1", "/drafts/skills/wrong"])("rejects unsafe preview path %s", async (previewPath) => {
  const f = await setup();
  f.setDraft({ ...rawDraft(), previewPath });
  const result = await f.client.callTool({ name: "skill_draft_get", arguments: { draft: "draft-1" } });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({ code: "workspace-invalid-response" });
});

it("preserves verified review, scan, replacement removals and unverified count", () => {
  const metadata = {
    ...rawDraft(), kind: "replace", compatibility: "degraded", keep: ["guide.md"],
    removedPaths: ["old.md"], unverifiedReviewCount: 2,
    base: [{ path: "old.md", resourceId: "old-resource", etag: '\"old-etag\"' }],
    review: review.map((finding) => ({ ...finding, severity: "warn", line: 6 })),
    scan: [{ rule: "script-file", severity: "warn", path: "scripts/report.js", line: null, message: "Review script usage." }],
  };
  const { previewPath, ...expected } = metadata;
  expect(skillDraftResult(metadata, origin)).toEqual({ ...expected, previewUrl: origin + previewPath });
  expect(() => skillDraftResult(metadata, origin, "another-id")).toThrow("ID does not match");
});
