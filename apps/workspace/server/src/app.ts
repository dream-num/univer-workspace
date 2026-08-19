import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import type { WorkspaceConfig } from "./config.js";
import type { WorkspaceDatabase } from "./db/database.js";
import { openWorkspaceDatabase } from "./db/initialize.js";
import {
  createCollaborationRuntime,
  type CollaborationRuntime,
  type UnitSnapshotStore,
  type UnitStore,
} from "./integrations/univer/unit-store.js";
import { createWorktreeBackend } from "./integrations/univer/worktree-store.js";
import { LocalBlobStore, type BlobStore } from "./integrations/blob/blob-store.js";
import {
  createCollaborationGateway,
  type CollaborationGateway,
} from "./integrations/univer/collaboration-gateway.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errors.js";
import {
  AccessRepository,
  createAccessResolver,
  type AccessResolver,
} from "./modules/access/index.js";
import {
  NodesRepository,
  createNodesModule,
  createNodesRouter,
  type NodesModule,
} from "./modules/nodes/index.js";
import {
  createResourcesModule,
  createResourcesRouter,
  ResourcesRepository,
  type ResourcesModule,
} from "./modules/resources/index.js";
import {
  createIdentityModule,
  createIdentityRouter,
  createGitHubOAuthProvider,
  createDiscordOAuthProvider,
  type DiscordOAuthProvider,
  type GitHubOAuthProvider,
  IdentityRepository,
  type IdentityModule,
} from "./modules/identity/index.js";
import {
  createPermissionsModule,
  createPermissionsRouter,
  PermissionsRepository,
  type PermissionsModule,
} from "./modules/permissions/index.js";
import {
  createOperationsModule,
  createOperationsRouter,
  OperationsRepository,
  type OperationsModule,
} from "./modules/operations/index.js";
import {
  createSpacesModule,
  createSpacesRouter,
  SpacesRepository,
  type SpacesModule,
} from "./modules/spaces/index.js";
import {
  createViewsModule,
  createViewsRouter,
  ViewsRepository,
  type ViewsModule,
} from "./modules/views/index.js";
import {
  createTrashModule,
  createTrashRouter,
  TrashRepository,
  type TrashModule,
} from "./modules/trash/index.js";
import {
  createWorktreesModule,
  createWorktreesRouter,
  WorktreesRepository,
  type WorktreeBackend,
  type WorktreesModule,
} from "./modules/worktrees/index.js";
import {
  BlobsRepository,
  createBlobsModule,
  createBlobsRouter,
  type BlobsModule,
} from "./modules/blobs/index.js";
import {
  createUniverAssetsModule,
  createUniverAssetsRouter,
  UniverAssetsRepository,
  type UniverAssetsModule,
} from "./modules/univer-assets/index.js";
import {
  createExchangeModule,
  createExchangeRouter,
  type ExchangeModule,
} from "./modules/exchange/index.js";

export interface WorkspaceApplication {
  readonly app: express.Express;
  readonly database: WorkspaceDatabase;
  readonly identity: IdentityModule;
  readonly access: AccessResolver;
  readonly spaces: SpacesModule;
  readonly nodes: NodesModule;
  readonly resources: ResourcesModule;
  readonly views: ViewsModule;
  readonly permissions: PermissionsModule;
  readonly trash: TrashModule;
  readonly worktrees: WorktreesModule;
  readonly operations: OperationsModule;
  readonly blobs: BlobsModule;
  readonly univerAssets: UniverAssetsModule;
  readonly exchange: ExchangeModule;
  attachWebSocket(server: Server): void;
  closeRealtime(): Promise<void>;
  close(): Promise<void>;
}

