import {
  DaCTypstTranslationError,
  DocTypstFacadeError,
  type CompileDocTypstBundleResult,
} from "@univer-cli/doc-typst-facade";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceApplicationError,
  WorkspaceCompileTypstFeature,
  WorkspaceHttp,
  projectWorkspaceTypstDependencyFailure,
  WorkspaceResultUnknownError,
  WorkspaceUnitFeature,
  type WorkspaceCompileTypstDependencies,
  type WorkspaceUnit,
} from "../src/index.js";

const compiled: CompileDocTypstBundleResult = {
  diagnostics: [],
  javascript: "return Promise.resolve();",
  previews: [],
  targetUnitId: "typst-doc",
  title: "Compiled paper",
};
type CreateInput = Parameters<WorkspaceCompileTypstDependencies["units"]["create"]>[0];

describe("Workspace Typst compilation", () => {
  it("projects only exact frozen compiler errors", () => {
    const diagnostics = [{ reason: "unsupported", sourcePath: "pages/one.typ" }];
    expect(projectWorkspaceTypstDependencyFailure(
      new DocTypstFacadeError("DOC_TYPST_MANIFEST_INVALID", "host path secret"),
    )).toEqual({ code: "workspace-typst-bundle-invalid" });
    expect(projectWorkspaceTypstDependencyFailure(
      new DaCTypstTranslationError("native secret", diagnostics),
    )).toEqual({ code: "workspace-typst-compile-failed", diagnostics });
    expect(projectWorkspaceTypstDependencyFailure(
      new DocTypstFacadeError("SAC_DAC_PREVIEW_RENDER_UNAVAILABLE", "native secret"),
    )).toEqual({ code: "workspace-typst-preview-failed" });
    expect(projectWorkspaceTypstDependencyFailure(
      new DocTypstFacadeError("FUTURE_UNKNOWN_CODE", "native secret"),
    )).toBeUndefined();
    expect(projectWorkspaceTypstDependencyFailure({
      code: "DOC_TYPST_MANIFEST_INVALID",
      message: "forged",
    })).toBeUndefined();
  });

  it.each([
    [undefined, {}],
    ["relative/previews", { previewDir: "relative/previews" }],
    ["path with spaces/previews", { previewDir: "path with spaces/previews" }],
    ["/absolute/previews", { previewDir: "/absolute/previews" }],
  ] as const)("compiles once with exact preview input %s and no Workspace side effects", async (previewDir, options) => {
    const diagnostic = { reason: "notice", severity: "info" as const, sourcePath: "page.typ" };
    const preview = { pageId: "page-1", path: "preview.svg", sourcePath: "page.typ" };
    const result = {
      ...compiled,
      diagnostics: [diagnostic],
      extra: { nested: true },
      previews: [preview],
    } as CompileDocTypstBundleResult & { readonly extra: { readonly nested: boolean } };
    const compile = vi.fn(async () => result);
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    const operation = feature.execute({
      bundlePath: " exact/bundle path ",
      ...(previewDir === undefined ? {} : { previewDir }),
    });
    await expect(operation).resolves.toEqual({ ...result, committed: false });
    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith(" exact/bundle path ", options);
    expect((await operation).diagnostics).toBe(result.diagnostics);
    expect((await operation).previews).toBe(result.previews);
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns compile-only errors and all compiler artifacts without side effects", async () => {
    const diagnostics = [
      { reason: "unsupported", severity: "error" as const, sourcePath: "page.typ" },
      { reason: "approximate", severity: "warning" as const, sourcePath: "page.typ" },
    ];
    const result = { ...compiled, diagnostics };
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({
      compile: vi.fn(async () => result),
      materializer: { materialize },
      units: { create },
    });

    await expect(feature.execute({ bundlePath: "paper" })).resolves.toEqual({
      ...result,
      committed: false,
    });
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates compiler rejection without retry or side effects", async () => {
    const failure = new Error("compile failed");
    const compile = vi.fn(async () => {
      throw failure;
    });
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(feature.execute({ bundlePath: "paper" })).rejects.toBe(failure);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks apply on errors with exact error-only detail", async () => {
    const error1 = { reason: "first", severity: "error" as const, sourcePath: "one.typ" };
    const warning = { reason: "warn", severity: "warning" as const, sourcePath: "one.typ" };
    const error2 = { reason: "second", severity: "error" as const, sourcePath: "two.typ" };
    const compile = vi.fn(async () => ({ ...compiled, diagnostics: [warning, error1, error2] }));
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    const failure = await feature
      .execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkspaceApplicationError);
    expect(failure).toMatchObject({
      code: "workspace-typst-diagnostics",
      detail: { diagnostics: [error1, error2] },
      message: "Typst compilation contains 2 error diagnostic(s); no Unit was created.",
    });
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("allows warnings and uses the same compiled program exactly once", async () => {
    const warning = { reason: "approximate", severity: "warning" as const, sourcePath: "page.typ" };
    const result = { ...compiled, diagnostics: [warning] };
    const compile = vi.fn(async () => result);
    const materialized = {
      initialData: { id: "typst-doc", name: "Runtime paper", rev: 1 },
      name: "Runtime paper",
    };
    const materialize = vi.fn(async () => materialized);
    const create = vi.fn(async () => unit());
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      }),
    ).resolves.toEqual({ ...result, committed: true, unit: unit() });
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledWith({
      javascript: result.javascript,
      targetUnitId: result.targetUnitId,
    });
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("Workspace Typst apply", () => {
  it("creates one staged Doc with exact materialized data and caller identity", async () => {
    const compile = vi.fn(async () => compiled);
    const initialData = { body: { dataStream: "content" }, id: "typst-doc", rev: 1 };
    const materialize = vi.fn(async () => ({ initialData, name: "  Materialized name  " }));
    const serverUnit = unit();
    const create = vi.fn(async (_input: CreateInput) => serverUnit);
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: {
          idempotencyKey: " request-1 ",
          parentNodeId: " parent-1 ",
          spaceId: " space-1 ",
          worktreeId: " worktree-1 ",
        },
        bundlePath: " bundle ",
      }),
    ).resolves.toEqual({ ...compiled, committed: true, unit: serverUnit });
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      idempotencyKey: " request-1 ",
      initialData,
      name: "  Materialized name  ",
      parentNodeId: " parent-1 ",
      spaceId: " space-1 ",
      type: "doc",
      worktreeId: " worktree-1 ",
    });
    expect(create.mock.calls[0]![0].initialData).toBe(initialData);
    expect(serverUnit.unitId).not.toBe(compiled.targetUnitId);
  });

  it("uses compiled title and omits optional create fields when materialized name is absent", async () => {
    const create = vi.fn(async (_input: CreateInput) => unit());
    const feature = createFeature({
      materializer: { materialize: async () => ({ initialData: { id: "typst-doc" } }) },
      units: { create },
    });
    await feature.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
    });
    expect(create).toHaveBeenCalledWith({
      initialData: { id: "typst-doc" },
      name: compiled.title,
      spaceId: "space-1",
      type: "doc",
      worktreeId: "wt-1",
    });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("idempotencyKey");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("parentNodeId");
  });

  it.each([
    "workspace-result-unknown",
    "workspace-result-mismatch",
    "workspace-invalid-response",
  ] as const)("owns one exact create identity for real Unit %s outcomes", async (code) => {
    const requests: Request[] = [];
    const fetcher = vi.fn<typeof fetch>(async (requestInput, init) => {
      const request = new Request(requestInput, init);
      requests.push(request.clone());
      if (code === "workspace-result-unknown") throw new Error("private transport failure");
      if (code === "workspace-invalid-response") return Response.json({ unit: {} });
      return Response.json({
        unit: rawCreatedUnit({ name: "Different name" }),
      });
    });
    const feature = createFeature({ units: realUnits(fetcher) });
    const failure = await feature.execute({
      apply: { parentNodeId: "parent-1", spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxVisibleResultBytes: 1024,
      maxVisibleResultDepth: 64,
    }).catch((error: unknown) => error) as WorkspaceApplicationError;

    expect(failure).toMatchObject({
      code,
      detail: {
        request: {
          name: compiled.title,
          parentNodeId: "parent-1",
          spaceId: "space-1",
          type: "doc",
          worktreeId: "wt-1",
        },
      },
      message: "Workspace Unit create completed without a safely confirmed result.",
    });
    const requestIdentity = (failure.detail as { request: Record<string, unknown> }).request;
    expect(requestIdentity["idempotencyKey"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(requests).toHaveLength(code === "workspace-result-unknown" ? 3 : 1);
    for (const request of requests) {
      expect(request.headers.get("idempotency-key")).toBe(requestIdentity["idempotencyKey"]);
      await expect(request.json()).resolves.toEqual({
        initialData: { id: "typst-doc" },
        name: compiled.title,
        source: "worktree",
        targetParentNodeId: "parent-1",
        targetSpaceId: "space-1",
        unitType: "doc",
      });
    }
  });

  it.each([
    [
      "result mismatch",
      new WorkspaceApplicationError("workspace-result-mismatch", "different Unit"),
    ],
    ["result unknown", new WorkspaceResultUnknownError("response lost")],
    ["ordinary failure", new Error("network failed")],
  ])("propagates %s without replay", async (_, failure) => {
    const compile = vi.fn(async () => compiled);
    const materialize = vi.fn(async () => ({ initialData: { id: "typst-doc" } }));
    const create = vi.fn(async () => {
      throw failure;
    });
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: { idempotencyKey: "stable", spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      }),
    ).rejects.toBe(failure);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it("does not create or replay when materialization fails", async () => {
    const failure = new Error("materialization failed");
    const compile = vi.fn(async () => compiled);
    const materialize = vi.fn(async () => {
      throw failure;
    });
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      }),
    ).rejects.toBe(failure);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("Workspace Typst optional controls", () => {
  it("does not enter the compiler when the supplied signal is already aborted", async () => {
    const compile = vi.fn(async () => compiled);
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(feature.execute({
      bundlePath: "paper",
      signal: AbortSignal.abort(),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(compile).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("awaits native compilation after cancellation and starts no later step", async () => {
    const started = deferred<void>();
    const settled = deferred<CompileDocTypstBundleResult>();
    const compile = vi.fn(async () => {
      started.resolve();
      return await settled.promise;
    });
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });
    const controller = new AbortController();

    let completed = false;
    const operation = feature.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      signal: controller.signal,
    }).finally(() => {
      completed = true;
    });
    await started.promise;
    controller.abort();
    await Promise.resolve();
    expect(completed).toBe(false);
    settled.resolve(compiled);
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves the exact abort reason when native compilation later rejects", async () => {
    const started = deferred<void>();
    const settled = deferred<void>();
    const dependencyFailure = new Error("native-secret-sentinel");
    const compile = vi.fn(async () => {
      started.resolve();
      await settled.promise;
      throw dependencyFailure;
    });
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");

    const operation = feature.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      signal: controller.signal,
    });
    await started.promise;
    controller.abort(reason);
    settled.resolve();
    await expect(operation).rejects.toBe(reason);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("awaits materialization after cancellation and starts no Unit create", async () => {
    const started = deferred<void>();
    const settled = deferred<{ initialData: Readonly<Record<string, unknown>> }>();
    const controller = new AbortController();
    const materialize = vi.fn(async (input: { readonly signal?: AbortSignal }) => {
      expect(input.signal).toBe(controller.signal);
      started.resolve();
      return await settled.promise;
    });
    const create = vi.fn();
    const feature = createFeature({ materializer: { materialize }, units: { create } });

    let completed = false;
    const operation = feature.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      signal: controller.signal,
    }).finally(() => {
      completed = true;
    });
    await started.promise;
    controller.abort();
    await Promise.resolve();
    expect(completed).toBe(false);
    settled.resolve({ initialData: { id: "typst-doc" } });
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(materialize).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts exact generated and visible-result boundaries and rejects max plus one", async () => {
    const visible = {
      diagnostics: compiled.diagnostics,
      previews: compiled.previews,
      targetUnitId: compiled.targetUnitId,
      title: compiled.title,
    };
    const generatedBytes = Buffer.byteLength(compiled.javascript);
    const visibleBytes = Buffer.byteLength(JSON.stringify(visible));
    const compile = vi.fn(async () => compiled);
    const feature = createFeature({ compile });

    await expect(feature.execute({
      bundlePath: "paper",
      maxGeneratedJavascriptBytes: generatedBytes,
      maxVisibleResultBytes: visibleBytes,
      maxVisibleResultDepth: 1,
    })).resolves.toEqual({ ...compiled, committed: false });
    await expect(feature.execute({
      bundlePath: "paper",
      maxGeneratedJavascriptBytes: generatedBytes - 1,
    })).rejects.toMatchObject({
      code: "workspace-typst-limit-exceeded",
      detail: {
        actual: generatedBytes,
        kind: "generated-javascript-bytes",
        limit: generatedBytes - 1,
      },
    });
    await expect(feature.execute({
      bundlePath: "paper",
      maxVisibleResultBytes: visibleBytes - 1,
    })).rejects.toMatchObject({
      code: "workspace-typst-limit-exceeded",
      detail: { actual: visibleBytes, kind: "visible-result-bytes", limit: visibleBytes - 1 },
    });
    await expect(feature.execute({
      bundlePath: "paper",
      maxVisibleResultDepth: 0,
    })).rejects.toMatchObject({
      code: "workspace-typst-limit-exceeded",
      detail: { actual: 1, kind: "visible-result-depth", limit: 0 },
    });
  });

  it("bounds the exact public create identity before create", async () => {
    const identity = {
      idempotencyKey: "request-1",
      name: "Bounded name",
      parentNodeId: null,
      spaceId: "space-1",
      type: "doc",
      worktreeId: "wt-1",
    };
    const identityBytes = Buffer.byteLength(JSON.stringify(identity));
    const create = vi.fn(async () => unit());
    const feature = createFeature({
      materializer: { materialize: async () => ({ initialData: {}, name: identity.name }) },
      units: { create },
    });
    await expect(feature.execute({
      apply: { idempotencyKey: identity.idempotencyKey, spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxVisibleResultBytes: identityBytes,
    })).resolves.toMatchObject({ committed: true });
    expect(create).toHaveBeenCalledOnce();

    create.mockClear();
    const oversized = createFeature({
      materializer: {
        materialize: async () => ({ initialData: {}, name: `${identity.name}x` }),
      },
      units: { create },
    });
    await expect(oversized.execute({
      apply: { idempotencyKey: identity.idempotencyKey, spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxVisibleResultBytes: identityBytes,
    })).rejects.toMatchObject({
      code: "workspace-typst-limit-exceeded",
      detail: { actual: identityBytes + 1, kind: "visible-result-bytes", limit: identityBytes },
    });
    expect(create).not.toHaveBeenCalled();

    await expect(createFeature({
      materializer: { materialize: async () => ({ initialData: {}, name: "" }) },
      units: { create },
    }).execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxVisibleResultBytes: identityBytes,
    })).rejects.toMatchObject({
      code: "workspace-typst-limit-exceeded",
      detail: { kind: "visible-result-json" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts exact UnitData boundaries and rejects bytes, depth, and non-lossless JSON before create", async () => {
    const initialData = { id: "typst-doc", nested: { value: true } };
    const bytes = Buffer.byteLength(JSON.stringify(initialData));
    const create = vi.fn(async () => unit());
    const feature = createFeature({
      materializer: { materialize: async () => ({ initialData }) },
      units: { create },
    });

    await expect(feature.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxUnitDataBytes: bytes,
      maxUnitDataDepth: 2,
    })).resolves.toMatchObject({ committed: true });
    expect(create).toHaveBeenCalledOnce();

    for (const limits of [
      { maxUnitDataBytes: bytes - 1 },
      { maxUnitDataDepth: 1 },
    ]) {
      create.mockClear();
      await expect(feature.execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
        ...limits,
      })).rejects.toMatchObject({ code: "workspace-typst-limit-exceeded" });
      expect(create).not.toHaveBeenCalled();
    }

    let getterCalls = 0;
    let toJsonCalls = 0;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    const withToJson = {
      toJSON() {
        toJsonCalls += 1;
        return "secret";
      },
    };
    const symbolKey = { visible: true } as Record<PropertyKey, unknown>;
    symbolKey[Symbol("secret")] = true;
    const nonEnumerable = Object.defineProperty({}, "hidden", { value: true });
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const hugeSparse: unknown[] = [];
    hugeSparse.length = 0xffff_ffff;
    class UnsupportedUnitData {}
    let inheritedToJsonCalls = 0;
    const customPrototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(customPrototype, {
      constructor: { value: Object },
      toJSON: {
        value() {
          inheritedToJsonCalls += 1;
          return "secret";
        },
      },
    });
    const inheritedToJson = Object.create(customPrototype) as Record<string, unknown>;
    inheritedToJson["id"] = "typst-doc";
    for (const unsafeValue of [
      accessor,
      withToJson,
      symbolKey,
      Symbol("value"),
      nonEnumerable,
      new Array(1),
      hugeSparse,
      new Date(0),
      new Map(),
      new Set(),
      new Uint8Array([1]),
      new UnsupportedUnitData(),
      inheritedToJson,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => undefined,
      circular,
    ]) {
      const unsafe = createFeature({
        materializer: { materialize: async () => ({ initialData: { unsafeValue } }) },
        units: { create },
      });
      await expect(unsafe.execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
        maxUnitDataBytes: 100,
      })).rejects.toMatchObject({
        code: "workspace-typst-limit-exceeded",
        detail: { kind: "unit-data-json" },
      });
    }
    expect(getterCalls).toBe(0);
    expect(toJsonCalls).toBe(0);
    expect(inheritedToJsonCalls).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("measures a safe JSON projection but creates with the original UnitData identity", async () => {
    const initialData = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(initialData, {
      id: { enumerable: true, value: "typst-doc" },
      optional: { enumerable: true, value: undefined },
    });
    Object.defineProperty(initialData, "__proto__", { enumerable: true, value: "preserved" });
    const bytes = Buffer.byteLength(JSON.stringify(initialData));
    const limitedCreate = vi.fn(async (_input: CreateInput) => unit());
    const limited = createFeature({
      materializer: { materialize: async () => ({ initialData }) },
      units: { create: limitedCreate },
    });

    await expect(limited.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxUnitDataBytes: bytes,
    })).resolves.toMatchObject({ committed: true });
    expect(limitedCreate.mock.calls[0]?.[0].initialData).toBe(initialData);
    expect(Object.hasOwn(initialData, "__proto__")).toBe(true);
    expect(Object.hasOwn(initialData, "optional")).toBe(true);
    expect(initialData["__proto__"]).toBe("preserved");

    limitedCreate.mockClear();
    await expect(limited.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxUnitDataBytes: bytes - 1,
    })).rejects.toMatchObject({
      code: "workspace-typst-limit-exceeded",
      detail: { kind: "unit-data-bytes" },
    });
    expect(limitedCreate).not.toHaveBeenCalled();

    const compatibleCreate = vi.fn(async (_input: CreateInput) => unit());
    await createFeature({
      materializer: { materialize: async () => ({ initialData }) },
      units: { create: compatibleCreate },
    }).execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
    });
    expect(compatibleCreate.mock.calls[0]?.[0].initialData).toBe(initialData);
  });

  it("accepts intrinsic foreign-realm records and creates with their original identity", async () => {
    const initialData = runInNewContext(
      "({ id: 'typst-doc', nested: { value: true }, optional: undefined })",
    ) as Readonly<Record<string, unknown>>;
    const create = vi.fn(async (_input: CreateInput) => unit());
    await expect(createFeature({
      materializer: { materialize: async () => ({ initialData }) },
      units: { create },
    }).execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      maxUnitDataBytes: Buffer.byteLength(JSON.stringify(initialData)),
      maxUnitDataDepth: 2,
    })).resolves.toMatchObject({ committed: true });
    expect(create.mock.calls[0]?.[0].initialData).toBe(initialData);
  });

  it("rejects intrinsic metadata accessors without reading them after root keys are snapshotted", async () => {
    for (const metadataKey of ["name", "length"] as const) {
      let getterCalls = 0;
      const initialData: Record<string, unknown> = { id: "typst-doc" };
      const candidate = function candidate() {};
      for (const key of ["name", "length"] as const) {
        Object.defineProperty(candidate, key, key === metadataKey
          ? {
              configurable: true,
              get() {
                getterCalls += 1;
                initialData["payload"] = "x".repeat(10_000);
                return key === "name" ? "Object" : 1;
              },
            }
          : Object.getOwnPropertyDescriptor(Object, key)!);
      }
      const prototype = copyObjectPrototype();
      Object.defineProperty(prototype, "constructor", {
        ...Object.getOwnPropertyDescriptor(Object.prototype, "constructor")!,
        value: candidate,
      });
      const unsafe = Object.create(prototype) as Record<string, unknown>;
      unsafe["visible"] = true;
      initialData["unsafe"] = unsafe;
      await expectUnitDataJsonFailure(initialData);
      expect(getterCalls).toBe(0);
      expect(initialData).not.toHaveProperty("payload");
    }
  });

  it("rejects object, prototype, and intrinsic-function Proxies without invoking traps", async () => {
    let trapCalls = 0;
    const handler: ProxyHandler<object> = {
      get() { trapCalls += 1; return undefined; },
      getOwnPropertyDescriptor() { trapCalls += 1; return undefined; },
      getPrototypeOf() { trapCalls += 1; return null; },
      ownKeys() { trapCalls += 1; return []; },
    };
    const objectProxy = new Proxy({}, handler);
    const prototypeProxy = new Proxy(copyObjectPrototype(), handler);
    const withProxyPrototype = Object.create(prototypeProxy) as Record<string, unknown>;
    withProxyPrototype["visible"] = true;
    const functionProxy = new Proxy(Object, handler);
    const functionPrototype = copyObjectPrototype();
    Object.defineProperty(functionPrototype, "constructor", {
      ...Object.getOwnPropertyDescriptor(Object.prototype, "constructor")!,
      value: functionProxy,
    });
    const withFunctionProxy = Object.create(functionPrototype) as Record<string, unknown>;
    withFunctionProxy["visible"] = true;

    for (const unsafe of [objectProxy, withProxyPrototype, withFunctionProxy]) {
      await expectUnitDataJsonFailure({ id: "typst-doc", unsafe });
    }
    expect(trapCalls).toBe(0);
  });

  it("passes one signal to shared Unit create and preserves confirmed and unknown races", async () => {
    const controller = new AbortController();
    const confirmedCreate = vi.fn(async (_input: CreateInput, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return unit();
    });
    await expect(createFeature({ units: { create: confirmedCreate } }).execute({
      apply: { idempotencyKey: "stable", spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      signal: controller.signal,
    })).resolves.toMatchObject({ committed: true, unit: unit() });
    expect(confirmedCreate).toHaveBeenCalledOnce();

    const unknownController = new AbortController();
    const unknown = new WorkspaceApplicationError(
      "workspace-result-unknown",
      "result unknown",
      { request: { idempotencyKey: "stable", worktreeId: "wt-1" } },
    );
    const unknownCreate = vi.fn(async (_input: CreateInput, signal?: AbortSignal) => {
      expect(signal).toBe(unknownController.signal);
      unknownController.abort();
      throw unknown;
    });
    const compile = vi.fn(async () => compiled);
    const materialize = vi.fn(async () => ({ initialData: { id: "typst-doc" } }));
    await expect(createFeature({ compile, materializer: { materialize }, units: { create: unknownCreate } }).execute({
      apply: { idempotencyKey: "stable", spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
      signal: unknownController.signal,
    })).rejects.toBe(unknown);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(unknownCreate).toHaveBeenCalledOnce();
  });
});

