import { WorkspaceHtmlViewFeature } from "@univerjs/univer-workspace-client-core";
import { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core/product";
import { opSpecs } from "../../shared/executor-protocol.js";
import type { Handler, OpContext } from "../context.js";

function htmlViewFeature(ctx: OpContext) {
  return new WorkspaceHtmlViewFeature({
    blobs: new WorkspaceBlobFeature(async () => ctx.http()),
    runtime: ctx.runtime,
    resolveTrunkRuntimeTarget: (input) => ctx.source().resolveTrunkRuntimeTarget(input),
    configuredOrigin: async () => ctx.http().origin,
  });
}

export const htmlViewValidate: Handler<"htmlView.validate"> = async (ctx, input) => ({
  output: await htmlViewFeature(ctx).validate({
    bytes: Buffer.from(input.html, "utf8"),
    name: "view.univer.html",
  }),
});

export const htmlViewCreate: Handler<"htmlView.create"> = async (
  ctx,
  { html, parentNodeId, ...input },
) => {
  ctx.usage.repo = input.spaceId;
  const result = await htmlViewFeature(ctx).create({
    ...input,
    ...(parentNodeId === undefined ? {} : { parentNodeId }),
    source: { bytes: Buffer.from(html, "utf8"), name: "view.univer.html" },
  });
  return { output: opSpecs["htmlView.create"].output.parse(result) };
};
