import type { ILogContext } from "@univerjs-pro/collaboration";
import type {
  IEmbedResourceRefEnsureUnitInput,
  IEmbedResourceRefUnitProviderRegistration,
} from "@univerjs-pro/embed";
import { UniverInstanceType, type ICreateUnitOptions } from "@univerjs/core";
import { WorkspaceReferenceProviderError } from "./errors.js";
import {
  createWorkspaceReferenceLoadContext,
  createWorkspaceReferenceScopePolicy,
  type WorkspaceReferenceHostContext,
} from "./scope.js";

export const WORKSPACE_REFERENCED_UNIT_PROVIDER_ID =
  "workspace-referenced-unit-provider";
export const WORKSPACE_REFERENCED_UNIT_PROVIDER_PRIORITY = 100;

export interface WorkspaceLoadedUnit {
  readonly type: UniverInstanceType;
  getUnitId(): string;
}

export interface WorkspaceSnapshotLoadOptions {
  readonly createOptions?: ICreateUnitOptions;
  readonly initialSubUnitId?: string;
}

export interface WorkspaceSnapshotLoader {
  loadSheet(
    unitId: string,
    revision: number,
    context?: ILogContext,
    options?: WorkspaceSnapshotLoadOptions,
  ): Promise<WorkspaceLoadedUnit>;
  loadDoc(
    unitId: string,
    revision: number,
    context?: ILogContext,
    options?: WorkspaceSnapshotLoadOptions,
  ): Promise<WorkspaceLoadedUnit>;
  loadSlide(
    unitId: string,
    revision?: number,
    context?: ILogContext,
    options?: WorkspaceSnapshotLoadOptions,
  ): Promise<WorkspaceLoadedUnit>;
  loadBase(
    unitId: string,
    revision: number,
    context?: ILogContext,
    options?: WorkspaceSnapshotLoadOptions,
  ): Promise<WorkspaceLoadedUnit>;
  loadBoard(
    unitId: string,
    revision?: number,
    context?: ILogContext,
    options?: WorkspaceSnapshotLoadOptions,
  ): Promise<WorkspaceLoadedUnit>;
}

export interface CreateWorkspaceReferencedUnitProviderInput {
  readonly hostContext: WorkspaceReferenceHostContext;
  readonly resolveSnapshotService: () => WorkspaceSnapshotLoader;
}

export function createWorkspaceReferencedUnitProviderRegistration(
  input: CreateWorkspaceReferencedUnitProviderInput,
): IEmbedResourceRefUnitProviderRegistration {
  const scopePolicy = createWorkspaceReferenceScopePolicy(input.hostContext);
  return {
    registrationId: WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
    priority: WORKSPACE_REFERENCED_UNIT_PROVIDER_PRIORITY,
    match: {
      fileKinds: ["self"],
      unitTypes: ["sheet", "doc", "slide", "base", "board"],
    },
    provider: {
      ensureUnit: async (ensureInput) =>
        await ensureWorkspaceReferencedUnit(ensureInput, input, scopePolicy),
    },
  };
}

async function ensureWorkspaceReferencedUnit(
  ensureInput: IEmbedResourceRefEnsureUnitInput,
  input: CreateWorkspaceReferencedUnitProviderInput,
  scopePolicy: ReturnType<typeof createWorkspaceReferenceScopePolicy>,
) {
  if (ensureInput.signal?.aborted) throw aborted();
  if (ensureInput.ref.file.kind !== "self") {
    throw new WorkspaceReferenceProviderError(
      "unsupported-file-kind",
      "Workspace references require a self ResourceRef.",
      { fileKind: ensureInput.ref.file.kind },
    );
  }

  const unitId = ensureInput.ref.unit.selector;
  const expectedResourceType = resourceTypeOf(ensureInput.unitType);
  if (ensureInput.ref.unit.type !== expectedResourceType) {
    throw new WorkspaceReferenceProviderError(
      "unit-type-mismatch",
      "Workspace ResourceRef Unit type does not match the requested Univer Unit type.",
      {
        actualType: ensureInput.ref.unit.type,
        expectedType: expectedResourceType,
        unitId,
      },
    );
  }

  const context = createWorkspaceReferenceLoadContext(scopePolicy.select(unitId));
  const snapshotService = input.resolveSnapshotService();
  const options = { createOptions: ensureInput.createOptions };
  let loaded: WorkspaceLoadedUnit;
  switch (ensureInput.unitType) {
    case UniverInstanceType.UNIVER_SHEET:
      loaded = await snapshotService.loadSheet(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_DOC:
      loaded = await snapshotService.loadDoc(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_SLIDE:
      loaded = await snapshotService.loadSlide(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_BASE:
      loaded = await snapshotService.loadBase(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_BOARD:
      loaded = await snapshotService.loadBoard(unitId, 0, context, options);
      break;
    default:
      throw unsupportedUnitType(ensureInput.unitType);
  }
  const loadedUnitId = loaded.getUnitId();
  if (loadedUnitId !== unitId) {
    throw new WorkspaceReferenceProviderError(
      "loaded-identity-mismatch",
      "Workspace Source materialized a different Unit.",
      { actualUnitId: loadedUnitId, expectedUnitId: unitId },
    );
  }
  if (loaded.type !== ensureInput.unitType) {
    throw new WorkspaceReferenceProviderError(
      "loaded-type-mismatch",
      "Workspace Source materialized a different Unit type.",
      {
        actualType: loaded.type,
        expectedType: ensureInput.unitType,
        unitId,
      },
    );
  }
  return { unitId: loadedUnitId, unitType: ensureInput.unitType };
}

function resourceTypeOf(unitType: UniverInstanceType): string {
  switch (unitType) {
    case UniverInstanceType.UNIVER_SHEET:
      return "sheet";
    case UniverInstanceType.UNIVER_DOC:
      return "doc";
    case UniverInstanceType.UNIVER_SLIDE:
      return "slide";
    case UniverInstanceType.UNIVER_BASE:
      return "base";
    case UniverInstanceType.UNIVER_BOARD:
      return "board";
    default:
      throw unsupportedUnitType(unitType);
  }
}

function unsupportedUnitType(unitType: UniverInstanceType): WorkspaceReferenceProviderError {
  return new WorkspaceReferenceProviderError(
    "unsupported-unit-type",
    "Workspace Reference Provider does not support the requested Unit type.",
    { unitType },
  );
}

function aborted(): WorkspaceReferenceProviderError {
  return new WorkspaceReferenceProviderError(
    "aborted",
    "Workspace Reference Source loading was aborted.",
  );
}
