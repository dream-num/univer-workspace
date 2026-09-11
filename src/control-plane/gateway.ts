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

function formatResourceSummary(resource?: any) {
  if (!resource) return null;
  if (resource.kind === "univer") {
    return {
      id: resource.id,
      kind: "univer" as const,
      unitId: resource.univer?.unit_id ?? resource.unit_id,
      unitType: resource.univer?.unit_type ?? resource.unit_type ?? "sheet",
      capabilities: {
        openContent: true,
        editContent: true,
        downloadContent: false
      }
    };
  }
  return {
    id: resource.id,
    kind: "blob" as const,
    mediaType: resource.blob?.media_type ?? resource.media_type ?? "application/octet-stream",
    byteSize: resource.blob?.byte_size ?? resource.byte_size ?? 0,
    availability: (resource.blob?.availability ?? resource.availability ?? "ready") as "ready" | "quarantined",
    capabilities: {
      openContent: true,
      editContent: false,
      downloadContent: true
    }
  };
}

function formatNodeSummary(node: NodeItem, resource?: any) {
  return {
    id: node.id,
    spaceId: node.space_id,
    parentNodeId: node.parent_id,
    name: node.name,
    resource: formatResourceSummary(resource),
    hasChildren: false,
    updatedAt: new Date(node.updated_at).toISOString(),
    accessRole: "admin",
    capabilities: {
      browseChildren: true,
      createChildren: true,
      rename: true,
      move: true,
      trash: true,
      share: true
    }
  };
}

function formatSpaceSummary(space: Space) {
  return {
    id: space.id,
    type: space.type,
    name: space.name,
    publicRead: space.public_read === 1
  };
}

async function formatNodeResponse(db: ControlPlaneDb, node: NodeItem, resource?: any) {
  const space = await db.getSpaceById(node.space_id);
  if (!space) return null;
  const breadcrumbs = await db.getNodeBreadcrumbs(node.id);
  return {
    node: formatNodeSummary(node, resource),
    space: formatSpaceSummary(space),
    breadcrumbs: breadcrumbs
      .filter((crumb) => crumb.id !== node.id)
      .map((crumb) => ({ id: crumb.id, name: crumb.name })),
    navigationRootNodeId: null
  };
}

function formatOpenResource(resource: any, node: NodeItem | null | undefined) {
  if (resource.kind === "univer") {
    return {
      id: resource.id,
      kind: "univer" as const,
      nodeId: node?.id ?? resource.node_id,
      spaceId: node?.space_id ?? "",
      name: node?.name ?? "",
      unitId: resource.univer?.unit_id ?? "",
      unitType: resource.univer?.unit_type ?? "sheet",
      accessRole: "admin" as const,
      editorMode: "edit" as const
    };
  }
  return {
    id: resource.id,
    kind: "blob" as const,
    nodeId: node?.id ?? resource.node_id,
    spaceId: node?.space_id ?? "",
    name: node?.name ?? "",
    accessRole: "admin" as const,
    originalFilename: resource.blob?.original_filename ?? node?.name ?? "",
    mediaType: resource.blob?.media_type ?? "application/octet-stream",
    byteSize: resource.blob?.byte_size ?? 0,
    sha256: resource.blob?.sha256 ?? "",
    contentUrl: `/api/blobs/${resource.id}/content`,
    downloadUrl: `/api/blobs/${resource.id}/download`
  };
}

