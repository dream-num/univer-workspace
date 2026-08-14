import type {
  ILogContext,
  ISnapshotServerService as ISnapshotServerServiceContract,
} from "@univerjs-pro/collaboration";
import { ISnapshotServerService } from "@univerjs-pro/collaboration";
import {
  COLLABORATION_CLIENT_PLUGIN_CONFIG_KEY,
  SnapshotServerOverHTTPService,
  type IUniverCollaborationClientConfig,
} from "@univerjs-pro/collaboration-client";
import type { SaveSnapshotInput } from "@univerjs-pro/collaboration-service";
import {
  WorktreeMergePreviewSnapshotService,
  createWorktreeCollaborationConfig,
} from "@univerjs-pro/collaboration-worktree-client";
import {
  IConfigService,
  type DependencyOverride,
} from "@univerjs/core";
import { HTTPService } from "@univerjs/network";
import type {
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
} from "@univerjs/protocol";
import {
  readWorkspaceReferenceSourceScope,
  type WorkspaceReferenceSourceScope,
} from "@univerjs/univer-workspace-reference-provider";
import type { MergeReviewResolution } from "./merge-review";

export type WorkspaceHostSnapshotScope =
  | { readonly kind: "trunk" }
  | { readonly kind: "worktree"; readonly worktreeId: string }
  | {
      readonly kind: "mergePreview";
      readonly worktreeId: string;
      readonly preview: SaveSnapshotInput;
    };

export interface WorkspaceSnapshotServerOverrideOptions {
  readonly hostScope: WorkspaceHostSnapshotScope;
  readonly origin: string;
  readonly resolveMergePreview: (
    worktreeId: string,
    unitId: string,
  ) => Promise<MergeReviewResolution>;
}

export interface WorkspaceSourceSnapshotResolver {
  resolve(
    scope: WorkspaceReferenceSourceScope,
  ): Promise<ISnapshotServerServiceContract>;
}

export function withWorkspaceSnapshotServerOverride(
  existing: DependencyOverride | undefined,
  options: WorkspaceSnapshotServerOverrideOptions,
): DependencyOverride {
  return [
    ...(existing ?? []).filter(
      ([identifier]) => identifier !== ISnapshotServerService,
    ),
    [
      ISnapshotServerService,
      {
        useFactory: (configService: IConfigService, httpService: HTTPService) => {
          const createService = createSnapshotServiceFactory(
            configService,
            httpService,
            options.origin,
          );
          return new WorkspaceSnapshotServerAdapter(
            createService(options.hostScope),
            new BrowserWorkspaceSourceSnapshotResolver(
              createService,
              options.resolveMergePreview,
            ),
          );
        },
        deps: [IConfigService, HTTPService],
      },
    ],
  ];
}

export class WorkspaceSnapshotServerAdapter
  implements ISnapshotServerServiceContract
{
  public constructor(
    private readonly _hostService: ISnapshotServerServiceContract,
    private readonly _sourceResolver: WorkspaceSourceSnapshotResolver,
  ) {}

  public async getUnitOnRev(
    context: ILogContext,
    params: IGetUnitOnRevRequest,
  ): Promise<IGetUnitOnRevResponse> {
    return await (
      await this._readService(context, params.unitID)
    ).getUnitOnRev(context, params);
  }

  public async getSheetBlock(
    context: ILogContext,
    params: IGetSheetBlockRequest,
  ): Promise<IGetSheetBlockResponse> {
    return await (
      await this._readService(context, params.unitID)
    ).getSheetBlock(context, params);
  }

  public async getDeserializedSheetBlock(
    context: ILogContext,
    params: IGetSheetBlockRequest,
  ): Promise<IGetDeserializedSheetBlockResponse | IGetSheetBlockResponse> {
    return await (
      await this._readService(context, params.unitID)
    ).getDeserializedSheetBlock(context, params);
  }

  public async fetchMissingChangesets(
    context: ILogContext,
    params: IFetchMissingChangesetsRequest,
  ): Promise<IFetchMissingChangesetsResponse> {
    return await (
      await this._readService(context, params.unitID)
    ).fetchMissingChangesets(context, params);
  }

  // TODO(@ai-review): Confirm every Workspace unit kind now loads plugin resources only from its bundled snapshot payload.
  public getResourcesRequest(
    _context: ILogContext,
    _params: IGetResourcesRequest,
  ): Promise<IGetResourcesResponse> {
    return Promise.resolve({ error: undefined, resources: {} });
  }

  public async saveSnapshot(
    context: ILogContext,
    params: ISaveSnapshotRequest,
  ): Promise<ISaveSnapshotResponse> {
    this._assertHostWrite(context, params.unitID);
    return await this._hostService.saveSnapshot(context, params);
  }

  public async updateSnapshot(
    context: ILogContext,
    params: ISaveSnapshotRequest,
  ): Promise<ISaveSnapshotResponse> {
    this._assertHostWrite(context, params.unitID);
    return await this._hostService.updateSnapshot(context, params);
  }

  public async saveSheetBlock(
    context: ILogContext,
    params: ISaveSheetBlockRequest,
  ): Promise<ISaveSheetBlockResponse> {
    this._assertHostWrite(context, params.unitID);
    return await this._hostService.saveSheetBlock(context, params);
  }

  public async saveChangeset(
    context: ILogContext,
    params: ISaveChangesetRequest,
  ): Promise<ISaveChangesetResponse> {
    this._assertHostWrite(context);
    return await this._hostService.saveChangeset(context, params);
  }

  public async copyFileMeta(
    context: ILogContext,
    params: ICopyFileMetaRequest,
  ): Promise<ICopyFileMetaResponse> {
    this._assertHostWrite(context);
    return await this._hostService.copyFileMeta(context, params);
  }

  public async getLatestCsReqIdBySid(
    context: ILogContext,
    params: IGetLatestCsReqIdBySidRequest,
  ): Promise<IGetLatestCsReqIdBySidResponse> {
    return await (
      await this._readService(context, params.unitID)
    ).getLatestCsReqIdBySid(context, params);
  }

  private async _readService(
    context: ILogContext,
    expectedUnitId: string,
  ): Promise<ISnapshotServerServiceContract> {
    const scope = readWorkspaceReferenceSourceScope(context, expectedUnitId);
    return scope ? await this._sourceResolver.resolve(scope) : this._hostService;
  }

  private _assertHostWrite(
    context: ILogContext,
    expectedUnitId?: string,
  ): void {
    if (readWorkspaceReferenceSourceScope(context, expectedUnitId)) {
      throw new Error("Workspace referenced Source Units are read-only.");
    }
  }
}

