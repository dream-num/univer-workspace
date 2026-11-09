import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import {
  BaseExportMode,
  BaseFormulaPolicy,
  BaseImportMode,
  configureExchange,
  DocxCompatibilityMode,
  ExchangeError,
  ExchangeFormat,
  FormulaCalculationMode,
  importBuffer,
  importBufferToSnapshot,
  type BufferImportOptions,
  type ExportOptions,
  type IImportedFile,
  type IImportFileResult,
  type ISnapshotWithBlocks,
} from "@univerjs-pro/exchange-node";
// Registers the PDF conversion adapter (backed by @univerjs-pro/exchange-pdf-node-binding).
import "@univerjs-pro/exchange-node/pdf";
import {
  ErrorCode,
  FileSource,
  UniverType,
  type ISheetBlock,
  type ISnapshot,
} from "@univerjs/protocol";
import { UniverInstanceType } from "@univerjs/core";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import type { UnitSnapshotStore } from "../../integrations/univer/unit-store.js";
import {
  BUNDLED_UNIVER_LICENSE,
  type UniverLicenseCredentials,
} from "../../integrations/univer/univer-license.js";
import { ApplicationError } from "../../middleware/errors.js";
import { logger } from "../../logging/logger.js";
import type { AccessResolver, NodeAccess, UnitType } from "../access/index.js";
import type { ResourcesModule } from "../resources/index.js";
import type { SpacesModule } from "../spaces/index.js";
import {
  MAX_UNIVER_ASSET_BYTES,
  type ImportedUniverAsset,
  type UniverAssetsModule,
} from "../univer-assets/index.js";
import { keepsPdfImportFontInline } from "./workarounds/pdf-import-fonts.js";
import {
  exportLoadsFiles,
  exportWorkspaceSnapshot,
  type OleAttachmentSource,
} from "./export-files.js";

export const MAX_EXCHANGE_FILE_BYTES = 50 * 1024 * 1024;
const ARTIFACT_TTL_MS = 2 * 60 * 60 * 1000;
const OK = { code: ErrorCode.OK, message: "" } as const;
type ExchangeUnitType = Exclude<UnitType, "board">;

interface ExchangeArtifact {
  readonly id: string;
  readonly objectKey: string;
  readonly ownerUserId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly expiresAt: number;
}

interface ExchangeTaskBase {
  readonly id: string;
  readonly ownerUserId: string;
  readonly expiresAt: number;
}

type ExchangeTaskState =
  | {
      readonly kind: "import" | "export";
      readonly status: "pending";
    }
  | {
      readonly kind: "import";
      readonly status: "done";
      readonly result: {
        readonly outputType: 1 | 2;
        readonly unitID: string;
        readonly jsonID: string;
      };
    }
  | {
      readonly kind: "export";
      readonly status: "done";
      readonly result: {
        readonly fileID: string;
        readonly fileUrl: string;
      };
    }
  | {
      readonly kind: "import" | "export";
      readonly status: "failed";
      readonly message: string;
    };

type ExchangeTask = ExchangeTaskBase & ExchangeTaskState;
type ExchangeTaskCompletion = Extract<
  ExchangeTaskState,
  { readonly status: "done" }
>;

export interface ExchangeModule {
  acceptsUpload(source: unknown): boolean;
  upload(
    userId: string,
    input: {
      readonly size: unknown;
      readonly flate: unknown;
      readonly filename: string;
      readonly mediaType: string;
      readonly body: Readable;
    }
  ): Promise<{ readonly FileId: string; readonly error: typeof OK }>;
  importFile(
    userId: string,
    type: unknown,
    input: unknown
  ): Promise<{ readonly error: typeof OK; readonly taskID: string }>;
  exportFile(
    userId: string,
    type: unknown,
    input: unknown
  ): Promise<{ readonly error: typeof OK; readonly taskID: string }>;
  getTask(userId: string, taskId: string): Readonly<Record<string, unknown>>;
  signUrl(userId: string, fileId: string): Promise<{
    readonly error: typeof OK;
    readonly url: string;
    readonly mode: 1;
  } | null>;
  openFile(userId: string, fileId: string): Promise<{
    readonly filename: string;
    readonly mediaType: string;
    readonly byteSize: number;
    readonly stream: Readable;
  } | null>;
  dispose(): Promise<void>;
}

