import { expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { markdownOperation } from "../src/executor/ops/markdown-errors.js";
import { mapRuntimeError } from "../src/executor/errors.js";
import {
  compileWorkspaceMarkdownSource,
  parseDocMarkdownSourceMap,
  WorkspaceContentSource,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { markdownCompile } from "../src/executor/ops/markdown-compile.js";
import { markdownExport } from "../src/executor/ops/markdown-export.js";
import { runConversionJob } from "../src/executor/jobs/run.js";
import { markdownCompileInput, opSpecs } from "../src/shared/executor-protocol.js";
import { zeroCost } from "../src/shared/usage.js";
import type { OpContext } from "../src/executor/context.js";
import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "../src/executor/license.js";

const sourceMap = [
  {
    id: "intro",
    kind: "paragraph",
    source: { line: 1, column: 1, offset: 0, endOffset: 30 },
    paragraphIds: ["p1"],
    objectIds: [],
  },
];
const markdown = ":::block{#intro}\nHello Markdown\n:::\n";
const target = {
  origin: "http://workspace.test",
  unitId: "doc",
  unitType: "doc" as const,
  revision: 1,
  scope: { kind: "worktree" as const, worktreeId: "wt" },
};
function context(fetcher = vi.fn<typeof fetch>()): OpContext {
  const http = new WorkspaceHttp({
    origin: target.origin,
    cookie: "workspace_session=test",
    role: "client",
    fetcher,
  });
  const source = new WorkspaceContentSource(http);
  vi.spyOn(source, "resolveEditableRuntimeTarget").mockResolvedValue(target);
  vi.spyOn(source, "resolveRuntimeTarget").mockResolvedValue(target);
  return {
    userId: "owner",
    requestId: "markdown",
    signal: AbortSignal.timeout(20000),
    transportOrigin: http.origin,
    http: () => http,
    source: () => source,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData: vi.fn() },
    exchange: { license: "", licenseKey: "" },
    materializer: {
      materialize: (input) =>
        runConversionJob(
          { kind: "markdown.materialize", ...input },
          { license: UNIVER_LICENSE, licenseKey: UNIVER_LICENSE_KEY },
          AbortSignal.timeout(10000),
          new URL("./fixtures/job-entry.mjs", import.meta.url),
        ),
    },
  };
}
it("validates compile-only, create and block-update modes and retry keys", () => {
  expect(markdownCompileInput.safeParse({ markdown }).success).toBe(true);
  const create = { markdown, apply: true, worktreeId: "wt", spaceId: "space" };
  expect(markdownCompileInput.safeParse(create).success).toBe(true);
  const update = {
    markdown,
    apply: true,
    worktreeId: "wt",
    unitId: "doc",
    sourceMap,
    blockIds: ["intro"],
  };
  expect(markdownCompileInput.safeParse(update).success).toBe(true);
  for (const input of [
    { markdown, worktreeId: "wt" },
    { ...create, worktreeId: undefined },
    { ...create, spaceId: undefined },
    { ...create, sourceMap },
    { ...update, sourceMap: undefined },
    { ...update, blockIds: [] },
    { ...update, blockIds: ["intro", "intro"] },
    { ...update, spaceId: "space" },
    { ...update, parentNodeId: "parent" },
    { ...update, idempotencyKey: "valid-retry-key-123" },
    ...["short", "a".repeat(201), "bad/key-123456789", "has spaces-123456"].map(
      (idempotencyKey) => ({ ...create, idempotencyKey }),
    ),
  ])
    expect(markdownCompileInput.safeParse(input).success).toBe(false);
  expect(opSpecs["markdown.compile"].effectFor?.({ markdown })).toBe("read");
  expect(opSpecs["markdown.compile"].effectFor?.(create)).toBe("write");
});
it("compile-only returns the program without creating or opening a runtime", async () => {
  const ctx = context();
  const result = await markdownCompile(ctx, { markdown }, new Uint8Array());
  expect(result.output).toMatchObject({
    committed: false,
    javascript: expect.stringContaining("Hello Markdown"),
  });
  expect(ctx.runtime.executeAndCommit).not.toHaveBeenCalled();
  expect(ctx.usage.cost.committed_revisions).toBe(0);
  expect(ctx.usage.unitType).toBeUndefined();
  expect(ctx.usage.repo).toBeUndefined();
});
it("reproduces real native initialData on apply retry after a lost POST response", async () => {
  const bodies: string[] = [];
  const keys: (string | null)[] = [];
  let confirmed = false;
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    bodies.push(String(options?.body));
    keys.push(new Headers(options?.headers).get("idempotency-key"));
    if (!confirmed) throw new TypeError("lost response after write");
    const body = JSON.parse(String(options?.body));
    return Response.json({
      unit: {
        unitId: "created-once",
        resourceId: "resource",
        nodeId: "node",
        name: body.name,
        source: "worktree",
        unitType: "doc",
        draftHeadRevision: 1,
        change: "added",
        mergeResult: "pending",
        activationState: "waitingForMerge",
        target: { spaceId: "space", parentNodeId: null },
      },
    });
  });
  const ctx = context(fetcher);
  const input = markdownCompileInput.parse({
    markdown,
    apply: true,
    worktreeId: "wt",
    spaceId: "space",
    idempotencyKey: "markdown-retry-12345",
  });
  await expect(markdownCompile(ctx, input, new Uint8Array())).rejects.toMatchObject({
    code: "workspace-result-unknown",
  });
  confirmed = true;
  const retry = await markdownCompile(ctx, input, new Uint8Array());
  expect(retry.output).toMatchObject({ committed: true, targetUnitId: "created-once" });
  expect(ctx.usage.unitType).toBe("doc");
  expect(ctx.usage.repo).toBe("space");
  expect(new Set(bodies).size).toBe(1);
  expect(new Set(keys).size).toBe(1);
  expect(bodies.length).toBeGreaterThan(1);
  expect(JSON.parse(bodies[0]!).initialData).toMatchObject({ rev: 1 });
}, 30000);
it("updates explicit blocks through executeAndCommit and records the confirmed revision", async () => {
  const ctx = context(
    vi.fn(async () =>
      Response.json({
        worktree: {
          id: "wt",
          name: "Draft",
          number: 1,
          teamSpace: { id: "space" },
          state: "draft",
          units: [],
        },
      }),
    ),
  );
  vi.mocked(ctx.runtime.executeAndCommit).mockResolvedValue({
    committed: true,
    revision: 2,
    status: "committed",
    value: { sourceMap },
  });
  const result = await markdownCompile(
    ctx,
    markdownCompileInput.parse({
      markdown,
      apply: true,
      worktreeId: "wt",
      unitId: "doc",
      sourceMap,
      blockIds: ["intro"],
    }),
    new Uint8Array(),
  );
  expect(ctx.runtime.executeAndCommit).toHaveBeenCalledWith({
    target,
    code: expect.stringContaining("Hello Markdown"),
  });
  expect(result.output).toMatchObject({ committed: true, sourceMap, execution: { revision: 2 } });
  expect(ctx.usage.repo).toBe("space");
  expect(ctx.usage.cost.committed_revisions).toBe(1);
  expect(ctx.usage.unitType).toBe("doc");
});
it("exports native content and resolves referenced images through authenticated Workspace HTTP", async () => {
  const imageId = "12345678-1234-1234-1234-123456789abc";
  const data = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    expect(new Headers(options?.headers).get("accept-encoding")).toBe("identity");
    expect(new Headers(options?.headers).get("cookie")).toBe("workspace_session=test");
    const prefix = `/universer-api/worktrees/wt/file/${imageId}`;
    return String(url).endsWith("sign-url")
      ? Response.json({ error: { code: 1 }, url: `${prefix}/content` })
      : new Response(data, {
          headers: { "content-type": "image/png", "content-length": String(data.length) },
        });
  });
  const ctx = context(fetcher);
  vi.mocked(ctx.runtime.executeRead).mockResolvedValue({
    value: {
      formatVersion: 1,
      unitId: "doc",
      blockIds: ["intro"],
      markdown: "![Image](assets/image.png)\n",
      diagnostics: [],
      sourceMap,
      assets: [
        {
          path: "assets/image.png",
          kind: "image",
          mimeType: "application/octet-stream",
          encoding: "reference",
          data: imageId,
        },
      ],
    },
    state: {
      baseRevision: 7,
      knownHeadRevision: 7,
      connection: "online",
      pendingMutationCount: 0,
      bufferedChangesetCount: 0,
      awaitingChangeset: null,
      conflict: null,
    },
  });
  const result = await markdownExport(ctx, {
    worktreeId: "wt",
    unitId: "doc",
    sourceMap,
    blockIds: ["intro"],
  });
  expect(result.output).toMatchObject({
    markdown: expect.stringContaining("Image"),
    revision: 7,
    assets: [{ offset: 0, size: data.length }],
  });
  expect(new Uint8Array(result.bytes)).toEqual(data);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(ctx.runtime.executeAndCommit).not.toHaveBeenCalled();
});

