import { mkdtemp, mkdir, open, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import CodeRuntime, {
  type CodeJsonValue,
  type CodeRunRequest,
  type CodeRunResult,
} from "@deepseek-ai/dsh-code-runtime";
import { CallId, HarnessError } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { FileSystem, FsTarget } from "@deepseek-ai/dsh-fs";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import type { ApiReference } from "@univer-cli/api-reference";
import {
  type CreateResourceLibraryOptions,
  ResourceLibraryError,
  type ResourceLibrary,
} from "@univer-cli/resource-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountWorkspaceAuthentication } from "../src/authentication.js";
import {
  createCumulativeResourceFetch,
  createWorkspaceDiscoveryDatasets,
  registerWorkspaceApiDiscoveryTools,
  WorkspaceDiscoveryDatasetError,
} from "../src/discovery-tools.js";
import { WorkspaceToolOwner } from "../src/tool-owner.js";
import { currentFilesystem } from "../src/file-transfer.js";

const contexts: Context[] = [];
const temporaryDirectories: string[] = [];
const datasetSentinel = "password=dataset-secret";

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
  await Promise.all(temporaryDirectories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })));
});

describe("Workspace discovery datasets", () => {
  it("loads the installed public datasets without fetch or cache state", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const datasets = createWorkspaceDiscoveryDatasets();
    expect(datasets.apiReference.find({ terms: ["setValues"], limit: 1 })[0])
      .toMatchObject({ term: "setValues", totalMatches: expect.any(Number) });
    expect(datasets.queryResources.listRegistries().length).toBeGreaterThan(0);
    expect(datasets.queryResources.find({ queries: ["arrow"], limit: 1 }))
      .toMatchObject({ resources: [expect.objectContaining({ handle: expect.any(String) })] });
    expect(datasets.queryResources.cacheLocation).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { resourceManifest: undefined },
    { resourceManifest: {} },
    { createApiReference: () => ({ find: () => [], show: "not-a-function" }) },
    { createApiReference: () => { throw new Error(datasetSentinel); } },
    { loadResourceManifest: () => { throw new Error(`/private/checkout/manifest.json?${datasetSentinel}`); } },
  ])("rejects a missing or malformed public dataset", (discovery) => {
    let error: unknown;
    try {
      createWorkspaceDiscoveryDatasets({
        ...discovery,
        ...(Object.hasOwn(discovery, "resourceManifest")
          ? { resourceManifest: discovery.resourceManifest }
          : {}),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WorkspaceDiscoveryDatasetError);
    expect(error).toMatchObject({ code: "workspace-discovery-dataset-invalid" });
    expect(String(error)).not.toContain(datasetSentinel);
  });

  it("fails activation before registering any tool or Skill", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    const registerTool = vi.fn(() => () => undefined);
    const registerSkill = vi.fn(() => () => undefined);
    ctx.provide("credentials", {} as Context["credentials"]);
    ctx.provide("tools", { register: registerTool } as unknown as Context["tools"]);
    ctx.provide("skills", { register: registerSkill } as unknown as Context["skills"]);
    ctx.provide("fs", { sandboxMode: undefined } as unknown as Context["fs"]);

    const fiber = ctx.plugin({
      name: "dsh-univer-work-invalid-discovery-test",
      inject: ["credentials", "tools", "skills", "fs"],
      apply(child: Context) {
        mountWorkspaceAuthentication(child, { discovery: { resourceManifest: {} } });
      },
    });

    await expect(fiber).rejects.toMatchObject({ code: "workspace-discovery-dataset-invalid" });
    expect(registerTool).not.toHaveBeenCalled();
    expect(registerSkill).not.toHaveBeenCalled();
  });

  it("sanitizes installed manifest load failure before activation registers tools", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    const registerTool = vi.fn(() => () => undefined);
    ctx.provide("credentials", {} as Context["credentials"]);
    ctx.provide("tools", { register: registerTool } as unknown as Context["tools"]);
    ctx.provide("skills", { register: vi.fn() } as unknown as Context["skills"]);
    ctx.provide("fs", { sandboxMode: undefined } as unknown as Context["fs"]);
    const fiber = ctx.plugin({
      name: "dsh-univer-work-missing-discovery-manifest-test",
      inject: ["credentials", "tools", "skills", "fs"],
      apply(child: Context) {
        mountWorkspaceAuthentication(child, {
          discovery: {
            loadResourceManifest: () => {
              throw new Error(`/private/checkout/manifest.json?${datasetSentinel}`);
            },
          },
        });
      },
    });

    let error: unknown;
    try {
      await fiber;
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "workspace-discovery-dataset-invalid" });
    expect(String(error)).not.toContain(datasetSentinel);
    expect(String(error)).not.toContain("/private/checkout");
    expect(registerTool).not.toHaveBeenCalled();
  });
});

