import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type * as BoardsModule from "@univerjs-pro/boards";
import type * as CommentDatabaseModule from "@univerjs-pro/collaboration-comment-database-sqlite";
import type * as CommentServiceModule from "@univerjs-pro/collaboration-comment-service";
import type * as CollaborationDatabaseModule from "@univerjs-pro/collaboration-database-sqlite";
import type * as HistoryDatabaseModule from "@univerjs-pro/collaboration-history-database-sqlite";
import type * as HistoryServiceModule from "@univerjs-pro/collaboration-history-service";
import type * as CollaborationServiceModule from "@univerjs-pro/collaboration-service";
import type * as WorktreeServiceModule from "@univerjs-pro/collaboration-worktree-service";
import type * as WorktreeDatabaseModule from "@univerjs-pro/collaboration-worktree-database-sqlite";
import type * as SlidesModule from "@univerjs-pro/slides";
import type * as CoreModule from "@univerjs/core";
import type * as ProtocolModule from "@univerjs/protocol";
import type { UnitType } from "../../modules/access/index.js";
import {
  type ExistingHistoryUnit,
  backfillExistingHistory,
} from "./history/compatibility/backfill-existing-history.js";

const moduleRequire = createRequire(import.meta.url);
const { getBoardsEmptySnapshot } = moduleRequire(
  "@univerjs-pro/boards"
) as typeof BoardsModule;
const { SQLiteCommentDatabaseAdapter } = moduleRequire(
  "@univerjs-pro/collaboration-comment-database-sqlite"
) as typeof CommentDatabaseModule;
const { UniverCommentService } = moduleRequire(
  "@univerjs-pro/collaboration-comment-service"
) as typeof CommentServiceModule;
const { SQLiteDatabaseAdapter } = moduleRequire(
  "@univerjs-pro/collaboration-database-sqlite"
) as typeof CollaborationDatabaseModule;
const { SQLiteHistoryDatabaseAdapter } = moduleRequire(
  "@univerjs-pro/collaboration-history-database-sqlite"
) as typeof HistoryDatabaseModule;
const { UniverHistoryService } = moduleRequire(
  "@univerjs-pro/collaboration-history-service"
) as typeof HistoryServiceModule;
const {
  CollabError,
  UnitSnapshotMaterializer,
  UniverCollabService,
} = moduleRequire(
  "@univerjs-pro/collaboration-service"
) as typeof CollaborationServiceModule;
const { UniverCollabWorktreeService } = moduleRequire(
  "@univerjs-pro/collaboration-worktree-service"
) as typeof WorktreeServiceModule;
const { SQLiteWorktreeDatabaseAdapter } = moduleRequire(
  "@univerjs-pro/collaboration-worktree-database-sqlite"
) as typeof WorktreeDatabaseModule;
const { getSlidesEmptySnapshot } = moduleRequire(
  "@univerjs-pro/slides"
) as typeof SlidesModule;
const {
  DocumentFlavor,
  getBasesEmptySnapshot,
  getDocsEmptySnapshot,
  getSheetsEmptySnapshot,
  LocaleType,
  mergeWorksheetSnapshotWithDefault,
} = moduleRequire("@univerjs/core") as typeof CoreModule;
const { UniverType } = moduleRequire(
  "@univerjs/protocol"
) as typeof ProtocolModule;

export class UnitStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "UnitStoreError";
  }
}

