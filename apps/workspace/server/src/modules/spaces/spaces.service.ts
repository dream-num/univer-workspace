import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import {
  spaceCapabilities,
  type AccessResolver,
  type AccessRole,
} from "../access/index.js";
import { SpacesRepository } from "./spaces.repository.js";
import type { SpaceView } from "./spaces.types.js";

export interface SpacesModule {
  list(userId: string): { readonly spaces: readonly SpaceView[] };
  createTeamSpace(
    userId: string,
    input: { readonly name: unknown; readonly publicRead?: unknown }
  ): SpaceView;
  get(userId: string, spaceId: string): SpaceView;
  update(
    userId: string,
    spaceId: string,
    input: { readonly name?: unknown; readonly publicRead?: unknown }
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
            accessRole: role,
            capabilities: spaceCapabilities(role),
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
        accessRole: "owner",
        capabilities: spaceCapabilities("owner"),
      };
    },

    get(userId, spaceId) {
      return resolveSpace(options.access, userId, spaceId);
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
      if (input.name === undefined && input.publicRead === undefined) {
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
      if (input.name !== undefined) {
        options.repository.updateName(spaceId, name, updatedAt);
      }
      if (input.publicRead !== undefined) {
        options.repository.updatePublicRead(spaceId, publicRead, updatedAt);
      }
      return {
        id: access.id,
        type: access.type,
        name,
        publicRead,
        accessRole: access.role,
        capabilities: access.capabilities,
      };
    },
  };
}

function resolveSpace(
  resolver: AccessResolver,
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

function notFound(): ApplicationError {
  return new ApplicationError(
    "NOT_FOUND",
    404,
    "The resource was not found."
  );
}