export function createExchangeModule(options: {
  readonly assets: Pick<UniverAssetsModule, "openContent" | "storeImported">;
  readonly access: AccessResolver;
  readonly resources: ResourcesModule;
  readonly spaces: SpacesModule;
  readonly snapshots: UnitSnapshotStore;
  readonly store: BlobStore;
  readonly now?: () => number;
  readonly maxFileBytes?: number;
  readonly license?: UniverLicenseCredentials;
}): ExchangeModule {
  const now = options.now ?? Date.now;
  const license = options.license ?? BUNDLED_UNIVER_LICENSE;
  let configured: Promise<void> | undefined;
  const maxFileBytes = options.maxFileBytes ?? MAX_EXCHANGE_FILE_BYTES;
  const artifacts = new Map<string, ExchangeArtifact>();
  const tasks = new Map<string, ExchangeTask>();
  const runningTasks = new Set<Promise<void>>();

  async function removeExpired(): Promise<void> {
    const current = now();
    const expired = [...artifacts.values()].filter(
      (artifact) => artifact.expiresAt <= current
    );
    for (const artifact of expired) {
      artifacts.delete(artifact.id);
      await options.store.delete(artifact.objectKey);
    }
    for (const task of tasks.values()) {
      if (task.expiresAt <= current) tasks.delete(task.id);
    }
  }

  async function saveArtifact(input: {
    readonly ownerUserId: string;
    readonly filename: string;
    readonly mediaType: string;
    readonly body: Readable;
    readonly byteSize: number;
  }): Promise<ExchangeArtifact> {
    if (input.byteSize > maxFileBytes) throw payloadTooLarge(maxFileBytes);
    await removeExpired();
    const id = randomUUID();
    const objectKey = randomUUID();
    await options.store.put({
      objectKey,
      body: input.body,
      expectedByteSize: input.byteSize,
      detectMediaType: false,
    });
    const artifact: ExchangeArtifact = {
      id,
      objectKey,
      ownerUserId: input.ownerUserId,
      filename: input.filename,
      mediaType: input.mediaType,
      byteSize: input.byteSize,
      expiresAt: now() + ARTIFACT_TTL_MS,
    };
    artifacts.set(id, artifact);
    return artifact;
  }

  function startTask(
    ownerUserId: string,
    kind: "import" | "export",
    execute: () => Promise<ExchangeTaskCompletion>
  ): string {
    const id = randomUUID();
    tasks.set(id, {
      id,
      ownerUserId,
      kind,
      status: "pending",
      expiresAt: now() + ARTIFACT_TTL_MS,
    });
    // Exchange credentials are process-wide; set them once before the first
    // conversion and retry on the next task if the SDK rejected them.
    configured ??= configureExchange(license).catch((error: unknown) => {
      configured = undefined;
      throw error;
    });
    const running = configured
      .then(execute)
      .then(
        (task) =>
          tasks.set(id, {
            ...task,
            id,
            ownerUserId,
            expiresAt: now() + ARTIFACT_TTL_MS,
          }),
        (error: unknown) => {
          // The task only keeps the SDK's code and message; the cause (a native binding that
          // did not load, a rejected license) is what operators need to diagnose a failure.
          logger.error({ err: error, taskId: id, kind }, "exchange task failed");
          tasks.set(id, {
            id,
            ownerUserId,
            kind,
            status: "failed",
            message: exchangeMessage(error),
            expiresAt: now() + ARTIFACT_TTL_MS,
          });
        }
      )
      .then(() => undefined)
      .finally(() => runningTasks.delete(running));
    runningTasks.add(running);
    return id;
  }

  function uploadSource(userId: string, fileID: string): ImportSource {
    const artifact = requireArtifact(artifacts, userId, fileID);
    return {
      filename: artifact.filename,
      read: () => readArtifact(options.store, artifact, maxFileBytes),
    };
  }

  // Converts a stored Office attachment of `sourceUnitID` into an independent Unit. The caller
  // must be able to open the host Unit, and the Asset must belong to that Unit; the new Unit
  // lands next to the host when the caller may create there, otherwise in the Personal Space.
  async function attachmentSource(
    userId: string,
    fileID: string,
    sourceUnitID: string
  ): Promise<ImportSource> {
    const access = options.access.resolveUnit(userId, sourceUnitID);
    if (!access || access.kind !== "univer" || !access.capabilities.openContent) {
      throw notFound();
    }
    const asset = await openAttachment(userId, fileID, sourceUnitID, (opened) => {
      opened.stream.destroy();
      return opened.asset;
    });
    const target = hostTarget(userId, access.node);
    return {
      filename: asset.original_filename,
      read: () =>
        openAttachment(userId, fileID, sourceUnitID, (opened) =>
          readStream(opened.stream, maxFileBytes)
        ),
      ...(target ? { target } : {}),
    };
  }

  async function openAttachment<T>(
    userId: string,
    fileID: string,
    sourceUnitID: string,
    use: (opened: Awaited<ReturnType<UniverAssetsModule["openContent"]>>) => Promise<T> | T
  ): Promise<T> {
    let opened: Awaited<ReturnType<UniverAssetsModule["openContent"]>>;
    try {
      opened = await options.assets.openContent(userId, { kind: "trunk" }, fileID, undefined);
    } catch {
      throw notFound();
    }
    if (opened.asset.unit_id !== sourceUnitID) {
      opened.stream.destroy();
      throw notFound();
    }
    if (opened.totalByteSize > maxFileBytes) {
      opened.stream.destroy();
      throw payloadTooLarge(maxFileBytes);
    }
    return use(opened);
  }

  function hostTarget(
    userId: string,
    node: NodeAccess
  ): { readonly spaceId: string; readonly parentNodeId: string | null } | undefined {
    if (node.parentNodeId) {
      const parent = options.access.resolveNode(userId, node.parentNodeId);
      return parent?.capabilities.createChildren
        ? { spaceId: node.spaceId, parentNodeId: node.parentNodeId }
        : undefined;
    }
    const space = options.access.resolveSpace(userId, node.spaceId);
    return space?.capabilities.createAtRoot
      ? { spaceId: node.spaceId, parentNodeId: null }
      : undefined;
  }

  return {
    acceptsUpload(source) {
      return Number(source) === FileSource.HttpImport;
    },

    async upload(userId, input) {
      const size = validSize(input.size, maxFileBytes);
      const flate = validBooleanQuery(input.flate);
      if (!input.filename || input.filename.length > 1024) {
        throw invalidInput("The uploaded filename is invalid.", "file");
      }
      const artifact = await saveArtifact({
        ownerUserId: userId,
        filename: input.filename,
        mediaType: input.mediaType || "application/octet-stream",
        body: flate ? input.body.pipe(createInflateRaw()) : input.body,
        byteSize: size,
      });
      return { FileId: artifact.id, error: OK };
    },

    async importFile(userId, typeValue, inputValue) {
      await removeExpired();
      const input = validImportRequest(inputValue);
      // A stored attachment of a Unit the caller can open, or the caller's own upload.
      const source = input.sourceUnitID
        ? await attachmentSource(userId, input.fileID, input.sourceUnitID)
        : uploadSource(userId, input.fileID);
      const unitType =
        typeValue === "auto"
          ? unitTypeFromFilename(source.filename)
          : unitTypeFromProtocol(typeValue);
      const taskID = startTask(userId, "import", async () => {
        const buffer = await source.read();
        const importOptions = exchangeImportOptions(
          unitType,
          source.filename,
          input.options
        );
        if (input.outputType === 2) {
          // JSON output keeps images and attachments inline: there is no Unit to own them.
          const converted = await importBufferToSnapshot(
            buffer,
            importOptions
          );
          const json = Buffer.from(
            JSON.stringify(snapshotToJson(converted))
          );
          const output = await saveArtifact({
            ownerUserId: userId,
            filename: `${stripExtension(source.filename)}.json`,
            mediaType: "application/json",
            body: Readable.from(json),
            byteSize: json.byteLength,
          });
          return {
            kind: "import",
            status: "done",
            result: { outputType: 2, unitID: "", jsonID: output.id },
          };
        }

        // Images and embedded attachments become Trunk Assets of the Unit this import creates.
        // The schema requires an Asset's Unit to exist, so the Unit ID is reserved first, the
        // Unit keeps only Asset IDs chosen while exchange-node converts, and the bytes are
        // written through the Asset upload lifecycle once the Resource exists. A failed
        // Resource creation therefore leaves no file behind.
        const unitId = randomUUID();
        const files: ImportedUniverAsset[] = [];
        const data = await importUnitData(
          buffer,
          withImportedFiles(importOptions, unitType, (file) => {
            if (file.size > MAX_UNIVER_ASSET_BYTES) return { mode: "inline" };
            if (unitType === "pdf" && keepsPdfImportFontInline(file)) return { mode: "inline" };
            const assetId = randomUUID();
            files.push({ assetId, filename: file.name, mediaType: file.mimeType, bytes: file.bytes });
            return { mode: "reference", source: assetId };
          })
        );
        const target =
          !input.spaceId && source.target
            ? source.target
            : importTarget(options.spaces, userId, input);
        const name = importedName(data, source.filename);
        const created = await options.resources.create(
          userId,
          randomUUID(),
          {
            kind: "univer",
            spaceId: target.spaceId,
            parentNodeId: target.parentNodeId,
            name,
            unitType,
            initialData: data,
          },
          { unitId }
        );
        if (created.status === 202) {
          throw new Error("The imported Resource could not be published.");
        }
        await options.assets.storeImported({ actorUserId: userId, unitId, files });
        const resource = created.body.node.resource;
        if (!resource || resource.kind !== "univer") {
          throw new Error("The imported Resource mapping is missing.");
        }
        const opened = options.resources.open(userId, resource.id);
        if (opened.resource.kind !== "univer") {
          throw new Error("The imported Resource is not a Univer Unit.");
        }
        return {
          kind: "import",
          status: "done",
          result: {
            outputType: 1,
            unitID: opened.resource.unitId,
            jsonID: "",
          },
        };
      });
      return { error: OK, taskID };
    },

    async exportFile(userId, typeValue, inputValue) {
      await removeExpired();
      const unitType = unitTypeFromProtocol(typeValue);
      const input = validExportRequest(inputValue, unitType);
      if (input.unitID) {
        const access = options.access.resolveUnit(userId, input.unitID);
        if (
          !access ||
          access.kind !== "univer" ||
          !access.capabilities.openContent ||
          access.unitType !== unitType
        ) {
          throw notFound();
        }
      } else {
        requireArtifact(artifacts, userId, input.jsonID!);
      }
      const taskID = startTask(userId, "export", async () => {
        let aggregate: ISnapshotWithBlocks;
        let name = "univer-export";
        if (input.unitID) {
          const access = options.access.resolveUnit(userId, input.unitID);
          if (!access || access.kind !== "univer") throw notFound();
          const materialized = await options.snapshots.materialize({
            userId,
            unitId: access.unitId,
            unitType,
          });
          aggregate = {
            snapshot: materialized.snapshot,
            sheetBlocks: [...(materialized.sheetBlocks ?? [])],
          };
          name = access.node.name;
        } else {
          const artifact = requireArtifact(
            artifacts,
            userId,
            input.jsonID!
          );
          const json = JSON.parse(
            (await readArtifact(options.store, artifact, maxFileBytes)).toString(
              "utf8"
            )
          ) as unknown;
          aggregate = snapshotFromJson(json);
          name = stripExtension(artifact.filename);
        }
        const output = await exportWorkspaceSnapshot(
          aggregate,
          exchangeExportOptions(unitType, input.format, input.options),
          {
            userId,
            assets: options.assets,
            access: options.access,
            snapshots: options.snapshots,
            attachmentSource: input.attachmentSource,
          }
        );
        const artifact = await saveArtifact({
          ownerUserId: userId,
          filename: `${safeFilename(name)}.${input.format}`,
          mediaType: mediaType(input.format),
          body: Readable.from(output),
          byteSize: output.byteLength,
        });
        return {
          kind: "export",
          status: "done",
          result: { fileID: artifact.id, fileUrl: "" },
        };
      });
      return { error: OK, taskID };
    },

    getTask(userId, taskId) {
      const current = now();
      for (const task of tasks.values()) {
        if (task.expiresAt <= current) tasks.delete(task.id);
      }
      const task = tasks.get(taskId);
      if (!task || task.ownerUserId !== userId) {
        return {
          error: {
            code: ErrorCode.NOT_FOUND,
            message: "The exchange task was not found.",
          },
          taskID: taskId,
          status: "failed",
        };
      }
      if (task.status === "pending") {
        return { error: OK, taskID: task.id, status: "pending" };
      }
      if (task.status === "failed") {
        return {
          error: { code: ErrorCode.INTERNAL_ERROR, message: task.message },
          taskID: task.id,
          status: "failed",
        };
      }
      return task.kind === "import"
        ? {
            error: OK,
            taskID: task.id,
            status: "done",
            import: task.result,
          }
        : {
            error: OK,
            taskID: task.id,
            status: "done",
            export: task.result,
          };
    },

    async signUrl(userId, fileId) {
      await removeExpired();
      const artifact = artifacts.get(fileId);
      if (!artifact || artifact.ownerUserId !== userId) return null;
      return {
        error: OK,
        url: `/universer-api/file/${encodeURIComponent(fileId)}/content`,
        mode: 1,
      };
    },

    async openFile(userId, fileId) {
      await removeExpired();
      const artifact = artifacts.get(fileId);
      if (!artifact || artifact.ownerUserId !== userId) return null;
      const opened = await options.store.open({
        objectKey: artifact.objectKey,
      });
      return {
        filename: artifact.filename,
        mediaType: artifact.mediaType,
        byteSize: opened.totalByteSize,
        stream: opened.stream,
      };
    },

    async dispose() {
      await Promise.allSettled([...runningTasks]);
      const current = [...artifacts.values()];
      artifacts.clear();
      tasks.clear();
      await Promise.all(
        current.map((artifact) => options.store.delete(artifact.objectKey))
      );
    },
  };
}

