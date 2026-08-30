import { readFile } from "node:fs/promises";
import { Context } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import CodeRuntime, {
  type CodeJsonValue,
  type CodeRunRequest,
  type CodeRunResult,
} from "@deepseek-ai/dsh-code-runtime";
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import LlmRuntime, { CallId, createUserMessage, LlmAdapter } from "@deepseek-ai/dsh-llm";
import SessionStore, { Session, SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import * as ToolSkill from "@deepseek-ai/dsh-tool-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, {
  renderToolsSdk,
  type CodeDispatchEventData,
  type CodeDispatchStartEventData,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import { WorkspaceApplicationError } from "@univerjs/univer-workspace-client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWorkspaceAuthentication } from "../src/authentication.js";
import {
  ACCEPTED_WORKSPACE_TOOL_NAMES,
  validateBundledSkillSources,
} from "../scripts/skill-contract.mjs";
import {
  BUNDLED_WORKSPACE_SKILL_NAMES,
  loadBundledWorkspaceSkills,
} from "../src/bundled-skills.js";
import {
  grantRecord,
  WORKSPACE_CREDENTIAL_KEY,
  type AuthenticatedWorkspaceGrant,
} from "../src/authentication-state.js";

const origin = "https://workspace.test";
const cookie = "workspace_session=test";
const contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
});

