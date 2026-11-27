import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  DEFAULT_WORKSHEET_COLUMN_COUNT,
  DEFAULT_WORKSHEET_ROW_COUNT,
  type IWorkbookData,
  type IWorksheetData,
  type ICellData,
} from "@univerjs/core";
import { getHtmlViewUnitIds, isHtmlViewFilename, parseHtmlView, type HtmlViewBinding } from "@univerjs-labs/html-view";
import { sessionIdentity } from "./auth.js";
import { WorkspaceBlobFeature } from "./blob.js";
import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import { parseHtmlViewDraft, readWorkspaceHtmlViewDraft } from "./html-view-draft.js";
import { readWorkspaceHtmlView, requireHtmlView, htmlViewUrls } from "./html-view-page.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import type { AuthenticatedWorkspaceHttp } from "./http.js";
import { parseDetachedNode, type WorkspaceSpace } from "./space-model.js";
import { WorkspaceSpaceFeature } from "./space.js";
import { WorkspaceContentSource } from "./runtime-source.js";
import { getWorktree } from "./worktree.js";
import type { WorkspaceWorktree } from "./worktree-model.js";
import { colName } from "./sheet-lens/lens/ranges.js";

export interface WorkspaceHtmlViewSource {
  readonly bytes: Uint8Array;
  readonly name: string;
}

export interface WorkspaceHtmlViewOptions {
  readonly authenticatedHttp: AuthenticatedWorkspaceHttp;
  readonly blobs:
    | Pick<WorkspaceBlobFeature, "upload">
    | Pick<WorkspaceBlobFeature, "uploadBytes">
    | Pick<WorkspaceBlobFeature, "get" | "uploadBytes" | "replaceBytes">;
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly resolveTrunkRuntimeTarget: (input: {
    readonly unitId: string;
  }) => Promise<WorkspaceRuntimeTarget>;
  readonly configuredOrigin: () => Promise<string>;
  readonly onWrite?: () => void;
}

export interface WorkspaceHtmlViewDestination {
  readonly name: string;
  readonly spaceId: string;
  readonly parentNodeId?: string;
  readonly idempotencyKey: string;
}

export interface WorkspaceHtmlViewReplacement {
  readonly resourceId: string;
  readonly etag: string;
  readonly idempotencyKey: string;
  readonly source: WorkspaceHtmlViewSource;
}

export type WorkspaceHtmlViewDraftRequest = { readonly sourceWorktreeId?: string } & (
  | (WorkspaceHtmlViewDestination & { readonly kind: "create"; readonly source: WorkspaceHtmlViewSource })
  | (WorkspaceHtmlViewReplacement & { readonly kind: "replace" })
  | { readonly kind: "revise"; readonly draftId: string; readonly idempotencyKey: string; readonly source: WorkspaceHtmlViewSource });

export interface WorkspaceHtmlViewCellSample {
  readonly value: string | number | boolean | null;
  readonly formula?: true;
  readonly format?: string;
}

export type WorkspaceHtmlViewBindingSample = {
  readonly unitId: string;
  readonly sheet: string;
  readonly ref: string;
} & (
  | { readonly kind: "text" | "model" | "cell"; readonly cell: WorkspaceHtmlViewCellSample }
  | { readonly kind: "range"; readonly range: {
      readonly rows: number;
      readonly columns: number;
      readonly filledRows: number;
      readonly head: WorkspaceHtmlViewCellSample[][];
    } }
);

export interface WorkspaceHtmlViewValidation {
  readonly valid: true;
  readonly unitIds: string[];
  readonly bindingCount: number;
  readonly bindings: WorkspaceHtmlViewBindingSample[];
  readonly truncated?: true;
}

export class WorkspaceHtmlViewFeature {
  public constructor(private readonly options: WorkspaceHtmlViewOptions) {}

