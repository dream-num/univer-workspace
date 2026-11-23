import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import {
  assertCeiling,
  resolveStoredSpaceAccess,
  type AccessResolver,
  type SpaceType,
} from "../access/index.js";
import { spaceNotFound, spaceUpdateForbidden } from "./spaces.errors.js";
import type { SpacesRepository, SpaceListScope, SpaceListEntry } from "./spaces.repository.js";
import type { SpacePinsRepository, StoredSpacePins } from "./space-pins.repository.js";
import { RESERVED_SLUG, slugBaseFromName, validSlug } from "./space-slug.js";
import type { MySpaceView, SpacePins, SpaceStar, SpaceView } from "./spaces.types.js";

export interface SpacesModule {
  list(userId: string): Promise<{ readonly spaces: readonly MySpaceView[] }>;
  listStarred(userId: string): Promise<{ readonly spaces: readonly SpaceView[] }>;
  explore(userId: string): Promise<{ readonly spaces: readonly SpaceView[] }>;
  getPins(userId: string): Promise<SpacePins>;
  setPins(userId: string, spaceIds: unknown): Promise<SpacePins>;
  resetPins(userId: string): Promise<SpacePins>;
  createTeamSpace(
    userId: string,
    input: { readonly name: unknown; readonly slug?: unknown; readonly publicRead?: unknown }
  ): Promise<SpaceView>;
  get(userId: string, spaceId: string): Promise<SpaceView>;
  lookup(userId: string, owner: unknown, slug: unknown): Promise<SpaceView>;
  getStar(userId: string, spaceId: string): Promise<SpaceStar>;
  setStar(userId: string, spaceId: string, starred: boolean): Promise<SpaceStar>;
  update(
    userId: string,
    spaceId: string,
    input: {
      readonly name?: unknown;
      readonly slug?: unknown;
      readonly publicRead?: unknown;
      readonly description?: unknown;
    }
  ): Promise<SpaceView>;
}

const DEFAULT_PIN_COUNT = 8;
const PIN_LIMIT = 12;

export function createSpacesModule(options: {
  readonly repository: SpacesRepository;
  readonly pins: SpacePinsRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
}): SpacesModule {
  const now = options.now ?? Date.now;

  async function list(userId: string, scope: SpaceListScope): Promise<SpaceView[]> {
    const rows = await options.repository.listViews(userId, scope);
    return rows.map((row) => spaceView(userId, row));
  }

  function pinView(userId: string, pins: StoredSpacePins): SpacePins {
    return {
      customized: pins.customized,
      limit: PIN_LIMIT,
      spaces: pins.spaces.map((row) => spaceView(userId, row)),
    };
  }

  return {
    async list(userId) {
      const spaces = await list(userId, "mine");
      return { spaces: spaces.map((space): MySpaceView => {
        if (space.affiliation === "none") throw new Error("My Spaces returned an unaffiliated Space");
        return { ...space, affiliation: space.affiliation };
      }) };
    },
    async listStarred(userId) {
      return { spaces: await list(userId, "starred") };
    },
    async explore(userId) {
      return { spaces: await list(userId, "explore") };
    },
    async getPins(userId) {
      return pinView(userId, await options.pins.getPins(userId, DEFAULT_PIN_COUNT));
    },
    async setPins(userId, input) {
      const ids = validPinIds(input);
      const pins = await options.pins.replacePins(userId, ids, now());
      if (!pins) throw invalidPins();
      return pinView(userId, pins);
    },
    async resetPins(userId) {
      return pinView(userId, await options.pins.resetPins(userId, DEFAULT_PIN_COUNT));
    },

    async createTeamSpace(userId, input) {
      const id = randomUUID();
      const name = validName(input.name);
      const publicRead = input.publicRead === undefined
        ? false
        : validBoolean(input.publicRead, "publicRead");
      assertCeiling(await options.access.principalCategory(userId), "updateSpace", { publicRead });
      const row = await options.repository.createTeamSpace({
        id,
        name,
        ...(input.slug === undefined ? { slugBase: slugBaseFromName(name, id) } : { slug: validSlug(input.slug) }),
        publicRead,
        ownerUserId: userId,
        createdAt: now(),
      });
      if (!row) throw slugTaken();
      return spaceView(userId, row);
    },

    async get(userId, spaceId) {
      const row = await options.repository.getView(userId, spaceId);
      if (!row) throw spaceNotFound();
      return spaceView(userId, row);
    },

    async lookup(userId, owner, slug) {
      if (typeof owner !== "string" || typeof slug !== "string" || !owner || !slug) {
        throw new ApplicationError("INVALID_INPUT", 400, "owner and slug are required.", "owner");
      }
      const row = await options.repository.findViewByFullName(userId, owner, slug);
      if (!row) throw spaceNotFound();
      return spaceView(userId, row);
    },

    async getStar(userId, spaceId) {
      const star = await options.repository.getStar(userId, spaceId);
      if (!star) throw spaceNotFound();
      return star;
    },

    async setStar(userId, spaceId, starred) {
      const star = await options.repository.setStar(userId, spaceId, starred, now());
      if (!star) throw spaceNotFound();
      return star;
    },

    async update(userId, spaceId, input) {
      const access = await options.access.resolveSpace(userId, spaceId);
      if (!access) throw spaceNotFound();
      if (!access.capabilities.renameSpace) throw spaceUpdateForbidden();
      if (
        input.name === undefined &&
        input.slug === undefined &&
        input.publicRead === undefined &&
        input.description === undefined
      ) {
        throw new ApplicationError(
          "INVALID_INPUT",
          400,
          "At least one Space setting is required."
        );
      }
      const name = input.name === undefined ? undefined : validName(input.name);
      const publicRead = input.publicRead === undefined ? undefined : validBoolean(input.publicRead, "publicRead");
      assertCeiling(await options.access.principalCategory(userId), "updateSpace", { publicRead: publicRead ?? access.publicRead });
      const description = input.description === undefined ? undefined : validDescription(input.description);
      if (input.slug !== undefined && access.type !== "team") {
        throw new ApplicationError("INVALID_INPUT", 400, "Only a Team Space has a slug.", "slug");
      }
      const row = await options.repository.updateSettings(userId, spaceId, {
        ...(name !== undefined && { name }),
        ...(publicRead !== undefined && { publicRead }),
        ...(description !== undefined && { description }),
        ...(input.slug !== undefined && { slug: validSlug(input.slug) }),
      }, now());
      if (!row) throw slugTaken();
      return spaceView(userId, row);
    },
  };
}

