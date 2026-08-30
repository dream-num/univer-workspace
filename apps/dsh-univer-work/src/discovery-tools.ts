import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  TOOL_ABORTED,
  type PreToolDecision,
  type ToolExecutionResult,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  createStandardApiReference,
  type ApiReference,
  type ApiReferenceFindTermResult,
  type ApiReferenceShowResult,
  type ApiReferenceType,
} from "@univer-cli/api-reference";
import {
  createResourceLibrary,
  HttpsResourceDownloader,
  isResourceLibraryError,
  ResourceLibraryError,
  type CreateResourceLibraryOptions,
  type ResourceCache,
  type ResourceDownloader,
  type ResourceFindResult,
  type ResourceLibrary,
  type ResourceLibraryErrorCode,
  type ResourceRegistrySummary,
  type ResourceSummary,
} from "@univer-cli/resource-library";
import { closeWorkspaceTool } from "./space-node.js";
import {
  currentFilesystem,
  currentPolicy,
  projectWorkspaceFileEffectFailure,
  requireLocal,
  resolveContainedPath,
} from "./file-transfer.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";

const require = createRequire(import.meta.url);

export interface WorkspaceDiscoveryDatasets {
  readonly apiReference: ApiReference;
  readonly queryResources: ResourceLibrary;
  readonly resourceManifest: unknown;
}

export interface WorkspaceDiscoveryDatasetOptions {
  readonly createApiReference?: () => unknown;
  readonly loadResourceManifest?: () => unknown;
  readonly resourceManifest?: unknown;
}

interface WorkspaceDiscoveryToolDependencies {
  readonly createExportLibrary?: (options: CreateResourceLibraryOptions) => ResourceLibrary;
  readonly datasets: WorkspaceDiscoveryDatasets;
  readonly owner: WorkspaceToolOwner;
  readonly openResourceTemp?: typeof open;
  readonly renameResourceTemp?: typeof rename;
}

type ApiOperation = "api find" | "api show" | "resource registries" | "resource find" | "resource export";
type ApiFindArgs = {
  readonly terms: readonly string[];
  readonly unit?: "sheet" | "slide" | "doc" | "base" | "board";
  readonly limit?: number;
};
type ApiShowArgs = { readonly symbols: readonly string[] };
type ApiFindOutput = { readonly terms: readonly ApiReferenceFindTermResult[] };
type ApiShowOutput = { readonly results: readonly ApiReferenceShowResult[] };
type ResourceFindArgs = {
  readonly queries: readonly string[];
  readonly registries?: readonly string[];
  readonly limit?: number;
};
type ResourceRegistriesOutput = { readonly registries: readonly ResourceRegistrySummary[] };
type ResourceFindOutput = ResourceFindResult;
type ResourceExportArgs = {
  readonly handles: readonly string[];
  readonly output_directory: string;
};
type ResourceExportOutput = {
  readonly complete: boolean;
  readonly exported: readonly { readonly handle: string; readonly path: string }[];
  readonly failed: readonly { readonly handle: string; readonly code: string }[];
};

const ARGUMENT_BYTES = 65_536;
const API_RESULT_BYTES = 1_048_576;
const RESOURCE_RESULT_BYTES = 262_144;
const QUERY_ENTRIES = 8;
const QUERY_CHARACTERS = 160;
const API_FIND_LIMIT = 30;
const RESOURCE_FIND_LIMIT = 100;
const RESOURCE_EXPORT_HANDLES = 32;
const RESOURCE_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const RESOURCE_EXPORT_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const RESOURCE_COMPONENT = /^[A-Za-z0-9._-]+$/u;
const RESOURCE_ERROR_CODES = new Set<ResourceLibraryErrorCode>([
  "resource-cache-root-invalid",
  "resource-download-failed",
  "resource-download-http",
  "resource-download-insecure",
  "resource-download-insecure-redirect",
  "resource-download-invalid-redirect",
  "resource-download-invalid-svg",
  "resource-download-invalid-utf8",
  "resource-download-timeout",
  "resource-download-too-large",
  "resource-download-too-many-redirects",
  "resource-export-failed",
  "resource-export-filename-too-long",
  "resource-invalid-handle",
  "resource-invalid-registry-id",
  "resource-invalid-resource-id",
  "resource-invalid-svg",
  "resource-limit-invalid",
  "resource-manifest-invalid",
  "resource-manifest-read-failed",
  "resource-not-found",
  "resource-query-empty",
  "resource-registry-not-found",
]);

const apiFindParameters = {
  terms: { type: "array", required: true, items: { type: "string" } },
  unit: { type: "string", enum: ["sheet", "slide", "doc", "base", "board"] },
  limit: { type: "integer" },
} as const;
const apiShowParameters = {
  symbols: { type: "array", required: true, items: { type: "string" } },
} as const;
const resourceFindParameters = {
  queries: { type: "array", required: true, items: { type: "string" } },
  registries: { type: "array", items: { type: "string" } },
  limit: { type: "integer" },
} as const;
const resourceExportParameters = {
  handles: { type: "array", required: true, items: { type: "string" } },
  output_directory: { type: "string", required: true },
} as const;

