export {
  WorkspaceReferenceProviderError,
  type WorkspaceReferenceProviderErrorCode,
} from "./errors.js";
export {
  WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
  WORKSPACE_REFERENCED_UNIT_PROVIDER_PRIORITY,
  createWorkspaceReferencedUnitProviderRegistration,
  type CreateWorkspaceReferencedUnitProviderInput,
  type WorkspaceLoadedUnit,
  type WorkspaceSnapshotLoadOptions,
  type WorkspaceSnapshotLoader,
} from "./provider.js";
export {
  WORKSPACE_REFERENCE_SCOPE_METADATA_KEY,
  createWorkspaceReferenceLoadContext,
  createWorkspaceReferenceScopePolicy,
  readWorkspaceReferenceSourceScope,
  type WorkspaceReferenceHostContext,
  type WorkspaceReferenceScopePolicy,
  type WorkspaceReferenceSourceScope,
} from "./scope.js";
export {
  WORKSPACE_REFERENCE_SCOPE_CONFORMANCE_CASES,
  type WorkspaceReferenceScopeConformanceCase,
} from "./conformance.js";
