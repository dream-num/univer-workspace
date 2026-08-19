import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import {
  BaseExportMode,
  BaseFormulaPolicy,
  BaseImportMode,
  DocxCompatibilityMode,
  ExchangeError,
  ExchangeFormat,
  FormulaCalculationMode,
  exportSnapshotToBuffer,
  importBuffer,
  importBufferToSnapshot,
  type ExportOptions,
  type ImportOptions,
  type ISnapshotWithBlocks,
} from "@univerjs-pro/exchange-node";
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
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver, UnitType } from "../access/index.js";
import type { ResourcesModule } from "../resources/index.js";
import type { SpacesModule } from "../spaces/index.js";

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
  readonly access: AccessResolver;
  readonly resources: ResourcesModule;
  readonly spaces: SpacesModule;
  readonly snapshots: UnitSnapshotStore;
  readonly store: BlobStore;
  readonly now?: () => number;
  readonly maxFileBytes?: number;
}): ExchangeModule {
  const now = options.now ?? Date.now;
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
    const running = execute()
      .then(
        (task) =>
          tasks.set(id, {
            ...task,
            id,
            ownerUserId,
            expiresAt: now() + ARTIFACT_TTL_MS,
          }),
        (error: unknown) => {
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
      const unitType = unitTypeFromProtocol(typeValue);
      const input = validImportRequest(inputValue);
      const artifact = requireArtifact(artifacts, userId, input.fileID);
      const taskID = startTask(userId, "import", async () => {
        const buffer = await readArtifact(options.store, artifact, maxFileBytes);
        const importOptions = exchangeImportOptions(
          unitType,
          artifact.filename,
          input.options
        );
        if (input.outputType === 2) {
          const converted = await importBufferToSnapshot(
            buffer,
            importOptions as ImportOptions & { fileName: string }
          );
          const json = Buffer.from(
            JSON.stringify(snapshotToJson(converted))
          );
          const output = await saveArtifact({
            ownerUserId: userId,
            filename: `${stripExtension(artifact.filename)}.json`,
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

        const data = await importUnitData(buffer, importOptions);
        const personalSpace = options.spaces
          .list(userId)
          .spaces.find(
            (space) =>
              space.type === "personal" && space.accessRole === "owner"
          );
        if (!personalSpace) {
          throw new Error("The current user has no Personal Space.");
        }
        const name = importedName(data, artifact.filename);
        const created = await options.resources.create(userId, randomUUID(), {
          kind: "univer",
          spaceId: personalSpace.id,
          parentNodeId: null,
          name,
          unitType,
          initialData: data,
        });
        if (created.status === 202) {
          throw new Error("The imported Resource could not be published.");
        }
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
        const output = await exportSnapshotToBuffer(
          aggregate,
          exchangeExportOptions(unitType, input.format, input.options)
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
} {
  const record = requireRecord(value);
  if (typeof record.fileID !== "string" || !record.fileID) {
    throw invalidInput("fileID is required.", "fileID");
  }
  if (record.outputType !== 1 && record.outputType !== 2) {
    throw invalidInput("outputType must be UNIT (1) or JSON (2).", "outputType");
  }
  return {
    fileID: record.fileID,
    outputType: record.outputType,
    options: record.options,
  };
}

function validExportRequest(
  value: unknown,
  unitType: ExchangeUnitType
): {
  readonly unitID: string | null;
  readonly jsonID: string | null;
  readonly format: ExchangeFormat;
  readonly options: unknown;
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
  return { unitID, jsonID, format, options: record.options };
}

function exchangeImportOptions(
  unitType: ExchangeUnitType,
  filename: string,
  value: unknown
): ImportOptions & { fileName: string } {
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
    } as ImportOptions & { fileName: string };
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
    } as ImportOptions & { fileName: string };
  }
  return {
    type: instanceType(unitType),
    fileName: filename,
    ...(unitType === "sheet"
      ? {
          ...(typeof sheet?.minSheetRowCount === "number"
            ? { minSheetRowCount: sheet.minSheetRowCount }
            : {}),
          ...(typeof sheet?.minSheetColumnCount === "number"
            ? { minSheetColumnCount: sheet.minSheetColumnCount }
            : {}),
          ...(extname(filename).toLowerCase() === ".xlsx"
            ? { formulaCalculation: FormulaCalculationMode.FORCED }
            : {}),
        }
      : {}),
  } as ImportOptions & { fileName: string };
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
  return {
    type: UniverInstanceType.UNIVER_SLIDE,
    format: ExchangeFormat.PPTX,
  };
}

async function importUnitData(
  buffer: Buffer,
  options: ImportOptions & { fileName: string }
): Promise<Readonly<Record<string, unknown>>> {
  const convert = importBuffer as unknown as (
    input: Buffer,
    options: ImportOptions & { fileName: string }
  ) => Promise<Readonly<Record<string, unknown>>>;
  return await convert(buffer, options);
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
    default:
      throw invalidInput("The Univer Unit type cannot be exchanged.", "type");
  }
}

function instanceType(type: ExchangeUnitType): UniverInstanceType {
  switch (type) {
    case "sheet":
      return UniverInstanceType.UNIVER_SHEET;
    case "doc":
      return UniverInstanceType.UNIVER_DOC;
    case "slide":
      return UniverInstanceType.UNIVER_SLIDE;
    case "base":
      return UniverInstanceType.UNIVER_BASE;
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
    (unitType === "slide" && format === ExchangeFormat.PPTX);
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
  const candidate =
    (typeof data.name === "string" && data.name.trim()) ||
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
