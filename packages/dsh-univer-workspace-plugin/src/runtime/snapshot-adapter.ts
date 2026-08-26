/**
 * Read-only snapshot server adapter over the workspace snapshot HTTP API.
 * This is the authoritative read half of `ISnapshotServerService`; the write
 * half fails closed because the workspace server owns snapshot persistence and
 * the headless client never writes it.
 * @module dsh-univer-workspace-plugin/runtime/snapshot-adapter
 */

import type { ILogContext, ISnapshotServerService } from "@univerjs-pro/collaboration";
import type {
  IChangeset,
  ICopyFileMetaRequest,
  ICopyFileMetaResponse,
  IFetchMissingChangesetsRequest,
  IFetchMissingChangesetsResponse,
  IGetDeserializedSheetBlockResponse,
  IGetLatestCsReqIdBySidRequest,
  IGetLatestCsReqIdBySidResponse,
  IGetResourcesRequest,
  IGetResourcesResponse,
  IGetSheetBlockRequest,
  IGetSheetBlockResponse,
  IGetUnitOnRevRequest,
  IGetUnitOnRevResponse,
  ISaveChangesetRequest,
  ISaveChangesetResponse,
  ISaveSheetBlockRequest,
  ISaveSheetBlockResponse,
  ISaveSnapshotRequest,
  ISaveSnapshotResponse,
  ISheetBlock,
  ISnapshot,
} from "@univerjs/protocol";
import { workspaceSnapshotPrefix, type WorkspaceRuntimeScope } from "./target.js";
import type { WorkerHttp } from "./worker-http.js";

export class WorkspaceSnapshotServerAdapter implements ISnapshotServerService {
  public constructor(
    private readonly options: {
      readonly hostScope: WorkspaceRuntimeScope;
      readonly http: WorkerHttp;
    },
  ) {}

  public async getUnitOnRev(
    context: ILogContext,
    params: IGetUnitOnRevRequest,
  ): Promise<IGetUnitOnRevResponse> {
    const type = requireType(params.type);
    const body = await this.options.http.json(
      `${this.prefix(context, params.unitID)}/${type}/unit/${encodeURIComponent(params.unitID)}/rev/${params.revision}`,
    );
    const changesets = parseChangesets(body["changesets"], params.unitID, type);
    const snapshot =
      body["snapshot"] === undefined || body["snapshot"] === null
        ? undefined
        : decodeSnapshot(body["snapshot"], params.unitID, type);
    return { changesets, error: parseError(body["error"]), snapshot };
  }

  public async getSheetBlock(
    context: ILogContext,
    params: IGetSheetBlockRequest,
  ): Promise<IGetSheetBlockResponse> {
    return await this.getBlock(context, params, false);
  }

  public async getDeserializedSheetBlock(
    context: ILogContext,
    params: IGetSheetBlockRequest,
  ): Promise<IGetDeserializedSheetBlockResponse | IGetSheetBlockResponse> {
    return await this.getBlock(context, params, true);
  }

  public async fetchMissingChangesets(
    context: ILogContext,
    params: IFetchMissingChangesetsRequest,
  ): Promise<IFetchMissingChangesetsResponse> {
    const type = requireType(params.type);
    const query = new URLSearchParams({ from: String(params.from), to: String(params.to) });
    const body = await this.options.http.json(
      `${this.prefix(context, params.unitID)}/${type}/unit/${encodeURIComponent(params.unitID)}/fetchmissing?${query.toString()}`,
    );
    const latestRevision = body["latestRevision"];
    if (latestRevision !== undefined && !isRevision(latestRevision)) {
      throw invalidResponse("Workspace missing-changeset revision is invalid.");
    }
    return {
      changesets: parseChangesets(body["changesets"], params.unitID, type),
      error: parseError(body["error"]),
      ...(latestRevision === undefined ? {} : { latestRevision }),
    };
  }

  public async getResourcesRequest(
    context: ILogContext,
    params: IGetResourcesRequest,
  ): Promise<IGetResourcesResponse> {
    const type = requireType(params.type);
    const query = new URLSearchParams({ resourceId: JSON.stringify(params.resourceIDs) });
    const body = await this.options.http.json(
      `${this.prefix(context, params.unitID)}/${type}/unit/${encodeURIComponent(params.unitID)}/resources?${query.toString()}`,
    );
    if (!isRecord(body["resources"])) {
      throw invalidResponse("Workspace resource response is invalid.");
    }
    return { error: parseError(body["error"]), resources: body["resources"] as IGetResourcesResponse["resources"] };
  }

  public async saveSnapshot(
    context: ILogContext,
    params: ISaveSnapshotRequest,
  ): Promise<ISaveSnapshotResponse> {
    throw this.readOnly(context, params.unitID);
  }

  public async updateSnapshot(
    context: ILogContext,
    params: ISaveSnapshotRequest,
  ): Promise<ISaveSnapshotResponse> {
    throw this.readOnly(context, params.unitID);
  }

  public async saveSheetBlock(
    context: ILogContext,
    params: ISaveSheetBlockRequest,
  ): Promise<ISaveSheetBlockResponse> {
    throw this.readOnly(context, params.unitID);
  }

