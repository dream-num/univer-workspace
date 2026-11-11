import { expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { typstCompile } from "../src/executor/ops/typst-compile.js";
import { svgCompile } from "../src/executor/ops/svg-compile.js";
import { markdownCompile } from "../src/executor/ops/markdown-compile.js";
import { typstCompileInput, svgCompileInput, opSpecs } from "../src/shared/executor-protocol.js";
import { zeroCost } from "../src/shared/usage.js";
import { runConversionJob } from "../src/executor/jobs/run.js";
import type { OpContext } from "../src/executor/context.js";
import { compilerSourceLimits } from "../src/executor/source-zip.js";
import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "../src/executor/license.js";

const credentials = { license: UNIVER_LICENSE, licenseKey: UNIVER_LICENSE_KEY };
const entry = new URL("./fixtures/job-entry.mjs", import.meta.url);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="10" y="10" width="80" height="40"/><text x="10" y="80">Hello</text></svg>';
function bundle(text = "= Hello\n\nWorld") {
  return zipSync({
    "typst.json": Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        targetUnitId: "typst-test",
        title: "Typst test",
        pages: ["page.typ"],
      }),
    ),
    "page.typ": Buffer.from(text),
  });
}
function context(fetcher = vi.fn<typeof fetch>()): OpContext {
  const http = new WorkspaceHttp({
    origin: "http://workspace.test",
    cookie: "workspace_session=test",
    role: "client",
    fetcher,
  });
  const source = new WorkspaceContentSource(http);
  vi.spyOn(source, "resolveEditableRuntimeTarget").mockResolvedValue({
    origin: http.origin,
    unitId: "slide",
    unitType: "slide",
    revision: 1,
    scope: { kind: "worktree", worktreeId: "wt" },
  });
  return {
    userId: "owner",
    requestId: "compiler",
    signal: AbortSignal.timeout(30000),
    transportOrigin: http.origin,
    http: () => http,
    source: () => source,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData: vi.fn() },
    exchange: credentials,
    compileTypst: (files) =>
      runConversionJob(
        { kind: "typst.compile", bundle: files },
        credentials,
        new AbortController().signal,
        entry,
      ),
    materializer: {
      materialize: (input) =>
        runConversionJob(
          { kind: "markdown.materialize", ...input, format: "Typst" },
          credentials,
          AbortSignal.timeout(15000),
          entry,
        ),
    },
  };
}
it("validates target modes, page/add and Typst retry keys", () => {
  expect(typstCompileInput.safeParse({}).success).toBe(true);
  expect(typstCompileInput.safeParse({ idempotencyKey: "compile-only-key-123" }).success).toBe(true);
  const apply = { apply: true, worktreeId: "wt", spaceId: "space" };
  expect(typstCompileInput.safeParse(apply).success).toBe(true);
  for (const input of [
    { worktreeId: "wt" },
    { parentNodeId: "parent" },
    { ...apply, spaceId: undefined },
    { ...apply, idempotencyKey: "short" },
  ])
    expect(typstCompileInput.safeParse(input).success).toBe(false);
  expect(svgCompileInput.safeParse({ svg, page: 1, add: true }).success).toBe(true);
  for (const input of [
    { svg, add: true },
    { svg, page: 0 },
    { svg, worktreeId: "wt" },
    { svg, apply: true, page: 1, unitId: "slide" },
  ])
    expect(svgCompileInput.safeParse(input).success).toBe(false);
  expect(opSpecs["typst.compile"].effectFor?.({})).toBe("read");
  expect(
    opSpecs["svg.compile"].effectFor?.({
      svg,
      apply: true,
      page: 1,
      unitId: "slide",
      worktreeId: "wt",
    }),
  ).toBe("write");
});
it("compiles Typst in a job without creating or opening a Unit", async () => {
  const ctx = context();
  const result = await typstCompile(ctx, {}, bundle());
  expect(result.output).toMatchObject({
    committed: false,
    compiledTargetUnitId: "typst-test",
    javascript: expect.stringContaining("Hello"),
  });
  expect(ctx.runtime.executeAndCommit).not.toHaveBeenCalled();
}, 20000);
it("reports the facade's missing root typst.json error", async () => {
  await expect(
    typstCompile(context(), {}, zipSync({ "page.typ": Buffer.from("Hello") })),
  ).rejects.toMatchObject({
    code: "workspace-typst-invalid",
    message: expect.stringContaining("typst.json"),
  });
}, 20000);
it("preserves Typst translation diagnostics through the child and creates no Unit", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const ctx = context(fetcher);
  await expect(
    typstCompile(
      ctx,
      { apply: true, worktreeId: "wt", spaceId: "space" },
      bundle("#circle(radius: 10pt)"),
    ),
  ).rejects.toMatchObject({
    code: "workspace-typst-invalid",
    detail: { diagnostics: expect.any(Array) },
  });
  expect(fetcher).not.toHaveBeenCalled();
}, 20000);
it("rejects an existing Worktree Unit ID before materialization or creation", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({
    worktree: {
      id: "wt", name: "Draft", state: "draft",
      units: [{
        unitId: "typst-test", resourceId: "resource", nodeId: "node", name: "Existing Doc",
        source: "worktree", unitType: "doc", draftHeadRevision: 1, change: "added",
        mergeResult: "pending", activationState: "waitingForMerge",
        target: { spaceId: "space", parentNodeId: null },
      }],
    },
  }));
  const materialize = vi.fn();
  const ctx = { ...context(fetcher), materializer: { materialize }, onCreateUnit: vi.fn() };
  ctx.compileTypst = async () => ({ committed: false, javascript: "compiled()", title: "Report", targetUnitId: "typst-test", diagnostics: [], previews: [] });
  await expect(typstCompile(ctx, { apply: true, worktreeId: "wt", spaceId: "space" }, bundle())).rejects.toMatchObject({
    code: "workspace-argument-invalid",
    message: expect.stringContaining("targetUnitId is only a local compiler ID"),
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![1]?.method).toBe("GET");
  expect(materialize).not.toHaveBeenCalled();
  expect(ctx.onCreateUnit).not.toHaveBeenCalled();
  expect(ctx.usage.cost.committed_revisions).toBe(0);
});
it("materializes identical Typst create intents after a lost creation response", async () => {
  // Compilation is covered above; retry determinism needs two fresh native materializations.
  // Fixture is the real compiler output for bundle() with its default Hello/World source.
  const javascript = await readFile(
    new URL("./fixtures/typst-retry-program.txt", import.meta.url),
    "utf8",
  );
  const compiled = {
    committed: false,
    javascript,
    title: "Typst test",
    targetUnitId: "typst-test",
    diagnostics: [],
    previews: [],
  };
  const bodies: string[] = [];
  const keys: (string | null)[] = [];
  let confirmed = false;
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.method === "GET")
      return Response.json({ worktree: { id: "wt", name: "Draft", state: "draft", units: [] } });
    bodies.push(String(options?.body));
    keys.push(new Headers(options?.headers).get("idempotency-key"));
    if (!confirmed) throw new TypeError("lost response");
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
  const input = {
    apply: true,
    worktreeId: "wt",
    spaceId: "space",
    idempotencyKey: "typst-retry-12345678",
  };
  const ctx = context(fetcher);
  ctx.compileTypst = async () => compiled;
  await expect(typstCompile(ctx, input, bundle())).rejects.toMatchObject({
    code: "workspace-result-unknown",
  });
  confirmed = true;
  const retry = await typstCompile(ctx, input, bundle());
  expect(retry.output).toMatchObject({ committed: true, unit: { unitId: "created-once" } });
  expect(new Set(bodies).size).toBe(1);
  expect(new Set(keys).size).toBe(1);
  expect(bodies.length).toBeGreaterThan(1);
  expect(JSON.parse(bodies[0]!).initialData).toMatchObject({ id: "typst-test", rev: 1 });
  const typstKey = keys[0];
  keys.length = 0;
  // Only the key namespace matters here; Markdown has its own native retry test.
  const markdownContext = {
    ...context(fetcher),
    materializer: {
      materialize: async () => ({ initialData: { id: "markdown-test" } }),
    },
  };
  await markdownCompile(markdownContext, { ...input, markdown: "Hello" }, new Uint8Array());
  expect(keys[0]).not.toBe(typstKey);
  expect(typstKey).toBe(createHash("sha256").update(JSON.stringify(["owner", "compile_typst", input.idempotencyKey])).digest("hex"));
  expect(keys[0]).toBe(createHash("sha256").update(JSON.stringify(["owner", input.idempotencyKey])).digest("hex"));
}, 30000);