describe("Workspace Space and Node tool contracts", () => {
  it("registers exactly seven closed operation schemas in Native and Code Mode", async () => {
    const { ctx } = await setup(async () => Response.json({ spaces: [] }));
    const schemas = spaceNodeSchemas(ctx);
    expect(schemas.map(({ name }) => name).sort()).toEqual([
      "workspace_node_create",
      "workspace_node_move",
      "workspace_node_rename",
      "workspace_node_trash",
      "workspace_space_browse",
      "workspace_space_find",
      "workspace_space_list",
    ]);
    expect(schemas.every(({ parameters }) => parameters.additionalProperties === false)).toBe(true);
    for (const name of [
      "workspace_node_create",
      "workspace_node_move",
      "workspace_node_rename",
      "workspace_node_trash",
    ]) {
      expect(ctx.tools.get(name)?.isConcurrencySafe).toBeUndefined();
    }
    const sdk = renderToolsSdk(schemas.map((schema) => ({
      ...schema,
      output: ctx.tools.get(schema.name)!.output.schema,
    })));
    for (const { name } of schemas) expect(sdk).toContain(name);
    expect(sdk).not.toMatch(/\b(?:cookie|password|origin|action|command|worktree)\??:/i);
  });

  it.each([
    ["workspace_space_list", { cookie: "secret" }],
    ["workspace_space_browse", { space_id: " ", unit_type: "sheet", resource_kind: "blob" }],
    ["workspace_space_find", { space_id: "space-1", query: "" }],
    ["workspace_node_create", null],
    ["workspace_node_rename", []],
    ["workspace_node_create", { space_id: "space-1", name: " ", cookie: "secret" }],
    ["workspace_node_create", { space_id: "space-1", name: "Valid", origin: "secret" }],
    ["workspace_node_rename", { node_id: "node-1", name: "x".repeat(256) }],
    ["workspace_node_rename", { node_id: "node-1", name: "Valid", path: "secret" }],
    ["workspace_node_move", { node_id: "node-1", parent_node_id: "node-1" }],
    ["workspace_node_move", { node_id: "node-1", parent_node_id: null, action: "secret" }],
    ["workspace_node_trash", {}],
    ["workspace_node_trash", { node_id: 1 }],
  ] as const)("rejects closed invalid arguments for %s without service access", async (name, args) => {
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup(fetcher, "allowed-once");
    const result = await execute(ctx, name, args, fakeAgent());
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-argument-invalid" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|cookie/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(credentials.reads).toBe(0);
    if (name.startsWith("workspace_node_")) expect(approvalRequests).toHaveLength(0);

    const definition = ctx.tools.get(name)!;
    await expect(definition.execute(args, directExecution(name))).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    expect(credentials.reads).toBe(0);
  });

  it("rejects JSON-invisible own keys at the direct mutation body seam", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx } = await setup(fetcher, "allowed-once");
    const definition = ctx.tools.get("workspace_node_rename")!;
    const nonEnumerable = { node_id: "node-1", name: "Renamed" } as Record<PropertyKey, unknown>;
    Object.defineProperty(nonEnumerable, "cookie", { value: "secret", enumerable: false });
    const symbolKey = { node_id: "node-1", name: "Renamed", [Symbol("cookie")]: "secret" };
    for (const args of [nonEnumerable, symbolKey]) {
      await expect(definition.execute(args, directExecution("workspace_node_rename"))).rejects.toMatchObject({
        code: "workspace-argument-invalid",
      });
    }
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns ordered canonical discovery values and re-reads the current grant", async () => {
    let directoryCalls = 0;
    const { credentials, ctx } = await setup(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/api/spaces") {
        return Response.json({ spaces: [
          { id: "space-2", name: "Team", type: "team" },
          { id: "space-1", name: "Personal", type: "personal" },
        ] });
      }
      directoryCalls += 1;
      if (directoryCalls >= 3) {
        return Response.json(nodePage({
          nodes: [node({ id: "sheet", name: "Budget", resource: univerResource("sheet") })],
        }));
      }
      if (directoryCalls % 2 === 1) {
        return Response.json(nodePage({
          nextCursor: "next",
          nodes: [node({ id: "folder", name: "Plans", hasChildren: true })],
        }));
      }
      return Response.json(nodePage({
        nodes: [node({ id: "sheet", name: "Budget", resource: univerResource("sheet") })],
      }));
    });

    await expect(execute(ctx, "workspace_space_list", {})).resolves.toMatchObject({
      isError: false,
      value: { spaces: [{ id: "space-2" }, { id: "space-1" }] },
    });
    await expect(execute(ctx, "workspace_space_browse", {
      space_id: "space-1",
      resource_kind: "univer",
      unit_type: "sheet",
    })).resolves.toMatchObject({
      isError: false,
      value: { nodes: [{ nodeId: "sheet", path: "/Budget" }] },
    });
    await expect(execute(ctx, "workspace_space_find", {
      space_id: "space-1",
      query: "budget",
      resource_kind: "univer",
      unit_type: "sheet",
    })).resolves.toMatchObject({
      isError: false,
      value: { nodes: [{ nodeId: "sheet" }] },
    });
    expect(credentials.reads).toBe(3);
  });

  it("executes four separately approved mutations and preserves Core identities", async () => {
    const requests: string[] = [];
    const { approvalRequests, ctx } = await setup(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/nodes" && init?.method === "POST") {
        return Response.json(node({ id: "created", name: "Created", parentNodeId: "parent" }));
      }
      if (url.pathname.endsWith("/trash")) return Response.json(trashBatch("node-1"));
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(node({
        id: "node-1",
        name: typeof patch["name"] === "string" ? patch["name"] : "Moved",
        ...(patch["parentNodeId"] === undefined
          ? {}
          : { parentNodeId: patch["parentNodeId"] as string | null }),
      }));
    }, "allowed-once");
    const agent = fakeAgent();

    const results = await Promise.all([
      execute(ctx, "workspace_node_create", {
        space_id: "space-1",
        parent_node_id: "parent",
        name: "  Created  ",
      }, agent),
      execute(ctx, "workspace_node_rename", { node_id: "node-1", name: "Renamed" }, agent),
      execute(ctx, "workspace_node_move", { node_id: "node-1", parent_node_id: null }, agent),
      execute(ctx, "workspace_node_trash", { node_id: "node-1" }, agent),
    ]);
    expect(results.every(({ isError }) => !isError)).toBe(true);
    expect(results[0]).toMatchObject({ value: { node: { nodeId: "created", name: "Created" } } });
    expect(results[1]).toMatchObject({ value: { node: { nodeId: "node-1", name: "Renamed" } } });
    expect(results[2]).toMatchObject({ value: { node: { nodeId: "node-1", parentNodeId: null } } });
    expect(results[3]).toMatchObject({ value: { trashBatch: { trashBatchId: "trash-1" } } });
    expect(approvalRequests.map(({ toolName }) => toolName).sort()).toEqual([
      "workspace_node_create",
      "workspace_node_move",
      "workspace_node_rename",
      "workspace_node_trash",
    ]);
    expect(requests).toContain("POST /api/nodes/node-1/trash");
  });

  it("leaves descendant and cross-Space move authority with the Server", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(
      { error: { code: "INVALID_INPUT", message: "authoritative hierarchy rejection" } },
      { status: 400 },
    ));
    const { ctx } = await setup(fetcher, "allowed-once");
    const result = await execute(
      ctx,
      "workspace_node_move",
      { node_id: "node-1", parent_node_id: "other-space-or-descendant" },
      fakeAgent(),
    );
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "INVALID_INPUT" } },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves Core read-back and mutation-unknown behavior without replay", async () => {
    let mode: "rename" | "move" | "create" | "trash" = "rename";
    const requests: string[] = [];
    const { ctx } = await setup(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if ((mode === "rename" || mode === "move") && init?.method === "PATCH") {
        throw new Error("response lost");
      }
      if ((mode === "create" && url.pathname === "/api/nodes") || url.pathname.endsWith("/trash")) {
        throw new Error("response lost");
      }
      const target = node({
        id: "node-1",
        name: mode === "rename" ? "Renamed" : "Moved",
        parentNodeId: mode === "move" ? "parent-2" : null,
      });
      return Response.json({
        breadcrumbs: [
          ...(mode === "move" ? [{ id: "parent-2", name: "Parent" }] : []),
          { id: "node-1", name: target["name"] },
        ],
        navigationRootNodeId: null,
        node: target,
        space: { id: "space-1", name: "Personal", type: "personal" },
      });
    }, "allowed-once");
    const agent = fakeAgent();

    await expect(execute(ctx, "workspace_node_rename", {
      node_id: "node-1",
      name: "Renamed",
    }, agent)).resolves.toMatchObject({ isError: false, value: { node: { name: "Renamed" } } });
    mode = "move";
    await expect(execute(ctx, "workspace_node_move", {
      node_id: "node-1",
      parent_node_id: "parent-2",
    }, agent)).resolves.toMatchObject({ isError: false, value: { node: { parentNodeId: "parent-2" } } });
    mode = "create";
    await expect(execute(ctx, "workspace_node_create", {
      space_id: "space-1",
      name: "Created",
    }, agent)).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-unknown" } },
    });
    mode = "trash";
    await expect(execute(ctx, "workspace_node_trash", { node_id: "node-1" }, agent)).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-unknown" } },
    });
    expect(requests.filter((request) => request === "PATCH /api/nodes/node-1")).toHaveLength(2);
    expect(requests.filter((request) => request === "GET /api/nodes/node-1")).toHaveLength(2);
    expect(requests.filter((request) => request === "POST /api/nodes")).toHaveLength(1);
    expect(requests.filter((request) => request === "POST /api/nodes/node-1/trash")).toHaveLength(1);
  });

  it.each(["cursor", "cycle"] as const)("surfaces Core %s invalid responses", async (kind) => {
    let calls = 0;
    const { ctx } = await setup(async () => {
      calls += 1;
      if (kind === "cursor") return Response.json(nodePage({ nextCursor: "same", nodes: [] }));
      return Response.json(calls === 1
        ? nodePage({ nodes: [node({ id: "parent", name: "Parent", hasChildren: true })] })
        : {
            ...nodePage({ nodes: [node({ id: "parent", name: "Parent", parentNodeId: "parent" })] }),
            breadcrumbs: [{ id: "parent", name: "Parent" }],
            parentNode: node({ id: "parent", name: "Parent", hasChildren: true }),
          });
    });
    const result = await execute(ctx, "workspace_space_browse", {
      space_id: "space-1",
      recursive: kind === "cycle",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-invalid-response" } },
    });
    expect(calls).toBe(2);
  });

  it.each(["rejected", "cancelled", "unavailable"] as const)(
    "fails closed when mutation approval is %s",
    async (outcome) => {
      const fetcher = vi.fn<typeof fetch>();
      const { credentials, ctx } = await setup(fetcher, outcome);
      const result = await execute(
        ctx,
        "workspace_node_rename",
        { node_id: "node-1", name: "Renamed" },
        fakeAgent(),
      );
      expect(result.isError).toBe(true);
      expect(credentials.reads).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("fails closed without an approval service", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx } = await setup(fetcher);
    const result = await execute(
      ctx,
      "workspace_node_trash",
      { node_id: "node-1" },
      fakeAgent(),
    );
    expect(result.isError).toBe(true);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["constructor", "toString", "hasOwnProperty"])(
    "delegates benign prototype-like tool name %s to the existing policy chain",
    async (name) => {
      const { ctx } = await setup(async () => Response.json({ spaces: [] }));
      const unregister = ctx.tools.register({
        name,
        description: "Benign policy delegation fixture.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        output: {
          schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
          render: () => [{ type: "text", text: "ok" }],
        },
        execute: async () => ({ ok: true }),
      });
      await expect(execute(ctx, name, {})).resolves.toMatchObject({ isError: false, value: { ok: true } });
      unregister();
    },
  );

  it("preserves only frozen Workspace codes and allowlisted detail", async () => {
    const safe = await setup(async () => Response.json(
      { error: { code: "FORBIDDEN", message: "unsafe server message" } },
      { status: 403 },
    ));
    const allowed = await execute(safe.ctx, "workspace_space_list", {});
    expect(allowed).toMatchObject({ isError: true, error: { info: { code: "FORBIDDEN" } } });
    expect(allowed.error?.message).toContain('"detail":{"path":"/api/spaces","status":403}');
    expect(JSON.stringify(allowed)).not.toContain("unsafe server message");

    const sentinel = "private-cookie-unlisted-code";
    const unsafe = await setup(async () => Response.json(
      { error: { code: sentinel, message: sentinel, detail: { cookie: sentinel } } },
      { status: 500 },
    ));
    const hidden = await execute(unsafe.ctx, "workspace_space_list", {});
    expect(hidden).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-failed" } },
    });
    expect(JSON.stringify(hidden)).not.toContain(sentinel);
  });

  it.each([
    "workspace-argument-invalid",
    "workspace-invalid-response",
    "workspace-result-mismatch",
    "workspace-result-unknown",
    "workspace-origin-mismatch",
    "workspace-authentication-required",
    "workspace-request-invalid",
    "workspace-redirect-refused",
  ])("preserves frozen Core code %s with exact safe detail", async (code) => {
    const sentinel = `private-${code}`;
    const fixture = await setup(async () => Response.json({ spaces: [] }));
    fixture.credentials.readFailure = new WorkspaceApplicationError(
      code,
      sentinel,
      {
        actual: { name: "Actual", nodeId: "node-2", parentNodeId: null, cookie: sentinel },
        cause: sentinel,
        cookie: sentinel,
        headers: { "Set-Cookie": sentinel },
        name: "Safe Name",
        nodeId: "node-1",
        parentNodeId: null,
        path: "/api/nodes/node-1",
        readCause: sentinel,
        requested: { name: "Requested", parentNodeId: "parent-1", grant: sentinel },
        spaceId: "space-1",
        status: 409,
      },
      { cause: new Error(sentinel) },
    );
    const result = await execute(fixture.ctx, "workspace_space_list", {});
    expect(result).toMatchObject({ isError: true, error: { info: { code } } });
    const envelope = parseFailureEnvelope(result.error!.message);
    expect(envelope).toEqual({
      code,
      detail: {
        path: "/api/nodes/node-1",
        spaceId: "space-1",
        nodeId: "node-1",
        name: "Safe Name",
        parentNodeId: null,
        status: 409,
        requested: { name: "Requested", parentNodeId: "parent-1" },
        actual: { nodeId: "node-2", name: "Actual", parentNodeId: null },
      },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it.each(["UNAUTHENTICATED", "INVALID_INPUT", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR"])(
    "preserves frozen Server code %s",
    async (code) => {
      const fixture = await setup(async () => Response.json(
        { error: { code, message: "server-private-message" } },
        { status: 400 },
      ));
      const result = await execute(fixture.ctx, "workspace_space_list", {});
      expect(result).toMatchObject({ isError: true, error: { info: { code } } });
      expect(JSON.stringify(result)).not.toContain("server-private-message");
    },
  );

  it("maps provider failures and unlisted Workspace-shaped codes without reflecting causes", async () => {
    const sentinel = "provider-cookie-Set-Cookie-private-grant";
    const provider = await setup(async () => Response.json({ spaces: [] }));
    provider.credentials.readFailure = new Error(sentinel, { cause: new Error(sentinel) });
    const providerResult = await execute(provider.ctx, "workspace_space_list", {});
    expect(providerResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-failed" } },
    });
    expect(JSON.stringify(providerResult)).not.toContain(sentinel);

    const unlisted = await setup(async () => Response.json({ spaces: [] }));
    unlisted.credentials.readFailure = new WorkspaceApplicationError(sentinel, sentinel, {
      path: "/safe-looking",
      status: 500,
    });
    const unlistedResult = await execute(unlisted.ctx, "workspace_space_list", {});
    expect(unlistedResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-failed" } },
    });
    expect(JSON.stringify(unlistedResult)).not.toContain(sentinel);
    expect(unlistedResult.error?.message).not.toContain("safe-looking");
  });

  it.each([
    { spaces: [{ id: "space-1", name: "Personal", cookie: "secret" }] },
    { spaces: [{ id: "space-1", name: "Personal", type: "legacy" }] },
    {},
  ])("rejects missing or broadened canonical output before render", async (invalidOutput) => {
    const { ctx } = await setup(async () => Response.json({ spaces: [] }));
    const source = ctx.tools.get("workspace_space_list")!;
    const render = vi.fn(source.output.render);
    const unregister = ctx.tools.register({
      ...source,
      name: "workspace_space_output_fixture",
      execute: async () => invalidOutput,
      output: { ...source.output, render },
    });
    const result = await execute(ctx, "workspace_space_output_fixture", {});
    expect(result).toMatchObject({ isError: true, error: { info: { code: "INVALID_TOOL_OUTPUT" } } });
    expect(render).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret");
    unregister();
  });

  it("accepts a canonical Space without the optional type field", async () => {
    const { ctx } = await setup(async () => Response.json({ spaces: [] }));
    const source = ctx.tools.get("workspace_space_list")!;
    const render = vi.fn(source.output.render);
    const unregister = ctx.tools.register({
      ...source,
      name: "workspace_space_optional_type_fixture",
      execute: async () => ({ spaces: [{ id: "space-1", name: "Personal" }] }),
      output: { ...source.output, render },
    });
    const result = await execute(ctx, "workspace_space_optional_type_fixture", {});
    expect(result).toMatchObject({
      isError: false,
      value: { spaces: [{ id: "space-1", name: "Personal" }] },
    });
    expect(render).toHaveBeenCalledOnce();
    unregister();
  });

  it("executes real Code Mode dispatch without reflecting invalid arguments", async () => {
    const sentinel = "private-code-cookie-sentinel";
    const { approvalRequests, credentials, ctx, runtime } = await setupCodeMode(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      return url.pathname === "/api/nodes" && init?.method === "POST"
        ? Response.json(node({ id: "created", name: "Created" }))
        : Response.json({ spaces: [{ id: "space-1", name: "Personal", type: "personal" }] });
    });
    runtime.dispatches = [
      {
        name: "workspace_node_create",
        arguments: { space_id: "space-1", name: "Created", cookie: sentinel },
      },
      { name: "workspace_space_list", arguments: {} },
      { name: "workspace_node_create", arguments: { space_id: "space-1", name: "Created" } },
    ];
    const session = Session.create(SessionId("space-node-code-mode"));
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    const agent = { session };
    const result = await ctx.tools.execute({
      arguments: { code: "return await exerciseWorkspace();", description: "Exercise Workspace tools" },
      callId: CallId("space-node-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: agent as never,
    });
    expect(result).toMatchObject({ isError: false });
    const starts = session.events.flatMap((event) => event.type === "tool/code-dispatch-start"
      ? [event.data as CodeDispatchStartEventData]
      : []);
    const settles = session.events.flatMap((event) => event.type === "tool/code-dispatch"
      ? [event.data as CodeDispatchEventData]
      : []);
    expect(starts.map(({ name }) => name)).toEqual([
      "workspace_node_create",
      "workspace_space_list",
      "workspace_node_create",
    ]);
    expect(settles).toMatchObject([{ isError: true }, { isError: false }, { isError: false }]);
    expect(settles.map(({ name, subCallId }) => ({ name, subCallId }))).toEqual(
      starts.map(({ name, subCallId }) => ({ name, subCallId })),
    );
    expect(approvalRequests).toEqual(["workspace_node_create"]);
    expect(result.value).toMatchObject({
      result: [
        { error: expect.any(String) },
        { spaces: [{ id: "space-1" }] },
        { node: { nodeId: "created", name: "Created" } },
      ],
    });
    expect(credentials.reads).toBe(2);
    const pluginSurfaces = JSON.stringify({
      result,
      events: session.events.map((event) => {
        if (event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") {
          const { arguments: _arguments, ...data } = event.data;
          return { ...event, data };
        }
        return event;
      }),
    });
    expect(pluginSurfaces).not.toContain(sentinel);
  });
});

describe("Workspace Space and Node cancellation and lifecycle", () => {
  it("keeps DSH ABORTED_BEFORE_DISPATCH and performs no plugin work", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup(fetcher, "allowed-once");
    const controller = new AbortController();
    controller.abort(new Error("already stopped"));
    const result = await execute(
      ctx,
      "workspace_node_create",
      { space_id: "space-1", name: "Created" },
      fakeAgent(),
      controller.signal,
    );
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "ABORTED_BEFORE_DISPATCH" } },
    });
    expect(approvalRequests).toHaveLength(0);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects JSON-invisible Worktree mutation keys at policy and direct-body seams", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup(fetcher, "allowed-once");
    const args = { name: "Draft", scope: "user" } as Record<PropertyKey, unknown>;
    Object.defineProperty(args, "cookie", { value: "private-sentinel", enumerable: false });
    const result = await execute(ctx, "workspace_worktree_create", args, fakeAgent());
    expect(result).toMatchObject({ isError: true });
    await expect(ctx.tools.get("workspace_worktree_create")!.execute(
      { name: "Draft", scope: "user", [Symbol("secret")]: "private-sentinel" },
      directExecution("workspace_worktree_create"),
    )).rejects.toMatchObject({ code: "workspace-argument-invalid" });
    expect(approvalRequests).toHaveLength(0);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["read", "caller"],
    ["read", "owner"],
    ["mutation", "caller"],
    ["mutation", "owner"],
  ] as const)("classifies accepted %s pre-request cancellation by %s", async (kind, source) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx, fiber } = await setup(fetcher, kind === "mutation" ? "allowed-once" : undefined);
    credentials.readGate = gate;
    const controller = new AbortController();
    const call = execute(
      ctx,
      kind === "read" ? "workspace_space_list" : "workspace_node_create",
      kind === "read" ? {} : { space_id: "space-1", name: "Created" },
      kind === "mutation" ? fakeAgent() : undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(credentials.reads).toBe(1));
    let disposed = false;
    const disposal = source === "owner"
      ? fiber.dispose().then(() => { disposed = true; })
      : undefined;
    if (source === "caller") controller.abort(new Error("caller stopped"));
    if (source === "owner") expect(disposed).toBe(false);
    release();
    await expect(call).resolves.toMatchObject({
      isError: true,
      error: {
        info: {
          code: source === "owner" ? "workspace-plugin-disposing" : "workspace-operation-cancelled",
        },
      },
    });
    await disposal;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["caller", "owner"] as const)("classifies a late successful read stopped by %s", async (source) => {
    let release!: () => void;
    let requested = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { ctx, fiber } = await setup(async () => {
      requested = true;
      await gate;
      return Response.json({ spaces: [] });
    });
    const controller = new AbortController();
    const call = execute(ctx, "workspace_space_list", {}, undefined, controller.signal);
    await vi.waitFor(() => expect(requested).toBe(true));
    const disposal = source === "owner" ? fiber.dispose() : undefined;
    if (source === "caller") controller.abort(new Error("caller stopped"));
    release();
    const result = await call;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: source === "owner" ? "workspace-plugin-disposing" : "workspace-operation-cancelled" } },
    });
    await disposal;
  });

  it("keeps DSH ABORTED identity and adds no-replay guidance after late mutation success", async () => {
    let release!: () => void;
    let requested = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { ctx } = await setup(async () => {
      requested = true;
      await gate;
      return Response.json(node({ id: "created", name: "Created" }));
    }, "allowed-once");
    const controller = new AbortController();
    const call = execute(
      ctx,
      "workspace_node_create",
      { space_id: "space-1", name: "Created" },
      fakeAgent(),
      controller.signal,
    );
    await vi.waitFor(() => expect(requested).toBe(true));
    controller.abort(new Error("caller stopped after dispatch"));
    release();
    const result = await call;
    expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
    expect(JSON.stringify(result.content)).toMatch(/workspace_space_browse.*workspace_space_find.*Never replay/i);
  });

  it("drains owner-only confirmed mutation success and unregisters before settle", async () => {
    let release!: () => void;
    let requested = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { ctx, fiber } = await setup(async () => {
      requested = true;
      await gate;
      return Response.json(node({ id: "created", name: "Created" }));
    }, "allowed-once");
    const call = execute(
      ctx,
      "workspace_node_create",
      { space_id: "space-1", name: "Created" },
      fakeAgent(),
    );
    await vi.waitFor(() => expect(requested).toBe(true));
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await vi.waitFor(() => expect(spaceNodeSchemas(ctx)).toEqual([]));
    expect(disposed).toBe(false);
    release();
    await expect(call).resolves.toMatchObject({ isError: false, value: { node: { nodeId: "created" } } });
    await disposal;
    expect(disposed).toBe(true);
  });

  it("preserves mutation result-unknown after caller cancellation", async () => {
    let requested = false;
    const { ctx } = await setup(async (_input, init) => {
      requested = true;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("lost response")), { once: true });
      });
    }, "allowed-once");
    const controller = new AbortController();
    const call = execute(
      ctx,
      "workspace_node_trash",
      { node_id: "node-1" },
      fakeAgent(),
      controller.signal,
    );
    await vi.waitFor(() => expect(requested).toBe(true));
    controller.abort(new Error("caller stopped"));
    await expect(call).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-unknown" } },
    });
  });
});

