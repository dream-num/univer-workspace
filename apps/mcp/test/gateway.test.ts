import { toolError } from "./tool-error.js";
import { testStagingDirectory } from "./staging-directory.js";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutor } from "../src/executor/server.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import {
  workspaceRuntimeKey,
  type WorkspaceContentRuntime,
} from "@univerjs/univer-workspace-client-core";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { adminNames, coreNames, destructiveNames, filesNames, writeNames } from "./tool-names.js";

const identityOrigin = "https://workspace.example";
const session = "test-session-secret-do-not-log";
const subject = { id: "user-1", name: "alice" };
const spaces = [
  {
    id: "personal-1",
    name: "Personal",
    type: "personal",
    accessRole: "owner",
    affiliation: "owner",
    fullName: "alice/personal",
    owner: { id: "user-1", username: "Alice" },
    publicRead: false,
    slug: null,
  },
  {
    id: "team-1",
    name: "Team",
    type: "team",
    accessRole: "admin",
    affiliation: "member",
    fullName: "bob/team",
    owner: { id: "user-2", username: "bob" },
    publicRead: true,
    slug: "team",
  },
];
const observedSchema = z
  .object({
    event: z.literal("mcp.tool_call"),
    schema_version: z.literal(1),
    ts: z.iso.datetime(),
    request_id: z.string().min(1),
    trace_id: z.string().nullable(),
    user_id: z.string().min(1),
    principal_kind: z.enum(["human", "agent"]),
    principal_category: z.enum(["human", "agent_claimed", "agent_unclaimed"]),
    auth_kind: z.literal("dev"),
    client_id: z.literal("dev"),
    client_name: z.string().nullable(),
    client_version: z.string().nullable(),
    tool: z.string().min(1),
    toolset: z.enum(["core", "files", "admin"]),
    repo: z.string().nullable(),
    node_id: z.string().min(1).optional(),
    unit_type: z.string().nullable(),
    outcome: z.enum([
      "ok",
      "tool_error",
      "auth_error",
      "rate_limited",
      "timeout",
      "internal_error",
    ]),
    error_code: z.string().nullable(),
    duration_ms: z.number().nonnegative(),
    executor: z.enum(["cold_start", "warm", "none"]),
    cost: z.object({
      worker_cpu_ms: z.number().nonnegative(),
      worker_peak_rss_mb: z.number().nonnegative(),
      render_pages: z.number().nonnegative(),
      export_bytes: z.number().nonnegative(),
      upload_bytes: z.number().nonnegative(),
      committed_revisions: z.number().nonnegative(),
    }),
  })
  .refine(
    (event) => event.executor !== "none" || [event.cost.worker_cpu_ms, event.cost.worker_peak_rss_mb, event.cost.render_pages, event.cost.committed_revisions].every((cost) => cost === 0),
  );
