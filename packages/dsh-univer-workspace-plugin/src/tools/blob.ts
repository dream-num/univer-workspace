import type { JsonValue } from "../json-value.ts";
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  WorkspaceApplicationError,
  WorkspaceBlobFeature,
  WorkspaceHttp,
} from "@univerjs/univer-workspace-client-core";
import { resolveToolScope, resolveTargetSpace } from "./tool-scope.ts";
import { existingSessionPath, newSessionPath } from "./workspace-path.ts";
import { registerUniverTool, text } from "./presentation.ts";
import { UniverError } from "./errors.ts";

/** Blob bytes are published directly; they do not participate in Unit Worktrees. */
export function registerBlobTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_blob",
      description:
        "Get, download, upload, or replace Workspace Blob files. Download to a session-relative file, edit locally, then replace using the exact ETag returned by download. Upload and replace publish immediately without Worktree review. A stale ETag requires downloading and reconciling the latest content; never silently overwrite it. Reuse the same idempotencyKey for a retry of the same write.",
      parameters: {
        action: { type: "string", enum: ["get", "download", "upload", "replace"], required: true },
        resourceId: { type: "string" },
        file: {
          type: "string",
          description: "Session-relative input for upload/replace or output for download.",
        },
        etag: {
          type: "string",
          description: "Exact quoted ETag returned by download; required for replace.",
        },
        spaceId: { type: "string" },
        parentNodeId: { type: "string" },
        name: { type: "string", description: "Optional name for a newly uploaded Blob." },
        idempotencyKey: {
          type: "string",
          description: "Required for upload and replace. Use a stable unique key for this write.",
        },
      },
      output: { schema: { type: "json" }, render: (_args, value: unknown) => text(value) },
      async execute(args, exec) {
        const scope = await resolveToolScope(ctx, exec);
        const auth = ctx.get("workspaceAuth");
        const client = auth?.currentClient();
        if (
          !auth ||
          !client ||
          auth.switching() ||
          auth.currentIdentity()?.userId !== scope.userId
        ) {
          throw new UniverError("Workspace connection is unavailable.", "WORKSPACE_AUTH_REQUIRED");
        }
        const feature = new WorkspaceBlobFeature(
          async () =>
            new WorkspaceHttp({
              origin: client.origin,
              cookie: `workspace_session=${client.sessionToken}`,
              role: "client",
              fetcher: async (input, init) => {
                if (
                  auth.switching() ||
                  auth.currentClient()?.sessionToken !== client.sessionToken ||
                  auth.currentClient()?.origin !== client.origin ||
                  auth.currentIdentity()?.userId !== scope.userId
                ) {
                  throw new UniverError(
                    "Workspace account changed during Blob operation.",
                    "WORKSPACE_AUTH_REQUIRED",
                  );
                }
                return client.request(new URL(String(input)).pathname, init);
              },
            }),
        );
        const required = (value: string | undefined, name: string) => {
          if (!value?.trim()) throw new UniverError(`${name} is required.`, "INVALID_REQUEST");
          return value;
        };
        if (args.action === "get")
          return (await feature.get(
            required(args.resourceId, "resourceId"),
          )) as unknown as JsonValue;
        const file = required(args.file, "file");
        if (args.action === "download") {
          const output = await newSessionPath(exec, file);
          return (await feature.download({
            resourceId: required(args.resourceId, "resourceId"),
            outputPath: output.path,
          })) as unknown as JsonValue;
        }
        const source = await existingSessionPath(exec, file);
        const identity = { idempotencyKey: required(args.idempotencyKey, "idempotencyKey") };
        if (args.action === "replace") {
          try {
            return (await feature.replace({
              ...identity,
              resourceId: required(args.resourceId, "resourceId"),
              filePath: source.path,
              etag: required(args.etag, "etag"),
            })) as unknown as JsonValue;
          } catch (error) {
            if (error instanceof WorkspaceApplicationError) {
              throw new UniverError(
                `${error.message} Operation ID: ${identity.idempotencyKey}`,
                error.code,
              );
            }
            throw error;
          }
        }
        return (await feature.upload({
          ...identity,
          filePath: source.path,
          spaceId: resolveTargetSpace(scope, args.spaceId),
          ...(args.parentNodeId === undefined ? {} : { parentNodeId: args.parentNodeId }),
          ...(args.name === undefined ? {} : { name: args.name }),
        })) as unknown as JsonValue;
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Blob ${args.action}`,
        kind: args.action === "replace" || args.action === "upload" ? "edit" : "read",
      }),
    }),
  );
}
