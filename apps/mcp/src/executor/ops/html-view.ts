import { WorkspaceHtmlViewFeature } from "@univerjs/univer-workspace-client-core";
import { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core/product";
import { opSpecs } from "../../shared/executor-protocol.js";
import { htmlViewDraftResult } from "../../shared/html-view-draft.js";
import type { Handler, OpContext } from "../context.js";

function htmlViewFeature(ctx: OpContext) {
  return new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => ctx.http(),
    blobs: new WorkspaceBlobFeature(async () => ctx.http()),
    runtime: ctx.runtime,
    resolveTrunkRuntimeTarget: (input) => ctx.source().resolveTrunkRuntimeTarget(input),
    configuredOrigin: async () => ctx.http().origin,
    onWrite: () => {
      ctx.signal.throwIfAborted();
      ctx.onCreateUnit?.();
    },
  });
}

export const htmlViewValidate: Handler<"htmlView.validate"> = async (ctx, input) => ({
  output: await htmlViewFeature(ctx).validate({
    bytes: Buffer.from(input.html, "utf8"),
    name: "view.univer.html",
  }),
});

export const htmlViewDraft: Handler<"htmlView.draft"> = async (ctx, input) => {
  if (input.kind === "create") ctx.usage.repo = input.spaceId;
  const source = { bytes: Buffer.from(input.html, "utf8"), name: "view.univer.html" };
  const result = await htmlViewFeature(ctx).draft(input.kind === "create" ? {
    kind: input.kind, name: input.name, spaceId: input.spaceId, idempotencyKey: input.idempotencyKey, source,
    ...(input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId }),
  } : { ...input, source });
  ctx.usage.repo = result.spaceId;
  return { output: opSpecs["htmlView.draft"].output.parse({ draft: {
    ...(result.targetResourceId === null ? {} : { resource: result.targetResourceId }),
    ...htmlViewDraftResult(result), repositoryVisibility: result.repositoryVisibility,
    privateSourceUnitIds: result.privateSourceUnitIds,
  } }) };
};
