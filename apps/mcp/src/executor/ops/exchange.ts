import { WorkspaceUnitExchangeFeature } from "@univerjs/univer-workspace-client-core";
import {
  WorkspaceUnitFeature,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import type { OpContext } from "../context.js";

const MAX_IMPORT_UNIT_BYTES = 900 * 1024;

export function exchangeFeature(ctx: OpContext, unitId?: string) {
  const source = ctx.source();
  return new WorkspaceUnitExchangeFeature({
    ...ctx.exchange,
    licenseMode: "per-operation",
    ...(unitId === undefined
      ? {}
      : {
          importBuffer: (bytes, options) =>
            ctx.exchange.importBuffer!(bytes, { ...options, unitId }),
        }),
    runtime: ctx.runtime,
    resolveRuntimeTarget: (input) => source.resolveRuntimeTarget(input),
    resolveImageAsset: (input) => source.resolveImageAsset(input),
    createUnit: async (input) => {
      const size = Buffer.byteLength(JSON.stringify(input.initialData));
      if (size > MAX_IMPORT_UNIT_BYTES)
        throw workspaceError(
          "workspace-import-too-large",
          `Converted UnitData is ${size} bytes, above the 900 KiB client limit for Workspace's 1 MiB units route. Reduce the Office file and upload it again.`,
          { size, maxBytes: MAX_IMPORT_UNIT_BYTES },
        );
      ctx.signal.throwIfAborted();
      ctx.onCreateUnit?.();
      return new WorkspaceUnitFeature(async () => ctx.http()).create(input);
    },
  });
}
