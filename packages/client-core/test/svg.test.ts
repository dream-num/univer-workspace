import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompileSvgOptions, CompileSvgResult } from "@univer-cli/svg-facade";
import type { UniverTextMeasureRuntime } from "@univer-cli/univer-render-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