describe("Workspace API discovery tools", () => {
  it("returns closed installed API find and not-found show values without a credential", async () => {
    const ctx = await setupDiscovery();
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_api_")))
      .toMatchObject([
        { name: "workspace_api_find", parameters: { additionalProperties: false } },
        { name: "workspace_api_show", parameters: { additionalProperties: false } },
      ]);

    const found = await execute(ctx, "workspace_api_find", {
      terms: ["setValues"],
      unit: "sheet",
      limit: 1,
    });
    expect(found).toMatchObject({
      isError: false,
      value: {
        terms: [{
          term: "setValues",
          matches: [expect.objectContaining({ label: expect.any(String) })],
          totalMatches: expect.any(Number),
        }],
      },
    });

    const missing = await execute(ctx, "workspace_api_show", {
      symbols: ["DefinitelyMissingWorkspaceApiSymbol"],
    });
    expect(missing).toMatchObject({
      isError: false,
      value: {
        results: [{
          status: "not-found",
          kind: "symbol",
          query: "DefinitelyMissingWorkspaceApiSymbol",
          suggestions: expect.any(Array),
        }],
      },
    });
  });

  it("returns every installed API show union as complete canonical data", async () => {
    const ctx = await setupDiscovery();
    const symbols = ["FRange", "FRange.setValues", "ICellData", "ICellData.v"];
    const result = await execute(ctx, "workspace_api_show", { symbols });
    expect(result).toMatchObject({
      isError: false,
      value: {
        results: [
          { status: "found", kind: "class", query: symbols[0], groups: expect.any(Array) },
          { status: "found", kind: "member", query: symbols[1], entries: expect.any(Array) },
          { status: "found", kind: "type", query: symbols[2], type: expect.any(Object) },
          { status: "found", kind: "type-member", query: symbols[3], member: expect.any(Object) },
        ],
      },
    });
  });

  it.each([
    [{ terms: [] }, "workspace_api_find"],
    [{ terms: ["same", "same"] }, "workspace_api_find"],
    [{ terms: ["x".repeat(161)] }, "workspace_api_find"],
    [{ terms: ["x"], unit: "document" }, "workspace_api_find"],
    [{ terms: ["x"], limit: 0 }, "workspace_api_find"],
    [{ terms: ["x"], limit: 31 }, "workspace_api_find"],
    [{ terms: ["x"], extra: true }, "workspace_api_find"],
    [{ symbols: [] }, "workspace_api_show"],
    [{ symbols: ["same", "same"] }, "workspace_api_show"],
    [{ symbols: ["x".repeat(161)] }, "workspace_api_show"],
    [{ symbols: ["x"], extra: true }, "workspace_api_show"],
  ])("rejects bounded closed arguments before installed lookup", async (arguments_, name) => {
    const harness = directApiTools();
    await expect(directExecute(harness.definitions, name, arguments_))
      .rejects.toMatchObject({ code: "workspace-discovery-argument-invalid" });
    expect(harness.find).not.toHaveBeenCalled();
    expect(harness.show).not.toHaveBeenCalled();
  });

  it.each([
    ["workspace_api_find", { terms: ["setValues"] }, {
      find: () => [{ term: "wrong", matches: [], totalMatches: 0 }],
      show: () => [],
    }],
    ["workspace_api_show", { symbols: ["FRange"] }, {
      find: () => [],
      show: () => [{ status: "not-found", kind: "symbol", query: "wrong", suggestions: [] }],
    }],
  ] as const)("rejects incompatible dependency output through real ToolRuntime", async (name, arguments_, api) => {
    const ctx = await setupDiscovery({ apiReference: api as unknown as ApiReference });
    const result = await execute(ctx, name, arguments_);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-discovery-result-invalid" } },
    });
  });

  it("rejects a complete API result over 1 MiB without truncating it", async () => {
    const summary = "x".repeat(1_048_576);
    const ctx = await setupDiscovery({
      apiReference: {
        find: () => [{
          term: "large",
          matches: [{
            kind: "method",
            label: "large",
            signature: "large(): void",
            summary,
            packageName: "sheets",
            score: 1,
          }],
          totalMatches: 1,
        }],
        show: () => [],
      },
    });
    const result = await execute(ctx, "workspace_api_find", { terms: ["large"] });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-discovery-result-too-large" } },
    });
    expect(JSON.stringify(result)).toContain("Narrow the discovery query.");
    expect(JSON.stringify(result)).not.toContain(summary.slice(0, 1024));
  });

  it("sanitizes an unknown API dependency failure through real ToolRuntime", async () => {
    const ctx = await setupDiscovery({
      apiReference: {
        find: () => { throw new Error(`/private/reference?${datasetSentinel}`); },
        show: () => [],
      },
    });
    const result = await execute(ctx, "workspace_api_find", { terms: ["setValues"] });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-discovery-operation-failed" } },
    });
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    expect(JSON.stringify(result)).not.toContain("/private/reference");
  });

  it.each(["internal-file-error", "forged-file-code"])(
    "does not preserve %s from a read-only query dependency",
    async (variant) => {
      let failure: unknown;
      if (variant === "internal-file-error") {
        try {
          currentFilesystem(new Context(), "resource export");
        } catch (error) {
          failure = error;
        }
      } else {
        failure = new HarnessError(`secret ${datasetSentinel}`, "workspace-file-policy-denied");
      }
      const ctx = await setupDiscovery({
        apiReference: {
          find: () => { throw failure; },
          show: () => [],
        },
      });
      const result = await execute(ctx, "workspace_api_find", { terms: ["setValues"] });
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-discovery-operation-failed" } },
      });
      expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    },
  );

  it("returns the same canonical keyless discovery values through real Code Mode dispatch", async () => {
    const ctx = await setupDiscovery({ codeMode: true });
    const codeRuntime = ctx.codeRuntime as ControlledCodeRuntime;
    codeRuntime.dispatches = [
      { name: "workspace_api_find", arguments: { terms: ["setValues"], limit: 1 } },
      { name: "workspace_api_show", arguments: { symbols: ["DefinitelyMissingWorkspaceApiSymbol"] } },
      { name: "workspace_resource_registries", arguments: {} },
      { name: "workspace_resource_find", arguments: { queries: ["arrow"], limit: 1 } },
    ];
    const id = SessionId("discovery-code-mode");
    const session = Session.create(id, [], { version: 0, id, createdAt: 0 });
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    const result = await ctx.tools.execute({
      agent: { session } as never,
      arguments: { code: "return await tools.workspace_api_find({});", description: "Discover APIs" },
      callId: CallId("discovery-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      isError: false,
      value: {
        result: [
          { terms: [{ term: "setValues", matches: expect.any(Array) }] },
          { results: [{ status: "not-found", query: "DefinitelyMissingWorkspaceApiSymbol" }] },
          { registries: expect.any(Array) },
          { resources: [expect.objectContaining({ handle: expect.any(String) })], total: expect.any(Number) },
        ],
      },
    });
    const starts = session.events.filter((event) => event.type === "tool/code-dispatch-start");
    const settled = session.events.filter((event) => event.type === "tool/code-dispatch");
    expect(starts).toHaveLength(4);
    expect(settled).toHaveLength(4);
    expect(settled.map(({ data }) => ({ name: data.name, subCallId: data.subCallId })))
      .toEqual(starts.map(({ data }) => ({ name: data.name, subCallId: data.subCallId })));
  });

  it.each([
    ["workspace_api_find", { terms: "not-an-array" }],
    ["workspace_api_find", { terms: new Array(1) }],
    ["workspace_api_find", { terms: [1] }],
    ["workspace_api_show", { symbols: "not-an-array" }],
    ["workspace_api_show", { symbols: new Array(1) }],
    ["workspace_api_show", { symbols: [1] }],
  ])("rejects malformed %s arrays as arguments before dataset access", async (name, args) => {
    const harness = directApiTools();
    await expect(directExecute(harness.definitions, name, args))
      .rejects.toMatchObject({ code: "workspace-discovery-argument-invalid" });
    expect(harness.find).not.toHaveBeenCalled();
    expect(harness.show).not.toHaveBeenCalled();
  });

  it.each([
    ["workspace_api_find", "terms"],
    ["workspace_api_show", "symbols"],
  ])("rejects accessor, toJSON, and symbol array state for %s without executing it", async (name, key) => {
    for (const variant of ["root-accessor", "index-accessor", "toJSON", "symbol"] as const) {
      let effects = 0;
      const array: unknown[] = ["setValues"];
      let args: Record<string, unknown> = { [key]: array };
      if (variant === "root-accessor") {
        args = {};
        Object.defineProperty(args, key, {
          enumerable: true,
          get() {
            effects += 1;
            return array;
          },
        });
      } else if (variant === "index-accessor") {
        Object.defineProperty(array, "0", {
          enumerable: true,
          get() {
            effects += 1;
            return "setValues";
          },
        });
      } else if (variant === "toJSON") {
        Object.defineProperty(array, "toJSON", {
          enumerable: true,
          value: () => {
            effects += 1;
            return ["setValues"];
          },
        });
      } else {
        Object.defineProperty(array, Symbol("secret"), {
          enumerable: true,
          value: "secret",
        });
      }
      const harness = directApiTools();
      await expect(directExecute(harness.definitions, name, args))
        .rejects.toMatchObject({ code: "workspace-discovery-argument-invalid" });
      expect(effects).toBe(0);
      expect(harness.find).not.toHaveBeenCalled();
      expect(harness.show).not.toHaveBeenCalled();
    }
  });

  it("stops before projection when the caller aborts during the public lookup", async () => {
    const controller = new AbortController();
    let projectionReads = 0;
    const poisoned: unknown[] = [];
    Object.defineProperty(poisoned, "0", {
      enumerable: true,
      get() {
        projectionReads += 1;
        return { term: "setValues", matches: [], totalMatches: 0 };
      },
    });
    poisoned.length = 1;
    const harness = directApiTools({
      find: vi.fn(() => {
        controller.abort(new Error(datasetSentinel));
        return poisoned as ReturnType<ApiReference["find"]>;
      }),
    });

    await expect(directExecute(
      harness.definitions,
      "workspace_api_find",
      { terms: ["setValues"] },
      controller.signal,
    )).rejects.toMatchObject({ code: "workspace-operation-cancelled" });
    expect(projectionReads).toBe(0);
    expect(harness.find).toHaveBeenCalledOnce();
  });
});

