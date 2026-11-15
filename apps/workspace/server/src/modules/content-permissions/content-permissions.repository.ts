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

export interface ContentPermissionsRepository {
  get(unitId: string, objectId: string): ContentPermissionObject | null;
  create(object: ContentPermissionObject): void;
  update(object: ContentPermissionObject): void;
  candidateUserIds(unitId: string): string[];
}
