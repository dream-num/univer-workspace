import { randomUUID } from "node:crypto";
import { BasesUnitComparisonAdapter } from "@univerjs-pro/bases-history";
import { BoardsUnitComparisonAdapter } from "@univerjs-pro/boards-history";
import {
  transformSnapshotToBaseData,
  transformSnapshotToBoardData,
  transformSnapshotToDocumentData,
  transformSnapshotToSlideData,
  transformSnapshotToWorkbookData,
} from "@univerjs-pro/collaboration";
import {
  UnitSnapshotMaterializer,
  type UniverCollabService,
  type UnitLoadDataWithBlocks,
} from "@univerjs-pro/collaboration-service";
import type {
  UniverCollabWorktreeService,
  WorktreeUnitData,
} from "@univerjs-pro/collaboration-worktree-service";
import { DocsUnitComparisonAdapter } from "@univerjs-pro/docs-history";
import {
  createUnitComparisonEngine,
  UnitComparisonDetailLevel,
  UnitComparisonFidelity,
  type IPreparedUnitComparison,
  type IUnitComparisonItem,
  type IUnitComparisonProductContext,
  type IUnitComparisonResult,
  type UnitComparisonType,
} from "@univerjs-pro/edit-history";
import { SheetsUnitComparisonAdapter } from "@univerjs-pro/sheets-history";
import { SlidesUnitComparisonAdapter } from "@univerjs-pro/slides-history";
import { UniverInstanceType } from "@univerjs/core";
import type {
  IChangeset,
  ISheetBlock,
  ISnapshot,
  UniverType,
} from "@univerjs/protocol";
import type { UnitType } from "../../modules/access/index.js";

const comparisonEngine = createUnitComparisonEngine([
  new DocsUnitComparisonAdapter(),
  new SheetsUnitComparisonAdapter(),
  new SlidesUnitComparisonAdapter(),
  new BasesUnitComparisonAdapter(),
  new BoardsUnitComparisonAdapter(),
]);

interface ComparisonSide {
  readonly revision?: number;
  readonly unitData: unknown | null;
}

export interface WorkspaceUnitComparisonPayload {
  readonly result: Omit<IUnitComparisonResult, "items" | "productContext"> & {
    readonly items: readonly (IUnitComparisonItem & {
      readonly title: string;
      readonly details: readonly [];
    })[];
    readonly productContext: unknown;
  };
  readonly left: ComparisonSide;
  readonly right: ComparisonSide;
}

export async function createWorkspaceUnitComparison(input: {
  readonly service: UniverCollabService;
  readonly worktreeService: UniverCollabWorktreeService;
  readonly userId: string;
  readonly worktreeId: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly unitType: UnitType;
  readonly source: "trunk" | "worktree";
  readonly change: "modified" | "added" | "deleted" | "unchanged";
}): Promise<WorkspaceUnitComparisonPayload> {
  const type = toUniverType(input.unitType);
  const context = {
    userID: input.userId,
    customData: { source: "workspace-comparison" },
  };
  const worktree = (
    await input.worktreeService.getWorktree(
      { worktreeID: input.worktreeId },
      context,
    )
  ).worktree;
  const unit = worktree.units.find(
    (candidate) => candidate.unitID === input.unitId,
  );
  if (!unit) {
    throw new Error(
      `Unit ${input.unitId} is not part of Worktree ${input.worktreeId}.`,
    );
  }

  const leftPromise =
    input.source === "trunk"
      ? loadTrunkSide(input.service, input.unitId, type, context)
      : Promise.resolve(null);
  const rightPromise =
    input.change === "deleted"
      ? Promise.resolve(null)
      : loadWorktreeSide(
          input.worktreeService,
          input.worktreeId,
          unit,
          type,
          context,
        );
  const [left, right] = await Promise.all([leftPromise, rightPromise]);
  const history = await loadComparisonHistory({
    service: input.service,
    worktreeService: input.worktreeService,
    worktreeId: input.worktreeId,
    unit,
    type,
    ...(left?.revision === undefined
      ? {}
      : { leftRevision: left.revision }),
    ...(right?.revision === undefined
      ? {}
      : { rightRevision: right.revision }),
    context,
  });
  const comparisonId = `workspace-comparison-${randomUUID()}`;
  const prepared = comparisonEngine.prepare({
    comparisonId,
    unitId: input.unitId,
    unitName: input.unitName,
    type,
    fidelity: history.fidelity,
    ...(history.commonBaseRevision === undefined
      ? {}
      : { commonBaseRevision: history.commonBaseRevision }),
    stale: false,
    leftData: left?.unitData,
    rightData: right?.unitData,
    leftChangesets: history.leftChangesets,
    rightChangesets: history.rightChangesets,
  });

  return {
    result: completeComparisonResult(prepared),
    left: left ?? { unitData: null },
    right: right ?? { unitData: null },
  };
}

