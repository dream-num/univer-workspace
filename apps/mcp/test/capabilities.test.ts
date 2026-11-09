import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport, ProtocolError } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway/server.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { adminNames, coreNames, filesNames } from "./tool-names.js";
import { testStagingDirectory } from "./staging-directory.js";

const token = "internal-capabilities-token-".repeat(2);
const allOperations = Object.keys(opSpecs);
const renderTools = ["screenshot", "print_pdf", "lint"];
const executorTools = [
  "execute",
  "inspect",
  "screenshot",
  "import",
  "export",
  "html_view_validate",
  "html_view_create",
  "compile_markdown",
  "export_markdown",
  "compile_typst",
  "compile_svg",
  "print_pdf",
  "lint",
];
const allNames = [...coreNames, ...filesNames, ...adminNames];
const combinations = ["core", "files", "admin", "core,files", "core,admin", "files,admin", "all"];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
function replica(operations = allOperations, v = PROTOCOL_VERSION) {
  return { operations, v, status: 200, calls: 0, rpcCalls: 0 };
}
async function start(replicas: ReturnType<typeof replica>[] = []) {
  const urls: string[] = [];
  for (const declaration of replicas) {
    const server = createServer((request, response) => {
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      if (request.url === "/rpc/v1/capabilities") {
        declaration.calls++;
        response.writeHead(declaration.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ v: declaration.v, operations: declaration.operations }));
      } else {
        declaration.rpcCalls++;
        request.resume();
        response.writeHead(503).end();
      }
    });
    urls.push(await listen(server));
    cleanup.push(() => close(server));
  }
  const reservation = createServer();
  const origin = await listen(reservation);
  await close(reservation);
  const gateway = createGateway(
    parseGatewayConfig({
      MCP_DEV_SESSION_PASSTHROUGH: "1",
      WORKSPACE_ORIGIN: "https://workspace.test",
      MCP_PUBLIC_URL: `${origin}/mcp`,
      MCP_STAGING_DIRECTORY: testStagingDirectory(),
      ...(urls.length ? { MCP_EXECUTOR_URLS: urls.join(","), MCP_INTERNAL_TOKEN: token } : {}),
    }),
    {
      logger: pino({ level: "silent" }),
      fetcher: async () =>
        Response.json({ authenticated: true, user: { id: "user", displayName: "User" } }),
    },
  );
  gateway.server.listen(Number(new URL(origin).port), "127.0.0.1");
  await once(gateway.server, "listening");
  cleanup.push(async () => {
    await gateway.close();
    await close(gateway.server);
  });
  return async (toolsets: string, mode: "legacy" | { pin: string } = { pin: "2026-07-28" }) => {
    const client = new Client(
      { name: "capabilities-test", version: "1" },
      { versionNegotiation: { mode } },
    );
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp?toolsets=${toolsets}`), {
        requestInit: { headers: { authorization: "Bearer session" } },
      }),
    );
    return client;
  };
}
function selectedNames(toolsets: string) {
  return [
    ...(toolsets === "all" || toolsets.includes("core") ? coreNames : []),
    ...(toolsets === "all" || toolsets.includes("files") ? filesNames : []),
    ...(toolsets === "all" || toolsets.includes("admin") ? adminNames : []),
  ];
}

describe("capabilities through MCP tools/list and initialize", () => {
  it.each(["full", "no-renderer", "no-executor"])(
    "preserves tool order and names only visible tools for %s",
    async (deployment) => {
      const hidden =
        deployment === "full"
          ? []
          : deployment === "no-renderer"
            ? renderTools
            : [...executorTools, "job_get"];
      const connect = await start(
        deployment === "no-executor"
          ? []
          : [
              replica(
                allOperations.filter(
                  (name) => deployment === "full" || !name.startsWith("render."),
                ),
              ),
            ],
      );
      for (const mode of ["legacy", { pin: "2026-07-28" }] as const) {
        for (const combination of combinations) {
          const client = await connect(combination, mode);
          const names = (await client.listTools()).tools.map((tool) => tool.name);
          expect(names).toEqual(
            selectedNames(combination).filter((name) => !hidden.includes(name)),
          );
          const instructions = client.getInstructions()!;
          for (const name of allNames.filter((name) => !names.includes(name))) {
            expect(instructions).not.toMatch(new RegExp(`\\b${name}\\b`));
          }
          if (combination === "core,admin") {
            expect(instructions).toContain("?toolsets=files");
            if (deployment === "full")
              expect(instructions).toContain("PDF, Markdown, Typst, SVG, HTML View, Blob");
            if (deployment === "no-renderer") {
              expect(instructions).not.toContain("PDF");
              expect(instructions).toContain("Markdown, Typst, SVG, HTML View, Blob");
            }
          }
        }
      }
    },
  );

  it.each(["no-renderer", "no-executor"])(
    "rejects hidden tools exactly like unknown names for %s",
    async (deployment) => {
      const connect = await start(
        deployment === "no-executor"
          ? []
          : [replica(allOperations.filter((name) => !name.startsWith("render.")))],
      );
      const client = await connect("all");
      const callError = async (name: string) => {
        try {
          await client.callTool({ name, arguments: {} });
        } catch (error) {
          if (error instanceof ProtocolError)
            return { code: error.code, message: error.message, data: error.data };
          throw error;
        }
        throw new Error("Expected an unknown-tool error");
      };
      const unknown = await callError("unknown");
      for (const name of deployment === "no-executor"
        ? [...executorTools, "job_get"]
        : renderTools) {
        const result = await callError(name);
        expect(JSON.stringify(result).replaceAll(name, "unknown")).toBe(JSON.stringify(unknown));
      }
    },
  );

  it("intersects compatible replicas and excludes incompatible replicas from routing", async () => {
    const full = replica();
    const compatible = replica(allOperations.filter((name) => name !== "svg.compile"));
    const incompatible = replica([], PROTOCOL_VERSION + 1);
    const connect = await start([full, compatible, incompatible]);
    const client = await connect("all");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      allNames.filter((name) => name !== "compile_svg"),
    );
    await client.callTool({
      name: "inspect",
      arguments: { trunk: true, unit: "unit", target: "workbook" },
    });
    expect(full.rpcCalls).toBe(1);
    expect(compatible.rpcCalls).toBe(1);
    expect(incompatible.rpcCalls).toBe(0);
    expect(compatible.calls).toBe(1);
  });

  it("shows job polling when any conversion operation is available", async () => {
    for (const operation of ["exchange.import", "exchange.export", "typst.compile"]) {
      const connect = await start([replica([operation])]);
      const client = await connect("all");
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("job_get");
    }
    const client = await (await start([replica(["svg.compile"])]))("all");
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("job_get");
  });

  it("starts empty after a failed discovery, refreshes periodically, and retains the last known set on failure", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const declaration = replica();
    declaration.status = 503;
    const client = await (await start([declaration]))("all");
    const names = async () => (await client.listTools()).tools.map((tool) => tool.name);
    expect(await names()).toEqual(
      allNames.filter((name) => ![...executorTools, "job_get"].includes(name)),
    );
    declaration.status = 200;
    await vi.advanceTimersByTimeAsync(60_000);
    await expect.poll(names).toEqual(allNames);
    declaration.status = 503;
    await vi.advanceTimersByTimeAsync(60_000);
    await expect.poll(() => declaration.calls).toBe(3);
    expect(await names()).toEqual(allNames);
    declaration.status = 200;
    declaration.operations = allOperations.filter((name) => !name.startsWith("render."));
    await vi.advanceTimersByTimeAsync(60_000);
    await expect.poll(names).toEqual(allNames.filter((name) => !renderTools.includes(name)));
    declaration.v = PROTOCOL_VERSION + 1;
    await vi.advanceTimersByTimeAsync(60_000);
    await expect
      .poll(names)
      .toEqual(allNames.filter((name) => ![...executorTools, "job_get"].includes(name)));
  });
});
