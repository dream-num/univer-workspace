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
  /** Streaming counterpart for client shells that own their output storage. */
  public async downloadStream(input: { readonly assetId: string; readonly worktreeId: string }) {
    const assetId = required(input.assetId, "Asset ID");
    const worktreeId = required(input.worktreeId, "Worktree ID");
    const response = await resolveWorkspaceAssetContent(await this.authenticatedHttp(), {
      assetId,
      worktreeId,
    });
    try {
      const mediaType = response.headers.get("content-type");
      if (!mediaType || response.body === null)
        throw workspaceError(
          "workspace-invalid-response",
          "Workspace Asset download response is missing content metadata.",
        );
      const size = contentLength(response, "Asset");
      return {
        content: checkedAssetContent(response, size),
        mediaType,
        size,
        etag: response.headers.get("etag"),
        fileName: assetId,
        close: async () => {
          await response.body?.cancel();
        },
      };
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "")
    throw workspaceError("workspace-argument-invalid", `${label} must not be empty.`);
  return normalized;
}

async function* checkedAssetContent(
  response: Response,
  expectedByteSize?: number,
): AsyncIterable<Uint8Array> {
  let actualByteSize = 0;
  try {
    for await (const chunk of responseContent(response)) {
      actualByteSize += chunk.byteLength;
      if (expectedByteSize !== undefined && actualByteSize > expectedByteSize)
        throw workspaceError(
          "workspace-asset-size-mismatch",
          "Asset byte stream does not match Content-Length.",
        );
      yield chunk;
    }
    if (expectedByteSize !== undefined && actualByteSize !== expectedByteSize)
      throw workspaceError(
        "workspace-asset-size-mismatch",
        "Asset byte stream does not match Content-Length.",
      );
  } finally {
    await response.body?.cancel();
  }
}
