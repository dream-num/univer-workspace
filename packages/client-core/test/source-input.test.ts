import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompileSvgOptions, CompileSvgResult } from "@univer-cli/svg-facade";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertWorkspaceSourceFiles } from "../src/files.js";
import {
  compileWorkspaceMarkdownFile,
  compileWorkspaceMarkdownSource,
  WorkspaceCompileMarkdownFeature,
  WorkspaceCompileSvgFeature,
  WorkspaceCompileTypstFeature,
  type WorkspaceSourceFiles,
} from "../src/index.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workspace-source-input-"));
  directories.push(path);
  return path;
}

async function writeTree(root: string, files: WorkspaceSourceFiles): Promise<void> {
  for (const [path, bytes] of files) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
}

async function outcome<Value>(run: () => Promise<Value>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    const diagnostics = (error as { diagnostics?: readonly { code: string }[] }).diagnostics;
    return { failed: diagnostics?.map(({ code }) => code) ?? error };
  }
}

describe("in-memory Markdown", () => {
  const markdown = "# Report\n\n![diagram](img/a.png)\n";
  const assets: WorkspaceSourceFiles = new Map([["img/a.png", png]]);
  const options = { targetUnitId: "markdown-source-test" };

  it("compiles exactly what the file variant compiles", async () => {
    const root = await directory();
    await writeTree(root, new Map([["report.md", new TextEncoder().encode(markdown)], ...assets]));
    const fromFile = await compileWorkspaceMarkdownFile(join(root, "report.md"), options);
    const fromMemory = await compileWorkspaceMarkdownSource(markdown, options, assets);
    expect(fromFile.diagnostics.some(({ severity }) => severity === "error")).toBe(false);
    expect(fromFile.javascript).toContain("image");
    expect(fromMemory).toEqual(fromFile);
  });

  it("fails a reference missing from the map like a missing file", async () => {
    const root = await directory();
    await writeFile(join(root, "report.md"), markdown);
    const fromFile = await outcome(() =>
      compileWorkspaceMarkdownFile(join(root, "report.md"), options),
    );
    const fromMemory = await outcome(() =>
      compileWorkspaceMarkdownSource(markdown, options, new Map()),
    );
    expect(fromFile).toMatchObject({ failed: expect.arrayContaining(["MARKDOWN_ASSET"]) });
    expect(fromMemory).toEqual(fromFile);
  });

  it("rejects an asset key that leaves the bundle, naming the key", async () => {
    await expect(
      compileWorkspaceMarkdownSource(markdown, options, new Map([["../a.png", png]])),
    ).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: expect.stringContaining("../a.png"),
    });
  });

  it("requires exactly one of file and markdown", async () => {
    const feature = new WorkspaceCompileMarkdownFeature({} as never);
    await expect(feature.execute({ file: "a.md", markdown: "x" } as never)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    await expect(feature.execute({} as never)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
  });

  it("runs the shared create path for in-memory input", async () => {
    const compiled = {
      formatVersion: 1 as const,
      targetUnitId: "doc",
      title: "T",
      javascript: "return {};",
      diagnostics: [],
      sourceMap: [],
    };
    const compileSource = vi.fn(async () => compiled);
    const feature = new WorkspaceCompileMarkdownFeature({
      compileSource,
      materializer: { materialize: vi.fn() },
      units: { create: vi.fn() },
      contentExecution: { execute: vi.fn() },
    });
    await expect(feature.execute({ markdown: "# T", assets })).resolves.toEqual({
      ...compiled,
      committed: false,
    });
    expect(compileSource).toHaveBeenCalledWith("# T", expect.any(Object), assets);
  });
});

