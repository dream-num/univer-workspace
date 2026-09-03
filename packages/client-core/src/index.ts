export {
  completeCliLogin,
  loginWithPassword,
  logout,
  startCliLogin,
  whoami,
  type CliLoginCompletion,
  type PendingCliLogin,
  type WorkspaceAuthentication,
  type WorkspaceSubject,
} from "./auth.js";
export { WorkspaceBlobFeature } from "./blob.js";
export { resolveWorkspaceAssetContent } from "./asset-content.js";
export { WorkspaceAssetFeature } from "./asset.js";
export {
  executeWithStableIdentity,
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  WorkspaceResultUnknownError,
  workspaceError,
  type StableIdentityOptions,
} from "./errors.js";
export {
  contentLength,
  inspectSource,
  openSource,
  prepareDownload,
  responseContent,
  writeDownload,
  type DownloadTarget,
  type SourceFile,
} from "./files.js";
export {
  isWorkspaceRecord,
  WorkspaceHttp,
  type AuthenticatedWorkspaceHttp,
  type WorkspaceHttpOptions,
  type WorkspaceRequestOptions,
} from "./http.js";
export {
  parseDetachedNode,
  parseNode,
  parseNodePage,
  parseNodeResource,
  parseNodeResponse,
  parseNodeSummary,
  parseSpace,
  parseTrashBatch,
  parseUnitType,
  type WorkspaceAccessRole,
  type WorkspaceBlobResource,
  type WorkspaceNode,
  type WorkspaceNodeCapabilities,
  type WorkspaceNodeDirectory,
  type WorkspaceNodeResource,
  type WorkspaceNodeSummary,
  type WorkspaceResourceCapabilities,
  type WorkspaceSpace,
  type WorkspaceTrashBatch,
  type WorkspaceTrashBlocker,
  type WorkspaceUnitType,
  type WorkspaceUniverResource,
} from "./space-model.js";
export {
  WorkspaceSpaceFeature,
  type BrowseSpaceInput,
  type WorkspaceResourceKindFilter,
} from "./space.js";
export { WorkspaceOpenFeature, type WorkspaceOpenResult } from "./open.js";
export {
  WorkspaceUnitExchangeFeature,
  type WorkspaceExportFileInput,
  type WorkspaceExportFileResult,
  type WorkspaceImportFileInput,
  type WorkspaceImportFileResult,
  type WorkspaceUnitExchangeDependencies,
} from "./office-exchange.js";
export { WorkspaceUnitFeature } from "./unit.js";
export {
  WorkspaceCompileTypstFeature,
  type WorkspaceCompileTypstDependencies,
  type WorkspaceCompileTypstInput,
  type WorkspaceCompileTypstResult,
  type WorkspaceTypstMaterializeInput,
  type WorkspaceTypstMaterializeResult,
  type WorkspaceTypstMaterializer,
} from "./typst.js";
export { HeadlessWorkspaceTypstMaterializer } from "./typst-materialize.js";
export {
  WorkspaceUnitLayoutLintFeature,
  type WorkspaceUnitLayoutLintFeatureOptions,
} from "./layout-lint.js";
export {
  WorkspaceContentSource,
} from "./runtime-source.js";
export {
  WorkspaceRenderUnitLoader,
  type WorkspaceRenderUnitLoadInput,
  type WorkspaceRenderUnitLoaderOptions,
  type WorkspaceRenderUnitSource,
} from "./render-unit.js";
export {
  WorkspacePrintPdfFeature,
  type WorkspacePrintPdfApplication,
  type WorkspacePrintPdfFeatureOptions,
  type WorkspacePrintPdfInput,
  type WorkspacePrintPdfResult,
} from "./print-pdf.js";
export {
  WorkspaceScreenshotFeature,
  type WorkspaceScreenshotApplication,
  type WorkspaceScreenshotFeatureOptions,
  type WorkspaceScreenshotWriteInput,
  type WorkspaceScreenshotWrittenImage,
} from "./screenshot.js";
export {
  createWorkspaceSvgTextMeasurer,
  WorkspaceCompileSvgFeature,
  type WorkspaceApplySvgInput,
  type WorkspaceApplySvgResult,
  type WorkspaceCompileSvgDependencies,
  type WorkspaceCompileSvgInput,
  type WorkspaceCompileSvgResult,
  type WorkspaceSvgTextMeasurePort,
} from "./svg.js";
export {
  createWorkspaceContentRuntime,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeOperations,
  type WorkspaceContentRuntimeOptions,
  type WorkspaceContentRuntimeWriteResult,
} from "./content-runtime.js";
export {
  WorkspaceContentExecutionFeature,
  type WorkspaceContentExecuteInput,
  type WorkspaceContentExecuteResult,
  type WorkspaceEditableTargetResolver,
} from "./content-execution.js";
export {
  createWorkspaceEmbeddedImageUploader,
  externalizeEmbeddedImages,
  type WorkspaceEmbeddedImageUploader,
} from "./embedded-images.js";
export { WorkspaceSnapshotServerAdapter } from "./snapshot-server-adapter.js";
export {
  createWorkspaceReferenceLoadContext,
  readWorkspaceReferenceScope,
} from "./reference-load-context.js";
export {
  selectWorkspaceReferenceScope,
  type WorkspaceReferenceHostContext,
  type WorkspaceReferenceSourceScope,
} from "./reference-scope.js";
export { loadWorkspaceReferenceHostContext } from "./reference-host.js";
export {
  createWorkspaceReferencedUnitProviderRegistration,
  WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
  type WorkspaceSnapshotLoader,
} from "./referenced-unit-provider.js";
export {
  parseWorkspaceRuntimeTarget,
  serializeWorkspaceRuntimeTarget,
  workspaceRuntimeKey,
  workspaceSnapshotPrefix,
  type WorkspaceRuntimeScope,
  type WorkspaceRuntimeTarget,
} from "./runtime-target.js";
export {
  getWorktree,
  stableKey,
  WorkspaceWorktreeFeature,
  type ListWorktreesInput,
} from "./worktree.js";
export {
  parseUnit,
  parseWorktree,
  type WorkspaceUnit,
  type WorkspaceWorktree,
  type WorkspaceWorktreeState,
} from "./worktree-model.js";
