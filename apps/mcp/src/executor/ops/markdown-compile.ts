import { createHash } from "node:crypto";
import {
  WorkspaceCompileMarkdownFeature,
  WorkspaceContentExecutionFeature,
  parseDocMarkdownSourceMap,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceUnitFeature } from "@univerjs/univer-workspace-client-core/product";
import { markdownCompileOutput } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { markdownOperation } from "./markdown-errors.js";
import { compilerSourceLimits, readSourceZip } from "../source-zip.js";

export const markdownAssetLimits = compilerSourceLimits;

export const markdownCompile: Handler<"markdown.compile"> = (ctx, input, bytes) =>
  markdownOperation(async () => {
    const assets =
      bytes.length === 0
        ? new Map<string, Uint8Array>()
        : readSourceZip(bytes, markdownAssetLimits);
    const execution = new WorkspaceContentExecutionFeature(ctx.source(), {
      ...ctx.runtime,
      executeAndCommit: async (request) => {
        ctx.signal.throwIfAborted();
        ctx.onCreateUnit?.();
        return await ctx.runtime.executeAndCommit(request);
      },
    });
    const feature = new WorkspaceCompileMarkdownFeature({
      materializer: {
        materialize: async (request) => {
          if (!ctx.materializer) throw new Error("Document materializer is unavailable.");
          return await ctx.materializer.materialize(request);
        },
      },
      units: {
        create: async (request) => {
          ctx.signal.throwIfAborted();
          ctx.onCreateUnit?.();
          return await new WorkspaceUnitFeature(async () => ctx.http()).create(request);
        },
      },
      contentExecution: execution,
    });
    const result = await feature.execute({
      markdown: input.markdown,
      assets,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.apply !== true
        ? {}
        : input.unitId !== undefined
          ? {
              update: {
                unitId: input.unitId,
                worktreeId: input.worktreeId!,
                sourceMap: parseDocMarkdownSourceMap(input.sourceMap),
                blockIds: input.blockIds!,
              },
            }
          : {
              apply: {
                worktreeId: input.worktreeId!,
                spaceId: input.spaceId!,
                ...(input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId }),
                ...(input.idempotencyKey === undefined
                  ? {}
                  : {
                      // Scope deterministic native identities to the caller as well as the retry key.
                      idempotencyKey: createHash("sha256")
                        .update(JSON.stringify([ctx.userId, input.idempotencyKey]))
                        .digest("hex"),
                    }),
              },
            }),
    });
    if (result.unit !== undefined || result.execution !== undefined) {
      ctx.usage.unitType = "doc";
      ctx.usage.repo = input.spaceId ?? ctx.usage.repo ?? null;
    }
    ctx.usage.cost.committed_revisions += result.committed ? 1 : 0;
    return {
      output: markdownCompileOutput.parse({
        committed: result.committed,
        targetUnitId: result.unit?.unitId ?? result.targetUnitId,
        diagnostics: result.diagnostics,
        sourceMap: result.materializedSourceMap ?? result.sourceMap,
        ...(input.apply === true ? {} : { javascript: result.javascript }),
        ...(result.unit === undefined ? {} : { unit: result.unit }),
        ...(result.execution === undefined ? {} : { execution: result.execution }),
      }),
    };
  });