describe("Workspace Worktree and Unit tool contracts", () => {
  it("registers exactly twelve closed Worktree, Unit, and review schemas", async () => {
    const { ctx } = await setup(async () => Response.json({ items: [] }));
    const schemas = worktreeUnitSchemas(ctx);
    expect(schemas.map(({ name }) => name).sort()).toEqual([
      "workspace_unit_add",
      "workspace_unit_create",
      "workspace_unit_list",
      "workspace_worktree_create",
      "workspace_worktree_discard",
      "workspace_worktree_get",
      "workspace_worktree_list",
      "workspace_worktree_merge",
      "workspace_worktree_ready",
      "workspace_worktree_reopen",
      "workspace_worktree_review_url",
      "workspace_worktree_update",
    ]);
    expect(schemas.every(({ parameters }) => parameters.additionalProperties === false)).toBe(true);
    const sdk = renderToolsSdk(schemas.map((schema) => ({
      ...schema,
      output: ctx.tools.get(schema.name)!.output.schema,
    })));
    for (const { name } of schemas) expect(sdk).toContain(name);
    expect(sdk).not.toMatch(/\b(?:cookie|password|viewer_url|origin|action|command|initial_data)\??:/i);
  });

  it.each([
    ["workspace_worktree_list", { space_id: "space-1" }],
    ["workspace_worktree_get", { worktree_id: " " }],
    ["workspace_worktree_review_url", { worktree_id: "wt-1", origin: "private-sentinel" }],
    ["workspace_worktree_create", { name: "Draft", scope: "user", space_id: "private-sentinel" }],
    ["workspace_worktree_create", { name: "Draft", scope: "space" }],
    ["workspace_worktree_update", { worktree_id: "wt-1" }],
    ["workspace_worktree_ready", { worktree_id: 1 }],
    ["workspace_worktree_reopen", { worktree_id: "" }],
    ["workspace_worktree_merge", { worktree_id: "wt-1", action: "private-sentinel" }],
    ["workspace_worktree_discard", { worktree_id: " " }],
    ["workspace_unit_list", { worktree_id: "", cookie: "private-sentinel" }],
    ["workspace_unit_add", { worktree_id: "wt-1", resource_id: 1 }],
    ["workspace_unit_create", { worktree_id: "wt-1", space_id: "space-1", type: "pdf", name: "Draft" }],
    ["workspace_unit_create", { worktree_id: "wt-1", space_id: "space-1", type: "sheet", name: "Draft", initial_data: "private-sentinel" }],
  ] as const)("rejects invalid Worktree/Unit arguments for %s before approval or service access", async (name, args) => {
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup(fetcher, "allowed-once");
    const result = await execute(ctx, name, args, fakeAgent());
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-argument-invalid" } },
    });
    expect(JSON.stringify(result)).not.toContain("private-sentinel");
    expect(approvalRequests).toHaveLength(0);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(ctx.tools.get(name)!.execute(args, directExecution(name))).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
  });

  it("returns canonical Worktree reads and builds review URL from the authenticated origin", async () => {
    const requests: string[] = [];
    const { ctx } = await setup(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(`${url.pathname}${url.search}`);
      const worktree = rawWorktree("wt-1", "draft", [rawWorkspaceUnit()]);
      return url.search === ""
        ? Response.json({ worktree })
        : Response.json({ items: [worktree] });
    });

    await expect(execute(ctx, "workspace_worktree_list", { scope: "space", space_id: "space-1" })).resolves.toMatchObject({
      isError: false,
      value: { worktrees: [{ id: "wt-1", units: [{ unitId: "unit-1" }] }] },
    });
    await expect(execute(ctx, "workspace_worktree_get", { worktree_id: "wt-1" })).resolves.toMatchObject({
      isError: false,
      value: { worktree: { id: "wt-1" } },
    });
    await expect(execute(ctx, "workspace_unit_list", { worktree_id: "wt-1" })).resolves.toMatchObject({
      isError: false,
      value: { units: [{ worktreeId: "wt-1" }] },
    });
    await expect(execute(ctx, "workspace_worktree_review_url", { worktree_id: "wt-1" })).resolves.toMatchObject({
      isError: false,
      value: { review: {
        openUrl: "https://workspace.test/worktrees?worktree=wt-1&unit=unit-1&view=agent",
        unitId: "unit-1",
        worktreeId: "wt-1",
      } },
    });
    expect(requests[0]).toBe("/api/worktrees?scope=active&kind=team&teamSpaceId=space-1");
  });

  it.each([
    [0, undefined, "workspace-open-unit-required"],
    [2, undefined, "workspace-open-unit-required"],
    [1, "unit-other", "workspace-unit-not-found"],
  ] as const)("preserves review Unit selection failures for %i Units", async (count, unitId, code) => {
    const units = [rawWorkspaceUnit(), rawWorkspaceUnit({ unitId: "unit-2" })].slice(0, count);
    const { ctx } = await setup(async () => Response.json({ worktree: rawWorktree("wt-1", "draft", units) }));
    await expect(execute(ctx, "workspace_worktree_review_url", {
      worktree_id: "wt-1",
      ...(unitId === undefined ? {} : { unit_id: unitId }),
    })).resolves.toMatchObject({ isError: true, error: { info: { code } } });
  });

  it("executes Worktree create and update with separate one-time approvals", async () => {
    const requests: Request[] = [];
    const { approvalRequests, ctx } = await setup(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      return request.method === "POST"
        ? Response.json(rawWorktree("wt-created"))
        : Response.json({ worktree: rawWorktree("wt-created") });
    }, "allowed-once");
    await expect(execute(ctx, "workspace_worktree_create", {
      name: "Draft",
      scope: "space",
      space_id: "space-1",
      idempotency_key: "stable-key",
    }, fakeAgent())).resolves.toMatchObject({ isError: false, value: { worktree: { id: "wt-created" } } });
    await expect(execute(ctx, "workspace_worktree_update", {
      worktree_id: "wt-created",
      name: "Renamed",
    }, fakeAgent())).resolves.toMatchObject({ isError: false, value: { worktree: { id: "wt-created" } } });
    expect(requests[0]!.headers.get("idempotency-key")).toBe("stable-key");
    expect(approvalRequests.map(({ toolName }) => toolName)).toEqual([
      "workspace_worktree_create",
      "workspace_worktree_update",
    ]);
  });

  it.each([
    ["workspace_worktree_ready", "draft", "ready"],
    ["workspace_worktree_reopen", "ready", "draft"],
    ["workspace_worktree_merge", "ready", "merged"],
    ["workspace_worktree_discard", "draft", "discarded"],
  ] as const)("executes approved lifecycle tool %s", async (name, initial, expected) => {
    const { approvalRequests, ctx } = await setup(async (_input, init) =>
      (init?.method ?? "GET") === "GET"
        ? Response.json({ worktree: rawWorktree("wt-1", initial) })
        : Response.json({ worktree: rawWorktree("wt-1", expected) }), "allowed-once");
    await expect(execute(ctx, name, { worktree_id: "wt-1" }, fakeAgent())).resolves.toMatchObject({
      isError: false,
      value: { worktree: { id: "wt-1", state: expected } },
    });
    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]!.reason).not.toContain("wt-1");
    if (name.endsWith("merge") || name.endsWith("discard")) {
      expect(approvalRequests[0]!.reason).toContain(name.endsWith("merge") ? "Merge" : "Discard");
    }
  });

  it("adds an existing Resource and creates all five Worktree-local Unit types", async () => {
    const { approvalRequests, ctx } = await setup(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ unit: body["source"] === "trunk"
        ? rawWorkspaceUnit()
        : rawWorkspaceUnit({
          name: body["name"],
          source: "worktree",
          target: { parentNodeId: body["targetParentNodeId"], spaceId: body["targetSpaceId"] },
          unitType: body["unitType"],
        }) });
    }, "allowed-once");
    await expect(execute(ctx, "workspace_unit_add", {
      worktree_id: "wt-1",
      resource_id: "resource-1",
    }, fakeAgent())).resolves.toMatchObject({ isError: false, value: { unit: { source: "trunk" } } });
    for (const type of ["sheet", "doc", "slide", "base", "board"] as const) {
      await expect(execute(ctx, "workspace_unit_create", {
        worktree_id: "wt-1",
        space_id: "space-1",
        type,
        name: `${type} draft`,
      }, fakeAgent())).resolves.toMatchObject({
        isError: false,
        value: { unit: { source: "worktree", type } },
      });
    }
    expect(approvalRequests).toHaveLength(6);
  });

  it("rejects invalid Worktree output before rendering", async () => {
    const { ctx } = await setup(async () => Response.json({ items: [] }));
    const source = ctx.tools.get("workspace_worktree_get")!;
    const render = vi.fn(source.output.render);
    const unregister = ctx.tools.register({
      ...source,
      name: "workspace_worktree_output_fixture",
      execute: async () => ({ worktree: { ...toolRawWorktree("wt-1"), secret: true } }),
      output: { ...source.output, render },
    });
    const result = await execute(ctx, "workspace_worktree_output_fixture", { worktree_id: "wt-1" });
    expect(result).toMatchObject({ isError: true, error: { info: { code: "INVALID_TOOL_OUTPUT" } } });
    expect(render).not.toHaveBeenCalled();
    unregister();
  });

  it("keeps Code Mode invalid mutation arguments only in DSH-owned argument records", async () => {
    const sentinel = "private-worktree-code-sentinel";
    const { approvalRequests, credentials, ctx, runtime } = await setupCodeMode(async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ unit: rawWorkspaceUnit({
          name: body["name"],
          source: "worktree",
          target: { parentNodeId: null, spaceId: body["targetSpaceId"] },
          unitType: body["unitType"],
        }) });
      }
      return Response.json({ items: [] });
    });
    runtime.dispatches = [
      { name: "workspace_worktree_create", arguments: { name: "Draft", scope: "user", cookie: sentinel } },
      { name: "workspace_unit_create", arguments: { worktree_id: "wt-1", space_id: "space-1", type: "sheet", name: "Draft", initial_data: sentinel } },
      { name: "workspace_worktree_list", arguments: {} },
      { name: "workspace_unit_create", arguments: { worktree_id: "wt-1", space_id: "space-1", type: "sheet", name: "Draft" } },
    ];
    const session = Session.create(SessionId("worktree-unit-code-mode"));
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    const result = await ctx.tools.execute({
      arguments: { code: "return await exerciseWorkspace();", description: "Exercise Worktree tools" },
      callId: CallId("worktree-unit-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: { session } as never,
    });
    expect(result).toMatchObject({ isError: false });
    const starts = session.events.flatMap((event) => event.type === "tool/code-dispatch-start"
      ? [event.data as CodeDispatchStartEventData]
      : []);
    const settles = session.events.flatMap((event) => event.type === "tool/code-dispatch"
      ? [event.data as CodeDispatchEventData]
      : []);
    expect(starts.map(({ name }) => name)).toEqual([
      "workspace_worktree_create",
      "workspace_unit_create",
      "workspace_worktree_list",
      "workspace_unit_create",
    ]);
    expect(settles.map(({ isError }) => isError)).toEqual([true, true, false, false]);
    expect(settles.map(({ name, subCallId }) => ({ name, subCallId }))).toEqual(
      starts.map(({ name, subCallId }) => ({ name, subCallId })),
    );
    expect(result.value).toMatchObject({
      result: [
        { error: expect.any(String) },
        { error: expect.any(String) },
        { worktrees: [] },
        { unit: {
          worktreeId: "wt-1",
          unitId: "unit-1",
          source: "worktree",
          target: { parentNodeId: null, spaceId: "space-1" },
          type: "sheet",
        } },
      ],
    });
    expect(JSON.stringify(starts)).toContain(sentinel);
    expect(JSON.stringify(settles)).toContain(sentinel);
    expect(approvalRequests).toEqual(["workspace_unit_create"]);
    expect(credentials.reads).toBe(2);
    expect(JSON.stringify({ result, events: session.events.map((event) => {
      if (event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") {
        const { arguments: _arguments, ...data } = event.data;
        return { ...event, data };
      }
      return event;
    }) })).not.toContain(sentinel);
  });

  it.each([
    ["workspace_worktree_create", { name: "Draft", scope: "user" }, "workspace_worktree_list"],
    ["workspace_worktree_ready", { worktree_id: "wt-1" }, "workspace_worktree_get"],
    ["workspace_unit_add", { worktree_id: "wt-1", resource_id: "resource-1" }, "workspace_unit_list"],
  ] as const)("adds inspection guidance to uncertain %s without replay", async (name, args, inspection) => {
    const { ctx } = await setup(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (name === "workspace_worktree_ready" && (init?.method ?? "GET") === "GET") {
        return Response.json({ worktree: rawWorktree("wt-1", "draft") });
      }
      if (url.pathname.includes("/api/worktrees")) throw new Error("response lost");
      return Response.json({});
    }, "allowed-once");
    const result = await execute(ctx, name, args, fakeAgent());
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-result-unknown" } } });
    expect(JSON.stringify(result.content)).toContain(inspection);
    expect(JSON.stringify(result.content)).toMatch(/Never replay/i);
  });

  it.each(["rejected", "cancelled", "unavailable", undefined] as const)(
    "fails closed when Worktree approval is %s",
    async (outcome) => {
      const fetcher = vi.fn<typeof fetch>();
      const setupResult = await setup(fetcher, outcome);
      const result = await execute(
        setupResult.ctx,
        "workspace_worktree_create",
        { name: "Draft", scope: "user" },
        fakeAgent(),
      );
      expect(result.isError).toBe(true);
      expect(setupResult.credentials.reads).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("preserves lifecycle invalid and one bounded lifecycle read-back", async () => {
    let scenario: "invalid" | "confirmed" | "unconfirmed" = "invalid";
    let getCount = 0;
    const { ctx } = await setup(async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") throw new Error("response lost");
      getCount += 1;
      const state = scenario === "invalid"
        ? "ready"
        : scenario === "confirmed" && getCount === 2
          ? "merged"
          : "ready";
      return Response.json({ worktree: rawWorktree("wt-1", state) });
    }, "allowed-once");
    await expect(execute(ctx, "workspace_worktree_ready", { worktree_id: "wt-1" }, fakeAgent())).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-lifecycle-invalid" } },
    });
    scenario = "confirmed";
    getCount = 0;
    await expect(execute(ctx, "workspace_worktree_merge", { worktree_id: "wt-1" }, fakeAgent())).resolves.toMatchObject({
      isError: false,
      value: { worktree: { state: "merged" } },
    });
    scenario = "unconfirmed";
    getCount = 0;
    await expect(execute(ctx, "workspace_worktree_merge", { worktree_id: "wt-1" }, fakeAgent())).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-unknown" } },
    });
  });

  it("preserves Worktree workflow errors and hides unlisted Server material", async () => {
    const sentinel = "private-worktree-server-sentinel";
    const workflow = await setup(async () => Response.json({ worktree: rawWorktree("wt-1", "draft", []) }));
    const selected = await execute(workflow.ctx, "workspace_worktree_review_url", { worktree_id: "wt-1" });
    expect(selected).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-open-unit-required" } },
    });
    if (!selected.isError) throw new Error("expected review failure");
    expect(parseFailureEnvelope(selected.error.message)).toEqual({
      code: "workspace-open-unit-required",
      detail: { worktreeId: "wt-1", unitCount: 0 },
    });

    const hidden = await setup(async () => Response.json(
      { error: { code: sentinel, message: sentinel } },
      { status: 500 },
    ));
    const result = await execute(hidden.ctx, "workspace_worktree_list", {});
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-failed" } },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it.each([
    ["workspace_unit_list", { units: [{ secret: true }] }],
    ["workspace_worktree_review_url", { review: { openUrl: 42, type: "sheet", unitId: "unit-1", worktreeId: "wt-1" } }],
  ] as const)("rejects invalid %s output before rendering", async (sourceName, invalidOutput) => {
    const { ctx } = await setup(async () => Response.json({ items: [] }));
    const source = ctx.tools.get(sourceName)!;
    const render = vi.fn(source.output.render);
    const fixtureName = `${sourceName}_output_fixture`;
    const unregister = ctx.tools.register({
      ...source,
      name: fixtureName,
      execute: async () => invalidOutput,
      output: { ...source.output, render },
    });
    const result = await execute(ctx, fixtureName, sourceName === "workspace_unit_list"
      ? { worktree_id: "wt-1" }
      : { worktree_id: "wt-1" });
    expect(result).toMatchObject({ isError: true, error: { info: { code: "INVALID_TOOL_OUTPUT" } } });
    expect(render).not.toHaveBeenCalled();
    unregister();
  });

  it("keeps Native invalid mutation arguments only in tool/call.arguments", async () => {
    const sentinel = "private-worktree-native-sentinel";
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(MemoryCredentials);
    await ctx.plugin(ApprovalService);
    const approvalRequests: string[] = [];
    ctx.on("approval/request", (request) => {
      approvalRequests.push(request.toolName);
      return Promise.resolve<ApprovalOutcome>("allowed-once");
    });
    const fiber = ctx.plugin({
      name: "dsh-univer-work-native-invalid-test",
      inject: ["credentials", "tools", "skills"],
      apply(child: Context) {
        mountWorkspaceAuthentication(child, { fetcher: vi.fn<typeof fetch>() });
      },
    });
    await fiber;
    const credentials = ctx.credentials as MemoryCredentials;
    credentials.seed(grantRecord(authenticated()));
    class NativeAdapter extends LlmAdapter {
      private calls = 0;

      public override resolveModel(provider: string, model: string) {
        return Promise.resolve({ provider, id: model, name: model });
      }

      public override async * stream() {
        if (this.calls++ === 0) {
          yield { type: "block-start" as const, index: 0, blockType: "tool-call" as const };
          yield {
            type: "block-end" as const,
            index: 0,
            block: {
              type: "tool-call" as const,
              id: CallId("native-invalid-unit-add"),
              name: "workspace_unit_add",
              arguments: JSON.stringify({
                worktree_id: "wt-1",
                resource_id: "resource-1",
                cookie: sentinel,
              }),
            },
          };
          yield { type: "usage" as const, usage: { inputTokens: 1, outputTokens: 1 } };
          yield { type: "finish" as const, reason: { kind: "tool-calls" as const } };
          return;
        }
        yield { type: "block-start" as const, index: 0, blockType: "text" as const };
        yield { type: "text-delta" as const, index: 0, text: "done" };
        yield { type: "block-end" as const, index: 0, block: { type: "text" as const, text: "done" } };
        yield { type: "usage" as const, usage: { inputTokens: 1, outputTokens: 1 } };
        yield { type: "finish" as const, reason: { kind: "stop" as const } };
      }
    }
    ctx.llm.registerAdapter(["native-invalid"], new NativeAdapter());
    await ctx.plugin(AgentLoop, { agents: [] });
    const agent = ctx.agentLoop.create(SessionId("worktree-unit-native-invalid"), {
      provider: "native-invalid",
      model: "native-invalid",
    });
    agent.followup(createUserMessage({
      content: [{ type: "text", text: "Exercise invalid Unit mutation." }],
      source: { kind: "user" },
    }));
    await agent.whenIdle();
    const calls = agent.session.events.filter(({ type }) => type === "tool/call");
    expect(JSON.stringify(calls)).toContain(sentinel);
    expect(approvalRequests).toHaveLength(0);
    expect(credentials.reads).toBe(0);
    expect(JSON.stringify({
      approvalRequests,
      results: agent.session.events.filter(({ type }) => type === "tool/result"),
    })).not.toContain(sentinel);
  });

  it.each([
    ["read", "caller"],
    ["read", "owner"],
    ["mutation", "caller"],
    ["mutation", "owner"],
  ] as const)("classifies Worktree/Unit %s pre-request cancellation by %s", async (kind, source) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx, fiber } = await setup(fetcher, kind === "mutation" ? "allowed-once" : undefined);
    credentials.readGate = gate;
    const controller = new AbortController();
    const call = execute(
      ctx,
      kind === "read" ? "workspace_worktree_list" : "workspace_unit_add",
      kind === "read" ? {} : { worktree_id: "wt-1", resource_id: "resource-1" },
      kind === "mutation" ? fakeAgent() : undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(credentials.reads).toBe(1));
    const disposal = source === "owner" ? fiber.dispose() : undefined;
    if (source === "caller") controller.abort(new Error("caller stopped"));
    release();
    await expect(call).resolves.toMatchObject({
      isError: true,
      error: { info: { code: source === "owner" ? "workspace-plugin-disposing" : "workspace-operation-cancelled" } },
    });
    await disposal;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps caller-late Worktree success ABORTED and drains owner-only confirmed success", async () => {
    let release!: () => void;
    let requested = false;
    let gate = new Promise<void>((resolve) => { release = resolve; });
    const { ctx, fiber } = await setup(async () => {
      requested = true;
      await gate;
      return Response.json(rawWorktree("wt-1"));
    }, "allowed-once");
    const controller = new AbortController();
    const callerCall = execute(ctx, "workspace_worktree_create", { name: "Draft", scope: "user" }, fakeAgent(), controller.signal);
    await vi.waitFor(() => expect(requested).toBe(true));
    controller.abort(new Error("caller stopped"));
    release();
    const callerResult = await callerCall;
    expect(callerResult).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
    expect(JSON.stringify(callerResult.content)).toMatch(/workspace_worktree_list.*Never replay/i);

    requested = false;
    gate = new Promise<void>((resolve) => { release = resolve; });
    const ownerCall = execute(ctx, "workspace_worktree_create", { name: "Draft", scope: "user" }, fakeAgent());
    await vi.waitFor(() => expect(requested).toBe(true));
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await vi.waitFor(() => expect(worktreeUnitSchemas(ctx)).toEqual([]));
    expect(disposed).toBe(false);
    release();
    await expect(ownerCall).resolves.toMatchObject({ isError: false, value: { worktree: { id: "wt-1" } } });
    await disposal;
    expect(disposed).toBe(true);
  });

  it("registers the packaged core Skill for model and user invocation and disposes it", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(MemoryCredentials);
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() });
    ctx.provide("agents", {} as never);
    await ctx.plugin(ToolSkill);
    const fiber = ctx.plugin({
      name: "dsh-univer-work-core-skill-test",
      inject: ["credentials", "tools", "skills", "fs"],
      apply(child: Context) {
        mountWorkspaceAuthentication(child, { fetcher: async () => Response.json({}) });
      },
    });
    await fiber;
    const source = await readFile(new URL("../skills/core/SKILL.md", import.meta.url), "utf8");
    const realToolCatalog = ctx.tools.schemas()
      .map(({ name }) => name)
      .filter((name) => name.startsWith("workspace_"))
      .sort();
    expect(realToolCatalog).toEqual(ACCEPTED_WORKSPACE_TOOL_NAMES);
    validateBundledSkillSources(await Promise.all(BUNDLED_WORKSPACE_SKILL_NAMES.map(async (name) => ({
      name,
      source: await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8"),
    }))), realToolCatalog);
    const registered = await ctx.skills.get("core");
    expect(registered).toMatchObject({
      name: "core",
      source: "bundled",
      invocation: { modelInvocable: true, userInvocable: true },
      content: source,
    });
    expect(source).not.toMatch(/univer-workspace-cli|workspace_blob_|workspace_content_|workspace_office_|workspace_typst_|workspace_svg_|workspace_render_|screenshot|layout lint|Web Client/i);
    for (const definition of loadBundledWorkspaceSkills()) {
      await expect(ctx.skills.get(definition.name)).resolves.toMatchObject({
        ...definition,
        source: "bundled",
        provider: "runtime",
        invocation: { modelInvocable: true, userInvocable: true },
      });
    }

    const session = Session.create(SessionId("worktree-unit-core-skill"));
    const result = await execute(ctx, "skill", { name: "core" }, { session });
    expect(result).toMatchObject({
      isError: false,
      value: { name: "core", provider: "runtime", content: source },
    });
    await fiber.dispose();
    await expect(ctx.skills.get("core")).resolves.toBeUndefined();
    for (const name of BUNDLED_WORKSPACE_SKILL_NAMES) {
      await expect(ctx.skills.get(name)).resolves.toBeUndefined();
    }
  });
});

