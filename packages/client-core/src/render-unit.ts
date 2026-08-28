import {
  resolveUnitScreenshotImageAssets,
  type ScreenshotImageAsset,
} from "@univer-cli/unit-screenshot";
import type {
  UniverRenderEmbeddedUnit,
  UniverRenderFormulaReferenceUnit,
  UniverRenderUnit,
} from "@univer-cli/univer-render-runtime";
import { parseResourceRef } from "@univerjs-pro/embed";
import { workspaceError } from "./errors.js";
import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import type { WorkspaceContentSource } from "./runtime-source.js";
import type { WorkspaceRuntimeScope, WorkspaceRuntimeTarget } from "./runtime-target.js";

const EXTERNAL_REFERENCE_RESOURCE_NAME = "UNIVER_EXTERNAL_REFERENCE_PLUGIN";
const EMBED_RESOURCE_NAME = "UNIVER_EMBED_RESOURCE_PLUGIN";

export interface WorkspaceRenderUnitSource {
  resolveImageAsset(input: {
    readonly assetId: string;
    readonly signal?: AbortSignal;
    readonly worktreeId: string;
  }): Promise<ScreenshotImageAsset | undefined>;
  resolveReferencedRuntimeTarget: WorkspaceContentSource["resolveReferencedRuntimeTarget"];
  resolveRuntimeTarget: WorkspaceContentSource["resolveRuntimeTarget"];
  resolveTrunkRuntimeTarget: WorkspaceContentSource["resolveTrunkRuntimeTarget"];
}

export interface WorkspaceRenderUnitLoaderOptions {
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly openSource: () => Promise<WorkspaceRenderUnitSource>;
}

export interface WorkspaceRenderUnitLoadInput {
  readonly scope: WorkspaceRuntimeScope;
  readonly unitId?: string;
}

export class WorkspaceRenderUnitLoader {
  public constructor(private readonly options: WorkspaceRenderUnitLoaderOptions) {}

  public async loadUnit(input: WorkspaceRenderUnitLoadInput): Promise<UniverRenderUnit> {
    const unitId = required(input.unitId, "--unit <unit-id> is required for Workspace screenshots");
    const source = await this.options.openSource();
    const target =
      input.scope.kind === "trunk"
        ? await source.resolveTrunkRuntimeTarget({ unitId })
        : await source.resolveRuntimeTarget({ unitId, worktreeId: input.scope.worktreeId });
    const unitData = await this.exportUnitData(target);
    const formulaReferenceUnits: UniverRenderFormulaReferenceUnit[] = [];
    const formulaReferenceUnitIds = externalReferenceUnitIds(unitData);
    for (const referenceUnitId of formulaReferenceUnitIds) {
      if (referenceUnitId === target.unitId) continue;
      const referenceTarget = await source.resolveReferencedRuntimeTarget({
        hostTarget: target,
        unitId: referenceUnitId,
      });
      if (referenceTarget.unitId !== referenceUnitId) {
        throw invalidReferenceResource("resolved Unit identity does not match");
      }
      if (referenceTarget.unitType !== "sheet" && referenceTarget.unitType !== "base") {
        throw workspaceError(
          "workspace-screenshot-reference-unit-type-unsupported",
          `Screenshot formula reference ${referenceUnitId} is ${referenceTarget.unitType}; expected sheet or base.`,
        );
      }
      formulaReferenceUnits.push({
        unitType: referenceTarget.unitType,
        unitData: (await this.exportUnitData(
          referenceTarget,
        )) as unknown as UniverRenderFormulaReferenceUnit["unitData"],
      } as UniverRenderFormulaReferenceUnit);
    }
    const formulaReferences = new Set(formulaReferenceUnitIds);
    const embeddedUnits: UniverRenderEmbeddedUnit[] = [];
    for (const embedded of embeddedUnitReferences(unitData)) {
      if (embedded.unitId === target.unitId || formulaReferences.has(embedded.unitId)) continue;
      const embeddedTarget = await source.resolveReferencedRuntimeTarget({
        hostTarget: target,
        unitId: embedded.unitId,
      });
      if (
        embeddedTarget.unitId !== embedded.unitId ||
        (embedded.unitType !== undefined && embeddedTarget.unitType !== embedded.unitType)
      ) {
        throw invalidEmbedResource("resolved child Unit identity or type does not match");
      }
      embeddedUnits.push({
        unitType: embeddedTarget.unitType,
        unitData: (await this.exportUnitData(
          embeddedTarget,
        )) as unknown as UniverRenderEmbeddedUnit["unitData"],
      } as UniverRenderEmbeddedUnit);
    }
    const renderUnit = {
      unitType: target.unitType,
      unitData,
      ...(formulaReferenceUnits.length === 0 ? {} : { formulaReferenceUnits }),
      ...(embeddedUnits.length === 0 ? {} : { embeddedUnits }),
    } as unknown as UniverRenderUnit;
    if (target.scope.kind === "trunk") return renderUnit;
    const worktreeId = target.scope.worktreeId;
    return await resolveUnitScreenshotImageAssets(renderUnit, {
      resolve: async ({ source: assetId }) =>
        await source.resolveImageAsset({ assetId, worktreeId }),
    });
  }

