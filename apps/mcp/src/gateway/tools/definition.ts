import type {
  WorkspaceHttp,
  WorkspaceSubject,
} from "@univerjs/univer-workspace-client-core/product";
import type { z } from "zod";

export type ToolScope = "read" | "write" | "publish" | "worktree:merge";

export interface ToolContext {
  readonly http: WorkspaceHttp;
  readonly user: WorkspaceSubject;
  readonly requestId: string;
  readonly identityOrigin: string;
  readonly scopes: ReadonlySet<ToolScope>;
}

export interface ToolDefinition {
  readonly name: string;
  readonly toolset: "core" | "files" | "admin";
  readonly scope: ToolScope;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodObject;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly openWorldHint: boolean;
  };
  run(
    context: ToolContext,
    args: unknown,
  ): Promise<{ readonly output: object; readonly repo: string | null }>;
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
