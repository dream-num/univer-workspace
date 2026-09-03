import { createRequire } from "node:module";
import type * as BasesHistoryModule from "@univerjs-pro/bases-history";
import type * as BoardsHistoryModule from "@univerjs-pro/boards-history";
import type * as CollaborationModule from "@univerjs-pro/collaboration";
import type * as CollaborationServiceModule from "@univerjs-pro/collaboration-service";
import type * as WorktreeServiceModule from "@univerjs-pro/collaboration-worktree-service";
import type * as DocsHistoryModule from "@univerjs-pro/docs-history";
import type * as EditHistoryModule from "@univerjs-pro/edit-history";
import type * as SheetsHistoryModule from "@univerjs-pro/sheets-history";
import type * as SlidesHistoryModule from "@univerjs-pro/slides-history";
import type * as ProtocolModule from "@univerjs/protocol";
import type { UnitType } from "../../modules/access/index.js";
import type {
  WorktreeComparisonBackend,
  WorktreeComparisonSide,
} from "../../modules/worktrees/index.js";
import { collaborationCallOptions } from "./unit-store.js";

const moduleRequire = createRequire(import.meta.url);
const { BasesUnitComparisonAdapter } = moduleRequire(
  "@univerjs-pro/bases-history"
) as typeof BasesHistoryModule;
const { BoardsUnitComparisonAdapter } = moduleRequire(
  "@univerjs-pro/boards-history"
) as typeof BoardsHistoryModule;
const {
  transformSnapshotToBaseData,
  transformSnapshotToBoardData,
  transformSnapshotToDocumentData,
  transformSnapshotToSlideData,
  transformSnapshotToWorkbookData,
} = moduleRequire(
  "@univerjs-pro/collaboration"
) as typeof CollaborationModule;
const { UnitSnapshotMaterializer, CollabError } = moduleRequire(
  "@univerjs-pro/collaboration-service"
) as typeof CollaborationServiceModule;
const { DocsUnitComparisonAdapter } = moduleRequire(
  "@univerjs-pro/docs-history"
) as typeof DocsHistoryModule;
const {
  createUnitComparisonEngine,
  UnitComparisonDetailLevel,
  UnitComparisonFidelity,
} = moduleRequire("@univerjs-pro/edit-history") as typeof EditHistoryModule;
const { SheetsUnitComparisonAdapter } = moduleRequire(
  "@univerjs-pro/sheets-history"
) as typeof SheetsHistoryModule;
const { SlidesUnitComparisonAdapter } = moduleRequire(
  "@univerjs-pro/slides-history"
) as typeof SlidesHistoryModule;
const { UniverType } = moduleRequire(
  "@univerjs/protocol"
) as typeof ProtocolModule;

const comparisonEngine = createUnitComparisonEngine([
  new DocsUnitComparisonAdapter(),
  new SheetsUnitComparisonAdapter(),
  new SlidesUnitComparisonAdapter(),
  new BasesUnitComparisonAdapter(),
  new BoardsUnitComparisonAdapter(),
]);

interface MaterializedSide extends WorktreeComparisonSide {
  readonly data?: Readonly<Record<string, unknown>>;
}

