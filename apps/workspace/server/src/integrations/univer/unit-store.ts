import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type * as BoardsModule from "@univerjs-pro/boards";
import type * as CollaborationDatabaseModule from "@univerjs-pro/collaboration-database-sqlite";
import type * as CollaborationServiceModule from "@univerjs-pro/collaboration-service";
import type * as WorktreeServiceModule from "@univerjs-pro/collaboration-worktree-service";
import type * as WorktreeDatabaseModule from "@univerjs-pro/collaboration-worktree-database-sqlite";
import type * as SlidesModule from "@univerjs-pro/slides";
import type * as CoreModule from "@univerjs/core";
import type * as ProtocolModule from "@univerjs/protocol";
import type { UnitType } from "../../modules/access/index.js";

const moduleRequire = createRequire(import.meta.url);
const { getBoardsEmptySnapshot } = moduleRequire(
  "@univerjs-pro/boards"
) as typeof BoardsModule;
const { SQLiteDatabaseAdapter } = moduleRequire(
  "@univerjs-pro/collaboration-database-sqlite"
) as typeof CollaborationDatabaseModule;
const { CollabError, UniverCollabService } = moduleRequire(
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

export interface CollaborationRuntime {
  readonly unitStore: UnitStore;
  readonly service: CollaborationServiceModule.UniverCollabService;
  readonly worktreeService: WorktreeServiceModule.UniverCollabWorktreeService;
  dispose(): Promise<void>;
}

export function createCollaborationRuntime(
  filename: string
): CollaborationRuntime {
  const database = new SQLiteDatabaseAdapter({ filename });
  const service = new UniverCollabService({ dbAdapter: database });
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
        const loaded = await service.getUnit(
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
          loaded.headRevision !== created.headRevision
        ) {
          throw unitIdentityMismatch(input.unitId);
        }
        return {
          unitId: created.unitID,
          headRevision: loaded.headRevision,
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

  return {
    unitStore,
    service,
    worktreeService,
    async dispose() {
      await worktreeService.dispose();
      await worktreeDatabase.dispose();
      await service.dispose();
      await database.dispose();
    },
  };
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
