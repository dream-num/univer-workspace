export interface PublicUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export type TeamRole = "admin" | "editor" | "viewer";
export type GrantRole = "editor" | "viewer";

export interface TeamMembership {
  readonly user: PublicUser;
  readonly role: TeamRole;
  readonly grantedBy: PublicUser;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NodeGrant {
  readonly user: PublicUser;
  readonly role: GrantRole;
  readonly effectiveRole: GrantRole;
  readonly grantedBy: PublicUser;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NodeLinkSharing {
  readonly enabled: boolean;
  readonly role: GrantRole;
  readonly createdBy: PublicUser | null;
  readonly updatedBy: PublicUser | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}
