import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  DEFAULT_WORKSHEET_COLUMN_COUNT,
  DEFAULT_WORKSHEET_ROW_COUNT,
  type IWorkbookData,
} from "@univerjs/core";
import { getHtmlViewUnitIds, isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import type {
  WorkspaceBlobFeature,
  WorkspaceContentRuntimeOperations,
  WorkspaceRuntimeTarget,
} from "@univerjs/univer-workspace-client-core";
import {
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  workspaceError,
} from "../../errors.js";

interface HtmlViewOptions {
  readonly blobs: Pick<WorkspaceBlobFeature, "upload">;
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly resolveTrunkRuntimeTarget: (input: {
    readonly unitId: string;
  }) => Promise<WorkspaceRuntimeTarget>;
  readonly configuredOrigin: () => Promise<string>;
}

interface HtmlViewCreateInput {
  readonly filePath: string;
  readonly name: string;
  readonly spaceId: string;
  readonly parentNodeId?: string;
  readonly idempotencyKey: string;
}

export class WorkspaceHtmlViewFeature {
  public constructor(private readonly options: HtmlViewOptions) {}

  public async validate(filePath: string) {
    const source = await this.readAndValidate(filePath);
    return source.validation;
  }

  public async create(input: HtmlViewCreateInput) {
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
    const source = await this.readAndValidate(input.filePath);
    const origin = await this.options.configuredOrigin();
    // Upload the exact bytes that passed validation, even if the author edits the source
    // while remote Sheet validation is running. Reuse the existing Blob file workflow.
    const directory = await mkdtemp(join(tmpdir(), "workspace-html-view-"));
    try {
      const stagedPath = join(directory, basename(source.filePath));
      await writeFile(stagedPath, source.bytes, { mode: 0o600, flag: "wx" });
      const upload = await this.options.blobs.upload({
        filePath: stagedPath,
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
      };
    } catch (error) {
      // Recovery must refer to the author's file, not the temporary upload copy.
      if (
        isWorkspaceResultUnknown(error) &&
        error instanceof WorkspaceApplicationError &&
        isRecord(error.detail)
      ) {
        const request = error.detail["request"];
        throw workspaceError(error.code, error.message, {
          ...error.detail,
          sourcePath: source.filePath,
          ...(isRecord(request) ? { request: { ...request, sourcePath: source.filePath } } : {}),
        });
      }
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async readAndValidate(inputPath: string) {
    if (!isHtmlViewFilename(inputPath)) {
      throw workspaceError("workspace-argument-invalid", "Source must be a .univer.html file.");
    }
    const filePath = resolve(inputPath);
    let bytes: Buffer;
    try {
      if (!(await stat(filePath)).isFile()) throw new Error("Source must be a regular file.");
      bytes = await readFile(filePath);
    } catch (error) {
      throw workspaceError(
        "workspace-html-view-source-unavailable",
        "HTML View source could not be read.",
        {
          filePath,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
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
      validation: { valid: true, unitIds, bindingCount: parsed.bindings.length },
    };
  }
}

function required(value: string, label: string): string {
  if (!value.trim())
    throw workspaceError("workspace-argument-invalid", `${label} must not be empty.`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