const invalidMarkdown = [
  { label: "inline HTML", text: "Hello <b>html</b>", code: "MARKDOWN_INLINE" },
  { label: "footnotes", text: "a[^x]\n\n[^x]: footnote", code: "MARKDOWN_INLINE" },
  { label: "missing ZIP image", text: "![missing](missing.png)", code: "MARKDOWN_ASSET" },
  {
    label: "missing image without ZIP",
    text: "![missing](missing.png)",
    code: "MARKDOWN_ASSET",
    noZip: true,
  },
  {
    label: "duplicate IDs",
    text: ":::block{#a}\none\n:::\n\n:::block{#a}\ntwo\n:::",
    code: "MARKDOWN_DUPLICATE_ID",
  },
  ...["https://example.test/a.png", "/a.png", "../a.png", "file:///a.png"].map((path) => ({
    label: path,
    text: `![image](${path})`,
    code: "MARKDOWN_ASSET_PATH",
  })),
];
it.each(
  ["compile-only", "create", "update"].flatMap((mode) =>
    invalidMarkdown.map((example) => ({ mode, ...example })),
  ),
)(
  "returns actionable diagnostics for $label in $mode mode",
  async ({ mode, text, code, ...example }) => {
    const ctx = context();
    const assets = new Map([["other.png", new Uint8Array([1])]]);
    const expected = await compileWorkspaceMarkdownSource(
      text,
      { targetUnitId: "doc" },
      assets,
    ).catch((error: unknown) => error);
    expect(expected).toBeInstanceOf(Error);
    const input = markdownCompileInput.parse({
      markdown: text,
      ...(mode === "compile-only"
        ? {}
        : mode === "create"
          ? { apply: true, worktreeId: "wt", spaceId: "space" }
          : { apply: true, worktreeId: "wt", unitId: "doc", sourceMap, blockIds: ["intro"] }),
    });
    const error = await markdownCompile(
      ctx,
      input,
      "noZip" in example ? new Uint8Array() : zipSync(Object.fromEntries(assets)),
    ).catch((error: unknown) => error);
    expect(mapRuntimeError(error, mode === "compile-only" ? "read" : "write")).toEqual({
      outcome: "tool_error",
      code: "workspace-markdown-invalid",
      message: expected instanceof Error ? expected.message : "",
      detail: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code, severity: "error", message: expect.any(String) }),
        ]),
      },
    });
    expect(ctx.runtime.executeAndCommit).not.toHaveBeenCalled();
    expect(ctx.usage.unitType).toBeUndefined();
    expect(ctx.usage.repo).toBeUndefined();
  },
);
it("keeps unrelated internal errors private", async () => {
  const error = new Error("private internal detail");
  await expect(
    markdownOperation(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(mapRuntimeError(error, "read")).toMatchObject({
    outcome: "internal_error",
    code: "workspace-internal-error",
    message: "Internal tool error.",
  });
});
it.each(["update", "export"])(
  "reports an unmapped block as an SDK input error for %s",
  async (mode) => {
    const ctx = context();
    const input = {
      markdown: ":::block{#nope}\nHello\n:::",
      apply: true,
      worktreeId: "wt",
      unitId: "doc",
      sourceMap,
      blockIds: ["nope"],
    };
    const error = await (
      mode === "update" ? markdownCompile(ctx, input, new Uint8Array()) : markdownExport(ctx, input)
    ).catch((error: unknown) => error);
    const code = mode === "update" ? "DOC_MARKDOWN_UPDATE_INVALID" : "DOC_MARKDOWN_READ_INVALID";
    expect(mapRuntimeError(error, mode === "update" ? "write" : "read")).toMatchObject({
      outcome: "tool_error",
      code: "workspace-markdown-invalid",
      message: expect.stringMatching(new RegExp(`^${code}: Block 'nope'`)),
      detail: { diagnostics: [expect.objectContaining({ code })] },
    });
    expect(ctx.runtime.executeRead).not.toHaveBeenCalled();
    expect(ctx.runtime.executeAndCommit).not.toHaveBeenCalled();
  },
);
it.each(["update", "export"])(
  "returns actionable invalid source_map diagnostics for %s",
  async (mode) => {
    const ctx = context();
    const invalidMap = [{}];
    let expected: unknown;
    try {
      parseDocMarkdownSourceMap(invalidMap);
    } catch (error) {
      expected = error;
    }
    const input = {
      markdown,
      apply: true,
      worktreeId: "wt",
      unitId: "doc",
      sourceMap: invalidMap,
      blockIds: ["intro"],
    };
    const error = await (
      mode === "update" ? markdownCompile(ctx, input, new Uint8Array()) : markdownExport(ctx, input)
    ).catch((error: unknown) => error);
    expect(mapRuntimeError(error, mode === "update" ? "write" : "read")).toEqual({
      outcome: "tool_error",
      code: "workspace-markdown-invalid",
      message: `${expected instanceof Error ? expected.message : ""} Pass the sourceMap returned by the last compile_markdown or export_markdown of this Doc; hand-built maps are rejected. A Doc without one can be read with inspect or read-only execute.`,
      detail: {
        diagnostics: [
          expect.objectContaining({
            code: "DOC_MARKDOWN_SOURCE_MAP_INVALID",
            message: expect.any(String),
          }),
        ],
      },
    });
    expect(ctx.runtime.executeAndCommit).not.toHaveBeenCalled();
    expect(ctx.runtime.executeRead).not.toHaveBeenCalled();
  },
);

it.each(["asset unavailable", "malformed read"])(
  "classifies export diagnostics by code for %s",
  async (scenario) => {
    const ctx = context(vi.fn(async () => new Response(null, { status: 404 })));
    vi.mocked(ctx.runtime.executeRead).mockResolvedValue({
      value:
        scenario === "malformed read"
          ? {}
          : {
              formatVersion: 1,
              unitId: "doc",
              blockIds: ["intro"],
              markdown: "![Image](assets/image.png)\n",
              diagnostics: [],
              sourceMap,
              assets: [
                {
                  path: "assets/image.png",
                  kind: "image",
                  mimeType: "application/octet-stream",
                  encoding: "reference",
                  data: "12345678-1234-1234-1234-123456789abc",
                },
              ],
            },
      state: {
        baseRevision: 7,
        knownHeadRevision: 7,
        connection: "online",
        pendingMutationCount: 0,
        bufferedChangesetCount: 0,
        awaitingChangeset: null,
        conflict: null,
      },
    });
    const error = await markdownExport(ctx, {
      worktreeId: "wt",
      unitId: "doc",
      sourceMap,
      blockIds: ["intro"],
    }).catch((error: unknown) => error);
    expect(mapRuntimeError(error, "read")).toMatchObject(
      scenario === "malformed read"
        ? { code: "workspace-runtime-result-invalid", outcome: "internal_error" }
        : {
            code: "workspace-markdown-asset-unavailable",
            outcome: "tool_error",
            detail: {
              retryable: true,
              diagnostics: [
                expect.objectContaining({ code: "DOC_MARKDOWN_READ_ASSET_UNAVAILABLE" }),
              ],
            },
          },
    );
  },
);