  public async validate(input: WorkspaceHtmlViewSource & { readonly sourceWorktreeId?: string }) {
    const source = await this.readAndValidate(input, input.sourceWorktreeId);
    return source.validation;
  }

  public async create(
    input: WorkspaceHtmlViewDestination & { readonly source: WorkspaceHtmlViewSource },
  ) {
    const { name, spaceId, idempotencyKey, parentNodeId } = normalizeHtmlViewDestination(input);
    const source = await this.readAndValidate(input.source);
    const origin = await this.options.configuredOrigin();
    const access = await this.describeAccess(spaceId, source.validation.unitIds);
    const upload =
      "uploadBytes" in this.options.blobs
        ? await this.options.blobs.uploadBytes({
            bytes: source.bytes,
            fileName: basename(source.filePath),
            name,
            spaceId,
            idempotencyKey,
            ...(parentNodeId === undefined ? {} : { parentNodeId }),
          })
        : await this.uploadFile(this.options.blobs, source, {
            name,
            spaceId,
            idempotencyKey,
            ...(parentNodeId === undefined ? {} : { parentNodeId }),
          });
    if (typeof upload["nodeId"] !== "string" || upload["nodeId"].length === 0) {
      throw workspaceError(
        "workspace-invalid-response",
        "HTML View upload did not return a Node ID.",
      );
    }
    return {
      ...upload,
      ...htmlViewUrls(origin, upload["nodeId"]),
      ...access,
    };
  }

  public async read(resourceId: string, maxChars: number) {
    return await readWorkspaceHtmlView(this.options.authenticatedHttp, resourceId, maxChars);
  }

  public async replace(input: WorkspaceHtmlViewReplacement) {
    const blobs = this.options.blobs;
    if (!("get" in blobs) || !("replaceBytes" in blobs)) {
      throw workspaceError(
        "workspace-server-capability-missing",
        "HTML View replacement requires Blob read and replacement capabilities.",
      );
    }
    const view = await blobs.get(input.resourceId);
    requireHtmlView(view.node.name);
    const source = await this.readAndValidate(input.source);
    const origin = await this.options.configuredOrigin();
    const access = await this.describeAccess(view.node.spaceId, source.validation.unitIds);
    const replacement = await blobs.replaceBytes({
      resourceId: input.resourceId,
      etag: input.etag,
      idempotencyKey: input.idempotencyKey,
      bytes: source.bytes,
      fileName: view.node.name,
    });
    return {
      ...replacement,
      nodeId: view.node.nodeId,
      ...htmlViewUrls(origin, view.node.nodeId),
      ...access,
    };
  }

  public async draft(input: WorkspaceHtmlViewDraftRequest) {
    const http = await this.options.authenticatedHttp();
    const intent = input.kind === "create"
      ? { kind: input.kind, ...normalizeHtmlViewDestination(input) }
      : input.kind === "revise" ? { kind: input.kind, draftId: input.draftId, idempotencyKey: input.idempotencyKey }
      : { kind: input.kind, resourceId: input.resourceId, etag: input.etag, idempotencyKey: input.idempotencyKey };
    const previous = intent.kind === "revise" ? await readWorkspaceHtmlViewDraft(async () => http, await this.options.configuredOrigin(), intent.draftId) : undefined;
    const sourceWorktreeId = input.sourceWorktreeId ?? previous?.sourceWorktreeId ?? undefined;
    let spaceId: string;
    if (intent.kind === "create") {
      spaceId = intent.spaceId;
    } else if (intent.kind === "revise" && previous) {
      spaceId = previous.spaceId;
    } else if (intent.kind === "replace") {
      if (!/^"[^"\r\n]+"$/.test(intent.etag) || intent.etag.length > 200)
        throw workspaceError("workspace-argument-invalid", "ETag must be the exact quoted strong ETag from html_view_read.");
      const view = await new WorkspaceBlobFeature(async () => http).get(intent.resourceId);
      requireHtmlView(view.node.name);
      spaceId = view.node.spaceId;
    } else throw workspaceError("workspace-invalid-response", "Revision draft is missing.");
    const source = await this.readAndValidate(input.source, sourceWorktreeId);
    const worktree = source.worktree;
    const origin = await this.options.configuredOrigin();
    const access = await this.describeAccess(spaceId, source.validation.unitIds, worktree);
    const { idempotencyKey, ...body } = intent;
    const draftWorktreeId = input.kind === "revise" ? sourceWorktreeId : worktree?.id;
    this.options.onWrite?.();
    const response = await http.json("/api/html-view-drafts", {
      method: "POST", idempotencyKey, body: { ...body, html: source.bytes.toString("utf8"),
        ...(draftWorktreeId === undefined ? {} : { sourceWorktreeId: draftWorktreeId }) },
    });
    return { ...parseHtmlViewDraft(response["draft"], origin), ...access,
      bindings: source.validation.bindings, bindingCount: source.validation.bindingCount,
      ...(source.validation.truncated === undefined ? {} : { truncated: source.validation.truncated }),
    };
  }

