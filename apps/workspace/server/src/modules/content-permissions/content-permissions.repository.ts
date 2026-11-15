import type { ResourceContentAccess, UnitType } from "../access/index.js";

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

export type ContentPermissionWriteResult = "saved" | "denied" | "invalid-collaborator";

export function canManageContentPermission(
  userId: string,
  creatorId: string,
  resource: ResourceContentAccess | null,
): boolean {
  if (!resource?.capabilities.editContent) return false;
  return creatorId === userId || resource.role === "owner" || resource.role === "admin";
}

export interface ContentPermissionsRepository {
  get(unitId: string, objectId: string): Promise<ContentPermissionObject | null>;
  /** Both writes recheck actor and named collaborator access within the write transaction. */
  create(object: ContentPermissionObject, unitType: UnitType): Promise<ContentPermissionWriteResult>;
  update(
    userId: string,
    unitId: string,
    objectId: string,
    patch: ContentPermissionUpdate,
  ): Promise<ContentPermissionWriteResult>;
  candidateUserIds(unitId: string): Promise<string[]>;
}