async function loadTrunkSide(
  service: UniverCollabService,
  unitId: string,
  type: UniverType,
  context: Parameters<UniverCollabService["getUnitLoadDataWithBlocks"]>[1],
): Promise<ComparisonSide> {
  let loadData = await service.getUnitLoadDataWithBlocks(
    { unitID: unitId, type, revision: 0 },
    context,
  );
  if (loadData.snapshot.workbook && loadData.sheetBlocks.length === 0) {
    loadData = {
      ...loadData,
      sheetBlocks: await readTrunkSheetBlocks(
        service,
        unitId,
        type,
        loadData.snapshot,
        context,
      ),
    };
  }
  return materializeSide(loadData, type);
}

async function loadWorktreeSide(
  service: UniverCollabWorktreeService,
  worktreeId: string,
  unit: WorktreeUnitData,
  type: UniverType,
  context: Parameters<UniverCollabWorktreeService["getUnitLoadData"]>[1],
): Promise<ComparisonSide> {
  const loadData = await service.getUnitLoadData(
    {
      worktreeID: worktreeId,
      unitID: unit.unitID,
      type,
      revision: unit.draftHeadRevision,
    },
    context,
  );
  const sheetBlocks = loadData.snapshot.workbook
    ? await readWorktreeSheetBlocks(
        service,
        worktreeId,
        unit.unitID,
        type,
        loadData.snapshot,
        context,
      )
    : [];
  return materializeSide({ ...loadData, sheetBlocks }, type);
}

async function materializeSide(
  loadData: UnitLoadDataWithBlocks,
  type: UniverType,
): Promise<ComparisonSide> {
  const materializer = new UnitSnapshotMaterializer();
  try {
    const materialized = await materializer.materializeSnapshot(loadData);
    return {
      revision: loadData.targetRevision,
      unitData: await decodeUnitData(
        type,
        materialized.snapshot,
        materialized.sheetBlocks,
      ),
    };
  } finally {
    await materializer.dispose();
  }
}

async function readTrunkSheetBlocks(
  service: UniverCollabService,
  unitId: string,
  type: UniverType,
  snapshot: ISnapshot,
  context: Parameters<UniverCollabService["getSheetBlock"]>[1],
): Promise<readonly ISheetBlock[]> {
  const blockIds = snapshotBlockIds(snapshot);
  const blocks = await Promise.all(
    blockIds.map(async (blockID) => {
      const result = await service.getSheetBlock(
        { unitID: unitId, type, blockID },
        context,
      );
      return result.block;
    }),
  );
  return blocks.filter((block): block is ISheetBlock => block !== undefined);
}

async function readWorktreeSheetBlocks(
  service: UniverCollabWorktreeService,
  worktreeId: string,
  unitId: string,
  type: UniverType,
  snapshot: ISnapshot,
  context: Parameters<UniverCollabWorktreeService["getSheetBlock"]>[1],
): Promise<readonly ISheetBlock[]> {
  const blocks = await Promise.all(
    snapshotBlockIds(snapshot).map(async (blockID) => {
      const result = await service.getSheetBlock(
        { worktreeID: worktreeId, unitID: unitId, type, blockID },
        context,
      );
      return result.block;
    }),
  );
  return blocks.filter((block): block is ISheetBlock => block !== undefined);
}

