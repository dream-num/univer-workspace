/**
 * Type-safe D1 Database Client for the Univer Workspace Control Plane.
 */
import { hashToken } from "./auth.ts";
import type {
  BlobResource,
  BlobUploadSession,
  LoginSession,
  NodeGrant,
  NodeItem,
  NodeLinkSharing,
  RecentResource,
  ResourceItem,
  Space,
  SpaceMember,
  SpaceRole,
  SpaceType,
  TrashBatch,
  UniverResource,
  UniverUnitType,
  User,
  WorktreeItem
} from "./types.ts";

export class ControlPlaneDb {
  constructor(private readonly db: D1Database) {}

  // ==========================================
  // Users & Authentication
  // ==========================================

  async createUser(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null;
  }): Promise<User> {
    const id = `user_${crypto.randomUUID()}`;
    const now = Date.now();
    const user: User = {
      id,
      username: input.username,
      display_name: input.displayName,
      avatar_url: input.avatarUrl ?? null,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(user.id, user.username, user.display_name, user.avatar_url, user.created_at, user.updated_at)
      .run();

    await this.db
      .prepare(
        `INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(user.id, input.passwordHash, now, now)
      .run();

    // Auto-create personal workspace
    const spaceId = `space_personal_${user.id}`;
    await this.createSpace({
      id: spaceId,
      type: "personal",
      name: `${user.display_name}'s Space`,
      ownerUserId: user.id
    });

    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(id)
      .first<User>();
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return this.db
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .bind(username)
      .first<User>();
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT password_hash FROM password_credentials WHERE user_id = ?")
      .bind(userId)
      .first<{ password_hash: string }>();
    return row?.password_hash ?? null;
  }

  async updateUser(id: string, patch: { displayName?: string; avatarUrl?: string | null }): Promise<User | null> {
    const existing = await this.getUserById(id);
    if (!existing) return null;

    const updated: User = {
      ...existing,
      display_name: patch.displayName ?? existing.display_name,
      avatar_url: patch.avatarUrl !== undefined ? patch.avatarUrl : existing.avatar_url,
      updated_at: Date.now()
    };

    await this.db
      .prepare(
        `UPDATE users
         SET display_name = ?, avatar_url = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(updated.display_name, updated.avatar_url, updated.updated_at, id)
      .run();

    return updated;
  }

  async searchUsers(query: string, limit: number = 20): Promise<User[]> {
    const pattern = `%${query}%`;
    const res = await this.db
      .prepare(
        `SELECT * FROM users
         WHERE username LIKE ? OR display_name LIKE ?
         ORDER BY display_name ASC LIMIT ?`
      )
      .bind(pattern, pattern, limit)
      .all<User>();
    return res.results ?? [];
  }

  // ==========================================
  // Sessions
  // ==========================================

  async createSession(userId: string, rawToken: string, ttlMs: number = 7 * 24 * 3600 * 1000): Promise<LoginSession> {
    const id = `ses_${crypto.randomUUID()}`;
    const secret_hash = await hashToken(rawToken);
    const now = Date.now();
    const expires_at = now + ttlMs;

    const session: LoginSession = {
      id,
      secret_hash,
      user_id: userId,
      created_at: now,
      expires_at
    };

    await this.db
      .prepare(
        `INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, secret_hash, userId, now, expires_at)
      .run();

    return session;
  }

  async getSessionByToken(rawToken: string): Promise<{ session: LoginSession; user: User } | null> {
    const secret_hash = await hashToken(rawToken);
    const now = Date.now();

    const session = await this.db
      .prepare("SELECT * FROM login_sessions WHERE secret_hash = ? AND expires_at > ?")
      .bind(secret_hash, now)
      .first<LoginSession>();

    if (!session) return null;

    const user = await this.getUserById(session.user_id);
    if (!user) return null;

    return { session, user };
  }

  async deleteSession(rawToken: string): Promise<void> {
    const secret_hash = await hashToken(rawToken);
    await this.db
      .prepare("DELETE FROM login_sessions WHERE secret_hash = ?")
      .bind(secret_hash)
      .run();
  }

  // ==========================================
  // Spaces & Members
  // ==========================================

  async listUserSpaces(userId: string): Promise<Space[]> {
    const res = await this.db
      .prepare(
        `SELECT * FROM spaces WHERE owner_user_id = ?
         UNION
         SELECT s.* FROM spaces s JOIN space_members sm ON s.id = sm.space_id WHERE sm.user_id = ?
         ORDER BY type DESC, created_at ASC`
      )
      .bind(userId, userId)
      .all<Space>();
    return res.results ?? [];
  }

  async getSpaceById(spaceId: string): Promise<Space | null> {
    return this.db
      .prepare("SELECT * FROM spaces WHERE id = ?")
      .bind(spaceId)
      .first<Space>();
  }

  async createSpace(input: {
    id?: string;
    type: SpaceType;
    name: string;
    ownerUserId: string;
    publicRead?: number;
  }): Promise<Space> {
    const id = input.id ?? `space_${crypto.randomUUID()}`;
    const now = Date.now();
    const space: Space = {
      id,
      type: input.type,
      name: input.name,
      owner_user_id: input.ownerUserId,
      created_at: now,
      updated_at: now,
      public_read: input.publicRead ?? 0
    };

    await this.db
      .prepare(
        `INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at, public_read)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(space.id, space.type, space.name, space.owner_user_id, space.created_at, space.updated_at, space.public_read)
      .run();

    await this.addSpaceMember(space.id, input.ownerUserId, "admin", input.ownerUserId);
    return space;
  }

  async updateSpace(spaceId: string, patch: { name?: string; publicRead?: number }): Promise<Space | null> {
    const existing = await this.getSpaceById(spaceId);
    if (!existing) return null;

    const updated: Space = {
      ...existing,
      name: patch.name ?? existing.name,
      public_read: patch.publicRead !== undefined ? patch.publicRead : existing.public_read,
      updated_at: Date.now()
    };

    await this.db
      .prepare(
        `UPDATE spaces
         SET name = ?, public_read = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(updated.name, updated.public_read, updated.updated_at, spaceId)
      .run();

    return updated;
  }

  async getSpaceMember(spaceId: string, userId: string): Promise<SpaceMember | null> {
    return this.db
      .prepare("SELECT * FROM space_members WHERE space_id = ? AND user_id = ?")
      .bind(spaceId, userId)
      .first<SpaceMember>();
  }

  async addSpaceMember(spaceId: string, userId: string, role: SpaceRole, grantedBy: string): Promise<SpaceMember> {
    const now = Date.now();
    const member: SpaceMember = {
      space_id: spaceId,
      user_id: userId,
      role,
      granted_by: grantedBy,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO space_members (space_id, user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(member.space_id, member.user_id, member.role, member.granted_by, member.created_at, member.updated_at)
      .run();

    return member;
  }

  // ==========================================
  // Nodes (Hierarchy Tree)
  // ==========================================

  async listSpaceRootNodes(spaceId: string): Promise<NodeItem[]> {
    const res = await this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE space_id = ? AND parent_id IS NULL AND trash_batch_id IS NULL
         ORDER BY name ASC`
      )
      .bind(spaceId)
      .all<NodeItem>();
    return res.results ?? [];
  }

  async listNodeChildren(nodeId: string): Promise<NodeItem[]> {
    const res = await this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE parent_id = ? AND trash_batch_id IS NULL
         ORDER BY name ASC`
      )
      .bind(nodeId)
      .all<NodeItem>();
    return res.results ?? [];
  }

  async getNodeById(nodeId: string): Promise<NodeItem | null> {
    return this.db
      .prepare("SELECT * FROM nodes WHERE id = ?")
      .bind(nodeId)
      .first<NodeItem>();
  }

  async createNode(input: {
    id?: string;
    spaceId: string;
    parentId?: string | null;
    name: string;
    createdBy: string;
  }): Promise<NodeItem> {
    const id = input.id ?? `node_${crypto.randomUUID()}`;
    const now = Date.now();
    const node: NodeItem = {
      id,
      space_id: input.spaceId,
      parent_id: input.parentId ?? null,
      name: input.name,
      created_by: input.createdBy,
      trash_batch_id: null,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT INTO nodes (id, space_id, parent_id, name, created_by, trash_batch_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(node.id, node.space_id, node.parent_id, node.name, node.created_by, node.created_at, node.updated_at)
      .run();

    return node;
  }

  async updateNode(nodeId: string, patch: { name?: string; parentId?: string | null }): Promise<NodeItem | null> {
    const existing = await this.getNodeById(nodeId);
    if (!existing) return null;

    const updated: NodeItem = {
      ...existing,
      name: patch.name ?? existing.name,
      parent_id: patch.parentId !== undefined ? patch.parentId : existing.parent_id,
      updated_at: Date.now()
    };

    await this.db
      .prepare(
        `UPDATE nodes
         SET name = ?, parent_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(updated.name, updated.parent_id, updated.updated_at, nodeId)
      .run();

    return updated;
  }

  async trashNode(nodeId: string, userId: string): Promise<string> {
    const node = await this.getNodeById(nodeId);
    if (!node) throw new Error("Node not found");

    const trashBatchId = `trash_${crypto.randomUUID()}`;
    const now = Date.now();

    await this.db
      .prepare(
        `INSERT INTO trash_batches (id, space_id, root_node_id, created_by, created_at, restored_at)
         VALUES (?, ?, ?, ?, ?, NULL)`
      )
      .bind(trashBatchId, node.space_id, nodeId, userId, now)
      .run();

    // Mark node as trashed
    await this.db
      .prepare("UPDATE nodes SET trash_batch_id = ?, updated_at = ? WHERE id = ?")
      .bind(trashBatchId, now, nodeId)
      .run();

    return trashBatchId;
  }

  // ==========================================
  // Resources
  // ==========================================

  async createResource(input: {
    id?: string;
    nodeId: string;
    kind: "univer" | "blob";
  }): Promise<ResourceItem> {
    const id = input.id ?? `res_${crypto.randomUUID()}`;
    const now = Date.now();
    const resource: ResourceItem = {
      id,
      node_id: input.nodeId,
      kind: input.kind,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(resource.id, resource.node_id, resource.kind, resource.created_at, resource.updated_at)
      .run();

    return resource;
  }

  async createUniverResource(resourceId: string, unitId: string, unitType: UniverUnitType): Promise<UniverResource> {
    const univerRes: UniverResource = {
      resource_id: resourceId,
      unit_id: unitId,
      unit_type: unitType
    };

    await this.db
      .prepare(
        `INSERT INTO univer_resources (resource_id, unit_id, unit_type)
         VALUES (?, ?, ?)`
      )
      .bind(resourceId, unitId, unitType)
      .run();

    return univerRes;
  }

  async createBlobResource(
    resourceId: string,
    input: {
      objectKey: string;
      originalFilename: string;
      mediaType: string;
      byteSize: number;
      sha256: string;
      etag: string;
      availability?: "ready" | "quarantined";
    }
  ): Promise<BlobResource> {
    const now = Date.now();
    const blobRes: BlobResource = {
      resource_id: resourceId,
      object_key: input.objectKey,
      original_filename: input.originalFilename,
      media_type: input.mediaType,
      byte_size: input.byteSize,
      sha256: input.sha256,
      etag: input.etag,
      availability: input.availability ?? "ready",
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        blobRes.resource_id,
        blobRes.object_key,
        blobRes.original_filename,
        blobRes.media_type,
        blobRes.byte_size,
        blobRes.sha256,
        blobRes.etag,
        blobRes.availability,
        blobRes.created_at,
        blobRes.updated_at
      )
      .run();

    return blobRes;
  }

  async getResourceById(resourceId: string): Promise<(ResourceItem & { univer?: UniverResource; blob?: BlobResource; node?: NodeItem }) | null> {
    const res = await this.db
      .prepare("SELECT * FROM resources WHERE id = ?")
      .bind(resourceId)
      .first<ResourceItem>();

    if (!res) return null;

    const node = await this.getNodeById(res.node_id);
    let univer: UniverResource | undefined;
    let blob: BlobResource | undefined;

    if (res.kind === "univer") {
      const u = await this.db
        .prepare("SELECT * FROM univer_resources WHERE resource_id = ?")
        .bind(resourceId)
        .first<UniverResource>();
      if (u) univer = u;
    } else {
      const b = await this.db
        .prepare("SELECT * FROM blob_resources WHERE resource_id = ?")
        .bind(resourceId)
        .first<BlobResource>();
      if (b) blob = b;
    }

    return {
      ...res,
      univer,
      blob,
      node: node ?? undefined
    };
  }

  async getResourceByNodeId(nodeId: string): Promise<(ResourceItem & { univer?: UniverResource; blob?: BlobResource }) | null> {
    const res = await this.db
      .prepare("SELECT * FROM resources WHERE node_id = ?")
      .bind(nodeId)
      .first<ResourceItem>();

    if (!res) return null;
    return this.getResourceById(res.id);
  }

  async getResourceByUnitId(unitId: string): Promise<(ResourceItem & { univer: UniverResource; node?: NodeItem }) | null> {
    const u = await this.db
      .prepare("SELECT * FROM univer_resources WHERE unit_id = ?")
      .bind(unitId)
      .first<UniverResource>();

    if (!u) return null;
    const res = await this.getResourceById(u.resource_id);
    if (!res || !res.univer) return null;
    return res as ResourceItem & { univer: UniverResource; node?: NodeItem };
  }

  async listRecentResources(userId: string, limit: number = 20): Promise<ResourceItem[]> {
    const res = await this.db
      .prepare(
        `SELECT r.* FROM recent_resources rr
         JOIN resources r ON rr.resource_id = r.id
         WHERE rr.user_id = ?
         ORDER BY rr.last_opened_at DESC LIMIT ?`
      )
      .bind(userId, limit)
      .all<ResourceItem>();
    return res.results ?? [];
  }

  async listRecentResourcesWithDetails(userId: string, limit: number = 50): Promise<Array<{
    resource_id: string;
    last_opened_at: number;
    node_id: string;
    space_id: string;
    space_type: string;
    space_name: string;
  }>> {
    const res = await this.db
      .prepare(
        `SELECT rr.resource_id, rr.last_opened_at, node.id AS node_id, space.id AS space_id, space.type AS space_type, space.name AS space_name
         FROM recent_resources AS rr
         JOIN resources AS resource ON rr.resource_id = resource.id
         JOIN nodes AS node ON node.id = resource.node_id
         JOIN spaces AS space ON space.id = node.space_id
         WHERE rr.user_id = ?
           AND node.trash_batch_id IS NULL
         ORDER BY rr.last_opened_at DESC, rr.resource_id
         LIMIT ?`
      )
      .bind(userId, limit)
      .all<{
        resource_id: string;
        last_opened_at: number;
        node_id: string;
        space_id: string;
        space_type: string;
        space_name: string;
      }>();
    return res.results ?? [];
  }

  async listOwnedResources(userId: string, limit: number = 50): Promise<Array<{
    resource_id: string;
    node_id: string;
    space_id: string;
    space_type: string;
    space_name: string;
  }>> {
    const res = await this.db
      .prepare(
        `SELECT resource.id AS resource_id, node.id AS node_id, space.id AS space_id, space.type AS space_type, space.name AS space_name
         FROM resources AS resource
         JOIN nodes AS node ON node.id = resource.node_id
         JOIN spaces AS space ON space.id = node.space_id
         WHERE space.owner_user_id = ?
           AND node.trash_batch_id IS NULL
         ORDER BY node.updated_at DESC, resource.id
         LIMIT ?`
      )
      .bind(userId, limit)
      .all<{
        resource_id: string;
        node_id: string;
        space_id: string;
        space_type: string;
        space_name: string;
      }>();
    return res.results ?? [];
  }

  async listSharedNodes(userId: string, limit: number = 50): Promise<Array<{
    node_id: string;
    shared_at: number;
    shared_by_id: string;
    shared_by_username: string;
    shared_by_display_name: string;
    shared_by_avatar_url: string | null;
  }>> {
    const res = await this.db
      .prepare(
        `SELECT
           grant_node.node_id,
           grant_node.created_at AS shared_at,
           grantor.id AS shared_by_id,
           grantor.username AS shared_by_username,
           grantor.display_name AS shared_by_display_name,
           grantor.avatar_url AS shared_by_avatar_url
         FROM node_grants AS grant_node
         JOIN nodes AS node ON node.id = grant_node.node_id
         JOIN users AS grantor ON grantor.id = grant_node.granted_by
         WHERE grant_node.user_id = ?
           AND node.trash_batch_id IS NULL
         ORDER BY grant_node.created_at DESC, grant_node.node_id
         LIMIT ?`
      )
      .bind(userId, limit)
      .all<{
        node_id: string;
        shared_at: number;
        shared_by_id: string;
        shared_by_username: string;
        shared_by_display_name: string;
        shared_by_avatar_url: string | null;
      }>();
    return res.results ?? [];
  }

  async getNodeBreadcrumbs(nodeId: string): Promise<Array<{ id: string; name: string }>> {
    const res = await this.db
      .prepare(
        `WITH RECURSIVE ancestry(id, parent_id, name, depth) AS (
           SELECT id, parent_id, name, 0
           FROM nodes
           WHERE id = ? AND trash_batch_id IS NULL
           UNION ALL
           SELECT parent.id, parent.parent_id, parent.name, ancestry.depth + 1
           FROM nodes AS parent
           JOIN ancestry ON ancestry.parent_id = parent.id
           WHERE parent.trash_batch_id IS NULL
         )
         SELECT id, name FROM ancestry ORDER BY depth DESC`
      )
      .bind(nodeId)
      .all<{ id: string; name: string }>();
    return res.results ?? [];
  }

  async touchRecentResource(userId: string, resourceId: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO recent_resources (user_id, resource_id, last_opened_at)
         VALUES (?, ?, ?)`
      )
      .bind(userId, resourceId, Date.now())
      .run();
  }

  // ==========================================
  // Grants & Link Sharing
  // ==========================================

  async getNodeGrants(nodeId: string): Promise<NodeGrant[]> {
    const res = await this.db
      .prepare("SELECT * FROM node_grants WHERE node_id = ?")
      .bind(nodeId)
      .all<NodeGrant>();
    return res.results ?? [];
  }

  async setNodeGrant(nodeId: string, userId: string, role: "editor" | "viewer", grantedBy: string): Promise<NodeGrant> {
    const now = Date.now();
    const grant: NodeGrant = {
      node_id: nodeId,
      user_id: userId,
      role,
      granted_by: grantedBy,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO node_grants (node_id, user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(grant.node_id, grant.user_id, grant.role, grant.granted_by, grant.created_at, grant.updated_at)
      .run();

    return grant;
  }

  async deleteNodeGrant(nodeId: string, userId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM node_grants WHERE node_id = ? AND user_id = ?")
      .bind(nodeId, userId)
      .run();
  }

  async getNodeLinkSharing(nodeId: string): Promise<NodeLinkSharing | null> {
    return this.db
      .prepare("SELECT * FROM node_link_sharing WHERE node_id = ?")
      .bind(nodeId)
      .first<NodeLinkSharing>();
  }

  async setNodeLinkSharing(
    nodeId: string,
    enabled: boolean,
    role: "editor" | "viewer",
    userId: string
  ): Promise<NodeLinkSharing> {
    const now = Date.now();
    const sharing: NodeLinkSharing = {
      node_id: nodeId,
      enabled: enabled ? 1 : 0,
      role,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT INTO node_link_sharing (node_id, enabled, role, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET enabled = ?, role = ?, updated_by = ?, updated_at = ?`
      )
      .bind(
        sharing.node_id,
        sharing.enabled,
        sharing.role,
        sharing.created_by,
        sharing.updated_by,
        sharing.created_at,
        sharing.updated_at,
        sharing.enabled,
        sharing.role,
        sharing.updated_by,
        sharing.updated_at
      )
      .run();

    return sharing;
  }

  // ==========================================
  // Trash Management
  // ==========================================

  async listTrashBatches(spaceId: string): Promise<TrashBatch[]> {
    const res = await this.db
      .prepare(
        `SELECT * FROM trash_batches
         WHERE space_id = ? AND restored_at IS NULL
         ORDER BY created_at DESC`
      )
      .bind(spaceId)
      .all<TrashBatch>();
    return res.results ?? [];
  }

  async getTrashBatch(trashBatchId: string): Promise<TrashBatch | null> {
    return this.db
      .prepare("SELECT * FROM trash_batches WHERE id = ?")
      .bind(trashBatchId)
      .first<TrashBatch>();
  }

  async restoreTrashBatch(trashBatchId: string): Promise<boolean> {
    const batch = await this.getTrashBatch(trashBatchId);
    if (!batch) return false;

    const now = Date.now();
    await this.db
      .prepare("UPDATE trash_batches SET restored_at = ? WHERE id = ?")
      .bind(now, trashBatchId)
      .run();

    await this.db
      .prepare("UPDATE nodes SET trash_batch_id = NULL, updated_at = ? WHERE trash_batch_id = ?")
      .bind(now, trashBatchId)
      .run();

    return true;
  }

  async deleteTrashBatch(trashBatchId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM nodes WHERE trash_batch_id = ?")
      .bind(trashBatchId)
      .run();

    await this.db
      .prepare("DELETE FROM trash_batches WHERE id = ?")
      .bind(trashBatchId)
      .run();
  }

  // ==========================================
  // Blob Upload Sessions
  // ==========================================

  async createUploadSession(session: Omit<BlobUploadSession, "created_at" | "updated_at">): Promise<BlobUploadSession> {
    const now = Date.now();
    const fullSession: BlobUploadSession = {
      ...session,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT INTO blob_upload_sessions (
           id, operation_id, actor_user_id, target_space_id, target_parent_node_id,
           node_id, resource_id, object_key, node_name, original_filename,
           declared_media_type, detected_media_type, byte_size, received_size,
           sha256, etag, state, expires_at, created_at, updated_at, completed_at, last_error_code
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        fullSession.id,
        fullSession.operation_id,
        fullSession.actor_user_id,
        fullSession.target_space_id,
        fullSession.target_parent_node_id,
        fullSession.node_id,
        fullSession.resource_id,
        fullSession.object_key,
        fullSession.node_name,
        fullSession.original_filename,
        fullSession.declared_media_type,
        fullSession.detected_media_type,
        fullSession.byte_size,
        fullSession.received_size,
        fullSession.sha256,
        fullSession.etag,
        fullSession.state,
        fullSession.expires_at,
        fullSession.created_at,
        fullSession.updated_at,
        fullSession.completed_at,
        fullSession.last_error_code
      )
      .run();

    return fullSession;
  }

  async getUploadSession(id: string): Promise<BlobUploadSession | null> {
    return this.db
      .prepare("SELECT * FROM blob_upload_sessions WHERE id = ?")
      .bind(id)
      .first<BlobUploadSession>();
  }

  async completeUploadSession(
    id: string,
    result: { byteSize: number; sha256: string; etag: string; mediaType?: string }
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `UPDATE blob_upload_sessions
         SET state = 'completed', received_size = ?, sha256 = ?, etag = ?,
             detected_media_type = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(result.byteSize, result.sha256, result.etag, result.mediaType ?? null, now, now, id)
      .run();
  }

  async abortUploadSession(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE blob_upload_sessions SET state = 'aborted', updated_at = ? WHERE id = ?")
      .bind(Date.now(), id)
      .run();
  }

  // ==========================================
  // Worktrees
  // ==========================================

  async listWorktrees(userId: string, spaceId?: string): Promise<WorktreeItem[]> {
    if (spaceId) {
      const res = await this.db
        .prepare(
          `SELECT * FROM worktrees
           WHERE (creator_user_id = ? OR team_space_id = ?) AND processed_at IS NULL
           ORDER BY created_at DESC`
        )
        .bind(userId, spaceId)
        .all<WorktreeItem>();
      return res.results ?? [];
    }

    const res = await this.db
      .prepare(
        `SELECT * FROM worktrees
         WHERE creator_user_id = ? AND processed_at IS NULL
         ORDER BY created_at DESC`
      )
      .bind(userId)
      .all<WorktreeItem>();
    return res.results ?? [];
  }

  async getWorktree(id: string): Promise<WorktreeItem | null> {
    return this.db
      .prepare("SELECT * FROM worktrees WHERE id = ?")
      .bind(id)
      .first<WorktreeItem>();
  }

  async createWorktree(input: {
    id?: string;
    name: string;
    summary?: string;
    creatorUserId: string;
    kind?: "user" | "team";
    teamSpaceId?: string | null;
    visibility?: "private" | "space";
  }): Promise<WorktreeItem> {
    const id = input.id ?? `wt_${crypto.randomUUID()}`;
    const now = Date.now();
    const wt: WorktreeItem = {
      id,
      name: input.name,
      summary: input.summary ?? null,
      creator_user_id: input.creatorUserId,
      kind: input.kind ?? "user",
      team_space_id: input.teamSpaceId ?? null,
      visibility: input.visibility ?? "private",
      processed_at: null,
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(
        `INSERT INTO worktrees (id, name, summary, creator_user_id, kind, team_space_id, visibility, processed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(wt.id, wt.name, wt.summary, wt.creator_user_id, wt.kind, wt.team_space_id, wt.visibility, wt.created_at, wt.updated_at)
      .run();

    return wt;
  }

  async discardWorktree(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE worktrees SET processed_at = ?, updated_at = ? WHERE id = ?")
      .bind(Date.now(), Date.now(), id)
      .run();
  }
}