function validImportRequest(value: unknown): {
  readonly fileID: string;
  readonly outputType: 1 | 2;
  readonly options: unknown;
  readonly spaceId: string | null;
  readonly parentNodeId: string | null;
  /** The Unit whose stored attachment `fileID` is converted into an online Unit. */
  readonly sourceUnitID: string | null;
} {
  const record = requireRecord(value);
  if (typeof record.fileID !== "string" || !record.fileID) {
    throw invalidInput("fileID is required.", "fileID");
  }
  if (record.outputType !== 1 && record.outputType !== 2) {
    throw invalidInput("outputType must be UNIT (1) or JSON (2).", "outputType");
  }
  const sourceUnitID = optionalId(record.sourceUnitID, "sourceUnitID");
  if (sourceUnitID && record.outputType !== 1) {
    throw invalidInput("sourceUnitID requires outputType UNIT (1).", "sourceUnitID");
  }
  return {
    fileID: record.fileID,
    outputType: record.outputType,
    options: record.options,
    spaceId: optionalId(record.spaceId, "spaceId"),
    parentNodeId: optionalId(record.parentNodeId, "parentNodeId"),
    sourceUnitID,
  };
}

interface ImportSource {
  readonly filename: string;
  read(): Promise<Buffer>;
  /** Where the imported Unit lands when the request names no Space; the host Unit's folder. */
  readonly target?: { readonly spaceId: string; readonly parentNodeId: string | null };
}