const requiredString = { type: "string", required: true } as const;
const stringArray = {
  type: "array",
  required: true,
  items: { type: "string" },
} as const;
const typeMemberSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: requiredString,
    optional: { type: "boolean" },
    type: requiredString,
    summary: { type: "string" },
  },
} as const;
const typeValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: requiredString,
    value: {
      oneOf: [{ type: "string" }, { type: "number" }],
      required: true,
    },
  },
} as const;
const apiTypeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["interface", "enum", "alias"], required: true },
    packageName: requiredString,
    name: requiredString,
    summary: requiredString,
    members: { type: "array", items: typeMemberSchema },
    values: { type: "array", items: typeValueSchema },
    definition: { type: "string" },
    extends: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
  },
} as const;
const apiMemberSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    packageName: requiredString,
    owner: requiredString,
    kind: {
      type: "string",
      enum: ["method", "getter", "property", "function-property"],
      required: true,
    },
    readonly: { type: "boolean" },
    name: requiredString,
    signature: requiredString,
    summary: requiredString,
    example: requiredString,
  },
} as const;
const relationSchema = {
  type: "string",
  enum: ["own", "inherited", "composed"],
  required: true,
} as const;
const classResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "found", required: true },
    kind: { type: "string", const: "class", required: true },
    query: requiredString,
    name: requiredString,
    lineage: stringArray,
    composes: stringArray,
    groups: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          owner: requiredString,
          relation: relationSchema,
          members: { type: "array", required: true, items: apiMemberSchema },
        },
      },
    },
  },
} as const;
const memberResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "found", required: true },
    kind: { type: "string", const: "member", required: true },
    query: requiredString,
    target: requiredString,
    entries: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          member: { ...apiMemberSchema, required: true },
          relation: relationSchema,
          relationOwner: requiredString,
          appendix: { type: "array", required: true, items: apiTypeSchema },
        },
      },
    },
  },
} as const;
const foundTypeResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "found", required: true },
    kind: { type: "string", const: "type", required: true },
    query: requiredString,
    type: { ...apiTypeSchema, required: true },
    inherited: { type: "array", required: true, items: apiTypeSchema },
    appendix: { type: "array", required: true, items: apiTypeSchema },
  },
} as const;
const typeMemberResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "found", required: true },
    kind: { type: "string", const: "type-member", required: true },
    query: requiredString,
    declaredBy: { ...apiTypeSchema, required: true },
    requestedType: { ...apiTypeSchema, required: true },
    member: { oneOf: [typeMemberSchema, typeValueSchema], required: true },
    appendix: { type: "array", required: true, items: apiTypeSchema },
  },
} as const;
const notFoundResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", const: "not-found", required: true },
    kind: { type: "string", enum: ["symbol", "member"], required: true },
    query: requiredString,
    owner: { type: "string" },
    member: { type: "string" },
    suggestions: stringArray,
  },
} as const;
const apiFindOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    terms: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          term: requiredString,
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: {
                  type: "string",
                  enum: [
                    "method", "getter", "property", "function-property",
                    "interface", "enum", "alias", "field",
                  ],
                  required: true,
                },
                label: requiredString,
                signature: requiredString,
                summary: requiredString,
                packageName: requiredString,
                score: { type: "number", required: true },
              },
            },
          },
          totalMatches: { type: "integer", required: true },
        },
      },
    },
  },
} as const;
const apiShowOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      required: true,
      items: {
        oneOf: [
          classResultSchema,
          memberResultSchema,
          foundTypeResultSchema,
          typeMemberResultSchema,
          notFoundResultSchema,
        ],
      },
    },
  },
} as const;
const resourceTextValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: requiredString,
    label: requiredString,
  },
} as const;
const resourceSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    handle: requiredString,
    registryId: requiredString,
    id: requiredString,
    name: requiredString,
    group: {
      oneOf: [{ type: "null" }, resourceTextValueSchema],
      required: true,
    },
    tags: { type: "array", required: true, items: resourceTextValueSchema },
    keywords: stringArray,
    order: {
      oneOf: [{ type: "null" }, { type: "number" }],
      required: true,
    },
    intrinsicSize: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: {
        width: { type: "number", required: true },
        height: { type: "number", required: true },
      },
    },
    colorEditable: { type: "boolean", required: true },
  },
} as const;
const resourceRegistriesOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    registries: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: requiredString,
          resourceCount: { type: "integer", required: true },
          groupCount: { type: "integer", required: true },
          tagCount: { type: "integer", required: true },
          colorEditableCount: { type: "integer", required: true },
        },
      },
    },
  },
} as const;
const resourceFindOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    resources: { type: "array", required: true, items: resourceSummarySchema },
    total: { type: "integer", required: true },
  },
} as const;
const resourceExportOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    complete: { type: "boolean", required: true },
    exported: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          handle: requiredString,
          path: requiredString,
        },
      },
    },
    failed: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          handle: requiredString,
          code: requiredString,
        },
      },
    },
  },
} as const;

export function createWorkspaceDiscoveryDatasets(
  options: WorkspaceDiscoveryDatasetOptions = {},
): WorkspaceDiscoveryDatasets {
  try {
    const apiReference = requireApiReference(
      (options.createApiReference ?? createStandardApiReference)(),
    );
    const resourceManifest = Object.hasOwn(options, "resourceManifest")
      ? options.resourceManifest
      : (options.loadResourceManifest ?? loadInstalledResourceManifest)();
    const queryResources = createResourceLibrary({
      manifest: resourceManifest,
      cache: createNoRetentionCache(),
      downloader: {
        download: () => Promise.reject(invalidDataset()),
      },
      output: {
        write: () => Promise.reject(invalidDataset()),
      },
    });
    return { apiReference, queryResources, resourceManifest };
  } catch {
    throw invalidDataset();
  }
}

