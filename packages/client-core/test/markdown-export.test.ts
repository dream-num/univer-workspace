import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  DocMarkdownCompileError,
  type DocMarkdownReadResult,
} from "@univer-cli/doc-markdown-facade";
import {
  writeWorkspaceMarkdownExport,
  type WorkspaceMarkdownExportResult,
} from "../src/markdown-export.js";
import { WorkspaceExportMarkdownFeature } from "../src/markdown-export-feature.js";

const sourceMap = [
  {
    id: "intro",
    paragraphIds: ["native-p1"],
    objectIds: [],
    kind: "paragraph",
    source: { line: 1, column: 1, offset: 0, endOffset: 5 },
  },
  {
    id: "keep",
    paragraphIds: ["native-keep"],
    objectIds: [],
    kind: "paragraph",
    source: { line: 3, column: 1, offset: 7, endOffset: 11 },
  },
];
const native = {
  formatVersion: 1,
  unitId: "doc",
  blockIds: ["intro"],
  markdown: ":::block{#intro}\nNative editor change\n:::\n",
  assets: [],
  diagnostics: [],
  sourceMap: [{ ...sourceMap[0]!, paragraphIds: ["native-p1", "native-added"] }, sourceMap[1]!],
} satisfies DocMarkdownReadResult;

const state = {
  baseRevision: 7,
  knownHeadRevision: 7,
  connection: "online" as const,
  pendingMutationCount: 0,
  bufferedChangesetCount: 0,
  awaitingChangeset: null,
  conflict: null,
};

describe("current native Markdown export", () => {
  it("runs the shared read program and returns its same-lease revision and refreshed mapping", async () => {
    const target = {
      origin: "http://workspace.invalid",
      unitId: "doc",
      unitType: "doc" as const,
      revision: 7,
      scope: { kind: "worktree" as const, worktreeId: "wt" },
    };
    const executeRead = vi.fn(async () => ({
      value: native,
      state,
    }));
    const feature = new WorkspaceExportMarkdownFeature({
      resolveRuntimeTarget: async () => target,
      runtime: { executeRead },
      assetRequest: vi.fn(),
    });
    const exported = await feature.execute({
      unitId: "doc",
      worktreeId: "wt",
      sourceMap,
      blockIds: ["intro"],
    });
    expect(executeRead).toHaveBeenCalledWith({
      target,
      code: expect.stringContaining('getDocument("doc")'),
    });
    expect(exported).toMatchObject({
      revision: 7,
      markdown: expect.stringContaining("Native editor change"),
    });
    expect(exported.sourceMap[0]?.paragraphIds).toEqual(["native-p1", "native-added"]);
    expect(exported.sourceMap[1]).toEqual(sourceMap[1]);
  });

  it("rejects a non-Doc before executing a runtime program", async () => {
    const executeRead = vi.fn();
    const feature = new WorkspaceExportMarkdownFeature({
      resolveRuntimeTarget: async () => ({
        origin: "http://workspace.invalid",
        unitId: "doc",
        unitType: "sheet",
        revision: 7,
        scope: { kind: "worktree", worktreeId: "wt" },
      }),
      runtime: { executeRead },
      assetRequest: vi.fn(),
    });
    await expect(
      feature.execute({ unitId: "doc", worktreeId: "wt", sourceMap, blockIds: ["intro"] }),
    ).rejects.toMatchObject({ code: "workspace-unit-type-mismatch" });
    expect(executeRead).not.toHaveBeenCalled();
  });

  it("surfaces shared SDK diagnostics without writing or mutating the native document", async () => {
    const failure = {
      ...native,
      markdown: "",
      diagnostics: [
        {
          severity: "error" as const,
          code: "DOC_MARKDOWN_READ_UNSUPPORTED",
          message: "Native element cannot be represented.",
          blockId: "intro",
        },
      ],
    };
    const executeRead = vi.fn(async () => ({ value: failure, state }));
    const feature = new WorkspaceExportMarkdownFeature({
      resolveRuntimeTarget: async () => ({
        origin: "http://workspace.invalid",
        unitId: "doc",
        unitType: "doc",
        revision: 7,
        scope: { kind: "worktree", worktreeId: "wt" },
      }),
      runtime: { executeRead },
      assetRequest: vi.fn(),
    });
    await expect(
      feature.execute({ unitId: "doc", worktreeId: "wt", sourceMap, blockIds: ["intro"] }),
    ).rejects.toMatchObject({ diagnostics: failure.diagnostics });
  });

  it("writes native resource sidecars and the current revision/map for block updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uvw-native-export-"));
    try {
      const result: WorkspaceMarkdownExportResult = {
        ...native,
        assets: [
          {
            path: "assets/chart.json",
            kind: "chart",
            mimeType: "application/json",
            encoding: "utf8",
            data: '{"native":true}',
          },
          {
            path: "assets/image.png",
            kind: "image",
            mimeType: "image/png",
            encoding: "base64",
            data: Buffer.from([1, 2, 3]).toString("base64"),
          },
        ],
        revision: 7,
      };
      await writeWorkspaceMarkdownExport(
        result,
        join(directory, "edit.md"),
        join(directory, "map.json"),
      );
      expect(await readFile(join(directory, "edit.md"), "utf8")).toBe(native.markdown);
      expect(await readFile(join(directory, "assets/chart.json"), "utf8")).toBe('{"native":true}');
      expect([...(await readFile(join(directory, "assets/image.png")))]).toEqual([1, 2, 3]);
      expect(JSON.parse(await readFile(join(directory, "map.json"), "utf8"))).toMatchObject({
        revision: 7,
        unitId: "doc",
        sourceMap: native.sourceMap,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects traversal and symlink resource escapes before writing the Markdown file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uvw-native-export-"));
    const outside = await mkdtemp(join(tmpdir(), "uvw-native-outside-"));
    try {
      await symlink(outside, join(directory, "assets"));
      await symlink(join(outside, "dangling.json"), join(directory, "dangling.json"));
      for (const path of ["../escape.json", "assets/escape.json", "dangling.json", "edit.md"]) {
        const result: WorkspaceMarkdownExportResult = {
          ...native,
          assets: [
            { path, kind: "chart", mimeType: "application/json", encoding: "utf8", data: "{}" },
          ],
          revision: 7,
        };
        await expect(
          writeWorkspaceMarkdownExport(result, join(directory, "edit.md")),
        ).rejects.toBeInstanceOf(DocMarkdownCompileError);
      }
      await expect(readFile(join(directory, "edit.md"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        writeWorkspaceMarkdownExport(
          { ...native, revision: 7 },
          join(directory, "same.md"),
          join(directory, "same.md"),
        ),
      ).rejects.toBeInstanceOf(DocMarkdownCompileError);
      await expect(readFile(join(outside, "escape.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
