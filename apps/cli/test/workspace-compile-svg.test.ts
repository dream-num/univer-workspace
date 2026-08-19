import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UniverTextMeasureRuntime } from "@univer-cli/univer-render-runtime";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceCompileSvgCommand } from "../src/features/svg/command.js";
import { UNIVER_LICENSE } from "../src/license.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Workspace compile-svg command", () => {
  it("does not start a render runtime for an SVG without text", async () => {
    const createRuntime = vi.fn();
    const harness = createHarness({ createRuntime });

    await harness.command.parseAsync([writeSvg('<svg><rect width="10" height="20"/></svg>')], {
      from: "user",
    });

    expect(createRuntime).not.toHaveBeenCalled();
    expect(harness.out.join("")).toContain("slide.insertShape(");
  });

  it("uses and closes one lazily-created render runtime for exact text metrics", async () => {
    const close = vi.fn(async () => undefined);
    const measureText = vi.fn(async () => ({
      actualHeight: 24,
      actualWidth: 44,
      firstLineAscent: 18,
      firstLineDescent: 6,
      lineCount: 1,
    }));
    const runtime: UniverTextMeasureRuntime = { close, measureText };
    const createRuntime = vi.fn(async () => runtime);
    const harness = createHarness({ createRuntime });

    await harness.command.parseAsync(
      [writeSvg('<svg><text x="10" y="30">Hello</text></svg>'), "--json"],
      { from: "user" },
    );

    expect(createRuntime).toHaveBeenCalledWith({
      renderPageRoot: "/render-runtime",
      env: {},
        license: UNIVER_LICENSE,
    });
    expect(measureText).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(harness.out.join(""))).toMatchObject({
      textMeasure: "univer-render-runtime",
    });
  });

  it("uses explicit estimation without starting a render runtime", async () => {
    const createRuntime = vi.fn();
    const harness = createHarness({ createRuntime });

    await harness.command.parseAsync(
      [writeSvg('<svg><text x="10" y="30">Hello</text></svg>'), "--estimate-text-size", "--json"],
      { from: "user" },
    );

    expect(createRuntime).not.toHaveBeenCalled();
    const result = JSON.parse(harness.out.join("")) as {
      readonly lints: readonly string[];
      readonly textMeasure: string;
    };
    expect(result.textMeasure).toBe("builtin-estimate");
    expect(result.lints.some((lint) => lint.includes("--estimate-text-size"))).toBe(true);
  });

  it("wraps and applies one page through the Slide-only application seam", async () => {
    const executeSlide = vi.fn(async () => ({
      committed: true,
      revision: 9,
      status: "ready",
      value: null,
    }));
    const harness = createHarness({ executeSlide });

    await harness.command.parseAsync(
      [
        writeSvg('<svg viewBox="0 0 960 540"><rect width="10" height="20"/></svg>'),
        "--estimate-text-size",
        "--page",
        "2",
        "--apply",
        "--worktree",
        "wt-1",
        "--unit",
        "deck-1",
        "--json",
      ],
      { from: "user" },
    );

    expect(executeSlide).toHaveBeenCalledWith({
      code: expect.stringContaining("presentation.setPageSize({ width: 960, height: 540 });"),
      unitId: "deck-1",
      worktreeId: "wt-1",
    });
    expect(JSON.parse(harness.out.join(""))).toMatchObject({
      applied: { committed: true, revision: 9, status: "ready" },
      mode: "replace",
      page: 2,
    });
  });
});

function createHarness(
  overrides: Partial<Parameters<typeof createWorkspaceCompileSvgCommand>[0]> = {},
): { readonly command: Command; readonly err: string[]; readonly out: string[] } {
  const err: string[] = [];
  const out: string[] = [];
  const command = createWorkspaceCompileSvgCommand({
    renderPageRoot: "/render-runtime",
    env: {},
    executeSlide: vi.fn(),
    ...overrides,
  });
  command.exitOverride();
  command.configureOutput({
    writeErr: (value) => err.push(value),
    writeOut: (value) => out.push(value),
  });
  return { command, err, out };
}

function writeSvg(svg: string): string {
  const directory = mkdtempSync(join(tmpdir(), "workspace-compile-svg-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "page.svg");
  writeFileSync(file, svg, "utf8");
  return file;
}
