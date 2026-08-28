import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  WorkspaceApplySvgResult,
  WorkspaceCompileSvgFeature,
  WorkspaceCompileSvgResult,
} from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceCompileSvgCommand } from "../src/features/svg/command.js";

const temporaryDirectories: string[] = [];
const compiled: WorkspaceCompileSvgResult = {
  code: "generated();",
  lints: ["lint-1"],
  mode: "replace",
  page: 2,
  textMeasure: "builtin-estimate",
  viewport: { height: 540, width: 960 },
  warnings: ["warning-1"],
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Workspace compile-svg command", () => {
  it("maps command options to Core and presents complete JSON without duplicate diagnostics", async () => {
    const applyResult: WorkspaceApplySvgResult = {
      ...compiled,
      applied: { committed: true, revision: 9, status: "ready", value: null },
    };
    const compile = vi.fn(async () => compiled);
    const apply = vi.fn(async () => applyResult);
    const harness = createHarness({ apply, compile });

    await harness.command.parseAsync(
      [
        " page.svg ",
        "--estimate-text-size",
        "--page",
        "2",
        "--add",
        "--apply",
        "--worktree",
        " wt-1 ",
        "--unit",
        " deck-1 ",
        "--json",
      ],
      { from: "user" },
    );

    expect(compile).toHaveBeenCalledWith({
      add: true,
      estimateTextSize: true,
      file: " page.svg ",
      page: 2,
    });
    expect(apply).toHaveBeenCalledWith({
      compiled,
      unitId: " deck-1 ",
      worktreeId: " wt-1 ",
    });
    expect(harness.out.join("")).toBe(`${JSON.stringify(applyResult, null, 2)}\n`);
    expect(harness.err).toEqual([]);
  });

  it("writes generated code before apply and keeps text presentation", async () => {
    const directory = temporaryDirectory();
    const outPath = join(directory, "program.js");
    const compile = vi.fn(async () => compiled);
    const apply = vi.fn(async () => {
      expect(readFileSync(outPath, "utf8")).toBe("generated();\n");
      return {
        ...compiled,
        applied: { committed: false, value: null },
      } satisfies WorkspaceApplySvgResult;
    });
    const harness = createHarness({ apply, compile });

    await harness.command.parseAsync(
      [
        "page.svg",
        "--page",
        "2",
        "--out",
        outPath,
        "--apply",
        "--worktree",
        "wt-1",
        "--unit",
        "deck-1",
      ],
      { from: "user" },
    );

    expect(harness.err).toEqual(["warning: warning-1\n", "lint: lint-1\n"]);
    expect(harness.out.join("")).toBe(
      `generated code: ${outPath}\napplied page 2 (replace); no mutation committed\n`,
    );
  });

  it("does not apply when output writing fails", async () => {
    const directory = temporaryDirectory();
    const compile = vi.fn(async () => compiled);
    const apply = vi.fn();
    const harness = createHarness({ apply, compile });

    await expect(
      harness.command.parseAsync(
        [
          "page.svg",
          "--page",
          "2",
          "--out",
          join(directory, "missing", "program.js"),
          "--apply",
          "--worktree",
          "wt-1",
          "--unit",
          "deck-1",
        ],
        { from: "user" },
      ),
    ).rejects.toMatchObject({ code: "workspace.command.failed" });
    expect(compile).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([
    [["page.svg", "--page", "0"], "commander.invalidArgument"],
    [["page.svg", "--add"], "workspace-argument-invalid"],
    [["page.svg", "--out", "program.js"], "workspace-argument-invalid"],
    [["page.svg", "--apply"], "workspace-argument-invalid"],
    [["page.svg", "--worktree", "wt-1"], "workspace-argument-invalid"],
  ] as const)("retains validation for %j", async (argv, code) => {
    const compile = vi.fn();
    const harness = createHarness({ compile });

    await expect(harness.command.parseAsync([...argv], { from: "user" })).rejects.toMatchObject({
      code,
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("prints raw code when no page or output is selected", async () => {
    const raw = { ...compiled, code: "raw();", page: undefined };
    const harness = createHarness({ compile: vi.fn(async () => raw) });

    await harness.command.parseAsync(["page.svg"], { from: "user" });

    expect(harness.out.join("")).toBe("raw();\n");
  });
});

function createHarness(
  overrides: Partial<Pick<WorkspaceCompileSvgFeature, "apply" | "compile">> = {},
): { readonly command: Command; readonly err: string[]; readonly out: string[] } {
  const err: string[] = [];
  const out: string[] = [];
  const command = createWorkspaceCompileSvgCommand({
    apply: vi.fn(),
    compile: vi.fn(async () => compiled),
    ...overrides,
  });
  command.exitOverride();
  command.configureOutput({
    writeErr: (value) => err.push(value),
    writeOut: (value) => out.push(value),
  });
  return { command, err, out };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "workspace-compile-svg-"));
  temporaryDirectories.push(directory);
  return directory;
}