describe("in-memory SVG", () => {
  const svg = '<svg><image href="img/a.png"/></svg>';
  const compiled: CompileSvgResult = {
    code: "raw();",
    lints: [],
    textMeasure: "builtin-estimate",
    viewport: { height: 10, width: 10 },
    warnings: [],
  };

  function feature(seen: (options: CompileSvgOptions | undefined) => void) {
    return new WorkspaceCompileSvgFeature({
      compile: async (_svg, options) => {
        seen(options);
        return compiled;
      },
      contentExecution: { executeSlide: vi.fn() },
      env: {},
      license: "",
      renderPageRoot: "",
    });
  }

  it("resolves assets like the file variant", async () => {
    const root = await directory();
    await writeTree(root, new Map([["img/a.png", png]]));
    await writeFile(join(root, "page.svg"), svg);
    const bytes: number[][] = [];
    const remember = (options: CompileSvgOptions | undefined) =>
      bytes.push([...(options?.assetResolver?.("img/a.png").bytes ?? [])]);
    const fromFile = await feature(remember).compile({ file: join(root, "page.svg") });
    const fromMemory = await feature(remember).compile({
      svg,
      assets: new Map([["img/a.png", png]]),
    });
    expect(fromMemory).toEqual(fromFile);
    expect(bytes[1]).toEqual(bytes[0]);
  });

  it("fails a missing asset with ENOENT like a missing file and validates keys", async () => {
    const resolve = (options: CompileSvgOptions | undefined) => options?.assetResolver?.("x.png");
    await expect(feature(resolve).compile({ svg })).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      feature(resolve).compile({ svg, assets: new Map([["/abs.png", png]]) }),
    ).rejects.toMatchObject({ code: "workspace-argument-invalid" });
  });
});

describe("in-memory Typst bundle", () => {
  const files: WorkspaceSourceFiles = new Map([
    [
      "typst.json",
      new TextEncoder().encode(
        JSON.stringify({
          pages: ["pages/one.typ"],
          schemaVersion: 1,
          targetUnitId: "typst-source-test",
          title: "Paper",
        }),
      ),
    ],
    ["pages/one.typ", new TextEncoder().encode("= Hello\n\nWorld")],
  ]);
  const dependencies = { materializer: { materialize: vi.fn() }, units: { list: vi.fn(), create: vi.fn() } };

  it("compiles exactly what the directory variant compiles", async () => {
    const root = await directory();
    await writeTree(root, files);
    const feature = new WorkspaceCompileTypstFeature(dependencies);
    const fromPath = await feature.execute({ bundlePath: root });
    const fromMemory = await feature.execute({ bundle: files });
    expect(fromPath.diagnostics).toEqual([]);
    expect(fromMemory.javascript).toBe(fromPath.javascript);
    expect(fromMemory.diagnostics).toEqual(fromPath.diagnostics);
  }, 30_000);

  it("removes its private directory after success and after a compiler failure", async () => {
    const seen: string[] = [];
    const ok = new WorkspaceCompileTypstFeature({
      ...dependencies,
      compile: async (path) => {
        seen.push(path);
        await access(join(path, "pages/one.typ"));
        return { diagnostics: [], javascript: "", previews: [], targetUnitId: "t", title: "T" };
      },
    });
    await ok.execute({ bundle: files });
    const failing = new WorkspaceCompileTypstFeature({
      ...dependencies,
      compile: async (path) => {
        seen.push(path);
        throw new Error("boom");
      },
    });
    await expect(failing.execute({ bundle: files })).rejects.toThrow("boom");
    expect(seen).toHaveLength(2);
    for (const path of seen) await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects previewDir with a bundle, bad keys, and ambiguous sources", async () => {
    const compile = vi.fn();
    const feature = new WorkspaceCompileTypstFeature({ ...dependencies, compile });
    await expect(feature.execute({ bundle: files, previewDir: "p" })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    await expect(
      feature.execute({ bundle: new Map([["a/../b.typ", new Uint8Array()]]) }),
    ).rejects.toMatchObject({ code: "workspace-argument-invalid" });
    await expect(
      feature.execute({ bundle: files, bundlePath: "x" } as never),
    ).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    expect(compile).not.toHaveBeenCalled();
  });
});

describe("source file set collisions", () => {
  const keys = (...names: string[]): WorkspaceSourceFiles =>
    new Map(names.map((name) => [name, new Uint8Array()]));

  it.each([
    [["main.typ", "Main.typ"]],
    [["caf\u00e9.typ", "cafe\u0301.typ"]],
    [["a", "a/b"]],
    [["a/b/c.png", "A/B"]],
  ])("rejects %j naming both keys", (names) => {
    expect(() => assertWorkspaceSourceFiles(keys(...names))).toThrow(
      expect.objectContaining({
        code: "workspace-argument-invalid",
        message: expect.stringContaining(JSON.stringify(names[0])),
      }),
    );
    expect(() => assertWorkspaceSourceFiles(keys(...names))).toThrow(
      expect.objectContaining({ message: expect.stringContaining(JSON.stringify(names[1])) }),
    );
  });

  it("accepts siblings that only share a name prefix", () => {
    expect(() => assertWorkspaceSourceFiles(keys("a.png", "a/b.png", "img/a.png"))).not.toThrow();
  });
});
