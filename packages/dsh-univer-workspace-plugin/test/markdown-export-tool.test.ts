import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  read: vi.fn(
    async (
      _options: unknown,
      ports: {
        read: (program: string) => Promise<{ value: Record<string, unknown>; revision: number }>;
      },
    ) => {
      const current = await ports.read("return currentNativeBlocks();");
      return { ...current.value, revision: current.revision };
    },
  ),
}));
const core = vi.hoisted(() => ({
  write: vi.fn(async () => undefined),
}));
vi.mock("@univer-cli/doc-markdown-facade", () => ({
  readDocMarkdown: sdk.read,
  parseDocMarkdownSourceMap: (value: unknown) =>
    Array.isArray(value) ? value : (value as { sourceMap: unknown }).sourceMap,
}));
vi.mock("@univerjs/univer-workspace-client-core/markdown", () => ({
  writeWorkspaceMarkdownExport: core.write,
  readWorkspaceMarkdownImage: vi.fn(),
}));
import { registerMarkdownExportTool } from "../src/tools/markdown-export.ts";

const sourceMap = [
  {
    id: "intro",
    paragraphIds: ["p1"],
    objectIds: [],
    kind: "paragraph",
    source: { line: 1, column: 1, offset: 0, endOffset: 4 },
  },
];

async function setup() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "uvw-native-tool-")));
  await writeFile(join(directory, "map.json"), JSON.stringify(sourceMap));
  const service = {
    resolveSpaceForSession: vi.fn(async () => ({ userId: "user", spaceId: "space" })),
    getWorktreeFileState: vi.fn(async () => ({
      worktrees: [
        { worktreeId: "wt", units: [{ unitId: "doc", unitType: "doc", source: "worktree" }] },
      ],
    })),
    readUnitWithRevision: vi.fn(async () => ({
      revision: 8,
      value: {
        formatVersion: 1,
        unitId: "doc",
        blockIds: ["intro"],
        markdown: "Native editor change",
        assets: [],
        diagnostics: [],
        sourceMap,
      },
    })),
    editUnit: vi.fn(),
  };
  let definition: ToolDefinition;
  const ctx = {
    get: (name: string) =>
      name === "workspaceAuth"
        ? { currentClient: () => ({ origin: "http://workspace.invalid", request: vi.fn() }) }
        : service,
    tools: {
      register: (tool: ToolDefinition) => {
        definition = tool;
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerMarkdownExportTool(ctx);
  const exec = { agent: { session: { header: { cwd: directory } } } } as ToolRunContext;
  return {
    directory,
    service,
    run: (args: Record<string, unknown>) => definition.execute(args, exec),
  };
}

describe("native Markdown export agent tool", () => {
  it("reads live blocks without mutation and writes the authoritative revision beside the Markdown", async () => {
    const { directory, run, service } = await setup();
    try {
      const exported = await run({
        unitId: "doc",
        worktreeId: "wt",
        sourceMapFile: "map.json",
        blockIds: ["intro"],
        out: "edit.md",
      });
      expect(exported).toMatchObject({
        committed: false,
        revision: 8,
        sourceMapOut: "edit.md.map.json",
        markdown: "Native editor change",
      });
      expect(service.readUnitWithRevision).toHaveBeenCalledWith("user", {
        scope: { kind: "worktree", worktreeId: "wt" },
        unitId: "doc",
        unitType: "doc",
        code: "return currentNativeBlocks();",
      });
      expect(service.editUnit).not.toHaveBeenCalled();
      expect(core.write).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 8, sourceMap }),
        join(directory, "edit.md"),
        join(directory, "edit.md.map.json"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects symlinked output paths outside the session before reading native content", async () => {
    const { directory, run, service } = await setup();
    const outside = await mkdtemp(join(tmpdir(), "uvw-native-tool-outside-"));
    try {
      await symlink(outside, join(directory, "escape"));
      await expect(
        run({
          unitId: "doc",
          worktreeId: "wt",
          sourceMapFile: "map.json",
          blockIds: ["intro"],
          out: "escape/edit.md",
        }),
      ).rejects.toMatchObject({ code: "SESSION_SCOPE_DENIED" });
      expect(service.readUnitWithRevision).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
