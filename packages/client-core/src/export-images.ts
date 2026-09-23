import { workspaceError } from "./errors.js";
import { rewriteWorkspaceImageReferences, visitWorkspaceImageReferences } from "./image-references.js";
import type { WorkspaceContentSource } from "./runtime-source.js";

/** Office conversion consumes inline images, while persisted Workspace content uses Asset IDs.
 * Resolve into an export-only copy; never write the expanded bytes back to the Unit. */
export async function resolveWorkspaceExportImages(
  data: Readonly<Record<string, unknown>>,
  worktreeId: string,
  resolve: WorkspaceContentSource["resolveImageAsset"],
): Promise<Readonly<Record<string, unknown>>> {
  const ids = new Set<string>();
  visitWorkspaceImageReferences(data, "UUID", ({ source }) => ids.add(source));
  const replacements = new Map<string, string>();
  for (const assetId of ids) {
    const asset = await resolve({ assetId, worktreeId });
    const mediaType = asset.mediaType.split(";")[0]!.trim().toLowerCase();
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mediaType) ||
        asset.bytes.byteLength === 0 || asset.bytes.byteLength > 20 * 1024 * 1024 ||
        (asset.contentLength !== undefined && asset.contentLength !== asset.bytes.byteLength)) {
      throw workspaceError("workspace-exchange-image-invalid", `Invalid image content for Workspace Asset ${assetId}.`);
    }
    replacements.set(assetId, `data:${mediaType};base64,${Buffer.from(asset.bytes).toString("base64")}`);
  }
  return rewriteWorkspaceImageReferences(data, "UUID", "BASE64", replacements) as Readonly<Record<string, unknown>>;
}