  private async sourceWorktree(id: string | undefined) {
    if (id === undefined) return undefined;
    const worktree = await getWorktree(await this.options.authenticatedHttp(), required(id, "Worktree ID"));
    if (worktree.state === "discarded")
      throw workspaceError("workspace-worktree-discarded", "The source pull request was discarded. Choose an active pull request or merged sources.", { worktreeId: id });
    return worktree.state === "merged" ? undefined : worktree;
  }

  private async describeAccess(spaceId: string, unitIds: readonly string[], worktree?: WorkspaceWorktree) {
    const http = await this.options.authenticatedHttp();
    const spaces = new WorkspaceSpaceFeature(async () => http);
    const destination = await spaces.get(spaceId);
    let temporary: Promise<boolean> | undefined;
    // Anyone with the link reads a temporary agent's own files, so its own Sheets are not private to a page visitor.
    const visitorsRead = async (space: WorkspaceSpace) =>
      space.publicRead === true ||
      (space.affiliation === "owner" &&
        (await (temporary ??= sessionIdentity(http).then(({ subject }) => subject.kind === "agent" && !subject.claimed))));
    const publicSpaces = new Map([[spaceId, await visitorsRead(destination)]]);
    const privateSourceUnitIds: string[] = [];
    for (const unitId of unitIds) {
      const addedUnit = worktree?.units.find((unit) => unit.unitId === unitId && unit.source === "worktree");
      let sourceSpaceId = addedUnit?.target?.spaceId;
      if (sourceSpaceId === undefined) {
        const body = await http.json(`/api/unit-resources/${encodeURIComponent(unitId)}`);
        const node = parseDetachedNode(body["node"]);
        if (node.resource?.kind !== "univer" || node.resource.unitId !== unitId) {
          throw workspaceError(
            "workspace-result-mismatch",
            "HTML View source metadata does not match the requested Unit.",
          );
        }
        sourceSpaceId = node.spaceId;
      }
      if (!publicSpaces.has(sourceSpaceId)) {
        try {
          publicSpaces.set(sourceSpaceId, await visitorsRead(await spaces.get(sourceSpaceId)));
        } catch (error) {
          if (!(error instanceof WorkspaceApplicationError) || (error.detail as { status?: unknown } | undefined)?.status !== 404) {
            throw error;
          }
          // A hidden Space cannot be public, but a node grant may still expose its Sheets.
          publicSpaces.set(sourceSpaceId, false);
        }
      }
      if (!publicSpaces.get(sourceSpaceId)) privateSourceUnitIds.push(unitId);
    }
    return {
      repositoryVisibility: destination.publicRead === true ? ("public" as const) : ("private" as const),
      privateSourceUnitIds: privateSourceUnitIds.sort(),
    };
  }

