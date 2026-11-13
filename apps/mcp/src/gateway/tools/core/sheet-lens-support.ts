import { z } from "zod";
import { runtimeScope, sheetLensOutput } from "../../../shared/executor-protocol.js";
import { worktreeInput } from "./space-support.js";

export const sheetLensTarget = z
  .object({
    unit: z.string().min(1),
    trunk: z.boolean().optional(),
    worktree: worktreeInput.optional(),
    json: z
      .boolean()
      .optional()
      .describe("Include the structured Lens result as json; omitted by default."),
  })
  .refine(
    ({ trunk, worktree }) => (trunk === true) !== (worktree !== undefined),
    "Specify exactly one of trunk: true or worktree.",
  );

type LensArguments = z.infer<typeof sheetLensTarget> & Record<string, unknown>;

export function sheetLensScope(
  args: z.infer<typeof sheetLensTarget>,
): z.infer<typeof runtimeScope> {
  return args.worktree === undefined
    ? { kind: "trunk" }
    : { kind: "worktree", worktreeId: args.worktree };
}

export const sheetLensToolOutput = sheetLensOutput.omit({ next: true }).partial({ json: true }).extend({
  unitId: z.string(),
  scope: runtimeScope,
  next: z
    .object({
      tool: z.enum(["outline", "read", "find"]),
      arguments: z.record(z.string(), z.json()),
    })
    .optional(),
});

export function sheetLensResponse(result: z.infer<typeof sheetLensOutput>, args: LensArguments) {
  const scope = sheetLensScope(args);
  const scopeText = scope.kind === "trunk" ? "trunk" : `worktree ${scope.worktreeId}`;
  const lines = [
    `unit ${args.unit} [${scopeText}, rev=${result.revision}]`,
    result.text.replace(/\n+$/, ""),
    ...result.warnings.map((warning) => `note: ${warning.message}`),
  ];
  const continuation = result.next;
  let next;
  if (continuation) {
    const arguments_ = { ...args };
    if (continuation.op === "outline") {
      arguments_["at"] = continuation.at;
      if (continuation.from === undefined) delete arguments_["from"];
      else arguments_["from"] = continuation.from;
    } else if (continuation.op === "read") arguments_["range"] = continuation.range;
    else arguments_["from"] = continuation.from;
    next = { tool: continuation.op, arguments: arguments_ };
    const label =
      continuation.op === "outline"
        ? continuation.unit
        : continuation.op === "read"
          ? "rows"
          : "hits";
    lines.push(
      `… ${continuation.remaining} more ${label}: call ${next.tool} with ${JSON.stringify(next.arguments)}`,
    );
  }
  return {
    output: {
      unitId: args.unit,
      scope,
      revision: result.revision,
      text: lines.join("\n"),
      ...(args.json === true ? { json: result.json } : {}),
      warnings: result.warnings,
      ...(next ? { next } : {}),
    },
  };
}
