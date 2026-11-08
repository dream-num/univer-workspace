import { createHash } from "node:crypto";
import { WorkspaceCompileTypstFeature } from "@univerjs/univer-workspace-client-core";
import { WorkspaceUnitFeature } from "@univerjs/univer-workspace-client-core/product";
import { typstCompileOutput } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { compilerSourceLimits, readSourceZip } from "../source-zip.js";

export const typstCompile: Handler<"typst.compile"> = async (ctx, input, bytes) => {
  const bundle = readSourceZip(bytes, compilerSourceLimits);
  const feature = new WorkspaceCompileTypstFeature({
    // The injected compiler owns the in-memory bundle; only the job child writes source files.
    compile: async () => {
      if (!ctx.compileTypst) throw new Error("Typst compiler job is unavailable.");
      return await ctx.compileTypst(bundle);
    },
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
  });
  const result = await feature.execute({
    bundlePath: "typst.json",
    ...(input.apply !== true
      ? {}
      : {
          apply: {
            worktreeId: input.worktreeId!,
            spaceId: input.spaceId!,
            ...(input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId }),
            ...(input.idempotencyKey === undefined
              ? {}
              : {
                  idempotencyKey: createHash("sha256")
                    .update(JSON.stringify([ctx.userId, "compile_typst", input.idempotencyKey]))
                    .digest("hex"),
                }),
          },
        }),
  });
  if (result.unit !== undefined) {
    ctx.usage.unitType = "doc";
    ctx.usage.repo = input.spaceId ?? null;
  }
  ctx.usage.cost.committed_revisions += result.committed ? 1 : 0;
  return {
    output: typstCompileOutput.parse({
      committed: result.committed,
      compiledTargetUnitId: result.targetUnitId,
      diagnostics: result.diagnostics,
      previews: result.previews,
      ...(input.apply === true ? {} : { javascript: result.javascript }),
      ...(result.unit === undefined ? {} : { unit: result.unit }),
    }),
  };
};
