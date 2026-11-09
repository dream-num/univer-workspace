import {
  WorkspaceCompileSvgFeature,
  WorkspaceContentExecutionFeature,
  getWorktree,
} from "@univerjs/univer-workspace-client-core";
import {
  pullSpaceId,
  WorkspaceSpaceFeature,
} from "@univerjs/univer-workspace-client-core/product";
import type { z } from "zod";
import type { measureTextInput } from "../../shared/renderer-protocol.js";
import { svgCompileOutput } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { compilerSourceLimits, readSourceZip } from "../source-zip.js";
import { compilerOperation } from "./compiler-errors.js";

export const svgCompile: Handler<"svg.compile"> = (ctx, input, bytes) =>
  compilerOperation("svg", async () => {
    const assets =
      bytes.length === 0
        ? new Map<string, Uint8Array>()
        : readSourceZip(bytes, compilerSourceLimits);
    const feature = new WorkspaceCompileSvgFeature({
      env: {},
      license: "",
      renderPageRoot: "",
      // Only used without estimateTextSize. One renderer RPC per measured line; the renderer owns
      // the browser, so closing the injected runtime has nothing to release here.
      createRuntime: async () => ({
        measureText: async ({ doc, wrapWidth }) => {
          if (!ctx.renderer) throw new Error("The executor was built without a renderer client.");
          const { output } = await ctx.renderer.call("measureText", {
            doc,
            ...(wrapWidth === undefined ? {} : { wrapWidth }),
          } as unknown as z.input<typeof measureTextInput>);
          return output;
        },
        close: async () => {},
      }),
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
      estimateTextSize: ctx.renderer?.configured !== true || input.estimateTextSize === true,
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
