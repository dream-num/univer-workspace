import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  WorkspaceCompileTypstInput,
  WorkspaceCompileTypstResult,
} from "@univerjs/univer-workspace-client-core";
import type { OutputConfiguration } from "commander";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceCompileTypstCommand } from "../src/features/typst/command.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { force: true, recursive: true })),
  );
});

const compiled: WorkspaceCompileTypstResult = {
  committed: false,
  diagnostics: [
    { reason: "unused", severity: "warning", sourcePath: "pages/one.typ" },
  ],
  javascript: "return docMigration.apply();\n",
  previews: [{ pageId: "one", path: "previews/one.svg", sourcePath: "pages/one.typ" }],
  targetUnitId: "typst-doc",
  title: "Compiled paper",
};

describe("compile-typst command", () => {
  it("maps compile-only input, writes exact artifacts, and preserves JSON presentation", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "nested", "program.js");
    const diagnosticsPath = join(directory, "diagnostics", "typst.json");
    const execute = vi.fn(async (_input: WorkspaceCompileTypstInput) => compiled);

    const output = await run(createWorkspaceCompileTypstCommand({ execute }), [
      " exact bundle/typst.json ",
      "--preview-dir",
      " preview output ",
      "--out",
      outputPath,
      "--diagnostics-out",
      diagnosticsPath,
      "--json",
    ]);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      bundlePath: " exact bundle/typst.json ",
      previewDir: " preview output ",
    });
    expect(await readFile(outputPath, "utf8")).toBe(compiled.javascript);
    expect(await readFile(diagnosticsPath, "utf8")).toBe(
      `${JSON.stringify({ schemaVersion: 1, diagnostics: compiled.diagnostics }, null, 2)}\n`,
    );
    expect(JSON.parse(output)).toEqual({
      committed: false,
      compiledTargetUnitId: "typst-doc",
      diagnostics: compiled.diagnostics,
      previews: compiled.previews,
      out: outputPath,
    });
  });

  it("maps exact apply input and preserves text presentation", async () => {
    const result: WorkspaceCompileTypstResult = {
      ...compiled,
      committed: true,
      unit: {
        activationState: "notApplicable",
        change: "added",
        draftHeadRevision: 1,
        mergeResult: "pending",
        name: "Compiled paper",
        nodeId: "node-1",
        resourceId: "resource-1",
        source: "worktree",
        target: { parentNodeId: "parent-1", spaceId: "space-1" },
        type: "doc",
        unitId: "unit-1",
        worktreeId: "worktree-1",
      },
    };
    const execute = vi.fn(async (_input: WorkspaceCompileTypstInput) => result);

    const output = await run(createWorkspaceCompileTypstCommand({ execute }), [
      "bundle",
      "--apply",
      "--space",
      "space-1",
      "--worktree",
      "worktree-1",
      "--parent",
      "parent-1",
      "--idempotency-key",
      "request-1",
    ]);

    expect(execute).toHaveBeenCalledWith({
      apply: {
        idempotencyKey: "request-1",
        parentNodeId: "parent-1",
        spaceId: "space-1",
        worktreeId: "worktree-1",
      },
      bundlePath: "bundle",
    });
    expect(output).toBe("Created staged Doc unit-1 from typst-doc in worktree-1\n");
  });

  it.each([
    {
      args: ["bundle", "--apply", "--space", "space-1"],
      message: "--apply requires --worktree and --space.",
    },
    {
      args: ["bundle", "--worktree", "worktree-1"],
      message: "Workspace target options require --apply.",
    },
    {
      args: ["bundle"],
      message: "Compile-only mode requires --out.",
    },
  ])("rejects invalid option combinations before execution: $message", async ({ args, message }) => {
    const execute = vi.fn();
    const output: string[] = [];

    await expect(
      run(createWorkspaceCompileTypstCommand({ execute }), args, output),
    ).rejects.toMatchObject({ code: "workspace.command.failed" });

    expect(execute).not.toHaveBeenCalled();
    expect(output.join("")).toContain(`workspace-argument-invalid: ${message}`);
  });

  it("does not write diagnostics when the program output write fails", async () => {
    const directory = await temporaryDirectory();
    const diagnosticsPath = join(directory, "diagnostics.json");
    const execute = vi.fn(async (_input: WorkspaceCompileTypstInput) => compiled);

    await expect(
      run(createWorkspaceCompileTypstCommand({ execute }), [
        "bundle",
        "--out",
        directory,
        "--diagnostics-out",
        diagnosticsPath,
      ]),
    ).rejects.toThrow();
    await expect(readFile(diagnosticsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "workspace-typst-command-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function run(
  command: Command,
  args: readonly string[],
  outputParts: string[] = [],
): Promise<string> {
  const configuration: OutputConfiguration = {
    writeErr: (text) => outputParts.push(text),
    writeOut: (text) => outputParts.push(text),
  };
  command.exitOverride().configureOutput(configuration);
  const program = new Command("test").configureOutput(configuration).exitOverride();
  program.addCommand(command);
  await program.parseAsync([command.name(), ...args], { from: "user" });
  return outputParts.join("");
}