export function createWorkspaceApplication(
  config: WorkspaceConfig,
  dependencies: {
    readonly unitStore?: UnitStore;
    readonly unitSnapshotStore?: UnitSnapshotStore;
    readonly worktreeBackend?: WorktreeBackend;
    readonly blobStore?: BlobStore;
    readonly githubOAuthProvider?: GitHubOAuthProvider;
    readonly discordOAuthProvider?: DiscordOAuthProvider;
    readonly oauthStateSecret?: string;
  } = {}
): WorkspaceApplication {
  const database = openWorkspaceDatabase(config.databaseFilename);
  let collaboration: CollaborationRuntime | null = null;
  const unitStore =
    dependencies.unitStore ??
    (collaboration = createCollaborationRuntime(
      config.collaborationDatabaseFilename
    )).unitStore;
  const unitSnapshotStore =
    dependencies.unitSnapshotStore ??
    collaboration?.unitSnapshotStore ??
    unavailableUnitSnapshotStore();
  const oauthStateSecret =
    dependencies.oauthStateSecret ??
    config.githubOAuth?.clientSecret ??
    config.discordOAuth?.clientSecret;
  const identity = createIdentityModule({
    repository: new IdentityRepository(database),
    sessionTtlMs: config.sessionTtlMs,
    githubOAuthProvider:
      dependencies.githubOAuthProvider ??
      (config.githubOAuth
        ? createGitHubOAuthProvider(config.githubOAuth)
        : null),
    discordOAuthProvider:
      dependencies.discordOAuthProvider ??
      (config.discordOAuth
        ? createDiscordOAuthProvider(config.discordOAuth)
        : null),
    ...(oauthStateSecret ? { oauthStateSecret } : {}),
  });
  const access = createAccessResolver(new AccessRepository(database));
  const spaces = createSpacesModule({
    repository: new SpacesRepository(database),
    access,
  });
  const nodes = createNodesModule({
    repository: new NodesRepository(database),
    access,
  });
  const resources = createResourcesModule({
    repository: new ResourcesRepository(database),
    access,
    unitStore,
  });
  const blobStore =
    dependencies.blobStore ??
    new LocalBlobStore(
      config.blobDirectory ?? resolve(".data/univer-workspace-blobs")
    );
  const blobs = createBlobsModule({
    repository: new BlobsRepository(database),
    access,
    store: blobStore,
    ...(config.maxBlobBytes === undefined
      ? {}
      : { maxBlobBytes: config.maxBlobBytes }),
  });
  const views = createViewsModule({
    repository: new ViewsRepository(database),
    access,
  });
  let invalidateRealtimeNodeAccess: () => void = () => undefined;
  const permissions = createPermissionsModule({
    repository: new PermissionsRepository(database),
    access,
    onLinkSharingUpdated: () => invalidateRealtimeNodeAccess(),
  });
  const trash = createTrashModule({
    repository: new TrashRepository(database),
    access,
  });
  const univerAssetsRepository = new UniverAssetsRepository(database);
  const worktrees = createWorktreesModule({
    repository: new WorktreesRepository(database),
    access,
    backend:
      dependencies.worktreeBackend ??
      (collaboration
        ? createWorktreeBackend(collaboration.worktreeService)
        : unavailableWorktreeBackend()),
    publishMergedAssets: (worktreeId, unitIds) =>
      univerAssetsRepository.publishWorktreeAssets(worktreeId, unitIds),
  });
  const univerAssets = createUniverAssetsModule({
    repository: univerAssetsRepository,
    access,
    worktrees,
    store: blobStore,
  });
  const operations = createOperationsModule({
    repository: new OperationsRepository(database),
    resources,
    worktrees,
  });
  const exchange = createExchangeModule({
    access,
    resources,
    spaces,
    snapshots: unitSnapshotStore,
    store: blobStore,
  });
  const collaborationGateway: CollaborationGateway | null = collaboration
    ? createCollaborationGateway({
        service: collaboration.service,
        identity,
        access,
        worktreeService: collaboration.worktreeService,
        worktrees,
      })
    : null;
  invalidateRealtimeNodeAccess = () =>
    collaborationGateway?.invalidateNodeAccess();
  const app = express();

  app.disable("x-powered-by");
  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.get("/openapi.yaml", (_request, response) => {
    const filename = resolve("generated/http/openapi.bundled.yaml");
    if (!existsSync(filename)) {
      response
        .status(503)
        .type("text/plain")
        .send("OpenAPI bundle is unavailable. Run `pnpm api:bundle`.");
      return;
    }
    response.type("application/yaml").sendFile(filename);
  });
  app.use(
    "/api-docs",
    apiReference({
      url: "/openapi.yaml",
      theme: "default",
      pageTitle: "Univer Workspace API",
    })
  );
  app.use(
    "/api",
    createIdentityRouter({
      identity,
      secureCookies: config.secureCookies,
      ...(config.discordBotApiKey
        ? { discordBotApiKey: config.discordBotApiKey }
        : {}),
    })
  );
  app.use("/api", createSpacesRouter({ identity, spaces }));
  app.use("/api", createNodesRouter({ identity, nodes }));
  app.use("/api", createResourcesRouter({ identity, resources }));
  app.use("/api", createBlobsRouter({ identity, blobs }));
  app.use("/api", createViewsRouter({ identity, views }));
  app.use(
    "/api",
    createPermissionsRouter({ identity, permissions })
  );
  app.use("/api", createTrashRouter({ identity, trash }));
  app.use(
    "/api",
    createOperationsRouter({ identity, operations })
  );
  app.use(
    "/api",
    createWorktreesRouter({ identity, worktrees })
  );
  app.use(
    "/universer-api",
    createExchangeRouter({ identity, exchange })
  );
  app.use(
    "/universer-api",
    createUniverAssetsRouter({ identity, assets: univerAssets })
  );
  if (collaborationGateway) {
    app.use("/universer-api", collaborationGateway.router);
  }
  app.use("/api", notFoundHandler);

  const publicDirectory = resolve("dist/public");
  if (existsSync(publicDirectory)) {
    app.use(express.static(publicDirectory));
    app.get("/{*path}", (_request, response) => {
      response.sendFile(resolve(publicDirectory, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    database,
    identity,
    access,
    spaces,
    nodes,
    resources,
    views,
    permissions,
    trash,
    worktrees,
    operations,
    blobs,
    univerAssets,
    exchange,
    attachWebSocket(server) {
      collaborationGateway?.attachWebSocket(server);
    },
    async closeRealtime() {
      await collaborationGateway?.dispose();
    },
    async close() {
      try {
        await collaborationGateway?.dispose();
      } finally {
        try {
          await exchange.dispose();
        } finally {
          try {
            await collaboration?.dispose();
          } finally {
            database.close();
          }
        }
      }
    },
  };
}

function unavailableUnitSnapshotStore(): UnitSnapshotStore {
  return {
    async materialize() {
      throw new Error(
        "A Collaboration snapshot store is required for Unit export."
      );
    },
  };
}

function unavailableWorktreeBackend(): WorktreeBackend {
  const unavailable = async (): Promise<never> => {
    throw new Error(
      "A Worktree backend is required for this application instance."
    );
  };
  return {
    createWorktree: unavailable,
    getWorktree: unavailable,
    addUnit: unavailable,
    createUnit: unavailable,
    markReady: unavailable,
    reopen: unavailable,
    merge: unavailable,
    discard: unavailable,
    submitChangeset: unavailable,
  };
}
