import { testStagingDirectory } from "./staging-directory.js";
import * as fs from "node:fs/promises";
import { once } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { ResourceLibrary } from "@univer-cli/resource-library";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway/server.js";
import { openResourceLibrary } from "../src/gateway/resources.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { adminNames } from "./tool-names.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

const LIMIT = 100_000;
const authFetcher: typeof fetch = async () =>
  Response.json({ authenticated: true, user: { id: "user-1", displayName: "alice" } });
const svg = (padding: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><desc>${"x".repeat(padding)}</desc><path d="M0 0h10v10z"/></svg>`;

describe("SVG resource tools", () => {
  let gateway: ReturnType<typeof createGateway> | undefined;
  let client: Client | undefined;
  let cacheRoot = "";
  let library: ResourceLibrary;
  let logs = "";
  const outsideDirectories: string[] = [];
  const downloads: string[] = [];

  async function start(padding: number, groupWritable = false) {
    cacheRoot = await mkdtemp(join(tmpdir(), "mcp-resources-test-"));
    if (groupWritable) await chmod(cacheRoot, 0o770);
    library = openResourceLibrary(cacheRoot, {
      fetch: async (input) => {
        downloads.push(String(input));
        return new Response(svg(padding), { headers: { "content-type": "image/svg+xml" } });
      },
    });
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP server");
    const port = address.port;
    await new Promise((resolve) => socket.close(resolve));
    const url = `http://127.0.0.1:${String(port)}/mcp`;
    gateway = createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: "https://workspace.example",
        MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url,
      }),
      {
        logger: pino(
          new Writable({
            write(chunk, _encoding, callback) {
              logs += String(chunk);
              callback();
            },
          }),
        ),
        fetcher: authFetcher,
        resourceLibrary: library,
      },
    );
    gateway.server.listen(port, "127.0.0.1");
    await once(gateway.server, "listening");
    client = new Client({ name: "resources-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}?toolsets=all`), {
        requestInit: { headers: { Authorization: "Bearer test-session" } },
      }),
    );
  }
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client!.callTool({ name, arguments: args });
    return { ...result, structured: result.structuredContent as Record<string, any> };
  }
  afterEach(async () => {
    vi.mocked(fs.open).mockReset();
    vi.mocked(fs.open).mockImplementation(
      (await vi.importActual<typeof fs>("node:fs/promises")).open,
    );
    await client?.close();
    client = undefined;
    if (gateway) {
      await gateway.close();
      gateway.server.closeAllConnections();
      await new Promise((resolve) => gateway!.server.close(resolve));
      gateway = undefined;
    }
    await rm(cacheRoot, { recursive: true, force: true });
    for (const directory of outsideDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
    logs = "";
    downloads.length = 0;
  });

  it("lists the admin tools in order with read-only annotations", async () => {
    await start(0);
    const tools = (await client!.listTools()).tools;
    expect(tools.map((tool) => tool.name).slice(-3)).toEqual(adminNames.slice(-3));
    for (const tool of tools.slice(-3)) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("wraps the registries and the find result like the CLI's JSON", async () => {
    await start(0);
    const registries = await call("resources_registries", {});
    expect(registries.structured).toEqual({ registries: library.listRegistries() });
    const found = await call("resources_find", {
      query: "arrow",
      registry: "example-openmoji-color",
      limit: 2,
    });
    const expected = library.find({
      queries: ["arrow"],
      registries: ["example-openmoji-color"],
      limit: 2,
    });
    expect(found.structured).toEqual({
      query: { queries: ["arrow"], registries: ["example-openmoji-color"] },
      resources: JSON.parse(JSON.stringify(expected.resources)),
      total: expected.total,
      limit: 2,
    });
    const defaults = await call("resources_find", { query: "arrow" });
    expect(defaults.structured["limit"]).toBe(30);
    expect(defaults.structured["query"]).toEqual({ queries: ["arrow"], registries: [] });
  });

  it("returns library errors as tool errors with their code", async () => {
    await start(0);
    const unknown = await call("resources_find", { query: "arrow", registry: "nope" });
    expect(unknown.isError).toBe(true);
    expect(unknown.structured["code"]).toBe("resource-registry-not-found");
    expect((await call("resources_find", { query: "arrow", limit: 0 })).structured["code"]).toBe(
      "workspace-argument-invalid",
    );
  });

  it("exports SVG text, reports failed handles and writes nothing but the cache", async () => {
    await start(0);
    const [first] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    const result = await call("resources_export", {
      handles: ["bad", first!.handle, "example-openmoji-color/zzzz"],
    });
    expect(result.structured["resources"]).toEqual([{ handle: first!.handle, svg: svg(0) }]);
    expect(result.structured["failed"]).toEqual([
      expect.objectContaining({ handle: "bad", code: "resource-invalid-handle" }),
      expect.objectContaining({
        handle: "example-openmoji-color/zzzz",
        code: "resource-not-found",
      }),
    ]);
    expect(result.structured["truncated"]).toBeUndefined();
    expect(await readdir(cacheRoot)).toEqual([first!.registryId]);
  });

  async function expectUnsafe(handles: string[]) {
    const result = await call("resources_export", { handles });
    expect(result.isError).toBe(true);
    expect(result.structured["code"]).toBe("workspace-resource-cache-unsafe");
    expect(JSON.stringify(result)).not.toContain("private-outside-svg");
    expect(logs).not.toContain("private-outside-svg");
    expect(logs).toContain("Tool failed internally");
    expect(logs).toContain('"outcome":"internal_error"');
  }

  it("refuses a cached registry replaced by a symlink without serving or logging the outside SVG", async () => {
    await start(0);
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    await call("resources_export", { handles: [item!.handle] });
    const outside = await mkdtemp(join(tmpdir(), "mcp-outside-"));
    outsideDirectories.push(outside);
    await writeFile(
      join(outside, `${item!.id}.svg`),
      "<svg><desc>private-outside-svg</desc></svg>",
    );
    const registry = join(cacheRoot, item!.registryId);
    await rm(registry, { recursive: true });
    await symlink(outside, registry);
    await expectUnsafe([item!.handle]);
  });

  it("refuses a file symlink inside a registry", async () => {
    await start(0);
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    const outside = await mkdtemp(join(tmpdir(), "mcp-outside-"));
    outsideDirectories.push(outside);
    const outsideSvg = join(outside, "private.svg");
    await writeFile(outsideSvg, "<svg><desc>private-outside-svg</desc></svg>");
    await mkdir(join(cacheRoot, item!.registryId), { mode: 0o700 });
    await symlink(outsideSvg, join(cacheRoot, `${item!.handle}.svg`));
    await expectUnsafe([item!.handle]);
    expect(downloads).toEqual([]);
  });

  it("refuses a group-writable root before reading or downloading", async () => {
    await start(0);
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    await chmod(cacheRoot, 0o770);
    await expectUnsafe([item!.handle]);
    expect(downloads).toEqual([]);
  });

  it("keeps listing and search available with an unsafe configured cache", async () => {
    await start(0, true);
    expect(
      (await call("resources_registries", {})).structured["registries"].length,
    ).toBeGreaterThan(0);
    const result = await call("resources_find", { query: "arrow", limit: 1 });
    expect(result.structured["resources"]).toHaveLength(1);
    await expectUnsafe([result.structured["resources"][0].handle]);
    expect(downloads).toEqual([]);
  });

  it("recreates a deleted cache root between exports", async () => {
    await start(0);
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    await call("resources_export", { handles: [item!.handle] });
    await rm(cacheRoot, { recursive: true });
    const result = await call("resources_export", { handles: [item!.handle] });
    expect(result.structured["resources"]).toEqual([{ handle: item!.handle, svg: svg(0) }]);
    expect((await lstat(cacheRoot)).mode & 0o777).toBe(0o700);
  });

  it.each(["EACCES", "ENOSPC", "EMFILE", "EIO"])(
    "logs %s as an internal I/O error with its cause",
    async (code) => {
      await start(0);
      const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
      await call("resources_export", { handles: [item!.handle] });
      const cause = Object.assign(new Error(`${code}: cache open failed`), { code });
      vi.mocked(fs.open).mockRejectedValueOnce(cause);
      await expect(library.read({ handle: item!.handle })).rejects.toHaveProperty("cause", cause);
      vi.mocked(fs.open).mockRejectedValueOnce(cause);
      const result = await call("resources_export", { handles: [item!.handle] });
      expect(result.isError).toBe(true);
      expect(result.structured["code"]).toBe("workspace-internal-error");
      expect(logs).toContain(`${code}: cache open failed`);
      expect(logs).toContain('"outcome":"internal_error"');
      expect(JSON.stringify(result)).not.toContain(code);
      expect(logs).not.toContain(svg(0));
    },
  );

  it("refuses an inode swapped between lstat and open", async () => {
    await start(0);
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    await call("resources_export", { handles: [item!.handle] });
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementationOnce(async (path, flags, mode) => {
      const replacement = join(cacheRoot, "replacement.svg");
      await writeFile(replacement, "<svg><desc>private-outside-svg</desc></svg>");
      await fs.rename(replacement, path);
      return original.open(path, flags, mode);
    });
    await expectUnsafe([item!.handle]);
  });

  it("creates private registry directories and exports a normal cached SVG", async () => {
    await start(0);
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    for (let count = 0; count < 2; count += 1) {
      const result = await call("resources_export", { handles: [item!.handle] });
      expect(result.structured["resources"]).toEqual([{ handle: item!.handle, svg: svg(0) }]);
    }
    expect(downloads).toHaveLength(1);
    expect((await lstat(join(cacheRoot, item!.registryId))).mode & 0o777).toBe(0o700);
  });

  it("pages an export that exceeds the result limit and rejects a foreign cursor", async () => {
    await start(30_000);
    const handles = library.find({ queries: ["arrow"], limit: 5 }).resources.map((r) => r.handle);
    const first = await call("resources_export", { handles });
    expect(JSON.stringify(first.structured).length).toBeLessThanOrEqual(LIMIT);
    expect(first.structured["truncated"]).toBe(true);
    const seen = [...first.structured["resources"]];
    let cursor = first.structured["cursor"] as string | undefined;
    while (cursor !== undefined) {
      const page = await call("resources_export", { handles, cursor });
      expect(JSON.stringify(page.structured).length).toBeLessThanOrEqual(LIMIT);
      seen.push(...page.structured["resources"]);
      cursor = page.structured["cursor"];
    }
    expect(seen.map((r) => r.handle)).toEqual(handles);
    const foreign = await call("resources_export", {
      handles: handles.slice(1),
      cursor: first.structured["cursor"],
    });
    expect(foreign.isError).toBe(true);
    expect(foreign.structured["code"]).toBe("workspace-argument-invalid");
  });

  it("reports a single SVG larger than the limit as too large", async () => {
    await start(120_000);
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    const result = await call("resources_export", { handles: [item!.handle] });
    expect(result.isError).toBe(true);
    expect(result.structured["code"]).toBe("workspace-result-too-large");
  });
});
