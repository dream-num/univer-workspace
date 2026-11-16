import type { CollaborationDatabase } from "./integrations/univer/collaboration-database/collaboration-database.js";
import { createSkillSourcesModule } from "./modules/skill-drafts/sources.service.js";
import { createSkillDraftsModule, createSkillDraftsRouter, type SkillDraftsModule } from "./modules/skill-drafts/index.js";
import { createHtmlViewDraftsModule, createHtmlViewDraftsRouter, type HtmlViewDraftsModule } from "./modules/html-view-drafts/index.js";
import { createClientMetadataDocumentResolver, type FetchClientMetadataDocument } from "./modules/identity/client-metadata-document.js";
import { createActivityModule, createActivityRouter } from "./modules/activity/index.js";
import { createStandaloneAppRouter } from "./modules/views/standalone-app.router.js";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { createContentPermissions } from "./integrations/univer/content-permissions.js";
import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import type { WorkspaceConfig } from "./config.js";
import type { ProductRepositories } from "./db/index.js";
import {
  createEmailSender,
  type EmailSender,
} from "./integrations/email/index.js";
import {
  createCollaborationRuntime,
  type CollaborationRuntime,
  type UnitSnapshotStore,
  type UnitStore,
} from "./integrations/univer/unit-store.js";
import { protocolUser } from "./integrations/univer/protocol-user.js";
import { createWorktreeBackend } from "./integrations/univer/worktree-store.js";
import type { BlobStore } from "./integrations/blob/blob-store.js";
import { createBlobStore } from "./integrations/blob/create-blob-store.js";
import {
  createCollaborationGateway,
  type CollaborationGateway,
} from "./integrations/univer/collaboration-gateway.js";
import { createSessionSockets } from "./integrations/realtime/session-sockets.js";
import { createWorktreeChangeFeed } from "./integrations/realtime/worktree-change-feed.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errors.js";
import {
  createMetricsHandler,
  createMetricsMiddleware,
} from "./middleware/metrics.js";
import { createRequestLoggingMiddleware } from "./middleware/logging.js";
import { createStaticSiteRouter } from "./middleware/static-site.js";
import {
  createAccessResolver,
  type AccessResolver,
} from "./modules/access/index.js";
import {
  createNodesModule,
  createNodesRouter,
  type NodesModule,
} from "./modules/nodes/index.js";
import {
  createResourcesModule,
  createResourcesRouter,
  type ResourcesModule,
} from "./modules/resources/index.js";
import {
  authorizationServerMetadata,
  createAccessTokenService,
  createIdentityModule,
  createIdentityRouter,
  createGitHubOAuthProvider,
  createDiscordOAuthProvider,
  createGoogleOAuthProvider,
  createMcpClientRegistrationHandler,
  createOAuthAuthorizationRouter,
  type DiscordOAuthProvider,
  type GoogleOAuthProvider,
  type GitHubOAuthProvider,
  type IssuedAuthorization,
  type IdentityModule,
} from "./modules/identity/index.js";
import {
  createPermissionsModule,
  createPermissionsRouter,
  type PermissionsModule,
} from "./modules/permissions/index.js";
import {
  createOperationsModule,
  createOperationsRouter,
  type OperationsModule,
} from "./modules/operations/index.js";
import {
  createSpacesModule,
  createSpacesRouter,
  type SpacesModule,
} from "./modules/spaces/index.js";
import {
  createViewsModule,
  createViewsRouter,
  type ViewsModule,
} from "./modules/views/index.js";
import {
  createIssuesModule,
  createIssuesRouter,
  type IssuesModule,
} from "./modules/issues/index.js";
import {
  createTrashModule,
  createTrashRouter,
  type TrashModule,
} from "./modules/trash/index.js";
import {
  createWorktreesModule,
  createWorktreesRouter,
  type WorktreeBackend,
  type WorktreesModule,
} from "./modules/worktrees/index.js";
import {
  createBlobsModule,
  createBlobsRouter,
  type BlobsModule,
} from "./modules/blobs/index.js";
import {
  createUniverAssetsModule,
  createUniverAssetsRouter,
  type UniverAssetsModule,
} from "./modules/univer-assets/index.js";
import {
  createExchangeModule,
  createExchangeRouter,
  type ExchangeModule,
} from "./modules/exchange/index.js";

