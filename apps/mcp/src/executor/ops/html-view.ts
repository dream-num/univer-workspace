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
    ...(input.sourceWorktreeId === undefined ? {} : { sourceWorktreeId: input.sourceWorktreeId }),
  }),
});

export const htmlViewDraft: Handler<"htmlView.draft"> = async (ctx, input) => {
  if (input.kind === "create") ctx.usage.repo = input.spaceId;
  const { sourceWorktreeId } = input;
  const scope = sourceWorktreeId === undefined ? {} : { sourceWorktreeId };
  const source = { bytes: Buffer.from(input.html, "utf8"), name: "view.univer.html" };
  const result = await htmlViewFeature(ctx).draft(input.kind === "create" ? {
    ...scope,
    kind: input.kind, name: input.name, spaceId: input.spaceId, idempotencyKey: input.idempotencyKey, source,
    ...(input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId }),
  } : { kind: "replace", resourceId: input.resourceId, etag: input.etag,
    idempotencyKey: input.idempotencyKey, ...scope, source });
  ctx.usage.repo = result.spaceId;
  return { output: opSpecs["htmlView.draft"].output.parse({ draft: {
    ...(result.targetResourceId === null ? {} : { resource: result.targetResourceId }),
    ...htmlViewDraftResult(result), repositoryVisibility: result.repositoryVisibility,
    privateSourceUnitIds: result.privateSourceUnitIds,
  }, bindings: result.bindings, bindingCount: result.bindingCount,
    ...(result.truncated === undefined ? {} : { truncated: result.truncated }),
  }) };
};
