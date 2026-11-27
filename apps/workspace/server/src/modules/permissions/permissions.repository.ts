import type { ExposureGuard } from "../access/index.js";
import type { GrantRole, PublicUser, TeamRole } from "./permissions.types.js";

export interface MembershipRow {
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly role: TeamRole;
  readonly granted_by_id: string;
  readonly granted_by_username: string;
  readonly granted_by_display_name: string;
  readonly granted_by_avatar_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface GrantRow {
  readonly effectiveRole: GrantRole;
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly role: GrantRole;
  readonly granted_by_id: string;
  readonly granted_by_username: string;
  readonly granted_by_display_name: string;
  readonly granted_by_avatar_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface LinkSharingRow {
  readonly enabled: 0 | 1;
  readonly role: GrantRole;
  readonly created_by_id: string;
  readonly created_by_username: string;
  readonly created_by_display_name: string;
  readonly created_by_avatar_url: string | null;
  readonly updated_by_id: string;
  readonly updated_by_username: string;
  readonly updated_by_display_name: string;
  readonly updated_by_avatar_url: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export type PersonalSharingRow = {
  readonly node_id: string;
  readonly node_name: string;
  readonly role: GrantRole;
  readonly updated_at: number;
} & (
  | { readonly kind: "link"; readonly enabled: 0 | 1 }
  | {
      readonly kind: "grant";
      readonly user_id: string;
      readonly username: string;
      readonly display_name: string;
      readonly avatar_url: string | null;
    }
);

export interface NodeOwnerRow {
  readonly username: string;
  readonly kind: "human" | "agent";
  readonly claimed: 0 | 1;
  readonly expires_at: number | null;
}

/**
 * Mutations recheck access and capture their result in the same transaction. A write that can widen
 * access calls its guard after the capability checks.
 */
export interface PermissionsRepository {
  findUser(userId: string): Promise<PublicUser | null>;
  searchUsers(query: string, excludedUserId: string): Promise<PublicUser[]>;
  listMembers(spaceId: string): Promise<MembershipRow[]>;
  upsertMember(input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly role: TeamRole;
    readonly grantedBy: string;
    readonly now: number;
  }, guard: ExposureGuard<TeamRole>): Promise<MembershipRow>;
  removeMember(actorUserId: string, spaceId: string, userId: string): Promise<void>;
  listGrants(nodeId: string): Promise<GrantRow[]>;
  upsertGrant(input: {
    readonly nodeId: string;
    readonly userId: string;
    readonly role: GrantRole;
    readonly grantedBy: string;
    readonly now: number;
  }, guard: ExposureGuard<GrantRole>): Promise<GrantRow>;
  removeGrant(actorUserId: string, nodeId: string, userId: string): Promise<GrantRole | null>;
  findLinkSharing(nodeId: string): Promise<LinkSharingRow | null>;
  /**
   * The Link Sharing settings and Node Grants in the actor's own Personal Space that the actor created
   * or last changed after `since`, up to `limit` of each kind, and whether the reader owns that Space.
   */
  listPersonalSharing(
    readerUserId: string,
    actorUserId: string,
    since: number,
    limit: number,
  ): Promise<{ readonly owned: boolean; readonly rows: PersonalSharingRow[] }>;
  findNodeOwner(nodeId: string): Promise<NodeOwnerRow>;
  /**
   * The files a claimed agent made before its claim in its Personal Space that are not in Trash and
   * have no Link Sharing row: the ones whose links the claim closed.
   */
  listAgentFilesWithoutLinkSharing(agentUserId: string): Promise<readonly string[]>;
  upsertLinkSharing(input: {
    readonly nodeId: string;
    readonly enabled: boolean;
    readonly role: GrantRole;
    readonly actorUserId: string;
    readonly now: number;
  }, guard: ExposureGuard<GrantRole>): Promise<{ row: LinkSharingRow; owner: NodeOwnerRow; changed: boolean; wasEnabled: boolean }>;
}