function snapshotBlockIds(snapshot: ISnapshot): readonly string[] {
  return Object.values(snapshot.workbook?.blockMeta ?? {}).flatMap(
    (metadata) => metadata.blocks,
  );
}

async function loadComparisonHistory(input: {
  readonly service: UniverCollabService;
  readonly worktreeService: UniverCollabWorktreeService;
  readonly worktreeId: string;
  readonly unit: WorktreeUnitData;
  readonly type: UniverType;
  readonly leftRevision?: number;
  readonly rightRevision?: number;
  readonly context: Parameters<UniverCollabService["getChangesets"]>[1];
}): Promise<{
  readonly fidelity: UnitComparisonFidelity;
  readonly commonBaseRevision?: number;
  readonly leftChangesets: readonly IChangeset[];
  readonly rightChangesets: readonly IChangeset[];
}> {
  const commonBaseRevision = input.unit.baselineTrunkRevision;
  if (
    commonBaseRevision === undefined ||
    input.leftRevision === undefined ||
    input.rightRevision === undefined
  ) {
    return snapshotHistory();
  }
  try {
    const [left, right] = await Promise.all([
      input.service.getChangesets(
        {
          unitID: input.unit.unitID,
          type: input.type,
          from: commonBaseRevision,
          to: input.leftRevision,
        },
        input.context,
      ),
      input.worktreeService.getChangesets(
        {
          worktreeID: input.worktreeId,
          unitID: input.unit.unitID,
          type: input.type,
          from: commonBaseRevision,
          to: input.rightRevision,
        },
        input.context,
      ),
    ]);
    return {
      fidelity: UnitComparisonFidelity.HISTORY,
      commonBaseRevision,
      leftChangesets: left.changesets,
      rightChangesets: right.changesets,
    };
  } catch {
    return snapshotHistory();
  }
}

function snapshotHistory(): {
  readonly fidelity: UnitComparisonFidelity;
  readonly leftChangesets: readonly [];
  readonly rightChangesets: readonly [];
} {
  return {
    fidelity: UnitComparisonFidelity.SNAPSHOT,
    leftChangesets: [],
    rightChangesets: [],
  };
}

function completeComparisonResult(
  prepared: IPreparedUnitComparison,
): WorkspaceUnitComparisonPayload["result"] {
  const items: Array<
    IUnitComparisonItem & { readonly title: string; readonly details: readonly [] }
  > = [];
  let offset = 0;
  let first: IUnitComparisonResult | undefined;
  do {
    const page = comparisonEngine.query(prepared, {
      detail: UnitComparisonDetailLevel.FULL,
      offset,
      limit: 1_000,
    });
    first ??= page;
    items.push(
      ...page.items.map((item) => ({
        ...item,
        title: item.displayName ?? item.stableId,
        details: [] as const,
      })),
    );
    offset += page.items.length;
    if (!page.page.hasMore) break;
    if (page.items.length === 0) {
      throw new Error("Unit comparison returned an incomplete page.");
    }
  } while (true);

  if (!first) {
    throw new Error("Unit comparison did not return a result.");
  }
  return {
    ...first,
    page: {
      offset: 0,
      limit: items.length,
      matched: first.page.matched,
      hasMore: false,
    },
    items,
    productContext: viewerProductContext(
      prepared.metadata.type,
      prepared.adapterResult.productContext,
      prepared.adapterResult.items,
    ),
  };
}

