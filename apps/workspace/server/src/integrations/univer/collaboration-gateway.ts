import type { Server } from "node:http";
import {
  MemorySessionTicketStore,
  UniverCollabEndpoint,
} from "@univerjs-pro/collaboration-endpoint";
import {
  CollabError,
  type UniverCollabService,
} from "@univerjs-pro/collaboration-service";
import {
  createNodeTransport,
  type NodeHttpTransportContext,
  type NodeTransportConnection,
  type NodeTransportEndpoint,
  type NodeWebSocketHandler,
} from "@univerjs-pro/collaboration-transport-node";
import {
  ErrorCode,
  UnitAction,
  UniverType,
  type IUser,
} from "@univerjs/protocol";
import { UniverCollabWorktreeEndpoint } from "@univerjs-pro/collaboration-worktree-endpoint";
import type { UniverCollabWorktreeService } from "@univerjs-pro/collaboration-worktree-service";
import type {
  ApplyWorktreeChangesetMiddlewareContext,
  BaseWorktreeMiddlewareContext,
  CommitWorktreeChangesetMiddlewareContext,
  SubmitWorktreeChangesetMiddlewareContext,
  WorktreeMiddlewareNext,
} from "@univerjs-pro/collaboration-worktree-service";
import { json, Router, type RequestHandler } from "express";
import type { AccessResolver, ResourceAccess, UnitType } from "../../modules/access/index.js";
import type { IdentityModule } from "../../modules/identity/index.js";
import type { WorktreesModule } from "../../modules/worktrees/index.js";
import {
  WORKTREE_CHANGE_FEED_PATH,
  type WorktreeChangeFeed,
} from "../realtime/worktree-change-feed.js";

const OK_ERROR = { code: ErrorCode.OK, message: "" };

export interface CollaborationGateway {
  readonly router: Router;
  attachWebSocket(server: Server): void;
  invalidateNodeAccess(): void;
  dispose(): Promise<void>;
}

