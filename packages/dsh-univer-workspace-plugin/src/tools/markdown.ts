import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import { compileWorkspaceMarkdownFile } from "@univerjs/univer-workspace-client-core/markdown";
import { materializeWorkspaceDocument } from "@univerjs/univer-workspace-client-core/document-materialize";
import { parseDocMarkdownSourceMap } from "@univer-cli/doc-markdown-facade";
import type { JsonValue } from "../json-value.ts";
import { assertUnitInScope } from "./edit.ts";
import { registerUniverTool } from "./presentation.ts";
import { resolveTargetSpace, resolveToolScope } from "./tool-scope.ts";
import { UniverError } from "./errors.ts";
import { existingSessionPath } from "./workspace-path.ts";

/** Markdown compilation shares the AI SDK pipeline and remains inside a draft Worktree. */
export function registerMarkdownTool(
  ctx: Context,
  options: { readonly license: string },
): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_compile_markdown",
      description:
        "Compile session Markdown and local assets into an editable native Modern Doc using SDK default typography. Creates a draft Doc; provide unitId, sourceMapFile and blockIds together to update explicit stable IDs. Returns a materialized sourceMap to save for later edits. No merge is performed.",
      parameters: {
        source: {
          type: "string",
          required: true,
          description: "Markdown file inside the session workspace.",
        },
        worktreeId: { type: "string", required: true },
        title: { type: "string" },
        spaceId: { type: "string" },
        parentNodeId: { type: "string" },
        idempotencyKey: { type: "string" },
        unitId: { type: "string" },
        sourceMapFile: {
          type: "string",
          description: "Session JSON file containing the sourceMap from the previous generation.",
        },
        blockIds: { type: "array", items: { type: "string" } },
      },
      output: {
        schema: { type: "json" },
        render: (_args: unknown, value: unknown) => [
          { type: "text", text: JSON.stringify(value ?? {}) },
        ],
      },
      async execute(args, exec) {
        const resolved = await resolveToolScope(ctx, exec);
        if (args.worktreeId.trim() === "")
          throw new UniverError("A draft worktreeId is required.", "INVALID_REQUEST");
        const source = await existingSessionPath(exec, args.source);
        const updateRequested = args.unitId !== undefined;
        if (updateRequested && (args.sourceMapFile === undefined || !args.blockIds?.length)) {
          throw new UniverError(
            "Block updates require sourceMapFile and blockIds.",
            "INVALID_REQUEST",
          );
        }
        if (
          !updateRequested &&
          [args.sourceMapFile, args.blockIds].some((value) => value !== undefined)
        ) {
          throw new UniverError("Block update options require unitId.", "INVALID_REQUEST");
        }
        if (
          updateRequested &&
          [args.spaceId, args.parentNodeId, args.idempotencyKey].some(
            (value) => value !== undefined,
          )
        ) {
          throw new UniverError(
            "Creation options cannot be combined with unitId.",
            "INVALID_REQUEST",
          );
        }
        if (updateRequested) {
          await assertUnitInScope(ctx, resolved, args.unitId!, "doc", args.worktreeId);
        }
        const sourceMapPath =
          args.sourceMapFile === undefined
            ? undefined
            : await existingSessionPath(exec, args.sourceMapFile);
        const sourceMap =
          sourceMapPath === undefined
            ? undefined
            : parseDocMarkdownSourceMap(JSON.parse(await readFile(sourceMapPath.path, "utf8")));
        exec.signal?.throwIfAborted();
        const compiled = await compileWorkspaceMarkdownFile(
          source.path,
          {
            targetUnitId: args.unitId ?? `markdown-${randomUUID()}`,
            ...(args.title === undefined ? {} : { title: args.title }),
            ...(sourceMap === undefined ? {} : { update: { sourceMap, blockIds: args.blockIds! } }),
          },
          source.workspace,
        );
        if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          throw new UniverError(
            "Markdown compilation failed; no document was changed.",
            "MARKDOWN_DIAGNOSTICS",
            { cause: compiled.diagnostics },
          );
        }
        exec.signal?.throwIfAborted();
        const service = ctx.get("univerWorkspace")!;
        if (updateRequested) {
          const execution = await service.editUnit(resolved.userId, {
            scope: { kind: "worktree", worktreeId: args.worktreeId },
            unitId: args.unitId!,
            unitType: "doc",
            code: compiled.javascript,
          });
          return {
            operation: "compile-markdown",
            unitId: args.unitId!,
            diagnostics: compiled.diagnostics,
            execution,
            sourceMap: parseDocMarkdownSourceMap(execution.value),
          } as unknown as JsonValue;
        }
        const materialized = await materializeWorkspaceDocument(
          { javascript: compiled.javascript, targetUnitId: compiled.targetUnitId },
          { format: "Markdown", license: options.license },
        );
        exec.signal?.throwIfAborted();
        const unit = await service.createWorktreeLocalUnit(resolved.userId, {
          worktreeId: args.worktreeId,
          name: materialized.name ?? compiled.title,
          unitType: "doc",
          targetSpaceId: resolveTargetSpace(resolved, args.spaceId),
          targetParentNodeId: args.parentNodeId ?? null,
          initialData: materialized.initialData as Record<string, unknown>,
          ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        });
        return {
          operation: "compile-markdown",
          unit,
          diagnostics: compiled.diagnostics,
          sourceMap:
            compiled.sourceMap.length === 0 ? [] : parseDocMarkdownSourceMap(materialized.value),
        } as unknown as JsonValue;
      },
      presentCall: () => ({
        card: "generic",
        title: "Compile Markdown into Modern Doc",
        kind: "execute",
      }),
    }),
  );
}