describe("Workspace resource query tools", () => {
  it("returns closed installed registry and resource metadata without network, cache, or credentials", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const ctx = await setupDiscovery();
    expect(ctx.tools.schemas().filter(({ name }) =>
      name === "workspace_resource_registries" || name === "workspace_resource_find"))
      .toMatchObject([
        { name: "workspace_resource_registries", parameters: { additionalProperties: false } },
        { name: "workspace_resource_find", parameters: { additionalProperties: false } },
      ]);
    const registries = await execute(ctx, "workspace_resource_registries", {});
    expect(registries).toMatchObject({
      isError: false,
      value: {
        registries: expect.arrayContaining([expect.objectContaining({
          id: expect.any(String),
          resourceCount: expect.any(Number),
          colorEditableCount: expect.any(Number),
        })]),
      },
    });
    const found = await execute(ctx, "workspace_resource_find", { queries: ["arrow"], limit: 2 });
    expect(found).toMatchObject({
      isError: false,
      value: {
        resources: expect.arrayContaining([expect.objectContaining({
          handle: expect.any(String),
          registryId: expect.any(String),
          intrinsicSize: { width: expect.any(Number), height: expect.any(Number) },
        })]),
        total: expect.any(Number),
      },
    });
    const serialized = JSON.stringify({ registries, found });
    expect(serialized).not.toMatch(/sourceUrl|manifest|cacheLocation|<svg/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("applies resource defaults, maxima, and registry filters to the public query", async () => {
    const find = vi.fn(() => ({ resources: [], total: 0 }));
    const harness = directResourceTools({ find });
    await directExecute(harness.definitions, "workspace_resource_find", {
      queries: ["arrow"],
      registries: [],
    });
    await directExecute(harness.definitions, "workspace_resource_find", {
      queries: ["arrow"],
      registries: ["example-tabler-outline"],
      limit: 100,
    });
    expect(find).toHaveBeenNthCalledWith(1, { queries: ["arrow"], registries: [], limit: 30 });
    expect(find).toHaveBeenNthCalledWith(2, {
      queries: ["arrow"],
      registries: ["example-tabler-outline"],
      limit: 100,
    });
  });

  it.each([-2, -0.5, 0.25, 4])("preserves finite public resource order %s", async (order) => {
    const ctx = await setupDiscovery({
      queryResources: {
        find: () => ({ resources: [{ ...resourceSummary(), order }], total: 1 }),
      } as unknown as ResourceLibrary,
    });
    const result = await execute(ctx, "workspace_resource_find", { queries: ["arrow"] });
    expect(result).toMatchObject({ isError: false, value: { resources: [{ order }] } });
  });

  it.each([
    ["workspace_resource_registries", { extra: true }],
    ["workspace_resource_find", { queries: [] }],
    ["workspace_resource_find", { queries: new Array(1) }],
    ["workspace_resource_find", { queries: [1] }],
    ["workspace_resource_find", { queries: ["same", "same"] }],
    ["workspace_resource_find", { queries: ["x".repeat(161)] }],
    ["workspace_resource_find", { queries: ["x"], registries: Array.from({ length: 9 }, (_, i) => `r${i}`) }],
    ["workspace_resource_find", { queries: ["x"], registries: ["same", "same"] }],
    ["workspace_resource_find", { queries: ["x"], limit: 0 }],
    ["workspace_resource_find", { queries: ["x"], limit: 101 }],
  ])("rejects closed bounded %s arguments before resource lookup", async (name, arguments_) => {
    const harness = directResourceTools();
    await expect(directExecute(harness.definitions, name, arguments_))
      .rejects.toMatchObject({ code: "workspace-discovery-argument-invalid" });
    expect(harness.listRegistries).not.toHaveBeenCalled();
    expect(harness.find).not.toHaveBeenCalled();
  });

  it("preserves the public unknown-registry code without its dependency message", async () => {
    const ctx = await setupDiscovery();
    const result = await execute(ctx, "workspace_resource_find", {
      queries: ["arrow"],
      registries: ["missing-registry"],
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "resource-registry-not-found" } },
    });
    expect(JSON.stringify(result)).not.toContain("missing-registry");
  });

  it.each([
    ["workspace_resource_registries", {}, {
      listRegistries: () => [{
        id: "icons", resourceCount: 1, groupCount: 0, tagCount: 0,
        colorEditableCount: 0, sourceUrl: datasetSentinel,
      }],
    }],
    ["workspace_resource_find", { queries: ["arrow"] }, {
      find: () => ({ resources: [{ ...resourceSummary(), sourceUrl: datasetSentinel }], total: 1 }),
    }],
  ] as const)("rejects broadened %s output before ToolRuntime rendering", async (name, arguments_, overrides) => {
    const ctx = await setupDiscovery({ queryResources: overrides as unknown as ResourceLibrary });
    const result = await execute(ctx, name, arguments_);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-discovery-result-invalid" } },
    });
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
  });

  it.each([
    { handle: "other/arrow" },
    { registryId: "" },
    { id: ".." },
    { name: " " },
    { intrinsicSize: { width: 0, height: 24 } },
    { intrinsicSize: { width: 24, height: -1 } },
  ])("rejects malformed stable resource identity %#", async (override) => {
    const ctx = await setupDiscovery({
      queryResources: {
        find: () => ({ resources: [{ ...resourceSummary(), ...override }], total: 1 }),
      } as unknown as ResourceLibrary,
    });
    const result = await execute(ctx, "workspace_resource_find", { queries: ["arrow"] });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-discovery-result-invalid" } },
    });
  });

  it("rejects dependency accessors without executing them and accepts plain null-prototype JSON", async () => {
    let getterCalls = 0;
    const poisoned = resourceSummary() as Record<string, unknown>;
    Object.defineProperty(poisoned, "name", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "Arrow";
      },
    });
    const invalid = await execute(await setupDiscovery({
      queryResources: {
        find: () => ({ resources: [poisoned], total: 1 }) as never,
      } as unknown as ResourceLibrary,
    }), "workspace_resource_find", { queries: ["arrow"] });
    expect(invalid).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-discovery-result-invalid" } },
    });
    expect(getterCalls).toBe(0);

    const plain = Object.assign(Object.create(null) as Record<string, unknown>, resourceSummary());
    const accepted = await execute(await setupDiscovery({
      queryResources: {
        find: () => ({ resources: [plain], total: 1 }) as never,
      } as unknown as ResourceLibrary,
    }), "workspace_resource_find", { queries: ["arrow"] });
    expect(accepted).toMatchObject({ isError: false, value: { resources: [{ handle: "icons/arrow" }] } });
  });

  it.each([
    ["resource-registry-not-found", "resource-registry-not-found"],
    [`password=${datasetSentinel}`, "workspace-discovery-operation-failed"],
  ])("preserves only frozen public ResourceLibraryError code %s", async (code, expected) => {
    const ctx = await setupDiscovery({
      queryResources: {
        find: () => {
          throw new ResourceLibraryError(code as never, `secret ${datasetSentinel}`, undefined, {
            cause: new Error(`/private/${datasetSentinel}`),
          });
        },
      } as unknown as ResourceLibrary,
    });
    const result = await execute(ctx, "workspace_resource_find", { queries: ["arrow"] });
    expect(result).toMatchObject({ isError: true, error: { info: { code: expected } } });
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    expect(JSON.stringify(result)).not.toContain("/private/");
  });

  it("rejects complete resource query output over 256 KiB", async () => {
    const huge = "x".repeat(262_144);
    const ctx = await setupDiscovery({
      queryResources: {
        find: () => ({ resources: [{ ...resourceSummary(), keywords: [huge] }], total: 1 }),
      } as unknown as ResourceLibrary,
    });
    const result = await execute(ctx, "workspace_resource_find", { queries: ["arrow"] });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-discovery-result-too-large" } },
    });
    expect(JSON.stringify(result)).not.toContain(huge.slice(0, 1024));
  });

  it("stops resource projection when lookup aborts the caller", async () => {
    const controller = new AbortController();
    let projectionReads = 0;
    const resources: unknown[] = [];
    Object.defineProperty(resources, "0", {
      enumerable: true,
      get() {
        projectionReads += 1;
        return resourceSummary();
      },
    });
    resources.length = 1;
    const harness = directResourceTools({
      find: () => {
        controller.abort(new Error(datasetSentinel));
        return { resources, total: 1 } as ReturnType<ResourceLibrary["find"]>;
      },
    });
    await expect(directExecute(
      harness.definitions,
      "workspace_resource_find",
      { queries: ["arrow"] },
      controller.signal,
    )).rejects.toMatchObject({ code: "workspace-operation-cancelled" });
    expect(projectionReads).toBe(0);
  });
});

