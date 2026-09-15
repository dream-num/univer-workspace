import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveTargetSpace, resolveToolScope } from "./tool-scope.ts";
import { existingSessionPath, newSessionPath } from "./workspace-path.ts";
import { registerUniverTool, text } from "./presentation.ts";
import { requireBlobIdempotencyKey } from "./blob-input.ts";
import { UniverError } from "./errors.ts";

/** Blob bytes are published directly; they do not participate in Unit Worktrees. */
export function registerBlobTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_blob",
      description:
        "Get metadata, download, upload or replace Workspace Blob files. Get returns metadata only; download saves bytes to a session-relative file. Upload creates a new Blob; replace updates an existing Blob using the exact ETag returned by download. Uploads and replacements publish immediately without Worktree review. A stale ETag requires downloading and reconciling the latest content; never silently overwrite it. Reuse the same file and idempotencyKey for a retry of the same write.",
      parameters: {
        action: { type: "string", enum: ["get", "download", "upload", "replace"], required: true },
        resourceId: { type: "string", description: "Required for get, download and replace." },
        file: {
          type: "string",
          description: "Required session-relative input for upload/replace or output for download.",
        },
        spaceId: {
          type: "string",
          description: "Upload destination; defaults to the current Space.",
        },
        parentNodeId: {
          type: "string",
          description: "Upload destination folder; defaults to the Space root.",
        },
        name: {
          type: "string",
          description: "Uploaded Blob name; defaults to the input filename.",
        },
        etag: {
          type: "string",
          description: "Exact quoted ETag returned by download; required for replace.",
        },
        idempotencyKey: {
          type: "string",
          description:
            "Required for upload and replace: 16–200 ASCII letters, digits, underscores or hyphens (for example a UUID). Reuse only for an identical write retry.",
        },
      },
      output: { schema: { type: "json" }, render: (_args, value: unknown) => text(value) },
      async execute(args, exec) {
        const scope = await resolveToolScope(ctx, exec);
        const service = ctx.get("univerWorkspace")!;
        const required = (value: string | undefined, name: string) => {
          if (!value?.trim()) throw new UniverError(`${name} is required.`, "INVALID_REQUEST");
          return value;
        };
        if (args.action === "get") {
          return {
            ...(await service.getBlob(scope.userId, required(args.resourceId, "resourceId"))),
          };
        }
        const file = required(args.file, "file");
        if (args.action === "upload") {
          const idempotencyKey = requireBlobIdempotencyKey(args.idempotencyKey);
          const spaceId = resolveTargetSpace(scope, args.spaceId);
          const source = await existingSessionPath(exec, file);
          return {
            ...(await service.uploadBlob(scope.userId, {
              spaceId,
              parentNodeId: args.parentNodeId ?? null,
              name: args.name === undefined ? basename(file) : required(args.name, "name"),
              originalFilename: basename(file),
              bytes: await readFile(source.path),
              idempotencyKey,
            })),
          };
        }
        const resourceId = required(args.resourceId, "resourceId");
        if (args.action === "download") {
          const output = await newSessionPath(exec, file);
          const result = await service.downloadBlob(scope.userId, resourceId);
          await mkdir(dirname(output.path), { recursive: true });
          await writeFile(output.path, result.bytes, { flag: "wx" });
          return {
            resourceId,
            file,
            byteSize: result.bytes.byteLength,
            etag: result.etag,
            mediaType: result.mediaType,
          };
        }
        const idempotencyKey = requireBlobIdempotencyKey(args.idempotencyKey);
        const etag = required(args.etag, "etag");
        const source = await existingSessionPath(exec, file);
        const result = await service.replaceBlob(scope.userId, {
          resourceId,
          bytes: await readFile(source.path),
          etag,
          idempotencyKey,
        });
        return { ...result };
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Blob ${args.action}`,
        kind: args.action === "replace" || args.action === "upload" ? "edit" : "read",
      }),
    }),
  );
}
