import type {
  WorkspaceHttp,
  WorkspaceSubject,
} from "@univerjs/univer-workspace-client-core/product";
import type { ResourceLibrary } from "@univer-cli/resource-library";
import type { z } from "zod";

import type { OpName } from "../../shared/executor-protocol.js";
import type { WorkspaceSkills } from "../skill-catalog.js";
import type { ToolJobs } from "../jobs/store.js";
import type { StagingStore } from "../staging/model.js";
import type { UsageAccumulator } from "../../shared/usage.js";
import type { ExecutorLink } from "./executor-tool.js";

export const TOOL_SCOPE_META = "univer.workspace/scope";

export type ToolScope = "read" | "write" | "publish" | "worktree:merge";

export type ToolPrincipal = "human" | "agent_claimed" | "agent_unclaimed";

export function toolPrincipal(user: WorkspaceSubject): ToolPrincipal {
  if (user.kind !== "agent") return "human";
  return user.claimed ? "agent_claimed" : "agent_unclaimed";
}

export interface ToolContext {
  readonly staging?: StagingStore;
  readonly jobs?: ToolJobs;
  readonly onDeferredJob?: (completion?: Promise<ToolResult>) => void;
  readonly usage?: UsageAccumulator;
  readonly executor?: ExecutorLink;
  readonly http: WorkspaceHttp;
  readonly user: WorkspaceSubject;
  readonly requestId: string;
  readonly identityOrigin: string;
  readonly skills?: Promise<WorkspaceSkills>;
  readonly resources: () => ResourceLibrary;
  readonly scopes: ReadonlySet<ToolScope>;
  readonly authKind?: "pat" | "oauth" | "dev";
}

export interface ToolDefinition {
  readonly executorOperations?: readonly OpName[];
  readonly executorAnyOperations?: readonly OpName[];
  readonly name: string;
  readonly toolset: "core" | "files" | "admin";
  /** The toolsets that list the tool for an agent principal, when not just `toolset`. Empty hides it. */
  readonly agentToolsets?: readonly ToolDefinition["toolset"][];
  /** The principals that see the tool, when not every one. */
  readonly principals?: readonly ToolPrincipal[];
  readonly scope: ToolScope;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodType<Record<string, unknown>>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly openWorldHint: boolean;
  };
  run(context: ToolContext, args: unknown): Promise<ToolResult>;
}

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

export interface ImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

export interface ToolResult {
  /** The durable result: what `job_get` returns for a job that outlived its caller. */
  readonly output: object;
  readonly repo: string | null;
  /** The file a share call resolved, for the usage event. */
  readonly nodeId?: string;
  /** Complete model-facing text instead of serialized output. */
  readonly text?: string;
  /** Replaces `output` for a caller that waited for the result and adds content blocks after the text line. */
  readonly waiting?: { readonly output: object; readonly content: readonly ImageContent[] };
}
