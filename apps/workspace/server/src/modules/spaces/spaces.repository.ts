import type { StoredSpaceAccess } from "../access/index.js";
import type { SpaceStar, SpaceView } from "./spaces.types.js";

export interface SpaceListEntry extends StoredSpaceAccess {
  readonly ownerUsername: string;
  readonly description: string;
  readonly slug: string | null;
}

export type SpaceListScope = "mine" | "starred" | "explore";

export interface SpacesRepository {
  listViews(userId: string, scope: SpaceListScope): SpaceListEntry[];
  getOwner(userId: string): SpaceView["owner"];
  getDetails(spaceId: string): { readonly description: string; readonly slug: string | null };
  findIdByFullName(username: string, slug: string): string | null;
  freeSlug(ownerUserId: string, base: string): string;
  slugTaken(ownerUserId: string, slug: string, exceptSpaceId?: string): boolean;
  getStar(userId: string, spaceId: string): SpaceStar;
  setStar(userId: string, spaceId: string, starred: boolean, createdAt: number): SpaceStar;
  createTeamSpace(input: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly publicRead: boolean;
    readonly ownerUserId: string;
    readonly createdAt: number;
  }): void;
  updateName(spaceId: string, name: string, updatedAt: number): void;
  updateSlug(spaceId: string, slug: string, updatedAt: number): void;
  updateDescription(spaceId: string, description: string, updatedAt: number): void;
  updatePublicRead(spaceId: string, publicRead: boolean, updatedAt: number): void;
}
