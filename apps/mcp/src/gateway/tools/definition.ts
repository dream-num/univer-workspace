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
}

export interface ToolDefinition {
  readonly executorOperations?: readonly OpName[];
  readonly executorAnyOperations?: readonly OpName[];
  readonly name: string;
  readonly toolset: "core" | "files" | "admin";
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
  /** Replaces `output` for a caller that waited for the result and adds content blocks after the text line. */
  readonly waiting?: { readonly output: object; readonly content: readonly ImageContent[] };
}
