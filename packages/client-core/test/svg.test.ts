import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SvgFacadeError, type CompileSvgOptions, type CompileSvgResult } from "@univer-cli/svg-facade";
import { UniverRenderError, type UniverTextMeasureRuntime } from "@univer-cli/univer-render-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  workspaceError,
  projectWorkspaceSvgDependencyCode,
  WorkspaceApplicationError,
  WorkspaceCompileSvgFeature,
  type WorkspaceCompileSvgDependencies,
} from "../src/index.js";

const temporaryDirectories: string[] = [];
const compiled: CompileSvgResult = {
  code: "raw();",
  lints: ["lint-1"],
  textMeasure: "univer-render-runtime",
  viewport: { height: 540, width: 960 },
  warnings: ["warning-1"],
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Workspace SVG compilation", () => {
  it("projects only exact SVG facade and browser dependency constructors", () => {
    expect(projectWorkspaceSvgDependencyCode(new SvgFacadeError("private-svg-sentinel")))
      .toBe("SVG_FACADE_COMPILE_FAILED");
    expect(projectWorkspaceSvgDependencyCode(
      new UniverRenderError("BROWSER_UNAVAILABLE", "private-browser-sentinel"),
    )).toBe("BROWSER_UNAVAILABLE");
    for (const forged of [
      { code: "SVG_FACADE_COMPILE_FAILED", name: "SvgFacadeError" },
      { code: "BROWSER_UNAVAILABLE", name: "UniverRenderError" },
      new WorkspaceApplicationError("BROWSER_UNAVAILABLE", "private-forged-sentinel"),
    ]) expect(projectWorkspaceSvgDependencyCode(forged)).toBeUndefined();
  });
  it("reads UTF-8 source and nested assets relative to the SVG exactly once", async () => {
    const directory = temporaryDirectory();
    const sourceDirectory = join(directory, "nested");
    mkdirSync(join(sourceDirectory, "assets"), { recursive: true });
    mkdirSync(join(directory, "shared"));
    const file = join(sourceDirectory, "page.svg");
    writeFileSync(file, '<svg><text>世界</text><image href="assets/a.bin"/></svg>');
    writeFileSync(join(sourceDirectory, "assets/a.bin"), Uint8Array.from([1, 2]));
    writeFileSync(join(directory, "shared/b.bin"), Uint8Array.from([3, 4]));
    const compile = vi.fn(async (svg: string, options?: CompileSvgOptions) => {
      expect(svg).toContain("世界");
      expect([...Array.from(options?.assetResolver?.("assets/a.bin").bytes ?? [])]).toEqual([1, 2]);
      expect([...Array.from(options?.assetResolver?.("../shared/b.bin").bytes ?? [])]).toEqual([
        3,
        4,
      ]);
      return compiled;
    });
    const createRuntime = vi.fn();
    const feature = createFeature({ compile, createRuntime });

    const result = await feature.compile({ file });

    expect(compile).toHaveBeenCalledOnce();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(result).toEqual({ ...compiled, mode: "replace", page: undefined });
    expect(result.warnings).toBe(compiled.warnings);
    expect(result.lints).toBe(compiled.lints);
  });

  it("confines source and assets to the canonical root and counts aggregate actual bytes", async () => {
    const directory = temporaryDirectory();
    const sourceDirectory = join(directory, "nested");
    mkdirSync(sourceDirectory);
    const file = join(sourceDirectory, "page.svg");
    const source = '<svg><image href="asset.bin"/></svg>';
    writeFileSync(file, source);
    writeFileSync(join(sourceDirectory, "asset.bin"), Uint8Array.from([1, 2, 3]));
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      expect([...Array.from(options?.assetResolver?.("asset.bin").bytes ?? [])]).toEqual([1, 2, 3]);
      return compiled;
    });
    const feature = createFeature({ compile });

    await expect(feature.compile({
      file,
      localRoot: directory,
      maxAssetBytes: 3,
      maxSourceBytes: Buffer.byteLength(source),
    })).resolves.toMatchObject({ code: "raw();" });
    await expect(feature.compile({
      file,
      localRoot: directory,
      maxAssetBytes: 2,
      maxSourceBytes: Buffer.byteLength(source),
    })).rejects.toMatchObject({
      code: "workspace-svg-limit-exceeded",
      detail: { actual: 3, kind: "asset", limit: 2 },
    });
  });

  it("rejects source and asset symlink escapes without consuming them", async () => {
    const directory = temporaryDirectory();
    const outside = temporaryDirectory();
    const sourceOutside = join(outside, "outside.svg");
    writeFileSync(sourceOutside, "<svg/>");
    const sourceLink = join(directory, "source.svg");
    symlinkSync(sourceOutside, sourceLink);
    const feature = createFeature({ compile: vi.fn(async () => compiled) });

    await expect(feature.compile({ file: sourceLink, localRoot: directory })).rejects.toMatchObject({
      code: "workspace-svg-input-outside-root",
    });

    const file = join(directory, "page.svg");
    const assetOutside = join(outside, "asset.bin");
    writeFileSync(file, "<svg/>");
    writeFileSync(assetOutside, "secret");
    symlinkSync(assetOutside, join(directory, "asset.bin"));
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      options?.assetResolver?.("asset.bin");
      return compiled;
    });
    await expect(createFeature({ compile }).compile({ file, localRoot: directory })).rejects.toMatchObject({
      code: "workspace-svg-input-outside-root",
    });
  });

  it("preserves stable source and asset symlinks contained by the canonical root", async () => {
    const directory = temporaryDirectory();
    const source = join(directory, "source.svg");
    const sourceTarget = join(directory, "source-target.svg");
    const asset = join(directory, "asset.bin");
    const assetTarget = join(directory, "asset-target.bin");
    writeFileSync(sourceTarget, '<svg><image href="asset.bin"/></svg>');
    writeFileSync(assetTarget, "inside");
    symlinkSync(sourceTarget, source);
    symlinkSync(assetTarget, asset);
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      expect(options?.assetResolver?.("asset.bin").bytes.toString()).toBe("inside");
      return compiled;
    });
    await expect(createFeature({ compile }).compile({ file: source, localRoot: directory }))
      .resolves.toMatchObject({ code: "raw();" });
  });

  it("fails closed when a canonical file is replaced between validation and open", async () => {
    const directory = temporaryDirectory();
    const file = join(directory, "page.svg");
    writeFileSync(file, "<svg/>");
    const signal = signalAtCheck(4, () => {
      renameSync(file, `${file}.old`);
      writeFileSync(file, "<svg><text>replacement</text></svg>");
    });
    const compile = vi.fn();

    await expect(createFeature({ compile }).compile({ file, localRoot: directory, signal })).rejects.toMatchObject({
      code: "workspace-svg-source-unavailable",
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("rejects source and asset replacement with an outside symlink after realpath", async () => {
    const directory = temporaryDirectory();
    const outside = temporaryDirectory();
    const file = join(directory, "page.svg");
    const outsideSource = join(outside, "outside.svg");
    writeFileSync(file, "<svg/>");
    writeFileSync(outsideSource, "<svg><text>outside</text></svg>");
    const sourceSignal = signalAtCheck(3, () => {
      renameSync(file, `${file}.old`);
      symlinkSync(outsideSource, file);
    });
    const sourceCompile = vi.fn();
    await expect(createFeature({ compile: sourceCompile }).compile({
      file,
      localRoot: directory,
      signal: sourceSignal,
    })).rejects.toMatchObject({ code: "workspace-svg-source-unavailable" });
    expect(sourceCompile).not.toHaveBeenCalled();

    rmSync(file);
    writeFileSync(file, '<svg><image href="asset.bin"/></svg>');
    const asset = join(directory, "asset.bin");
    const outsideAsset = join(outside, "outside.bin");
    writeFileSync(asset, "inside");
    writeFileSync(outsideAsset, "outside");
    const assetSignal = signalAtCheck(11, () => {
      renameSync(asset, `${asset}.old`);
      symlinkSync(outsideAsset, asset);
    });
    const assetCompile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      options?.assetResolver?.("asset.bin");
      return compiled;
    });
    await expect(createFeature({ compile: assetCompile }).compile({
      file,
      localRoot: directory,
      signal: assetSignal,
    })).rejects.toMatchObject({ code: "workspace-svg-asset-unavailable" });
    expect(assetCompile).toHaveBeenCalledOnce();
  });

  it("uses actual descriptor bytes for growth, shrink, and exact source boundaries", async () => {
    const directory = temporaryDirectory();
    const file = join(directory, "page.svg");
    const original = "<svg/>";
    writeFileSync(file, original);
    const feature = createFeature({ compile: vi.fn(async () => compiled) });

    await expect(feature.compile({
      file,
      localRoot: directory,
      maxSourceBytes: Buffer.byteLength(original),
    })).resolves.toMatchObject({ code: "raw();" });

    const growSignal = signalAtCheck(4, () => {
      appendFileSync(file, "x");
    });
    await expect(feature.compile({
      file,
      localRoot: directory,
      maxSourceBytes: Buffer.byteLength(original),
      signal: growSignal,
    })).rejects.toMatchObject({
      code: "workspace-svg-limit-exceeded",
      detail: { actual: Buffer.byteLength(original) + 1, kind: "source", limit: Buffer.byteLength(original) },
    });

    writeFileSync(file, original);
    const shrinkSignal = signalAtCheck(4, () => {
      truncateSync(file, 3);
    });
    await expect(feature.compile({
      file,
      localRoot: directory,
      maxSourceBytes: 3,
      signal: shrinkSignal,
    })).resolves.toMatchObject({
      code: "raw();",
    });
  });

  it("propagates unreadable source before compiler or browser creation", async () => {
    const compile = vi.fn();
    const createRuntime = vi.fn();
    const feature = createFeature({ compile, createRuntime });

    await expect(feature.compile({ file: join(temporaryDirectory(), "missing.svg") })).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(compile).not.toHaveBeenCalled();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("starts no source, compiler, or browser work when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const compile = vi.fn();
    const createRuntime = vi.fn();

    await expect(createFeature({ compile, createRuntime }).compile({
      file: join(temporaryDirectory(), "missing.svg"),
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(compile).not.toHaveBeenCalled();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("propagates unreadable assets without retry", async () => {
    const file = writeSvg("<svg/>");
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      options?.assetResolver?.("missing.png");
      return compiled;
    });
    const feature = createFeature({ compile });

    await expect(feature.compile({ file })).rejects.toMatchObject({ code: "ENOENT" });
    expect(compile).toHaveBeenCalledOnce();
  });

  it("reads no later asset after cancellation becomes visible", async () => {
    const directory = temporaryDirectory();
    const file = join(directory, "page.svg");
    writeFileSync(file, "<svg/>");
    writeFileSync(join(directory, "first.bin"), "1");
    writeFileSync(join(directory, "second.bin"), "2");
    const controller = new AbortController();
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      options?.assetResolver?.("first.bin");
      controller.abort();
      options?.assetResolver?.("second.bin");
      return compiled;
    });

    await expect(createFeature({ compile }).compile({
      file,
      localRoot: directory,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(compile).toHaveBeenCalledOnce();
  });

  it("uses raw compiler code and fields without a page wrapper", async () => {
    const wrap = vi.fn();
    const feature = createFeature({ compile: vi.fn(async () => compiled), wrap });

    const result = await feature.compile({ file: writeSvg("<svg/>") });

    expect(result.code).toBe(compiled.code);
    expect(result.viewport).toBe(compiled.viewport);
    expect(wrap).not.toHaveBeenCalled();
  });

  it("lazily reuses one real-font runtime across lines and awaits close", async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const close = vi.fn(async () => await closeGate);
    const measureText = vi.fn(async () => ({
      actualHeight: 13,
      actualWidth: 21,
      firstLineAscent: 10,
      firstLineDescent: 3,
      lineCount: 1,
    }));
    const createRuntime = vi.fn(async () => ({ close, measureText }));
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      expect(createRuntime).not.toHaveBeenCalled();
      await options?.textMeasurer?.measureLine({ runs: [run("first")] });
      await options?.textMeasurer?.measureLine({ runs: [run("second")] });
      return { ...compiled, textMeasure: options?.textMeasurer?.source ?? "missing" };
    });
    const feature = createFeature({ compile, createRuntime });

    let settled = false;
    const operation = feature.compile({ file: writeSvg("<svg/>") }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    releaseClose();

    await expect(operation).resolves.toMatchObject({ textMeasure: "univer-render-runtime" });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledWith({
      env: {},
      license: "test-license",
      renderPageRoot: "/render-runtime",
    });
    expect(measureText).toHaveBeenCalledTimes(2);
  });

  it("uses deterministic estimation with one appended lint and no browser", async () => {
    const createRuntime = vi.fn();
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => ({
      ...compiled,
      textMeasure: options?.textMeasurer?.source ?? "missing",
    }));
    const feature = createFeature({ compile, createRuntime });

    const first = await feature.compile({ estimateTextSize: true, file: writeSvg("<svg/>") });
    const second = await feature.compile({ estimateTextSize: true, file: writeSvg("<svg/>") });

    expect(first).toEqual(second);
    expect(first.textMeasure).toBe("builtin-estimate");
    expect(first.lints).toEqual([
      "lint-1",
      expect.stringContaining("--estimate-text-size"),
    ]);
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it.each(["compiler", "measurement"] as const)(
    "closes the runtime once after %s failure and preserves the primary failure",
    async (failurePoint) => {
      const failure = new Error(`${failurePoint} failed`);
      const close = vi.fn(async () => undefined);
      const measureText = vi.fn(async () => {
        if (failurePoint === "measurement") throw failure;
        return {
          actualHeight: 13,
          actualWidth: 21,
          firstLineAscent: 10,
          firstLineDescent: 3,
          lineCount: 1,
        };
      });
      const runtime: UniverTextMeasureRuntime = { close, measureText };
      const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
        await options?.textMeasurer?.measureLine({ runs: [run("text")] });
        throw failure;
      });
      const feature = createFeature({ compile, createRuntime: async () => runtime });

      await expect(feature.compile({ file: writeSvg("<svg/>") })).rejects.toBe(failure);
      expect(close).toHaveBeenCalledOnce();
      expect(compile).toHaveBeenCalledOnce();
    },
  );

  it("propagates runtime creation failure without fallback or close", async () => {
    const failure = new Error("runtime failed");
    const compile = vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
      await options?.textMeasurer?.measureLine({ runs: [run("text")] });
      return compiled;
    });
    const feature = createFeature({
      compile,
      createRuntime: async () => {
        throw failure;
      },
    });

    await expect(feature.compile({ file: writeSvg("<svg/>") })).rejects.toBe(failure);
    expect(compile).toHaveBeenCalledOnce();
  });

  it("observes cancellation after compiler and measurement settlement before later work", async () => {
    const compilerController = new AbortController();
    const wrap = vi.fn();
    const compiling = createFeature({
      compile: vi.fn(async () => {
        compilerController.abort();
        return compiled;
      }),
      wrap,
    });
    await expect(compiling.compile({
      file: writeSvg("<svg/>"),
      page: 1,
      signal: compilerController.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(wrap).not.toHaveBeenCalled();

    const measureController = new AbortController();
    const close = vi.fn(async () => undefined);
    const measuring = createFeature({
      compile: vi.fn(async (_svg: string, options?: CompileSvgOptions) => {
        await options?.textMeasurer?.measureLine({ runs: [run("text")] });
        return compiled;
      }),
      createRuntime: vi.fn(async (options) => {
        expect(options.signal).toBe(measureController.signal);
        return {
          close,
          measureText: async () => {
            measureController.abort();
            return {
              actualHeight: 13,
              actualWidth: 21,
              firstLineAscent: 10,
              firstLineDescent: 3,
              lineCount: 1,
            };
          },
        };
      }),
    });
    await expect(measuring.compile({
      file: writeSvg("<svg/>"),
      signal: measureController.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("forwards apply cancellation and value limits once while preserving result unknown", async () => {
    const failure = workspaceError("workspace-result-unknown", "commit result is unknown");
    const executeSlide = vi.fn(async () => {
      throw failure;
    });
    const feature = createFeature({ contentExecution: { executeSlide } });
    const controller = new AbortController();

    await expect(feature.apply({
      compiled: { ...compiled, mode: "replace", page: 1 },
      maxValueBytes: 123,
      maxValueDepth: 7,
      signal: controller.signal,
      unitId: "deck-1",
      worktreeId: "wt-1",
    })).rejects.toBe(failure);
    expect(executeSlide).toHaveBeenCalledOnce();
    expect(executeSlide).toHaveBeenCalledWith({
      code: "raw();",
      maxValueBytes: 123,
      maxValueDepth: 7,
      signal: controller.signal,
      unitId: "deck-1",
      worktreeId: "wt-1",
    });
  });

  it.each([
    [false, "replace"],
    [true, "add"],
  ] as const)("wraps page once in %s mode and applies the same program", async (add, mode) => {
    const compile = vi.fn(async () => compiled);
    const wrap = vi.fn(() => "wrapped();");
    const applied = {
      committed: true,
      revision: 9,
      status: "ready",
      value: null,
    } as const;
    const executeSlide = vi.fn(async () => applied);
    const feature = createFeature({
      compile,
      contentExecution: { executeSlide },
      wrap,
    });

    const compiledPage = await feature.compile({
      add,
      file: writeSvg("<svg/>"),
      page: 2,
    });
    const result = await feature.apply({
      compiled: compiledPage,
      unitId: "deck-1",
      worktreeId: "wt-1",
    });

    expect(compile).toHaveBeenCalledOnce();
    expect(wrap).toHaveBeenCalledOnce();
    expect(wrap).toHaveBeenCalledWith("raw();", {
      height: 540,
      mode,
      page: 2,
      width: 960,
    });
    expect(compiledPage).toMatchObject({ code: "wrapped();", mode, page: 2 });
    expect(executeSlide).toHaveBeenCalledOnce();
    expect(executeSlide).toHaveBeenCalledWith({
      code: "wrapped();",
      unitId: "deck-1",
      worktreeId: "wt-1",
    });
    expect(result).toEqual({ ...compiledPage, applied });
  });

  it("preserves a successful no-mutation apply result without replay", async () => {
    const compile = vi.fn(async () => compiled);
    const applied = { committed: false, value: null } as const;
    const executeSlide = vi.fn(async () => applied);
    const feature = createFeature({
      compile,
      contentExecution: { executeSlide },
      wrap: () => "wrapped();",
    });
    const compiledPage = await feature.compile({ file: writeSvg("<svg/>"), page: 1 });

    await expect(
      feature.apply({ compiled: compiledPage, unitId: "deck-1", worktreeId: "wt-1" }),
    ).resolves.toEqual({ ...compiledPage, applied });
    expect(compile).toHaveBeenCalledOnce();
    expect(executeSlide).toHaveBeenCalledOnce();
  });

  it("propagates wrapper and execution failures without replay", async () => {
    const wrapFailure = new Error("wrap failed");
    const executionFailure = new Error("execution failed");
    const compile = vi.fn(async () => compiled);
    const executeSlide = vi.fn(async () => {
      throw executionFailure;
    });
    const wrapping = createFeature({
      compile,
      contentExecution: { executeSlide },
      wrap: () => {
        throw wrapFailure;
      },
    });

    await expect(
      wrapping.compile({ file: writeSvg("<svg/>"), page: 1 }),
    ).rejects.toBe(wrapFailure);
    expect(compile).toHaveBeenCalledOnce();
    expect(executeSlide).not.toHaveBeenCalled();

    const applying = createFeature({
      compile,
      contentExecution: { executeSlide },
      wrap: () => "wrapped();",
    });
    const compiledPage = await applying.compile({ file: writeSvg("<svg/>"), page: 1 });
    await expect(
      applying.apply({ compiled: compiledPage, unitId: "deck-1", worktreeId: "wt-1" }),
    ).rejects.toBe(executionFailure);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(executeSlide).toHaveBeenCalledOnce();
  });
});

function createFeature(
  overrides: Partial<WorkspaceCompileSvgDependencies> = {},
): WorkspaceCompileSvgFeature {
  return new WorkspaceCompileSvgFeature({
    contentExecution: { executeSlide: vi.fn() },
    env: {},
    license: "test-license",
    renderPageRoot: "/render-runtime",
    ...overrides,
  });
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "workspace-svg-core-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeSvg(svg: string): string {
  const file = join(temporaryDirectory(), "page.svg");
  writeFileSync(file, svg, "utf8");
  return file;
}

function run(text: string) {
  return { bold: false, fontSizePx: 16, italic: false, text };
}

function signalAtCheck(check: number, effect: () => void): AbortSignal {
  const signal = new AbortController().signal;
  let checks = 0;
  Object.defineProperty(signal, "throwIfAborted", {
    value: () => {
      checks += 1;
      if (checks === check) effect();
    },
  });
  return signal;
}