export function createWorktreeComparisonBackend(options: {
  readonly trunk: CollaborationServiceModule.UniverCollabService;
  readonly worktree: WorktreeServiceModule.UniverCollabWorktreeService;
}): WorktreeComparisonBackend {
  return {
    async compareUnit(input, userId) {
      const capturedAt = new Date().toISOString();
      const callOptions = collaborationCallOptions(userId);
      const type = protocolUnitType(input.unitType);
      const worktree = (
        await options.worktree.getWorktree(
          { worktreeID: input.worktreeId },
          callOptions
        )
      ).worktree;
      const worktreeUnit = worktree.units.find(
        (candidate) => candidate.unitID === input.unitId
      );
      if (!worktreeUnit || worktreeUnit.type !== type) {
        throw new Error(
          `Unit ${input.unitId} is not part of Worktree ${input.worktreeId}.`
        );
      }

      const [left, right] = await Promise.all([
        worktreeUnit.source === "worktree"
          ? Promise.resolve<MaterializedSide>({ present: false })
          : materializeTrunkSide(
              options.trunk,
              input.unitId,
              type,
              userId
            ),
        materializeWorktreeSide(
          options.worktree,
          input.worktreeId,
          input.unitId,
          type,
          worktreeUnit.draftHeadRevision,
          userId
        ),
      ]);
      const history = await comparisonHistory({
        trunk: options.trunk,
        worktree: options.worktree,
        worktreeId: input.worktreeId,
        unitId: input.unitId,
        type,
        userId,
        ...(worktreeUnit.baselineTrunkRevision === undefined
          ? {}
          : { baselineRevision: worktreeUnit.baselineTrunkRevision }),
        ...(left.revision === undefined
          ? {}
          : { leftRevision: left.revision }),
        ...(right.revision === undefined
          ? {}
          : { rightRevision: right.revision }),
        paired: left.present && right.present,
      });
      const comparisonId = [
        "request",
        input.worktreeId,
        input.unitId,
        left.revision ?? "missing",
        right.revision ?? "missing",
      ].join(":");
      const diff = comparisonEngine.compare({
        comparisonId,
        unitId: input.unitId,
        unitName: input.name,
        type,
        fidelity:
          history.fidelity === "history"
            ? UnitComparisonFidelity.HISTORY
            : UnitComparisonFidelity.SNAPSHOT,
        ...(history.commonBaseRevision === undefined
          ? {}
          : { commonBaseRevision: history.commonBaseRevision }),
        stale: false,
        leftData: left.data,
        rightData: right.data,
        leftChangesets: history.leftChangesets,
        rightChangesets: history.rightChangesets,
        query: {
          detail: UnitComparisonDetailLevel.FULL,
          limit: 1_000,
          contextLimit: 1_000,
        },
      });

      return {
        capturedAt,
        unit: {
          unitId: input.unitId,
          unitType: input.unitType,
          name: input.name,
        },
        fidelity: history.fidelity,
        ...(history.commonBaseRevision === undefined
          ? {}
          : { commonBaseRevision: history.commonBaseRevision }),
        left,
        right,
        diff: diff as unknown as Readonly<Record<string, unknown>>,
      };
    },
  };
}

async function materializeTrunkSide(
  service: CollaborationServiceModule.UniverCollabService,
  unitId: string,
  type: ProtocolModule.UniverType,
  userId: string
): Promise<MaterializedSide> {
  try {
    const callOptions = collaborationCallOptions(userId);
    const loadData = await service.getUnitLoadData(
      { unitID: unitId, type, revision: 0 },
      callOptions
    );
    const sheetBlocks = await referencedSheetBlocks(
      loadData.snapshot,
      async (blockID) =>
        (
          await service.getSheetBlock(
            { unitID: unitId, type, blockID },
            callOptions
          )
        ).block
    );
    return await materialize({ ...loadData, sheetBlocks }, type);
  } catch (error) {
    if (error instanceof CollabError && error.code === "UNIT_NOT_FOUND") {
      return { present: false };
    }
    throw error;
  }
}

async function materializeWorktreeSide(
  service: WorktreeServiceModule.UniverCollabWorktreeService,
  worktreeId: string,
  unitId: string,
  type: ProtocolModule.UniverType,
  revision: number,
  userId: string
): Promise<MaterializedSide> {
  const callOptions = collaborationCallOptions(userId);
  const loadData = await service.getUnitLoadData(
    { worktreeID: worktreeId, unitID: unitId, type, revision },
    callOptions
  );
  const sheetBlocks = await referencedSheetBlocks(
    loadData.snapshot,
    async (blockID) =>
      (
        await service.getSheetBlock(
          { worktreeID: worktreeId, unitID: unitId, type, blockID },
          callOptions
        )
      ).block
  );
  return await materialize(
    { ...loadData, sheetBlocks },
    type
  );
}

