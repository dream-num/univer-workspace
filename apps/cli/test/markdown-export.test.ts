import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceExportMarkdownCommand } from "../src/features/markdown/export-command.js";
import type { WorkspaceMarkdownExportResult } from "@univerjs/univer-workspace-client-core";

const map = [
  {
    id: "intro",
    kind: "paragraph",
    source: { line: 1, column: 1, offset: 0, endOffset: 4 },
    paragraphIds: ["native-p"],
    objectIds: [],
  },
];
const result: WorkspaceMarkdownExportResult = {
  formatVersion: 1,
  unitId: "doc",
  blockIds: ["intro"],
  revision: 9,
  markdown: ":::block{#intro}\nNative edited text\n:::\n",
  diagnostics: [],
  sourceMap: map,
  assets: [
    {
      path: "assets/chart.json",
      kind: "chart",
      mimeType: "application/json",
      encoding: "utf8",
      data: "{}",
    },
  ],
};

async function run(args: string[], execute = vi.fn(async () => result)): Promise<string> {
  const output: string[] = [];
  const config = {
    writeOut: (value: string) => output.push(value),
    writeErr: (value: string) => output.push(value),
  };
  const command = createWorkspaceExportMarkdownCommand({ execute })
    .configureOutput(config)
    .exitOverride();
  await new Command("test")
    .configureOutput(config)
    .exitOverride()
    .addCommand(command)
    .parseAsync(["export-markdown", ...args], { from: "user" });
  return output.join("");
}

describe("export-markdown command", () => {
  it("writes current native Markdown, sidecars and a revision-bound map", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uvw-native-command-"));
    try {
      const input = join(directory, "input.json");
      const out = join(directory, "edit.md");
      const nextMap = join(directory, "next.json");
      await writeFile(input, JSON.stringify({ sourceMap: map }));
      const execute = vi.fn(async () => result);
      const output = await run(
        [
          "--worktree",
          "wt",
          "--unit",
          "doc",
          "--source-map",
          input,
          "--blocks",
          "intro",
          "--out",
          out,
          "--source-map-out",
          nextMap,
          "--json",
        ],
        execute,
      );
      expect(execute).toHaveBeenCalledWith({
        worktreeId: "wt",
        unitId: "doc",
        sourceMap: map,
        blockIds: ["intro"],
      });
      expect(await readFile(out, "utf8")).toContain("Native edited text");
      expect(await readFile(join(directory, "assets/chart.json"), "utf8")).toBe("{}");
      expect(JSON.parse(await readFile(nextMap, "utf8"))).toMatchObject({
        revision: 9,
        sourceMap: map,
      });
      expect(JSON.parse(output)).toMatchObject({
        revision: 9,
        out,
        assets: [{ path: "assets/chart.json" }],
      });
      expect(JSON.parse(output).assets[0].data).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["", "intro,intro"])(
    "rejects invalid block selection %j before native execution",
    async (blocks) => {
      const execute = vi.fn();
      await expect(
        run(
          [
            "--worktree",
            "wt",
            "--unit",
            "doc",
            "--source-map",
            "unused.json",
            "--blocks",
            blocks,
            "--out",
            "unused.md",
          ],
          execute,
        ),
      ).rejects.toMatchObject({ code: "workspace.command.failed" });
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
