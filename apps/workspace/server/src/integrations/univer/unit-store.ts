import type { CollaborationDatabase } from "./collaboration-database/collaboration-database.js";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import type * as BoardsModule from "@univerjs-pro/boards";
import type * as CommentServiceModule from "@univerjs-pro/collaboration-comment-service";
import type * as HistoryServiceModule from "@univerjs-pro/collaboration-history-service";
import type * as PdfsModule from "@univerjs-pro/pdfs";
import type * as CollaborationServiceModule from "@univerjs-pro/collaboration-service";
import type * as WorktreeServiceModule from "@univerjs-pro/collaboration-worktree-service";
import type * as SlidesModule from "@univerjs-pro/slides";
import type * as CoreModule from "@univerjs/core";
import type * as ProtocolModule from "@univerjs/protocol";
import type { UnitType } from "../../modules/access/index.js";
import {
  BUNDLED_UNIVER_LICENSE,
  type UniverLicenseCredentials,
} from "./univer-license.js";

const moduleRequire = createRequire(import.meta.url);
const { getBoardsEmptySnapshot } = moduleRequire(
  "@univerjs-pro/boards"
) as typeof BoardsModule;
const { UniverCommentService } = moduleRequire(
  "@univerjs-pro/collaboration-comment-service"
) as typeof CommentServiceModule;
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

/**
 * The server-side Unit runtime (changeset application and snapshot
 * materialization) runs in worker-thread pools that boot one SDK instance per
 * worker, about a second each. Worker counts are explicit so an SDK default
 * change does not change this deployment's thread and memory footprint.
 *
 * The trunk Service and the materializer each get half the available CPUs; the
 * materializer is created once and reused, never per request. Each Worktree has
 * its own Draft Service, usually a few Units edited by a few users, so it gets
 * one Worker.
 */
const UNIT_RUNTIME: CollaborationServiceModule.UnitRuntimeConfig = {
  execution: {
    mode: "worker",
    workerCount: Math.max(1, Math.floor(availableParallelism() / 2)),
  },
};
const WORKTREE_UNIT_RUNTIME: CollaborationServiceModule.UnitRuntimeConfig = {
  execution: { mode: "worker", workerCount: 1 },
};
const { getSlidesEmptySnapshot } = moduleRequire(
  "@univerjs-pro/slides"
) as typeof SlidesModule;
const { getPdfsEmptySnapshot } = moduleRequire(
  "@univerjs-pro/pdfs"
) as typeof PdfsModule;
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
  /**
   * Hard-deletes a Unit that never became a file. Optional, because a store that keeps no Units
   * has nothing to delete.
   */
  deleteUnit?(input: { readonly unitId: string; readonly userId: string }): Promise<void>;
}

export interface UnitSnapshotStore {
  /** Trunk content at `revision`, or at the head when it is omitted. Reports the revision read. */
  materialize(input: {
    readonly unitId: string;
    readonly unitType: UnitType;
    readonly userId: string;
    readonly revision?: number;
  }): Promise<CollaborationServiceModule.ISnapshotWithBlocks & { readonly revision: number }>;
}

export interface CollaborationRuntime {
  readonly unitStore: UnitStore;
  readonly unitSnapshotStore: UnitSnapshotStore;
  /** Shared, lazily started materializer; disposed with the runtime. */
  readonly snapshotMaterializer: CollaborationServiceModule.IUnitSnapshotMaterializer;
  readonly service: CollaborationServiceModule.UniverCollabService;
  readonly commentService: CommentServiceModule.UniverCommentService;
  readonly historyService: HistoryServiceModule.UniverHistoryService;
  readonly worktreeService: WorktreeServiceModule.UniverCollabWorktreeService;
  dispose(): Promise<void>;
}

export function createCollaborationRuntime(
  database: CollaborationDatabase,
  options: {
    readonly commentUserProvider?: CommentServiceModule.ICommentUserProvider;
    readonly historyUserProvider?: HistoryServiceModule.IHistoryUserProvider;
    readonly license?: UniverLicenseCredentials;
  } = {}
): CollaborationRuntime {
  const { license, licenseKey } = options.license ?? BUNDLED_UNIVER_LICENSE;
  const service = new UniverCollabService({
    dbAdapter: database.core,
    enableUnitPermissionAnalysis: true,
    runtime: UNIT_RUNTIME,
    license,
    licenseKey,
  });
  const historyService = new UniverHistoryService({
    collabService: service,
    dbAdapter: database.history,
    ...(options.historyUserProvider
      ? { userProvider: options.historyUserProvider }
      : {}),
  });

  const commentService = new UniverCommentService({
    database: database.comment,
    ...(options.commentUserProvider
      ? { userProvider: options.commentUserProvider }
      : {}),
  });
  const worktreeService = new UniverCollabWorktreeService({
    enableUnitPermissionAnalysis: true,
    trunk: {
      service,
      dbAdapter: database.core,
    },
    dbAdapter: database.worktree,
    runtime: WORKTREE_UNIT_RUNTIME,
  });
  const unitStore: UnitStore = {
    async createUnit(input) {
      try {
        const options = collaborationCallOptions(input.userId);
        const unitData = createUnitData(input);
        const created = await service.createUnitFromData(unitData, options);
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
        throw unitStoreError(error);
      }
    },
    async deleteUnit(input) {
      try {
        await service.deleteUnits(
          { unitIDs: [input.unitId], hardDelete: true },
          collaborationCallOptions(input.userId)
        );
      } catch (error) {
        throw unitStoreError(error);
      }
    },
  };
  let materializer: CollaborationServiceModule.UnitSnapshotMaterializer | undefined;
  const snapshotMaterializer: CollaborationServiceModule.IUnitSnapshotMaterializer = {
    materializeSnapshot: (input) =>
      (materializer ??= new UnitSnapshotMaterializer(UNIT_RUNTIME)).materializeSnapshot(input),
    async dispose() {
      const current = materializer;
      materializer = undefined;
      await current?.dispose();
    },
  };
  const unitSnapshotStore: UnitSnapshotStore = {
    async materialize(input) {
      const loadData = await service.getUnitLoadDataWithBlocks(
        {
          unitID: input.unitId,
          type: univerType(input.unitType),
          revision: input.revision ?? 0,
        },
        {
          userID: input.userId,
          customData: { source: "workspace-exchange" },
        }
      );
      return {
        ...(await snapshotMaterializer.materializeSnapshot(loadData)),
        revision: loadData.targetRevision,
      };
    },
  };

  return {
    unitStore,
    unitSnapshotStore,
    snapshotMaterializer,
    service,
    commentService,
    historyService,
    worktreeService,
    async dispose() {
      await snapshotMaterializer.dispose();
      await worktreeService.dispose();
      await commentService.dispose();
      await historyService.dispose();
      await service.dispose();
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
    case "pdf":
      return UniverType.UNIVER_PDF;
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
    case "pdf": {
      const data = getPdfsEmptySnapshot(input.unitId, input.name);
      data.rev = 1;
      return { type: UniverType.UNIVER_PDF, data };
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

function unitStoreError(error: unknown): unknown {
  return error instanceof CollabError
    ? new UnitStoreError(error.code, error.message, error.retryable, { cause: error })
    : error;
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