export function createCollaborationGateway(options: {
  readonly service: UniverCollabService;
  readonly identity: IdentityModule;
  readonly access: AccessResolver;
  readonly worktreeService: UniverCollabWorktreeService;
  readonly worktrees: WorktreesModule;
  readonly worktreeChangeFeed: WorktreeChangeFeed;
}): CollaborationGateway {
  const {
    service,
    identity,
    access,
    worktreeService,
    worktrees,
    worktreeChangeFeed,
  } = options;
  const ticketStore = new MemorySessionTicketStore();
  const endpoint = new UniverCollabEndpoint(service, { ticketStore });
  const worktreeEndpoint = new UniverCollabWorktreeEndpoint(
    worktreeService,
    { ticketStore }
  );
  const transport = createNodeTransport();
  const nodeAccessConnections = new Set<NodeTransportConnection>();

  service.use("createUnit", async (context, next) => {
    if (context.customData.source !== "product-api") {
      throw new CollabError(
        "PERMISSION_DENIED",
        "Units must be created through the product API."
      );
    }
    await next();
  });
  service.use("readUnitData", async (context, next) => {
    if (context.customData.source === "product-api") {
      await next();
      return;
    }
    requireUnitAccess(access, context.userID, context.request.unitID);
    await next();
  });
  service.use("submitChangeset", async (context, next) => {
    requireUnitEdit(
      access,
      context.userID,
      context.request.changeset.unitID
    );
    await next();
  });
  service.use("applyChangeset", async (context, next) => {
    requireUnitEdit(
      access,
      context.userID,
      context.request.changeset.unitID
    );
    await next();
  });

  endpoint.use("connect", async (context, next) => {
    const user = context.session.customData.user as
      | ReturnType<typeof protocolUser>
      | undefined;
    context.member.name = user?.name ?? context.session.userID;
    await next();
  });
  endpoint.use("joinUnit", async (context, next) => {
    const resource = requireUnitAccess(
      access,
      context.session.userID,
      context.unitID
    );
    if (resource.kind !== "univer") {
      throw new CollabError("INVALID_REQUEST", "Unknown Unit Resource.");
    }
    await service.getUnitLoadData(
      {
        unitID: context.unitID,
        type: protocolUnitType(resource.unitType),
        revision: 0,
      },
      {
        userID: context.session.userID,
        customData: context.session.customData,
      }
    );
    await next();
  });

  for (const action of [
    "createWorktree",
    "addWorktreeUnit",
    "createWorktreeUnit",
    "markWorktreeReady",
    "reopenWorktree",
    "discardWorktree",
    "mergeWorktree",
  ] as const) {
    worktreeService.use(action, requireProductWorktreeManagement);
  }
  worktreeService.use("readWorktreeData", async (context, next) => {
    if (context.customData.source === "product-api") {
      await next();
      return;
    }
    await requireWorktreeProtocolAccess(worktrees, {
      userId: context.userID,
      worktreeId: context.request.worktreeID,
      write: false,
    });
    await next();
  });
  worktreeService.use("readUnitData", async (context, next) => {
    if (context.customData.source === "product-api") {
      await next();
      return;
    }
    await requireWorktreeProtocolAccess(worktrees, {
      userId: context.userID,
      worktreeId: context.request.worktreeID,
      unitId: context.request.unitID,
      write: false,
    });
    await next();
  });
  for (const action of [
    "submitChangeset",
    "applyChangeset",
    "commitChangeset",
  ] as const) {
    worktreeService.use(action, asyncWorktreeWriteAuthorization);
  }

  async function asyncWorktreeWriteAuthorization(
    context:
      | SubmitWorktreeChangesetMiddlewareContext
      | ApplyWorktreeChangesetMiddlewareContext
      | CommitWorktreeChangesetMiddlewareContext,
    next: WorktreeMiddlewareNext
  ) {
    await requireWorktreeProtocolAccess(worktrees, {
      userId: context.userID,
      worktreeId: context.request.worktreeID,
      unitId: context.request.changeset.unitID,
      write: true,
    });
    await next();
  }
  worktreeEndpoint.use("connect", async (context, next) => {
    await requireWorktreeProtocolAccess(worktrees, {
      userId: context.session.userID,
      worktreeId: context.worktreeID,
      write: false,
    });
    const user = context.session.customData.user as
      | ReturnType<typeof protocolUser>
      | undefined;
    context.member.name = user?.name ?? context.session.userID;
    await next();
  });
  worktreeEndpoint.use("joinUnit", async (context, next) => {
    await requireWorktreeProtocolAccess(worktrees, {
      userId: context.session.userID,
      worktreeId: context.worktreeID,
      unitId: context.unitID,
      write: false,
    });
    await next();
  });

  transport.use(async (context, next) => {
    const session = identity.getSession(cookieHeader(context));
    if (!session.authenticated) {
      unauthenticated(context);
      return;
    }
    context.userID = session.user.id;
    context.customData.user = protocolUser(session.user);
    await next();
  });
  transport.register(worktreeEndpoint);
  transport.register(worktreeChangeFeed.endpoint(ticketStore));
  transport.register(trackConnections(endpoint, nodeAccessConnections));

  const router = Router();
  router.use((request, response, next) => {
    try {
      response.locals.session = identity.requireSession(request.headers.cookie);
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get("/user", (_request, response) => {
    response.json({
      error: OK_ERROR,
      user: protocolUser(response.locals.session.user),
    });
  });
  router.post(
    "/authz/-/object/-/batch_allowed",
    json({ limit: "1mb" }),
    (request, response) => {
      const requests = request.body?.requests as unknown;
      if (!Array.isArray(requests)) {
        throw new CollabError("INVALID_REQUEST", "requests must be an array");
      }
      const userId = response.locals.session.user.id as string;
      response.json({
        error: OK_ERROR,
        objectActions: requests.map((value: unknown) =>
          allowedObjectActions(value, userId, access)
        ),
      });
    }
  );
  router.use(((request, response) => {
    request.url = request.originalUrl;
    transport.handleRequest(request, response);
  }) satisfies RequestHandler);

  let attachedServer: Server | undefined;
  let disposed = false;
  const handleUpgrade: NonNullable<Parameters<Server["on"]>[1]> = (
    request,
    socket,
    head
  ) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (
      url.pathname !== "/universer-api/comb/connect" &&
      !url.pathname.startsWith("/universer-api/worktrees/") &&
      url.pathname !== WORKTREE_CHANGE_FEED_PATH
    ) {
      return;
    }
    transport.handleUpgrade(request, socket, head);
  };

  return {
    router,
    attachWebSocket(server) {
      if (attachedServer) {
        throw new Error("Collaboration WebSocket is already attached.");
      }
      attachedServer = server;
      server.on("upgrade", handleUpgrade);
    },
    invalidateNodeAccess() {
      for (const connection of nodeAccessConnections) {
        connection.close(1008, "Node access policy changed");
      }
      nodeAccessConnections.clear();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      attachedServer?.off("upgrade", handleUpgrade);
      attachedServer = undefined;
      await transport.dispose();
    },
  };
}

function trackConnections(
  endpoint: NodeTransportEndpoint,
  connections: Set<NodeTransportConnection>
): NodeTransportEndpoint {
  return {
    async handleHttp(context, next) {
      if (endpoint.handleHttp) {
        await endpoint.handleHttp(context, next);
        return;
      }
      await next();
    },
    async handleUpgrade(context, next) {
      if (!endpoint.handleUpgrade) {
        await next();
        return;
      }
      await endpoint.handleUpgrade(
        {
          incomingMessage: context.incomingMessage,
          customData: context.customData,
          reject: context.reject.bind(context),
          accept(handler) {
            context.accept(trackConnectionLifecycle(handler, connections));
          },
        },
        next
      );
    },
    async dispose() {
      await endpoint.dispose?.();
    },
  };
}

function trackConnectionLifecycle(
  handler: NodeWebSocketHandler,
  connections: Set<NodeTransportConnection>
): NodeWebSocketHandler {
  return {
    async open(context) {
      connections.add(context.connection);
      await handler.open?.(context);
    },
    async message(context) {
      await handler.message?.(context);
    },
    async close(context) {
      connections.delete(context.connection);
      await handler.close?.(context);
    },
  };
}

async function requireProductWorktreeManagement(
  context: BaseWorktreeMiddlewareContext,
  next: WorktreeMiddlewareNext
): Promise<void> {
  if (context.customData.source !== "product-api") {
    throw new CollabError(
      "PERMISSION_DENIED",
      "Worktrees must be managed through the product API."
    );
  }
  await next();
}

async function requireWorktreeProtocolAccess(
  worktrees: WorktreesModule,
  input: {
    readonly userId: string;
    readonly worktreeId: string;
    readonly unitId?: string;
    readonly write: boolean;
  }
): Promise<void> {
  if (!(await worktrees.authorizeProtocol(input))) {
    throw new CollabError(
      "PERMISSION_DENIED",
      "Cannot access this Worktree Unit."
    );
  }
}

function allowedObjectActions(
  value: unknown,
  userId: string,
  access: AccessResolver
) {
  const candidate = value as {
    readonly unitID?: unknown;
    readonly objectID?: unknown;
    readonly actions?: unknown;
  };
  const unitId =
    typeof candidate.unitID === "string" ? candidate.unitID : "";
  const resource = access.resolveUnit(userId, unitId);
  return {
    unitID: unitId,
    objectID:
      typeof candidate.objectID === "string" ? candidate.objectID : "",
    actions: Array.isArray(candidate.actions)
      ? candidate.actions.map((action) => ({
          action,
          allowed: isActionAllowed(resource, action),
        }))
      : [],
  };
}

function isActionAllowed(
  resource: ResourceAccess | null,
  action: unknown
): boolean {
  if (!resource || typeof action !== "number") return false;
  if (action === UnitAction.Share) return false;
  if (resource.node.role === "owner" || resource.node.role === "admin") return true;
  if (resource.capabilities.editContent) {
    return ![
      UnitAction.ManageCollaborator,
      UnitAction.Delete,
    ].includes(action);
  }
  return [
    UnitAction.View,
    UnitAction.Print,
    UnitAction.Copy,
    UnitAction.Export,
    UnitAction.IHistory,
    UnitAction.ViemRwHgtClWdt,
    UnitAction.ViewFilter,
    UnitAction.SelectProtectedCells,
    UnitAction.SelectUnProtectedCells,
    UnitAction.ViewHistory,
  ].includes(action);
}

function requireUnitAccess(
  access: AccessResolver,
  userId: string,
  unitId: string
): ResourceAccess {
  const resource = access.resolveUnit(userId, unitId);
  if (!resource?.capabilities.openContent) {
    throw new CollabError("PERMISSION_DENIED", "Cannot read this unit.");
  }
  return resource;
}

function requireUnitEdit(
  access: AccessResolver,
  userId: string,
  unitId: string
): ResourceAccess {
  const resource = requireUnitAccess(access, userId, unitId);
  if (!resource.capabilities.editContent) {
    throw new CollabError("PERMISSION_DENIED", "Unit is read-only.");
  }
  return resource;
}

function protocolUnitType(unitType: UnitType | null): UniverType {
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
    default:
      throw new CollabError("INVALID_REQUEST", "Unknown unit type.");
  }
}

function protocolUser(user: {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}): IUser {
  return {
    userID: user.id,
    name: user.displayName,
    avatar: user.avatarUrl ?? "",
    anonymous: false,
    canBindAnonymous: false,
    phone: "",
    email: "",
    createTimestamp: 0,
  };
}

function cookieHeader(context: NodeHttpTransportContext) {
  const value = context.incomingMessage.headers.cookie;
  return Array.isArray(value) ? value.join("; ") : value;
}

function unauthenticated(context: NodeHttpTransportContext): void {
  context.response.statusCode = 401;
  context.response.setHeader(
    "content-type",
    "application/json; charset=utf-8"
  );
  context.response.end(
    JSON.stringify({
      error: {
        code: ErrorCode.UNAUTHENTICATED,
        message: "Authentication required.",
      },
    })
  );
}