async function referencedSheetBlocks(
  snapshot: ProtocolModule.ISnapshot,
  loadBlock: (
    blockID: string
  ) => Promise<ProtocolModule.ISheetBlock | null>
): Promise<ProtocolModule.ISheetBlock[]> {
  if (snapshot.workbook === undefined) return [];
  const blocks = await Promise.all(
    [
      ...new Set(
        Object.values(snapshot.workbook.blockMeta ?? {}).flatMap(
          (metadata) => metadata.blocks
        )
      ),
    ].map(loadBlock)
  );
  return blocks.filter(
    (block): block is ProtocolModule.ISheetBlock => block !== null
  );
}

async function materialize(
  loadData: CollaborationServiceModule.UnitLoadDataWithBlocks,
  type: ProtocolModule.UniverType
): Promise<MaterializedSide> {
  const materializer = new UnitSnapshotMaterializer();
  try {
    const value = await materializer.materializeSnapshot(loadData);
    const data = await decodeUnitData(type, value);
    return {
      present: true,
      revision: loadData.targetRevision,
      data: data as Readonly<Record<string, unknown>>,
    };
  } finally {
    await materializer.dispose();
  }
}

async function decodeUnitData(
  type: ProtocolModule.UniverType,
  value: CollaborationServiceModule.ISnapshotWithBlocks
): Promise<unknown> {
  switch (type) {
    case UniverType.UNIVER_SHEET:
      return await transformSnapshotToWorkbookData(
        value.snapshot,
        value.sheetBlocks
      );
    case UniverType.UNIVER_DOC:
      return transformSnapshotToDocumentData(value.snapshot);
    case UniverType.UNIVER_SLIDE:
      return transformSnapshotToSlideData(value.snapshot);
    case UniverType.UNIVER_BOARD:
      return transformSnapshotToBoardData(value.snapshot);
    case UniverType.UNIVER_BASE:
      return await transformSnapshotToBaseData(
        value.snapshot,
        value.sheetBlocks
      );
    default:
      throw new Error(`Unsupported comparison Unit type ${String(type)}.`);
  }
}

async function comparisonHistory(input: {
  readonly trunk: CollaborationServiceModule.UniverCollabService;
  readonly worktree: WorktreeServiceModule.UniverCollabWorktreeService;
  readonly worktreeId: string;
  readonly unitId: string;
  readonly type: ProtocolModule.UniverType;
  readonly userId: string;
  readonly baselineRevision?: number;
  readonly leftRevision?: number;
  readonly rightRevision?: number;
  readonly paired: boolean;
}): Promise<{
  readonly fidelity: "history" | "snapshot";
  readonly commonBaseRevision?: number;
  readonly leftChangesets: readonly ProtocolModule.IChangeset[];
  readonly rightChangesets: readonly ProtocolModule.IChangeset[];
}> {
  const baseline = input.baselineRevision;
  if (
    !input.paired ||
    baseline === undefined ||
    input.leftRevision === undefined ||
    input.rightRevision === undefined
  ) {
    return {
      fidelity: "snapshot",
      leftChangesets: [],
      rightChangesets: [],
    };
  }
  try {
    const callOptions = collaborationCallOptions(input.userId);
    const [left, right] = await Promise.all([
      input.trunk.getChangesets(
        {
          unitID: input.unitId,
          type: input.type,
          from: baseline,
          to: input.leftRevision,
        },
        callOptions
      ),
      input.worktree.getChangesets(
        {
          worktreeID: input.worktreeId,
          unitID: input.unitId,
          type: input.type,
          from: baseline,
          to: input.rightRevision,
        },
        callOptions
      ),
    ]);
    return {
      fidelity: "history",
      commonBaseRevision: baseline,
      leftChangesets: left.changesets,
      rightChangesets: right.changesets,
    };
  } catch {
    return {
      fidelity: "snapshot",
      leftChangesets: [],
      rightChangesets: [],
    };
  }
}

function protocolUnitType(
  unitType: UnitType
): EditHistoryModule.UnitComparisonType {
  switch (unitType) {
    case "sheet":
      return UniverType.UNIVER_SHEET;
    case "doc":
      return UniverType.UNIVER_DOC;
    case "slide":
      return UniverType.UNIVER_SLIDE;
    case "board":
      return UniverType.UNIVER_BOARD;
    case "base":
      return UniverType.UNIVER_BASE;
  }
}
