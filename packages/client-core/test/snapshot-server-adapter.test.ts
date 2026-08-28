import type { ILogContext } from "@univerjs-pro/collaboration";
import { UniverType } from "@univerjs/protocol";
import { describe, expect, it } from "vitest";
import {
  createWorkspaceReferenceLoadContext,
  WorkspaceHttp,
  WorkspaceSnapshotServerAdapter,
} from "../src/index.js";

describe("Workspace Snapshot server adapter", () => {
  it("uses host scope without context and selected reference scope with context", async () => {
    const requests: string[] = [];
    const adapter = snapshotAdapter(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(`${url.pathname}${url.search}`);
      return Response.json({
        changesets: [],
        error: null,
        snapshot: sheetSnapshot("source/1", 2),
      });
    });
    await adapter.getUnitOnRev({}, { revision: 2, type: UniverType.UNIVER_SHEET, unitID: "source/1" });
    await adapter.getUnitOnRev(
      createWorkspaceReferenceLoadContext({ kind: "trunk", unitId: "source/1" }),
      { revision: 2, type: UniverType.UNIVER_SHEET, unitID: "source/1" },
    );
    expect(requests).toEqual([
      "/universer-api/worktrees/host%2F1/snapshot/2/unit/source%2F1/rev/2",
      "/universer-api/snapshot/2/unit/source%2F1/rev/2",
    ]);
  });

  it("strictly validates Snapshot, changesets, and protocol error envelopes", async () => {
    for (const body of [
      { changesets: [], error: null, snapshot: sheetSnapshot("other", 2) },
      {
        changesets: [{ baseRev: 1, mutations: [], revision: -1, type: 2, unitID: "unit-1" }],
        error: null,
        snapshot: sheetSnapshot("unit-1", 1),
      },
      { changesets: [], error: { code: 7 }, snapshot: sheetSnapshot("unit-1", 2) },
      { changesets: [], error: { code: 1.5, message: "bad" }, snapshot: sheetSnapshot("unit-1", 2) },
    ]) {
      const adapter = snapshotAdapter(async () => Response.json(body));
      await expect(
        adapter.getUnitOnRev({}, { revision: 2, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
      ).rejects.toMatchObject({ code: "workspace-invalid-response" });
    }
  });

  it("strictly decodes serialized blocks and keeps deserialized blocks untouched", async () => {
    const requests: string[] = [];
    const adapter = snapshotAdapter(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      requests.push(path);
      return Response.json({ block: { data: path.includes("/block/2/") ? { cells: [] } : "YQ==", id: "block/1" }, error: null });
    });
    await expect(
      adapter.getSheetBlock({}, { blockID: "block/1", type: UniverType.UNIVER_SHEET, unitID: "unit/1" }),
    ).resolves.toMatchObject({ block: { data: Uint8Array.from([97]), id: "block/1" } });
    await expect(
      adapter.getDeserializedSheetBlock({}, { blockID: "block/1", type: UniverType.UNIVER_SHEET, unitID: "unit/1" }),
    ).resolves.toMatchObject({ block: { data: { cells: [] }, id: "block/1" } });
    expect(requests).toEqual([
      "/universer-api/worktrees/host%2F1/snapshot/2/unit/unit%2F1/block/block%2F1",
      "/universer-api/worktrees/host%2F1/snapshot/block/2/unit/unit%2F1/block/block%2F1",
    ]);

    const invalid = snapshotAdapter(async () => Response.json({ block: { data: "YQ", id: "block-1" } }));
    await expect(
      invalid.getSheetBlock({}, { blockID: "block-1", type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
    ).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });

  it("encodes missing-change and resource queries and validates their responses", async () => {
    const requests: string[] = [];
    const adapter = snapshotAdapter(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(`${url.pathname}${url.search}`);
      return url.pathname.endsWith("/resources")
        ? Response.json({ error: null, resources: { "resource/1": { data: "{}", name: "name" } } })
        : Response.json({ changesets: [], error: null, latestRevision: 5 });
    });
    await expect(
      adapter.fetchMissingChangesets({}, { from: 2, to: 5, type: UniverType.UNIVER_DOC, unitID: "doc/1" }),
    ).resolves.toMatchObject({ latestRevision: 5 });
    await expect(
      adapter.getResourcesRequest({}, { resourceIDs: ["resource/1"], type: UniverType.UNIVER_DOC, unitID: "doc/1" }),
    ).resolves.toMatchObject({ resources: { "resource/1": { data: "{}", name: "name" } } });
    expect(requests).toEqual([
      "/universer-api/worktrees/host%2F1/snapshot/1/unit/doc%2F1/fetchmissing?from=2&to=5",
      `/universer-api/worktrees/host%2F1/snapshot/1/unit/doc%2F1/resources?resourceId=${encodeURIComponent('["resource/1"]')}`,
    ]);

    for (const resources of [
      { other: { data: "{}", name: "name" } },
      { "resource-1": {} },
      { "resource-1": { data: "{}", id: "other", name: "name" } },
    ]) {
      const invalid = snapshotAdapter(async () => Response.json({ error: null, resources }));
      await expect(
        invalid.getResourcesRequest({}, { resourceIDs: ["resource-1"], type: UniverType.UNIVER_DOC, unitID: "doc-1" }),
      ).rejects.toMatchObject({ code: "workspace-invalid-response" });
    }
  });

  it("rejects all six write-side methods without issuing HTTP", async () => {
    let requests = 0;
    const adapter = snapshotAdapter(async () => {
      requests += 1;
      return Response.json({});
    });
    const context: ILogContext = createWorkspaceReferenceLoadContext({
      kind: "worktree",
      unitId: "unit-1",
      worktreeId: "source-wt",
    });
    const writes = [
      () => adapter.saveSnapshot(context, { snapshot: undefined, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
      () => adapter.updateSnapshot(context, { snapshot: undefined, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
      () => adapter.saveSheetBlock(context, { block: undefined, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
      () => adapter.saveChangeset(context, {} as never),
      () => adapter.copyFileMeta(context, {} as never),
      () => adapter.getLatestCsReqIdBySid(context, { sid: "sid-1", unitID: "unit-1", userID: "user-1" }),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toMatchObject({ code: "workspace-reference-source-read-only" });
    }
    const absentContextWrites = [
      () => adapter.saveSnapshot({}, { snapshot: undefined, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
      () => adapter.updateSnapshot({}, { snapshot: undefined, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
      () => adapter.saveSheetBlock({}, { block: undefined, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
      () => adapter.saveChangeset({}, {} as never),
      () => adapter.copyFileMeta({}, {} as never),
      () => adapter.getLatestCsReqIdBySid({}, { sid: "sid-1", unitID: "unit-1", userID: "user-1" }),
    ];
    for (const write of absentContextWrites) {
      await expect(write()).rejects.toMatchObject({ code: "workspace-reference-source-read-only" });
    }
    expect(requests).toBe(0);
  });

  it("rejects malformed reference context before all reads and writes", async () => {
    let requests = 0;
    const adapter = snapshotAdapter(async () => {
      requests += 1;
      return Response.json({});
    });
    const context = { metadata: { "univer.workspace.reference-source-scope.v1": "not-json" } };
    await expect(
      adapter.getUnitOnRev(context, { revision: 0, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
    ).rejects.toMatchObject({ code: "workspace-reference-invalid-load-context" });
    await expect(
      adapter.saveSnapshot(context, { snapshot: undefined, type: UniverType.UNIVER_SHEET, unitID: "unit-1" }),
    ).rejects.toMatchObject({ code: "workspace-reference-invalid-load-context" });
    expect(requests).toBe(0);
  });
});

function snapshotAdapter(fetcher: typeof fetch): WorkspaceSnapshotServerAdapter {
  return new WorkspaceSnapshotServerAdapter({
    hostScope: { kind: "worktree", worktreeId: "host/1" },
    http: new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher,
      origin: "https://workspace.test",
      role: "worker",
    }),
  });
}

function sheetSnapshot(unitId: string, revision: number): Record<string, unknown> {
  return {
    rev: revision,
    type: 2,
    unitID: unitId,
    workbook: { originalMeta: "YQ==", sheets: { "sheet-1": { originalMeta: "Yg==" } } },
  };
}