describe("Workspace resource export effect gate", () => {
  it("charges a consumed chunk before observing downloader-signal cancellation", async () => {
    const release = deferred<void>();
    const timeout = new AbortController();
    const bytes = new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
    let request = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      request += 1;
      if (request === 1) {
        return new Response(new ReadableStream<Uint8Array>({
          async pull(controller) {
            await release.promise;
            controller.enqueue(bytes);
            timeout.abort(new Error(datasetSentinel));
            controller.close();
          },
        }));
      }
      return new Response(new Uint8Array(), {
        headers: { "content-length": String(32 * 1024 * 1024) },
      });
    }));
    const budget = { remaining: 32 * 1024 * 1024, terminal: false };
    const fetcher = createCumulativeResourceFetch(new AbortController().signal, budget);
    const response = await fetcher("https://resources.test/first.svg", { signal: timeout.signal });
    const consumed = response.arrayBuffer();
    release.resolve();
    await expect(consumed).rejects.toThrow(datasetSentinel);
    expect(budget.remaining).toBe(32 * 1024 * 1024 - bytes.byteLength);
    await expect(fetcher("https://resources.test/second.svg", {
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "resource-download-too-large" });
    expect(budget.terminal).toBe(true);
  });

  it("cancels declared per-resource overflow without charging or terminating the call budget", async () => {
    let cancelled = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel() { cancelled += 1; } }),
      { headers: { "content-length": String(10 * 1024 * 1024 + 1) } },
    )));
    const budget = { remaining: 32 * 1024 * 1024, terminal: false };
    const fetcher = createCumulativeResourceFetch(new AbortController().signal, budget);
    await expect(fetcher("https://resources.test/large.svg"))
      .rejects.toMatchObject({ code: "resource-download-too-large" });
    expect(cancelled).toBe(1);
    expect(budget).toEqual({ remaining: 32 * 1024 * 1024, terminal: false });
  });

  it("lets a complete stream consume exactly 32 MiB, then blocks later network", async () => {
    const chunks = [10, 10, 10, 2].map((mebibytes) => new Uint8Array(mebibytes * 1024 * 1024));
    let pulls = 0;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulls];
        pulls += 1;
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    })));
    vi.stubGlobal("fetch", fetcher);
    const budget = { remaining: 32 * 1024 * 1024, terminal: false };
    const bounded = createCumulativeResourceFetch(new AbortController().signal, budget);
    const response = await bounded("https://resources.test/exact.svg");
    expect((await response.arrayBuffer()).byteLength).toBe(32 * 1024 * 1024);
    expect(budget).toEqual({ remaining: 0, terminal: true });
    await expect(bounded("https://resources.test/later.svg"))
      .rejects.toMatchObject({ code: "resource-download-too-large" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("marks a chunk beyond the 32 MiB remainder terminal and blocks later network", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      new Uint8Array(32 * 1024 * 1024 + 1),
    ));
    vi.stubGlobal("fetch", fetcher);
    const budget = { remaining: 32 * 1024 * 1024, terminal: false };
    const bounded = createCumulativeResourceFetch(new AbortController().signal, budget);
    const response = await bounded("https://resources.test/overflow.svg");
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: "resource-download-too-large" });
    expect(budget).toEqual({ remaining: 0, terminal: true });
    await expect(bounded("https://resources.test/later.svg"))
      .rejects.toMatchObject({ code: "resource-download-too-large" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { handles: [], output_directory: "out" },
    { handles: Array.from({ length: 33 }, (_, index) => `icons/item-${index}`), output_directory: "out" },
    { handles: ["icons/arrow", "icons/arrow"], output_directory: "out" },
    { handles: ["missing-slash"], output_directory: "out" },
    { handles: ["-invalid/arrow"], output_directory: "out" },
    { handles: ["icons/.."], output_directory: "out" },
    { handles: ["icons/arrow"], output_directory: " " },
    { handles: ["icons/arrow"], output_directory: "out", cookie: datasetSentinel },
  ])("rejects closed bounded export arguments before file or resource capability %#", async (arguments_) => {
    const harness = directResourceTools();
    await expect(directExecute(harness.definitions, "workspace_resource_export", arguments_))
      .rejects.toMatchObject({ code: "workspace-discovery-argument-invalid" });
    expect(harness.exportResources).not.toHaveBeenCalled();
  });

  it("denies read-only before provider, arguments, approval, process path, or export", async () => {
    const cwd = await temporaryDirectory();
    const { approvals, ctx, processPath } = await setupExport({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode: "read-only", workspaceRoot: cwd }),
      approval: "allowed-once",
    });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: null,
      output_directory: null,
      password: datasetSentinel,
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-policy-denied" } },
    });
    expect(approvals).toEqual([]);
    expect(processPath).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
  });

  it("rejects a non-local provider before model path interpretation or approval", async () => {
    const cwd = await temporaryDirectory();
    const resolve = vi.fn();
    const contains = vi.fn();
    const processPath = vi.fn();
    const { approvals, ctx } = await setupExport({
      cwd,
      filesystem: { sandboxMode: undefined, resolve, contains, processPath } as unknown as FileSystem,
      approval: "allowed-once",
    });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["icons/arrow"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-local-filesystem-required" } },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(approvals).toEqual([]);
  });

  it("asks once without processPath, manifest lookup, or network, then rechecks in the accepted body", async () => {
    const cwd = await temporaryDirectory();
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const { approvals, ctx, processPath } = await setupExport({
      cwd,
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const pending = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    await asked.promise;
    expect(approvals).toEqual(["workspace_resource_export"]);
    const preflightPathCalls = processPath.mock.calls.length;
    expect(fetcher).not.toHaveBeenCalled();
    decision.resolve("allowed-once");
    const result = await pending;
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: false,
        exported: [],
        failed: [{ handle: "example-openmoji-black/1f10e", code: "resource-download-failed" }],
      },
    });
    expect(processPath.mock.calls.length).toBeGreaterThan(preflightPathCalls);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("asks for a syntactically valid missing handle without resolving manifest identity", async () => {
    const cwd = await temporaryDirectory();
    const { approvals, ctx } = await setupExport({ cwd, approval: "rejected" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["missing-registry/missing-resource"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({ isError: true });
    expect(approvals).toEqual(["workspace_resource_export"]);
  });

  it.each(["rejected", "cancelled", "unavailable", undefined] as const)(
    "keeps export body effects at zero when approval is %s",
    async (outcome) => {
      const cwd = await temporaryDirectory();
      const fetcher = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetcher);
      let processPath: ReturnType<typeof vi.fn> | undefined;
      let callsAtDecision: number | undefined;
      const harness = await setupExport({
        cwd,
        ...(outcome === undefined
          ? {}
          : {
              approval: async () => {
                callsAtDecision = processPath!.mock.calls.length;
                return outcome;
              },
            }),
      });
      processPath = harness.processPath;
      const result = await execute(harness.ctx, "workspace_resource_export", {
        handles: ["example-openmoji-black/1f10e"],
        output_directory: "out",
      }, fakeDiscoveryAgent(cwd));
      expect(result).toMatchObject({ isError: true });
      expect(harness.exportResources).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readdir(cwd)).toEqual([]);
      expect(harness.approvals).toEqual(outcome === undefined ? [] : ["workspace_resource_export"]);
      if (callsAtDecision !== undefined) expect(processPath.mock.calls.length).toBe(callsAtDecision);
    },
  );

  it("keeps bare, workspace-write, and danger policies inside the Session and current policy root", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const allowed = join(cwd, "allowed");
    await mkdir(allowed);
    for (const setup of [
      { filesystem: "local" as const },
      {
        filesystem: "confining" as const,
        policy: () => ({ mode: "workspace-write" as const, workspaceRoot: allowed }),
      },
      {
        filesystem: "confining" as const,
        policy: () => ({ mode: "danger-full-access" as const, workspaceRoot: outside }),
      },
    ]) {
      const harness = await setupExport({
        cwd,
        ...setup,
        approval: "rejected",
      });
      const outsideResult = await execute(harness.ctx, "workspace_resource_export", {
        handles: ["boards-local-svgl/basic-arrow"],
        output_directory: outside,
      }, fakeDiscoveryAgent(cwd));
      expect(outsideResult).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-file-path-outside-session" } },
      });
      const eligibleDirectory = setup.filesystem === "confining" && setup.policy?.().mode === "workspace-write"
        ? "allowed"
        : "out";
      const eligible = await execute(harness.ctx, "workspace_resource_export", {
        handles: ["boards-local-svgl/basic-arrow"],
        output_directory: eligibleDirectory,
      }, fakeDiscoveryAgent(cwd));
      expect(eligible).toMatchObject({ isError: true });
      expect(harness.approvals).toEqual(["workspace_resource_export"]);
    }
  });

  it("fails body recheck after policy narrows without a second ask or processPath", async () => {
    const cwd = await temporaryDirectory();
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    let mode: "workspace-write" | "read-only" = "workspace-write";
    const { approvals, ctx, processPath } = await setupExport({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode, workspaceRoot: cwd }),
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const pending = execute(ctx, "workspace_resource_export", {
      handles: ["boards-local-svgl/basic-arrow"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    await asked.promise;
    processPath.mockClear();
    mode = "read-only";
    decision.resolve("allowed-once");
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-policy-denied" } },
    });
    expect(approvals).toEqual(["workspace_resource_export"]);
    expect(processPath).not.toHaveBeenCalled();
  });

  it("fails body recheck when public local constructor proof is lost", async () => {
    const cwd = await temporaryDirectory();
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setupExport({
      cwd,
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const filesystem = harness.ctx.get("fs")!;
    const prototype = Object.getPrototypeOf(filesystem) as object;
    const pending = execute(harness.ctx, "workspace_resource_export", {
      handles: ["boards-local-svgl/basic-arrow"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    await asked.promise;
    harness.processPath.mockClear();
    Object.setPrototypeOf(filesystem, Object.prototype);
    decision.resolve("allowed-once");
    const result = await pending.finally(() => Object.setPrototypeOf(filesystem, prototype));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-local-filesystem-required" } },
    });
    expect(harness.approvals).toEqual(["workspace_resource_export"]);
    expect(harness.processPath).not.toHaveBeenCalled();
  });

  it("re-resolves the directory and rejects symlink drift outside the Session", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setupExport({
      cwd,
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const pending = execute(harness.ctx, "workspace_resource_export", {
      handles: ["boards-local-svgl/basic-arrow"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    await asked.promise;
    await symlink(outside, join(cwd, "out"));
    decision.resolve("allowed-once");
    const result = await pending;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(harness.approvals).toEqual(["workspace_resource_export"]);
  });

  it("maps caller cancellation during the accepted-body path recheck after it settles", async () => {
    const cwd = await temporaryDirectory();
    const harness = await setupExport({ cwd, filesystem: "barrier", approval: "allowed-once" });
    const filesystem = harness.ctx.get("fs") as BarrierLocalFileSystem;
    const controller = new AbortController();
    const pending = execute(harness.ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd), controller.signal);
    await filesystem.entered.promise;
    controller.abort(new Error(datasetSentinel));
    filesystem.release.resolve();
    const result = await pending;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-cancelled" } },
    });
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
  });

  it("uses the call-owned public library to atomically replace one 0600 SVG without cache state", async () => {
    const cwd = await temporaryDirectory();
    const outputDirectory = join(cwd, "out");
    await mkdir(outputDirectory);
    const outputPath = join(outputDirectory, "example-openmoji-black--1f10e.svg");
    await writeFile(outputPath, "prior", "utf8");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
    const fetcher = vi.fn<typeof fetch>(async () => new Response(svg, {
      headers: { "content-length": String(Buffer.byteLength(svg)) },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetcher);
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: true,
        exported: [{ handle: "example-openmoji-black/1f10e", path: outputPath }],
        failed: [],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(outputPath, "utf8")).toBe(svg);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(outputDirectory)).toEqual(["example-openmoji-black--1f10e.svg"]);
  });

  it("cancels a declared per-resource overflow and continues with unchanged cumulative capacity", async () => {
    const cwd = await temporaryDirectory();
    let cancelled = 0;
    let requests = 0;
    const svg = "<svg></svg>";
    const fetcher = vi.fn<typeof fetch>(async () => {
      requests += 1;
      return requests === 1
        ? new Response(new ReadableStream<Uint8Array>({
            cancel() { cancelled += 1; },
          }), { headers: { "content-length": String(10 * 1024 * 1024 + 1) } })
        : new Response(svg, { headers: { "content-length": String(Buffer.byteLength(svg)) } });
    });
    vi.stubGlobal("fetch", fetcher);
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e", "example-openmoji-color/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: false,
        exported: [{ handle: "example-openmoji-color/1f10e" }],
        failed: [{
          handle: "example-openmoji-black/1f10e",
          code: "resource-download-too-large",
        }],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(1);
    expect(await readdir(join(cwd, "out"))).toEqual(["example-openmoji-color--1f10e.svg"]);
  });

  it("rejects a contained directory identity change after download before mkdir or temp output", async () => {
    const cwd = await temporaryDirectory();
    const first = join(cwd, "first");
    const second = join(cwd, "second");
    await mkdir(first);
    await mkdir(second);
    await symlink(first, join(cwd, "out"));
    const entered = deferred<void>();
    const release = deferred<void>();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      entered.resolve();
      await release.promise;
      return new Response("<svg></svg>");
    }));
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const pending = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    await entered.promise;
    await unlink(join(cwd, "out"));
    await symlink(second, join(cwd, "out"));
    release.resolve();
    const result = await pending;
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: false,
        exported: [],
        failed: [{ code: "resource-export-failed" }],
      },
    });
    expect(await readdir(first)).toEqual([]);
    expect(await readdir(second)).toEqual([]);
  });

  it.each(["/escape.svg", "../escape.svg", "nested/escape.svg", "nested\\escape.svg", ".", ".."])(
    "rejects public output filename %s before creating the approved directory",
    async (filename) => {
      const cwd = await temporaryDirectory();
      const { ctx } = await setupExport({
        cwd,
        approval: "allowed-once",
        createExportLibrary: outputFilenameLibrary(filename),
      });
      const result = await execute(ctx, "workspace_resource_export", {
        handles: ["example-openmoji-black/1f10e"],
        output_directory: "out",
      }, fakeDiscoveryAgent(cwd));
      expect(result).toMatchObject({
        isError: false,
        value: {
          complete: false,
          exported: [],
          failed: [{ code: "resource-export-failed" }],
        },
      });
      expect(await readdir(cwd)).toEqual([]);
    },
  );

  it.each(["forged", "mismatch", "failure"] as const)(
    "rejects an unconfirmed or contradictory public export result (%s) without exposing its path",
    async (behavior) => {
      const cwd = await temporaryDirectory();
      const { ctx } = await setupExport({
        cwd,
        approval: "allowed-once",
        createExportLibrary: contradictoryExportLibrary(behavior),
      });
      const result = await execute(ctx, "workspace_resource_export", {
        handles: ["example-openmoji-black/1f10e"],
        output_directory: "out",
      }, fakeDiscoveryAgent(cwd));
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-discovery-result-invalid" } },
      });
      expect(JSON.stringify(result)).not.toContain(datasetSentinel);
      expect(JSON.stringify(result)).not.toContain("/private/");
    },
  );

  it("preserves an existing target object and removes its private temp when atomic replacement fails", async () => {
    const cwd = await temporaryDirectory();
    const target = join(cwd, "out", "safe.svg");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "marker"), "prior", "utf8");
    const { ctx } = await setupExport({
      cwd,
      approval: "allowed-once",
      createExportLibrary: outputFilenameLibrary("safe.svg"),
    });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: { complete: false, failed: [{ code: "resource-export-failed" }] },
    });
    expect(await readFile(join(target, "marker"), "utf8")).toBe("prior");
    expect(await readdir(join(cwd, "out"))).toEqual(["safe.svg"]);
    expect(await readdir(target)).toEqual(["marker"]);
  });

  it.each(["write", "sync"] as const)(
    "closes and removes the private temp while preserving the prior file on %s failure",
    async (failure) => {
      const cwd = await temporaryDirectory();
      const outputDirectory = join(cwd, "out");
      const outputPath = join(outputDirectory, "example-openmoji-black--1f10e.svg");
      await mkdir(outputDirectory);
      await writeFile(outputPath, "prior", "utf8");
      const closed = vi.fn();
      const openResourceTemp = (async (path: string, flags: string, mode: number) => {
        const handle = await open(path, flags as "wx", mode);
        return {
          writeFile: failure === "write"
            ? async () => { throw new Error(datasetSentinel); }
            : handle.writeFile.bind(handle),
          sync: failure === "sync"
            ? async () => { throw new Error(datasetSentinel); }
            : handle.sync.bind(handle),
          async close() {
            closed();
            await handle.close();
          },
        } as unknown as Awaited<ReturnType<typeof open>>;
      }) as typeof open;
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("<svg></svg>")));
      const { ctx } = await setupExport({
        cwd,
        approval: "allowed-once",
        openResourceTemp,
      });
      const result = await execute(ctx, "workspace_resource_export", {
        handles: ["example-openmoji-black/1f10e"],
        output_directory: "out",
      }, fakeDiscoveryAgent(cwd));
      expect(result).toMatchObject({
        isError: false,
        value: { complete: false, failed: [{ code: "resource-export-failed" }] },
      });
      expect(closed).toHaveBeenCalledTimes(1);
      expect(await readFile(outputPath, "utf8")).toBe("prior");
      expect(await readdir(outputDirectory)).toEqual(["example-openmoji-black--1f10e.svg"]);
      expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    },
  );

  it("preserves a prior file without temp state when downloaded content fails public SVG validation", async () => {
    const cwd = await temporaryDirectory();
    const outputDirectory = join(cwd, "out");
    const outputPath = join(outputDirectory, "example-openmoji-black--1f10e.svg");
    await mkdir(outputDirectory);
    await writeFile(outputPath, "prior", "utf8");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("not-svg")));
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: { complete: false, failed: [{ code: "resource-download-invalid-svg" }] },
    });
    expect(await readFile(outputPath, "utf8")).toBe("prior");
    expect(await readdir(outputDirectory)).toEqual(["example-openmoji-black--1f10e.svg"]);
  });

  it("keeps consumed failed bytes charged so a later declared response terminates all remaining handles", async () => {
    const cwd = await temporaryDirectory();
    let requests = 0;
    const streamFailure = new Error(datasetSentinel);
    const fetcher = vi.fn<typeof fetch>(async () => {
      requests += 1;
      if (requests === 1) {
        let chunks = 0;
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            chunks += 1;
            if (chunks === 1) controller.enqueue(new Uint8Array([0x3c]));
            else controller.error(streamFailure);
          },
        }));
      }
      return new Response(new Uint8Array(), {
        headers: { "content-length": String(32 * 1024 * 1024) },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: [
        "example-openmoji-black/1f10e",
        "example-openmoji-color/1f10e",
        "example-tabler-outline/archery-arrow",
      ],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: false,
        exported: [],
        failed: [
          { code: "resource-download-failed" },
          { code: "resource-download-too-large" },
          { code: "resource-download-too-large" },
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    expect(await readdir(cwd)).toEqual([]);
  });

  it("continues after a streamed 10 MiB per-resource overflow with only the remaining call budget", async () => {
    const cwd = await temporaryDirectory();
    let requests = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      requests += 1;
      return requests === 1
        ? new Response(new Uint8Array(10 * 1024 * 1024 + 1))
        : new Response("<svg></svg>");
    });
    vi.stubGlobal("fetch", fetcher);
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e", "example-openmoji-color/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: false,
        exported: [{ handle: "example-openmoji-color/1f10e" }],
        failed: [{
          handle: "example-openmoji-black/1f10e",
          code: "resource-download-too-large",
        }],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("isolates concurrent call signals, destinations, and adapter state", async () => {
    const cwd = await temporaryDirectory();
    const firstEntered = deferred<void>();
    const firstRelease = deferred<void>();
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      requests += 1;
      if (requests === 1) {
        firstEntered.resolve();
        await firstRelease.promise;
      }
      return new Response("<svg></svg>");
    }));
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const cancelled = new AbortController();
    const first = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "first",
    }, fakeDiscoveryAgent(cwd), cancelled.signal);
    await firstEntered.promise;
    const second = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-color/1f10e"],
      output_directory: "second",
    }, fakeDiscoveryAgent(cwd));
    await vi.waitFor(() => expect(requests).toBe(2));
    cancelled.abort(new Error(datasetSentinel));
    firstRelease.resolve();
    expect(await first).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-cancelled" } },
    });
    expect(await second).toMatchObject({
      isError: false,
      value: { complete: true, exported: [{ handle: "example-openmoji-color/1f10e" }] },
    });
    expect(await readdir(cwd)).toEqual(["second"]);
    expect(await readdir(join(cwd, "second"))).toEqual(["example-openmoji-color--1f10e.svg"]);
  });

  it("publishes the handle that exactly consumes 32 MiB and starts no later request", async () => {
    const cwd = await temporaryDirectory();
    const sizes = [10, 10, 10, 2].map((mebibytes) => mebibytes * 1024 * 1024);
    let requests = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      const size = sizes[requests];
      requests += 1;
      if (size === undefined) throw new Error("later network must not start");
      return sizedSvgResponse(size);
    });
    vi.stubGlobal("fetch", fetcher);
    const handles = [
      "example-openmoji-black/1f10e",
      "example-openmoji-color/1f10e",
      "example-openmoji-black/1f498",
      "example-openmoji-color/1f498",
      "example-tabler-outline/archery-arrow",
    ];
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles,
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: false,
        exported: handles.slice(0, 4).map((handle) => ({ handle })),
        failed: [{ handle: handles[4], code: "resource-download-too-large" }],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect((await readdir(join(cwd, "out"))).length).toBe(4);
  });

  it("keeps bytes charged after publication failure and cleans temp before terminal later handles", async () => {
    const cwd = await temporaryDirectory();
    const outputDirectory = join(cwd, "out");
    const failedTarget = join(outputDirectory, "example-openmoji-black--1f10e.svg");
    await mkdir(failedTarget, { recursive: true });
    let requests = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      requests += 1;
      return requests === 1
        ? new Response("<svg></svg>")
        : new Response(new Uint8Array(), {
            headers: { "content-length": String(32 * 1024 * 1024) },
          });
    });
    vi.stubGlobal("fetch", fetcher);
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: [
        "example-openmoji-black/1f10e",
        "example-openmoji-color/1f10e",
        "example-tabler-outline/archery-arrow",
      ],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: {
        complete: false,
        failed: [
          { code: "resource-export-failed" },
          { code: "resource-download-too-large" },
          { code: "resource-download-too-large" },
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readdir(outputDirectory)).toEqual(["example-openmoji-black--1f10e.svg"]);
    expect(await readdir(failedTarget)).toEqual([]);
  });

  it("stops after caller cancellation following one confirmed file and adds no-retry guidance", async () => {
    const cwd = await temporaryDirectory();
    const secondEntered = deferred<void>();
    const secondRelease = deferred<void>();
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      requests += 1;
      if (requests === 2) {
        secondEntered.resolve();
        await secondRelease.promise;
      }
      return new Response("<svg></svg>");
    }));
    const { ctx } = await setupExport({ cwd, approval: "allowed-once" });
    const controller = new AbortController();
    const pending = execute(ctx, "workspace_resource_export", {
      handles: [
        "example-openmoji-black/1f10e",
        "example-openmoji-color/1f10e",
        "example-tabler-outline/archery-arrow",
      ],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd), controller.signal);
    await secondEntered.promise;
    expect(await readdir(join(cwd, "out"))).toEqual(["example-openmoji-black--1f10e.svg"]);
    controller.abort(new Error(datasetSentinel));
    secondRelease.resolve();
    const result = await pending;
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result.content)).toContain("Inspect the approved output directory");
    expect(JSON.stringify(result.content)).toContain("Never retry the export automatically");
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    expect(requests).toBe(2);
    expect(await readdir(join(cwd, "out"))).toEqual(["example-openmoji-black--1f10e.svg"]);
  });

  it("short-circuits an already-aborted export before approval, path, network, or output", async () => {
    const cwd = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const { approvals, ctx, processPath } = await setupExport({ cwd, approval: "allowed-once" });
    const controller = new AbortController();
    controller.abort(new Error(datasetSentinel));
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd), controller.signal);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "ABORTED_BEFORE_DISPATCH" } },
    });
    expect(approvals).toEqual([]);
    expect(processPath).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(cwd)).toEqual([]);
  });

  it("unregisters, aborts, and drains an accepted export through an in-flight fsync cleanup", async () => {
    const cwd = await temporaryDirectory();
    const syncEntered = deferred<void>();
    const syncRelease = deferred<void>();
    const closed = vi.fn();
    const openResourceTemp = (async (path: string, flags: string, mode: number) => {
      const handle = await open(path, flags as "wx", mode);
      return {
        writeFile: handle.writeFile.bind(handle),
        async sync() {
          syncEntered.resolve();
          await syncRelease.promise;
          await handle.sync();
        },
        async close() {
          closed();
          await handle.close();
        },
      } as unknown as Awaited<ReturnType<typeof open>>;
    }) as typeof open;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("<svg></svg>")));
    const { approvals, ctx, fiber } = await setupExport({
      cwd,
      approval: "allowed-once",
      openResourceTemp,
    });
    const pending = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    await syncEntered.promise;
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    syncRelease.resolve();
    await disposal;
    expect(await pending).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(await readdir(join(cwd, "out"))).toEqual([]);
    const approvalsBeforeProbe = approvals.length;
    const fakeBody = vi.fn(async () => ({ ok: true }));
    const unregisterProbe = ctx.tools.register({
      name: "workspace_resource_export",
      description: "Disposed discovery listener probe.",
      parameters: {
        type: "object",
        properties: {
          handles: { type: "array", items: { type: "string" } },
          output_directory: { type: "string" },
        },
        required: ["handles", "output_directory"],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
        render: () => [{ type: "text", text: "probe ok" }],
      },
      execute: fakeBody,
    });
    const afterDispose = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(afterDispose).toMatchObject({ isError: false, value: { ok: true } });
    expect(fakeBody).toHaveBeenCalledTimes(1);
    expect(approvals).toHaveLength(approvalsBeforeProbe);
    unregisterProbe();
  });

  it("returns the confirmed canonical export through real Code Mode with paired transcript events", async () => {
    const cwd = await temporaryDirectory();
    const svg = "<svg></svg>";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(svg)));
    const { approvals, ctx } = await setupExport({
      cwd,
      approval: "allowed-once",
      codeMode: true,
    });
    const codeRuntime = ctx.codeRuntime as ControlledCodeRuntime;
    codeRuntime.dispatches = [{
      name: "workspace_resource_export",
      arguments: {
        handles: ["example-openmoji-black/1f10e"],
        output_directory: "out",
      },
    }];
    const id = SessionId("discovery-export-code-mode");
    const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd });
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    const result = await ctx.tools.execute({
      agent: { session } as never,
      arguments: {
        code: `return ${JSON.stringify(datasetSentinel)};`,
        description: "Export one approved visual resource",
      },
      callId: CallId("discovery-export-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      isError: false,
      value: {
        result: [{
          complete: true,
          exported: [{ handle: "example-openmoji-black/1f10e" }],
          failed: [],
        }],
      },
    });
    expect(approvals).toEqual(["workspace_resource_export"]);
    const starts = session.events.filter((event) => event.type === "tool/code-dispatch-start");
    const settled = session.events.filter((event) => event.type === "tool/code-dispatch");
    expect(starts).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect({ name: settled[0]!.data.name, subCallId: settled[0]!.data.subCallId })
      .toEqual({ name: starts[0]!.data.name, subCallId: starts[0]!.data.subCallId });
    const pluginOwned = session.events.filter((event) =>
      event.type !== "tool/call" && event.type !== "tool/code-dispatch-start");
    expect(JSON.stringify(pluginOwned)).not.toContain(datasetSentinel);
    expect(JSON.stringify(pluginOwned)).not.toContain(svg);
  });

  it("preserves a rename-confirmed file, stops later handles, and guides a late-cancelled caller", async () => {
    const cwd = await temporaryDirectory();
    const renameEntered = deferred<void>();
    const renameRelease = deferred<void>();
    const renameResourceTemp = (async (source: string, destination: string) => {
      renameEntered.resolve();
      await renameRelease.promise;
      await rename(source, destination);
    }) as typeof rename;
    const fetcher = vi.fn<typeof fetch>(async () => new Response("<svg></svg>"));
    vi.stubGlobal("fetch", fetcher);
    const { ctx } = await setupExport({
      cwd,
      approval: "allowed-once",
      renameResourceTemp,
    });
    const controller = new AbortController();
    const pending = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e", "example-openmoji-color/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd), controller.signal);
    await renameEntered.promise;
    controller.abort(new Error(datasetSentinel));
    renameRelease.resolve();
    const result = await pending;
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result.content)).toContain("Inspect the approved output directory");
    expect(JSON.stringify(result.content)).toContain("Never retry the export automatically");
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readdir(join(cwd, "out"))).toEqual(["example-openmoji-black--1f10e.svg"]);
  });

  it("waits for a download that ignores owner abort, then leaves no output or registered discovery effect", async () => {
    const cwd = await temporaryDirectory();
    const downloadEntered = deferred<void>();
    const downloadRelease = deferred<void>();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      downloadEntered.resolve();
      await downloadRelease.promise;
      return new Response("<svg></svg>");
    }));
    const { approvals, ctx, fiber } = await setupExport({ cwd, approval: "allowed-once" });
    const pending = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    await downloadEntered.promise;
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    downloadRelease.resolve();
    await disposal;
    expect(await pending).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    expect(await readdir(cwd)).toEqual([]);
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_api_")
      || name.startsWith("workspace_resource_"))).toEqual([]);
    expect(approvals).toEqual(["workspace_resource_export"]);
  });

  it("disposes and drains two isolated accepted exports without cross-call output", async () => {
    const cwd = await temporaryDirectory();
    const downloadsEntered = deferred<void>();
    const firstRelease = deferred<void>();
    const secondRelease = deferred<void>();
    let entered = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      entered += 1;
      if (entered === 2) downloadsEntered.resolve();
      const url = String(input);
      if (url.includes("/black/")) await firstRelease.promise;
      else if (url.includes("/color/")) await secondRelease.promise;
      else throw new Error("unexpected resource URL");
      return new Response("<svg></svg>");
    });
    vi.stubGlobal("fetch", fetcher);
    const { approvals, ctx, fiber } = await setupExport({ cwd, approval: "allowed-once" });
    const first = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out-a",
    }, fakeDiscoveryAgent(cwd));
    let secondSettled = false;
    const second = execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-color/1f10e"],
      output_directory: "out-b",
    }, fakeDiscoveryAgent(cwd)).then((result) => {
      secondSettled = true;
      return result;
    });
    await downloadsEntered.promise;
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    firstRelease.resolve();
    await expect(first).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    expect(disposed).toBe(false);
    expect(secondSettled).toBe(false);
    secondRelease.resolve();
    await disposal;
    await expect(second).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(approvals).toEqual(["workspace_resource_export", "workspace_resource_export"]);
    expect(await readdir(cwd)).toEqual([]);
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_api_")
      || name.startsWith("workspace_resource_"))).toEqual([]);
  });

  it("keeps a secret-bearing export failure out of real Code Mode settlement and approval", async () => {
    const cwd = await temporaryDirectory();
    const secretFailure = new Error(
      `https://signed.test/${datasetSentinel} set-cookie=session=${datasetSentinel} body=<svg>${datasetSentinel}</svg>`,
      { cause: new Error(`/private/temp-${datasetSentinel}`) },
    );
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => { throw secretFailure; }));
    const { approvalReasons, approvals, ctx } = await setupExport({
      cwd,
      approval: "allowed-once",
      codeMode: true,
    });
    const codeRuntime = ctx.codeRuntime as ControlledCodeRuntime;
    codeRuntime.dispatches = [{
      name: "workspace_resource_export",
      arguments: {
        handles: ["example-openmoji-black/1f10e"],
        output_directory: "out",
      },
    }];
    const id = SessionId("discovery-export-code-mode-failure");
    const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd });
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    const result = await ctx.tools.execute({
      agent: { session } as never,
      arguments: {
        code: "return await tools.workspace_resource_export({ handles: ['redacted'], output_directory: 'redacted' });",
        description: "Export one approved visual resource",
      },
      callId: CallId("discovery-export-code-mode-failure"),
      name: "run_code",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      isError: false,
      value: {
        result: [{
          complete: false,
          exported: [],
          failed: [{
            handle: "example-openmoji-black/1f10e",
            code: "resource-download-failed",
          }],
        }],
      },
    });
    expect(approvals).toEqual(["workspace_resource_export"]);
    expect(approvalReasons).toEqual([
      "Workspace resource export writes approved visual assets to a Host-local Session directory.",
    ]);
    const starts = session.events.filter((event) => event.type === "tool/code-dispatch-start");
    const settled = session.events.filter((event) => event.type === "tool/code-dispatch");
    expect(starts).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect({ name: settled[0]!.data.name, subCallId: settled[0]!.data.subCallId })
      .toEqual({ name: starts[0]!.data.name, subCallId: starts[0]!.data.subCallId });
    const pluginOwned = session.events.filter((event) =>
      event.type !== "tool/call" && event.type !== "tool/code-dispatch-start");
    const projected = JSON.stringify({ approvalReasons, pluginOwned, result });
    expect(projected).not.toContain(datasetSentinel);
    expect(projected).not.toContain("set-cookie");
    expect(projected).not.toContain("signed.test");
    expect(projected).not.toContain("/private/");
    expect(projected).not.toContain("<svg>");
  });

  it.each([
    ["resource-download-http", "resource-download-http"],
    [`password=${datasetSentinel}`, "workspace-discovery-operation-failed"],
  ])("preserves only frozen thrown resource export code %s without dependency material", async (code, expected) => {
    const cwd = await temporaryDirectory();
    const { ctx } = await setupExport({
      cwd,
      approval: "allowed-once",
      createExportLibrary: throwingExportLibrary(new ResourceLibraryError(
        code as never,
        `https://signed.test/${datasetSentinel}`,
        undefined,
        { cause: new Error(`/private/${datasetSentinel}`) },
      )),
    });
    const result = await execute(ctx, "workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e"],
      output_directory: "out",
    }, fakeDiscoveryAgent(cwd));
    expect(result).toMatchObject({ isError: true, error: { info: { code: expected } } });
    expect(JSON.stringify(result)).not.toContain(datasetSentinel);
    expect(JSON.stringify(result)).not.toContain("signed.test");
    expect(JSON.stringify(result)).not.toContain("/private/");
  });

  it.each(["fetch", "http", "open"] as const)(
    "projects %s failure through a fixed per-handle code without URL/header/body/path/cause",
    async (failure) => {
      const cwd = await temporaryDirectory();
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (failure === "fetch") throw new Error(`https://signed.test/${datasetSentinel}`);
        if (failure === "http") {
          return new Response(`body ${datasetSentinel}`, {
            headers: { "set-cookie": `session=${datasetSentinel}` },
            status: 401,
          });
        }
        return new Response("<svg></svg>");
      });
      vi.stubGlobal("fetch", fetcher);
      const openResourceTemp = failure === "open"
        ? (async () => { throw new Error(`/private/temp-${datasetSentinel}`); }) as typeof open
        : undefined;
      const { ctx } = await setupExport({
        cwd,
        approval: "allowed-once",
        ...(openResourceTemp === undefined ? {} : { openResourceTemp }),
      });
      const result = await execute(ctx, "workspace_resource_export", {
        handles: ["example-openmoji-black/1f10e"],
        output_directory: "out",
      }, fakeDiscoveryAgent(cwd));
      expect(result).toMatchObject({
        isError: false,
        value: {
          complete: false,
          failed: [{
            code: failure === "http" ? "resource-download-http" : failure === "fetch"
              ? "resource-download-failed"
              : "resource-export-failed",
          }],
        },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(datasetSentinel);
      expect(serialized).not.toContain("signed.test");
      expect(serialized).not.toContain("set-cookie");
      expect(serialized).not.toContain("/private/");
    },
  );
});

