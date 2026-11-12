import { testStagingDirectory } from "./staging-directory.js";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { skillEntry } from "@modelcontextprotocol/server/ext/skills";
import { SkillsClient, SKILLS_EXTENSION_ID } from "@modelcontextprotocol/client/ext/skills";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createStandardApiReference } from "@univer-cli/api-reference";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../src/gateway/tools/schemas.js";

const cliSkillData = new URL("../../cli/skill-data/", import.meta.url).pathname;
const mcpSkillData = new URL("../skills/", import.meta.url).pathname;
const SKILL_NAMES = [
  "base",
  "blob",
  "board",
  "core",
  "cross-unit-formula",
  "doc",
  "embed",
  "html-view",
  "sheet",
  "slide",
];
const LIMIT = 100_000;
const fetcher: typeof fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  if (path === "/api/session") return Response.json({ authenticated: true, user: { id: "user-1", displayName: "alice" } });
  if (path === "/api/spaces") return Response.json({ spaces: [] });
  return Response.json({ error: { code: "workspace-not-found", message: "Not found." } }, { status: 404 });
};
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function skillWorkspace() {
  const personal = { id: "personal", name: "Personal", type: "personal", affiliation: "owner", fullName: "alice/personal" };
  const repository = { id: "team", name: "Team", type: "team", affiliation: "member", fullName: "bob/team" };
  const spaces = [personal, repository];
  type Node = ReturnType<typeof makeNode>;
  function makeNode(id: string, name: string, spaceId: string, parentNodeId: string | null) {
    return { id, name, spaceId, parentNodeId, accessRole: "owner", hasChildren: false,
      updatedAt: "2026-09-29T00:00:00.000Z",
      capabilities: { browseChildren: true, createChildren: true, move: true, rename: true, share: true, trash: true },
      resource: null as null | { id: string; kind: "blob"; byteSize: number; mediaType: string; availability: string;
        capabilities: { downloadContent: boolean; editContent: boolean; openContent: boolean } },
    };
  }
  const nodes: Node[] = [];
  const contents = new Map<string, Uint8Array>();
  const requests: string[] = [];
  function folder(spaceId: string, parentNodeId: string | null, name: string) {
    const found = nodes.find((node) => node.spaceId === spaceId && node.parentNodeId === parentNodeId && node.name === name);
    if (found) return found;
    const node = makeNode(`n${nodes.length}`, name, spaceId, parentNodeId);
    nodes.push(node);
    if (parentNodeId) nodes.find((node) => node.id === parentNodeId)!.hasChildren = true;
    return node;
  }
  function file(parent: Node, path: string, content: string | Uint8Array, overrides: Record<string, unknown> = {}) {
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) parent = folder(parent.spaceId, parent.id, part);
    const node = makeNode(`n${nodes.length}`, parts.at(-1)!, parent.spaceId, parent.id);
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    node.resource = { id: `r${nodes.length}`, kind: "blob", byteSize: bytes.byteLength, mediaType: "text/plain", availability: "ready",
      capabilities: { downloadContent: true, editContent: false, openContent: true }, ...overrides };
    nodes.push(node);
    parent.hasChildren = true;
    contents.set(node.resource.id, bytes);
    return node;
  }
  function skill(spaceId: string, name: string, content = `---\nname: ${name}\ndescription: ${spaceId} description.\n---\nPrivate body\n`) {
    const agents = folder(spaceId, null, ".agents");
    const skills = folder(spaceId, agents.id, "skills");
    const root = folder(spaceId, skills.id, name);
    file(root, "SKILL.md", content);
    return root;
  }
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname;
    requests.push(path);
    if (path === "/api/session") return Response.json({ authenticated: true, user: { id: "user-1", displayName: "alice" } });
    if (path === "/api/spaces") return Response.json({ spaces });
    if (path === "/api/spaces/lookup") {
      const params = new URL(new Request(input, init).url).searchParams;
      const found = spaces.find((space) => space.fullName === `${params.get("owner")}/${params.get("slug")}`);
      if (found) return Response.json(found);
    }
    const space = spaces.find((space) => path === `/api/spaces/${space.id}`);
    if (space) return Response.json(space);
    const root = path.match(/^\/api\/spaces\/([^/]+)\/nodes$/);
    const child = path.match(/^\/api\/nodes\/([^/]+)\/children$/);
    if (root || child) {
      const parent = child ? nodes.find((node) => node.id === child[1]) : undefined;
      const breadcrumbs: Node[] = [];
      for (let node = parent; node; node = nodes.find((n) => n.id === node!.parentNodeId)) breadcrumbs.unshift(node);
      const spaceId = parent?.spaceId ?? root![1];
      return Response.json({ space: spaces.find((space) => space.id === spaceId), parentNode: parent ?? null,
        breadcrumbs: breadcrumbs.map(({ id, name }) => ({ id, name })), navigationRootNodeId: null, nextCursor: null,
        nodes: nodes.filter((node) => node.spaceId === spaceId && node.parentNodeId === (parent?.id ?? null)),
      });
    }
    const resource = path.match(/^\/api\/resources\/([^/]+)$/);
    const blob = resource ? nodes.find((node) => node.resource?.id === resource[1]) : undefined;
    if (blob) return Response.json({ node: blob, resource: blob.resource });
    const download = path.match(/^\/api\/blob-resources\/([^/]+)\/download$/);
    if (download && contents.has(download[1]!)) {
      const bytes = contents.get(download[1]!)!;
      return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength), etag: '"v1"' } });
    }
    return Response.json({ error: { code: "workspace-not-found", message: "Not found." } }, { status: 404 });
  };
  return { personal, repository, spaces, nodes, contents, requests, folder, file, skill, fetcher };
}

