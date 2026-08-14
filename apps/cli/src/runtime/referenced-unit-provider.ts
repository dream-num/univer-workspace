import type { ILogContext, SnapshotService } from "@univerjs-pro/collaboration";
import type {
  IEmbedResourceRefEnsureUnitInput,
  IEmbedResourceRefUnitProviderRegistration,
} from "@univerjs-pro/embed";
import { UniverInstanceType, type ICreateUnitOptions } from "@univerjs/core";
import { workspaceError } from "../errors.js";
import { createWorkspaceReferenceLoadContext } from "./reference-load-context.js";
import {
  selectWorkspaceReferenceScope,
  type WorkspaceReferenceHostContext,
} from "./reference-scope.js";

export const WORKSPACE_REFERENCED_UNIT_PROVIDER_ID = "workspace-referenced-unit-provider";

interface LoadedUnit {
  readonly type: UniverInstanceType;
  getUnitId(): string;
}

interface SnapshotLoadOptions {
  readonly createOptions?: ICreateUnitOptions;
  readonly initialSubUnitId?: string;
}

export interface WorkspaceSnapshotLoader {
  loadSheet(
    unitId: string,
    revision: number,
    context?: ILogContext,
    options?: SnapshotLoadOptions,
  ): Promise<LoadedUnit>;
  loadDoc(
    unitId: string,
    revision: number,
    context?: ILogContext,
    options?: SnapshotLoadOptions,
  ): Promise<LoadedUnit>;
  loadSlide(
    unitId: string,
    revision?: number,
    context?: ILogContext,
    options?: SnapshotLoadOptions,
  ): Promise<LoadedUnit>;
  loadBase(
    unitId: string,
    revision: number,
    context?: ILogContext,
    options?: SnapshotLoadOptions,
  ): Promise<LoadedUnit>;
  loadBoard(
    unitId: string,
    revision?: number,
    context?: ILogContext,
    options?: SnapshotLoadOptions,
  ): Promise<LoadedUnit>;
}

export function createWorkspaceReferencedUnitProviderRegistration(input: {
  readonly hostContext: WorkspaceReferenceHostContext;
  readonly resolveSnapshotService: () => SnapshotService;
}): IEmbedResourceRefUnitProviderRegistration {
  return {
    match: {
      fileKinds: ["self"],
      unitTypes: ["sheet", "doc", "slide", "base", "board"],
    },
    priority: 100,
    provider: {
      ensureUnit: async (ensureInput) => await ensureReferencedUnit(ensureInput, input),
    },
    registrationId: WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
  };
}

async function ensureReferencedUnit(
  ensureInput: IEmbedResourceRefEnsureUnitInput,
  input: {
    readonly hostContext: WorkspaceReferenceHostContext;
    readonly resolveSnapshotService: () => WorkspaceSnapshotLoader;
  },
): Promise<{ readonly unitId: string; readonly unitType: UniverInstanceType }> {
  if (ensureInput.signal?.aborted) throw providerError("aborted", "Source loading was aborted.");
  if (ensureInput.ref.file.kind !== "self") {
    throw providerError(
      "unsupported-file-kind",
      "Workspace references require a self ResourceRef.",
    );
  }
  const unitId = ensureInput.ref.unit.selector;
  if (ensureInput.ref.unit.type !== resourceTypeOf(ensureInput.unitType)) {
    throw providerError(
      "unit-type-mismatch",
      "Workspace ResourceRef type does not match the requested Unit type.",
    );
  }
  const context = createWorkspaceReferenceLoadContext(
    selectWorkspaceReferenceScope(input.hostContext, unitId),
  );
  const options = { createOptions: ensureInput.createOptions };
  const snapshot = input.resolveSnapshotService();
  let loaded: LoadedUnit;
  switch (ensureInput.unitType) {
    case UniverInstanceType.UNIVER_SHEET:
      loaded = await snapshot.loadSheet(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_DOC:
      loaded = await snapshot.loadDoc(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_SLIDE:
      loaded = await snapshot.loadSlide(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_BASE:
      loaded = await snapshot.loadBase(unitId, 0, context, options);
      break;
    case UniverInstanceType.UNIVER_BOARD:
      loaded = await snapshot.loadBoard(unitId, 0, context, options);
      break;
    default:
      throw providerError("unsupported-unit-type", "Workspace reference Unit type is unsupported.");
  }
  if (loaded.getUnitId() !== unitId || loaded.type !== ensureInput.unitType) {
    throw providerError(
      "loaded-identity-mismatch",
      "Workspace Source materialized a different Unit.",
    );
  }
  return { unitId, unitType: ensureInput.unitType };
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
      throw providerError("unsupported-unit-type", "Workspace reference Unit type is unsupported.");
  }
}

function providerError(code: string, message: string): Error {
  return workspaceError(`workspace-reference-${code}`, message);
}
