import { randomUUID } from "node:crypto";
import { access, link, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { DaemonClient, JsonValue } from "@univer-cli/daemon";
import {
  createUnitScreenshot,
  resolveUnitScreenshotImageAssets,
  type ScreenshotImageAsset,
  type UnitScreenshotInput,
  type UnitScreenshotResult,
} from "@univer-cli/unit-screenshot";
import type {
  UnitScreenshotWriteInput,
  UnitScreenshotWrittenImage,
} from "@univer-cli/unit-screenshot-command";
import {
  createUniverRenderRuntime,
  type UniverRenderEmbeddedUnit,
  type UniverRenderFormulaReferenceUnit,
  type UniverRenderRuntime,
  type UniverRenderRuntimeOptions,
  type UniverRenderUnit,
} from "@univer-cli/univer-render-runtime";
import { parseResourceRef } from "@univerjs-pro/embed";
import { resolveUniverLicense } from "../../config.js";
import { workspaceError } from "../../errors.js";
import type { WorkspaceRuntimeTarget, WorkspaceRuntimeScope } from "../../runtime/target.js";

const EXTERNAL_REFERENCE_RESOURCE_NAME = "UNIVER_EXTERNAL_REFERENCE_PLUGIN";
const EMBED_RESOURCE_NAME = "UNIVER_EMBED_RESOURCE_PLUGIN";

export interface WorkspaceScreenshotSource {
  resolveImageAsset(input: {
    readonly assetId: string;
    readonly worktreeId: string;
  }): Promise<ScreenshotImageAsset | undefined>;
  resolveReferencedRuntimeTarget(input: {
    readonly hostTarget: WorkspaceRuntimeTarget;
    readonly unitId: string;
  }): Promise<WorkspaceRuntimeTarget>;
  resolveRuntimeTarget(input: {
    readonly unitId: string;
    readonly worktreeId: string;
  }): Promise<WorkspaceRuntimeTarget>;
  resolveTrunkRuntimeTarget(input: { readonly unitId: string }): Promise<WorkspaceRuntimeTarget>;
}

export interface WorkspaceScreenshotFeatureOptions {
  readonly browserRuntimeRoot: string;
  readonly createRuntime?: (options: UniverRenderRuntimeOptions) => Promise<UniverRenderRuntime>;
  readonly cwd?: string;
  readonly daemon: Pick<DaemonClient, "request">;
  readonly env: NodeJS.ProcessEnv;
  readonly openSource: () => Promise<WorkspaceScreenshotSource>;
}

export interface WorkspaceScreenshotLoadInput {
  readonly scope: WorkspaceRuntimeScope;
  readonly unitId?: string;
}

export interface WorkspaceScreenshotApplication {
  capture(input: UnitScreenshotInput): Promise<UnitScreenshotResult>;
  loadUnit(input: WorkspaceScreenshotLoadInput): Promise<UniverRenderUnit>;
  writeImages(input: UnitScreenshotWriteInput): Promise<readonly UnitScreenshotWrittenImage[]>;
}

export class WorkspaceScreenshotFeature implements WorkspaceScreenshotApplication {
  readonly #createRuntime: NonNullable<WorkspaceScreenshotFeatureOptions["createRuntime"]>;
  readonly #cwd: string;

  public constructor(private readonly options: WorkspaceScreenshotFeatureOptions) {
    this.#createRuntime = options.createRuntime ?? createUniverRenderRuntime;
    this.#cwd = options.cwd ?? process.cwd();
  }

  public async loadUnit(input: WorkspaceScreenshotLoadInput): Promise<UniverRenderUnit> {
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
    for (const embeddedUnitId of embeddedUnitIds(unitData)) {
      if (embeddedUnitId === target.unitId || formulaReferences.has(embeddedUnitId)) continue;
      const embeddedTarget = await source.resolveReferencedRuntimeTarget({
        hostTarget: target,
        unitId: embeddedUnitId,
      });
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

  public async capture(input: UnitScreenshotInput): Promise<UnitScreenshotResult> {
    const runtime = await this.#createRuntime({
      browserRuntimeRoot: this.options.browserRuntimeRoot,
      license: resolveUniverLicense(this.options.env),
      env: this.options.env,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    try {
      return await createUnitScreenshot({ runtime }).capture(input);
    } finally {
      await runtime.close();
    }
  }

  public async writeImages(
    input: UnitScreenshotWriteInput,
  ): Promise<readonly UnitScreenshotWrittenImage[]> {
    const directory = resolve(this.#cwd, input.destination ?? "screenshots");
    await mkdir(directory, { recursive: true });
    const outputs = input.result.images.map((image) => {
      if (basename(image.name) !== image.name || image.name === "." || image.name === "..") {
        throw workspaceError(
          "workspace-screenshot-output-invalid",
          `Screenshot image name is unsafe: ${image.name}`,
        );
      }
      return { image, path: join(directory, image.name) };
    });
    for (const output of outputs) {
      if (await pathExists(output.path)) {
        throw workspaceError(
          "workspace-screenshot-output-exists",
          `Screenshot output already exists: ${output.path}`,
        );
      }
    }
    for (const output of outputs) {
      await writeExclusive(output.path, output.image.bytes);
    }
    return outputs.map(({ image, path }) => ({ location: path, name: image.name }));
  }

  private async exportUnitData(target: WorkspaceRuntimeTarget): Promise<Record<string, JsonValue>> {
    const result = await this.options.daemon.request("runtime.export-unit-data", {
      target: serializeTarget(target),
    });
    if (!isRecord(result) || result["id"] !== target.unitId) {
      throw workspaceError(
        "workspace-screenshot-unit-data-invalid",
        `Workspace runtime exported invalid UnitData for ${target.unitId}.`,
      );
    }
    return result;
  }
}

function externalReferenceUnitIds(unitData: Record<string, JsonValue>): readonly string[] {
  const resources = unitData["resources"];
  if (!Array.isArray(resources)) return [];
  const unitIds = new Set<string>();
  for (const resource of resources) {
    if (!isRecord(resource) || resource["name"] !== EXTERNAL_REFERENCE_RESOURCE_NAME) continue;
    const encoded = resource["data"];
    if (typeof encoded !== "string") throw invalidReferenceResource("data is not a string");
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded) as unknown;
    } catch {
      throw invalidReferenceResource("data is not valid JSON");
    }
    if (!isUnknownRecord(decoded) || !isUnknownRecord(decoded["references"])) {
      throw invalidReferenceResource("references is not an object");
    }
    for (const reference of Object.values(decoded["references"])) {
      if (!isUnknownRecord(reference) || typeof reference["sourceUnitId"] !== "string") {
        throw invalidReferenceResource("sourceUnitId is missing");
      }
      const sourceUnitId = reference["sourceUnitId"].trim();
      if (sourceUnitId === "") throw invalidReferenceResource("sourceUnitId is empty");
      unitIds.add(sourceUnitId);
    }
  }
  return [...unitIds].sort();
}

function invalidReferenceResource(detail: string): Error {
  return workspaceError(
    "workspace-screenshot-reference-resource-invalid",
    `Invalid ${EXTERNAL_REFERENCE_RESOURCE_NAME}: ${detail}.`,
  );
}

function embeddedUnitIds(unitData: Record<string, JsonValue>): readonly string[] {
  const resources = unitData["resources"];
  if (!Array.isArray(resources)) return [];
  const unitIds = new Set<string>();
  for (const resource of resources) {
    if (!isRecord(resource) || resource["name"] !== EMBED_RESOURCE_NAME) continue;
    const encoded = resource["data"];
    if (typeof encoded !== "string") throw invalidEmbedResource("data is not a string");
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded) as unknown;
    } catch {
      throw invalidEmbedResource("data is not valid JSON");
    }
    if (!isUnknownRecord(decoded) || !isUnknownRecord(decoded["embeds"])) {
      throw invalidEmbedResource("embeds is not an object");
    }
    for (const descriptor of Object.values(decoded["embeds"])) {
      if (!isUnknownRecord(descriptor)) throw invalidEmbedResource("descriptor is not an object");
      if (descriptor["lifecycle"] === "soft-deleted") continue;
      const childUnitId = embedChildUnitId(descriptor);
      if (childUnitId === undefined || childUnitId === "") {
        throw invalidEmbedResource("active child Unit id is missing");
      }
      unitIds.add(childUnitId);
    }
  }
  return [...unitIds].sort();
}

function embedChildUnitId(descriptor: Record<string, unknown>): string | undefined {
  if (typeof descriptor["childUnitId"] === "string") return descriptor["childUnitId"].trim();
  const source = descriptor["source"];
  if (!isUnknownRecord(source)) return undefined;
  const ref = source["ref"];
  if (typeof ref === "string") {
    try {
      return parseResourceRef(ref).unit.selector.trim();
    } catch {
      throw invalidEmbedResource("source ref is invalid");
    }
  }
  if (!isUnknownRecord(ref) || !isUnknownRecord(ref["unit"])) return undefined;
  const selector = ref["unit"]["selector"];
  return typeof selector === "string" ? selector.trim() : undefined;
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

function serializeTarget(target: WorkspaceRuntimeTarget): JsonValue {
  return {
    origin: target.origin,
    revision: target.revision,
    scope: target.scope,
    unitId: target.unitId,
    unitType: target.unitType,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await link(temporary, path);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw workspaceError(
        "workspace-screenshot-output-exists",
        `Screenshot output already exists: ${path}`,
      );
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