async function setup(fetcher: typeof fetch, approval?: ApprovalOutcome): Promise<{
  readonly approvalRequests: Array<{ readonly toolName: string; readonly reason?: string }>;
  readonly credentials: MemoryCredentials;
  readonly ctx: Context;
  readonly fiber: { dispose(): Promise<void> };
}> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(MemoryCredentials);
  const approvalRequests: Array<{ readonly toolName: string; readonly reason?: string }> = [];
  if (approval !== undefined) {
    await ctx.plugin(ApprovalService);
    ctx.on("approval/request", (request) => {
      approvalRequests.push({
        toolName: request.toolName,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      });
      return Promise.resolve(approval);
    });
  }
  const fiber = ctx.plugin({
    name: "dsh-univer-work-space-node-test",
    inject: ["credentials", "tools", "skills"],
    apply(child: Context) {
      mountWorkspaceAuthentication(child, { fetcher });
    },
  });
  await fiber;
  const credentials = ctx.credentials as MemoryCredentials;
  credentials.seed(grantRecord(authenticated()));
  return { approvalRequests, credentials, ctx, fiber };
}

async function setupCodeMode(fetcher: typeof fetch): Promise<{
  readonly approvalRequests: string[];
  readonly credentials: MemoryCredentials;
  readonly ctx: Context;
  readonly runtime: ControlledCodeRuntime;
}> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ControlledCodeRuntime);
  await ctx.plugin(ToolRuntime, { mode: "code" });
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(MemoryCredentials);
  await ctx.plugin(ApprovalService);
  const approvalRequests: string[] = [];
  ctx.on("approval/request", (request) => {
    approvalRequests.push(request.toolName);
    return Promise.resolve<ApprovalOutcome>("allowed-once");
  });
  const fiber = ctx.plugin({
    name: "dsh-univer-work-space-node-code-test",
    inject: ["credentials", "tools", "skills"],
    apply(child: Context) {
      mountWorkspaceAuthentication(child, { fetcher });
    },
  });
  await fiber;
  const credentials = ctx.credentials as MemoryCredentials;
  credentials.seed(grantRecord(authenticated()));
  return { approvalRequests, credentials, ctx, runtime: ctx.codeRuntime as ControlledCodeRuntime };
}