async function formatWorktreeSummary(wt: any, db: ControlPlaneDb) {
  const creator = await db.getUserById(wt.creator_user_id);
  let teamSpace = null;
  if (wt.team_space_id) {
    const s = await db.getSpaceById(wt.team_space_id);
    if (s) {
      teamSpace = { id: s.id, type: s.type, name: s.name };
    }
  }

  return {
    id: wt.id,
    name: wt.name,
    summary: wt.summary ?? null,
    kind: wt.kind,
    teamSpace,
    visibility: wt.visibility,
    state: (wt.processed_at ? "merged" : "draft") as "draft" | "ready" | "merging" | "merged" | "discarded",
    creator: creator
      ? formatUser(creator)
      : { id: wt.creator_user_id, username: "unknown", displayName: "Unknown", avatarUrl: null },
    unitCount: 0,
    processedAt: wt.processed_at ? new Date(wt.processed_at).toISOString() : null,
    createdAt: new Date(wt.created_at).toISOString(),
    updatedAt: new Date(wt.updated_at).toISOString(),
    capabilities: {
      open: true,
      ready: !wt.processed_at,
      reopen: !!wt.processed_at,
      merge: !wt.processed_at,
      discard: !wt.processed_at
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
      const payload = await formatNodeResponse(db, node, res);
      if (!payload) return jsonResponse({ error: { message: "Space not found" } }, 404);
      return jsonResponse(payload);
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
    const node = res.node ?? (await db.getNodeById(res.node_id));
    return jsonResponse({ resource: formatOpenResource(res, node) });
  }

  // /api/unit-resources/:unitId
  const unitResourceMatch = path.match(/^\/api\/unit-resources\/([^/]+)$/);
  if (unitResourceMatch && method === "GET") {
    const unitId = unitResourceMatch[1];
    const res = await db.getResourceByUnitId(unitId);
    if (!res) return jsonResponse({ error: { message: "Unit resource not found" } }, 404);
    const node = res.node ?? (await db.getNodeById(res.node_id));
    if (!node) return jsonResponse({ error: { message: "Node not found" } }, 404);
    return jsonResponse({
      resource: formatResourceSummary(res),
      node: formatNodeSummary(node, res)
    });
  }

  // ==========================================
  // Views (Recent, Owned By Me, Shared With Me)
  // ==========================================

  if (path === "/api/recent-resources" && method === "GET") {
    const recents = await db.listRecentResourcesWithDetails(currentUser.id);
    const items = await Promise.all(
      recents.map(async (row) => {
        const [node, resource, breadcrumbs] = await Promise.all([
          db.getNodeById(row.node_id),
          db.getResourceById(row.resource_id),
          row.node_id ? db.getNodeBreadcrumbs(row.node_id) : Promise.resolve([])
        ]);
        if (!node) return null;
        const ancestorBreadcrumbs = breadcrumbs.filter((b) => b.id !== node.id);
        return {
          lastOpenedAt: new Date(row.last_opened_at).toISOString(),
          node: formatNodeSummary(node, resource),
          resource: formatResourceSummary(resource)!,
          location: {
            space: {
              id: row.space_id,
              type: row.space_type as any,
              name: row.space_name
            },
            breadcrumbs: ancestorBreadcrumbs
          }
        };
      })
    );
    return jsonResponse({
      items: items.filter(Boolean),
      nextCursor: null
    });
  }

  if (path === "/api/owned-by-me" && method === "GET") {
    const owned = await db.listOwnedResources(currentUser.id);
    const items = await Promise.all(
      owned.map(async (row) => {
        const [node, resource, breadcrumbs] = await Promise.all([
          db.getNodeById(row.node_id),
          db.getResourceById(row.resource_id),
          row.node_id ? db.getNodeBreadcrumbs(row.node_id) : Promise.resolve([])
        ]);
        if (!node) return null;
        const ancestorBreadcrumbs = breadcrumbs.filter((b) => b.id !== node.id);
        return {
          node: formatNodeSummary(node, resource),
          resource: formatResourceSummary(resource)!,
          location: {
            space: {
              id: row.space_id,
              type: row.space_type as any,
              name: row.space_name
            },
            breadcrumbs: ancestorBreadcrumbs
          }
        };
      })
    );
    return jsonResponse({
      items: items.filter(Boolean),
      nextCursor: null
    });
  }

  if (path === "/api/shared-with-me" && method === "GET") {
    const shared = await db.listSharedNodes(currentUser.id);
    const items = await Promise.all(
      shared.map(async (row) => {
        const [node, resource] = await Promise.all([
          db.getNodeById(row.node_id),
          db.getResourceByNodeId(row.node_id)
        ]);
        if (!node) return null;
        return {
          node: formatNodeSummary(node, resource),
          sharedBy: {
            id: row.shared_by_id,
            username: row.shared_by_username,
            displayName: row.shared_by_display_name,
            avatarUrl: row.shared_by_avatar_url
          },
          sharedAt: new Date(row.shared_at).toISOString()
        };
      })
    );
    return jsonResponse({
      items: items.filter(Boolean),
      nextCursor: null
    });
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
    const items = await Promise.all(worktrees.map((wt) => formatWorktreeSummary(wt, db)));
    return jsonResponse({
      items,
      nextCursor: null
    });
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
    const summary = await formatWorktreeSummary(wt, db);
    return jsonResponse(summary, 201);
  }

  const worktreeMatch = path.match(/^\/api\/worktrees\/([^/]+)$/);
  if (worktreeMatch && method === "GET") {
    const wt = await db.getWorktree(worktreeMatch[1]);
    if (!wt) return jsonResponse({ error: { message: "Worktree not found" } }, 404);
    const summary = await formatWorktreeSummary(wt, db);
    return jsonResponse({
      ...summary,
      units: []
    });
  }

  const worktreeDiscardMatch = path.match(/^\/api\/worktrees\/([^/]+)\/discard$/);
  if (worktreeDiscardMatch && method === "POST") {
    await db.discardWorktree(worktreeDiscardMatch[1]);
    return jsonResponse({ success: true });
  }

  if (path.startsWith("/api/") || path.startsWith("/auth/")) {
    return jsonResponse({ error: { message: `Route not found: ${method} ${path}` } }, 404);
  }

  return null;
}