  private async uploadFile(
    blobs: Pick<WorkspaceBlobFeature, "upload">,
    source: { readonly bytes: Uint8Array; readonly filePath: string },
    destination: WorkspaceHtmlViewDestination,
  ) {
    // Stage the copied bytes so caller edits during remote validation cannot change the upload.
    const directory = await mkdtemp(join(tmpdir(), "workspace-html-view-"));
    try {
      const stagedPath = join(directory, basename(source.filePath));
      await writeFile(stagedPath, source.bytes, { mode: 0o600, flag: "wx" });
      return await blobs.upload({
        filePath: stagedPath,
        ...destination,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async readAndValidate(input: WorkspaceHtmlViewSource, sourceWorktreeId?: string) {
    const filePath = input.name;
    const bytes = Buffer.from(input.bytes);
    let parsed;
    try {
      parsed = parseHtmlView(bytes.toString("utf8"));
    } catch (error) {
      throw workspaceError(
        "workspace-html-view-invalid",
        error instanceof Error ? error.message : String(error),
        { filePath },
      );
    }
    const worktree = await this.sourceWorktree(sourceWorktreeId);
    const unitIds = getHtmlViewUnitIds(parsed);
    const bindings: WorkspaceHtmlViewBindingSample[] = [];
    for (const unitId of unitIds) {
      let target: WorkspaceRuntimeTarget;
      try {
        target = worktree === undefined
          ? await this.options.resolveTrunkRuntimeTarget({ unitId })
          : await new WorkspaceContentSource(await this.options.authenticatedHttp()).resolveReferencedRuntimeTarget({
              hostTarget: { scope: { kind: "worktree", worktreeId: worktree.id } }, unitId,
            });
      } catch (error) {
        if (!worktree?.units.some((unit) => unit.unitId === unitId) &&
          error instanceof WorkspaceApplicationError && isRecord(error.detail) &&
          (error.detail["status"] === 403 || error.detail["status"] === 404)) {
          throw workspaceError(
            "workspace-html-view-source-unavailable",
            "The source Sheet may not exist, may not be readable by you, or may exist only in an unmerged pull request. Pass the source pull request to validate unmerged data.",
            { unitId },
          );
        }
        throw error;
      }
      if (target.unitId !== unitId || (target.scope.kind !== "trunk" &&
        (worktree === undefined || target.scope.worktreeId !== worktree.id))) {
        throw workspaceError(
          "workspace-result-mismatch",
          "HTML View source must resolve to the requested Unit and source scope.",
          { unitId },
        );
      }
      if (target.unitType !== "sheet") {
        throw workspaceError(
          "workspace-unit-type-unsupported",
          "HTML View source must be a Sheet Unit.",
          { unitId, unitType: target.unitType },
        );
      }
      const workbook = (await this.options.runtime.exportUnitData({ target })) as IWorkbookData;
      if (!isRecord(workbook) || workbook.id !== unitId || !isRecord(workbook.sheets)) {
        throw workspaceError(
          "workspace-result-mismatch",
          "HTML View source data does not match the requested Sheet Unit.",
          { unitId },
        );
      }
      for (const [index, binding] of parsed.bindings.entries()) {
        if (binding.reference.unitId !== unitId) continue;
        const { reference } = binding;
        const sheet = Object.hasOwn(workbook.sheets, reference.sheetId)
          ? workbook.sheets[reference.sheetId]
          : undefined;
        if (!sheet)
          throw workspaceError(
            "workspace-html-view-source-invalid",
            `Source worksheet not found: ${reference.sheetId}`,
            { unitId },
          );
        if (
          (binding.kind === "range" ? binding.reference.range.endRow : binding.reference.row) >=
            (sheet.rowCount ?? DEFAULT_WORKSHEET_ROW_COUNT) ||
          (binding.kind === "range" ? binding.reference.range.endColumn : binding.reference.col) >=
            (sheet.columnCount ?? DEFAULT_WORKSHEET_COLUMN_COUNT)
        ) {
          throw workspaceError(
            "workspace-html-view-source-invalid",
            "Source binding is outside the worksheet.",
            { reference },
          );
        }
        if (index < 60) bindings[index] = sampleBinding(binding, workbook, sheet);
      }
    }
    const validation: WorkspaceHtmlViewValidation = {
      valid: true, unitIds, bindingCount: parsed.bindings.length, bindings,
      ...(parsed.bindings.length > 60 ? { truncated: true } : {}),
    };
    return {
      filePath,
      bytes,
      validation,
      worktree,
    };
  }
}

function sampleBinding(
  binding: HtmlViewBinding,
  workbook: IWorkbookData,
  sheet: Partial<IWorksheetData>,
): WorkspaceHtmlViewBindingSample {
  const source = { unitId: binding.reference.unitId, sheet: sheet.name || binding.reference.sheetId };
  if (binding.kind !== "range") {
    const { row, col } = binding.reference;
    return { ...source, kind: binding.kind, ref: `${colName(col)}${row + 1}`,
      cell: sampleCell(sheet.cellData?.[row]?.[col], workbook) };
  }
  const { startRow, endRow, startColumn, endColumn } = binding.reference.range;
  const rows = endRow - startRow + 1;
  const columns = endColumn - startColumn + 1;
  const cellData = sheet.cellData ?? {};
  const filledRows = Object.keys(cellData).map(Number).filter((row) =>
    row >= startRow && row <= endRow && Object.keys(cellData[row] ?? {}).map(Number).some((col) =>
      col >= startColumn && col <= endColumn && cellValue(cellData[row]?.[col]) !== null,
    ),
  ).length;
  const head = Array.from({ length: Math.min(rows, 3) }, (_, row) =>
    Array.from({ length: Math.min(columns, 8) }, (_, col) =>
      sampleCell(cellData[startRow + row]?.[startColumn + col], workbook),
    ),
  );
  return { ...source, kind: "range", ref: `${colName(startColumn)}${startRow + 1}:${colName(endColumn)}${endRow + 1}`,
    range: { rows, columns, filledRows, head } };
}

function cellValue(cell: ICellData | null | undefined): WorkspaceHtmlViewCellSample["value"] {
  const value = cell?.v ?? cell?.p?.body?.dataStream?.replace(/\r\n?$/, "") ?? null;
  return value === "" ? null : value;
}

function sampleCell(cell: ICellData | null | undefined, workbook: IWorkbookData): WorkspaceHtmlViewCellSample {
  const value = cellValue(cell);
  const characters = typeof value === "string" ? Array.from(value) : undefined;
  const style = typeof cell?.s === "string" ? workbook.styles?.[cell.s] : cell?.s;
  const format = style?.n?.pattern;
  return {
    value: characters && characters.length > 80 ? `${characters.slice(0, 80).join("")}…` : value,
    ...(cell?.f || cell?.si ? { formula: true } : {}),
    ...(format?.trim() && format !== "General" ? { format } : {}),
  };
}

export function normalizeHtmlViewDestination(input: WorkspaceHtmlViewDestination) {
  const requestedName = required(input.name, "Name");
  const name = isHtmlViewFilename(requestedName) ? requestedName : `${requestedName}.univer.html`;
  if (name.length > 255)
    throw workspaceError(
      "workspace-argument-invalid",
      "HTML View name must not exceed 255 characters including .univer.html.",
    );
  const spaceId = required(input.spaceId, "Space ID");
  const idempotencyKey = required(input.idempotencyKey, "Idempotency key");
  const parentNodeId =
    input.parentNodeId === undefined ? undefined : required(input.parentNodeId, "Parent Node ID");
  return { name, spaceId, idempotencyKey, parentNodeId };
}

function required(value: string, label: string): string {
  if (!value.trim())
    throw workspaceError("workspace-argument-invalid", `${label} must not be empty.`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