async function setupDiscovery(options: {
  readonly apiReference?: ApiReference;
  readonly codeMode?: boolean;
  readonly queryResources?: ResourceLibrary;
} = {}): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  if (options.codeMode === true) {
    await ctx.plugin(ControlledCodeRuntime);
    await ctx.plugin(ToolRuntime, { mode: "code" });
  } else {
    await ctx.plugin(ToolRuntime);
  }
  await ctx.plugin(SkillRegistry);
  ctx.provide("credentials", {} as Context["credentials"]);
  ctx.provide("fs", { sandboxMode: undefined } as unknown as Context["fs"]);
  const fiber = ctx.plugin({
    name: "dsh-univer-work-discovery-test",
    inject: ["credentials", "tools", "skills", "fs"],
    apply(child: Context) {
      if (options.queryResources !== undefined) {
        const owner = new WorkspaceToolOwner();
        const installed = createWorkspaceDiscoveryDatasets();
        const disposers = registerWorkspaceApiDiscoveryTools(child, {
          datasets: { ...installed, queryResources: options.queryResources },
          owner,
        });
        return async () => {
          owner.stopAccepting();
          for (const dispose of [...disposers].reverse()) dispose();
          owner.abort();
          await owner.drain();
        };
      }
      mountWorkspaceAuthentication(child, {
        ...(options.apiReference === undefined
          ? {}
          : { discovery: { createApiReference: () => options.apiReference } }),
      });
    },
  });
  await fiber;
  return ctx;
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly isolation = "discovery-runtime-test";
  public readonly language = "typescript";
  public dispatches: Array<{ readonly arguments: Record<string, unknown>; readonly name: string }> = [];

  public override async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const tools = request.bindings.find(({ global }) => global === "tools")?.functions;
    if (tools === undefined) return { logs: [], error: { kind: "exception", message: "missing tools" } };
    const value: CodeJsonValue[] = [];
    for (const dispatch of this.dispatches) value.push(await tools[dispatch.name]!(dispatch.arguments));
    return { logs: [], value };
  }
}