describe("API reference, Skills, resources and server instructions", () => {
  let gateway: ReturnType<typeof createGateway> | undefined;
  let url = "";
  let clients: Client[] = [];
  let scratch: string | undefined;
  let sourceRoot: string;

  async function start(skillDataRoot = sourceRoot, workspaceFetch = fetcher) {
    ({ gateway, url } = await listenGateway((url) =>
      createGateway(
        parseGatewayConfig({
          MCP_DEV_SESSION_PASSTHROUGH: "1",
          WORKSPACE_ORIGIN: "https://workspace.example",
          MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url,
        }),
        { logger: pino({ level: "silent" }), fetcher: workspaceFetch, skillDataRoot },
      ),
    ));
  }
  async function connect(mode: "legacy" | { pin: string } = { pin: "2026-07-28" }) {
    const client = new Client(
      { name: "reference-test", version: "1.0.0" },
      { versionNegotiation: { mode } },
    );
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: "Bearer test-session" } },
      }),
    );
    return client;
  }
  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    return { ...result, structured: result.structuredContent as Record<string, any> };
  }
  beforeEach(async () => {
    clients = [];
    sourceRoot = await mkdtemp(join(tmpdir(), "mcp-source-skills-"));
    for (const name of SKILL_NAMES) {
      await cp(join(name === "core" ? mcpSkillData : cliSkillData, name), join(sourceRoot, name), {
        recursive: true,
      });
    }
  });
  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    if (gateway) {
      await gateway.close();
      gateway.server.closeAllConnections();
      await new Promise((resolve) => gateway!.server.close(resolve));
      gateway = undefined;
    }
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = undefined;
    await rm(sourceRoot, { recursive: true, force: true });
  });

  it("preserves invocation controls in parsed Skill frontmatter", async () => {
    const entry = await skillEntry("manual", { "SKILL.md": new TextEncoder().encode(
      "---\nname: manual\ndescription: Manual skill.\ndisable-model-invocation: true\nuser-invocable: false\nargument-hint: '[week]'\n---\nPrivate body\n",
    ) });
    expect(entry.frontmatter).toMatchObject({
      "disable-model-invocation": true, "user-invocable": false, "argument-hint": "[week]",
    });
  });

  it("merges live built-in, user and repository skills and maps invocation controls", async () => {
    const ws = skillWorkspace();
    ws.skill("personal", "weekly", "---\nname: weekly\ndescription: Weekly.\ndisable-model-invocation: true\nuser-invocable: false\nargument-hint: '[week]'\n---\nPrivate body\n");
    ws.skill("team", "ledger");
    await start(sourceRoot, ws.fetcher);
    const client = await connect();
    const listed = await call(client, "skills_read", { repo: "bob/team" });
    expect(listed.isError).toBeUndefined();
    expect(listed.structured.repository).toBe("loaded");
    expect(listed.structured.diagnostics).toEqual([]);
    expect(listed.structured.skills.slice(0, SKILL_NAMES.length).map((s: { name: string }) => s.name)).toEqual(SKILL_NAMES);
    expect(listed.structured.skills.slice(SKILL_NAMES.length)).toEqual([
      { name: "weekly", description: "Weekly.", source: "user", path: ".agents/skills/weekly/SKILL.md", modelInvocable: false, userInvocable: false, argumentHint: "[week]" },
      { name: "ledger", description: "team description.", source: "repository", path: ".agents/skills/ledger/SKILL.md", modelInvocable: true, userInvocable: true },
    ]);
    expect((await call(client, "skills_read", { name: "ledger", repo: "bob/team" })).structured).toMatchObject({ name: "ledger", source: "repository", content: expect.stringContaining("Private body") });
    const userOnly = await call(client, "skills_read", {});
    expect(userOnly.structured.repository).toBe("no-repository");
    expect(userOnly.structured.skills.at(-1).name).toBe("weekly");
    const skillNode = ws.nodes.find((node) => node.name === "SKILL.md" && node.spaceId === "personal")!;
    ws.contents.set(skillNode.resource!.id, new TextEncoder().encode("---\nname: weekly\ndescription: Changed live.\n---\n"));
    skillNode.resource!.byteSize = ws.contents.get(skillNode.resource!.id)!.byteLength;
    expect((await call(client, "skills_read", {})).structured.skills.at(-1).description).toBe("Changed live.");
    ws.requests.length = 0;
    expect((await call(client, "skills_read", { name: "core" })).structured.source).toBe("builtin");
    expect(ws.requests.filter((path) => path.startsWith("/api/spaces"))).toEqual([]);
  });

  it("shadows the user once and reserves built-in names", async () => {
    const ws = skillWorkspace();
    ws.skill("personal", "report");
    ws.skill("personal", "sheet");
    ws.skill("team", "report");
    await start(sourceRoot, ws.fetcher);
    const client = await connect();
    const listed = await call(client, "skills_read", { repo: "bob/team" });
    expect(listed.structured.skills.filter((s: { name: string }) => s.name === "report")).toEqual([
      expect.objectContaining({ source: "repository" }),
    ]);
    expect(listed.structured.skills.find((s: { name: string }) => s.name === "sheet").source).toBe("builtin");
    expect(listed.structured.diagnostics).toEqual([
      { source: "user", path: ".agents/skills/sheet/SKILL.md", problem: "reserved-name" },
      { source: "user", path: ".agents/skills/report/SKILL.md", problem: "shadowed" },
    ]);
    ws.requests.length = 0;
    expect((await call(client, "skills_read", { name: "report", repo: "bob/team" })).structured.source).toBe("repository");
    const personalFolder = ws.nodes.find((n) => n.name === "report" && n.spaceId === "personal")!;
    expect(ws.requests).not.toContain(`/api/nodes/${personalFolder.id}/children`);
  });

  it("diagnoses invalid metadata, oversized and unavailable skill files without body text", async () => {
    const ws = skillWorkspace();
    ws.skill("personal", "bad-name", "---\nname: other\ndescription: Valid.\n---\nSECRET BODY\n");
    ws.skill("personal", "missing", "---\nname: missing\n---\nSECRET BODY\n");
    ws.skill("personal", "large", "x".repeat(64 * 1024 + 1));
    ws.skill("personal", "quarantined");
    ws.nodes.find((n) => n.parentNodeId === ws.nodes.find((n) => n.name === "quarantined")!.id)!.resource!.availability = "quarantined";
    ws.skill("personal", "invalid-utf", new TextDecoder("latin1").decode(new Uint8Array([255])));
    const utfNode = ws.nodes.at(-1)!;
    ws.contents.set(utfNode.resource!.id, new Uint8Array([255]));
    utfNode.resource!.byteSize = 1;
    ws.skill("personal", "nul", "\0");
    await start(sourceRoot, ws.fetcher);
    const client = await connect();
    const listed = await call(client, "skills_read", {});
    expect(listed.structured.skills).toHaveLength(SKILL_NAMES.length);
    expect(listed.structured.diagnostics).toHaveLength(6);
    expect(listed.structured.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ".agents/skills/bad-name/SKILL.md", problem: "invalid-skill", detail: expect.stringContaining("match") }),
      expect.objectContaining({ path: ".agents/skills/missing/SKILL.md", problem: "invalid-skill", detail: expect.stringContaining("description") }),
      { source: "user", path: ".agents/skills/large/SKILL.md", problem: "too-large" },
    ]));
    expect(JSON.stringify(listed.structured.diagnostics)).not.toContain("SECRET BODY");
    for (const diagnostic of listed.structured.diagnostics) expect(diagnostic.detail?.length ?? 0).toBeLessThanOrEqual(300);
    const large = ws.nodes.find((n) => n.parentNodeId === ws.nodes.find((n) => n.name === "large")!.id)!;
    expect(ws.requests).not.toContain(`/api/resources/${large.resource!.id}`);
    expect((await call(client, "skills_read", { name: "bad-name" })).isError).toBe(true);
  });

  it("skips non-members, propagates missing repositories and loads a personal repository once", async () => {
    const ws = skillWorkspace();
    ws.skill("team", "ledger");
    ws.repository.affiliation = "none";
    ws.skill("personal", "weekly");
    await start(sourceRoot, ws.fetcher);
    const client = await connect();
    const listed = await call(client, "skills_read", { repo: "bob/team" });
    expect(listed.structured.repository).toBe("not-member");
    expect(listed.structured.skills.map((s: { name: string }) => s.name)).not.toContain("ledger");
    expect((await call(client, "skills_read", { name: "ledger", repo: "bob/team" })).isError).toBe(true);
    expect(ws.requests).not.toContain("/api/spaces/team/nodes");
    expect((await call(client, "skills_read", { repo: "bob/missing" })).structured.code).toBe("workspace-not-found");
    ws.requests.length = 0;
    const personal = await call(client, "skills_read", { repo: "alice/personal" });
    expect(personal.structured.skills.at(-1).source).toBe("repository");
    expect(ws.requests.filter((path) => path === "/api/spaces/personal/nodes")).toHaveLength(1);
  });

  it("serves only manifest text, classifies PNG as binary and pages with repository-bound cursors", async () => {
    const ws = skillWorkspace();
    const root = ws.skill("team", "ledger");
    ws.file(root, "references/guide.md", "Guide text");
    ws.file(root, "scripts/run.js", "console.log('ok')");
    ws.file(root, "image.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), { mediaType: "image/png" });
    const long = 'A line with "quotes" and 😀\n'.repeat(5000);
    ws.file(root, "references/long.md", long);
    await start(sourceRoot, ws.fetcher);
    const client = await connect();
    const args = { repo: "bob/team", name: "ledger" };
    const read = await call(client, "skills_read", args);
    expect(read.isError).toBeUndefined();
    expect(read.structured.resources.map((r: { path: string }) => r.path)).toEqual(["references/guide.md", "references/long.md", "scripts/run.js"]);
    expect(read.structured.resources[0].readCommand).toContain('repo "bob/team"');
    expect(read.structured.binaryFiles).toEqual([{ path: "image.png", byteSize: 9, mediaType: "image/png" }]);
    expect((await call(client, "skills_read", { ...args, resource: "references/guide.md" })).structured.content).toBe("Guide text");
    for (const resource of ["../other/SKILL.md", "image.png", "/references/guide.md"]) {
      expect((await call(client, "skills_read", { ...args, resource })).structured.code).toBe("workspace-argument-invalid");
    }
    expect((await call(client, "skills_read", { ...args, full: true })).structured.code).toBe("workspace-result-too-large");
    let content = "";
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await call(client, "skills_read", { ...args, resource: "references/long.md", ...(cursor ? { cursor } : {}) });
      expect(page.isError).toBeUndefined();
      expect(JSON.stringify(page.structured).length).toBeLessThanOrEqual(LIMIT);
      content += page.structured.content;
      cursor = page.structured.cursor;
      if (pages === 0) {
        expect(page.structured.truncated).toBe(true);
        expect((await call(client, "skills_read", { ...args, repo: "https://workspace.example/spaces/team", resource: "references/long.md", cursor })).isError).toBe(true);
      }
      pages++;
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect(content).toBe(long);
  });

  it("maps api_find onto the reference library and wraps the array in results", async () => {
    await start();
    const client = await connect();
    const reference = createStandardApiReference();
    const both = await call(client, "api_find", {
      terms: ["setValues", "conditionalformat"],
      unit: "sheet",
    });
    expect(both.structured).toEqual({
      results: json(reference.find({ terms: ["setValues", "conditionalformat"], unit: "sheet" })),
    });
    const plain = await call(client, "api_find", { terms: ["setValues"] });
    expect(plain.structured).toEqual({ results: json(reference.find({ terms: ["setValues"] })) });
    expect((await call(client, "api_find", { terms: ["x"], unit: "nope" })).isError).toBe(true);
    expect((await call(client, "api_find", { terms: [] })).isError).toBe(true);
  });

  it("maps api_show onto the reference library, including not-found symbols", async () => {
    await start();
    const client = await connect();
    const symbols = ["FRange.setValues", "ICellData.v", "NoSuchSymbolAnywhere"];
    const shown = await call(client, "api_show", { symbols });
    expect(shown.isError).toBeUndefined();
    expect(shown.structured).toEqual({ results: json(createStandardApiReference().show(symbols)) });
    expect(shown.structured["results"][2]).toMatchObject({ status: "not-found" });
  });

  it("pages a long class through stateless cursors and rejects a cursor for other arguments", async () => {
    await start();
    const client = await connect();
    const symbols = ["FRange"];
    const expected = json(createStandardApiReference().show(symbols))[0] as unknown as {
      groups: { owner: string; relation: string; members: unknown[] }[];
    };
    expect(JSON.stringify({ results: [expected] }).length).toBeGreaterThan(LIMIT);
    const members: unknown[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await call(client, "api_show", {
        symbols,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(page.isError).toBeUndefined();
      expect(JSON.stringify(page.structured).length).toBeLessThanOrEqual(LIMIT);
      expect(page.structured["results"]).toHaveLength(1);
      expect(page.structured["results"][0]).toMatchObject({ kind: "class", name: "FRange" });
      for (const group of page.structured["results"][0].groups) members.push(...group.members);
      cursor = page.structured["cursor"];
      expect(page.structured["truncated"]).toBe(cursor === undefined ? undefined : true);
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBeGreaterThan(1);
    expect(members).toEqual(expected.groups.flatMap((group) => group.members));

    const first = await call(client, "api_show", { symbols });
    const continued = first.structured["cursor"] as string;
    const reused = await call(client, "api_show", { symbols: ["FWorkbook"], cursor: continued });
    expect(reused).toMatchObject({
      isError: true,
      structured: { code: "workspace-argument-invalid" },
    });
    const garbage = await call(client, "api_show", { symbols, cursor: "not-a-cursor" });
    expect(garbage).toMatchObject({
      isError: true,
      structured: { code: "workspace-argument-invalid" },
    });
  });

  it("lists MCP core and shared Skills and preserves fallback get, full and resource reads", async () => {
    await start();
    const client = await connect();
    const listed = await call(client, "skills_read", {});
    expect(listed.structured["skills"].map((skill: { name: string }) => skill.name)).toEqual(
      SKILL_NAMES,
    );
    expect(listed.structured["skills"][3]).toMatchObject({ name: "core" });
    expect(listed.structured["skills"][3].description).toContain(
      "Operate Univer Workspace through MCP tools",
    );

    const core = await call(client, "skills_read", { name: "core" });
    expect(core.structured).toEqual({
      name: "core", source: "builtin", content: await readFile(join(mcpSkillData, "core/SKILL.md"), "utf8"),
    });

    const html = await call(client, "skills_read", { name: "html-view" });
    const skill = html.structured;
    expect(skill["skills"]).toBeUndefined();
    expect(skill["content"]).toBe(await readFile(join(cliSkillData, "html-view/SKILL.md"), "utf8"));
    expect(skill.resources.map((resource: { path: string }) => resource.path)).toEqual(
      [
        ...(await readdir(join(cliSkillData, "html-view/references"))).map((file) => `references/${file}`),
        ...(await readdir(join(cliSkillData, "html-view/templates"))).map((file) => `templates/${file}`),
      ].sort((a, b) => a.localeCompare(b)),
    );
    expect(skill.resources[0].readCommand).toBe(
      `Call skills_read with name "html-view" and resource "${skill.resources[0].path}".`,
    );
    expect(JSON.stringify(skill.resources)).not.toContain("uvw skills");
    expect(skill.files).toBeUndefined();

    const full = await call(client, "skills_read", { name: "core", full: true });
    expect(full.structured).toEqual({ ...core.structured, files: [] });
    const htmlFull = await call(client, "skills_read", { name: "html-view", full: true });
    expect(htmlFull).toMatchObject({
      isError: true,
      structured: { code: "workspace-result-too-large" },
    });

    const templates = [
      "templates/bauhaus-blocks.univer.html",
      "templates/blueprint-timeline.univer.html",
      "templates/broadsheet.univer.html",
      "templates/brutalist-board.univer.html",
      "templates/citron-poster.univer.html",
      "templates/meeting-slides.univer.html",
      "templates/night-gauge.univer.html",
      "templates/swiss-report.univer.html",
      "templates/trading-desk.univer.html",
      "templates/wenkai-notebook.univer.html",
    ];
    expect(skill.resources
      .filter((resource: { path: string }) => resource.path.startsWith("templates/"))
      .map((resource: { path: string }) => resource.path)).toEqual(templates);
    for (const path of templates) {
      const template = await call(client, "skills_read", { name: "html-view", resource: path });
      expect(template.structured).toEqual({
        name: "html-view",
        source: "builtin",
        path,
        content: await readFile(join(cliSkillData, "html-view", path), "utf8"),
      });
    }

    const resource = await call(client, "skills_read", {
      name: "html-view",
      resource: "references/charts.md",
    });
    expect(resource.structured).toEqual({
      name: "html-view",
      source: "builtin",
      path: "references/charts.md",
      content: await readFile(join(cliSkillData, "html-view/references/charts.md"), "utf8"),
    });
  });

  it("rejects unknown Skills, unknown resources and inconsistent arguments", async () => {
    await start();
    const client = await connect();
    for (const args of [
      { name: "nope" },
      { name: "core", resource: "references/missing.md" },
      { resource: "references/charts.md" },
      { full: true },
      { name: "html-view", resource: "references/charts.md", full: true },
      { name: "core", cursor: "x" },
    ]) {
      expect(await call(client, "skills_read", args)).toMatchObject({
        isError: true,
        structured: { code: "workspace-argument-invalid" },
      });
    }
  });

  it("pages a long resource by character, keeps pairs intact, and bounds oversize results", async () => {
    scratch = await mkdtemp(join(tmpdir(), "mcp-skills-"));
    await mkdir(join(scratch, "core/references"), { recursive: true });
    await writeFile(
      join(scratch, "core/SKILL.md"),
      "---\nname: core\ndescription: Test skill.\n---\n\nbody\n",
    );
    const big = `${'line of text, "quoted" and 😀 emoji\n'.repeat(7000)}end`;
    await writeFile(join(scratch, "core/references/big.md"), big);
    await writeFile(join(scratch, "core/references/other.md"), big);
    await start(scratch);
    const client = await connect();
    const args = { name: "core", resource: "references/big.md" };
    let text = "";
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await call(client, "skills_read", {
        ...args,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(page.isError).toBeUndefined();
      expect(JSON.stringify(page.structured).length).toBeLessThanOrEqual(LIMIT);
      text += page.structured["content"];
      cursor = page.structured["cursor"];
      expect(page.structured["truncated"]).toBe(cursor === undefined ? undefined : true);
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBeGreaterThan(2);
    expect(text).toBe(big);

    const first = await call(client, "skills_read", args);
    const other = await call(client, "skills_read", {
      name: "core",
      resource: "references/other.md",
      cursor: first.structured["cursor"],
    });
    expect(other).toMatchObject({
      isError: true,
      structured: { code: "workspace-argument-invalid" },
    });

    const tooLarge = await call(client, "skills_read", { name: "core", full: true });
    expect(tooLarge).toMatchObject({
      isError: true,
      structured: { code: "workspace-result-too-large" },
    });
    expect(tooLarge.structured["message"]).toContain("without full");
    expect(tooLarge.structured["message"]).toContain("resource");
    expect(tooLarge.structured["message"]).toContain("cursor");
  });

  it.each(["legacy", { pin: "2026-07-28" }] as const)(
    "advertises the Skill catalog and server instructions in %j",
    async (mode) => {
      await start();
      const client = await connect(mode);
      const instructions = client.getInstructions()!;
      expect(instructions).toContain(
        `Creating tools take an idempotency_key. ${IDEMPOTENCY_KEY_DESCRIPTION}`,
      );
      for (const word of ["pull request", "ready", "review", "merg", "api_find", "skills_read"]) {
        expect(instructions).toContain(word);
      }
      expect(instructions).toContain("not in this connection's tool list");
      expect(instructions).not.toMatch(/\buvw\b/u);
      expect(instructions).toContain("skill://univer-workspace/core/SKILL.md");
      expect(instructions).toContain("tell the user");
      expect(instructions).toContain("?toolsets=admin");
      expect(client.getServerCapabilities()?.extensions).toHaveProperty(SKILLS_EXTENSION_ID);
      const extension = new SkillsClient(client);
      expect(extension.supported).toBe(true);
      const { skills: entries } = await extension.list();
      expect(entries.map(({ frontmatter: { name } }) => name)).toEqual(SKILL_NAMES);
      expect((await call(client, "skills_read", {})).structured["skills"]).toEqual(
        entries.map(({ frontmatter: { name, description } }) => ({ name, description, source: "builtin", modelInvocable: true, userInvocable: true })),
      );
      expect(await readFile(join(mcpSkillData, "core/SKILL.md"), "utf8")).not.toBe(
        await readFile(join(cliSkillData, "core/SKILL.md"), "utf8"),
      );
      const listed = (await client.listResources()).resources;
      expect(listed.map(({ uri }) => uri).sort()).toEqual(entries.map(({ uri }) => uri).sort());
      const read = await client.readResource({ uri: "skill://univer-workspace/core/SKILL.md" });
      expect(read.contents).toEqual([
        {
          uri: "skill://univer-workspace/core/SKILL.md",
          mimeType: "text/markdown",
          text: await readFile(join(mcpSkillData, "core/SKILL.md"), "utf8"),
        },
      ]);
      const reference = await client.readResource({
        uri: "skill://univer-workspace/board/references/board-spec.md",
      });
      expect(reference.contents[0]).toMatchObject({
        text: await readFile(join(cliSkillData, "board/references/board-spec.md"), "utf8"),
      });
      await expect(
        client.readResource({ uri: "skill://univer-workspace/core/references/missing.md" }),
      ).rejects.toThrow();
      await expect(
        client.readResource({ uri: "skill://univer-workspace/core/../../package.json" }),
      ).rejects.toThrow();
    },
  );

  describe.each(["legacy", { pin: "2026-07-28" }] as const)("Skill files in %j", (mode) => {
    it.each(SKILL_NAMES)("serves every file for %s with verified bytes and fallback content", async (name) => {
      await start();
      const client = await connect(mode);
      const extension = new SkillsClient(client);
      const { skills: entries } = await extension.list();
      const entry = entries.find(({ frontmatter }) => frontmatter.name === name);
      expect(entry).toBeDefined();
      if (entry === undefined) throw new Error("Expected published Skill");
      expect(entry.uri).toBe(`skill://univer-workspace/${entry.frontmatter.name}/SKILL.md`);
      expect(Array.isArray(entry.resources)).toBe(true);
      if (!Array.isArray(entry.resources)) throw new Error("Expected static resources");
      const expectedFiles = ["SKILL.md"];
      for (const child of ["references", "templates"]) {
        const files = await readdir(join(sourceRoot, entry.frontmatter.name, child)).catch(
          () => [],
        );
        expectedFiles.push(...files.map((file) => `${child}/${file}`));
      }
      expect(entry.resources.map(({ uri }) => uri).sort()).toEqual(
        expectedFiles
          .map((path) => `skill://univer-workspace/${entry.frontmatter.name}/${path}`)
          .sort(),
      );
      for (const resource of entry.resources) {
        const path = resource.uri.slice(
          `skill://univer-workspace/${entry.frontmatter.name}/`.length,
        );
        const bytes = await readFile(join(sourceRoot, entry.frontmatter.name, path));
        expect(resource.digest).toBe(
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        );
        const served = await extension.read(entry, path);
        expect(served.verified).toBe(true);
        expect(Buffer.from(served.bytes)).toEqual(bytes);
      }
      const fallback = await call(client, "skills_read", { name: entry.frontmatter.name });
      expect(fallback.structured["content"]).toBe(
        await readFile(join(sourceRoot, entry.frontmatter.name, "SKILL.md"), "utf8"),
      );
    });
  });

  it("keeps published digests and fallback bytes stable after source changes", async () => {
    await start();
    const client = await connect();
    const extension = new SkillsClient(client);
    const { skill } = await extension.get("skill://univer-workspace/core/SKILL.md");
    const original = await readFile(join(sourceRoot, "core/SKILL.md"), "utf8");
    await writeFile(join(sourceRoot, "core/SKILL.md"), `${original}\nChanged after startup.\n`);
    expect((await extension.read(skill)).text).toBe(original);
    expect(
      (await call(client, "skills_read", { name: "core" })).structured["content"],
    ).toBe(original);
  });

  it("keeps the gateway's Skill list in step with apps/cli/skill-data", async () => {
    const directories = (await readdir(cliSkillData, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect([...SKILL_NAMES].sort()).toEqual(directories.sort());
  });
});