/**
 * exchange-node splits images and attachments out of Sheet, Doc and Slide imports, and the
 * decoded images, fonts and source streams out of PDF imports. A PDF Unit draws an image or
 * font only through the `resourceBindings` that `files.store` produces: without the hook the
 * bytes stay inline in `document.assets` and the editor draws no images at all.
 */
function withImportedFiles(
  importOptions: BufferImportOptions,
  unitType: ExchangeUnitType,
  store: (file: IImportedFile) => IImportFileResult
): BufferImportOptions {
  if (unitType !== "sheet" && unitType !== "doc" && unitType !== "slide" && unitType !== "pdf") {
    return importOptions;
  }
  return {
    ...importOptions,
    files: { store: (file: IImportedFile) => Promise.resolve(store(file)) },
  } as BufferImportOptions;
}

async function readStream(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) throw payloadTooLarge(maxBytes);
      chunks.push(bytes);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks);
}

function importTarget(
  spaces: SpacesModule,
  userId: string,
  input: {
    readonly spaceId: string | null;
    readonly parentNodeId: string | null;
  }
): { readonly spaceId: string; readonly parentNodeId: string | null } {
  if (input.spaceId) {
    return { spaceId: input.spaceId, parentNodeId: input.parentNodeId };
  }
  if (input.parentNodeId) {
    throw invalidInput(
      "spaceId is required when parentNodeId is provided.",
      "spaceId"
    );
  }
  const personalSpace = spaces
    .list(userId)
    .spaces.find(
      (space) => space.type === "personal" && space.accessRole === "owner"
    );
  if (!personalSpace) {
    throw new Error("The current user has no Personal Space.");
  }
  return { spaceId: personalSpace.id, parentNodeId: null };
}

