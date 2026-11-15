export type { StoredSpaceAccess } from "./access.repository.js";
export type { AccessRepository } from "./access.repository.js";
export {
  createAccessResolver,
  nodeCapabilities,
  resourceCapabilities,
  spaceCapabilities,
  resolveStoredSpaceAccess,
} from "./access.service.js";
export type { AccessResolver } from "./access.service.js";
export { assertCeiling } from "./ceilings.js";
export type {
  AccessRole,
  BlobAvailability,
  BlobResourceAccess,
  NodeAccess,
  NodeCapabilities,
  ResourceAccess,
  ResourceContentAccess,
  ResourceKind,
  ResourceCapabilities,
  SpaceAccess,
  SpaceCapabilities,
  SpaceType,
  UnitType,
  UniverResourceAccess,
} from "./access.types.js";
