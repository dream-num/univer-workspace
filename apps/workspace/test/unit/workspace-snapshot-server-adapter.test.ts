import {
  ISnapshotServerService,
  SnapshotService,
  UniverCollaborationPlugin,
  transformBaseDataToSnapshot,
  transformBoardDataToSnapshot,
  transformDocumentDataToSnapshot,
  transformSlideDataToSnapshot,
  transformWorkbookDataToSnapshot,
} from "@univerjs-pro/collaboration";
import type { SaveSnapshotInput } from "@univerjs-pro/collaboration-service";
import { WorktreeMergePreviewSnapshotService } from "@univerjs-pro/collaboration-worktree-client";
import {
  IConfigService,
  IResourceManagerService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
  getBasesEmptySnapshot,
  getDocsEmptySnapshot,
  getSheetsEmptySnapshot,
  mergeWorksheetSnapshotWithDefault,
  type DependencyOverride,
} from "@univerjs/core";
import { ErrorCode, UniverType, type ISheetBlock } from "@univerjs/protocol";
import { createWorkspaceReferenceLoadContext } from "@univerjs/univer-workspace-reference-provider";
import {
  BrowserWorkspaceSourceSnapshotResolver,
  WorkspaceSnapshotServerAdapter,
  withWorkspaceSnapshotServerOverride,
} from "../../web/src/features/editor/workspace-snapshot-server-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";

type ResourceUnitKind = "sheet" | "doc" | "slide" | "base" | "board";
const RESOURCE_UNIT_KINDS: readonly ResourceUnitKind[] = ["sheet", "doc", "slide", "base", "board"];
const RESOURCE_NAME = "UNIVER_SNAPSHOT_TEST_PLUGIN";

afterEach(() => vi.unstubAllGlobals());

