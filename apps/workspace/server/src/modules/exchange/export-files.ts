import {
  transformSnapshotToBaseData, transformSnapshotToDocumentData,
  transformSnapshotToPdfData, transformSnapshotToSlideData,
  transformSnapshotToWorkbookData,
} from "@univerjs-pro/collaboration";
import {
  exportToBuffer,
  type ExportOptions,
  type IExportFileRef,
  type IOleOnlineUnitRef,
  type ISnapshotWithBlocks,
} from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { ApplicationError } from "../../middleware/errors.js";
import type { UnitSnapshotStore } from "../../integrations/univer/unit-store.js";
import type { AccessResolver, UnitType } from "../access/index.js";
import type { UniverAssetsModule } from "../univer-assets/index.js";

/** Which version of converted Office attachments an export embeds; the client's `oleAttachmentSource`. */
export type OleAttachmentSource = "original" | "online";

export interface ExportFilesContext {
  readonly userId: string;
  readonly assets: Pick<UniverAssetsModule, "openContent">;
  readonly access: AccessResolver;
  readonly snapshots: Pick<UnitSnapshotStore, "materialize">;
  readonly attachmentSource: OleAttachmentSource;
}

const MAX_EXPORTED_FILE_BYTES = 20 * 1024 * 1024;

// A 1x1 transparent PNG. exchange-node requires `files.load` to return bytes for every reference,
// and URL images are not Workspace Assets, so they export blank.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Workspace owns Asset and Unit authorization; the SDK owns snapshot decoding and Office
 * conversion. Images and embedded attachments stay Trunk Assets referenced by ID: exchange-node
 * asks for each reference through `files.load`, and, when the caller chose the online attachment
 * version, reads every converted child Unit through `ole.loadOnlineUnit` with the caller's access.
 * Expanded bytes exist only in this export copy, never in collaboration storage.
 */
export async function exportWorkspaceSnapshot(
  aggregate: ISnapshotWithBlocks,
  options: ExportOptions,
  context: ExportFilesContext,
): Promise<Buffer> {
  async function load(ref: IExportFileRef): Promise<{ bytes: Uint8Array }> {
    if (ref.sourceType === "URL") return { bytes: TRANSPARENT_PNG };
    // Reading an Asset re-checks the access of the Unit that owns it, whichever snapshot
    // references it; an Asset the caller cannot read fails the export instead of exporting blank.
    let opened: Awaited<ReturnType<UniverAssetsModule["openContent"]>>;
    try {
      opened = await context.assets.openContent(context.userId, { kind: "trunk" }, ref.source, undefined);
    } catch {
      throw unexportable();
    }
    try {
      if (opened.totalByteSize > MAX_EXPORTED_FILE_BYTES) throw unexportable();
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of opened.stream) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > MAX_EXPORTED_FILE_BYTES) throw unexportable();
        chunks.push(bytes);
      }
      if (length !== opened.totalByteSize) throw unexportable();
      return { bytes: Buffer.concat(chunks) };
    } finally {
      opened.stream.destroy();
    }
  }

  async function loadOnlineUnit(ref: IOleOnlineUnitRef): Promise<ISnapshotWithBlocks> {
    const unitType = unitTypeOf(ref.type);
    const access = context.access.resolveUnit(context.userId, ref.unitId);
    if (
      !access ||
      access.kind !== "univer" ||
      !access.capabilities.openContent ||
      unitType === null ||
      access.unitType !== unitType
    ) {
      throw new ApplicationError(
        "NOT_FOUND",
        404,
        "A converted attachment's online document could not be exported.",
        "oleAttachmentSource",
      );
    }
    const materialized = await context.snapshots.materialize({
      userId: context.userId,
      unitId: access.unitId,
      unitType,
    });
    return { snapshot: materialized.snapshot, sheetBlocks: [...(materialized.sheetBlocks ?? [])] };
  }

  const withFiles = {
    ...options,
    ...(exportLoadsFiles(options) ? { files: { load } } : {}),
    ...(context.attachmentSource === "online"
      ? { ole: { attachmentSource: "online" as const, loadOnlineUnit } }
      : {}),
  } as ExportOptions;

  switch (withFiles.type) {
    case UniverInstanceType.UNIVER_DOC:
      return exportToBuffer(transformSnapshotToDocumentData(aggregate.snapshot), withFiles);
    case UniverInstanceType.UNIVER_SLIDE:
      return exportToBuffer(transformSnapshotToSlideData(aggregate.snapshot), withFiles);
    case UniverInstanceType.UNIVER_SHEET:
      return exportToBuffer(
        await transformSnapshotToWorkbookData(aggregate.snapshot, structuredClone(aggregate.sheetBlocks)),
        withFiles,
      );
    case UniverInstanceType.UNIVER_BASE:
      return exportToBuffer(
        await transformSnapshotToBaseData(aggregate.snapshot, structuredClone(aggregate.sheetBlocks)),
        withFiles,
      );
    case UniverInstanceType.UNIVER_PDF:
      return exportToBuffer(transformSnapshotToPdfData(aggregate.snapshot), withFiles);
    default:
      // exchange-node 1.4.0 also types Board → PPTX export; Workspace has not adopted it.
      throw new ApplicationError("INVALID_INPUT", 400, "Workspace does not export this Unit type.", "type");
  }
}

/**
 * Whether an export passes `files` and `ole`: exchange-node rejects them for Base and for CSV/TSV,
 * and the check names those rather than the accepted exports, as `withImportedFiles` does.
 */
export function exportLoadsFiles(options: { readonly type: UniverInstanceType; readonly format: string }): boolean {
  return options.type !== UniverInstanceType.UNIVER_BASE && options.format !== "csv" && options.format !== "tsv";
}

function unitTypeOf(type: UniverInstanceType): UnitType | null {
  switch (type) {
    case UniverInstanceType.UNIVER_SHEET:
      return "sheet";
    case UniverInstanceType.UNIVER_DOC:
      return "doc";
    case UniverInstanceType.UNIVER_SLIDE:
      return "slide";
    default:
      return null;
  }
}

function unexportable(): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, "Workspace file could not be exported.", "file");
}
