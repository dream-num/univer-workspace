import {
  ErrorCode,
  type IChangeset,
  type ISheetBlock,
  type ISnapshot,
  type UniverType,
} from "@univerjs/protocol";
import type { ScreenshotImageAsset } from "@univer-cli/unit-screenshot";
import { WorkspaceApplicationError, workspaceError } from "../../errors.js";
import { contentLength } from "../../files.js";
import {
  workspaceSnapshotPrefix,
  type WorkspaceRuntimeTarget,
  type WorkspaceUnitType,
} from "../../runtime/target.js";
import { isWorkspaceRecord, WorkspaceHttp } from "../../transport/http.js";
import { resolveWorkspaceAssetContent } from "../asset/content.js";

const WIRE_TYPES = {
  base: 5,
  board: 6,
  doc: 1,
  sheet: 2,
  slide: 3,
} as const satisfies Record<WorkspaceUnitType, UniverType>;

const UNIT_TYPES = [
  "sheet",
  "doc",
  "slide",
  "base",
  "board",
] as const satisfies readonly WorkspaceUnitType[];

export class WorkspaceContentSource {
  public constructor(private readonly http: WorkspaceHttp) {}

  public async resolveRuntimeTarget(input: {
    readonly unitId: string;
    readonly worktreeId: string;
  }): Promise<WorkspaceRuntimeTarget> {
    const body = await this.http.json(`/api/worktrees/${encodeURIComponent(input.worktreeId)}`);
    if (!isWorkspaceRecord(body["worktree"])) {
      throw responseError("Workspace Worktree response is invalid");
    }
    return resolveWorktreeTarget(this.http.origin, input, body["worktree"]);
  }

  public async resolveEditableRuntimeTarget(input: {
    readonly unitId: string;
    readonly worktreeId: string;
  }): Promise<WorkspaceRuntimeTarget> {
    const body = await this.http.json(`/api/worktrees/${encodeURIComponent(input.worktreeId)}`);
    if (!isWorkspaceRecord(body["worktree"])) {
      throw responseError("Workspace Worktree response is invalid");
    }
    const worktree = body["worktree"];
    if (worktree["state"] !== "draft") {
      throw workspaceError(
        "workspace-worktree-not-editable",
        `Worktree is ${String(worktree["state"])} not draft.`,
        { state: worktree["state"], worktreeId: input.worktreeId },
      );
    }
    return resolveWorktreeTarget(this.http.origin, input, worktree);
  }

  public async resolveTrunkRuntimeTarget(input: {
    readonly unitId: string;
  }): Promise<WorkspaceRuntimeTarget> {
    for (const unitType of UNIT_TYPES) {
      const candidate: WorkspaceRuntimeTarget = {
        origin: this.http.origin,
        revision: 0,
        scope: { kind: "trunk" },
        unitId: input.unitId,
        unitType,
      };
      try {
        const loaded = await this.readUnit(candidate);
        return { ...candidate, revision: loaded.headRevision };
      } catch (error) {
        if (isStoredUnitTypeMismatch(error)) continue;
        throw error;
      }
    }
    throw workspaceError(
      "workspace-unit-type-unsupported",
      "Workspace trunk Unit is not a supported inspectable Unit type.",
      { supportedUnitTypes: UNIT_TYPES, unitId: input.unitId },
    );
  }

  public async resolveReferencedRuntimeTarget(input: {
    readonly hostTarget: WorkspaceRuntimeTarget;
    readonly unitId: string;
  }): Promise<WorkspaceRuntimeTarget> {
    if (input.hostTarget.scope.kind === "trunk") {
      return await this.resolveTrunkRuntimeTarget({ unitId: input.unitId });
    }
    const worktreeId = input.hostTarget.scope.worktreeId;
    const body = await this.http.json(`/api/worktrees/${encodeURIComponent(worktreeId)}`);
    if (!isWorkspaceRecord(body["worktree"])) {
      throw responseError("Workspace Worktree response is invalid");
    }
    const worktree = body["worktree"];
    if (worktree["id"] !== worktreeId || !Array.isArray(worktree["units"])) {
      throw responseError("Workspace Worktree identity is invalid");
    }
    const mapped = worktree["units"].some(
      (candidate) => isWorkspaceRecord(candidate) && candidate["unitId"] === input.unitId,
    );
    return mapped
      ? resolveWorktreeTarget(this.http.origin, { unitId: input.unitId, worktreeId }, worktree)
      : await this.resolveTrunkRuntimeTarget({ unitId: input.unitId });
  }

