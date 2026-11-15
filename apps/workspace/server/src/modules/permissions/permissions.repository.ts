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

export interface NodeOwnerRow {
  readonly username: string;
  readonly kind: "human" | "agent";
  readonly claimed: 0 | 1;
  readonly expires_at: number | null;
}

export interface PermissionsRepository {
  findUser(userId: string): PublicUser | null;
  searchUsers(query: string, excludedUserId: string): PublicUser[];
  listMembers(spaceId: string): MembershipRow[];
  upsertMember(input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly role: TeamRole;
    readonly grantedBy: string;
    readonly now: number;
  }): void;
  removeMember(spaceId: string, userId: string): boolean;
  listGrants(nodeId: string): GrantRow[];
  findGrant(nodeId: string, userId: string): GrantRow | null;
  upsertGrant(input: {
    readonly nodeId: string;
    readonly userId: string;
    readonly role: GrantRole;
    readonly grantedBy: string;
    readonly now: number;
  }): void;
  removeGrant(nodeId: string, userId: string): boolean;
  findLinkSharing(nodeId: string): LinkSharingRow | null;
  findNodeOwner(nodeId: string): NodeOwnerRow;
  upsertLinkSharing(input: {
    readonly nodeId: string;
    readonly enabled: boolean;
    readonly role: GrantRole;
    readonly actorUserId: string;
    readonly now: number;
  }): void;
}
