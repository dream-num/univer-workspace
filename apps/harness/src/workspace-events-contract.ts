import type { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";

/** A coarse invalidation watermark; document content stays on collaboration channels. */
export interface WorkspaceChange {
  readonly version: string;
  readonly revision: number;
}

export const workspaceEventsPackage = "@univerjs/univer-workspace-harness/events";
export const workspaceEventsDescriptor: InvocationDescriptor = {
  id: `${workspaceEventsPackage}#follow`,
  service: "workspaceEvents",
  namespace: "workspaceEvents",
  method: "follow",
  mode: "stream",
  invocation: { kind: "direct" },
  parameters: [],
  cancellation: { parameter: "signal" },
  result: {
    mode: "strict",
    typeSymbol: "WorkspaceChange",
    schema: { parse: parseWorkspaceChange },
  },
};

export function parseWorkspaceChange(value: unknown): WorkspaceChange {
  if (value === null || typeof value !== "object") throw new Error("Invalid Workspace change");
  const change = value as Partial<WorkspaceChange>;
  if (
    typeof change.version !== "string" ||
    change.version === "" ||
    !Number.isSafeInteger(change.revision) ||
    change.revision! < 0
  ) {
    throw new Error("Invalid Workspace change");
  }
  return { version: change.version, revision: change.revision! };
}
