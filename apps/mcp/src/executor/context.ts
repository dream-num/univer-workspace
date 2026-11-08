import type {
  WorkspaceContentRuntimeOperations,
  WorkspaceContentSource,
  WorkspaceUnitExchangeDependencies,
} from "@univerjs/univer-workspace-client-core";
import type { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import type { OpInput, OpName, OpOutput, opSpecs } from "../shared/executor-protocol.js";
import type { OpMeta } from "../shared/usage.js";

export type BoundRuntime = {
  [K in keyof WorkspaceContentRuntimeOperations]: (
    input: Omit<
      Parameters<WorkspaceContentRuntimeOperations[K]>[0],
      "caller" | "observe" | "signal"
    >,
  ) => ReturnType<WorkspaceContentRuntimeOperations[K]>;
};
export interface OpContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly userId: string;
  readonly transportOrigin: string;
  readonly runtime: BoundRuntime;
  readonly exchange: Pick<
    WorkspaceUnitExchangeDependencies,
    "license" | "licenseKey" | "importBuffer" | "exportToBuffer"
  >;
  http(): WorkspaceHttp;
  source(): WorkspaceContentSource;
  readonly usage: OpMeta;
}
export type Handler<K extends OpName> = (
  ctx: OpContext,
  input: OpInput<(typeof opSpecs)[K]>,
  ...payload: (typeof opSpecs)[K]["payload"] extends "request" ? [Uint8Array] : []
) => Promise<
  { output: OpOutput<(typeof opSpecs)[K]> } & ((typeof opSpecs)[K]["payload"] extends "response"
    ? { bytes: Uint8Array }
    : unknown)
>;