function spaceView(userId: string, row: SpaceListEntry): SpaceView {
  const access = resolveStoredSpaceAccess(userId, row);
  if (!access) throw new Error("Space repository returned an inaccessible row");
  return {
    id: access.id,
    type: access.type,
    name: access.name,
    publicRead: access.publicRead,
    description: row.description,
    ...fullNameOf(access.type, row.slug, row.ownerUsername),
    owner: { id: access.ownerUserId, username: row.ownerUsername },
    accessRole: access.role,
    affiliation: access.role === "owner" ? "owner" : access.member ? "member" : "none",
    capabilities: access.capabilities,
  };
}

function validPinIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PIN_LIMIT) throw invalidPins();
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !id || ids.includes(id)) throw invalidPins();
    ids.push(id);
  }
  return ids;
}

function invalidPins(): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, "spaceIds must contain 1 to 12 unique pinnable Space IDs.", "spaceIds");
}

/** The full name is computed here once: `<owner>/personal`, `<owner>/<slug>`, or null for a Team Space without a slug. */
function fullNameOf(
  type: SpaceType,
  slug: string | null,
  ownerUsername: string
): { readonly slug: string | null; readonly fullName: string | null } {
  if (type === "personal") return { slug: null, fullName: `${ownerUsername}/${RESERVED_SLUG}` };
  return { slug, fullName: slug === null ? null : `${ownerUsername}/${slug}` };
}

function slugTaken(): ApplicationError {
  return new ApplicationError("SPACE_SLUG_TAKEN", 409, "The slug is already used by another Team Space or fork of this owner.", "slug");
}

function validBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      `${field} must be a boolean.`,
      field
    );
  }
  return value;
}

function validName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "Space name is required.",
      "name"
    );
  }
  const name = value.trim();
  if (!name || name.length > 100) {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "Space name must contain between 1 and 100 characters.",
      "name"
    );
  }
  return name;
}

function validDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "Space description must be a string.",
      "description"
    );
  }
  const description = value.trim();
  if (description.length > 350) {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "Space description must contain at most 350 characters.",
      "description"
    );
  }
  return description;
}
