/**
 * Control Plane REST Gateway Router.
 * Implements the full OpenAPI specification for Workspace Users, Sessions, Spaces, Nodes, Resources, and Trash.
 */
import { ControlPlaneDb } from "./db.ts";
import {
  generateSessionToken,
  hashPassword,
  parseCookie,
  serializeClearSessionCookie,
  serializeSessionCookie,
  verifyPassword
} from "./auth.ts";
import type { NodeItem, Space, SpaceRole, User } from "./types.ts";

export interface GatewayContext {
  db: ControlPlaneDb;
  currentUser: User | null;
  rawSessionToken: string | null;
}

function jsonResponse(data: unknown, status: number = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function formatUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url
  };
}

function formatSpaceView(space: Space, role: SpaceRole = "admin") {
  return {
    id: space.id,
    type: space.type,
    name: space.name,
    publicRead: space.public_read === 1,
    accessRole: role,
    capabilities: {
      browseRoot: true,
      createAtRoot: true,
      renameSpace: true,
      manageMembers: true,
      viewTrash: true
    }
  };
}

function formatNodeSummary(node: NodeItem, resource?: any) {
  return {
    id: node.id,
    spaceId: node.space_id,
    parentNodeId: node.parent_id,
    name: node.name,
    resource: resource
      ? {
          id: resource.id,
          kind: resource.kind,
          ...(resource.kind === "univer"
            ? {
                unitId: resource.univer?.unit_id ?? resource.unit_id,
                unitType: resource.univer?.unit_type ?? resource.unit_type
              }
            : {
                originalFilename: resource.blob?.original_filename,
                mediaType: resource.blob?.media_type,
                byteSize: resource.blob?.byte_size
              }),
          capabilities: {
            openContent: true,
            editContent: true,
            downloadContent: true
          }
        }
      : null,
    hasChildren: false,
    updatedAt: new Date(node.updated_at).toISOString(),
    accessRole: "admin",
    capabilities: {
      rename: true,
      move: true,
      trash: true,
      manageGrants: true,
      manageLinkSharing: true
    }
  };
}

export async function resolveGatewayContext(request: Request, db: ControlPlaneDb): Promise<GatewayContext> {
  const cookieHeader = request.headers.get("Cookie");
  const authHeader = request.headers.get("Authorization");

  const rawSessionToken =
    parseCookie(cookieHeader, "workspace_session") ||
    parseCookie(cookieHeader, "dsh_session") ||
    (authHeader && authHeader.startsWith("Bearer ") ? authHeader.replace(/^Bearer\s+/i, "").trim() : null);

  if (!rawSessionToken) {
    return { db, currentUser: null, rawSessionToken: null };
  }

  const sessionData = await db.getSessionByToken(rawSessionToken);
  return {
    db,
    currentUser: sessionData?.user ?? null,
    rawSessionToken
  };
}

