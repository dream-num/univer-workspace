import { inspectContent } from "@univer-cli/content-inspection";
import {
  InspectionCommandInputError,
  parseInspectionQuery,
} from "@univer-cli/content-inspection-command";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { opSpecs } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { attributeRepo } from "./scope.js";

// Workaround for #263: the upstream parser words three errors for the CLI. Delete this table once
// dream-num/univer-cli-sdk#92 returns structured errors that the executor can phrase itself.
const inspectionInputMessages: [RegExp, string][] = [
  [
    /^range requires --worksheet <selector>$/,
    "range requires the worksheet argument (id:<id>, name:<name> or index:N)",
  ],
  [/^Invalid index "(.*)"; CLI indices start at 1$/, 'Invalid index "$1"; indices start at 1'],
  [
    /^--worksheet is only valid for range, not (.+)$/,
    "worksheet is only valid when target is range, not $1",
  ],
];

export const contentInspect: Handler<"content.inspect"> = async (ctx, input) => {
  let query;
  try {
    query = parseInspectionQuery(
      input.target === "range" ? "worksheet-range" : input.target,
      input.selectors ?? [],
      input.worksheet === undefined ? {} : { worksheet: input.worksheet },
    );
  } catch (error) {
    if (error instanceof InspectionCommandInputError)
      throw workspaceError(
        "workspace-argument-invalid",
        inspectionInputMessages.reduce(
          (message, [pattern, replacement]) => message.replace(pattern, replacement),
          error.message,
        ),
      );
    throw error;
  }
  const source = ctx.source();
  const target =
    input.scope.kind === "trunk"
      ? await source.resolveTrunkRuntimeTarget({ unitId: input.unitId })
      : await source.resolveRuntimeTarget({
          unitId: input.unitId,
          worktreeId: input.scope.worktreeId,
        });
  await attributeRepo(ctx, input.scope);
  const result = await inspectContent(
    {
      unitId: target.unitId,
      unitType: target.unitType,
      execute: async ({ code }) => ({
        value: runtimeResult(z.json(), (await ctx.runtime.executeRead({ code, target })).value),
      }),
    },
    query,
  );
  return { output: runtimeResult(opSpecs["content.inspect"].output, result) };
};

function runtimeResult<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw workspaceError(
      "workspace-runtime-result-invalid",
      "The runtime returned an invalid inspection result.",
    );
  return parsed.data;
}