async function execute(
  ctx: Context,
  name: string,
  arguments_: unknown,
  agent?: unknown,
  signal: AbortSignal = new AbortController().signal,
) {
  return await ctx.tools.execute({
    arguments: arguments_,
    callId: CallId(`${name}-${Math.random()}`),
    name,
    signal,
    ...(agent === undefined ? {} : { agent: agent as never }),
  });
}

function directExecution(name: string): ToolRunContext {
  return {
    arguments: {},
    callId: CallId(`direct-${name}`),
    rootCallId: CallId(`direct-${name}`),
    name,
    signal: new AbortController().signal,
    token: Symbol(name) as never,
    deferContext() {},
    concludeTurn() {},
  };
}

function parseFailureEnvelope(message: string): unknown {
  const start = message.indexOf("{");
  return JSON.parse(message.slice(start));
}

function spaceNodeSchemas(ctx: Context) {
  return ctx.tools.schemas().filter(({ name }) =>
    name.startsWith("workspace_space_") || name.startsWith("workspace_node_"));
}

function worktreeUnitSchemas(ctx: Context) {
  return ctx.tools.schemas().filter(({ name }) =>
    name.startsWith("workspace_worktree_") || name.startsWith("workspace_unit_"));
}

function fakeAgent(): unknown {
  return { session: { events: [{ type: "turn/start" }], append: () => ({}) } };
}

