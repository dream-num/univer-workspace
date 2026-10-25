import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceCompileMarkdownCommand } from "../src/features/markdown/command.js";
import type { WorkspaceCompileMarkdownResult } from "@univerjs/univer-workspace-client-core";

const map = [
  {
    id: "intro",
    kind: "paragraph",
    source: { line: 1, column: 1, offset: 0, endOffset: 5 },
    paragraphIds: ["p-1"],
    objectIds: [],
  },
];
const compiled: WorkspaceCompileMarkdownResult = {
  committed: false,
  formatVersion: 1,
  targetUnitId: "doc",
  title: "Report",
  javascript: "return true;",
  diagnostics: [],
  sourceMap: [],
};

async function run(args: string[], execute = vi.fn(async () => compiled)): Promise<string> {
  const output: string[] = [];
  const config = {
    writeOut: (value: string) => output.push(value),
    writeErr: (value: string) => output.push(value),
  };
  const command = createWorkspaceCompileMarkdownCommand({ execute })
    .configureOutput(config)
    .exitOverride();
  await new Command("test")
    .configureOutput(config)
    .exitOverride()
    .addCommand(command)
    .parseAsync(["compile-markdown", ...args], { from: "user" });
  return output.join("");
}

describe("compile-markdown command", () => {
  it("writes the generated program in compile-only mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uvw-markdown-"));
    try {
      const path = join(directory, "program.js");
      const output = await run(["report.md", "--out", path, "--json"]);
      expect(await readFile(path, "utf8")).toBe(compiled.javascript);
      expect(JSON.parse(output)).toMatchObject({ committed: false, targetUnitId: "doc" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("updates selected IDs using a materialized source map without a revision argument", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uvw-markdown-"));
    try {
      const sourceMapPath = join(directory, "map.json");
      const outputPath = join(directory, "new-map.json");
      await writeFile(sourceMapPath, JSON.stringify(map));
      const execute = vi.fn(async () => ({
        ...compiled,
        committed: true,
        materializedSourceMap: map,
      }));
      await run(
        [
          "update.md",
          "--apply",
          "--worktree",
          "wt",
          "--unit",
          "doc",
          "--source-map",
          sourceMapPath,
          "--blocks",
          "intro",
          "--source-map-out",
          outputPath,
        ],
        execute,
      );
      expect(execute).toHaveBeenCalledWith({
        file: "update.md",
        update: {
          unitId: "doc",
          worktreeId: "wt",
          sourceMap: map,
          blockIds: ["intro"],
        },
      });
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(map);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["report.md", "--apply"],
    ["report.md", "--apply", "--worktree", "wt", "--unit", "doc"],
    ["report.md", "--unit", "doc", "--out", "program.js"],
  ])("rejects incomplete target options before execution: %j", async (...args) => {
    const execute = vi.fn();
    await expect(run(args, execute)).rejects.toMatchObject({ code: "workspace.command.failed" });
    expect(execute).not.toHaveBeenCalled();
  });
});
