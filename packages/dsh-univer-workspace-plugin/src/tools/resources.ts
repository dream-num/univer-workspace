/**
 * Bundled visual-resource library tool.
 *
 * This mirrors dsh-univer-office's `univer_resources` surface using the
 * version-pinned CLI resource-library package.  The manifest is copied into
 * the packed plugin by the build (rather than embedded in the JavaScript
 * bundle); cache and export destinations are always below the calling DSH
 * session workspace.
 *
 * @module dsh-univer-workspace-plugin/tools/resources
 */

import {
  FilesystemResourceCache,
  FilesystemResourceOutput,
  HttpsResourceDownloader,
  createResourceLibrary,
  loadResourceManifestFromPath,
} from "@univer-cli/resource-library";
import { defineTool, type JsonValue } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { resolveToolScope } from "./tool-scope.ts";
import { newSessionPath } from "./workspace-path.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

const MANIFEST_PATH = fileURLToPath(new URL("./resource-manifest.json", import.meta.url));

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

function libraryFor(cwd: string) {
  const cacheRoot = join(cwd, ".dsh-univer-resource-cache");
  return {
    cacheRoot,
    library: createResourceLibrary({
      manifest: loadResourceManifestFromPath(MANIFEST_PATH),
      cache: new FilesystemResourceCache(cacheRoot),
      downloader: new HttpsResourceDownloader(),
      output: new FilesystemResourceOutput(),
    }),
  };
}

/** Register the bundled, read-only resource-library tool. */
export function registerResourcesTool(ctx: Context): () => void {
  return registerUniverTool(ctx, defineTool({
    name: "univer_resources",
    description:
      "Discover, read, export, and cache the version-pinned bundled SVG resources used by Univer content generation. Resource handles are stable within the shipped manifest; this is separate from Workspace product Resources.",
    parameters: {
      action: {
        type: "string",
        required: true,
        enum: ["registries", "find", "read", "export", "clear-cache"],
        description: "Resource-library operation.",
      },
      queries: { type: "array", items: { type: "string" }, description: "Non-empty search terms for find." },
      registries: { type: "array", items: { type: "string" }, description: "Optional registry ids for find." },
      limit: { type: "integer", description: "Optional positive result limit for find." },
      handle: { type: "string", description: "One resource handle for read." },
      handles: { type: "array", items: { type: "string" }, description: "Resource handles for export." },
      output: { type: "string", description: "Session-relative output directory for export." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true, const: true },
          operation: { type: "string", required: true, const: "resources" },
          result: { type: "json", required: true },
        },
      },
      render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
    },
    async execute(args, exec) {
      const { cwd } = await resolveToolScope(ctx, exec);
      const { cacheRoot, library } = libraryFor(cwd);
      // The resource-library adapters expect their cache root to exist even
      // for a first `read` (a read may populate a remote asset before an
      // explicit export).  Create it for every operation, not only export,
      // while keeping it below the authenticated session workspace.
      await mkdir(cacheRoot, { recursive: true });
      if (args.action === "registries") {
        return { ok: true as const, operation: "resources" as const, result: library.listRegistries() as unknown as JsonValue };
      }
      if (args.action === "clear-cache") {
        const result = await library.clearCache();
        return { ok: true as const, operation: "resources" as const, result: result as unknown as JsonValue };
      }
      if (args.action === "find") {
        const queries = nonEmptyList(args.queries, "queries", "find");
        if (args.registries?.some((registry) => registry.trim() === "")) {
          throw new UniverError("univer_resources find registries must be non-empty strings.", "RESOURCE_INPUT_INVALID");
        }
        if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) {
          throw new UniverError("univer_resources find limit must be a positive integer.", "RESOURCE_INPUT_INVALID");
        }
        const result = library.find({
          queries,
          ...(args.registries === undefined ? {} : { registries: args.registries }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        });
        return { ok: true as const, operation: "resources" as const, result: result as unknown as JsonValue };
      }
      if (args.action === "read") {
        if (args.handle === undefined || args.handle.trim() === "") {
          throw new UniverError("univer_resources read requires a non-empty handle.", "RESOURCE_INPUT_INVALID");
        }
        const result = await library.read({ handle: args.handle });
        return { ok: true as const, operation: "resources" as const, result: result as unknown as JsonValue };
      }
      const handles = nonEmptyList(args.handles, "handles", "export");
      if (args.output === undefined || args.output.trim() === "") {
        throw new UniverError("univer_resources export requires a non-empty output directory.", "RESOURCE_INPUT_INVALID");
      }
      const output = await newSessionPath(exec, args.output);
      const result = await library.export({ handles, destination: output.path });
      return { ok: true as const, operation: "resources" as const, result: result as unknown as JsonValue };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Univer resources: ${args.action}`,
      kind: args.action === "export" || args.action === "clear-cache" ? "execute" : "read",
      ...(args.output === undefined ? {} : { locations: [{ path: args.output }] }),
    }),
  }));
}

function nonEmptyList(value: readonly string[] | undefined, name: string, action: string): readonly string[] {
  if (value === undefined || value.length === 0 || value.some((item) => item.trim() === "")) {
    throw new UniverError(`univer_resources ${action} requires at least one non-empty ${name}.`, "RESOURCE_INPUT_INVALID");
  }
  return value;
}
