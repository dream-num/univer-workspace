import {
  transformSnapshotToBaseData, transformSnapshotToDocumentData,
  transformSnapshotToSlideData, transformSnapshotToWorkbookData,
} from "@univerjs-pro/collaboration";
import { exportToBuffer, type ExportOptions, type ISnapshotWithBlocks } from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { ApplicationError } from "../../middleware/errors.js";
import type { UniverAssetsModule } from "../univer-assets/index.js";

/** Workspace owns Asset authorization; the SDK owns snapshot decoding and Office conversion.
 * Expanded images exist only in this export copy, never in collaboration storage. */
export async function exportWorkspaceSnapshot(
  aggregate: ISnapshotWithBlocks,
  options: ExportOptions,
  assets: Pick<UniverAssetsModule, "openContent">,
  userId: string,
): Promise<Buffer> {
  const resolved = new Map<string, string>();
  async function inline<T>(data: T): Promise<T> {
    const copy = structuredClone(data);
    async function walk(value: unknown): Promise<void> {
      if (Array.isArray(value)) { for (const child of value) await walk(child); return; }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      for (const [sourceKey, typeKey] of [["source", "imageSourceType"], ["fillImageSource", "fillImageSourceType"], ["source", "sourceType"]] as const) {
        const id = record[sourceKey];
        if (record[typeKey] !== "UUID" || typeof id !== "string" || !id) continue;
        if (!resolved.has(id)) {
          const asset = await assets.openContent(userId, { kind: "trunk" }, id, undefined);
          try {
            const mime = asset.asset.media_type.split(";")[0]?.trim().toLowerCase();
            const limit = 20 * 1024 * 1024;
            if (!mime || !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mime) || asset.totalByteSize > limit) {
              throw new Error("Invalid image metadata");
            }
            const chunks: Buffer[] = []; let length = 0;
            for await (const chunk of asset.stream) {
              const bytes = Buffer.from(chunk); length += bytes.length;
              if (length > limit) throw new Error("Image exceeds size limit");
              chunks.push(bytes);
            }
            if (!length || length !== asset.totalByteSize) throw new Error("Incomplete image content");
            resolved.set(id, `data:${mime};base64,${Buffer.concat(chunks).toString("base64")}`);
          } catch {
            throw new ApplicationError("INVALID_INPUT", 400, "Workspace image could not be exported.", "file");
          } finally { asset.stream.destroy(); }
        }
        record[sourceKey] = resolved.get(id)!; record[typeKey] = "BASE64";
      }
      for (const [key, child] of Object.entries(record)) {
        if (key === "resources" && Array.isArray(child)) {
          for (const resource of child) {
            if (resource && typeof resource.data === "string") {
              let decoded: unknown;
              try { decoded = JSON.parse(resource.data); } catch { continue; }
              await walk(decoded); resource.data = JSON.stringify(decoded);
            }
          }
        }
        await walk(child);
      }
    }
    await walk(copy); return copy;
  }
  switch (options.type) {
    case UniverInstanceType.UNIVER_DOC:
      return exportToBuffer(await inline(transformSnapshotToDocumentData(aggregate.snapshot)), options);
    case UniverInstanceType.UNIVER_SLIDE:
      return exportToBuffer(await inline(transformSnapshotToSlideData(aggregate.snapshot)), options);
    case UniverInstanceType.UNIVER_SHEET:
      return exportToBuffer(await inline(await transformSnapshotToWorkbookData(aggregate.snapshot, structuredClone(aggregate.sheetBlocks))), options);
    case UniverInstanceType.UNIVER_BASE:
      return exportToBuffer(await inline(await transformSnapshotToBaseData(aggregate.snapshot, structuredClone(aggregate.sheetBlocks))), options);
  }
}
