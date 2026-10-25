import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { registerMarkdownTool } from "../src/tools/markdown.ts";

const core = vi.hoisted(() => ({ compile: vi.fn(), materialize: vi.fn() }));
vi.mock("@univerjs/univer-workspace-client-core/markdown", () => ({
  compileWorkspaceMarkdownFile: core.compile,
}));

vi.mock("@univerjs/univer-workspace-client-core/document-materialize", () => ({
  materializeWorkspaceDocument: core.materialize,
}));
vi.mock("@univer-cli/doc-markdown-facade", () => ({
  parseDocMarkdownSourceMap: (value: unknown) =>
    Array.isArray(value) ? value : (value as { sourceMap: unknown }).sourceMap,
}));

async function setup() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "uvw-markdown-tool-")));
  await writeFile(join(directory, "report.md"), "# Report");
  const service = {
    resolveSpaceForSession: vi.fn(async () => ({ userId: "u", spaceId: "s" })),
    createWorktreeLocalUnit: vi.fn(async () => ({ unitId: "doc" })),
    editUnit: vi.fn(async () => ({ committed: true, value: { sourceMap: [] } })),
    getWorktreeFileState: vi.fn(async () => ({
      worktrees: [
        { worktreeId: "wt", units: [{ unitId: "doc", unitType: "doc", source: "worktree" }] },
      ],
    })),
  };
  let definition: ToolDefinition;
  const ctx = {
    get: () => service,
    on: () => () => undefined,
    tools: {
      register: (tool: ToolDefinition) => {
        definition = tool;
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerMarkdownTool(ctx, { license: "test-license" });
  const exec = { agent: { session: { header: { cwd: directory } } } } as ToolRunContext;
  return {
    directory,
    service,
    run: (args: Record<string, unknown>) => definition.execute(args, exec),
  };
}

describe("Markdown agent tool", () => {
  it("uses shared compilation/materialization to create a draft Doc", async () => {
    core.compile.mockResolvedValue({
      targetUnitId: "compiled-doc",
      title: "Report",
      javascript: "return {};",
      diagnostics: [],
      sourceMap: [{ id: "intro" }],
    });
    core.materialize.mockResolvedValue({
      initialData: { id: "compiled-doc" },
      value: { sourceMap: [{ id: "intro", paragraphIds: ["p"] }] },
    });
    const { directory, run, service } = await setup();
    try {
      const result = await run({ source: "report.md", worktreeId: "wt" });
      expect(result).toMatchObject({
        operation: "compile-markdown",
        unit: { unitId: "doc" },
        sourceMap: [{ paragraphIds: ["p"] }],
      });
      expect(core.compile).toHaveBeenCalledWith(
        join(directory, "report.md"),
        expect.objectContaining({ targetUnitId: expect.stringMatching(/^markdown-/) }),
        directory,
      );
      expect(service.createWorktreeLocalUnit).toHaveBeenCalledWith(
        "u",
        expect.objectContaining({
          unitType: "doc",
          targetSpaceId: "s",
          worktreeId: "wt",
          initialData: { id: "compiled-doc" },
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("updates authorized selected IDs without a server capability handshake or revision", async () => {
    core.compile.mockResolvedValue({
      targetUnitId: "doc",
      title: "Report",
      javascript: "return {};",
      diagnostics: [],
      sourceMap: [],
    });
    const { directory, run, service } = await setup();
    try {
      await writeFile(
        join(directory, "map.json"),
        JSON.stringify([{ id: "intro", paragraphIds: ["p"] }]),
      );
      await run({
        source: "report.md",
        worktreeId: "wt",
        unitId: "doc",
        sourceMapFile: "map.json",
        blockIds: ["intro"],
      });
      expect(service.editUnit).toHaveBeenCalledWith("u", {
        scope: { kind: "worktree", worktreeId: "wt" },
        unitId: "doc",
        unitType: "doc",
        code: "return {};",
      });
      expect(service.createWorktreeLocalUnit).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects incomplete updates before writing", async () => {
    const { directory, run, service } = await setup();
    try {
      await expect(
        run({ source: "report.md", worktreeId: "wt", unitId: "doc", blockIds: ["intro"] }),
      ).rejects.toThrow("sourceMapFile");
      expect(service.editUnit).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