async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("gateway over real HTTP and the MCP client", () => {
  let workspace: Server;
  let executor: ReturnType<typeof createExecutor>;
  let ready: boolean;
  let executeValue: string;
  let runtimeError: Error | undefined;
  let inspectValue: unknown;
  let observedKeys: string[];
  const executorToken = "executor-internal-test-token-123456789";
  const rangeResult = {
    kind: "worksheet-range",
    unitId: "unit-1",
    ranges: [
      {
        worksheet: { id: "sheet-1", index: 0, name: "Sheet1" },
        requestedRange: "A1:B2",
        resolvedRange: "A1:B2",
        clipped: false,
        displayValues: [
          ["Name", "Count"],
          ["Apples", "2"],
        ],
        cellData: [
          [{ v: "Name" }, { v: "Count" }],
          [{ v: "Apples" }, { v: 2 }],
        ],
      },
    ],
  };
  let gateway: ReturnType<typeof createGateway> | undefined;
  let url: string;
  let logs: string;
  let workspaceRequests: {
    path: string;
    cookie: string | undefined;
    requestId: string | string[] | undefined;
  }[];
  let clients: Client[];
  let expireDuringTool: boolean;
  let missingRepoCode: string;
  let principal: Record<string, unknown>;
  beforeEach(async () => {
    principal = { kind: "human" };
    clients = [];
    gateway = undefined;
    ready = false;
    executeValue = "written";
    runtimeError = undefined;
    inspectValue = { ok: true, value: rangeResult };
    observedKeys = [];
    logs = "";
    expireDuringTool = false;
    missingRepoCode = "workspace-not-found";
    workspaceRequests = [];
    workspace = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost");
      if (path.pathname === "/rpc/v1/capabilities") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ v: 1, operations: ["screenshot", "printPdf", "lint", "measureText"] }));
        return;
      }
      workspaceRequests.push({
        path: path.pathname,
        cookie: request.headers.cookie,
        requestId: request.headers["x-request-id"],
      });
      response.setHeader("Content-Type", "application/json");
      if (request.headers.cookie !== `workspace_session=${session}`) {
        response.end(JSON.stringify({ authenticated: false }));
      } else if (path.pathname === "/api/session") {
        response.end(
          JSON.stringify({
            authenticated: true,
            user: { id: subject.id, displayName: subject.name, ...principal },
          }),
        );
      } else if (expireDuringTool) {
        response.writeHead(401).end("{}");
      } else if (path.pathname === "/api/worktrees/wt-1") {
        response.end(
          JSON.stringify({
            worktree: {
              id: "wt-1",
              name: "Test",
              number: 1,
              kind: "team",
              state: ready ? "ready" : "draft",
              teamSpace: { id: "team-1" },
              units: [
                {
                  unitId: "unit-1",
                  unitType: "sheet",
                  resourceId: "resource-1",
                  nodeId: "node-1",
                  name: "Sheet1",
                  source: "worktree",
                  target: { spaceId: "team-1", parentNodeId: null },
                  draftHeadRevision: 1,
                  change: "added",
                  mergeResult: "pending",
                  activationState: "waitingForMerge",
                },
              ],
            },
          }),
        );
      } else if (path.pathname === "/api/spaces") {
        response.end(JSON.stringify({ spaces }));
      } else if (path.pathname === "/api/spaces/lookup") {
        const space = spaces.find(
          (space) =>
            space.fullName === `${path.searchParams.get("owner")}/${path.searchParams.get("slug")}`,
        );
        if (space) response.end(JSON.stringify(space));
        else
          response.writeHead(404).end(
            JSON.stringify({
              error: { code: missingRepoCode, message: "Repository not found." },
            }),
          );
      } else if (path.pathname.endsWith("/star")) {
        response.end(JSON.stringify({ starCount: 7, starred: true }));
      } else if (path.pathname === "/api/nodes/node-1") {
        response.end(
          JSON.stringify({
            node: {
              id: "node-1",
              name: "Budget",
              accessRole: "owner",
              capabilities: { browseChildren: false, createChildren: false, move: true, rename: true, share: true, trash: true },
              hasChildren: false,
              parentNodeId: null,
              resource: null,
              spaceId: "personal-1",
              updatedAt: "2026-11-16T00:00:00.000Z",
            },
            space: { id: "personal-1", name: "Personal" },
            breadcrumbs: [{ id: "node-1", name: "Budget" }],
            navigationRootNodeId: null,
          }),
        );
      } else if (path.pathname === "/api/nodes/node-1/link-sharing") {
        response.end(
          JSON.stringify({
            enabled: true,
            role: "viewer",
            owner: { username: "budget-x7k2", kind: "agent", claimed: false },
            expiresAt: null,
            createdBy: null,
            updatedBy: null,
            createdAt: null,
            updatedAt: null,
          }),
        );
      } else {
        const space = spaces.find((space) => path.pathname === `/api/spaces/${space.id}`);
        if (space) response.end(JSON.stringify(space));
        else
          response.writeHead(404).end(
            JSON.stringify({
              error: { code: missingRepoCode, message: "Repository not found." },
            }),
          );
      }
    });
    const transportOrigin = await listen(workspace);
    const runtime: WorkspaceContentRuntime = {
      executeAndCommit: async (input) => {
        expect(input.caller?.userId).toBe(subject.id);
        observedKeys.push(workspaceRuntimeKey(input.target, input.caller));
        input.observe?.({ coldStart: observedKeys.length === 1, workerMs: 12 });
        if (runtimeError) throw runtimeError;
        return { committed: true, revision: 2, status: "committed", value: executeValue };
      },
      executeRead: async (input) => {
        expect(input.caller?.userId).toBe(subject.id);
        observedKeys.push(workspaceRuntimeKey(input.target, input.caller));
        input.observe?.({ coldStart: observedKeys.length === 1, workerMs: 4 });
        return {
          value: inspectValue as never,
          state: {
            connection: "online" as const,
            baseRevision: 1,
            knownHeadRevision: 1,
            pendingMutationCount: 0,
            bufferedChangesetCount: 0,
            awaitingChangeset: null,
            conflict: null,
          },
        };
      },
      exportUnitData: async () => {
        throw new Error("unused");
      },
      close: async () => {},
    };
    executor = createExecutor(
      parseExecutorConfig({
        WORKSPACE_ORIGIN: identityOrigin,
        WORKSPACE_TRANSPORT_URL: transportOrigin,
        MCP_EXECUTOR_TOKEN: executorToken,
        MCP_RENDERER_URL: transportOrigin,
        MCP_RENDERER_TOKEN: "renderer-test-token-".repeat(4),
      }),
      { runtime, logger: pino({ level: "silent" }) },
    );
    const executorUrl = await listen(executor.server);
    const logOutput = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    ({ gateway, url } = await listenGateway((url) =>
      createGateway(
        parseGatewayConfig({
          MCP_DEV_SESSION_PASSTHROUGH: "1",
          WORKSPACE_ORIGIN: identityOrigin,
          WORKSPACE_TRANSPORT_URL: transportOrigin,
          MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url,
          METRICS_TOKEN: "metrics-secret",
          MCP_EXECUTOR_URLS: executorUrl,
          MCP_EXECUTOR_TOKEN: executorToken,
        }),
        { logger: pino({}, logOutput) },
      ),
    ));
  });
  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    if (gateway) {
      await gateway.close();
      await close(gateway.server);
    }
    await close(workspace);
    await executor.close();
    expect(logs).not.toContain(session);
    expect(logs).not.toContain("metrics-secret");
  });
  async function connect(mode: "legacy" | { pin: string } = { pin: "2026-07-28" }, suffix = "") {
    const client = new Client(
      { name: "gateway-test", version: "1.2.3" },
      { versionNegotiation: { mode } },
    );
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + suffix), {
        requestInit: {
          headers: { Authorization: `Bearer ${session}`, "x-request-id": "gateway-test-id" },
        },
      }),
    );
    return client;
  }
  function events() {
    return logs
      .trim()
      .split("\n")
      .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
      .filter((line) => line["event"] === "mcp.tool_call")
      .map((line) => observedSchema.parse(line));
  }

  it("returns identical whoami in both protocol versions and preserves identity and transport origins", async () => {
    for (const mode of ["legacy", { pin: "2026-07-28" }] as const) {
      const client = await connect(mode);
      expect(client.getProtocolEra()).toBe(mode === "legacy" ? "legacy" : "modern");
      const result = await client.callTool({ name: "whoami", arguments: {} });
      expect(result.structuredContent).toEqual({ origin: identityOrigin, subject });
    }
    expect(workspaceRequests.length).toBeGreaterThan(1);
    expect(
      workspaceRequests.every(
        (request) =>
          request.cookie === `workspace_session=${session}` &&
          request.requestId === "gateway-test-id",
      ),
    ).toBe(true);
    const emitted = events();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({
      outcome: "ok",
      request_id: "gateway-test-id",
      client_name: null,
      client_version: null,
    });
    expect(emitted[1]).toMatchObject({
      outcome: "ok",
      client_name: "gateway-test",
      client_version: "1.2.3",
    });
  });

  it("accepts transfer bytes without an executor but rejects each worker cost", async () => {
    await (await connect()).callTool({ name: "whoami", arguments: {} });
    const event = events()[0];
    expect(event).toBeDefined();
    const cost = { worker_cpu_ms: 0, worker_peak_rss_mb: 0, render_pages: 0, committed_revisions: 0, upload_bytes: 3, export_bytes: 5 };
    expect(observedSchema.safeParse({ ...event, cost }).success).toBe(true);
    for (const key of ["worker_cpu_ms", "worker_peak_rss_mb", "render_pages", "committed_revisions"])
      expect(observedSchema.safeParse({ ...event, cost: { ...cost, [key]: 1 } }).success).toBe(false);
  });

  it.each(["legacy", { pin: "2026-07-28" }] as const)(
    "executes and inspects through RPC with %j",
    async (mode) => {
      const client = await connect(mode);
      expect(
        (
          await client.callTool({
            name: "execute",
            arguments: { worktree: "wt-1", unit: "unit-1", code: 'return "written"' },
          })
        ).structuredContent,
      ).toEqual({ committed: true, revision: 2, status: "committed", value: "written" });
      expect(
        (
          await client.callTool({
            name: "inspect",
            arguments: {
              worktree: "wt-1",
              unit: "unit-1",
              target: "range",
              selectors: ["A1:B2"],
              worksheet: "index:1",
            },
          })
        ).structuredContent,
      ).toEqual(rangeResult);
      expect(events()).toMatchObject([
        {
          executor: "cold_start",
          unit_type: "sheet",
          repo: "team-1",
          cost: { committed_revisions: 1, worker_cpu_ms: 12 },
        },
        {
          executor: "warm",
          unit_type: "sheet",
          repo: "team-1",
          cost: { committed_revisions: 0, worker_cpu_ms: 4 },
        },
      ]);
      expect(new Set(observedKeys).size).toBe(1);
      expect(observedKeys[0]).toContain(":caller:user-1");
      expect(logs).not.toContain(executorToken);
      expect(logs).not.toContain("Apples");
    },
  );

  it.each([150_000, 9 * 1024 * 1024])(
    "preserves one committed write when its value has %s characters",
    async (size) => {
      executeValue = "r".repeat(size);
      const result = await (
        await connect()
      ).callTool({
        name: "execute",
        arguments: { worktree: "wt-1", unit: "unit-1", code: "write once" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        committed: true,
        revision: 2,
        status: "committed",
        valueTruncated: true,
      });
      expect(result.content).toEqual([
        { type: "text", text: `The write committed; its value was too large to return.\n${JSON.stringify(result.structuredContent)}` },
      ]);
      expect(observedKeys).toHaveLength(1);
      expect(events()).toMatchObject([{ outcome: "ok", cost: { committed_revisions: 1 } }]);
    },
  );

  it("reports worker usage on failed cold and warm calls", async () => {
    runtimeError = Object.assign(new Error("unconfirmed"), {
      code: "workspace-submit-retry-exhausted",
    });
    const client = await connect();
    for (let i = 0; i < 2; i++) {
      const result = await client.callTool({
        name: "execute",
        arguments: { worktree: "wt-1", unit: "unit-1", code: "edit" },
      });
      expect(toolError(result)).toMatchObject({
        code: "workspace-result-unknown",
        detail: { cause: "workspace-submit-retry-exhausted" },
      });
    }
    expect(events()).toMatchObject([
      {
        outcome: "tool_error",
        executor: "cold_start",
        unit_type: "sheet",
        cost: { worker_cpu_ms: 12 },
      },
      { outcome: "tool_error", executor: "warm", unit_type: "sheet", cost: { worker_cpu_ms: 12 } },
    ]);
  });

  it.each([undefined, { ok: true, value: { kind: "wrong", unitId: "unit-1" } }])(
    "classifies invalid inspection results as internal errors",
    async (value) => {
      inspectValue = value;
      const result = await (
        await connect()
      ).callTool({
        name: "inspect",
        arguments: {
          worktree: "wt-1",
          unit: "unit-1",
          target: "range",
          selectors: ["A1:B2"],
          worksheet: "index:1",
        },
      });
      expect(toolError(result)).toMatchObject({ code: "workspace-runtime-result-invalid" });
      expect(events()).toMatchObject([
        { outcome: "internal_error", executor: "cold_start", unit_type: "sheet" },
      ]);
    },
  );

  it("preserves ready Worktree error detail over RPC", async () => {
    ready = true;
    const result = await (
      await connect()
    ).callTool({
      name: "execute",
      arguments: { worktree: "wt-1", unit: "unit-1", code: "return 1" },
    });
    expect(toolError(result)).toMatchObject({
      code: "workspace-worktree-not-editable",
      detail: { state: "ready", worktreeId: "wt-1" },
    });
    expect(observedKeys).toEqual([]);
  });

  it("keeps executor tools listed while an executor is stopped", async () => {
    const client = await connect();
    await executor.close();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("execute");
    expect(
      toolError(await client.callTool({
        name: "inspect",
        arguments: { target: "workbook", unit: "unit-1", trunk: true },
      })),
    ).toMatchObject({ code: "workspace-executor-unavailable" });
  });

  it("wraps repository lists, preserves ordering and CLI owner/type/limit semantics", async () => {
    const client = await connect();
    const expected = spaces.map((space) => ({
      ...space,
      url: `${identityOrigin}/spaces/${space.id}`,
    }));
    expect((await client.callTool({ name: "repo_list", arguments: {} })).structuredContent).toEqual(
      { repos: expected },
    );
    for (const args of [{ owner: "@me" }, { owner: "ALICE" }, { type: "personal" }, { limit: 1 }]) {
      expect(
        (await client.callTool({ name: "repo_list", arguments: args })).structuredContent,
      ).toEqual({ repos: expected.slice(0, 1) });
    }
    expect(
      (await client.callTool({ name: "repo_list", arguments: { type: "team" } })).structuredContent,
    ).toEqual({ repos: expected.slice(1) });
    expect((await client.callTool({ name: "repo_list", arguments: { limit: 0 } })).isError).toBe(
      true,
    );
  });

  it("resolves all repository reference forms with CLI get and getStar composition", async () => {
    const client = await connect();
    for (const repo of ["alice/personal", "personal-1", `${identityOrigin}/spaces/personal-1`]) {
      expect(
        (await client.callTool({ name: "repo_view", arguments: { repo } })).structuredContent,
      ).toEqual({
        ...spaces[0],
        starCount: 7,
        starred: true,
        url: `${identityOrigin}/spaces/personal-1`,
      });
    }
    expect(events().every((event) => event.repo === "personal-1")).toBe(true);
    const foreign = await client.callTool({
      name: "repo_view",
      arguments: { repo: "https://elsewhere.example/spaces/personal-1" },
    });
    expect(toolError(foreign)).toMatchObject({ code: "workspace-origin-mismatch" });
  });

  it.each(["workspace-not-found", "NOT_FOUND"])(
    "preserves %s and emits exactly one failed usage event",
    async (code) => {
      missingRepoCode = code;
      const client = await connect();
      const result = await client.callTool({
        name: "repo_view",
        arguments: { repo: "alice/missing-sensitive-argument" },
      });
      expect(toolError(result)).toMatchObject({
        code,
        message: "Repository not found.",
        detail: { status: 404, path: "/api/spaces/lookup" },
      });
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify({
        code, message: "Repository not found.", detail: { status: 404, path: "/api/spaces/lookup" },
      }) }]);
      expect(events()).toHaveLength(1);
      expect(events()[0]).toMatchObject({ outcome: "tool_error", error_code: code });
      expect(logs).not.toContain("missing-sensitive-argument");
    },
  );

  it("gives a client that reads only text every result and every error", async () => {
    const client = await connect();
    const text = (result: Awaited<ReturnType<typeof client.callTool>>) =>
      z.array(z.object({ type: z.literal("text"), text: z.string() })).parse(result.content)[0]!.text;
    const who = await client.callTool({ name: "whoami", arguments: {} });
    expect(JSON.parse(text(who))).toEqual(who.structuredContent);
    const missing = await client.callTool({
      name: "repo_view",
      arguments: { repo: "alice/missing-sensitive-argument" },
    });
    expect(missing.isError).toBe(true);
    // Older SDK clients validate an error's structuredContent against the tool's outputSchema.
    expect(missing.structuredContent).toBeUndefined();
    expect(JSON.parse(text(missing))).toEqual({
      code: "workspace-not-found",
      message: "Repository not found.",
      detail: { status: 404, path: "/api/spaces/lookup" },
    });
  });

  it("lists the selected toolsets in the fixed registry order with complete schemas and annotations", async () => {
    const names = async (suffix: string) =>
      (await (await connect({ pin: "2026-07-28" }, suffix)).listTools()).tools.map(
        (tool) => tool.name,
      );
    expect(await names("")).toEqual(coreNames);
    expect(await names("?toolsets=core")).toEqual(coreNames);
    expect(await names("?toolsets=files")).toEqual(filesNames);
    expect(await names("?toolsets=admin")).toEqual(adminNames);
    expect(await names("?toolsets=admin,core")).toEqual([...coreNames, ...adminNames]);
    expect(await names("?toolsets=core,files,admin")).toEqual([
      ...coreNames,
      ...filesNames,
      ...adminNames,
    ]);
    expect(await names("?toolsets=all")).toEqual([...coreNames, ...filesNames, ...adminNames]);
    const all = await (await connect({ pin: "2026-07-28" }, "?toolsets=all")).listTools();
    for (const tool of all.tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: !writeNames.includes(tool.name),
        destructiveHint: destructiveNames.includes(tool.name),
        openWorldHint: false,
      });
    }
    expect(events()).toHaveLength(0);
  });

  it.each([false, true])(
    "lists the same admin tools for an agent as for a person, and repository setup in core too (claimed: %s)",
    async (claimed) => {
      principal = { kind: "agent", claimed };
      const names = async (suffix: string) =>
        (await (await connect({ pin: "2026-07-28" }, suffix)).listTools()).tools.map(
          (tool) => tool.name,
        );
      const agentAdmin = adminNames;
      const agentCore = claimed ? coreNames : coreNames.flatMap((name) => (name === "share" ? [name, "claim"] : [name]));
      const repositorySetup = ["repo_create", "repo_edit", "repo_member_list", "repo_member_write"];
      expect(await names("")).toEqual([...agentCore, ...repositorySetup]);
      expect(await names("?toolsets=core")).toEqual([...agentCore, ...repositorySetup]);
      expect(await names("?toolsets=files")).toEqual(filesNames);
      expect(await names("?toolsets=admin")).toEqual(agentAdmin);
      expect(await names("?toolsets=admin,core")).toEqual([...agentCore, ...agentAdmin]);
      expect(await names("?toolsets=core,files,admin")).toEqual([
        ...agentCore,
        ...filesNames,
        ...agentAdmin,
      ]);
      expect(await names("?toolsets=all")).toEqual([...agentCore, ...filesNames, ...agentAdmin]);
      const whoami = await (await connect()).callTool({ name: "whoami", arguments: {} });
      expect(whoami.structuredContent).toEqual({ origin: identityOrigin, subject });
    },
  );

  it("records the principal kind and category on every usage event and the shared file on a share event", async () => {
    await (await connect()).callTool({ name: "whoami", arguments: {} });
    principal = { kind: "agent", claimed: false };
    const shared = await (await connect()).callTool({
      name: "share",
      arguments: { node: `${identityOrigin}/nodes/node-1`, link: "viewer" },
    });
    expect(shared.isError).not.toBe(true);
    principal = { kind: "agent", claimed: true };
    await (await connect()).callTool({ name: "whoami", arguments: {} });
    expect(
      events().map(({ tool, principal_kind, principal_category, node_id }) => ({ tool, principal_kind, principal_category, node_id })),
    ).toEqual([
      { tool: "whoami", principal_kind: "human", principal_category: "human", node_id: undefined },
      { tool: "share", principal_kind: "agent", principal_category: "agent_unclaimed", node_id: "node-1" },
      { tool: "whoami", principal_kind: "agent", principal_category: "agent_claimed", node_id: undefined },
    ]);
  });

  it("keeps the reviewed human tool surface and instructions stable, apart from share's access", async () => {
    const surface = [];
    for (const suffix of ["", "?toolsets=files", "?toolsets=admin", "?toolsets=all"]) {
      const client = await connect({ pin: "2026-07-28" }, suffix);
      const tools = (await client.listTools()).tools.map((tool) => {
        if (tool.name !== "share") return tool;
        const { access, ...properties } = tool.outputSchema!.properties as Record<string, unknown>;
        expect(access).toEqual({ type: "string" });
        return { ...tool, outputSchema: { ...tool.outputSchema!, properties } };
      });
      surface.push({ suffix, instructions: client.getInstructions(), tools });
    }
    const digest = createHash("sha256").update(`${JSON.stringify(surface, null, 2)}\n`).digest("hex");
    expect(digest).toMatchInlineSnapshot(`"68b9e63b6547d580eeab2b1ffc5ffdee9729d1793acaee216f8ac45bb45e7124"`);
  });

  it("tells an agent to merge and share, and a person or a claimed agent to merge unless asked to hand over", async () => {
    const instructions = async (suffix = "") => (await connect({ pin: "2026-07-28" }, suffix)).getInstructions()!;
    const review = "Give the user the pull request link so they can review it.";
    const leave = "Leave merging and discarding to the user in the browser, unless they explicitly ask you to do it.";
    const human = await instructions();
    expect(human).toContain("The user granted this connection the worktree:merge scope, so finish your own pull requests as the workflow says.");
    expect(human).toContain(
      "7) Once the result is verified, mark the pull request ready with pr_ready. 8) If the user asked to review the work, or the change needs a person's decision, give them the pull request link and stop there; they merge it in the browser. 9) Otherwise, merge it with pr_merge. 10) Then give the user the pull request link.",
    );
    for (const sentence of [review, leave, "agent identity", "call share"]) {
      expect(human).not.toContain(sentence);
    }
    expect(human).toContain(
      "When the user asks you to work through a fork, create it with fork_create or take it from fork_list. Pass its address <owner>/<name> as worktree to content tools and as repo to space_browse and space_find, and skip pr_create",
    );
    expect(human).toContain(
      "stale: redo the work in a new pull request, then give the user the stale one's link and say it can be discarded; do not discard it unless they ask. Freshness never blocks a merge.",
    );

    principal = { kind: "agent", claimed: false };
    const agent = await instructions();
    expect(agent).toContain("This connection is an agent identity");
    expect(agent).toContain(
      "Once the result is verified, mark the pull request ready with pr_ready, then merge it with pr_merge.",
    );
    const share =
      "If the merged file is in your Personal Space, call share with node set to its nodeId and link set to viewer, then give the returned url to the user. Link Sharing does not apply in a Team repository, so there give the user the pull request link.";
    expect(agent).toContain(share);
    const limits = "An unclaimed agent identity cannot make a repository public";
    expect(agent).toContain(limits);
    expect(human).not.toContain(limits);
    for (const sentence of [review, leave, "Only mark the pull request ready with pr_ready when"]) {
      expect(agent).not.toContain(sentence);
    }
    // Without pr_merge in the list, an agent gets the same hand-off as a person without the grant.
    const filesOnly = await instructions("?toolsets=files");
    expect(filesOnly).toContain(leave);
    expect(filesOnly).not.toContain("agent identity");

    principal = { kind: "agent", claimed: true };
    const claimed = await instructions();
    expect(claimed).toContain(
      "This connection is an agent identity that a person has claimed. Merge your own pull request, or hand it to that person",
    );
    expect(claimed).toContain(
      "7) Once the result is verified, mark the pull request ready with pr_ready. 8) If the person who claimed this agent asked to review the work, or the change needs a person's decision, give them the pull request link and stop there; they merge it in the browser. 9) Otherwise, merge it with pr_merge. 10) If the merged file is in your Personal Space, call share",
    );
    expect(claimed).toContain(share);
    expect(claimed).toContain("A file link from someone else gives an agent identity read access only.");
    for (const sentence of [limits, "nobody else reviews or merges", review, leave, "Only mark the pull request ready with pr_ready when"]) {
      expect(claimed).not.toContain(sentence);
    }
  });

  it("checks Host, Origin, bearer, session, and toolsets in that order", async () => {
    const challenge = `Bearer resource_metadata="${new URL(url).origin}/.well-known/oauth-protected-resource/mcp"`;
    for (const authorization of [undefined, "Bearer ", "Bearer rejected-session"]) {
      const response = await fetch(url, {
        method: "POST",
        headers: authorization === undefined ? {} : { authorization },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        challenge + (authorization === "Bearer rejected-session" ? ', error="invalid_token"' : ""),
      );
    }
    const auth = { authorization: `Bearer ${session}` };
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        url,
        { method: "POST", headers: { ...auth, Host: "foreign.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(wrongHost).toBe(403);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { ...auth, Origin: "https://foreign.example" },
        })
      ).status,
    ).toBe(403);
    const unknown = await fetch(url + "?toolsets=nope", { method: "POST", headers: auth });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      message: "Unknown toolset",
      valid: ["core", "files", "admin", "all"],
    });
    expect((await fetch(url + "?toolsets=nope", { method: "POST" })).status).toBe(401);
    expect(events()).toHaveLength(0);
  });

  it("echoes request IDs, generates safe IDs, and serves health/metrics without Workspace", async () => {
    const origin = new URL(url).origin;
    const health = await fetch(origin + "/healthz", { headers: { "x-request-id": "safe.id-1" } });
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toBe("safe.id-1");
    const invalid = await fetch(origin + "/healthz", { headers: { "x-request-id": "invalid id" } });
    expect(invalid.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const noToken = await fetch(origin + "/metrics");
    expect(noToken.status).toBe(401);
    expect(noToken.headers.get("www-authenticate")).toBe("Bearer");
    expect(noToken.headers.get("cache-control")).toBe("no-store");
    const metrics = await fetch(origin + "/metrics", {
      headers: { Authorization: "Bearer metrics-secret" },
    });
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(workspaceRequests).toHaveLength(0);
    const client = await connect();
    await client.callTool({ name: "whoami", arguments: {} });
    const measured = await fetch(origin + "/metrics", {
      headers: { Authorization: "Bearer metrics-secret" },
    });
    expect(await measured.text()).toContain(
      'mcp_tool_calls_total{tool="whoami",client="dev",outcome="ok"} 1',
    );
    expect((await fetch(origin + "/unknown")).status).toBe(404);
    const unconfigured = createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: identityOrigin,
        MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url,
      }),
      { logger: pino({ level: "silent" }) },
    );
    const unconfiguredOrigin = await listen(unconfigured.server);
    try {
      expect((await fetch(unconfiguredOrigin + "/metrics")).status).toBe(404);
    } finally {
      await unconfigured.close();
      await close(unconfigured.server);
    }
  });

  it("returns HTTP 401 if a validated session expires during a tool", async () => {
    const client = await connect();
    expireDuringTool = true;
    await expect(client.callTool({ name: "repo_list", arguments: {} })).rejects.toThrow();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      outcome: "auth_error",
      error_code: null,
    });
  });
});

