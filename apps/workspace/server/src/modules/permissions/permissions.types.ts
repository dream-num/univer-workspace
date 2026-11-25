import type { PrincipalKind } from "../identity/index.js";

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
  /** Owner of the Space that holds the Node. */
  readonly owner: { readonly username: string } & PrincipalKind;
  /** When the link suspends because its owner is an unclaimed agent that expires; null otherwise. */
  readonly expiresAt: string | null;
}

export type PersonalSharingChange = {
  readonly actor: PublicUser;
  /** `id` only for the actor and its claimer, because a link-shared Node's ID is its access link. */
  readonly node: { readonly id?: string; readonly name: string };
  readonly role: GrantRole;
  readonly updatedAt: string;
} & (
  | { readonly kind: "link"; readonly enabled: boolean }
  | { readonly kind: "grant"; readonly user: PublicUser }
);

/** Who may read content now, as some actors last set it, each after its own time. Not a history. */
export interface AccessChanges {
  readonly publicRead: boolean;
  readonly members: readonly TeamMembership[];
  readonly membersTruncated: boolean;
  /** Null when the reader owns none of the actors' Personal Spaces and may not accept their work. */
  readonly personalSharing: {
    readonly items: readonly PersonalSharingChange[];
    readonly truncated: boolean;
  } | null;
}
