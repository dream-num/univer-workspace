import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveToolScope } from "./tool-scope.ts";
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
        "Download or replace Workspace Blob files. Download to a session-relative file, edit locally, then replace using the exact ETag returned by download. Replacements publish immediately without Worktree review. A stale ETag requires downloading and reconciling the latest content; never silently overwrite it. Reuse the same idempotencyKey for a retry of the same write.",
      parameters: {
        action: { type: "string", enum: ["download", "replace"], required: true },
        resourceId: { type: "string", required: true },
        file: {
          type: "string",
          required: true,
          description: "Session-relative input for replace or output for download.",
        },
        etag: {
          type: "string",
          description: "Exact quoted ETag returned by download; required for replace.",
        },
        idempotencyKey: {
          type: "string",
          description: "Required for replace. Use a stable unique key for this write.",
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
        const file = required(args.file, "file");
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
        const idempotencyKey = required(args.idempotencyKey, "idempotencyKey");
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
        kind: args.action === "replace" ? "edit" : "read",
      }),
    }),
  );
}
