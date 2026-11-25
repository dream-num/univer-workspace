export type { StoredSpaceAccess } from "./access.repository.js";
export type { AccessRepository } from "./access.repository.js";
export {
  createAccessResolver,
  nodeCapabilities,
  resourceCapabilities,
  spaceCapabilities,
  resolveStoredSpaceAccess,
  resolveStoredNodeAccess,
  resolveStoredContentAccess,
  resolveStoredResourceAccess,
  requesterCategory,
  trunkEditorMode,
} from "./access.service.js";
export type { AccessResolver } from "./access.service.js";
export { AGENT_MERGE_WINDOW_MS, agentBudget, assertCeiling, assertCreateFilesCeiling, landsByChecks } from "./ceilings.js";
export type { BudgetUse } from "./ceilings.js";
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
  SpaceLanding,
  SpaceType,
  UnitType,
  UniverResourceAccess,
} from "./access.types.js";
export { SPACE_LANDINGS } from "./access.types.js";
