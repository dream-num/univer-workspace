import { resolveWorkspaceAssetContent } from "./asset-content.js";
import { workspaceError } from "./errors.js";
import { contentLength, prepareDownload, responseContent } from "./files.js";
import type { AuthenticatedWorkspaceHttp } from "./http.js";

export class WorkspaceAssetFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async download(input: {
    readonly assetId: string;
    readonly force?: boolean;
    readonly outputPath: string;
    readonly worktreeId: string;
  }): Promise<Record<string, unknown>> {
    const assetId = required(input.assetId, "Asset ID");
    const worktreeId = required(input.worktreeId, "Worktree ID");
    const http = await this.authenticatedHttp();
    const target = await prepareDownload({
      kind: "asset",
      ...(input.force === true ? { force: true } : {}),
      outputPath: input.outputPath,
    });
    try {
      const response = await resolveWorkspaceAssetContent(http, { assetId, worktreeId });
      const mediaType = response.headers.get("content-type");
      if (mediaType === null || mediaType.length === 0 || response.body === null) {
        throw workspaceError(
          "workspace-invalid-response",
          "Workspace Asset download response is missing content metadata.",
        );
      }
      const size = contentLength(response, "Asset");
      const written = await target.writeAndCommit(responseContent(response), size);
      const etag = response.headers.get("etag");
      return {
        assetId,
        byteLength: written.byteSize,
        mediaType,
        outputPath: written.outputPath,
        worktreeId,
        ...(etag === null ? {} : { etag }),
      };
    } finally {
      await target.discard();
    }
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "")
    throw workspaceError("workspace-argument-invalid", `${label} must not be empty.`);
  return normalized;
}
