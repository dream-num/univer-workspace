import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { WorkspaceDatabase } from "../../db/database.js";
import { LocalBlobStore } from "../../integrations/blob/blob-store.js";
import { createAccessResolver, AccessRepository } from "../access/index.js";
import { NodesRepository } from "../nodes/nodes.repository.js";
import { createSkillSourcesModule } from "./sources.service.js";
import { createSourceFetch, type SourceFetch } from "./sources.fetch.js";

// Recorded 2026-11-13. The GitHub tree is an excerpt containing the recorded PDF manifest.
const records = z
  .array(
    z.object({
      url: z.string(),
      status: z.number(),
      json: z.unknown().optional(),
      text: z.string().optional(),
      body: z.string().optional(),
    }),
  )
  .parse(
    JSON.parse(readFileSync(new URL("./fixtures/hub-recordings.json", import.meta.url), "utf8")),
  );
const databases: WorkspaceDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const commit = "2c5958ecac7cee2b583967a2c4981d0f4a75c579";
const github = `https://github.com/anthropics/skills/tree/${commit}/skills`;
function replay(url: string): Response {
  const record = records.find(
    (r) =>
      r.url.replace(`/commits/${commit}`, "/commits/HEAD") ===
      url.replace(`/commits/${commit}`, "/commits/HEAD"),
  );
  if (!record) throw new Error(`Unrecorded request ${url}`);
  return new Response(
    record.body ? Buffer.from(record.body, "base64") : (record.text ?? JSON.stringify(record.json)),
    { status: record.status },
  );
}
function sources(fetcher: SourceFetch) {
  const db = new WorkspaceDatabase(":memory:");
  databases.push(db);
  return createSkillSourcesModule({
    access: createAccessResolver(new AccessRepository(db)),
    nodes: new NodesRepository(db),
    store: new LocalBlobStore("/unused-skill-source-test"),
    fetch: fetcher,
  });
}
describe("hub source replay without network", () => {
  it.each([
    github,
    "skills.sh/anthropics/skills/pdf",
    "npx skills add anthropics/skills --skill pdf",
  ])("pins and reads %s using only recorded GitHub API and raw responses", async (source) => {
    const requests: string[] = [];
    const api = sources(async (url) => {
      requests.push(String(url));
      return replay(String(url));
    });
    const list = await api.read("author", { source });
    if (!("source" in list)) throw new Error("Expected source listing.");
    expect(list).toMatchObject({
      source: { kind: "git", commit },
      candidates: [{ name: "pdf", path: "skills/pdf", fileCount: 1, problems: [] }],
    });
    const detail = await api.read("author", { source: list.source, skill: "skills/pdf" });
    expect(detail).toMatchObject({
      source: list.source,
      skill: { name: "pdf", content: expect.stringContaining("name: pdf") },
    });
    expect(requests.filter((s) => s.includes("/commits/")).length).toBe(1);
    expect(requests.filter((s) => s.includes("/git/trees/")).length).toBe(2);
    expect(
      requests.every(
        (s) =>
          s.startsWith("https://api.github.com/") ||
          s.startsWith("https://raw.githubusercontent.com/"),
      ),
    ).toBe(true);
  });
  it("pins ClawHub owner and version, filters downloaded files to the version manifest", async () => {
    const requests: string[] = [];
    const api = sources(async (url) => {
      requests.push(String(url));
      return replay(String(url));
    });
    const list = await api.read("author", { source: "clawhub.ai/steipete/skills/gifgrep" });
    if (!("source" in list)) throw new Error("Expected source listing.");
    expect(list).toMatchObject({
      source: { kind: "clawhub", owner: "steipete", slug: "gifgrep", version: "1.0.1" },
    });
    const read = await api.read("author", { source: list.source, skill: "." });
    if (!("skill" in read)) throw new Error("Expected inspected Skill.");
    expect(read.skill?.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "skill-card.md"]);
    expect(requests.every((s) => s.includes("ownerHandle=steipete"))).toBe(true);
    expect(requests.some((s) => s.includes("/download?") && s.includes("version=1.0.1"))).toBe(
      true,
    );
  });
  it("drops skill-card.md and _meta.json when they are absent from the version file list", async () => {
    const api = sources(async (url) => {
      const response = replay(String(url));
      if (!String(url).includes("/versions/")) return response;
      const json = await response.json();
      json.version.files = json.version.files.filter(
        (file: { path: string }) => file.path === "SKILL.md",
      );
      return Response.json(json);
    });
    const result = await api.read("author", { source: "clawhub.ai/steipete/gifgrep", skill: "." });
    if (!("skill" in result)) throw new Error("Expected inspected Skill.");
    expect(result.skill?.files.map((f) => f.path)).toEqual(["SKILL.md"]);
  });
  it.each([
    [{ isSuspicious: true }, { status: "clean" }, "warn"],
    [{ isMalwareBlocked: true }, { status: "clean" }, "warn"],
    [null, { status: "malicious" }, "warn"],
    [null, { status: "clean", scanners: { skillspector: { status: "suspicious" } } }, "warn"],
    [null, { status: "clean", hasWarnings: true }, "info"],
  ])(
    "scans ClawHub moderation %j and version security %j",
    async (moderation, security, severity) => {
      const api = sources(async (url) => {
        const response = replay(String(url));
        if (String(url).includes("/download?")) return response;
        const json = await response.json();
        if (json.version) json.version.security = security;
        else json.moderation = moderation;
        return Response.json(json);
      });
      const result = await api.read("author", {
        source: "clawhub.ai/steipete/gifgrep",
        skill: ".",
      });
      if (!("scan" in result)) throw new Error("Expected static scan.");
      expect(result.scan).toContainEqual(
        expect.objectContaining({ rule: "hub-verdict", severity }),
      );
    },
  );
  it("returns candidate owners on ClawHub's documented 409 response", async () => {
    const api = sources(async () =>
      Response.json(
        {
          code: "AMBIGUOUS_SKILL_SLUG",
          matches: [
            { ownerHandle: "alice", slug: "gifgrep" },
            { ownerHandle: "bob", slug: "gifgrep" },
          ],
        },
        { status: 409 },
      ),
    );
    await expect(
      api.read("author", { source: "clawhub.ai/steipete/gifgrep" }),
    ).rejects.toMatchObject({
      code: "SKILL_SOURCE_AMBIGUOUS",
      status: 409,
      message: expect.stringContaining("alice, bob"),
    });
  });
  it.each([403, 429])("maps GitHub HTTP %i to an explicit zip-upload error", async (status) => {
    const api = sources(async () =>
      Response.json(
        { message: "API rate limit exceeded" },
        { status, headers: { "x-ratelimit-remaining": "0" } },
      ),
    );
    await expect(api.read("author", { source: github })).rejects.toMatchObject({
      status: 429,
      code: "SKILL_SOURCE_RATE_LIMITED",
      message: expect.stringContaining("upload it to Space"),
    });
  });
  it("refuses a truncated GitHub tree", async () => {
    const api = sources(async (url) =>
      String(url).includes("/git/trees/")
        ? Response.json({ truncated: true, tree: [] })
        : replay(String(url)),
    );
    await expect(api.read("author", { source: github })).rejects.toMatchObject({
      code: "SKILL_SOURCE_TRUNCATED",
      status: 422,
    });
  });
  it("rejects unsafe and symlink GitHub entries", async () => {
    for (const [path, mode] of [
      ["skills/../bad", "100644"],
      ["skills/link", "120000"],
    ]) {
      const api = sources(async (url) =>
        String(url).includes("/git/trees/")
          ? Response.json({ truncated: false, tree: [{ path, mode, type: "blob", size: 1 }] })
          : replay(String(url)),
      );
      await expect(api.read("author", { source: github })).rejects.toMatchObject({ status: 400 });
    }
  });
});
describe("source network boundary", () => {
  it("sends the server token only to api.github.com, including across redirects", async () => {
    const requests: { url: string; headers: Headers }[] = [];
    const read = createSourceFetch({
      githubToken: "server-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init?.headers) });
        return String(url).includes("api.github.com")
          ? new Response(null, {
              status: 302,
              headers: { location: "https://raw.githubusercontent.com/a/b/sha/file" },
            })
          : new Response("hello");
      },
    });
    expect((await read("https://api.github.com/repos/a/b", 100)).toString()).toBe("hello");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer server-token");
    expect(requests[1]!.headers.has("authorization")).toBe(false);
    expect(requests.every((r) => !r.headers.has("cookie"))).toBe(true);
  });
  it.each([
    "https://evil.test/",
    "http://api.github.com/a",
    "https://api.github.com:8443/a",
    "https://user:pass@api.github.com/a",
  ])("refuses redirect %s before fetching it", async (location) => {
    const fetcher = vi.fn<SourceFetch>(
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    await expect(
      createSourceFetch({ fetch: fetcher })("https://api.github.com/repos/a/b", 100),
    ).rejects.toMatchObject({ code: "SKILL_SOURCE_UNAVAILABLE", status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("enforces streamed response size and passes a finite timeout to fetch", async () => {
    const cancelled = vi.fn();
    const read = createSourceFetch({
      fetch: async (_url, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(10));
              controller.enqueue(new Uint8Array(10));
            },
            cancel: cancelled,
          }),
        );
      },
    });
    await expect(read("https://api.github.com/repos/a/b", 15)).rejects.toMatchObject({
      status: 413,
    });
    expect(cancelled).toHaveBeenCalled();
  });
});
