export interface ContentCollaborator {
  readonly userId: string;
  readonly role: number;
}

/** Protocol enum values are opaque storage values; the integration validates them. */
export interface ContentPermissionObject {
  readonly id: string;
  readonly unitId: string;
  readonly objectType: number;
  readonly creatorUserId: string;
  readonly name: string;
  readonly strategies: readonly { readonly action: number; readonly role: number }[];
  readonly readScope: number;
  readonly editScope: number;
  readonly collaborators: readonly ContentCollaborator[];
}

/** Null fields preserve the current stored value when a client updates part of a rule. */
export interface ContentPermissionUpdate {
  readonly name: string | null;
  readonly strategies: ContentPermissionObject["strategies"] | null;
  readonly scope: { readonly read: number; readonly edit: number } | null;
  readonly collaborators: readonly ContentCollaborator[] | null;
}

export interface ContentPermissionsRepository {
  get(unitId: string, objectId: string): Promise<ContentPermissionObject | null>;
  create(object: ContentPermissionObject): Promise<void>;
  update(unitId: string, objectId: string, patch: ContentPermissionUpdate): Promise<boolean>;
  candidateUserIds(unitId: string): Promise<string[]>;
}