export async function handleControlPlaneRoutes(
  request: Request,
  gwCtx: GatewayContext,
  url: URL
): Promise<Response | null> {
  const { db, currentUser } = gwCtx;
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // ==========================================
  // Session & Authentication
  // ==========================================

  if (path === "/api/session" && method === "GET") {
    if (!currentUser) {
      return jsonResponse({
        authenticated: false,
        githubOAuthEnabled: false,
        discordOAuthEnabled: false
      });
    }

    return jsonResponse({
      authenticated: true,
      githubOAuthEnabled: false,
      discordOAuthEnabled: false,
      user: formatUser(currentUser),
      authenticationMethods: {
        password: true,
        externalIdentities: []
      }
    });
  }

  if (path === "/api/auth/password/register" && method === "POST") {
    try {
      const body = (await request.json()) as any;
      const { username, displayName, password } = body;
      if (!username || !displayName || !password) {
        return jsonResponse({ error: { message: "username, displayName, and password are required" } }, 400);
      }

      const existing = await db.getUserByUsername(username);
      if (existing) {
        return jsonResponse({ error: { message: "Username already taken" } }, 409);
      }

      const passwordHash = await hashPassword(password);
      const user = await db.createUser({ username, displayName, passwordHash });
      const token = generateSessionToken();
      const session = await db.createSession(user.id, token);

      return jsonResponse(
        {
          user: formatUser(user),
          session: { id: session.id, expiresAt: new Date(session.expires_at).toISOString() }
        },
        200,
        { "Set-Cookie": serializeSessionCookie(token) }
      );
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 500);
    }
  }

  if (path === "/api/auth/password/login" && method === "POST") {
    try {
      const body = (await request.json()) as any;
      const { username, password } = body;
      if (!username || !password) {
        return jsonResponse({ error: { message: "username and password are required" } }, 400);
      }

      const user = await db.getUserByUsername(username);
      if (!user) {
        return jsonResponse({ error: { message: "Invalid credentials" } }, 401);
      }

      const storedHash = await db.getPasswordHash(user.id);
      if (!storedHash) {
        return jsonResponse({ error: { message: "Password authentication not configured" } }, 401);
      }

      const isValid = await verifyPassword(password, storedHash);
      if (!isValid) {
        return jsonResponse({ error: { message: "Invalid credentials" } }, 401);
      }

      const token = generateSessionToken();
      const session = await db.createSession(user.id, token);

      return jsonResponse(
        {
          user: formatUser(user),
          session: { id: session.id, expiresAt: new Date(session.expires_at).toISOString() }
        },
        200,
        { "Set-Cookie": serializeSessionCookie(token) }
      );
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 500);
    }
  }

  if (path === "/api/auth/logout" && method === "POST") {
    if (gwCtx.rawSessionToken) {
      await db.deleteSession(gwCtx.rawSessionToken);
    }
    return jsonResponse({ success: true }, 200, {
      "Set-Cookie": serializeClearSessionCookie()
    });
  }

  // Require authentication for all subsequent endpoints
  if (!currentUser) {
    if (path.startsWith("/api/")) {
      return jsonResponse({ error: { message: "Authentication required" } }, 401);
    }
    return null;
  }

  // ==========================================
  // Users
  // ==========================================

  if (path === "/api/users/me" && method === "PATCH") {
    const body = (await request.json()) as any;
    const updated = await db.updateUser(currentUser.id, {
      displayName: body.displayName,
      avatarUrl: body.avatarUrl
    });
    return jsonResponse({ user: updated ? formatUser(updated) : formatUser(currentUser) });
  }

  if (path === "/api/users/search" && method === "GET") {
    const q = url.searchParams.get("query") || url.searchParams.get("q") || "";
    const users = await db.searchUsers(q);
    return jsonResponse({ users: users.map(formatUser) });
  }

  // ==========================================
  // Spaces
  // ==========================================

  if (path === "/api/spaces" && method === "GET") {
    const spaces = await db.listUserSpaces(currentUser.id);
    return jsonResponse({
      spaces: spaces.map((s) => formatSpaceView(s, "admin"))
    });
  }

  if (path === "/api/team-spaces" && method === "POST") {
    const body = (await request.json()) as any;
    if (!body.name) {
      return jsonResponse({ error: { message: "name is required" } }, 400);
    }
    const space = await db.createSpace({
      type: "team",
      name: body.name,
      ownerUserId: currentUser.id,
      publicRead: body.publicRead ? 1 : 0
    });
    return jsonResponse(formatSpaceView(space, "admin"));
  }

  // /api/spaces/:spaceId
  const spaceMatch = path.match(/^\/api\/spaces\/([^/]+)$/);
  if (spaceMatch) {
    const spaceId = spaceMatch[1];
    if (method === "GET") {
      const space = await db.getSpaceById(spaceId);
      if (!space) return jsonResponse({ error: { message: "Space not found" } }, 404);
      return jsonResponse(formatSpaceView(space, "admin"));
    }
    if (method === "PATCH") {
      const body = (await request.json()) as any;
      const updated = await db.updateSpace(spaceId, {
        name: body.name,
        publicRead: body.publicRead !== undefined ? (body.publicRead ? 1 : 0) : undefined
      });
      if (!updated) return jsonResponse({ error: { message: "Space not found" } }, 404);
      return jsonResponse(formatSpaceView(updated, "admin"));
    }
  }

  // /api/spaces/:spaceId/nodes
  const spaceNodesMatch = path.match(/^\/api\/spaces\/([^/]+)\/nodes$/);
  if (spaceNodesMatch && method === "GET") {
    const spaceId = spaceNodesMatch[1];
    const space = await db.getSpaceById(spaceId);
    if (!space) return jsonResponse({ error: { message: "Space not found" } }, 404);

    const nodes = await db.listSpaceRootNodes(spaceId);
    const nodesWithResources = await Promise.all(
      nodes.map(async (n) => {
        const res = await db.getResourceByNodeId(n.id);
        return formatNodeSummary(n, res);
      })
    );

    return jsonResponse({
      space: {
        id: space.id,
        type: space.type,
        name: space.name,
        publicRead: space.public_read === 1
      },
      parentNode: null,
      navigationRootNodeId: null,
      breadcrumbs: [],
      nodes: nodesWithResources,
      nextCursor: null
    });
  }

  // /api/spaces/:spaceId/trash
  const spaceTrashMatch = path.match(/^\/api\/spaces\/([^/]+)\/trash$/);
  if (spaceTrashMatch && method === "GET") {
    const spaceId = spaceTrashMatch[1];
    const batches = await db.listTrashBatches(spaceId);
    return jsonResponse({ trashBatches: batches });
  }

  // ==========================================
  // Nodes
  // ==========================================

  if (path === "/api/nodes" && method === "POST") {
    const body = (await request.json()) as any;
    if (!body.spaceId || !body.name) {
      return jsonResponse({ error: { message: "spaceId and name are required" } }, 400);
    }
    const node = await db.createNode({
      spaceId: body.spaceId,
      parentId: body.parentId ?? null,
      name: body.name,
      createdBy: currentUser.id
    });
    return jsonResponse(formatNodeSummary(node));
  }

  // /api/nodes/:nodeId
  const nodeMatch = path.match(/^\/api\/nodes\/([^/]+)$/);
  if (nodeMatch) {
    const nodeId = nodeMatch[1];
    if (method === "GET") {
      const node = await db.getNodeById(nodeId);
      if (!node) return jsonResponse({ error: { message: "Node not found" } }, 404);
      const res = await db.getResourceByNodeId(nodeId);
      return jsonResponse(formatNodeSummary(node, res));
    }
    if (method === "PATCH") {
      const body = (await request.json()) as any;
      const updated = await db.updateNode(nodeId, {
        name: body.name,
        parentId: body.parentId
      });
      if (!updated) return jsonResponse({ error: { message: "Node not found" } }, 404);
      const res = await db.getResourceByNodeId(nodeId);
      return jsonResponse(formatNodeSummary(updated, res));
    }
  }

  // /api/nodes/:nodeId/children
  const nodeChildrenMatch = path.match(/^\/api\/nodes\/([^/]+)\/children$/);
  if (nodeChildrenMatch && method === "GET") {
    const nodeId = nodeChildrenMatch[1];
    const parentNode = await db.getNodeById(nodeId);
    if (!parentNode) return jsonResponse({ error: { message: "Node not found" } }, 404);

    const space = await db.getSpaceById(parentNode.space_id);
    const children = await db.listNodeChildren(nodeId);
    const childrenWithResources = await Promise.all(
      children.map(async (n) => {
        const res = await db.getResourceByNodeId(n.id);
        return formatNodeSummary(n, res);
      })
    );

    return jsonResponse({
      space: space ? { id: space.id, type: space.type, name: space.name, publicRead: space.public_read === 1 } : null,
      parentNode: formatNodeSummary(parentNode),
      navigationRootNodeId: parentNode.id,
      breadcrumbs: [],
      nodes: childrenWithResources,
      nextCursor: null
    });
  }

  // /api/nodes/:nodeId/trash
  const nodeTrashMatch = path.match(/^\/api\/nodes\/([^/]+)\/trash$/);
  if (nodeTrashMatch && method === "POST") {
    const nodeId = nodeTrashMatch[1];
    const trashBatchId = await db.trashNode(nodeId, currentUser.id);
    return jsonResponse({ success: true, trashBatchId });
  }

  // /api/nodes/:nodeId/grants
  const nodeGrantsMatch = path.match(/^\/api\/nodes\/([^/]+)\/grants$/);
  if (nodeGrantsMatch) {
    const nodeId = nodeGrantsMatch[1];
    if (method === "GET") {
      const grants = await db.getNodeGrants(nodeId);
      return jsonResponse({ grants });
    }
    if (method === "PUT") {
      const body = (await request.json()) as any;
      const grant = await db.setNodeGrant(nodeId, body.userId, body.role ?? "viewer", currentUser.id);
      return jsonResponse(grant);
    }
    if (method === "DELETE") {
      const userId = url.searchParams.get("userId");
      if (userId) await db.deleteNodeGrant(nodeId, userId);
      return jsonResponse({ success: true });
    }
  }

  // /api/nodes/:nodeId/link-sharing
  const nodeLinkMatch = path.match(/^\/api\/nodes\/([^/]+)\/link-sharing$/);
  if (nodeLinkMatch) {
    const nodeId = nodeLinkMatch[1];
    if (method === "GET") {
      const sharing = await db.getNodeLinkSharing(nodeId);
      return jsonResponse(sharing ?? { enabled: false, role: "viewer" });
    }
    if (method === "PUT") {
      const body = (await request.json()) as any;
      const updated = await db.setNodeLinkSharing(nodeId, !!body.enabled, body.role ?? "viewer", currentUser.id);
      return jsonResponse(updated);
    }
  }

  // ==========================================
  // Resources
  // ==========================================

  if (path === "/api/resources" && method === "POST") {
    const body = (await request.json()) as any;
    const { spaceId, parentId, name, unitType = "sheet", unitId } = body;
    if (!spaceId || !name) {
      return jsonResponse({ error: { message: "spaceId and name are required" } }, 400);
    }

    const node = await db.createNode({
      spaceId,
      parentId: parentId ?? null,
      name,
      createdBy: currentUser.id
    });

    const resource = await db.createResource({
      nodeId: node.id,
      kind: "univer"
    });

    const effectiveUnitId = unitId || `unit_${crypto.randomUUID()}`;
    const univerRes = await db.createUniverResource(resource.id, effectiveUnitId, unitType);

    return jsonResponse({
      resource: {
        id: resource.id,
        nodeId: node.id,
        kind: "univer",
        univer: univerRes,
        capabilities: { openContent: true, editContent: true, downloadContent: true }
      },
      node: formatNodeSummary(node, { id: resource.id, kind: "univer", univer: univerRes })
    });
  }

  // /api/resources/:resourceId
  const resourceMatch = path.match(/^\/api\/resources\/([^/]+)$/);
  if (resourceMatch && method === "GET") {
    const resourceId = resourceMatch[1];
    const res = await db.getResourceById(resourceId);
    if (!res) return jsonResponse({ error: { message: "Resource not found" } }, 404);
    await db.touchRecentResource(currentUser.id, resourceId);
    return jsonResponse(res);
  }

  // /api/resources/:resourceId/open
  const resourceOpenMatch = path.match(/^\/api\/resources\/([^/]+)\/open$/);
  if (resourceOpenMatch && method === "POST") {
    const resourceId = resourceOpenMatch[1];
    const res = await db.getResourceById(resourceId);
    if (!res) return jsonResponse({ error: { message: "Resource not found" } }, 404);
    await db.touchRecentResource(currentUser.id, resourceId);
    return jsonResponse({ resource: res });
  }

  // /api/unit-resources/:unitId
  const unitResourceMatch = path.match(/^\/api\/unit-resources\/([^/]+)$/);
  if (unitResourceMatch && method === "GET") {
    const unitId = unitResourceMatch[1];
    const res = await db.getResourceByUnitId(unitId);
    if (!res) return jsonResponse({ error: { message: "Unit resource not found" } }, 404);
    return jsonResponse(res);
  }

  if (path === "/api/recent-resources" && method === "GET") {
    const recents = await db.listRecentResources(currentUser.id);
    return jsonResponse({ resources: recents });
  }

  // ==========================================
  // Trash Batches
  // ==========================================

  const trashRestoreMatch = path.match(/^\/api\/trash-batches\/([^/]+)\/restore$/);
  if (trashRestoreMatch && method === "POST") {
    const batchId = trashRestoreMatch[1];
    const success = await db.restoreTrashBatch(batchId);
    return jsonResponse({ success });
  }

  const trashBatchMatch = path.match(/^\/api\/trash-batches\/([^/]+)$/);
  if (trashBatchMatch && method === "DELETE") {
    const batchId = trashBatchMatch[1];
    await db.deleteTrashBatch(batchId);
    return jsonResponse({ success: true });
  }

  // ==========================================
  // Worktrees
  // ==========================================

  if (path === "/api/worktrees" && method === "GET") {
    const spaceId = url.searchParams.get("spaceId") ?? undefined;
    const worktrees = await db.listWorktrees(currentUser.id, spaceId);
    return jsonResponse({ worktrees });
  }

  if (path === "/api/worktrees" && method === "POST") {
    const body = (await request.json()) as any;
    const wt = await db.createWorktree({
      name: body.name || "Draft Worktree",
      summary: body.summary,
      creatorUserId: currentUser.id,
      kind: body.kind ?? "user",
      teamSpaceId: body.teamSpaceId,
      visibility: body.visibility ?? "private"
    });
    return jsonResponse(wt);
  }

  const worktreeMatch = path.match(/^\/api\/worktrees\/([^/]+)$/);
  if (worktreeMatch && method === "GET") {
    const wt = await db.getWorktree(worktreeMatch[1]);
    if (!wt) return jsonResponse({ error: { message: "Worktree not found" } }, 404);
    return jsonResponse(wt);
  }

  const worktreeDiscardMatch = path.match(/^\/api\/worktrees\/([^/]+)\/discard$/);
  if (worktreeDiscardMatch && method === "POST") {
    await db.discardWorktree(worktreeDiscardMatch[1]);
    return jsonResponse({ success: true });
  }

  return null;
}
