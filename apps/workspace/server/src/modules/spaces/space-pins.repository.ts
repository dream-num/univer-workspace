import type { SpaceListEntry } from "./spaces.repository.js";

export interface StoredSpacePins {
  readonly customized: boolean;
  readonly spaces: readonly SpaceListEntry[];
}

export interface SpacePinsRepository {
  getPins(userId: string, defaultLimit: number): Promise<StoredSpacePins>;
  /** Returns null when any requested Space is ineligible. */
  replacePins(userId: string, spaceIds: readonly string[], createdAt: number): Promise<StoredSpacePins | null>;
  resetPins(userId: string, defaultLimit: number): Promise<StoredSpacePins>;
}
