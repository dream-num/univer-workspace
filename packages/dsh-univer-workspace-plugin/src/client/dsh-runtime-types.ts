/**
 * Client type seam for the DSH release-train migration.
 *
 * rc.2 exposes the shared browser contracts from `dsh-client-runtime`; alpha.4
 * republishes them through the split API/UI packages. UI components import
 * this file so the eventual release switch changes one compatibility boundary
 * instead of every renderer and plugin entry point.
 */
export type { Context as ClientContext } from "@deepseek-ai/cordis";
export type { ISessions, SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
export type { WorkspaceView } from "@deepseek-ai/dsh-api-workspace-controller/client";
export type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
export type { UseSessions } from "@deepseek-ai/dsh-client-ui-session/client";
export type { UiWorkspace } from "@deepseek-ai/dsh-client-ui-workspace/client";
export type { DirectoryFlowOwnerProps } from "@deepseek-ai/dsh-client-ui-workspace/client";
export type {
  ConversationNodeDefinition,
  ConversationTurnDataMap,
  ToolCallBlock,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
export type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