describe("configuration boundary", () => {
  const env = {
    MCP_DEV_SESSION_PASSTHROUGH: "1",
    WORKSPACE_ORIGIN: identityOrigin,
    MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: "http://127.0.0.1:3930/mcp",
  };
  it("rejects production passthrough before reading other configuration", () => {
    for (const value of ["1", "0", "false"]) {
      expect(() =>
        parseGatewayConfig({ NODE_ENV: "production", MCP_DEV_SESSION_PASSTHROUGH: value }),
      ).toThrow(/NODE_ENV.*MCP_DEV_SESSION_PASSTHROUGH/);
    }
  });
  it("requires an authentication mode, validates URLs and ports, and resolves defaults once", () => {
    expect(() => parseGatewayConfig({ ...env, MCP_DEV_SESSION_PASSTHROUGH: "" })).toThrow(
      /MCP_OAUTH_CLIENT_ID.*MCP_DEV_SESSION_PASSTHROUGH/,
    );
    for (const change of [
      { PORT: "0" },
      { PORT: "65536" },
      { LOG_LEVEL: "whatever" },
      { WORKSPACE_ORIGIN: "https://example.com/path" },
      { MCP_PUBLIC_URL: "https://example.com/nested/mcp" },
      { MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: "file:///mcp" },
    ]) {
      expect(() => parseGatewayConfig({ ...env, ...change })).toThrow();
    }
    const config = parseGatewayConfig(env);
    expect(config).toMatchObject({
      WORKSPACE_TRANSPORT_URL: identityOrigin,
      PORT: 3000,
      HOST: "127.0.0.1",
      auth: { exchange: null, devSessionPassthrough: true },
    });
    expect(Object.isFrozen(config)).toBe(true);
  });
});