function authenticated(): AuthenticatedWorkspaceGrant {
  return {
    state: "authenticated",
    cookie,
    origin,
    subject: { id: "user-1", name: "Alice" },
  };
}

function node(overrides: {
  readonly hasChildren?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly parentNodeId?: string | null;
  readonly resource?: Record<string, unknown> | null;
} = {}): Record<string, unknown> {
  return {
    accessRole: "owner",
    capabilities: {
      browseChildren: true,
      createChildren: true,
      move: true,
      rename: true,
      share: true,
      trash: true,
    },
    hasChildren: overrides.hasChildren ?? false,
    id: overrides.id ?? "node-1",
    name: overrides.name ?? "Folder",
    parentNodeId: overrides.parentNodeId ?? null,
    resource: overrides.resource ?? null,
    spaceId: "space-1",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function univerResource(unitType: string): Record<string, unknown> {
  return {
    capabilities: { downloadContent: false, editContent: true, openContent: true },
    id: "resource-1",
    kind: "univer",
    unitType,
  };
}

function nodePage(input: {
  readonly nextCursor?: string | null;
  readonly nodes: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    breadcrumbs: [],
    navigationRootNodeId: null,
    nextCursor: input.nextCursor ?? null,
    nodes: input.nodes,
    parentNode: null,
    space: { id: "space-1", name: "Personal", type: "personal" },
  };
}

function trashBatch(nodeId: string): Record<string, unknown> {
  return {
    capabilities: { removePermanently: true, restore: true },
    id: "trash-1",
    nodeCount: 1,
    originalLocation: { breadcrumbs: [{ id: nodeId, name: "Folder" }] },
    removeBlockedBy: null,
    restoreBlockedBy: null,
    root: { id: nodeId, name: "Folder", resource: null },
    spaceId: "space-1",
    trashedAt: "2026-08-29T00:00:00.000Z",
    trashedBy: { avatarUrl: null, displayName: "Alice", id: "user-1", username: "alice" },
  };
}

function rawWorktree(
  id: string,
  state = "draft",
  units: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return { id, name: "Draft", state, teamSpace: null, units };
}

function rawWorkspaceUnit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activationState: "notApplicable",
    change: "unchanged",
    draftHeadRevision: 0,
    mergeResult: "pending",
    name: "Sheet",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "trunk",
    target: null,
    unitId: "unit-1",
    unitType: "sheet",
    ...overrides,
  };
}

