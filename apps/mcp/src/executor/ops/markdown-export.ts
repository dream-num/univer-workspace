import {
  WorkspaceExportMarkdownFeature,
  parseDocMarkdownSourceMap,
} from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { markdownExportOutput } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { markdownOperation } from "./markdown-errors.js";

export const markdownExport: Handler<"markdown.export"> = (ctx, input) =>
  markdownOperation(async () => {
    const result = await new WorkspaceExportMarkdownFeature({
      runtime: ctx.runtime,
      resolveRuntimeTarget: (target) => ctx.source().resolveRuntimeTarget(target),
      assetRequest: (path) => ctx.http().request(path, { acceptEncoding: "identity" }),
    }).execute({ ...input, sourceMap: parseDocMarkdownSourceMap(input.sourceMap) });
    let offset = 0;
    const chunks: Uint8Array[] = [];
    const assets = result.assets.map((asset) => {
      if (asset.encoding === "reference")
        throw workspaceError(
          "workspace-markdown-asset-unavailable",
          "Export contains an unresolved asset.",
        );
      const bytes = Buffer.from(asset.data, asset.encoding === "base64" ? "base64" : "utf8");
      if (bytes.length > 20_000_000 || offset + bytes.length > 50 * 1024 * 1024)
        throw workspaceError(
          "workspace-result-too-large",
          "Export assets exceed their byte limit.",
        );
      const entry = { path: asset.path, mimeType: asset.mimeType, offset, size: bytes.length };
      offset += bytes.length;
      chunks.push(bytes);
      return entry;
    });
    return {
      output: markdownExportOutput.parse({ ...result, assets }),
      bytes: Buffer.concat(chunks, offset),
    };
  });
