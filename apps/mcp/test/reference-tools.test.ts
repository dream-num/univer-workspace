import { testStagingDirectory } from "./staging-directory.js";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SkillsClient, SKILLS_EXTENSION_ID } from "@modelcontextprotocol/client/ext/skills";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createStandardApiReference } from "@univer-cli/api-reference";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateway } from "./gateway.js";
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
const fetcher: typeof fetch = async () =>
  Response.json({ authenticated: true, user: { id: "user-1", displayName: "alice" } });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("API reference, Skills, resources and server instructions", () => {
  let gateway: ReturnType<typeof createGateway> | undefined;
  let url = "";
  let clients: Client[] = [];
  let scratch: string | undefined;
  let sourceRoot: string;

  async function start(skillDataRoot = sourceRoot) {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP server");
    const port = address.port;
    await new Promise((resolve) => socket.close(resolve));
    url = `http://127.0.0.1:${String(port)}/mcp`;
    gateway = createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: "https://workspace.example",
        MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url,
      }),
      { logger: pino({ level: "silent" }), fetcher, skillDataRoot },
    );
    gateway.server.listen(port, "127.0.0.1");
    await once(gateway.server, "listening");
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
      name: "core", content: await readFile(join(mcpSkillData, "core/SKILL.md"), "utf8"),
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

    const full = await call(client, "skills_read", { name: "html-view", full: true });
    expect(full.structured["files"]).toHaveLength(skill.resources.length);

    const template = await call(client, "skills_read", {
      name: "html-view",
      resource: "templates/planning.univer.html",
    });
    expect(template.structured).toEqual({
      name: "html-view",
      path: "templates/planning.univer.html",
      content: await readFile(join(cliSkillData, "html-view/templates/planning.univer.html"), "utf8"),
    });

    const resource = await call(client, "skills_read", {
      name: "html-view",
      resource: "references/charts.md",
    });
    expect(resource.structured).toEqual({
      name: "html-view",
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
    "serves every Skill file as an MCP resource and the instructions in %j",
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
        entries.map(({ frontmatter: { name, description } }) => ({ name, description })),
      );
      for (const entry of entries) {
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
      }
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