export interface WorkspaceApplication {
  readonly app: express.Express;
  readonly identity: IdentityModule;
  readonly access: AccessResolver;
  readonly spaces: SpacesModule;
  readonly nodes: NodesModule;
  readonly resources: ResourcesModule;
  readonly views: ViewsModule;
  readonly permissions: PermissionsModule;
  readonly trash: TrashModule;
  readonly issues: IssuesModule;
  readonly worktrees: WorktreesModule;
  readonly operations: OperationsModule;
  readonly blobs: BlobsModule;
  readonly skillDrafts: SkillDraftsModule;
  readonly htmlViewDrafts: HtmlViewDraftsModule;
  readonly univerAssets: UniverAssetsModule;
  readonly exchange: ExchangeModule;
  initialize(): Promise<void>;
  attachWebSocket(server: Server): void;
  closeRealtime(): Promise<void>;
  close(): Promise<void>;
}

export function createWorkspaceApplication(
  config: WorkspaceConfig,
  repositories: ProductRepositories,
  collaborationDatabase: CollaborationDatabase,
  dependencies: {
    readonly unitStore?: UnitStore;
    readonly unitSnapshotStore?: UnitSnapshotStore;
    readonly worktreeBackend?: WorktreeBackend;
    /** An injected store remains owned by the caller. */
    readonly blobStore?: BlobStore;
    readonly githubOAuthProvider?: GitHubOAuthProvider;
    readonly googleOAuthProvider?: GoogleOAuthProvider;
    readonly discordOAuthProvider?: DiscordOAuthProvider;
    readonly emailSender?: EmailSender;
    readonly oauthStateSecret?: string;
    readonly fetchClientMetadataDocument?: FetchClientMetadataDocument;
  } = {},
): WorkspaceApplication {
  const oauthStateSecret =
    dependencies.oauthStateSecret ??
    config.githubOAuth?.clientSecret ??
    config.googleOAuth?.clientSecret ??
    config.discordOAuth?.clientSecret;
  const emailSender =
    dependencies.emailSender ??
    (config.emailAuth ? createEmailSender(config.emailAuth) : null);
  const identityRepository = repositories.identity;
  const sessionSockets = createSessionSockets(async (sessionId, userId) => {
    const session = await identityRepository.findSession(sessionId);
    return session?.id === userId && !session.banned && session.expiresAt > Date.now();
  });
  const onSessionsDeleted = sessionSockets.closeSessions;
  const accessTokens = createAccessTokenService({ repository: repositories.accessTokens, onSessionsDeleted });
  const identity = createIdentityModule({
    repository: identityRepository,
    onSessionsDeleted,
    sessionTtlMs: config.sessionTtlMs,
    githubOAuthProvider:
      dependencies.githubOAuthProvider ??
      (config.githubOAuth
        ? createGitHubOAuthProvider(config.githubOAuth)
        : null),
    googleOAuthProvider:
      dependencies.googleOAuthProvider ??
      (config.googleOAuth
        ? createGoogleOAuthProvider(config.googleOAuth)
        : null),
    discordOAuthProvider:
      dependencies.discordOAuthProvider ??
      (config.discordOAuth
        ? createDiscordOAuthProvider(config.discordOAuth)
        : null),
    ...(oauthStateSecret ? { oauthStateSecret } : {}),
    passwordAuthEnabled: config.passwordAuthEnabled,
    emailSender,
    emailAuthEnabled: emailSender !== null,
    trialDeployment: config.trialDeployment ?? false,
    ...(config.agentCreateLimitPerHour === undefined
      ? {}
      : { agentCreateLimitPerHour: config.agentCreateLimitPerHour }),
  });
  const resourcesRepository = repositories.resources;
  let collaboration: CollaborationRuntime | null = null;
  const unitStore =
    dependencies.unitStore ??
    (collaboration = createCollaborationRuntime(
      collaborationDatabase,
      {
        ...(config.univerLicense ? { license: config.univerLicense } : {}),
        commentUserProvider: {
          async getUsers(userIds) {
            return (await identity.findUsers(userIds)).map(protocolUser);
          },
        },
        historyUserProvider: {
          async getUsers(userIds) {
            return (await identity.findUsers(userIds)).map(protocolUser);
          },
        },
      }
    )).unitStore;
  const unitSnapshotStore =
    dependencies.unitSnapshotStore ??
    collaboration?.unitSnapshotStore ??
    unavailableUnitSnapshotStore();
  const access = createAccessResolver(repositories.access);
  const spaces = createSpacesModule({
    repository: repositories.spaces,
    pins: repositories.spacePins,
    access,
  });
  const nodes = createNodesModule({
    repository: repositories.nodes,
    access,
  });
  const resources = createResourcesModule({
    repository: resourcesRepository,
    access,
    unitStore,
  });
  const { blobStore: injectedBlobStore } = dependencies;
  const blobStore = injectedBlobStore ?? createBlobStore(config);
  const skillSources = createSkillSourcesModule({ access, nodes: repositories.nodes, store: blobStore, ...(config.githubToken ? { githubToken: config.githubToken } : {}) });
  const skillDrafts = createSkillDraftsModule({ repository: repositories.skillDrafts, access, store: blobStore, sources: skillSources });
  const htmlViewDrafts = createHtmlViewDraftsModule({ repository: repositories.htmlViewDrafts, access, store: blobStore });
  const blobs = createBlobsModule({
    repository: repositories.blobs,
    access,
    store: blobStore,
    ...(config.maxBlobBytes === undefined
      ? {}
      : { maxBlobBytes: config.maxBlobBytes }),
  });
  const views = createViewsModule({
    repository: repositories.views,
    access,
  });
  let invalidateRealtimeNodeAccess: () => void = () => undefined;
  const permissions = createPermissionsModule({
    repository: repositories.permissions,
    access,
    onLinkSharingUpdated: () => invalidateRealtimeNodeAccess(),
    onAccessRevoked: () => invalidateRealtimeNodeAccess(),
  });
  const trash = createTrashModule({
    repository: repositories.trash,
    access,
  });
  const univerAssetsRepository = repositories.univerAssets;
  const worktreeChangeFeed = createWorktreeChangeFeed(sessionSockets);
  const issues = createIssuesModule({
    repository: repositories.issues,
    access,
    onChanged: (change) => worktreeChangeFeed.publishIssues(change),
  });
  const worktrees = createWorktreesModule({
    trash,
    repository: repositories.worktrees,
    access,
    backend:
      dependencies.worktreeBackend ??
      (collaboration
        ? createWorktreeBackend(collaboration.worktreeService)
        : unavailableWorktreeBackend()),
    async publishMergedAssets(worktreeId, unitIds) {
      await univerAssetsRepository.publishWorktreeAssets(worktreeId, unitIds);
    },
    onChanged: (change) => worktreeChangeFeed.publish(change),
  });
  const activity = createActivityModule({ access, worktrees, issues });
  const univerAssets = createUniverAssetsModule({
    repository: univerAssetsRepository,
    access,
    worktrees,
    store: blobStore,
  });
  const operations = createOperationsModule({
    repository: repositories.operations,
    resources,
    worktrees,
  });
  const exchange = createExchangeModule({
    assets: univerAssets,
    access,
    resources,
    spaces,
    snapshots: unitSnapshotStore,
    store: blobStore,
    ...(config.univerLicense ? { license: config.univerLicense } : {}),
  });
  const collaborationGateway: CollaborationGateway | null = collaboration
    ? createCollaborationGateway({
        contentPermissions: createContentPermissions({
          repository: repositories.contentPermissions,
          access,
          identity,
          worktrees,
        }),
        service: collaboration.service,
        commentService: collaboration.commentService,
        historyService: collaboration.historyService,
        identity,
        access,
        worktreeService: collaboration.worktreeService,
        snapshotMaterializer: collaboration.snapshotMaterializer,
        worktrees,
        worktreeChangeFeed,
        sessionSockets,
      })
    : null;
  invalidateRealtimeNodeAccess = () =>
    collaborationGateway?.invalidateNodeAccess();
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy !== undefined) app.set("trust proxy", config.trustProxy);
  // Register HTTP observation before routes so it covers all requests.
  app.use(createMetricsMiddleware());
  // Attach the request-scoped logger for downstream error handling.
  app.use(createRequestLoggingMiddleware());
  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });
  // The operational endpoint is disabled unless a dedicated scrape token is set.
  app.get("/metrics", createMetricsHandler(config.metricsToken));
  const mcpOAuth = config.mcpOAuth;
  if (mcpOAuth) {
    app.get("/.well-known/oauth-authorization-server", (_request, response) => {
      response.json(authorizationServerMetadata(mcpOAuth));
    });
  }
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
  if (mcpOAuth) {
    app.post("/api/auth/register", createMcpClientRegistrationHandler({ accessTokens, mcpOAuth }));
  }
  // Draft JSON needs escaping headroom before the other routers apply their 1 MiB parser.
  app.use("/api", createSkillDraftsRouter({ identity, drafts: skillDrafts, sources: skillSources }));
  app.use("/api", createHtmlViewDraftsRouter({ identity, drafts: htmlViewDrafts }));
  app.use(
    "/api",
    createIdentityRouter({
      identity,
      accessTokens,
      mcpOAuth: mcpOAuth ?? null,
      secureCookies: config.secureCookies,
      ...(config.discordBotApiKey
        ? { discordBotApiKey: config.discordBotApiKey }
        : {}),
    })
  );
  const oauthClients = config.oauthClients;
  const authorizationStore = new Map<string, IssuedAuthorization>();
  app.use(
    "/api/auth",
    createOAuthAuthorizationRouter({
      identity,
      accessTokens,
      secureCookies: config.secureCookies,
      oauthClients,
      authorizationStore,
      mcpOAuth: mcpOAuth ?? null,
      resolveClientMetadata: createClientMetadataDocumentResolver({
        ...(dependencies.fetchClientMetadataDocument === undefined ? {} : { fetchDocument: dependencies.fetchClientMetadataDocument }),
        ...(mcpOAuth?.cimdExemptNetworks === undefined ? {} : { exemptions: mcpOAuth.cimdExemptNetworks }),
      }),
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
  app.use("/api", createIssuesRouter({ identity, issues }));
  app.use("/api", createActivityRouter({ identity, activity }));
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
  app.use(createStandaloneAppRouter({ identity, access, blobs }));
  app.use("/api", notFoundHandler);

  const publicDirectory = resolve("dist/public");
  if (existsSync(publicDirectory)) {
    app.use(createStaticSiteRouter(publicDirectory, { nodes, identity, publicOrigin: config.publicOrigin }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  let initialization: Promise<void> | undefined;
  return {
    app,
    identity,
    access,
    spaces,
    nodes,
    resources,
    views,
    permissions,
    trash,
    issues,
    worktrees,
    operations,
    blobs,
    htmlViewDrafts,
    skillDrafts,
    univerAssets,
    exchange,
    initialize() {
      initialization ??= (async () => {
        await identity.initialize();
        await blobs.initialize();
        await univerAssets.initialize();
      })();
      return initialization;
    },
    attachWebSocket(server) {
      collaborationGateway?.attachWebSocket(server);
    },
    async closeRealtime() {
      try {
        await collaborationGateway?.dispose();
      } finally {
        await worktreeChangeFeed.dispose();
      }
    },
    async close() {
      try {
        try {
          await collaborationGateway?.dispose();
        } finally {
          await worktreeChangeFeed.dispose();
        }
      } finally {
        try {
          await exchange.dispose();
        } finally {
          try {
            await collaboration?.dispose();
          } finally {
            if (!injectedBlobStore) await blobStore.dispose?.();
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
    setUnitRemoved: unavailable,
    reopen: unavailable,
    merge: unavailable,
    discard: unavailable,
    submitChangeset: unavailable,
  };
}
