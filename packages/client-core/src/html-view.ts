import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  DEFAULT_WORKSHEET_COLUMN_COUNT,
  DEFAULT_WORKSHEET_ROW_COUNT,
  type IWorkbookData,
} from "@univerjs/core";
import { getHtmlViewUnitIds, isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import type { WorkspaceBlobFeature } from "./blob.js";
import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import type { AuthenticatedWorkspaceHttp } from "./http.js";
import { parseDetachedNode } from "./space-model.js";
import { WorkspaceSpaceFeature } from "./space.js";

export interface WorkspaceHtmlViewSource {
  readonly bytes: Uint8Array;
  readonly name: string;
}

export interface WorkspaceHtmlViewOptions {
  readonly authenticatedHttp: AuthenticatedWorkspaceHttp;
  readonly blobs: Pick<WorkspaceBlobFeature, "upload"> | Pick<WorkspaceBlobFeature, "uploadBytes">;
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly resolveTrunkRuntimeTarget: (input: {
    readonly unitId: string;
  }) => Promise<WorkspaceRuntimeTarget>;
  readonly configuredOrigin: () => Promise<string>;
}

export interface WorkspaceHtmlViewDestination {
  readonly name: string;
  readonly spaceId: string;
  readonly parentNodeId?: string;
  readonly idempotencyKey: string;
}

export class WorkspaceHtmlViewFeature {
  public constructor(private readonly options: WorkspaceHtmlViewOptions) {}

  public async validate(input: WorkspaceHtmlViewSource) {
    const source = await this.readAndValidate(input);
    return source.validation;
  }

  public async create(
    input: WorkspaceHtmlViewDestination & { readonly source: WorkspaceHtmlViewSource },
  ) {
    const { name, spaceId, idempotencyKey, parentNodeId } = normalizeHtmlViewDestination(input);
    const source = await this.readAndValidate(input.source);
    const origin = await this.options.configuredOrigin();
    const http = await this.options.authenticatedHttp();
    const spaces = new WorkspaceSpaceFeature(async () => http);
    const destination = await spaces.get(spaceId);
    const publicSpaces = new Map([[spaceId, destination.publicRead === true]]);
    const privateSourceUnitIds: string[] = [];
    for (const unitId of source.validation.unitIds) {
      const body = await http.json(`/api/unit-resources/${encodeURIComponent(unitId)}`);
      const node = parseDetachedNode(body["node"]);
      if (node.resource?.kind !== "univer" || node.resource.unitId !== unitId) {
        throw workspaceError(
          "workspace-result-mismatch",
          "HTML View source metadata does not match the requested Unit.",
        );
      }
      if (!publicSpaces.has(node.spaceId)) {
        try {
          publicSpaces.set(node.spaceId, (await spaces.get(node.spaceId)).publicRead === true);
        } catch (error) {
          if (!(error instanceof WorkspaceApplicationError) || (error.detail as { status?: unknown } | undefined)?.status !== 404) {
            throw error;
          }
          // A hidden Space cannot be public, but a node grant may still expose its Sheets.
          publicSpaces.set(node.spaceId, false);
        }
      }
      if (!publicSpaces.get(node.spaceId)) privateSourceUnitIds.push(unitId);
    }
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
      workspaceUrl: new URL(`/nodes/${encodeURIComponent(upload["nodeId"])}`, origin).href,
      shareUrl: new URL(`/nodes/${encodeURIComponent(upload["nodeId"])}?view=immersive`, origin).href,
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

  private async readAndValidate(input: WorkspaceHtmlViewSource) {
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
    const unitIds = getHtmlViewUnitIds(parsed);
    for (const unitId of unitIds) {
      const target = await this.options.resolveTrunkRuntimeTarget({ unitId });
      if (target.unitId !== unitId || target.scope.kind !== "trunk") {
        throw workspaceError(
          "workspace-result-mismatch",
          "HTML View source must resolve to the requested trunk Unit.",
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
      for (const binding of parsed.bindings.filter(
        (binding) => binding.reference.unitId === unitId,
      )) {
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
      }
    }
    return {
      filePath,
      bytes,
      validation: { valid: true as const, unitIds, bindingCount: parsed.bindings.length },
    };
  }
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
