import { readFile } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import { readDocMarkdown, parseDocMarkdownSourceMap } from "@univer-cli/doc-markdown-facade";
import {
  writeWorkspaceMarkdownExport,
  readWorkspaceMarkdownImage,
} from "@univerjs/univer-workspace-client-core/markdown";
import type { JsonValue } from "../json-value.ts";
import { assertUnitInScope } from "./edit.ts";
import { registerUniverTool } from "./presentation.ts";
import { resolveToolScope } from "./tool-scope.ts";
import { UniverError } from "./errors.ts";
import { existingSessionPath, newSessionPath } from "./workspace-path.ts";

/** Export the current native selected blocks, including edits made in the document editor. */
export function registerMarkdownExportTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_export_markdown",
      description:
        "Read selected current native Modern Doc blocks into a session Markdown file and resource sidecars. Includes native editor changes, never reads the old Markdown source. Returns same-lease revision metadata and the refreshed source map for a later univer_compile_markdown block update. Does not change the document.",
      parameters: {
        worktreeId: { type: "string", required: true },
        unitId: { type: "string", required: true },
        sourceMapFile: {
          type: "string",
          required: true,
          description:
            "Session JSON file containing the materialized map from generation or the previous export.",
        },
        blockIds: { type: "array", required: true, items: { type: "string" } },
        out: {
          type: "string",
          required: true,
          description:
            "Markdown output inside the session workspace. Resources are written beside this file.",
        },
        sourceMapOut: {
          type: "string",
          description: "Refreshed map/revision output. Defaults to <out>.map.json.",
        },
      },
      output: {
        schema: { type: "json" },
        render: (_args: unknown, value: unknown) => [
          { type: "text", text: JSON.stringify(value ?? {}) },
        ],
      },
      async execute(args, exec) {
        const scope = await resolveToolScope(ctx, exec);
        if (
          !args.worktreeId.trim() ||
          !args.unitId.trim() ||
          args.blockIds.length === 0 ||
          args.blockIds.some((id) => !id.trim()) ||
          new Set(args.blockIds).size !== args.blockIds.length
        ) {
          throw new UniverError(
            "Export requires a Unit, Worktree and distinct non-empty block IDs.",
            "INVALID_REQUEST",
          );
        }
        const source = await existingSessionPath(exec, args.sourceMapFile);
        const out = await newSessionPath(exec, args.out);
        const mapOut = await newSessionPath(exec, args.sourceMapOut ?? `${args.out}.map.json`);
        await assertUnitInScope(ctx, scope, args.unitId, "doc", args.worktreeId);
        const result = await readDocMarkdown(
          {
            targetUnitId: args.unitId,
            sourceMap: parseDocMarkdownSourceMap(JSON.parse(await readFile(source.path, "utf8"))),
            blockIds: args.blockIds,
          },
          {
            read: async (code) => {
              exec.signal?.throwIfAborted();
              return await ctx.get("univerWorkspace")!.readUnitWithRevision(scope.userId, {
                scope: { kind: "worktree", worktreeId: args.worktreeId },
                unitId: args.unitId,
                unitType: "doc",
                code,
              });
            },
            assetResolver: async (reference) =>
              await readWorkspaceMarkdownImage(reference, {
                origin: ctx.get("workspaceAuth")?.currentClient()?.origin ?? "",
                worktreeId: args.worktreeId,
                request: async (path, init) => {
                  const client = ctx.get("workspaceAuth")?.currentClient();
                  if (!client)
                    throw new UniverError(
                      "Workspace authentication is required to read current image resources.",
                      "WORKSPACE_ACCESS_DENIED",
                    );
                  return await client.request(path, init);
                },
              }),
          },
        );
        exec.signal?.throwIfAborted();
        await writeWorkspaceMarkdownExport(result, out.path, mapOut.path);
        return {
          ...result,
          operation: "export-markdown",
          committed: false,
          out: args.out,
          sourceMapOut: args.sourceMapOut ?? `${args.out}.map.json`,
          assets: result.assets.map(({ data: _data, ...asset }) => asset),
        } as unknown as JsonValue;
      },
      presentCall: () => ({
        card: "generic",
        title: "Export current native Doc blocks as Markdown",
        kind: "execute",
      }),
    }),
  );
}