function validExportRequest(
  value: unknown,
  unitType: ExchangeUnitType
): {
  readonly unitID: string | null;
  readonly jsonID: string | null;
  readonly format: ExchangeFormat;
  readonly options: unknown;
  readonly attachmentSource: OleAttachmentSource;
} {
  const record = requireRecord(value);
  const unitID = optionalId(record.unitID, "unitID");
  const jsonID = optionalId(record.jsonID, "jsonID");
  if ((unitID === null) === (jsonID === null)) {
    throw invalidInput(
      "Exactly one of unitID or jsonID is required.",
      "unitID"
    );
  }
  const format = validExportFormat(record.format, unitType);
  // exchange-node embeds online attachment versions only in exports that take files. Those
  // exports embed the current online document of every converted attachment unless the request
  // asks for the original files; the others only ever carry the original attachment bytes.
  const loadsFiles = exportLoadsFiles({ type: instanceTypeOf(unitType), format });
  const attachmentSource =
    optionalRecord(record.options)?.oleAttachmentSource ?? (loadsFiles ? "online" : "original");
  if (attachmentSource !== "original" && attachmentSource !== "online") {
    throw invalidInput(
      "oleAttachmentSource must be original or online.",
      "oleAttachmentSource"
    );
  }
  if (attachmentSource === "online" && !loadsFiles) {
    throw invalidInput(
      "Online attachment versions are only available for XLSX, DOCX, PPTX and PDF exports.",
      "oleAttachmentSource"
    );
  }
  return { unitID, jsonID, format, options: record.options, attachmentSource };
}

function instanceTypeOf(unitType: ExchangeUnitType): UniverInstanceType {
  switch (unitType) {
    case "sheet":
      return UniverInstanceType.UNIVER_SHEET;
    case "doc":
      return UniverInstanceType.UNIVER_DOC;
    case "slide":
      return UniverInstanceType.UNIVER_SLIDE;
    case "base":
      return UniverInstanceType.UNIVER_BASE;
    case "pdf":
      return UniverInstanceType.UNIVER_PDF;
  }
}