async function execute(
  ctx: Context,
  name: string,
  arguments_: Record<string, unknown>,
  agent?: unknown,
  signal = new AbortController().signal,
) {
  return await ctx.tools.execute({
    signal,
    callId: CallId(`${name}-${Math.random()}`),
    name,
    arguments: arguments_,
    ...(agent === undefined ? {} : { agent: agent as never }),
  });
}

function directApiTools(overrides: Partial<ApiReference> = {}) {
  const installed = createWorkspaceDiscoveryDatasets();
  const find = overrides.find ?? vi.fn(installed.apiReference.find.bind(installed.apiReference));
  const show = overrides.show ?? vi.fn(installed.apiReference.show.bind(installed.apiReference));
  const definitions = new Map<string, ToolDefinition>();
  const ctx = {
    on: () => () => undefined,
    tools: {
      register(definition: ToolDefinition) {
        definitions.set(definition.name, definition);
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerWorkspaceApiDiscoveryTools(ctx, {
    datasets: {
      ...installed,
      apiReference: {
        find,
        show,
      },
    },
    owner: new WorkspaceToolOwner(),
  });
  return { definitions, find, show };
}

function directResourceTools(overrides: Partial<ResourceLibrary> = {}) {
  const installed = createWorkspaceDiscoveryDatasets();
  const listRegistries = overrides.listRegistries
    ?? vi.fn(installed.queryResources.listRegistries.bind(installed.queryResources));
  const find = overrides.find ?? vi.fn(installed.queryResources.find.bind(installed.queryResources));
  const exportResources = overrides.export ?? vi.fn(installed.queryResources.export.bind(installed.queryResources));
  const definitions = new Map<string, ToolDefinition>();
  const ctx = {
    on: () => () => undefined,
    tools: {
      register(definition: ToolDefinition) {
        definitions.set(definition.name, definition);
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerWorkspaceApiDiscoveryTools(ctx, {
    datasets: {
      ...installed,
      queryResources: {
        ...installed.queryResources,
        ...overrides,
        listRegistries,
        find,
        export: exportResources,
      },
    },
    owner: new WorkspaceToolOwner(),
  });
  return { definitions, exportResources, find, listRegistries };
}

function resourceSummary() {
  return {
    handle: "icons/arrow",
    registryId: "icons",
    id: "arrow",
    name: "Arrow",
    group: null,
    tags: [{ id: "direction", label: "Direction" }],
    keywords: ["arrow"],
    order: 1,
    intrinsicSize: { width: 24, height: 24 },
    colorEditable: true,
  };
}

class TrackingLocalFileSystem extends LocalFileSystem {
  public override processPath(target: FsTarget): string {
    return super.processPath(target);
  }
}

class ConfiningTrackingLocalFileSystem extends TrackingLocalFileSystem {
  public override get sandboxMode(): "workspace-write" { return "workspace-write"; }
}

class BarrierLocalFileSystem extends TrackingLocalFileSystem {
  public readonly entered = deferred<void>();
  public readonly release = deferred<void>();
  private outputResolves = 0;

  public override async resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    if (path === "out") {
      this.outputResolves += 1;
      if (this.outputResolves === 2) {
        this.entered.resolve();
        await this.release.promise;
      }
    }
    return await super.resolve(path, options);
  }
}

async function setupExport(options: {
  readonly approval?: ApprovalOutcome | (() => Promise<ApprovalOutcome>);
  readonly codeMode?: boolean;
  readonly createExportLibrary?: (options: CreateResourceLibraryOptions) => ResourceLibrary;
  readonly cwd: string;
  readonly filesystem?: "local" | "confining" | "barrier" | FileSystem;
  readonly policy?: () => {
    readonly mode: "read-only" | "workspace-write" | "danger-full-access";
    readonly workspaceRoot: string;
  };
  readonly openResourceTemp?: typeof open;
  readonly renameResourceTemp?: typeof rename;
}) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  if (options.codeMode === true) {
    await ctx.plugin(ControlledCodeRuntime);
    await ctx.plugin(ToolRuntime, { mode: "code" });
  } else {
    await ctx.plugin(ToolRuntime);
  }
  await ctx.plugin(SkillRegistry);
  if (options.approval !== undefined) await ctx.plugin(ApprovalService);
  if (options.filesystem === undefined || options.filesystem === "local") {
    await ctx.plugin(TrackingLocalFileSystem, { cwd: options.cwd });
  } else if (options.filesystem === "confining") {
    await ctx.plugin(ConfiningTrackingLocalFileSystem, { cwd: options.cwd });
  } else if (options.filesystem === "barrier") {
    await ctx.plugin(BarrierLocalFileSystem, { cwd: options.cwd });
  } else {
    ctx.provide("fs", options.filesystem);
  }
  if (options.policy !== undefined) {
    ctx.provide("sandboxPolicy", { resolve: options.policy } as unknown as Context["sandboxPolicy"]);
  }
  const approvalReasons: string[] = [];
  const approvals: string[] = [];
  if (options.approval !== undefined) {
    ctx.on("approval/request", (request) => {
      approvals.push(request.toolName);
      approvalReasons.push(request.reason ?? "");
      return typeof options.approval === "function"
        ? options.approval()
        : Promise.resolve(options.approval!);
    });
  }
  const installed = createWorkspaceDiscoveryDatasets();
  const exportResources = vi.fn(installed.queryResources.export.bind(installed.queryResources));
  const queryResources: ResourceLibrary = {
    cacheLocation: installed.queryResources.cacheLocation,
    listRegistries: installed.queryResources.listRegistries.bind(installed.queryResources),
    find: installed.queryResources.find.bind(installed.queryResources),
    read: installed.queryResources.read.bind(installed.queryResources),
    export: exportResources,
    clearCache: installed.queryResources.clearCache.bind(installed.queryResources),
  };
  const fiber = ctx.plugin({
    name: `dsh-univer-work-discovery-export-${Math.random()}`,
    inject: ["tools", "fs"],
    apply(child: Context) {
      const owner = new WorkspaceToolOwner();
      const disposers = registerWorkspaceApiDiscoveryTools(child, {
        datasets: { ...installed, queryResources },
        owner,
        ...(options.createExportLibrary === undefined
          ? {}
          : { createExportLibrary: options.createExportLibrary }),
        ...(options.openResourceTemp === undefined
          ? {}
          : { openResourceTemp: options.openResourceTemp }),
        ...(options.renameResourceTemp === undefined
          ? {}
          : { renameResourceTemp: options.renameResourceTemp }),
      });
      return async () => {
        owner.stopAccepting();
        for (const dispose of [...disposers].reverse()) dispose();
        owner.abort();
        await owner.drain();
      };
    },
  });
  await fiber;
  const filesystem = ctx.get("fs");
  const processPath = filesystem instanceof LocalFileSystem
    ? vi.spyOn(filesystem, "processPath")
    : vi.fn();
  return { approvalReasons, approvals, ctx, exportResources, fiber, processPath };
}

function fakeDiscoveryAgent(cwd: string): unknown {
  const id = SessionId(`discovery-export-${Math.random()}`);
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { session };
}

function outputFilenameLibrary(filename: string) {
  return (options: CreateResourceLibraryOptions): ResourceLibrary => ({
    cacheLocation: "",
    listRegistries: () => [],
    find: () => ({ resources: [], total: 0 }),
    read: () => Promise.reject(new Error("not used")),
    clearCache: () => Promise.resolve({ path: "", resourceCount: 0, byteCount: 0 }),
    async export(input) {
      const handle = input.handles[0]!;
      try {
        const path = await options.output.write(input.destination, filename, "<svg></svg>");
        return { exported: [{ handle, path }], failed: [] };
      } catch (error) {
        return {
          exported: [],
          failed: [{
            handle,
            code: error instanceof ResourceLibraryError ? error.code : "resource-export-failed",
            message: "Resource output failed.",
          }],
        };
      }
    },
  });
}

function contradictoryExportLibrary(behavior: "failure" | "forged" | "mismatch") {
  return (options: CreateResourceLibraryOptions): ResourceLibrary => ({
    cacheLocation: "",
    listRegistries: () => [],
    find: () => ({ resources: [], total: 0 }),
    read: () => Promise.reject(new Error("not used")),
    clearCache: () => Promise.resolve({ path: "", resourceCount: 0, byteCount: 0 }),
    async export(input) {
      const handle = input.handles[0]!;
      if (behavior === "forged") {
        return {
          exported: [{ handle, path: `/private/${datasetSentinel}.svg` }],
          failed: [],
        };
      }
      const path = await options.output.write(input.destination, "safe.svg", "<svg></svg>");
      return behavior === "mismatch"
        ? {
            exported: [{ handle, path: `/private/${datasetSentinel}.svg` }],
            failed: [],
          }
        : {
            exported: [],
            failed: [{
              handle,
              code: "resource-export-failed",
              message: `secret ${datasetSentinel} after ${path}`,
            }],
          };
    },
  });
}

function throwingExportLibrary(error: Error) {
  return (): ResourceLibrary => ({
    cacheLocation: "",
    listRegistries: () => [],
    find: () => ({ resources: [], total: 0 }),
    read: () => Promise.reject(error),
    clearCache: () => Promise.resolve({ path: "", resourceCount: 0, byteCount: 0 }),
    export: () => Promise.reject(error),
  });
}

function sizedSvgResponse(byteLength: number): Response {
  const prefix = new TextEncoder().encode("<svg>");
  const suffix = new TextEncoder().encode("</svg>");
  const padding = new Uint8Array(byteLength - prefix.byteLength - suffix.byteLength);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
      controller.enqueue(padding);
      controller.enqueue(suffix);
      controller.close();
    },
  }));
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dsh-univer-work-discovery-"));
  temporaryDirectories.push(path);
  return path;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function directExecute(
  definitions: ReadonlyMap<string, ToolDefinition>,
  name: string,
  arguments_: unknown,
  signal = new AbortController().signal,
) {
  const definition = definitions.get(name);
  if (definition === undefined) throw new Error(`Missing test tool ${name}`);
  return await definition.execute(arguments_, { signal } as ToolRunContext);
}