function createFeature(
  overrides: Partial<WorkspaceCompileTypstDependencies> = {},
): WorkspaceCompileTypstFeature {
  return new WorkspaceCompileTypstFeature({
    compile: async () => compiled,
    materializer: { materialize: async () => ({ initialData: { id: "typst-doc" } }) },
    units: { create: async () => unit() },
    ...overrides,
  });
}

function unit(): WorkspaceUnit {
  return {
    activationState: "notApplicable",
    change: "added",
    draftHeadRevision: 1,
    mergeResult: "pending",
    name: "Runtime paper",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree",
    target: { parentNodeId: null, spaceId: "space-1" },
    type: "doc",
    unitId: "server-unit-1",
    worktreeId: "wt-1",
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function realUnits(fetcher: typeof fetch): Pick<WorkspaceUnitFeature, "create"> {
  const http = new WorkspaceHttp({
    cookie: "workspace_session=test",
    fetcher,
    origin: "https://workspace.test",
    role: "client",
  });
  return new WorkspaceUnitFeature(async () => http);
}

function rawCreatedUnit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    activationState: "notApplicable",
    change: "added",
    draftHeadRevision: 1,
    mergeResult: "pending",
    name: compiled.title,
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree",
    target: { parentNodeId: "parent-1", spaceId: "space-1" },
    unitId: "server-unit-1",
    unitType: "doc",
    ...overrides,
  };
}

function copyObjectPrototype(): object {
  return Object.defineProperties(
    Object.create(null) as object,
    Object.getOwnPropertyDescriptors(Object.prototype),
  );
}

async function expectUnitDataJsonFailure(initialData: Readonly<Record<string, unknown>>) {
  const create = vi.fn();
  await expect(createFeature({
    materializer: { materialize: async () => ({ initialData }) },
    units: { create },
  }).execute({
    apply: { spaceId: "space-1", worktreeId: "wt-1" },
    bundlePath: "paper",
    maxUnitDataBytes: 100,
  })).rejects.toMatchObject({
    code: "workspace-typst-limit-exceeded",
    detail: { kind: "unit-data-json" },
  });
  expect(create).not.toHaveBeenCalled();
}