export class BrowserWorkspaceSourceSnapshotResolver
  implements WorkspaceSourceSnapshotResolver
{
  private readonly _services = new Map<
    string,
    Promise<ISnapshotServerServiceContract>
  >();

  public constructor(
    private readonly _createService: (
      scope: WorkspaceHostSnapshotScope,
    ) => ISnapshotServerServiceContract,
    private readonly _resolveMergePreview: (
      worktreeId: string,
      unitId: string,
    ) => Promise<MergeReviewResolution>,
  ) {}

  public resolve(
    scope: WorkspaceReferenceSourceScope,
  ): Promise<ISnapshotServerServiceContract> {
    const key = `${scope.kind}:${"worktreeId" in scope ? scope.worktreeId : ""}:${scope.unitId}`;
    const existing = this._services.get(key);
    if (existing) return existing;

    let created: Promise<ISnapshotServerServiceContract>;
    created = this._createSourceService(scope).catch((error: unknown) => {
      if (this._services.get(key) === created) {
        this._services.delete(key);
      }
      throw error;
    });
    this._services.set(key, created);
    return created;
  }

  private async _createSourceService(
    scope: WorkspaceReferenceSourceScope,
  ): Promise<ISnapshotServerServiceContract> {
    if (scope.kind === "trunk") {
      return this._createService({ kind: "trunk" });
    }
    if (scope.kind === "worktree") {
      return this._createService({
        kind: "worktree",
        worktreeId: scope.worktreeId,
      });
    }

    const resolution = await this._resolveMergePreview(
      scope.worktreeId,
      scope.unitId,
    );
    if (resolution.kind === "worktree") {
      return this._createService({
        kind: "worktree",
        worktreeId: scope.worktreeId,
      });
    }
    if (resolution.kind === "preview") {
      return this._createService({
        kind: "mergePreview",
        worktreeId: scope.worktreeId,
        preview: resolution.preview,
      });
    }
    throw new Error(
      resolution.reason === "conflict"
        ? "Workspace Source Unit has a merge conflict."
        : "Workspace Source Unit merge preview is unavailable.",
    );
  }
}

function createSnapshotServiceFactory(
  configService: IConfigService,
  httpService: HTTPService,
  origin: string,
): (
  scope: WorkspaceHostSnapshotScope,
) => ISnapshotServerServiceContract {
  return (scope) => {
    if (scope.kind === "mergePreview") {
      return new WorktreeMergePreviewSnapshotService({
        preview: scope.preview,
      });
    }

    const collaborationConfig: Partial<IUniverCollaborationClientConfig> =
      scope.kind === "trunk"
        ? { snapshotServerUrl: "/universer-api/snapshot" }
        : createWorktreeCollaborationConfig({
            origin,
            worktreeID: scope.worktreeId,
          });
    const scopedConfig = scopedSnapshotConfigService(
      configService,
      collaborationConfig,
    );
    return new SnapshotServerOverHTTPService(scopedConfig, httpService);
  };
}

function scopedSnapshotConfigService(
  parent: IConfigService,
  collaborationConfig: Partial<IUniverCollaborationClientConfig>,
): IConfigService {
  return {
    getConfig: <T>(id: string | symbol): T => {
      if (id === COLLABORATION_CLIENT_PLUGIN_CONFIG_KEY) {
        return collaborationConfig as T;
      }
      if (id === "SNAPSHOT_URL_KEY") return undefined as T;
      return parent.getConfig<T>(id);
    },
    setConfig: (id, value, options) => parent.setConfig(id, value, options),
    deleteConfig: (id) => parent.deleteConfig(id),
    subscribeConfigValue$: (key) => parent.subscribeConfigValue$(key),
  };
}
