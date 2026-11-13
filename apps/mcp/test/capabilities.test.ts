import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport, ProtocolError } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { adminNames, coreNames, filesNames } from "./tool-names.js";
import { testStagingDirectory } from "./staging-directory.js";
import { TOOL_SCOPE_META } from "../src/gateway/tools/definition.js";
import { tools } from "../src/gateway/tools/registry.js";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../src/gateway/tools/schemas.js";

const token = "internal-capabilities-token-".repeat(2);
const allOperations = Object.keys(opSpecs);
const renderTools = ["screenshot", "print_pdf", "lint"];
const executorTools = [
  "execute",
  "inspect",
  "outline",
  "read",
  "find",
  "screenshot",
  "import",
  "export",
  "html_view_validate",
  "html_view_create",
  "html_view_replace",
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
async function start(replicas: ReturnType<typeof replica>[] = [], allowedUserIds?: string) {
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
  const { gateway, url } = await listenGateway((url) =>
    createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: "https://workspace.test",
        MCP_PUBLIC_URL: url,
        MCP_STAGING_DIRECTORY: testStagingDirectory(),
        ...(allowedUserIds === undefined ? {} : { MCP_EXECUTOR_ALLOWED_USER_IDS: allowedUserIds }),
        ...(urls.length ? { MCP_EXECUTOR_URLS: urls.join(","), MCP_EXECUTOR_TOKEN: token } : {}),
      }),
      {
        logger: pino({ level: "silent" }),
        fetcher: async (_url, init) =>
          Response.json({
            authenticated: true,
            user: {
              id:
                new Headers(init?.headers).get("cookie") === "workspace_session=listed"
                  ? "listed"
                  : "user",
              displayName: "User",
            },
          }),
      },
    ),
  );
  cleanup.push(async () => {
    await gateway.close();
    await close(gateway.server);
  });
  return async (
    toolsets: string | undefined,
    mode: "legacy" | { pin: string } = { pin: "2026-07-28" },
    session = "session",
  ) => {
    const client = new Client(
      { name: "capabilities-test", version: "1" },
      { versionNegotiation: { mode } },
    );
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}${toolsets === undefined ? "" : `?toolsets=${toolsets}`}`), {
        requestInit: { headers: { authorization: `Bearer ${session}` } },
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
async function callError(client: Client, name: string) {
  try {
    await client.callTool({ name, arguments: {} });
  } catch (error) {
    if (error instanceof ProtocolError)
      return { code: error.code, message: error.message, data: error.data };
    throw error;
  }
  throw new Error("Expected an unknown-tool error");
}

describe("capabilities through MCP tools/list and initialize", () => {
  it.each(["legacy", { pin: "2026-07-28" }] as const)("advertises every registered scope in tools/list (%j)", async (mode) => {
    const client = await (await start([replica()]))("all", mode);
    const listed = (await client.listTools()).tools;
    for (const tool of tools) {
      expect(listed.find(({ name }) => name === tool.name)?._meta?.[TOOL_SCOPE_META], tool.name).toBe(tool.scope);
    }
  });

  it("offers page creation and revision on a connection without a toolsets query", async () => {
    const client = await (await start([replica()]))(undefined);
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(coreNames);
    const text = client.getInstructions();
    expect(text).toContain("A page is an HTML View (.univer.html) bound to live Sheets.");
    expect(text).toContain("It is not a Slide, Board or other Unit and does not go through pull requests.");
    expect(text).toContain("only save a draft");
    expect(text).toContain("give the user draft.previewUrl");
    expect(text).toContain("Before saying whether a page is live or still a draft");
    expect(text).toContain("call html_view_draft_get");
    expect(text).toContain("On rejected, ask what to change.");
    expect(text).toContain("html_view_read then html_view_replace");
  });

  it("stops page requests when publishing is unavailable", async () => {
    const client = await (await start())(undefined);
    expect(client.getInstructions()).toContain("This connection cannot draft pages (.univer.html). When asked for one, say so and stop. Never build a Slide, Board or other Unit instead.");
  });

  it("lists the selector syntax for each inspect target", async () => {
    const connect = await start([replica()]);
    const client = await connect("core");
    const tool = (await client.listTools()).tools.find(({ name }) => name === "inspect");
    expect(tool?.inputSchema).toMatchObject({
      properties: {
        selectors: {
          description:
            "worksheet: id:<id>, name:<name> or index:N. " +
            "range: A1 ranges such as A1:B2; requires the separate worksheet argument. " +
            "paragraph and slide: index:N or id:<id>. board-element: id:<id>. " +
            "index: is 1-based. Other targets take no selectors.",
        },
      },
    });
  });

  it.each(["legacy", { pin: "2026-07-28" }] as const)(
    "describes every listed idempotency_key with the shared rule in %j",
    async (mode) => {
      const connect = await start([replica()]);
      const client = await connect("all", mode);
      const listed = (await client.listTools()).tools;
      let count = 0;
      for (const tool of tools) {
        const advertised = listed.find(({ name }) => name === tool.name);
        expect(advertised, tool.name).toBeDefined();
        const key = advertised?.inputSchema.properties?.["idempotency_key"];
        if (key === undefined) continue;
        expect(key, tool.name).toHaveProperty("description", IDEMPOTENCY_KEY_DESCRIPTION);
        count++;
      }
      expect(count).toBeGreaterThanOrEqual(10);
    },
  );

  it.each([undefined, " listed , another "])(
    "applies the per-user executor allowlist %s through MCP",
    async (allowlist) => {
      const executor = replica();
      const connect = await start([executor], allowlist);
      const withoutExecutor = await start([], allowlist);
      const notice =
        "Editing document contents is not enabled for this account; ask the user to edit in the browser.";
      for (const mode of ["legacy", { pin: "2026-07-28" }] as const) {
        const listed = await connect("all", mode, "listed");
        expect((await listed.listTools()).tools.map((tool) => tool.name)).toEqual(allNames);
        expect(listed.getInstructions()).not.toContain(notice);
        for (const toolset of ["core", "files", "admin", "all"]) {
          const unlisted = await connect(toolset, mode);
          const baseline = await withoutExecutor(toolset, mode);
          const listedTools = (await unlisted.listTools()).tools;
          if (allowlist === undefined)
            expect(listedTools.map((tool) => tool.name)).toEqual(selectedNames(toolset));
          else expect(listedTools).toEqual((await baseline.listTools()).tools);
          expect(baseline.getInstructions()).not.toContain(notice);
          if (allowlist === undefined) {
            expect(unlisted.getInstructions()).not.toContain(notice);
          } else {
            expect(unlisted.getInstructions()).toContain(notice);
            for (const name of [...executorTools, "job_get"])
              expect(unlisted.getInstructions()).not.toMatch(new RegExp(name === "read" ? "\\b(?:call|tool) read\\b" : `\\b${name}\\b`));
            if (toolset === "all") {
              const unknown = await callError(unlisted, "unknown");
              const hidden = await callError(unlisted, "execute");
              expect(JSON.stringify(hidden).replaceAll("execute", "unknown")).toBe(
                JSON.stringify(unknown),
              );
              expect(executor.rpcCalls).toBe(0);
            }
          }
        }
      }
      const allowed = await connect(
        "all",
        undefined,
        allowlist === undefined ? "session" : "listed",
      );
      await allowed.callTool({
        name: "execute",
        arguments: { worktree: "wt", unit: "unit", code: "return 1" },
      });
      expect(executor.rpcCalls).toBeGreaterThan(0);
    },
  );

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
            expect(instructions).not.toMatch(new RegExp(name === "read" ? "\\b(?:call|tool) read\\b" : `\\b${name}\\b`));
          }
          if (combination === "core,admin") {
            expect(instructions).toContain("?toolsets=files");
            if (deployment === "full")
              expect(instructions).toContain("PDF, Markdown, Typst, SVG, Blob");
            if (deployment === "no-renderer") {
              expect(instructions).not.toContain("PDF");
              expect(instructions).toContain("Markdown, Typst, SVG, Blob");
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
      const unknown = await callError(client, "unknown");
      for (const name of deployment === "no-executor"
        ? [...executorTools, "job_get"]
        : renderTools) {
        const result = await callError(client, name);
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

it("hides page writes from old executors and retains the HTTP-only status tool", async () => {
  const old = replica([...allOperations.filter((name) => name !== "htmlView.draft"), "htmlView.create", "htmlView.replace"]);
  const client = await (await start([old]))("core");
  const names = (await client.listTools()).tools.map(({ name }) => name);
  expect(names).not.toContain("html_view_create");
  expect(names).not.toContain("html_view_replace");
  expect(names).toContain("html_view_draft_get");
  expect(Object.keys(opSpecs)).toContain("htmlView.draft");
  expect(Object.keys(opSpecs)).not.toContain("htmlView.create");
  expect(Object.keys(opSpecs)).not.toContain("htmlView.replace");
});