  public async resolveImageAsset(input: {
    readonly assetId: string;
    readonly signal?: AbortSignal;
    readonly worktreeId: string;
  }): Promise<ScreenshotImageAsset> {
    const response = await resolveWorkspaceAssetContent(this.http, input);
    const mediaType = response.headers.get("content-type");
    if (mediaType === null || mediaType.length === 0 || response.body === null) {
      throw responseError("Workspace Asset download response is missing content metadata");
    }
    const declaredLength = contentLength(response, "Asset");
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      ...(declaredLength === undefined ? {} : { contentLength: declaredLength }),
      mediaType,
    };
  }

  public async getUnit(
    target: WorkspaceRuntimeTarget,
    signal?: AbortSignal,
  ): Promise<{
    readonly changesets: readonly IChangeset[];
    readonly snapshot: ISnapshot;
  }> {
    const { changesets, headRevision, snapshot } = await this.readUnit(target, signal);
    if (headRevision !== target.revision) {
      throw responseError(
        `Workspace head revision ${headRevision} does not match target revision ${target.revision}`,
      );
    }
    return { changesets, snapshot };
  }

  public async getSheetBlock(
    target: WorkspaceRuntimeTarget,
    blockId: string,
    signal?: AbortSignal,
  ): Promise<ISheetBlock> {
    const wireType = WIRE_TYPES[target.unitType];
    const body = await this.http.json(
      `${workspaceSnapshotPrefix(target.scope)}/${wireType}/unit/${encodeURIComponent(target.unitId)}/block/${encodeURIComponent(blockId)}`,
      signal === undefined ? {} : { signal },
    );
    if (!isWorkspaceRecord(body["block"]) || body["block"]["id"] !== blockId) {
      throw responseError(`Workspace response is missing block ${blockId}`);
    }
    return {
      ...body["block"],
      data: decodeBytes(body["block"]["data"], `block ${blockId}`),
    } as unknown as ISheetBlock;
  }

  private async readUnit(
    target: WorkspaceRuntimeTarget,
    signal?: AbortSignal,
  ): Promise<{
    readonly changesets: readonly IChangeset[];
    readonly headRevision: number;
    readonly snapshot: ISnapshot;
  }> {
    const wireType = WIRE_TYPES[target.unitType];
    const body = await this.http.json(
      `${workspaceSnapshotPrefix(target.scope)}/${wireType}/unit/${encodeURIComponent(target.unitId)}/rev/0`,
      signal === undefined ? {} : { signal },
    );
    if (!isWorkspaceRecord(body["snapshot"]) || !Array.isArray(body["changesets"])) {
      throw responseError("Workspace snapshot response is invalid");
    }
    const snapshot = decodeSnapshot(body["snapshot"], target, wireType);
    const changesets = body["changesets"].map((value) => decodeChangeset(value, target, wireType));
    return {
      changesets,
      headRevision: changesets.at(-1)?.revision ?? snapshot.rev,
      snapshot,
    };
  }
}

function resolveWorktreeTarget(
  origin: string,
  input: { readonly unitId: string; readonly worktreeId: string },
  worktree: Record<string, unknown>,
): WorkspaceRuntimeTarget {
  if (worktree["id"] !== input.worktreeId || !Array.isArray(worktree["units"])) {
    throw responseError("Workspace Worktree identity is invalid");
  }
  const unit = worktree["units"].find(
    (candidate): candidate is Record<string, unknown> =>
      isWorkspaceRecord(candidate) && candidate["unitId"] === input.unitId,
  );
  if (unit === undefined) {
    throw workspaceError(
      "WORKSPACE_UNIT_NOT_FOUND",
      `Unit ${input.unitId} is not in Worktree ${input.worktreeId}`,
    );
  }
  if (!isUnitType(unit["unitType"]) || !isRevision(unit["draftHeadRevision"])) {
    throw responseError("Workspace Unit target is invalid");
  }
  return {
    origin,
    revision: unit["draftHeadRevision"],
    scope: { kind: "worktree", worktreeId: input.worktreeId },
    unitId: input.unitId,
    unitType: unit["unitType"],
  };
}

function isStoredUnitTypeMismatch(error: unknown): boolean {
  return (
    error instanceof WorkspaceApplicationError &&
    error.code === String(ErrorCode.INVALID_ARGUMENT) &&
    error.message === "Unit type does not match the stored unit"
  );
}

function decodeSnapshot(
  value: Record<string, unknown>,
  target: WorkspaceRuntimeTarget,
  wireType: UniverType,
): ISnapshot {
  if (
    value["unitID"] !== target.unitId ||
    value["type"] !== wireType ||
    !Number.isSafeInteger(value["rev"])
  ) {
    throw responseError("Workspace returned a different snapshot");
  }
  const decoded = { ...value };
  if (wireType === 2 || wireType === 5) {
    if (!isWorkspaceRecord(value["workbook"]) || !isWorkspaceRecord(value["workbook"]["sheets"])) {
      throw responseError("Workspace workbook snapshot is invalid");
    }
    decoded["workbook"] = {
      ...value["workbook"],
      originalMeta: decodeBytes(value["workbook"]["originalMeta"], "workbook metadata"),
      sheets: Object.fromEntries(
        Object.entries(value["workbook"]["sheets"]).map(([id, sheet]) => {
          if (!isWorkspaceRecord(sheet)) {
            throw responseError(`Workspace Sheet ${id} metadata is invalid`);
          }
          return [
            id,
            { ...sheet, originalMeta: decodeBytes(sheet["originalMeta"], `Sheet ${id}`) },
          ];
        }),
      ),
    };
  } else {
    const field = wireType === 1 ? "doc" : wireType === 3 ? "slide" : "board";
    if (!isWorkspaceRecord(value[field])) {
      throw responseError(`Workspace ${field} snapshot is invalid`);
    }
    decoded[field] = {
      ...value[field],
      originalMeta: decodeBytes(value[field]["originalMeta"], `${field} metadata`),
    };
  }
  return decoded as unknown as ISnapshot;
}

function decodeChangeset(
  value: unknown,
  target: WorkspaceRuntimeTarget,
  wireType: UniverType,
): IChangeset {
  if (
    !isWorkspaceRecord(value) ||
    value["unitID"] !== target.unitId ||
    value["type"] !== wireType ||
    !Number.isSafeInteger(value["baseRev"]) ||
    !Number.isSafeInteger(value["revision"]) ||
    !Array.isArray(value["mutations"])
  ) {
    throw responseError("Workspace changeset is invalid");
  }
  return value as unknown as IChangeset;
}

function decodeBytes(value: unknown, subject: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== "string") throw responseError(`Workspace ${subject} is not base64`);
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isUnitType(value: unknown): value is WorkspaceUnitType {
  return (
    value === "sheet" ||
    value === "doc" ||
    value === "slide" ||
    value === "base" ||
    value === "board"
  );
}

function responseError(message: string): Error {
  return workspaceError("WORKSPACE_RESPONSE_INVALID", message);
}