  private async exportUnitData(target: WorkspaceRuntimeTarget): Promise<Record<string, unknown>> {
    const result: unknown = await this.options.runtime.exportUnitData({ target });
    if (!isRecord(result) || result["id"] !== target.unitId) {
      throw workspaceError(
        "workspace-screenshot-unit-data-invalid",
        `Workspace runtime exported invalid UnitData for ${target.unitId}.`,
      );
    }
    return result;
  }
}

function externalReferenceUnitIds(unitData: Record<string, unknown>): readonly string[] {
  const resources = unitData["resources"];
  if (!Array.isArray(resources)) return [];
  const unitIds = new Set<string>();
  for (const resource of resources) {
    if (!isRecord(resource) || resource["name"] !== EXTERNAL_REFERENCE_RESOURCE_NAME) continue;
    const decoded = parseResource(resource["data"], invalidReferenceResource);
    if (!isRecord(decoded) || !isRecord(decoded["references"])) {
      throw invalidReferenceResource("references is not an object");
    }
    for (const reference of Object.values(decoded["references"])) {
      if (!isRecord(reference) || typeof reference["sourceUnitId"] !== "string") {
        throw invalidReferenceResource("sourceUnitId is missing");
      }
      const sourceUnitId = reference["sourceUnitId"].trim();
      if (sourceUnitId === "") throw invalidReferenceResource("sourceUnitId is empty");
      unitIds.add(sourceUnitId);
    }
  }
  return [...unitIds].sort();
}

function embeddedUnitReferences(unitData: Record<string, unknown>): readonly EmbeddedUnitReference[] {
  const resources = unitData["resources"];
  if (!Array.isArray(resources)) return [];
  const references = new Map<string, EmbeddedUnitReference>();
  for (const resource of resources) {
    if (!isRecord(resource) || resource["name"] !== EMBED_RESOURCE_NAME) continue;
    const decoded = parseResource(resource["data"], invalidEmbedResource);
    if (!isRecord(decoded) || !isRecord(decoded["embeds"])) {
      throw invalidEmbedResource("embeds is not an object");
    }
    for (const descriptor of Object.values(decoded["embeds"])) {
      if (!isRecord(descriptor)) throw invalidEmbedResource("descriptor is not an object");
      if (descriptor["lifecycle"] === "soft-deleted") continue;
      const child = embedChildUnitReference(descriptor);
      if (child === undefined || child.unitId === "") {
        throw invalidEmbedResource("active child Unit id is missing");
      }
      const existing = references.get(child.unitId);
      if (
        existing?.unitType !== undefined &&
        child.unitType !== undefined &&
        existing.unitType !== child.unitType
      ) {
        throw invalidEmbedResource("child Unit type declarations conflict");
      }
      if (
        existing === undefined ||
        (existing.unitType === undefined && child.unitType !== undefined)
      ) {
        references.set(child.unitId, child);
      }
    }
  }
  return [...references.keys()].sort().map((unitId) => references.get(unitId)!);
}

interface EmbeddedUnitReference {
  readonly unitId: string;
  readonly unitType?: string;
}

function embedChildUnitReference(
  descriptor: Record<string, unknown>,
): EmbeddedUnitReference | undefined {
  if (typeof descriptor["childUnitId"] === "string") {
    return { unitId: descriptor["childUnitId"].trim() };
  }
  const source = descriptor["source"];
  if (!isRecord(source)) return undefined;
  const ref = source["ref"];
  if (typeof ref === "string") {
    try {
      const parsed = parseResourceRef(ref).unit;
      return { unitId: parsed.selector.trim(), unitType: parsed.type };
    } catch {
      throw invalidEmbedResource("source ref is invalid");
    }
  }
  if (!isRecord(ref) || !isRecord(ref["unit"])) return undefined;
  const unit = ref["unit"];
  const selector = unit["selector"];
  const type = unit["type"];
  if ("type" in unit && (typeof type !== "string" || type.trim() === "")) {
    throw invalidEmbedResource("source ref is invalid");
  }
  return typeof selector === "string"
    ? { unitId: selector.trim(), ...(typeof type === "string" ? { unitType: type } : {}) }
    : undefined;
}

function parseResource(
  encoded: unknown,
  invalid: (detail: string) => Error,
): unknown {
  if (typeof encoded !== "string") throw invalid("data is not a string");
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded) as unknown;
  } catch {
    throw invalid("data is not valid JSON");
  }
  return decoded;
}

function invalidReferenceResource(detail: string): Error {
  return workspaceError(
    "workspace-screenshot-reference-resource-invalid",
    `Invalid ${EXTERNAL_REFERENCE_RESOURCE_NAME}: ${detail}.`,
  );
}

function invalidEmbedResource(detail: string): Error {
  return workspaceError(
    "workspace-screenshot-embed-resource-invalid",
    `Invalid ${EMBED_RESOURCE_NAME}: ${detail}.`,
  );
}

function required(value: string | undefined, message: string): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") throw workspaceError("workspace-screenshot-target-required", message);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
