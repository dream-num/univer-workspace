import {
  WorkspaceCompileSvgFeature,
  WorkspaceContentExecutionFeature,
  getWorktree,
} from "@univerjs/univer-workspace-client-core";
import {
  pullSpaceId,
  WorkspaceSpaceFeature,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import { svgCompileOutput } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { compilerSourceLimits, readSourceZip } from "../source-zip.js";
import { compilerOperation } from "./compiler-errors.js";

export const svgCompile: Handler<"svg.compile"> = (ctx, input, bytes) =>
  compilerOperation("svg", async () => {
    if (input.estimateTextSize !== true)
      throw workspaceError(
        "workspace-text-measure-unavailable",
        "Pass estimate_text_size: true. Real font metrics arrive with the Stage E renderer.",
      );
    const assets =
      bytes.length === 0
        ? new Map<string, Uint8Array>()
        : readSourceZip(bytes, compilerSourceLimits);
    const feature = new WorkspaceCompileSvgFeature({
      env: {},
      license: "",
      renderPageRoot: "",
      contentExecution: new WorkspaceContentExecutionFeature(ctx.source(), {
        executeAndCommit: async (request) => {
          ctx.signal.throwIfAborted();
          ctx.onCreateUnit?.();
          return await ctx.runtime.executeAndCommit(request);
        },
      }),
    });
    const compiled = await feature.compile({
      svg: input.svg,
      assets,
      estimateTextSize: true,
      ...(input.add === undefined ? {} : { add: input.add }),
      ...(input.page === undefined ? {} : { page: input.page }),
    });
    if (input.apply !== true) return { output: svgCompileOutput.parse(compiled) };
    ctx.usage.repo =
      (await pullSpaceId(
        new WorkspaceSpaceFeature(async () => ctx.http()),
        await getWorktree(ctx.http(), input.worktreeId!),
      )) ?? null;
    const result = await feature.apply({
      compiled,
      unitId: input.unitId!,
      worktreeId: input.worktreeId!,
    });
    ctx.usage.unitType = "slide";
    ctx.usage.cost.committed_revisions += result.applied.committed ? 1 : 0;
    return { output: svgCompileOutput.parse(result) };
  });