function exchangeImportOptions(
  unitType: ExchangeUnitType,
  filename: string,
  value: unknown
): BufferImportOptions {
  const options = optionalRecord(value);
  const sheet = optionalRecord(options?.sheet);
  const base = optionalRecord(options?.base);
  const baseXlsx = optionalRecord(base?.xlsx);
  const doc = optionalRecord(options?.doc);
  if (unitType === "base") {
    return {
      type: UniverInstanceType.UNIVER_BASE,
      fileName: filename,
      ...optionalMappedValue(
        "mode",
        baseXlsx?.baseMode,
        "baseMode",
        baseImportMode
      ),
      ...optionalMappedValue(
        "formulaPolicy",
        baseXlsx?.baseFormulaPolicy,
        "baseFormulaPolicy",
        baseFormulaPolicy
      ),
    };
  }
  if (unitType === "doc") {
    return {
      type: UniverInstanceType.UNIVER_DOC,
      fileName: filename,
      ...optionalMappedValue(
        "compatibilityMode",
        doc?.docType,
        "docType",
        docxCompatibilityMode
      ),
    };
  }
  if (unitType === "pdf") {
    return {
      type: UniverInstanceType.UNIVER_PDF,
      fileName: filename,
    };
  }
  if (unitType === "sheet") {
    return {
      type: UniverInstanceType.UNIVER_SHEET,
      fileName: filename,
      ...(typeof sheet?.minSheetRowCount === "number"
        ? { minSheetRowCount: sheet.minSheetRowCount }
        : {}),
      ...(typeof sheet?.minSheetColumnCount === "number"
        ? { minSheetColumnCount: sheet.minSheetColumnCount }
        : {}),
      ...(extname(filename).toLowerCase() === ".xlsx"
        ? { formulaCalculation: FormulaCalculationMode.FORCED }
        : {}),
    };
  }
  return {
    type: UniverInstanceType.UNIVER_SLIDE,
    fileName: filename,
  };
}

function exchangeExportOptions(
  unitType: ExchangeUnitType,
  format: ExchangeFormat,
  value: unknown
): ExportOptions {
  const options = optionalRecord(value);
  const sheet = optionalRecord(options?.sheet);
  const csv = optionalRecord(sheet?.csv);
  const base = optionalRecord(options?.base);
  const baseCsv = optionalRecord(base?.csv);
  const baseXlsx = optionalRecord(base?.xlsx);
  if (unitType === "sheet") {
    return {
      type: UniverInstanceType.UNIVER_SHEET,
      format,
      ...(format === ExchangeFormat.XLSX
        ? { formulaCalculation: FormulaCalculationMode.WHEN_EMPTY }
        : {
            csv: {
              worksheetId: requiredSelector(csv?.sheetId, "sheetId"),
            },
          }),
    } as ExportOptions;
  }
  if (unitType === "base") {
    return {
      type: UniverInstanceType.UNIVER_BASE,
      format,
      ...(format === ExchangeFormat.XLSX
        ? {
            ...optionalMappedValue(
              "mode",
              baseXlsx?.baseExportMode,
              "baseExportMode",
              baseExportMode
            ),
            ...optionalMappedValue(
              "formulaPolicy",
              baseXlsx?.baseFormulaPolicy,
              "baseFormulaPolicy",
              baseFormulaPolicy
            ),
          }
        : {
            csv: {
              tableId: requiredSelector(baseCsv?.tableId, "tableId"),
            },
          }),
    } as ExportOptions;
  }
  if (unitType === "doc") {
    return {
      type: UniverInstanceType.UNIVER_DOC,
      format: ExchangeFormat.DOCX,
    };
  }
  if (unitType === "pdf") {
    return {
      type: UniverInstanceType.UNIVER_PDF,
      format: ExchangeFormat.PDF,
    };
  }
  return {
    type: UniverInstanceType.UNIVER_SLIDE,
    format: ExchangeFormat.PPTX,
  };
}

async function importUnitData(
  buffer: Buffer,
  options: BufferImportOptions
): Promise<Readonly<Record<string, unknown>>> {
  switch (options.type) {
    case UniverInstanceType.UNIVER_SHEET:
      return { ...(await importBuffer(buffer, options)) };
    case UniverInstanceType.UNIVER_BASE:
      return { ...(await importBuffer(buffer, options)) };
    case UniverInstanceType.UNIVER_DOC:
      return { ...(await importBuffer(buffer, options)) };
    case UniverInstanceType.UNIVER_SLIDE:
      return { ...(await importBuffer(buffer, options)) };
    case UniverInstanceType.UNIVER_PDF:
      return { ...(await importBuffer(buffer, options)) };
  }
}