const manifest = { schemaVersion: 1, targetUnitId: "errors", pages: ["page.typ"] };
it.each([
  { name: "missing manifest", manifest: undefined, files: {}, path: "typst.json", problem: "not found" },
  { name: "malformed manifest", manifest: "{", files: {}, path: "typst.json", problem: "invalid JSON" },
  { name: "missing page", manifest: { ...manifest, pages: ["nope.typ"] }, files: {}, path: "nope.typ", problem: "not found" },
  { name: "directory page", manifest: { ...manifest, pages: ["folder"] }, files: { "folder/child.typ": "Hello" }, path: "folder", problem: "directory" },
  { name: "invalid page", manifest: { ...manifest, pages: [{ source: 42 }] }, files: {}, path: "typst.json", problem: "pages.0" },
  { name: "missing prelude", manifest: { ...manifest, prelude: ["nope.typ"] }, files: { "page.typ": "Hello" }, path: "nope.typ", problem: "not found" },
  { name: "directory prelude", manifest: { ...manifest, prelude: ["folder"] }, files: { "page.typ": "Hello", "folder/child.typ": "Hello" }, path: "folder", problem: "directory" },
  { name: "invalid prelude", manifest: { ...manifest, prelude: [42] }, files: { "page.typ": "Hello" }, path: "typst.json", problem: "prelude.0" },
  { name: "unsafe page", manifest: { ...manifest, pages: ["../escape.typ"] }, files: {}, path: "../escape.typ", problem: "unsafe" },
  { name: "unsafe prelude", manifest: { ...manifest, prelude: ["../escape.typ"] }, files: { "page.typ": "Hello" }, path: "../escape.typ", problem: "unsafe" },
])("reports actionable bundle errors for $name", async (fixture) => {
  const files = new Map(Object.entries(fixture.files).map(([path, text]) => [path, Buffer.from(text)]));
  if (fixture.manifest !== undefined)
    files.set("typst.json", Buffer.from(typeof fixture.manifest === "string" ? fixture.manifest : JSON.stringify(fixture.manifest)));
  try {
    await runConversionJob({ kind: "typst.compile", bundle: files }, credentials, AbortSignal.timeout(15000), entry);
    expect.fail("Invalid bundle should fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "workspace-typst-invalid", message: expect.stringContaining(fixture.path) });
    expect(error).toHaveProperty("message", expect.stringContaining(fixture.problem));
    const text = `${error} ${JSON.stringify(error)}`;
    expect(text).not.toContain(tmpdir());
    expect(text).not.toContain("univer-mcp-job-");
  }
}, 20000);

it.each(['#image("missing.png")', '#read("data.csv")'])("scrubs internal paths in real Typst diagnostics for %s", async (source) => {
  try {
    await typstCompile(context(), {}, bundle(source));
    expect.fail("Missing input should fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "workspace-typst-invalid", detail: { diagnostics: expect.any(Array) } });
    const text = `${error} ${JSON.stringify(error)}`;
    expect(text).toContain(source.includes("image") ? "missing.png" : "data.csv");
    expect(text).not.toContain(tmpdir());
    expect(text).not.toContain("univer-mcp-job-");
    expect(text).not.toContain("dac-typst-eval-");
  }
}, 20000);
it("reuses ZIP entry and size caps for both formats", async () => {
  const bytes = zipSync({ "large.bin": new Uint8Array(compilerSourceLimits.fileBytes + 1) });
  await expect(typstCompile(context(), {}, bytes)).rejects.toMatchObject({
    code: "workspace-argument-invalid",
  });
  await expect(svgCompile(context(), { svg, estimateTextSize: true }, bytes)).rejects.toMatchObject(
    { code: "workspace-argument-invalid" },
  );
});
it("retains the CLI estimation lint when estimation is requested", async () => {
  const ctx = context();
  const result = await svgCompile(ctx, { svg, estimateTextSize: true }, new Uint8Array());
  expect(result.output).toMatchObject({
    textMeasure: "builtin-estimate",
    lints: [expect.stringContaining("estimation")],
  });
  expect(ctx.usage).toEqual({ executor: "none", cost: { ...zeroCost } });
});
it("maps SVG facade input errors without an internal error", async () => {
  await expect(
    svgCompile(
      context(),
      { svg: "<svg><foreignObject/></svg>", estimateTextSize: true },
      new Uint8Array(),
    ),
  ).rejects.toMatchObject({ code: "workspace-svg-invalid" });
});
it.each([false, true])(
  "applies page 1 with add=%s through the bound runtime and counts its commit",
  async (add) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        worktree: {
          id: "wt",
          name: "Draft",
          description: "",
          state: "draft",
          createdAt: 1,
          updatedAt: 1,
          units: [],
          sourceSpaceId: "space",
        },
      }),
    );
    const ctx = context(fetcher);
    vi.mocked(ctx.runtime.executeAndCommit).mockResolvedValue({
      committed: true,
      revision: 2,
      status: "committed",
      value: null,
    });
    const result = await svgCompile(
      ctx,
      { svg, estimateTextSize: true, apply: true, page: 1, add, worktreeId: "wt", unitId: "slide" },
      new Uint8Array(),
    );
    expect(result.output).toMatchObject({
      mode: add ? "add" : "replace",
      page: 1,
      applied: { committed: true, revision: 2 },
    });
    expect(ctx.runtime.executeAndCommit).toHaveBeenCalledWith({
      target: expect.objectContaining({ unitType: "slide" }),
      code: expect.stringContaining("insertShape"),
    });
    expect(ctx.usage.cost.committed_revisions).toBe(1);
  },
);

