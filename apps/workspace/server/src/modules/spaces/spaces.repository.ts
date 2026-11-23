import type { StoredSpaceAccess } from "../access/index.js";
import type { SpaceStar } from "./spaces.types.js";

export interface SpaceListEntry extends StoredSpaceAccess {
  readonly ownerUsername: string;
  readonly description: string;
  readonly slug: string | null;
}

export type SpaceListScope = "mine" | "starred" | "explore";

export type CreateTeamSpaceInput = {
  readonly id: string;
  readonly name: string;
  readonly publicRead: boolean;
  readonly ownerUserId: string;
  readonly createdAt: number;
} & (
  | { readonly slug: string; readonly slugBase?: never }
  | { readonly slugBase: string; readonly slug?: never }
);

export interface SpaceSettingsPatch {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly publicRead?: boolean;
}

export interface SpacesRepository {
  listViews(userId: string, scope: SpaceListScope): Promise<SpaceListEntry[]>;
  getView(userId: string, spaceId: string): Promise<SpaceListEntry | null>;
  findViewByFullName(userId: string, username: string, slug: string): Promise<SpaceListEntry | null>;
  getStar(userId: string, spaceId: string): Promise<SpaceStar | null>;
  setStar(userId: string, spaceId: string, starred: boolean, createdAt: number): Promise<SpaceStar | null>;
  /**
   * Returns null on an explicit slug conflict. A generated slug is allocated with the insert, and the
   * owner's Team Space quota is checked in the same transaction.
   */
  createTeamSpace(input: CreateTeamSpaceInput): Promise<SpaceListEntry | null>;
  /** Writes only the supplied fields. Returns null on a slug conflict. */
  updateSettings(userId: string, spaceId: string, settings: SpaceSettingsPatch, updatedAt: number): Promise<SpaceListEntry | null>;
}