function snapshotToJson(input: ISnapshotWithBlocks): {
  readonly snapshot: ISnapshot;
  readonly sheetBlocks: Readonly<Record<string, ISheetBlock>>;
} {
  const snapshot = structuredClone(input.snapshot);
  const workbook = snapshot.workbook as
    | {
        originalMeta?: Uint8Array | string;
        sheets?: Record<string, { originalMeta?: Uint8Array | string }>;
      }
    | undefined;
  if (workbook?.originalMeta instanceof Uint8Array) {
    workbook.originalMeta = Buffer.from(workbook.originalMeta).toString("base64");
  }
  for (const sheet of Object.values(workbook?.sheets ?? {})) {
    if (sheet.originalMeta instanceof Uint8Array) {
      sheet.originalMeta = Buffer.from(sheet.originalMeta).toString("base64");
    }
  }
  transformUnitMetaToBase64(snapshot);
  const sheetBlocks = Object.fromEntries(
    input.sheetBlocks.map((block) => [
      block.id,
      {
        ...block,
        data: Buffer.from(block.data).toString("base64"),
      },
    ])
  ) as unknown as Readonly<Record<string, ISheetBlock>>;
  return { snapshot, sheetBlocks };
}

function snapshotFromJson(value: unknown): ISnapshotWithBlocks {
  const record = requireRecord(value);
  const snapshot = structuredClone(
    requireRecord(record.snapshot)
  ) as unknown as ISnapshot;
  const workbook = snapshot.workbook as
    | {
        originalMeta?: string | Uint8Array;
        sheets?: Record<string, { originalMeta?: string | Uint8Array }>;
      }
    | undefined;
  if (typeof workbook?.originalMeta === "string") {
    workbook.originalMeta = Buffer.from(workbook.originalMeta, "base64");
  }
  for (const sheet of Object.values(workbook?.sheets ?? {})) {
    if (typeof sheet.originalMeta === "string") {
      sheet.originalMeta = Buffer.from(sheet.originalMeta, "base64");
    }
  }
  transformUnitMetaFromBase64(snapshot);
  const blocks = requireRecord(record.sheetBlocks);
  const sheetBlocks = Object.values(blocks).map((value) => {
    const block = requireRecord(value);
    if (typeof block.data !== "string") {
      throw invalidInput("A Sheet block has invalid data.", "sheetBlocks");
    }
    return {
      ...block,
      data: Buffer.from(block.data, "base64"),
    } as unknown as ISheetBlock;
  });
  return { snapshot, sheetBlocks };
}

function transformUnitMetaToBase64(snapshot: ISnapshot): void {
  for (const key of ["doc", "slide", "board", "pdf"] as const) {
    const meta = snapshot[key] as
      | { originalMeta?: Uint8Array | string }
      | undefined;
    if (meta?.originalMeta instanceof Uint8Array) {
      meta.originalMeta = Buffer.from(meta.originalMeta).toString("base64");
    }
  }
}

function transformUnitMetaFromBase64(snapshot: ISnapshot): void {
  for (const key of ["doc", "slide", "board", "pdf"] as const) {
    const meta = snapshot[key] as
      | { originalMeta?: Uint8Array | string }
      | undefined;
    if (typeof meta?.originalMeta === "string") {
      meta.originalMeta = Buffer.from(meta.originalMeta, "base64");
    }
  }
}

function unitTypeFromProtocol(value: unknown): ExchangeUnitType {
  switch (Number(value)) {
    case UniverType.UNIVER_SHEET:
      return "sheet";
    case UniverType.UNIVER_DOC:
      return "doc";
    case UniverType.UNIVER_SLIDE:
      return "slide";
    case UniverType.UNIVER_BASE:
      return "base";
    case UniverType.UNIVER_PDF:
      return "pdf";
    default:
      throw invalidInput("The Univer Unit type cannot be exchanged.", "type");
  }
}

function unitTypeFromFilename(filename: string): ExchangeUnitType {
  switch (extname(filename).toLowerCase()) {
    case ".xls":
    case ".xlsx":
    case ".csv":
    case ".tsv":
      return "sheet";
    case ".doc":
    case ".docx":
      return "doc";
    case ".ppt":
    case ".pptx":
      return "slide";
    case ".pdf":
      return "pdf";
    default:
      throw invalidInput(
        "The uploaded file type is not supported for document import.",
        "fileID"
      );
  }
}

function validExportFormat(
  value: unknown,
  unitType: ExchangeUnitType
): ExchangeFormat {
  const format = value ?? defaultFormat(unitType);
  const compatible =
    ((unitType === "sheet" || unitType === "base") &&
      [ExchangeFormat.XLSX, ExchangeFormat.CSV, ExchangeFormat.TSV].includes(
        format as ExchangeFormat
      )) ||
    (unitType === "doc" && format === ExchangeFormat.DOCX) ||
    (unitType === "slide" && format === ExchangeFormat.PPTX) ||
    (unitType === "pdf" && format === ExchangeFormat.PDF);
  if (!compatible) {
    throw invalidInput(
      `The ${String(format)} format is not valid for a ${unitType} Unit.`,
      "format"
    );
  }
  return format as ExchangeFormat;
}