function toolRawWorktree(id: string): Record<string, unknown> {
  return { id, name: "Draft", state: "draft", units: [] };
}

interface ControlledDispatch {
  readonly arguments: Record<string, unknown>;
  readonly name: string;
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly isolation = "fixture";
  public readonly language = "typescript";
  public dispatches: ControlledDispatch[] = [];

  public override async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const tools = request.bindings.find(({ global }) => global === "tools")?.functions;
    if (tools === undefined) return { logs: [], error: { kind: "exception", message: "missing tools" } };
    const value: CodeJsonValue[] = [];
    for (const dispatch of this.dispatches) {
      try {
        value.push(await tools[dispatch.name]!(dispatch.arguments));
      } catch (error) {
        value.push({ error: error instanceof Error ? error.message : "tool failed" });
      }
    }
    return { logs: [], value };
  }
}

class MemoryCredentials extends CredentialProvider {
  private record: CredentialRecord | undefined;
  public readFailure: Error | undefined;
  public readGate: Promise<void> | undefined;
  public reads = 0;

  public seed(record: CredentialRecord | undefined): void {
    this.record = record;
  }

  public override async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    this.reads += 1;
    await this.readGate;
    if (this.readFailure !== undefined) throw this.readFailure;
    return this.record;
  }

  public override async modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const next = await mutate(this.record);
    if (next !== undefined) this.record = next;
    return this.record;
  }

  public override deleteRecord(_key: CredentialKey): Promise<void> {
    this.record = undefined;
    return Promise.resolve();
  }

  public override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(undefined); }
  public override describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: false, writable: true }); }
  public override set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve(); }
  public override unset(_ref: CredentialRef): Promise<void> { return Promise.resolve(); }
  public override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve(this.record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: this.record.kind, writable: true });
  }
  public override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]); }
}