function viewerProductContext(
  type: UniverInstanceType,
  context: IUnitComparisonProductContext | undefined,
  items: readonly IUnitComparisonItem[],
): unknown {
  if (type === UniverInstanceType.UNIVER_SHEET) {
    return {
      kind: "sheet",
      sheets:
        context?.type === UniverInstanceType.UNIVER_SHEET
          ? context.sheets.map((sheet) => ({
              id: sheet.sheetId,
              name: sheet.name,
              status: sheetStatus(
                items,
                sheet.sheetId,
                sheet.changeCount
              ),
              changeCount: sheet.changeCount,
              rows: sheet.rows,
              columns: sheet.columns,
            }))
          : [],
    };
  }
  if (type === UniverInstanceType.UNIVER_DOC) {
    const alignment =
      context?.type === UniverInstanceType.UNIVER_DOC
        ? context.paragraphAlignment
        : [];
    const itemByStableId = new Map(
      items
        .filter((item) => item.entityType === "paragraph")
        .map((item) => [
          JSON.stringify([item.parentStableId, item.stableId]),
          item,
        ]),
    );
    const rows = alignment.map((row, index) => {
      const parent = row.segmentPath
        ? `${row.segmentPath[0]}:${row.segmentPath[1]}`
        : undefined;
      const item = itemByStableId.get(
        JSON.stringify([parent, row.stableId]),
      );
      return {
        id: `paragraph:${parent ?? "body"}:${row.stableId}:${index}`,
        stableId: row.stableId,
        kind: item?.kind ?? "equal",
        moved: item?.moved ?? false,
        leftIndex: row.leftPosition,
        rightIndex: row.rightPosition,
        leftNativeStableId: row.leftNativeStableId,
        rightNativeStableId: row.rightNativeStableId,
        ...(row.segmentPath ? { segmentPath: row.segmentPath } : {}),
      };
    });
    return {
      kind: "doc",
      paragraphAlignment: {
        total: rows.length,
        rows,
        page: {
          offset: 0,
          limit: rows.length,
          matched: rows.length,
          hasMore: false,
        },
      },
    };
  }
  if (type === UniverInstanceType.UNIVER_SLIDE) return { kind: "slide" };
  if (type === UniverInstanceType.UNIVER_BASE) {
    return { kind: "base", visualProjection: "raw-table-data" };
  }
  return { kind: "board" };
}

function sheetStatus(
  items: readonly IUnitComparisonItem[],
  sheetId: string,
  changeCount: number,
): "delete" | "insert" | "update" | "unchanged" {
  const worksheet = items.find(
    (item) =>
      item.entityType === "worksheet" && item.stableId === sheetId,
  );
  return worksheet?.kind ?? (changeCount > 0 ? "update" : "unchanged");
}

async function decodeUnitData(
  type: UniverType,
  snapshot: ISnapshot,
  sheetBlocks: readonly ISheetBlock[],
): Promise<unknown> {
  if (type === UniverInstanceType.UNIVER_DOC) {
    return transformSnapshotToDocumentData(snapshot);
  }
  if (type === UniverInstanceType.UNIVER_SLIDE) {
    return transformSnapshotToSlideData(snapshot);
  }
  if (type === UniverInstanceType.UNIVER_SHEET) {
    return transformSnapshotToWorkbookData(
      snapshot,
      structuredClone([...sheetBlocks])
    );
  }
  if (type === UniverInstanceType.UNIVER_BASE) {
    return transformSnapshotToBaseData(
      snapshot,
      structuredClone([...sheetBlocks])
    );
  }
  if (type === UniverInstanceType.UNIVER_BOARD) {
    return transformSnapshotToBoardData(snapshot);
  }
  throw new Error(`Unsupported comparison Unit type: ${String(type)}.`);
}

function toUniverType(type: UnitType): UnitComparisonType {
  switch (type) {
    case "sheet":
      return UniverInstanceType.UNIVER_SHEET;
    case "doc":
      return UniverInstanceType.UNIVER_DOC;
    case "slide":
      return UniverInstanceType.UNIVER_SLIDE;
    case "base":
      return UniverInstanceType.UNIVER_BASE;
    case "board":
      return UniverInstanceType.UNIVER_BOARD;
  }
}