function defaultFormat(unitType: ExchangeUnitType): ExchangeFormat {
  if (unitType === "doc") return ExchangeFormat.DOCX;
  if (unitType === "slide") return ExchangeFormat.PPTX;
  if (unitType === "pdf") return ExchangeFormat.PDF;
  return ExchangeFormat.XLSX;
}

function mediaType(format: ExchangeFormat): string {
  switch (format) {
    case ExchangeFormat.XLSX:
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ExchangeFormat.DOCX:
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ExchangeFormat.PPTX:
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ExchangeFormat.CSV:
      return "text/csv; charset=utf-8";
    case ExchangeFormat.TSV:
      return "text/tab-separated-values; charset=utf-8";
    case ExchangeFormat.PDF:
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

async function readArtifact(
  store: BlobStore,
  artifact: ExchangeArtifact,
  maxBytes: number
): Promise<Buffer> {
  const opened = await store.open({ objectKey: artifact.objectKey });
  if (opened.totalByteSize > maxBytes) throw payloadTooLarge(maxBytes);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of opened.stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > maxBytes) throw payloadTooLarge(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function requireArtifact(
  artifacts: ReadonlyMap<string, ExchangeArtifact>,
  userId: string,
  fileId: string
): ExchangeArtifact {
  const artifact = artifacts.get(fileId);
  if (!artifact || artifact.ownerUserId !== userId) throw notFound();
  return artifact;
}

function importedName(
  data: Readonly<Record<string, unknown>>,
  filename: string
): string {
  // The PDF converter names the Unit after the whole upload filename; other
  // converters carry a content title. Either way the Node takes the file stem.
  const candidate =
    (typeof data.name === "string" && data.name.trim() !== filename && data.name.trim()) ||
    (typeof data.title === "string" && data.title.trim()) ||
    stripExtension(filename) ||
    "Imported file";
  return candidate.slice(0, 255);
}

function safeFilename(value: string): string {
  return (
    value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200) ||
    "univer-export"
  );
}

function stripExtension(filename: string): string {
  const name = basename(filename);
  const extension = extname(name);
  return name.slice(0, Math.max(0, name.length - extension.length));
}

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 255) {
    throw invalidInput(`${field} is invalid.`, field);
  }
  return value;
}

function requiredSelector(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw invalidInput(`${field} is required for delimited export.`, field);
  }
  return value;
}

function optionalMappedValue<K extends string, T>(
  property: K,
  value: unknown,
  field: string,
  map: (value: string) => T | undefined
): Partial<Record<K, T>> {
  if (value === undefined) return {};
  if (typeof value !== "string") {
    throw invalidInput(`${field} is invalid.`, field);
  }
  const mapped = map(value);
  if (mapped === undefined) {
    throw invalidInput(`${field} is invalid.`, field);
  }
  return { [property]: mapped } as Record<K, T>;
}

function baseImportMode(value: string): BaseImportMode | undefined {
  return Object.values(BaseImportMode).includes(value as BaseImportMode)
    ? (value as BaseImportMode)
    : undefined;
}

function baseExportMode(value: string): BaseExportMode | undefined {
  return Object.values(BaseExportMode).includes(value as BaseExportMode)
    ? (value as BaseExportMode)
    : undefined;
}

function baseFormulaPolicy(value: string): BaseFormulaPolicy | undefined {
  if (value === "convert-then-values") {
    return BaseFormulaPolicy.CONVERT_THEN_VALUES;
  }
  return Object.values(BaseFormulaPolicy).includes(value as BaseFormulaPolicy)
    ? (value as BaseFormulaPolicy)
    : undefined;
}

function docxCompatibilityMode(
  value: string
): DocxCompatibilityMode | undefined {
  return Object.values(DocxCompatibilityMode).includes(
    value as DocxCompatibilityMode
  )
    ? (value as DocxCompatibilityMode)
    : undefined;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("A request body is required.");
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validSize(value: unknown, maxBytes: number): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw invalidInput("size must be a positive integer.", "size");
  }
  if (size > maxBytes) throw payloadTooLarge(maxBytes);
  return size;
}

function validBooleanQuery(value: unknown): boolean {
  if (value === undefined || value === "false" || value === false) return false;
  if (value === "true" || value === true) return true;
  throw invalidInput("flate must be true or false.", "flate");
}

function exchangeMessage(error: unknown): string {
  if (error instanceof ExchangeError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "The file conversion failed.";
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

function payloadTooLarge(maxBytes: number): ApplicationError {
  return new ApplicationError(
    "PAYLOAD_TOO_LARGE",
    413,
    `The exchange file exceeds the ${maxBytes} byte limit.`
  );
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
