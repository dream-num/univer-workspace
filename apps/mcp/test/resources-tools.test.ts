import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  createNodeResourceLibraryFactory,
  type ResourceLibrary,
} from "@univer-cli/resource-library";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway/server.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { adminNames } from "./tool-names.js";

const LIMIT = 100_000;
const manifestPath = createRequire(import.meta.url).resolve("@univerjs-pro/cli-assets/manifest.json");
const authFetcher: typeof fetch = async () =>
  Response.json({ authenticated: true, user: { id: "user-1", displayName: "alice" } });
const svg = (padding: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><desc>${"x".repeat(padding)}</desc><path d="M0 0h10v10z"/></svg>`;

describe("SVG resource tools", () => {
  let gateway: ReturnType<typeof createGateway> | undefined;
  let client: Client | undefined;
  let cacheRoot = "";
  let library: ResourceLibrary;
  const downloads: string[] = [];

  async function start(padding: number) {
    cacheRoot = await mkdtemp(join(tmpdir(), "mcp-resources-test-"));
    library = createNodeResourceLibraryFactory({
      manifestPath,
      cacheRoot,
      downloader: {
        fetch: async (input) => {
          downloads.push(String(input));
          return new Response(svg(padding), { headers: { "content-type": "image/svg+xml" } });
        },
      },
    })();
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
        MCP_PUBLIC_URL: url,
      }),
      { logger: pino({ level: "silent" }), fetcher: authFetcher, resourceLibrary: library },
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
    await client?.close();
    client = undefined;
    if (gateway) {
      await gateway.close();
      gateway.server.closeAllConnections();
      await new Promise((resolve) => gateway!.server.close(resolve));
      gateway = undefined;
    }
    await rm(cacheRoot, { recursive: true, force: true });
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
    const found = await call("resources_find", { query: "arrow", registry: "example-openmoji-color", limit: 2 });
    const expected = library.find({ queries: ["arrow"], registries: ["example-openmoji-color"], limit: 2 });
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
    const foreign = await call("resources_export", { handles: handles.slice(1), cursor: first.structured["cursor"] });
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
