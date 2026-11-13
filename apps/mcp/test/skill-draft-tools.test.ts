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
import { skillSourceReadTool } from "../src/gateway/tools/core/skill-source-read.js";
import { resolvedSkillSourceSchema } from "../src/gateway/tools/core/skill-draft-support.js";
import { skillDraftResult } from "../src/gateway/tools/core/skill-draft-support.js";
import { skillDraftCreateTool } from "../src/gateway/tools/core/skill-draft-create.js";

const origin = "https://workspace.example";
const text = "---\nname: weekly-report\ndescription: Write the weekly report.\n---\nReview source data.\n";
const review = [{ rule: "requires-shell", path: "SKILL.md", quote: "Review source data.", impact: "Check availability.", suggestion: "Read using MCP." }];
const input = {
  name: "weekly-report", destination: { personal: true },
  files: [{ path: "SKILL.md", text }], review: [], idempotency_key: "skill-draft-key-1234",
};
const rawDraft = (state = "pending", spaceId = "personal-1", source: z.infer<typeof resolvedSkillSourceSchema> | null = null) => ({
  id: "draft-1", kind: "create", state, name: "weekly-report", spaceId,
  previewPath: "/drafts/skills/draft-1", files: [{ path: "SKILL.md", byteSize: 80, sha256: "hash", kind: "text", mediaType: "text/markdown" }],
  base: null, keep: [], removedPaths: [], scan: [], review: [], source,
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
  let sourceResult: unknown;
  const sourcePosts: unknown[] = [];
  const posts: { body: unknown; key: string | null }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const req = new Request(url, init);
    const path = new URL(req.url).pathname;
    if (path === "/api/session") return Response.json({ authenticated: true, user: { id: "u1", username: "alice", displayName: "Alice" } });
    const personal = { id: "personal-1", name: "Alice", type: "personal", affiliation: "owner", accessRole: "owner", owner: { id: "u1", username: "alice" }, fullName: "alice/personal", slug: null };
    const repo = { ...personal, id: "repo-1", type: "team", fullName: "alice/reports", slug: "reports" };
    if (path === "/api/spaces") return Response.json({ spaces: [personal, repo] });
    if (path === "/api/spaces/lookup" || path === "/api/spaces/repo-1") return Response.json(repo);
    if (path === "/api/skill-sources/read") {
      sourcePosts.push(await req.json());
      if (failure) return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status });
      return Response.json(sourceResult);
    }
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
    client, posts, fetcher, sourcePosts,
    setSource: (value: unknown) => { sourceResult = value; },
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

it("requires review and rejects ambiguous destinations or files/from combinations", () => {
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

const pinned = {
  kind: "git", hub: "github", owner: "anthropics", repo: "skills", commit: "2c5958ecac7cee2b583967a2c4981d0f4a75c579",
  path: "skills/pdf", pageUrl: "https://github.com/anthropics/skills/tree/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/pdf",
} as const;
const sourceShapes = [
  { source: pinned, candidates: [{ name: "pdf", description: "PDF source material.", path: "skills/pdf", fileCount: 2, problems: [] }] },
  { source: pinned, skill: { name: "pdf", description: "PDF source material.", path: "skills/pdf", content: text,
    files: [{ path: "SKILL.md", byteSize: 80, kind: "text" }, { path: "asset.bin", byteSize: 10, kind: "binary" }] },
    scan: [{ rule: "script-file", severity: "warn", path: "scripts/read.py", line: null, message: "Review source script." }] },
  { path: "references/guide.md", content: "private source page", truncated: true, cursor: "page-cursor" },
  { path: "references/guide.md", content: "final private source page" },
];
it.each(sourceShapes)("reads source response shape without logging material %#", async (output) => {
  const f = await setup(new Set(["read"]));
  f.setSource(output);
  const args = "candidates" in output ? { source: "https://skills.sh/anthropics/skills/pdf" }
    : "skill" in output ? { source: pinned, skill: "skills/pdf" }
    : { source: pinned, skill: "skills/pdf", path: output.path, cursor: "page-cursor" };
  const result = await f.client.callTool({ name: "skill_source_read", arguments: args });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual(output);
  expect(f.sourcePosts).toEqual([args]);
  await vi.waitFor(() => expect(f.events()).toHaveLength(1));
  expect(f.events()[0]).toMatchObject({ tool: "skill_source_read", executor: "none", outcome: "ok", repo: null });
  for (const privateText of [text, "PDF source material.", "private source page", "page-cursor", pinned.pageUrl, "test-session-secret"]) {
    expect(f.logs()).not.toContain(privateText);
  }
});

it.each([
  [429, "SKILL_SOURCE_RATE_LIMITED", "Hub rate limit reached. Ask the user to download the zip and upload it to Space."],
  [409, "SKILL_SOURCE_AMBIGUOUS", "Choose a ClawHub owner: alice, bob."],
  [413, "PAYLOAD_TOO_LARGE", "Skill source exceeds its file or byte limits."],
  [400, "INVALID_INPUT", "Invalid zip archive."],
] as const)("maps source and import error %i without losing guidance", async (status, code, message) => {
  const f = await setup();
  f.fail({ status, code, message });
  for (const [name, args] of [
    ["skill_source_read", { source: pinned }],
    ["skill_draft_create", { ...input, files: undefined, from: { source: pinned, skill: "skills/pdf" } }],
  ] as const) {
    const result = await f.client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code, message });
  }
  expect(f.logs()).not.toContain(pinned.pageUrl);
});

it.each([undefined, [{ path: "SKILL.md", text }, { path: "obsolete.txt", text: null }]])("copies a pinned source and preserves provenance with overrides %j", async (overrides) => {
  const f = await setup();
  f.setDraft(rawDraft("pending", "personal-1", pinned));
  const from = { source: pinned, skill: "skills/pdf", ...(overrides ? { overrides } : {}) };
  const { files: _files, ...base } = input;
  const result = await f.client.callTool({ name: "skill_draft_create", arguments: { ...base, from } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ draft: { source: pinned } });
  expect(f.posts).toEqual([{ body: { name: input.name, spaceId: "personal-1", review: [], from }, key: input.idempotency_key }]);
  const got = await f.client.callTool({ name: "skill_draft_get", arguments: { draft: "draft-1" } });
  expect(got.structuredContent).toMatchObject({ draft: { source: pinned } });
  for (const privateText of [text, pinned.pageUrl, "obsolete.txt"]) expect(f.logs()).not.toContain(privateText);
});

it("rejects missing or simultaneous content forms and dependent source fields", async () => {
  const from = { source: pinned, skill: "skills/pdf" };
  expect(skillDraftCreateTool.inputSchema.safeParse({ ...input, from }).success).toBe(false);
  const { files: _files, ...withoutFiles } = input;
  expect(skillDraftCreateTool.inputSchema.safeParse(withoutFiles).success).toBe(false);
  for (const args of [{ source: pinned, path: "SKILL.md" }, { source: pinned, cursor: "cursor" }, { source: pinned, skill: "skills/pdf", cursor: "cursor" }]) {
    expect(skillSourceReadTool.inputSchema.safeParse(args).success).toBe(false);
  }
  const f = await setup();
  f.setSource({ source: pinned, skill: { content: "broken response" } });
  expect((await f.client.callTool({ name: "skill_source_read", arguments: { source: pinned } })).structuredContent).toMatchObject({ code: "workspace-invalid-response" });
});
