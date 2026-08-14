import { ISnapshotServerService } from "@univerjs-pro/collaboration";
import { IConfigService, type DependencyOverride } from "@univerjs/core";
import { UniverType } from "@univerjs/protocol";
import { createWorkspaceReferenceLoadContext } from "@univerjs/univer-workspace-reference-provider";
import {
  BrowserWorkspaceSourceSnapshotResolver,
  WorkspaceSnapshotServerAdapter,
  withWorkspaceSnapshotServerOverride,
} from "../../client/src/features/editor/workspace-snapshot-server-adapter";
import { describe, expect, it, vi } from "vitest";

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

  // TODO(@ai-review): Verify no future Workspace resource loader reintroduces the removed standalone HTTP request.
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
        { segmentId: "segment-1", unitID: "source-unit" },
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
