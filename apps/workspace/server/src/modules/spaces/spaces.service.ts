import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import {
  spaceCapabilities,
  type AccessResolver,
  type AccessRole,
} from "../access/index.js";
import { SpacesRepository } from "./spaces.repository.js";
import type { SpaceStar, SpaceView } from "./spaces.types.js";

export interface SpacesModule {
  list(userId: string): { readonly spaces: readonly SpaceView[] };
  createTeamSpace(
    userId: string,
    input: { readonly name: unknown; readonly publicRead?: unknown }
  ): SpaceView;
  get(userId: string, spaceId: string): SpaceView;
  getStar(userId: string, spaceId: string): SpaceStar;
  setStar(userId: string, spaceId: string, starred: boolean): SpaceStar;
  update(
    userId: string,
    spaceId: string,
    input: {
      readonly name?: unknown;
      readonly publicRead?: unknown;
      readonly description?: unknown;
    }
  ): SpaceView;
}

export function createSpacesModule(options: {
  readonly repository: SpacesRepository;
  readonly access: AccessResolver;
  readonly now?: () => number;
}): SpacesModule {
  const now = options.now ?? Date.now;

  return {
    list(userId) {
      return {
        spaces: options.repository.listDiscoverable(userId).map((row) => {
          const role: AccessRole =
            row.owner_user_id === userId
              ? "owner"
              : (row.member_role ?? "viewer");
          return {
            id: row.id,
            type: row.type,
            name: row.name,
            publicRead: Boolean(row.public_read),
            description: row.description,
            owner: { id: row.owner_user_id, username: row.owner_username },
            accessRole: role,
            capabilities: spaceCapabilities(role, {
              type: row.type,
              member: row.owner_user_id === userId || row.member_role !== null,
            }),
          };
        }),
      };
    },

    createTeamSpace(userId, input) {
      const id = randomUUID();
      const name = validName(input.name);
      const publicRead = input.publicRead === undefined
        ? false
        : validBoolean(input.publicRead, "publicRead");
      options.repository.createTeamSpace({
        id,
        name,
        publicRead,
        ownerUserId: userId,
        createdAt: now(),
      });
      return {
        id,
        type: "team",
        name,
        publicRead,
        description: "",
        owner: options.repository.getOwner(userId),
        accessRole: "owner",
        capabilities: spaceCapabilities("owner", { type: "team", member: true }),
      };
    },

    get(userId, spaceId) {
      return resolveSpace(options.access, options.repository, userId, spaceId);
    },

    getStar(userId, spaceId) {
      if (!options.access.resolveSpace(userId, spaceId)) throw notFound();
      return options.repository.getStar(userId, spaceId);
    },

    setStar(userId, spaceId, starred) {
      if (!options.access.resolveSpace(userId, spaceId)) throw notFound();
      return options.repository.setStar(userId, spaceId, starred, now());
    },

    update(userId, spaceId, input) {
      const access = options.access.resolveSpace(userId, spaceId);
      if (!access) throw notFound();
      if (!access.capabilities.renameSpace) {
        throw new ApplicationError(
          "FORBIDDEN",
          403,
          "The current user cannot update this space."
        );
      }
      if (
        input.name === undefined &&
        input.publicRead === undefined &&
        input.description === undefined
      ) {
        throw new ApplicationError(
          "INVALID_INPUT",
          400,
          "At least one Space setting is required."
        );
      }
      const updatedAt = now();
      const name = input.name === undefined ? access.name : validName(input.name);
      const publicRead = input.publicRead === undefined
        ? access.publicRead
        : validBoolean(input.publicRead, "publicRead");
      const description = input.description === undefined
        ? options.repository.getDescription(spaceId)
        : validDescription(input.description);
      if (input.name !== undefined) {
        options.repository.updateName(spaceId, name, updatedAt);
      }
      if (input.publicRead !== undefined) {
        options.repository.updatePublicRead(spaceId, publicRead, updatedAt);
      }
      if (input.description !== undefined) {
        options.repository.updateDescription(spaceId, description, updatedAt);
      }
      return {
        id: access.id,
        type: access.type,
        name,
        publicRead,
        description,
        owner: options.repository.getOwner(access.ownerUserId),
        accessRole: access.role,
        capabilities: access.capabilities,
      };
    },
  };
}

function resolveSpace(
  resolver: AccessResolver,
  repository: SpacesRepository,
  userId: string,
  spaceId: string
): SpaceView {
  const access = resolver.resolveSpace(userId, spaceId);
  if (!access) throw notFound();
  return {
    id: access.id,
    type: access.type,
    name: access.name,
    publicRead: access.publicRead,
    description: repository.getDescription(access.id),
    owner: repository.getOwner(access.ownerUserId),
    accessRole: access.role,
    capabilities: access.capabilities,
  };
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

function notFound(): ApplicationError {
  return new ApplicationError(
    "NOT_FOUND",
    404,
    "The resource was not found."
  );
}