export function registerWorkspaceApiDiscoveryTools(
  ctx: Context,
  dependencies: WorkspaceDiscoveryToolDependencies,
): readonly (() => void)[] {
  const definitions = [
    closeWorkspaceTool(defineTool({
      name: "workspace_api_find",
      description: "Find version-matched Univer Facade APIs in the installed reference.",
      parameters: apiFindParameters,
      output: {
        schema: apiFindOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Found API reference matches for ${String(value.terms.length)} term(s).`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => await executeDiscoveryRead(
        dependencies.owner,
        "api find",
        exec,
        (signal) => {
          const input = validateApiFindArgs(args);
          const limit = input.limit ?? 10;
          const terms = dependencies.datasets.apiReference.find({
            terms: input.terms,
            limit,
            ...(input.unit === undefined ? {} : { unit: input.unit }),
          });
          signal.throwIfAborted();
          return validateApiFindOutput({
            terms,
          }, input.terms, limit);
        },
      ) as never,
    }), validateApiFindArgs),
    closeWorkspaceTool(defineTool({
      name: "workspace_api_show",
      description: "Show version-matched Univer Facade class, member, and type details.",
      parameters: apiShowParameters,
      output: {
        schema: apiShowOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Resolved ${String(value.results.length)} API symbol result(s).`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => await executeDiscoveryRead(
        dependencies.owner,
        "api show",
        exec,
        (signal) => {
          const input = validateApiShowArgs(args);
          const results = dependencies.datasets.apiReference.show(input.symbols);
          signal.throwIfAborted();
          return validateApiShowOutput({
            results,
          }, input.symbols);
        },
      ) as never,
    }), validateApiShowArgs),
    closeWorkspaceTool(defineTool({
      name: "workspace_resource_registries",
      description: "List the installed version-matched visual resource registries.",
      parameters: {},
      output: {
        schema: resourceRegistriesOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Listed ${String(value.registries.length)} installed resource registries.`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => await executeDiscoveryRead(
        dependencies.owner,
        "resource registries",
        exec,
        (signal) => {
          validateResourceRegistriesArgs(args);
          const registries = dependencies.datasets.queryResources.listRegistries();
          signal.throwIfAborted();
          return validateResourceRegistriesOutput({ registries });
        },
      ) as never,
    }), validateResourceRegistriesArgs),
    closeWorkspaceTool(defineTool({
      name: "workspace_resource_find",
      description: "Find installed version-matched visual resources by stable public metadata.",
      parameters: resourceFindParameters,
      output: {
        schema: resourceFindOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Found ${String(value.resources.length)} of ${String(value.total)} matching resources.`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => await executeDiscoveryRead(
        dependencies.owner,
        "resource find",
        exec,
        (signal) => {
          const input = validateResourceFindArgs(args);
          const limit = input.limit ?? 30;
          const result = dependencies.datasets.queryResources.find({
            queries: input.queries,
            limit,
            ...(input.registries === undefined ? {} : { registries: input.registries }),
          });
          signal.throwIfAborted();
          return validateResourceFindOutput(result, input.registries, limit);
        },
      ) as never,
    }), validateResourceFindArgs),
    closeWorkspaceTool(defineTool({
      name: "workspace_resource_export",
      description: "Export installed visual resources into an approved Host-local Session directory.",
      parameters: resourceExportParameters,
      output: {
        schema: resourceExportOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Exported ${String(value.exported.length)} resource file(s); ${String(value.failed.length)} failed.`,
        }],
      },
      finalizeContent: resourceExportFinalizer,
      execute: async (args, exec) => await executeDiscoveryRead(
        dependencies.owner,
        "resource export",
        exec,
        async (signal) => {
          const input = validateResourceExportArgs(args);
          const filesystem = currentFilesystem(ctx, "resource export");
          const sandboxPolicy = ctx.get("sandboxPolicy");
          const policy = currentPolicy(filesystem, sandboxPolicy, exec, "resource export");
          requireLocal(filesystem, "resource export");
          const directory = await resolveContainedPath(
            filesystem,
            policy,
            exec,
            input.output_directory,
            "resource export",
            signal,
          );
          signal.throwIfAborted();
          const destination = filesystem.processPath(directory);
          signal.throwIfAborted();
          return await exportResourcesForCall({
            ctx,
            destination,
            exec,
            input,
            manifest: dependencies.datasets.resourceManifest,
            signal,
            ...(dependencies.createExportLibrary === undefined
              ? {}
              : { createLibrary: dependencies.createExportLibrary }),
            ...(dependencies.openResourceTemp === undefined
              ? {}
              : { openResourceTemp: dependencies.openResourceTemp }),
            ...(dependencies.renameResourceTemp === undefined
              ? {}
              : { renameResourceTemp: dependencies.renameResourceTemp }),
          });
        },
      ) as never,
    }), validateResourceExportArgs),
  ];
  return [
    ...definitions.map((definition) => ctx.tools.register(definition)),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (exec.name !== "workspace_resource_export") return await next();
      try {
        const filesystem = currentFilesystem(ctx, "resource export");
        const policy = currentPolicy(filesystem, ctx.get("sandboxPolicy"), exec, "resource export");
        requireLocal(filesystem, "resource export");
        const input = validateResourceExportArgs(exec.arguments);
        await resolveContainedPath(
          filesystem,
          policy,
          exec,
          input.output_directory,
          "resource export",
          exec.signal,
        );
        return {
          kind: "ask",
          reason: "Workspace resource export writes approved visual assets to a Host-local Session directory.",
        };
      } catch (error) {
        const projected = projectWorkspaceFileEffectFailure(error, "resource export");
        if (projected !== undefined) throw projected;
        if (exec.signal.aborted) throw cancelled("resource export");
        throw operationFailed("resource export");
      }
    }),
  ];
}

function resourceExportFinalizer(_exec: unknown, result: Readonly<ToolExecutionResult>) {
  if (
    !result.isError
    || (result.error.info?.code !== TOOL_ABORTED
      && result.error.info?.code !== "workspace-operation-cancelled")
  ) return undefined;
  return [{
    type: "text" as const,
    text: "Workspace resource export may have published files. Inspect the approved output directory before deciding any next action. Never retry the export automatically.",
  }];
}

async function exportResourcesForCall(input: {
  readonly ctx: Context;
  readonly createLibrary?: (options: CreateResourceLibraryOptions) => ResourceLibrary;
  readonly destination: string;
  readonly exec: ToolRunContext;
  readonly input: ResourceExportArgs;
  readonly manifest: unknown;
  readonly openResourceTemp?: typeof open;
  readonly renameResourceTemp?: typeof rename;
  readonly signal: AbortSignal;
}): Promise<unknown> {
  const budget = { remaining: RESOURCE_EXPORT_DOWNLOAD_BYTES, terminal: false };
  const confirmed = new Map<string, string>();
  let activeHandle: string | undefined;
  const downloader: ResourceDownloader = new HttpsResourceDownloader({
    fetch: createCumulativeResourceFetch(input.signal, budget),
    maxBytes: RESOURCE_DOWNLOAD_BYTES,
  });
  const library = (input.createLibrary ?? createResourceLibrary)({
    manifest: input.manifest,
    cache: createNoRetentionCache(),
    downloader,
    output: {
      async write(destination, filename, svg) {
        if (activeHandle === undefined || confirmed.has(activeHandle)) throw exportFailed();
        const path = await writeResourceOutput({
          ...input,
          destination,
          expectedDestination: input.destination,
          filename,
          ...(input.openResourceTemp === undefined ? {} : { openResourceTemp: input.openResourceTemp }),
          ...(input.renameResourceTemp === undefined ? {} : { renameResourceTemp: input.renameResourceTemp }),
          svg,
        });
        confirmed.set(activeHandle, path);
        return path;
      },
    },
  });
  const exported: Array<{ readonly handle: string; readonly path: string }> = [];
  const failed: Array<{ readonly handle: string; readonly code: string }> = [];
  for (const handle of input.input.handles) {
    input.signal.throwIfAborted();
    if (budget.terminal) {
      failed.push(terminalBudgetFailure(handle));
      continue;
    }
    activeHandle = handle;
    let result;
    try {
      result = await library.export({ handles: [handle], destination: input.destination });
    } finally {
      activeHandle = undefined;
    }
    input.signal.throwIfAborted();
    const confirmedPath = confirmed.get(handle);
    const round = validateResourceExportOutput(
      result,
      [handle],
      confirmedPath === undefined ? new Map() : new Map([[handle, confirmedPath]]),
    );
    exported.push(...round.exported);
    failed.push(...round.failed);
  }
  const output = {
    complete: exported.length === input.input.handles.length && failed.length === 0,
    exported,
    failed,
  };
  enforceResultBytes(output, RESOURCE_RESULT_BYTES);
  return output;
}

export function createCumulativeResourceFetch(
  callSignal: AbortSignal,
  budget: { remaining: number; terminal: boolean },
): typeof fetch {
  return async (request, init) => {
    const signals = [callSignal];
    if (init?.signal != null) signals.push(init.signal);
    const signal = AbortSignal.any(signals);
    signal.throwIfAborted();
    if (budget.terminal) throw downloadTooLarge();
    const response = await fetch(request, { ...init, signal });
    if (signal.aborted) {
      await response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
    }
    if (isRedirect(response.status) || !response.ok || response.body === null) {
      if (response.body !== null && (isRedirect(response.status) || !response.ok)) {
        await response.body.cancel().catch(() => undefined);
      }
      return response;
    }
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      const byteLength = Number(declared);
      if (Number.isFinite(byteLength) && byteLength >= 0 && byteLength > budget.remaining) {
        budget.terminal = true;
        await response.body.cancel().catch(() => undefined);
        signal.throwIfAborted();
        throw downloadTooLarge();
      }
      if (Number.isFinite(byteLength) && byteLength > RESOURCE_DOWNLOAD_BYTES) {
        await response.body.cancel().catch(() => undefined);
        signal.throwIfAborted();
        throw downloadTooLarge();
      }
    }
    const bounded = new Response(boundedResponseBody(response.body, signal, budget), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
    Object.defineProperties(bounded, {
      redirected: { value: response.redirected },
      type: { value: response.type },
      url: { value: response.url },
    });
    return bounded;
  };
}

function boundedResponseBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  budget: { remaining: number; terminal: boolean },
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let settled = false;
  const release = () => {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  };
  const abort = () => {
    if (settled) return;
    settled = true;
    void reader.cancel(signal.reason).catch(() => undefined).finally(() => {
      release();
      controller?.error(signal.reason);
    });
  };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(value) {
      if (settled) return;
      try {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) {
          signal.throwIfAborted();
          settled = true;
          if (budget.remaining === 0) budget.terminal = true;
          release();
          value.close();
          return;
        }
        if (chunk.value.byteLength > budget.remaining) {
          budget.remaining = 0;
          budget.terminal = true;
          settled = true;
          await reader.cancel().catch(() => undefined);
          release();
          value.error(downloadTooLarge());
          return;
        }
        budget.remaining -= chunk.value.byteLength;
        signal.throwIfAborted();
        value.enqueue(chunk.value);
      } catch (error) {
        if (settled) return;
        settled = true;
        await reader.cancel().catch(() => undefined);
        release();
        value.error(error);
      }
    },
    async cancel(reason) {
      if (settled) return;
      settled = true;
      if (budget.remaining === 0) budget.terminal = true;
      await reader.cancel(reason).catch(() => undefined);
      release();
    },
  });
}

async function writeResourceOutput(input: {
  readonly ctx: Context;
  readonly destination: string;
  readonly exec: ToolRunContext;
  readonly expectedDestination: string;
  readonly filename: string;
  readonly input: ResourceExportArgs;
  readonly openResourceTemp?: typeof open;
  readonly renameResourceTemp?: typeof rename;
  readonly signal: AbortSignal;
  readonly svg: string;
}): Promise<string> {
  requireResourceBasename(input.filename);
  if (input.destination !== input.expectedDestination) throw exportFailed();
  const beforeCreate = await resolveResourceOutput(input, input.filename);
  if (beforeCreate.destination !== input.expectedDestination) throw exportFailed();
  await mkdir(beforeCreate.destination, { recursive: true });
  input.signal.throwIfAborted();
  const current = await resolveResourceOutput(input, input.filename);
  if (current.destination !== input.expectedDestination) throw exportFailed();
  return await publishResourceSvg(
    current.path,
    current.displayPath,
    input.svg,
    input.signal,
    input.openResourceTemp ?? open,
    input.renameResourceTemp ?? rename,
  );
}

async function resolveResourceOutput(
  input: Pick<Parameters<typeof writeResourceOutput>[0], "ctx" | "exec" | "input" | "signal">,
  filename: string,
): Promise<{ readonly destination: string; readonly displayPath: string; readonly path: string }> {
  const filesystem = currentFilesystem(input.ctx, "resource export");
  const policy = currentPolicy(filesystem, input.ctx.get("sandboxPolicy"), input.exec, "resource export");
  requireLocal(filesystem, "resource export");
  const directory = await resolveContainedPath(
    filesystem,
    policy,
    input.exec,
    input.input.output_directory,
    "resource export",
    input.signal,
  );
  input.signal.throwIfAborted();
  const target = await resolveContainedPath(
    filesystem,
    policy,
    input.exec,
    join(input.input.output_directory, filename),
    "resource export",
    input.signal,
  );
  input.signal.throwIfAborted();
  if (!filesystem.contains(directory, target)) throw exportFailed();
  return {
    destination: filesystem.processPath(directory),
    displayPath: target.displayPath,
    path: filesystem.processPath(target),
  };
}

async function publishResourceSvg(
  path: string,
  displayPath: string,
  svg: string,
  signal: AbortSignal,
  openFile: typeof open,
  renameFile: typeof rename,
): Promise<string> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let published = false;
  try {
    signal.throwIfAborted();
    handle = await openFile(temporaryPath, "wx", 0o600);
    signal.throwIfAborted();
    await handle.writeFile(svg, { encoding: "utf8" });
    signal.throwIfAborted();
    await handle.sync();
    signal.throwIfAborted();
    await handle.close();
    handle = undefined;
    signal.throwIfAborted();
    await renameFile(temporaryPath, path);
    published = true;
    return displayPath;
  } catch (error) {
    signal.throwIfAborted();
    if (isResourceLibraryError(error)) throw error;
    throw exportFailed();
  } finally {
    await handle?.close().catch(() => undefined);
    if (!published) await unlink(temporaryPath).catch(() => undefined);
  }
}

function requireResourceBasename(filename: string): void {
  if (
    filename === ""
    || filename === "."
    || filename === ".."
    || isAbsolute(filename)
    || filename.includes("/")
    || filename.includes("\\")
    || basename(filename) !== filename
  ) throw exportFailed();
}

function terminalBudgetFailure(handle: string) {
  return {
    handle,
    code: "resource-download-too-large",
  };
}

function downloadTooLarge(): ResourceLibraryError {
  return new ResourceLibraryError(
    "resource-download-too-large",
    "Resource exceeds the export download limit.",
  );
}

function exportFailed(): ResourceLibraryError {
  return new ResourceLibraryError(
    "resource-export-failed",
    "Resource output could not be published safely.",
  );
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function validateResourceExportArgs(value: unknown): ResourceExportArgs {
  const failure = invalidArguments("resource export");
  const record = exactRecord(value, ["handles", "output_directory"], [], failure);
  const handles = stringValues(record["handles"], failure);
  if (
    handles.length < 1
    || handles.length > RESOURCE_EXPORT_HANDLES
    || new Set(handles).size !== handles.length
  ) throw failure;
  for (const handle of handles) {
    const components = handle.split("/");
    if (components.length !== 2) throw failure;
    registryIdArgument(components[0], failure);
    resourceIdArgument(components[1], failure);
  }
  if (typeof record["output_directory"] !== "string" || record["output_directory"].trim() === "") {
    throw failure;
  }
  const canonical = { handles, output_directory: record["output_directory"] };
  enforceArgumentBytes(canonical, "resource export");
  return canonical;
}

function validateResourceRegistriesArgs(value: unknown): Record<string, never> {
  const failure = invalidArguments("resource registries");
  exactRecord(value, [], [], failure);
  return {};
}

function validateResourceFindArgs(value: unknown): ResourceFindArgs {
  const failure = invalidArguments("resource find");
  const record = exactRecord(value, ["queries"], ["registries", "limit"], failure);
  const queries = boundedUniqueStrings(record["queries"], "resource find", failure);
  const registries = record["registries"] === undefined
    ? undefined
    : boundedRegistryFilters(record["registries"], failure);
  const limit = record["limit"];
  if (
    limit !== undefined
    && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > RESOURCE_FIND_LIMIT)
  ) throw failure;
  const canonical = {
    queries,
    ...(registries === undefined ? {} : { registries }),
    ...(limit === undefined ? {} : { limit: limit as number }),
  };
  enforceArgumentBytes(canonical, "resource find");
  return canonical;
}

function boundedRegistryFilters(
  value: unknown,
  failure: WorkspaceDiscoveryToolError,
): readonly string[] {
  const values = stringValues(value, failure);
  if (
    values.length > QUERY_ENTRIES
    || values.some((entry) => entry.trim() === "" || [...entry].length > QUERY_CHARACTERS)
    || new Set(values).size !== values.length
  ) throw failure;
  return values;
}

function validateResourceRegistriesOutput(value: unknown): ResourceRegistriesOutput {
  try {
    const root = exactRecord(value, ["registries"]);
    for (const registry of denseArray(root["registries"])) {
      const item = exactRecord(registry, [
        "id", "resourceCount", "groupCount", "tagCount", "colorEditableCount",
      ]);
      registryId(item["id"]);
      for (const key of ["resourceCount", "groupCount", "tagCount", "colorEditableCount"] as const) {
        nonNegativeInteger(item[key]);
      }
    }
    enforceResultBytes(value, RESOURCE_RESULT_BYTES);
    return value as ResourceRegistriesOutput;
  } catch (error) {
    if (error instanceof WorkspaceDiscoveryToolError) throw error;
    throw invalidResult();
  }
}

function validateResourceFindOutput(
  value: unknown,
  registries: readonly string[] | undefined,
  limit: number,
): ResourceFindOutput {
  try {
    const root = exactRecord(value, ["resources", "total"]);
    const resources = denseArray(root["resources"]);
    nonNegativeInteger(root["total"]);
    if (resources.length > limit || (root["total"] as number) < resources.length) throw invalidResult();
    for (const resource of resources) validateResourceSummary(resource, registries);
    enforceResultBytes(value, RESOURCE_RESULT_BYTES);
    return value as ResourceFindOutput;
  } catch (error) {
    if (error instanceof WorkspaceDiscoveryToolError) throw error;
    throw invalidResult();
  }
}

function validateResourceExportOutput(
  value: unknown,
  expectedHandles: readonly string[],
  confirmed: ReadonlyMap<string, string>,
): ResourceExportOutput {
  try {
    const root = exactRecord(value, ["exported", "failed"]);
    const exported = denseArray(root["exported"]);
    const failed = denseArray(root["failed"]);
    const seen = new Set<string>();
    const canonicalExported = exported.map((entry) => {
      const item = exactRecord(entry, ["handle", "path"]);
      requiredText(item["handle"]);
      requiredText(item["path"]);
      if (!expectedHandles.includes(item["handle"]) || seen.has(item["handle"])) throw invalidResult();
      if (confirmed.get(item["handle"]) !== item["path"]) throw invalidResult();
      seen.add(item["handle"]);
      return { handle: item["handle"], path: item["path"] };
    });
    const canonicalFailed = failed.map((entry) => {
      const item = exactRecord(entry, ["handle", "code", "message"]);
      requiredText(item["handle"]);
      requiredText(item["code"]);
      requiredText(item["message"]);
      if (!expectedHandles.includes(item["handle"]) || seen.has(item["handle"])) throw invalidResult();
      if (confirmed.has(item["handle"])) throw invalidResult();
      seen.add(item["handle"]);
      return {
        handle: item["handle"],
        code: RESOURCE_ERROR_CODES.has(item["code"] as ResourceLibraryErrorCode)
          ? item["code"]
          : "resource-export-failed",
      };
    });
    if (seen.size !== expectedHandles.length) throw invalidResult();
    if (confirmed.size !== canonicalExported.length) throw invalidResult();
    const canonical = {
      complete: canonicalExported.length === expectedHandles.length && canonicalFailed.length === 0,
      exported: canonicalExported,
      failed: canonicalFailed,
    };
    enforceResultBytes(canonical, RESOURCE_RESULT_BYTES);
    return canonical;
  } catch (error) {
    if (error instanceof WorkspaceDiscoveryToolError) throw error;
    throw invalidResult();
  }
}

function validateResourceSummary(value: unknown, registries: readonly string[] | undefined): void {
  const resource = exactRecord(value, [
    "handle", "registryId", "id", "name", "group", "tags", "keywords",
    "order", "intrinsicSize", "colorEditable",
  ]);
  registryId(resource["registryId"]);
  resourceId(resource["id"]);
  nonBlankText(resource["name"]);
  if (resource["handle"] !== `${resource["registryId"] as string}/${resource["id"] as string}`) {
    throw invalidResult();
  }
  if (registries !== undefined && registries.length > 0 && !registries.includes(resource["registryId"] as string)) {
    throw invalidResult();
  }
  if (resource["group"] !== null) validateResourceTextValue(resource["group"]);
  for (const tag of denseArray(resource["tags"])) validateResourceTextValue(tag);
  const keywords = stringValues(resource["keywords"]);
  if (keywords.some((keyword) => keyword.trim() === "")) throw invalidResult();
  if (resource["order"] !== null) finiteNumber(resource["order"]);
  const size = exactRecord(resource["intrinsicSize"], ["width", "height"]);
  finiteNumber(size["width"]);
  finiteNumber(size["height"]);
  if ((size["width"] as number) <= 0 || (size["height"] as number) <= 0) throw invalidResult();
  if (typeof resource["colorEditable"] !== "boolean") throw invalidResult();
}

function validateResourceTextValue(value: unknown): void {
  const item = exactRecord(value, ["id", "label"]);
  resourceId(item["id"]);
  nonBlankText(item["label"]);
}

function validateApiFindArgs(value: unknown): ApiFindArgs {
  const failure = invalidArguments("api find");
  const record = exactRecord(value, ["terms"], ["unit", "limit"], failure);
  const terms = boundedUniqueStrings(record["terms"], "api find", failure);
  const unit = record["unit"];
  if (unit !== undefined && !["sheet", "slide", "doc", "base", "board"].includes(unit as string)) {
    throw failure;
  }
  const limit = record["limit"];
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > API_FIND_LIMIT)) {
    throw failure;
  }
  const canonical = {
    terms,
    ...(unit === undefined ? {} : { unit: unit as NonNullable<ApiFindArgs["unit"]> }),
    ...(limit === undefined ? {} : { limit: limit as number }),
  };
  enforceArgumentBytes(canonical, "api find");
  return canonical;
}

function validateApiShowArgs(value: unknown): ApiShowArgs {
  const failure = invalidArguments("api show");
  const record = exactRecord(value, ["symbols"], [], failure);
  const canonical = { symbols: boundedUniqueStrings(record["symbols"], "api show", failure) };
  enforceArgumentBytes(canonical, "api show");
  return canonical;
}

function validateApiFindOutput(
  value: unknown,
  expectedTerms: readonly string[],
  limit: number,
): ApiFindOutput {
  try {
    const root = exactRecord(value, ["terms"]);
    const terms = denseArray(root["terms"]);
    if (terms.length !== expectedTerms.length) throw invalidResult();
    for (const [index, term] of terms.entries()) {
      const item = exactRecord(term, ["term", "matches", "totalMatches"]);
      requiredText(item["term"]);
      if (item["term"] !== expectedTerms[index]) throw invalidResult();
      nonNegativeInteger(item["totalMatches"]);
      const matches = denseArray(item["matches"]);
      if (matches.length > limit) throw invalidResult();
      for (const match of matches) {
        const entry = exactRecord(match, [
          "kind", "label", "signature", "summary", "packageName", "score",
        ]);
        enumText(entry["kind"], [
          "method", "getter", "property", "function-property",
          "interface", "enum", "alias", "field",
        ]);
        for (const key of ["label", "signature", "summary", "packageName"] as const) {
          requiredText(entry[key]);
        }
        finiteNumber(entry["score"]);
      }
    }
    enforceResultBytes(value, API_RESULT_BYTES);
    return value as ApiFindOutput;
  } catch (error) {
    if (error instanceof WorkspaceDiscoveryToolError) throw error;
    throw invalidResult();
  }
}

function validateApiShowOutput(value: unknown, expectedSymbols: readonly string[]): ApiShowOutput {
  try {
    const root = exactRecord(value, ["results"]);
    const results = denseArray(root["results"]);
    if (results.length !== expectedSymbols.length) throw invalidResult();
    for (const [index, result] of results.entries()) {
      validateShowResult(result);
      if ((result as Record<string, unknown>)["query"] !== expectedSymbols[index]) throw invalidResult();
    }
    enforceResultBytes(value, API_RESULT_BYTES);
    return value as ApiShowOutput;
  } catch (error) {
    if (error instanceof WorkspaceDiscoveryToolError) throw error;
    throw invalidResult();
  }
}

function validateShowResult(value: unknown): void {
  const base = exactRecord(value, ["status", "kind", "query"], [
    "name", "lineage", "composes", "groups", "target", "entries", "type",
    "inherited", "appendix", "declaredBy", "requestedType", "member", "owner",
    "suggestions",
  ]);
  requiredText(base["query"]);
  if (base["status"] === "not-found") {
    const missing = exactRecord(value, ["status", "kind", "query", "suggestions"], ["owner", "member"]);
    enumText(missing["kind"], ["symbol", "member"]);
    optionalText(missing["owner"]);
    optionalText(missing["member"]);
    stringValues(missing["suggestions"]);
    return;
  }
  if (base["status"] !== "found") throw invalidResult();
  switch (base["kind"]) {
    case "class": {
      const result = exactRecord(value, [
        "status", "kind", "query", "name", "lineage", "composes", "groups",
      ]);
      requiredText(result["name"]);
      stringValues(result["lineage"]);
      stringValues(result["composes"]);
      for (const group of denseArray(result["groups"])) {
        const entry = exactRecord(group, ["owner", "relation", "members"]);
        requiredText(entry["owner"]);
        relation(entry["relation"]);
        for (const member of denseArray(entry["members"])) validateApiMember(member);
      }
      return;
    }
    case "member": {
      const result = exactRecord(value, ["status", "kind", "query", "target", "entries"]);
      requiredText(result["target"]);
      for (const item of denseArray(result["entries"])) {
        const entry = exactRecord(item, ["member", "relation", "relationOwner", "appendix"]);
        validateApiMember(entry["member"]);
        relation(entry["relation"]);
        requiredText(entry["relationOwner"]);
        for (const type of denseArray(entry["appendix"])) validateApiType(type);
      }
      return;
    }
    case "type": {
      const result = exactRecord(value, ["status", "kind", "query", "type", "inherited", "appendix"]);
      validateApiType(result["type"]);
      for (const type of denseArray(result["inherited"])) validateApiType(type);
      for (const type of denseArray(result["appendix"])) validateApiType(type);
      return;
    }
    case "type-member": {
      const result = exactRecord(value, [
        "status", "kind", "query", "declaredBy", "requestedType", "member", "appendix",
      ]);
      validateApiType(result["declaredBy"]);
      validateApiType(result["requestedType"]);
      validateTypeMemberOrValue(result["member"]);
      for (const type of denseArray(result["appendix"])) validateApiType(type);
      return;
    }
    default:
      throw invalidResult();
  }
}

function validateApiMember(value: unknown): void {
  const member = exactRecord(value, [
    "packageName", "owner", "kind", "name", "signature", "summary", "example",
  ], ["readonly"]);
  enumText(member["kind"], ["method", "getter", "property", "function-property"]);
  for (const key of ["packageName", "owner", "name", "signature", "summary", "example"] as const) {
    requiredText(member[key]);
  }
  optionalBoolean(member["readonly"]);
}

function validateApiType(value: unknown): void {
  const type = exactRecord(value, ["kind", "packageName", "name", "summary"], [
    "members", "values", "definition", "extends", "aliases",
  ]);
  enumText(type["kind"], ["interface", "enum", "alias"]);
  for (const key of ["packageName", "name", "summary"] as const) requiredText(type[key]);
  if (type["members"] !== undefined) {
    for (const member of denseArray(type["members"])) validateTypeMember(member);
  }
  if (type["values"] !== undefined) {
    for (const item of denseArray(type["values"])) validateTypeValue(item);
  }
  optionalText(type["definition"]);
  optionalText(type["extends"]);
  if (type["aliases"] !== undefined) stringValues(type["aliases"]);
}

function validateTypeMemberOrValue(value: unknown): void {
  const record = exactRecord(value, ["name"], ["optional", "type", "summary", "value"]);
  if (Object.hasOwn(record, "value")) validateTypeValue(value);
  else validateTypeMember(value);
}

function validateTypeMember(value: unknown): void {
  const member = exactRecord(value, ["name", "type"], ["optional", "summary"]);
  requiredText(member["name"]);
  requiredText(member["type"]);
  optionalBoolean(member["optional"]);
  optionalText(member["summary"]);
}

function validateTypeValue(value: unknown): void {
  const item = exactRecord(value, ["name", "value"]);
  requiredText(item["name"]);
  if (typeof item["value"] !== "string") finiteNumber(item["value"]);
}

async function executeDiscoveryRead<Result>(
  owner: WorkspaceToolOwner,
  operation: ApiOperation,
  exec: ToolRunContext,
  body: (signal: AbortSignal) => Result | Promise<Result>,
): Promise<Result> {
  try {
    return await owner.run(exec, async (owned) => {
      try {
        owned.signal.throwIfAborted();
        const result = await body(owned.signal);
        if (owned.ownerSignal.aborted) throw disposing(operation);
        if (owned.callerSignal.aborted) throw cancelled(operation);
        return result;
      } catch (error) {
        throw sanitizeDiscoveryFailure(operation, error, owned);
      }
    });
  } catch (error) {
    if (error instanceof WorkspaceDiscoveryToolError) throw error;
    const fileFailure = operation === "resource export"
      ? projectWorkspaceFileEffectFailure(error, operation)
      : undefined;
    if (fileFailure !== undefined) throw fileFailure;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing(operation);
    throw operationFailed(operation);
  }
}

function sanitizeDiscoveryFailure(
  operation: ApiOperation,
  error: unknown,
  owned: WorkspaceOwnedExecution,
): Error {
  if (owned.ownerSignal.aborted) return disposing(operation);
  if (owned.callerSignal.aborted) return cancelled(operation);
  if (error instanceof WorkspaceDiscoveryToolError) return error;
  const fileFailure = operation === "resource export"
    ? projectWorkspaceFileEffectFailure(error, operation)
    : undefined;
  if (fileFailure !== undefined) return fileFailure;
  if (
    operation.startsWith("resource ")
    && isResourceLibraryError(error)
    && RESOURCE_ERROR_CODES.has(error.code)
  ) {
    return resourceFailure(operation, error.code);
  }
  return operationFailed(operation);
}

function enforceArgumentBytes(value: Record<string, unknown>, operation: ApiOperation): void {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw invalidArguments(operation);
  }
  if (bytes > ARGUMENT_BYTES) throw invalidArguments(operation);
}

function enforceResultBytes(value: unknown, maximum: number): void {
  const actual = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (actual > maximum) throw resultTooLarge(actual, maximum);
}

function boundedUniqueStrings(
  value: unknown,
  operation: ApiOperation,
  failure: WorkspaceDiscoveryToolError,
): readonly string[] {
  const values = stringValues(value, failure);
  if (
    values.length < 1
    || values.length > QUERY_ENTRIES
    || values.some((entry) => entry.trim() === "" || [...entry].length > QUERY_CHARACTERS)
    || new Set(values).size !== values.length
  ) throw invalidArguments(operation);
  return values;
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  failure: Error = invalidResult(),
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw failure;
  const allowed = new Set([...required, ...optional]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) throw failure;
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable || descriptor.value === undefined) {
      throw failure;
    }
  }
  return value;
}

function denseArray(
  value: unknown,
  failure: WorkspaceDiscoveryToolError = invalidResult(),
): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw failure;
  const own = Reflect.ownKeys(value);
  if (
    own.length !== value.length + 1
    || own.at(-1) !== "length"
    || own.slice(0, -1).some((key, index) => key !== String(index))
  ) throw failure;
  const values: unknown[] = [];
  for (const key of own.slice(0, -1) as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || !descriptor.enumerable
      || descriptor.value === undefined
    ) throw failure;
    values.push(descriptor.value);
  }
  return values;
}

function stringValues(
  value: unknown,
  failure: WorkspaceDiscoveryToolError = invalidResult(),
): readonly string[] {
  const values = denseArray(value, failure);
  if (values.some((entry) => typeof entry !== "string")) throw failure;
  return values as readonly string[];
}

function requiredText(value: unknown): asserts value is string {
  if (typeof value !== "string") throw invalidResult();
}

function nonBlankText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw invalidResult();
}

function registryId(value: unknown): asserts value is string {
  if (!validRegistryId(value)) throw invalidResult();
}

function resourceId(value: unknown): asserts value is string {
  if (!validResourceId(value)) throw invalidResult();
}

function registryIdArgument(value: unknown, failure: WorkspaceDiscoveryToolError): asserts value is string {
  if (!validRegistryId(value)) throw failure;
}

function resourceIdArgument(value: unknown, failure: WorkspaceDiscoveryToolError): asserts value is string {
  if (!validResourceId(value)) throw failure;
}

function validRegistryId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 255
    && RESOURCE_COMPONENT.test(value)
    && value !== "."
    && value !== ".."
    && !value.startsWith("-")
    && !value.includes("--");
}

function validResourceId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 251
    && RESOURCE_COMPONENT.test(value)
    && value !== "."
    && value !== "..";
}

function optionalText(value: unknown): void {
  if (value !== undefined && typeof value !== "string") throw invalidResult();
}

function optionalBoolean(value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") throw invalidResult();
}

function enumText(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) throw invalidResult();
}

function relation(value: unknown): void {
  enumText(value, ["own", "inherited", "composed"]);
}

function finiteNumber(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidResult();
}

function nonNegativeInteger(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidResult();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export class WorkspaceDiscoveryToolError extends HarnessError {}

function invalidArguments(operation: ApiOperation): WorkspaceDiscoveryToolError {
  return new WorkspaceDiscoveryToolError(
    `Workspace ${operation} arguments are invalid.`,
    "workspace-discovery-argument-invalid",
  );
}

function invalidResult(): WorkspaceDiscoveryToolError {
  return new WorkspaceDiscoveryToolError(
    "Workspace discovery returned an invalid result.",
    "workspace-discovery-result-invalid",
  );
}

function resultTooLarge(actualBytes: number, maxBytes: number): WorkspaceDiscoveryToolError {
  return new WorkspaceDiscoveryToolError(
    `Workspace discovery result is too large. ${JSON.stringify({
      actualBytes,
      maxBytes,
      guidance: "Narrow the discovery query.",
    })}`,
    "workspace-discovery-result-too-large",
  );
}

function cancelled(operation: ApiOperation): WorkspaceDiscoveryToolError {
  return new WorkspaceDiscoveryToolError(
    `Workspace ${operation} was cancelled.`,
    "workspace-operation-cancelled",
  );
}

function disposing(operation: ApiOperation): WorkspaceDiscoveryToolError {
  return new WorkspaceDiscoveryToolError(
    `Workspace ${operation} stopped because the plugin is disposing.`,
    "workspace-plugin-disposing",
  );
}

function operationFailed(operation: ApiOperation): WorkspaceDiscoveryToolError {
  return new WorkspaceDiscoveryToolError(
    `Workspace ${operation} failed.`,
    "workspace-discovery-operation-failed",
  );
}

function resourceFailure(
  operation: ApiOperation,
  code: ResourceLibraryErrorCode,
): WorkspaceDiscoveryToolError {
  return new WorkspaceDiscoveryToolError(
    `Workspace ${operation} failed with a known resource-library error.`,
    code,
  );
}

function loadInstalledResourceManifest(): unknown {
  return require("@univerjs-pro/cli-assets/manifest.json");
}

function createNoRetentionCache(): ResourceCache {
  return {
    location: "",
    read: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    clear: () => Promise.resolve({ path: "", resourceCount: 0, byteCount: 0 }),
  };
}

function requireApiReference(value: unknown): ApiReference {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as Partial<ApiReference>).find !== "function"
    || typeof (value as Partial<ApiReference>).show !== "function"
  ) throw invalidDataset();
  return value as ApiReference;
}

export class WorkspaceDiscoveryDatasetError extends HarnessError {}

function invalidDataset(): WorkspaceDiscoveryDatasetError {
  return new WorkspaceDiscoveryDatasetError(
    "Workspace discovery datasets are invalid.",
    "workspace-discovery-dataset-invalid",
  );
}