describe("WorkspaceSnapshotServerAdapter", () => {
  it("evicts a failed Source service so a later ensure can retry", async () => {
    const source = snapshotService("source");
    const createService = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("temporarily unavailable");
      })
      .mockReturnValue(source.service);
    const resolver = new BrowserWorkspaceSourceSnapshotResolver(
      createService,
      vi.fn(),
    );
    const scope = { kind: "trunk", unitId: "source-unit" } as const;

    await expect(resolver.resolve(scope)).rejects.toThrow(
      "temporarily unavailable",
    );
    await expect(resolver.resolve(scope)).resolves.toBe(source.service);
    expect(createService).toHaveBeenCalledTimes(2);
  });

  it("replaces only the Host snapshot override", () => {
    const existing = [
      [IConfigService, null],
      [ISnapshotServerService, null],
    ] as DependencyOverride;

    const override = withWorkspaceSnapshotServerOverride(existing, {
      hostScope: { kind: "trunk" },
      origin: "https://workspace.example",
      resolveMergePreview: vi.fn(),
    });

    expect(override).toHaveLength(2);
    expect(override[0]?.[0]).toBe(IConfigService);
    expect(override[1]?.[0]).toBe(ISnapshotServerService);
    expect(override[1]?.[1]).toMatchObject({
      deps: expect.any(Array),
      useFactory: expect.any(Function),
    });
  });

  it("keeps untagged Host reads on the Host service", async () => {
    const host = snapshotService("host");
    const source = snapshotService("source");
    const resolve = vi.fn(async () => source.service);
    const adapter = new WorkspaceSnapshotServerAdapter(host.service, {
      resolve,
    });

    await expect(
      adapter.getUnitOnRev({}, unitRequest("host-unit")),
    ).resolves.toEqual({ service: "host" });
    expect(host.getUnitOnRev).toHaveBeenCalledOnce();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("serves the legacy resources contract locally", async () => {
    const host = snapshotService("host");
    const resolve = vi.fn(async () => snapshotService("source").service);
    const adapter = new WorkspaceSnapshotServerAdapter(host.service, {
      resolve,
    });

    await expect(
      adapter.getResourcesRequest(
        {},
        {
          resourceIDs: ["plugin-resource"],
          type: UniverType.UNIVER_SHEET,
          unitID: "host-unit",
        },
      ),
    ).resolves.toEqual({ error: undefined, resources: {} });
    expect(host.getResourcesRequest).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(
    RESOURCE_UNIT_KINDS.flatMap((kind) => [
      { kind, scope: "Host" },
      { kind, scope: "Source" },
    ]),
  )(
    "loads bundled $kind plugin resources for $scope without a standalone request",
    async ({ kind, scope }) => {
      vi.stubGlobal("Path2D", class {});
      const { UniverDocsPlugin } = await import("@univerjs/docs");
      const { UniverSheetsPlugin } = await import("@univerjs/sheets");
      const { UniverSlidesPlugin } = await import("@univerjs-pro/slides");
      const { UniverBasesPlugin } = await import("@univerjs-pro/bases");
      const { UniverBoardsPlugin } = await import("@univerjs-pro/boards");
      const unitId = `${scope.toLowerCase()}-${kind}`;
      const preview = await bundledSnapshot(kind, unitId);
      const server = new WorktreeMergePreviewSnapshotService({ preview });
      const transportResources = vi.spyOn(server, "getResourcesRequest");
      const host = snapshotService("host");
      const resolve = vi.fn(async () => server);
      const adapter = new WorkspaceSnapshotServerAdapter(scope === "Host" ? server : host.service, {
        resolve,
      });
      const standaloneResources = vi.spyOn(adapter, "getResourcesRequest");
      const blocks = vi.spyOn(server, "getDeserializedSheetBlock");
      const univer = new Univer({ locale: LocaleType.EN_US, logLevel: LogLevel.SILENT });
      try {
        univer.registerPlugin(UniverDocsPlugin);
        univer.registerPlugin(UniverSheetsPlugin);
        univer.registerPlugin(UniverSlidesPlugin);
        univer.registerPlugin(UniverBasesPlugin);
        univer.registerPlugin(UniverBoardsPlugin);
        univer.__getInjector().add([ISnapshotServerService, { useValue: adapter }]);
        univer.registerPlugin(UniverCollaborationPlugin);
        const onLoad = vi.fn();
        univer
          .__getInjector()
          .get(IResourceManagerService)
          .registerPluginResource({
            pluginName: RESOURCE_NAME,
            businesses: [resourceUnitType(kind)],
            onLoad,
            onUnLoad: () => {},
            parseJson: JSON.parse,
            toJson: () => JSON.stringify({ kind, kept: true }),
          });
        const context =
          scope === "Host"
            ? {}
            : createWorkspaceReferenceLoadContext({
                kind: "worktree",
                unitId,
                worktreeId: "worktree-1",
              });
        const loader = univer.__getInjector().get(SnapshotService);
        const load = {
          sheet: loader.loadSheet.bind(loader),
          doc: loader.loadDoc.bind(loader),
          slide: loader.loadSlide.bind(loader),
          base: loader.loadBase.bind(loader),
          board: loader.loadBoard.bind(loader),
        }[kind];
        await load(unitId, 0, context);
        expect(onLoad).toHaveBeenCalledExactlyOnceWith(unitId, { kind, kept: true });
        expect(standaloneResources).not.toHaveBeenCalled();
        expect(transportResources).not.toHaveBeenCalled();
        expect(host.getResourcesRequest).not.toHaveBeenCalled();
        if (scope === "Source")
          expect(resolve).toHaveBeenCalledWith({
            kind: "worktree",
            unitId,
            worktreeId: "worktree-1",
          });
        else expect(resolve).not.toHaveBeenCalled();
        if (kind === "sheet" || kind === "base") expect(blocks).toHaveBeenCalled();
      } finally {
        univer.dispose();
      }
    },
    30_000,
  );

  it("routes a tagged Source read by its exact Workspace scope", async () => {
    const host = snapshotService("host");
    const source = snapshotService("source");
    const resolve = vi.fn(async () => source.service);
    const adapter = new WorkspaceSnapshotServerAdapter(host.service, {
      resolve,
    });
    const scope = {
      kind: "worktree",
      unitId: "source-unit",
      worktreeId: "worktree-1",
    } as const;

    await expect(
      adapter.getUnitOnRev(
        createWorkspaceReferenceLoadContext(scope),
        unitRequest("source-unit"),
      ),
    ).resolves.toEqual({ service: "source" });
    expect(resolve).toHaveBeenCalledWith(scope);
    expect(source.getUnitOnRev).toHaveBeenCalledOnce();
    expect(host.getUnitOnRev).not.toHaveBeenCalled();

    await expect(
      adapter.getLatestCsReqIdBySid(
        createWorkspaceReferenceLoadContext(scope),
        { sid: "segment-1", unitID: "source-unit", userID: "user-1" },
      ),
    ).resolves.toEqual({ service: "source" });
    expect(source.getLatestCsReqIdBySid).toHaveBeenCalledOnce();
  });

  it("rejects a tagged Source request whose Unit identity changed", async () => {
    const host = snapshotService("host");
    const adapter = new WorkspaceSnapshotServerAdapter(host.service, {
      resolve: async () => snapshotService("source").service,
    });

    await expect(
      adapter.getUnitOnRev(
        createWorkspaceReferenceLoadContext({
          kind: "trunk",
          unitId: "source-a",
        }),
        unitRequest("source-b"),
      ),
    ).rejects.toMatchObject({ code: "invalid-load-context" });
  });

  it("delegates Host writes but rejects tagged Source writes", async () => {
    const host = snapshotService("host");
    const adapter = new WorkspaceSnapshotServerAdapter(host.service, {
      resolve: async () => snapshotService("source").service,
    });
    const params = {
      snapshot: undefined,
      type: UniverType.UNIVER_SHEET,
      unitID: "host-unit",
    };

    await expect(adapter.saveSnapshot({}, params)).resolves.toEqual({
      service: "host",
    });
    await expect(
      adapter.saveSnapshot(
        createWorkspaceReferenceLoadContext({
          kind: "trunk",
          unitId: "source-unit",
        }),
        { ...params, unitID: "source-unit" },
      ),
    ).rejects.toThrow("Source Units are read-only");
    expect(host.saveSnapshot).toHaveBeenCalledOnce();
  });
});

function resourceUnitType(kind: ResourceUnitKind): UniverInstanceType {
  return {
    sheet: UniverInstanceType.UNIVER_SHEET,
    doc: UniverInstanceType.UNIVER_DOC,
    slide: UniverInstanceType.UNIVER_SLIDE,
    base: UniverInstanceType.UNIVER_BASE,
    board: UniverInstanceType.UNIVER_BOARD,
  }[kind];
}

async function bundledSnapshot(kind: ResourceUnitKind, unitId: string): Promise<SaveSnapshotInput> {
  const blocks: ISheetBlock[] = [];
  const writer = snapshotService("writer").service;
  writer.saveSheetBlock = async (_context, params) => {
    const block = { ...params.block!, id: `block-${blocks.length}` };
    blocks.push(block);
    return { blockID: block.id, error: { code: ErrorCode.OK, message: "" } };
  };
  const resources = [{ name: RESOURCE_NAME, data: JSON.stringify({ kind, kept: true }) }];
  let result: Pick<SaveSnapshotInput, "snapshot">;
  switch (kind) {
    case "sheet": {
      const data = getSheetsEmptySnapshot(unitId);
      data.resources = resources;
      data.sheetOrder = ["tab"];
      data.sheets = {
        tab: mergeWorksheetSnapshotWithDefault({
          id: "tab",
          name: "Sheet",
          cellData: { 0: { 0: { v: "preserved" } } },
        }),
      };
      result = await transformWorkbookDataToSnapshot({}, data, unitId, 1, writer);
      break;
    }
    case "doc": {
      const data = { ...getDocsEmptySnapshot(unitId), resources };
      result = await transformDocumentDataToSnapshot({}, data, unitId, 1, writer);
      break;
    }
    case "slide": {
      const { getSlidesEmptySnapshot } = await import("@univerjs-pro/slides");
      const data = { ...getSlidesEmptySnapshot(unitId), resources };
      result = await transformSlideDataToSnapshot(resources, data, unitId, 1, writer);
      break;
    }
    case "board": {
      const { getBoardsEmptySnapshot } = await import("@univerjs-pro/boards");
      const data = { ...getBoardsEmptySnapshot(unitId), resources };
      result = await transformBoardDataToSnapshot(resources, data, unitId, 1, writer);
      break;
    }
    case "base": {
      const { createDefaultBaseTableSnapshot } = await import("@univerjs-pro/bases");
      const data = { ...getBasesEmptySnapshot(unitId), resources };
      data.tableOrder = ["table"];
      data.tables = {
        table: createDefaultBaseTableSnapshot({
          id: "table",
          name: "Table",
          gridViewId: "grid",
          recordCount: 1,
          now: 1,
        }),
      };
      result = await transformBaseDataToSnapshot({}, data, unitId, 1, writer);
      break;
    }
  }
  return { ...result, sheetBlocks: blocks };
}

function unitRequest(unitID: string) {
  return {
    revision: 0,
    type: UniverType.UNIVER_SHEET,
    unitID,
  };
}

function snapshotService(name: string): {
  readonly getUnitOnRev: ReturnType<typeof vi.fn>;
  readonly getLatestCsReqIdBySid: ReturnType<typeof vi.fn>;
  readonly getResourcesRequest: ReturnType<typeof vi.fn>;
  readonly saveSnapshot: ReturnType<typeof vi.fn>;
  readonly service: ISnapshotServerService;
} {
  const result = { service: name };
  const getUnitOnRev = vi.fn(async () => result);
  const getLatestCsReqIdBySid = vi.fn(async () => result);
  const getResourcesRequest = vi.fn(async () => result);
  const saveSnapshot = vi.fn(async () => result);
  return {
    getUnitOnRev,
    getLatestCsReqIdBySid,
    getResourcesRequest,
    saveSnapshot,
    service: {
      getUnitOnRev,
      getSheetBlock: vi.fn(async () => result),
      getDeserializedSheetBlock: vi.fn(async () => result),
      fetchMissingChangesets: vi.fn(async () => result),
      getResourcesRequest,
      saveSnapshot,
      updateSnapshot: vi.fn(async () => result),
      saveSheetBlock: vi.fn(async () => result),
      saveChangeset: vi.fn(async () => result),
      copyFileMeta: vi.fn(async () => result),
      getLatestCsReqIdBySid,
    } as unknown as ISnapshotServerService,
  };
}