export interface UnitStore {
  createUnit(input: {
    readonly unitId: string;
    readonly unitType: UnitType;
    readonly name: string;
    readonly userId: string;
    readonly initialData?: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly unitId: string;
    readonly headRevision: number;
  }>;
}

export interface UnitSnapshotStore {
  materialize(input: {
    readonly unitId: string;
    readonly unitType: UnitType;
    readonly userId: string;
  }): Promise<CollaborationServiceModule.ISnapshotWithBlocks>;
}

export interface CollaborationRuntime {
  readonly unitStore: UnitStore;
  readonly unitSnapshotStore: UnitSnapshotStore;
  readonly service: CollaborationServiceModule.UniverCollabService;
  readonly commentService: CommentServiceModule.UniverCommentService;
  readonly historyService: HistoryServiceModule.UniverHistoryService;
  readonly worktreeService: WorktreeServiceModule.UniverCollabWorktreeService;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

export function createCollaborationRuntime(
  filename: string,
  options: {
    readonly commentUserProvider?: CommentServiceModule.ICommentUserProvider;
    readonly historyUserProvider?: HistoryServiceModule.IHistoryUserProvider;
    readonly existingHistoryUnits?: () => readonly ExistingHistoryUnit[];
  } = {}
): CollaborationRuntime {
  const database = new SQLiteDatabaseAdapter({ filename });
  const service = new UniverCollabService({ dbAdapter: database });
  const historyDatabase = new SQLiteHistoryDatabaseAdapter({ filename });
  const historyService = new UniverHistoryService({
    collabService: service,
    dbAdapter: historyDatabase,
    ...(options.historyUserProvider
      ? { userProvider: options.historyUserProvider }
      : {}),
  });
  const historyAttachment = historyService.attach(service);

  const commentDatabase = new SQLiteCommentDatabaseAdapter({ filename });
  const commentService = new UniverCommentService({
    database: commentDatabase,
    ...(options.commentUserProvider
      ? { userProvider: options.commentUserProvider }
      : {}),
  });
  const worktreeDatabase = new SQLiteWorktreeDatabaseAdapter({ filename });
  const worktreeService = new UniverCollabWorktreeService({
    trunk: {
      service,
      dbAdapter: database,
    },
    dbAdapter: worktreeDatabase,
  });
  const unitStore: UnitStore = {
    async createUnit(input) {
      try {
        const options = collaborationCallOptions(input.userId);
        const unitData = createUnitData(input);
        const created = await service.createUnitFromData(unitData, options);
        await historyService.indexUnitCreated(
          {
            unitID: created.unitID,
            type: unitData.type,
            createdAt: Date.now(),
          },
          options
        );
        const loaded = await service.getUnitLoadData(
          {
            unitID: input.unitId,
            type: unitData.type,
            revision: 0,
          },
          options
        );
        if (
          created.unitID !== input.unitId ||
          loaded.snapshot.unitID !== input.unitId ||
          loaded.snapshot.type !== unitData.type ||
          loaded.targetRevision !== created.headRevision
        ) {
          throw unitIdentityMismatch(input.unitId);
        }
        return {
          unitId: created.unitID,
          headRevision: loaded.targetRevision,
        };
      } catch (error) {
        if (error instanceof UnitStoreError) throw error;
        if (error instanceof CollabError) {
          throw new UnitStoreError(
            error.code,
            error.message,
            error.retryable,
            { cause: error }
          );
        }
        throw error;
      }
    },
  };
  const unitSnapshotStore: UnitSnapshotStore = {
    async materialize(input) {
      const loadData = await service.getUnitLoadDataWithBlocks(
        {
          unitID: input.unitId,
          type: univerType(input.unitType),
          revision: 0,
        },
        {
          userID: input.userId,
          customData: { source: "workspace-exchange" },
        }
      );
      const materializer = new UnitSnapshotMaterializer();
      try {
        return await materializer.materializeSnapshot(loadData);
      } finally {
        await materializer.dispose();
      }
    },
  };

  return {
    unitStore,
    unitSnapshotStore,
    service,
    commentService,
    historyService,
    worktreeService,
    initialize() {
      // Startup-only compatibility for data written before persistent History
      // was enabled. The application calls this once before accepting traffic.
      return backfillExistingHistory({
        collaborationDatabase: database,
        historyDatabase,
        historyService,
        units: options.existingHistoryUnits?.() ?? [],
      });
    },
    async dispose() {
      await worktreeService.dispose();
      await worktreeDatabase.dispose();
      await commentService.dispose();
      await commentDatabase.dispose();
      historyAttachment.dispose();
      await historyService.dispose();
      await historyDatabase.dispose();
      await service.dispose();
      await database.dispose();
    },
  };
}

function univerType(unitType: UnitType): ProtocolModule.UniverType {
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

export function blankUnitData(input: {
  readonly unitId: string;
  readonly unitType: UnitType;
  readonly name: string;
}): CollaborationServiceModule.CreateUnitFromDataInput {
  switch (input.unitType) {
    case "sheet": {
      const data = getSheetsEmptySnapshot(
        input.unitId,
        LocaleType.EN_US,
        input.name
      );
      const sheetId = randomUUID();
      data.rev = 1;
      data.sheetOrder = [sheetId];
      data.sheets = {
        [sheetId]: mergeWorksheetSnapshotWithDefault({
          id: sheetId,
          name: "Sheet 1",
        }),
      };
      return { type: UniverType.UNIVER_SHEET, data };
    }
    case "doc": {
      const data = getDocsEmptySnapshot(
        input.unitId,
        LocaleType.EN_US,
        input.name,
        DocumentFlavor.MODERN
      );
      data.rev = 1;
      return { type: UniverType.UNIVER_DOC, data };
    }
    case "slide": {
      const data = getSlidesEmptySnapshot(
        input.unitId,
        LocaleType.EN_US,
        input.name
      );
      data.rev = 1;
      return { type: UniverType.UNIVER_SLIDE, data };
    }
    case "board": {
      const data = getBoardsEmptySnapshot(
        input.unitId,
        input.name,
        LocaleType.EN_US
      );
      data.rev = 1;
      return { type: UniverType.UNIVER_BOARD, data };
    }
    case "base": {
      const data = getBasesEmptySnapshot(
        input.unitId,
        input.name,
        LocaleType.EN_US
      );
      data.rev = 1;
      return { type: UniverType.UNIVER_BASE, data };
    }
  }
}

export function createUnitData(input: {
  readonly unitId: string;
  readonly unitType: UnitType;
  readonly name: string;
  readonly initialData?: Readonly<Record<string, unknown>>;
}): CollaborationServiceModule.CreateUnitFromDataInput {
  const empty = blankUnitData(input);
  if (input.initialData === undefined) return empty;
  return {
    type: empty.type,
    data: {
      ...structuredClone(input.initialData),
      id: input.unitId,
      rev: 1,
    },
  } as CollaborationServiceModule.CreateUnitFromDataInput;
}

function unitIdentityMismatch(unitId: string): UnitStoreError {
  return new UnitStoreError(
    "UNIT_ID_MISMATCH",
    `Collaboration Unit identity did not match reserved Unit ${unitId}.`,
    false
  );
}

export function collaborationCallOptions(
  userId: string
): CollaborationServiceModule.CollabMemberContext {
  return {
    memberID: `product-api:${userId}`,
    userID: userId,
    customData: { source: "product-api" },
  };
}