it("rewrites successful child diagnostics and previews without changing the program", async () => {
  const result = await runConversionJob(
    { kind: "typst.compile", bundle: new Map() },
    credentials,
    AbortSignal.timeout(5000),
    new URL("./fixtures/job-diagnostics.mjs", import.meta.url),
  );
  expect(result.diagnostics).toEqual([{
    sourcePath: "nested/page.typ",
    reason: "file not found (searched at assets/missing.png)",
  }]);
  expect(result.previews).toEqual([{ pageId: "1", path: "preview.svg", sourcePath: "nested/page.typ" }]);
  expect(result.javascript).toBe('return "/user-authored/path";');
  expect(JSON.stringify({ diagnostics: result.diagnostics, previews: result.previews })).not.toContain(tmpdir());
  expect(JSON.stringify({ diagnostics: result.diagnostics, previews: result.previews })).not.toContain("univer-mcp-job-");
});

it("preserves slash-separated prose while redacting absolute job paths", async () => {
  const { conversionError, rewriteJobPaths } = await import("../src/executor/jobs/errors.js");
  const cases: [string, string][] = [
    ["expected xlsx / docx", "expected xlsx / docx"],
    ["width 1 / 2", "width 1 / 2"],
    ["failed at /tmp/x/y", "failed at [path]"],
    ["failed at /private/var/folders/secret/file.typ", "failed at [path]"],
    ["failed at /tmp/private path/file.typ", "failed at [path]"],
  ];
  for (const [text, expected] of cases) {
    expect(conversionError("INVALID_ARGUMENT", text).message).toBe(expected);
    expect(rewriteJobPaths({ message: text }, [])).toEqual({ message: expected });
  }
});