  public async saveChangeset(
    context: ILogContext,
    _params: ISaveChangesetRequest,
  ): Promise<ISaveChangesetResponse> {
    throw this.readOnly(context);
  }

  public async copyFileMeta(
    context: ILogContext,
    _params: ICopyFileMetaRequest,
  ): Promise<ICopyFileMetaResponse> {
    throw this.readOnly(context);
  }

  public async getLatestCsReqIdBySid(
    context: ILogContext,
    params: IGetLatestCsReqIdBySidRequest,
  ): Promise<IGetLatestCsReqIdBySidResponse> {
    throw this.readOnly(context, params.unitID);
  }

  private async getBlock(
    context: ILogContext,
    params: IGetSheetBlockRequest,
    deserialized: boolean,
  ): Promise<IGetSheetBlockResponse> {
    const type = requireType(params.type);
    const prefix = this.prefix(context, params.unitID);
    const path = deserialized
      ? `${prefix}/block/${type}/unit/${encodeURIComponent(params.unitID)}/block/${encodeURIComponent(params.blockID)}`
      : `${prefix}/${type}/unit/${encodeURIComponent(params.unitID)}/block/${encodeURIComponent(params.blockID)}`;
    const body = await this.options.http.json(path);
    const value = body["block"];
    if (value === undefined || value === null) {
      return { block: undefined, error: parseError(body["error"]) };
    }
    if (!isRecord(value) || value["id"] !== params.blockID) {
      throw invalidResponse("Workspace Sheet block response is invalid.");
    }
    const block = {
      ...value,
      ...(deserialized ? {} : { data: decodeBytes(value["data"], `block ${params.blockID}`) }),
    } as unknown as ISheetBlock;
    return { block, error: parseError(body["error"]) };
  }

  private prefix(context: ILogContext, unitId: string): string {
    void context;
    return workspaceSnapshotPrefix(this.options.hostScope);
  }

  private readOnly(_context: ILogContext, _unitId?: string): Error {
    return new Error("workspace referenced source units are read-only for the headless worker");
  }
}

function decodeSnapshot(value: unknown, unitId: string, type: number): ISnapshot {
  if (!isRecord(value) || value["unitID"] !== unitId || value["type"] !== type || !isRevision(value["rev"])) {
    throw invalidResponse("Workspace returned a different Snapshot.");
  }
  const decoded: Record<string, unknown> = { ...value };
  if (type === 2 || type === 5) {
    const workbook = value["workbook"];
    if (!isRecord(workbook) || !isRecord(workbook["sheets"])) {
      throw invalidResponse("Workspace workbook Snapshot is invalid.");
    }
    decoded["workbook"] = {
      ...workbook,
      originalMeta: decodeBytes(workbook["originalMeta"], "workbook metadata"),
      sheets: Object.fromEntries(
        Object.entries(workbook["sheets"]).map(([sheetId, sheet]) => {
          if (!isRecord(sheet)) throw invalidResponse(`Workspace Sheet ${sheetId} metadata is invalid.`);
          return [sheetId, { ...sheet, originalMeta: decodeBytes(sheet["originalMeta"], `Sheet ${sheetId}`) }];
        }),
      ),
    };
  } else {
    const field = type === 1 ? "doc" : type === 3 ? "slide" : "board";
    const metadata = value[field];
    if (!isRecord(metadata)) throw invalidResponse(`Workspace ${field} Snapshot is invalid.`);
    decoded[field] = { ...metadata, originalMeta: decodeBytes(metadata["originalMeta"], `${field} metadata`) };
  }
  return decoded as unknown as ISnapshot;
}

function parseChangesets(value: unknown, unitId: string, type: number): IChangeset[] {
  if (!Array.isArray(value)) throw invalidResponse("Workspace Snapshot response is missing changesets.");
  return value.map((changeset) => {
    if (
      !isRecord(changeset) ||
      changeset["unitID"] !== unitId ||
      changeset["type"] !== type ||
      !isRevision(changeset["baseRev"]) ||
      !isRevision(changeset["revision"]) ||
      !Array.isArray(changeset["mutations"])
    ) {
      throw invalidResponse("Workspace changeset is invalid.");
    }
    return changeset as unknown as IChangeset;
  });
}

function parseError(value: unknown): IGetUnitOnRevResponse["error"] {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || typeof value["code"] !== "number") {
    throw invalidResponse("Workspace protocol error envelope is invalid.");
  }
  return value as unknown as NonNullable<IGetUnitOnRevResponse["error"]>;
}

function requireType(value: unknown): 1 | 2 | 3 | 5 | 6 {
  if (value === 1 || value === 2 || value === 3 || value === 5 || value === 6) return value;
  throw new Error("workspace references support Sheet, Doc, Slide, Base and Board Units.");
}

function decodeBytes(value: unknown, subject: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== "string") throw invalidResponse(`Workspace ${subject} is not base64.`);
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): Error {
  return new Error(`workspace-invalid-response: ${message}`);
}
