import type { Context } from "@deepseek-ai/cordis";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import {
  defineTool,
  TOOL_ABORTED,
  type PreToolDecision,
  type ToolExecution,
  type ToolExecutionToken,
  type ToolExecutionResult,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  measureCanonicalJson,
  projectWorkspaceRenderDependencyCode,
  WorkspaceApplicationError,
  WorkspaceContentSource,
  WorkspaceRenderUnitLoader,
  WorkspaceScreenshotFeature,
  WorkspaceUnitLayoutLintFeature,
  workspaceError,
  type WorkspaceContentRuntime,
  type WorkspaceHttp,
  type WorkspaceRuntimeScope,
  type WorkspaceRuntimeTarget,
  type WorkspaceScreenshotFeatureOptions,
  type WorkspaceUnitLayoutLintFeatureOptions,
  type WorkspaceUnitType,
} from "@univerjs/univer-workspace-client-core";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectWorkspaceContentDependencyFailure,
} from "./content-tools.js";
import { WorkspaceContentRuntimeGenerations } from "./content-runtime-generation.js";
import {
  assertWorkspaceFileTransferComposition,
  currentFilesystem,
  currentPolicy,
  projectWorkspaceFileTransferDependencyFailure,
  projectWorkspaceFileEffectFailure,
  requireLocal,
  resolveContainedPath,
} from "./file-transfer.js";
import { closeWorkspaceTool } from "./space-node.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";
import {
  MAX_RENDER_CANONICAL_BYTES,
  MAX_RENDER_CANONICAL_DEPTH,
  validateWorkspaceRenderResultBudget,
} from "./render-result-budget.js";

export const MAX_RENDER_ARGUMENT_BYTES = 65_536;
export { MAX_RENDER_CANONICAL_BYTES, MAX_RENDER_CANONICAL_DEPTH } from "./render-result-budget.js";
export const MAX_SCREENSHOT_PAGES = 30;
export const MAX_LAYOUT_PAGE_SELECTORS = 10_000;
export const MAX_SCREENSHOT_PIXELS = 16_777_216;

type PageSelector = number | string;

interface BoundingBox {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

interface SheetViewportTarget {
  readonly kind: "sheet-viewport";
  readonly scale?: number;
}

interface SheetRangeTarget {
  readonly kind: "sheet-range";
  readonly range: string;
  readonly scale?: number;
  readonly sheet_name?: string;
}

interface DocPagesTarget {
  readonly kind: "doc-pages";
  readonly pages?: readonly number[];
  readonly scale?: number;
}

interface SlidePagesTarget {
  readonly contact_sheet?: {
    readonly tile?: {
      readonly columns: number;
      readonly rows: number;
    };
  };
  readonly kind: "slide-pages";
  readonly pages?: readonly PageSelector[];
  readonly scale?: number;
}

interface BoardContentTarget {
  readonly element_ids?: readonly string[];
  readonly kind: "board-content";
  readonly padding?: number;
  readonly region?: BoundingBox;
  readonly scale?: number;
}

interface BaseViewTarget {
  readonly kind: "base-view";
  readonly scale?: number;
}

export type WorkspaceScreenshotTarget =
  | BaseViewTarget
  | BoardContentTarget
  | DocPagesTarget
  | SheetRangeTarget
  | SheetViewportTarget
  | SlidePagesTarget;

export interface WorkspaceScreenshotArgs {
  readonly output_directory?: string;
  readonly scope: "trunk" | "worktree";
  readonly target?: WorkspaceScreenshotTarget;
  readonly unit_id: string;
  readonly worktree_id?: string;
}

export interface WorkspaceLayoutLintArgs {
  readonly pages?: readonly PageSelector[];
  readonly unit_id: string;
  readonly worktree_id: string;
}

export interface WorkspaceScreenshotOutput {
  readonly [key: string]: unknown;
  readonly height: number;
  readonly location: string;
  readonly mediaType: "image/png";
  readonly name: string;
  readonly width: number;
}

export interface WorkspaceScreenshotValue {
  readonly kind: "workspace-screenshot";
  readonly outputs: readonly WorkspaceScreenshotOutput[];
  readonly unitId: string;
  readonly unitType: WorkspaceUnitType;
}

export interface WorkspaceRenderToolOperations {
  readonly captureScreenshot: (input: {
    readonly signal: AbortSignal;
    readonly target: WorkspaceRuntimeTarget;
    readonly targetOptions?: WorkspaceScreenshotOperationTarget;
  }) => Promise<unknown>;
  readonly lintLayout: (input: {
    readonly pages?: readonly PageSelector[];
    readonly signal: AbortSignal;
    readonly target: WorkspaceRuntimeTarget;
  }) => Promise<unknown>;
  readonly probeTarget: (input: {
    readonly scope: WorkspaceRuntimeScope;
    readonly slidePages?: readonly PageSelector[];
    readonly unitId: string;
  }, signal: AbortSignal) => Promise<unknown>;
  readonly publishScreenshots: (input: {
    readonly directory: string;
    readonly result: unknown;
    readonly signal: AbortSignal;
  }) => Promise<readonly { readonly location: string; readonly name: string }[]>;
  readonly owner?: WorkspaceToolOwner;
}

export interface WorkspaceRenderOptions {
  readonly createRenderRuntime?: WorkspaceScreenshotFeatureOptions["createRuntime"];
  readonly createSlideLayoutRuntime?: WorkspaceUnitLayoutLintFeatureOptions["createRuntime"];
}

export interface WorkspaceRenderDependencies {
  readonly owner: WorkspaceToolOwner;
  readonly options?: WorkspaceRenderOptions;
  readonly resolveAuthenticatedHttp: (signal?: AbortSignal) => Promise<WorkspaceHttp>;
  readonly runtimes: WorkspaceContentRuntimeGenerations;
}

export interface WorkspaceRenderToolRegistration {
  dispose(): void;
  drain(): Promise<void>;
  stopAccepting(): void;
  unregister(): void;
}

interface WorkspaceRenderTargetProbe {
  readonly slidePageIdentities?: readonly WorkspaceSlidePageIdentity[];
  readonly target: WorkspaceRuntimeTarget;
}

interface WorkspaceSlidePageIdentity {
  readonly page: number;
  readonly pageId: string;
}

export type WorkspaceScreenshotOperationTarget =
  | BaseViewTarget
  | { readonly kind: "board-content"; readonly elementIds?: readonly string[]; readonly padding?: number; readonly region?: BoundingBox; readonly scale?: number }
  | DocPagesTarget
  | SheetViewportTarget
  | { readonly kind: "sheet-range"; readonly range: string; readonly scale?: number; readonly sheetName?: string }
  | { readonly contactSheet?: { readonly tile?: { readonly columns: number; readonly rows: number } }; readonly kind: "slide-pages"; readonly pages?: readonly PageSelector[]; readonly scale?: number };

const requiredString = { type: "string", required: true } as const;
const optionalString = { type: "string" } as const;
const optionalScale = { type: "number" } as const;
const pageSelectorSchema = { oneOf: [{ type: "integer" }, { type: "string" }] } as const;

const boundingBoxSchema = objectSchema({
  height: { type: "number", required: true },
  left: { type: "number", required: true },
  top: { type: "number", required: true },
  width: { type: "number", required: true },
});

const screenshotTargetSchema = {
  oneOf: [
    objectSchema({ kind: { type: "string", const: "sheet-viewport", required: true }, scale: optionalScale }),
    objectSchema({
      kind: { type: "string", const: "sheet-range", required: true },
      range: requiredString,
      scale: optionalScale,
      sheet_name: optionalString,
    }),
    objectSchema({
      kind: { type: "string", const: "doc-pages", required: true },
      pages: { type: "array", items: { type: "integer" } },
      scale: optionalScale,
    }),
    objectSchema({
      contact_sheet: objectSchema({
        tile: objectSchema({
          columns: { type: "integer", required: true },
          rows: { type: "integer", required: true },
        }),
      }),
      kind: { type: "string", const: "slide-pages", required: true },
      pages: { type: "array", items: pageSelectorSchema },
      scale: optionalScale,
    }),
    objectSchema({
      element_ids: { type: "array", items: { type: "string" } },
      kind: { type: "string", const: "board-content", required: true },
      padding: { type: "number" },
      region: boundingBoxSchema,
      scale: optionalScale,
    }),
    objectSchema({ kind: { type: "string", const: "base-view", required: true }, scale: optionalScale }),
  ],
} as const;

export const workspaceScreenshotParameters = {
  output_directory: optionalString,
  scope: { type: "string", enum: ["trunk", "worktree"], required: true },
  target: screenshotTargetSchema,
  unit_id: requiredString,
  worktree_id: optionalString,
} as const;

export const workspaceLayoutLintParameters = {
  pages: { type: "array", items: pageSelectorSchema },
  unit_id: requiredString,
  worktree_id: requiredString,
} as const;

const pointSchema = objectSchema({
  x: { type: "number", required: true },
  y: { type: "number", required: true },
});
const boardIssueSchema = objectSchema({
  bounds: requiredObject(boundingBoxSchema),
  connectorIds: { type: "array", items: { type: "string" }, required: true },
  elementIds: { type: "array", items: { type: "string" }, required: true },
  endpoint: { type: "string", enum: ["start", "end"] },
  focusBounds: requiredObject(boundingBoxSchema),
  id: requiredString,
  routePoints: { type: "array", items: pointSchema },
  rule: {
    type: "string",
    enum: [
      "element-overlap", "connector-through-element", "connector-collinear-overlap",
      "connector-crossing", "connector-free-endpoint-near-element",
      "connector-free-endpoint-near-dashed-connector", "connector-marker-target-overlap",
      "connector-marker-corner-overlap", "connector-marker-collision",
      "connector-terminal-stem-too-short", "connector-terminal-dash-discontinuity",
    ],
    required: true,
  },
  severity: { type: "string", enum: ["error", "warning"], required: true },
  suggestedAction: {
    type: "string",
    enum: ["bind-connector-endpoint", "replace-dashed-connector-with-sequence-lifeline"],
  },
});
const layoutAnalysisSchema = objectSchema({
  contentBounds: { oneOf: [boundingBoxSchema, { type: "null" }], required: true },
  issues: { type: "array", items: boardIssueSchema, required: true },
  routes: {
    type: "array",
    items: objectSchema({
      connectorId: requiredString,
      points: { type: "array", items: pointSchema, required: true },
      resolved: { type: "boolean", required: true },
    }),
    required: true,
  },
  source: { type: "string", enum: ["model", "rendered"], required: true },
  summary: requiredObject(objectSchema({
    errorCount: { type: "integer", required: true },
    unresolvedConnectorCount: { type: "integer", required: true },
    warningCount: { type: "integer", required: true },
  })),
});
const boardSelectorSchema = {
  oneOf: [
    objectSchema({ kind: { type: "string", const: "region", required: true }, region: requiredObject(boundingBoxSchema) }),
    objectSchema({ elementIds: { type: "array", items: { type: "string" }, required: true }, kind: { type: "string", const: "elements", required: true } }),
  ],
} as const;
const screenshotOutputCommon = {
  height: { type: "integer", required: true },
  location: requiredString,
  mediaType: { type: "string", const: "image/png", required: true },
  name: requiredString,
  width: { type: "integer", required: true },
} as const;
const screenshotOutputSchema = {
  oneOf: [
    objectSchema({ ...screenshotOutputCommon, range: requiredString, sheetName: optionalString }),
    objectSchema({ ...screenshotOutputCommon, page: { type: "integer", required: true }, pageId: optionalString }),
    objectSchema({
      ...screenshotOutputCommon,
      role: { type: "string", const: "contact-slide", required: true },
      tiles: { type: "integer", required: true },
    }),
    objectSchema({
      ...screenshotOutputCommon,
      boardSelector: boardSelectorSchema,
      contentBounds: requiredObject(boundingBoxSchema),
      layoutAnalysis: requiredObject(layoutAnalysisSchema),
      padding: { type: "number" },
      pageId: requiredString,
      role: { type: "string", const: "board-content", required: true },
      scale: { type: "number", required: true },
    }),
    objectSchema(screenshotOutputCommon),
  ],
} as const;
export const workspaceScreenshotOutputSchema = objectSchema({
  kind: { type: "string", const: "workspace-screenshot", required: true },
  outputs: { type: "array", items: screenshotOutputSchema, required: true },
  unitId: requiredString,
  unitType: { type: "string", enum: ["sheet", "doc", "slide", "board", "base"], required: true },
});

const lintBoxSchema = boundingBoxSchema;
const lintTextSchema = objectSchema({
  color: optionalString,
  content: requiredString,
  id: requiredString,
  ink: requiredObject(lintBoxSchema),
  opacity: { type: "number" },
});
const lintContainerSchema = objectSchema({
  box: requiredObject(lintBoxSchema),
  fill: objectSchema({ color: optionalString, opacity: { type: "number" }, type: optionalString }),
  id: requiredString,
  type: requiredString,
});
const lintFindingCommon = {
  detail: requiredString,
  fingerprint: requiredString,
  id: requiredString,
  page: { type: "integer", required: true },
  pageId: requiredString,
  severity: { type: "string", const: "warning", required: true },
  text: requiredObject(lintTextSchema),
} as const;
const lintOverflowSchema = objectSchema({
  bottom: { type: "number" },
  left: { type: "number" },
  right: { type: "number" },
  top: { type: "number" },
});
const lintFindingSchema = {
  oneOf: [
    objectSchema({
      ...lintFindingCommon,
      overflow: requiredObject(lintOverflowSchema),
      pageBox: requiredObject(lintBoxSchema),
      rule: { type: "string", const: "text-off-page", required: true },
    }),
    objectSchema({
      ...lintFindingCommon,
      container: requiredObject(lintContainerSchema),
      overflow: requiredObject(lintOverflowSchema),
      related: requiredString,
      rule: { type: "string", const: "text-escapes-container", required: true },
    }),
    objectSchema({
      ...lintFindingCommon,
      other: requiredObject(lintTextSchema),
      overlapRatio: { type: "number", required: true },
      related: requiredString,
      rule: { type: "string", const: "text-overlaps-text", required: true },
    }),
  ],
} as const;

export const workspaceLayoutLintOutputSchema = objectSchema({
  coverage: requiredObject(objectSchema({
    pages: {
      type: "array",
      items: objectSchema({ page: { type: "integer", required: true }, pageId: requiredString }),
      required: true,
    },
    rules: {
      type: "array",
      items: { type: "string", enum: ["text-off-page", "text-escapes-container", "text-overlaps-text"] },
      required: true,
    },
  })),
  findings: { type: "array", items: lintFindingSchema, required: true },
  kind: { type: "string", const: "unit-layout-lint", required: true },
  unitId: requiredString,
  unitType: { type: "string", const: "slide", required: true },
});

export const WORKSPACE_RENDER_PAGE_ROOT = fileURLToPath(new URL("./render-runtime", import.meta.url));

export function registerWorkspaceRenderTools(
  ctx: Context,
  dependencies: WorkspaceRenderDependencies,
): WorkspaceRenderToolRegistration {
  const options = dependencies.options ?? {};
  const createLoader = (runtime: WorkspaceContentRuntime) =>
    new WorkspaceRenderUnitLoader({
      runtime,
      openSource: async (signal) => new WorkspaceContentSource(
        await dependencies.resolveAuthenticatedHttp(signal),
      ),
    });
  const createScreenshot = (
    signal: AbortSignal,
    loader: WorkspaceRenderUnitLoader,
  ) =>
    new WorkspaceScreenshotFeature({
      env: process.env,
      license: dependencies.runtimes.resolveLicense(signal),
      loader,
      renderPageRoot: WORKSPACE_RENDER_PAGE_ROOT,
      ...(options.createRenderRuntime === undefined
        ? {}
        : { createRuntime: options.createRenderRuntime }),
    });
  const screenshotWriter = new WorkspaceScreenshotFeature({
    env: {},
    license: "unused",
    loader: { loadUnit: async () => { throw operationFailed(); } },
    renderPageRoot: WORKSPACE_RENDER_PAGE_ROOT,
  });
  return registerWorkspaceRenderToolFoundation(ctx, {
    owner: dependencies.owner,
    probeTarget: async (input, signal) => {
      const source = new WorkspaceContentSource(
        await dependencies.resolveAuthenticatedHttp(signal),
      );
      signal.throwIfAborted();
      const target = input.scope.kind === "trunk"
        ? await source.resolveTrunkRuntimeTarget({ unitId: input.unitId }, signal)
        : await source.resolveRuntimeTarget({
            unitId: input.unitId,
            worktreeId: input.scope.worktreeId,
          }, signal);
      signal.throwIfAborted();
      if (input.slidePages === undefined || target.unitType !== "slide") return { target };
      const slidePageIdentities = await dependencies.runtimes.run(signal, async (runtime) => {
        const unitData = await runtime.exportUnitData({ signal, target });
        signal.throwIfAborted();
        return resolveSlidePageIdentities(unitData, target.unitId, input.slidePages!);
      });
      return { slidePageIdentities, target };
    },
    captureScreenshot: async (input) => await dependencies.runtimes.run(
      input.signal,
      async (runtime) => {
        const loader = createLoader(runtime);
        const screenshot = createScreenshot(input.signal, loader);
        const unit = await loader.loadResolvedTarget({
          signal: input.signal,
          target: input.target,
        });
        input.signal.throwIfAborted();
        return await screenshot.capture({
          ...unit,
          signal: input.signal,
          ...(input.targetOptions === undefined ? {} : { target: input.targetOptions }),
        } as never);
      },
    ),
    publishScreenshots: async (input) =>
      await screenshotWriter.writeImages({
        destination: input.directory,
        result: input.result as never,
        signal: input.signal,
      }),
    lintLayout: async (input) => await dependencies.runtimes.run(
      input.signal,
      async (runtime) => {
        const loader = createLoader(runtime);
        const feature = new WorkspaceUnitLayoutLintFeature({
          env: process.env,
          license: dependencies.runtimes.resolveLicense(input.signal),
          loader,
          renderPageRoot: WORKSPACE_RENDER_PAGE_ROOT,
          ...(options.createSlideLayoutRuntime === undefined
            ? {}
            : { createRuntime: options.createSlideLayoutRuntime }),
        });
        const unit = await loader.loadResolvedTarget({
          signal: input.signal,
          target: input.target,
        });
        if (unit.unitType !== "slide") {
          throw workspaceError(
            "workspace-unit-layout-lint-unit-type-unsupported",
            `Slide layout lint requires a Slide Unit; ${input.target.unitId} is ${unit.unitType}.`,
          );
        }
        input.signal.throwIfAborted();
        return await feature.lint().lint({
          unitType: "slide",
          unitData: unit.unitData as never,
          ...(unit.formulaReferenceUnits === undefined
            ? {}
            : { formulaReferenceUnits: unit.formulaReferenceUnits }),
          signal: input.signal,
          ...(input.pages === undefined ? {} : { pages: input.pages }),
        });
      },
    ),
  });
}

function resolveSlidePageIdentities(
  unitData: unknown,
  unitId: string,
  selectors: readonly PageSelector[],
): readonly WorkspaceSlidePageIdentity[] {
  if (!isPlainRecord(unitData) || unitData["id"] !== unitId || !Array.isArray(unitData["slideOrder"])) {
    throw workspaceError(
      "workspace-screenshot-unit-data-invalid",
      "Workspace runtime exported invalid Slide UnitData.",
    );
  }
  const slideOrder = unitData["slideOrder"];
  if (
    slideOrder.length === 0
    || slideOrder.some((pageId) => !isNonBlank(pageId))
    || new Set(slideOrder).size !== slideOrder.length
  ) {
    throw workspaceError(
      "workspace-screenshot-unit-data-invalid",
      "Workspace runtime exported invalid Slide UnitData.",
    );
  }
  return selectors.map((selector) => {
    const page = typeof selector === "number" ? selector : slideOrder.indexOf(selector) + 1;
    if (!positiveInteger(page) || page > slideOrder.length) {
      throw workspaceError("INVALID_INPUT", "Slide page selector is invalid.");
    }
    return { page, pageId: slideOrder[page - 1] as string };
  });
}

export function registerWorkspaceRenderToolFoundation(
  ctx: Context,
  operations: WorkspaceRenderToolOperations,
): WorkspaceRenderToolRegistration {
  assertWorkspaceFileTransferComposition(ctx);
  const sandboxPolicy = ctx.get("sandboxPolicy") as SandboxPolicyService | undefined;
  const activeExecutions = new Map<ToolExecutionToken, {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
  }>();
  let accepting = true;
  const screenshot = closeWorkspaceTool(defineTool({
    name: "workspace_screenshot",
    description: "Capture one authoritative Workspace Unit as PNG files in an approved Host-local directory.",
    parameters: workspaceScreenshotParameters,
    output: {
      schema: workspaceScreenshotOutputSchema,
      render: (_args, value) => [{
        type: "text",
        text: `Captured ${String(value.outputs.length)} PNG file(s) for ${value.unitType} Unit ${value.unitId}.`,
      }],
    },
    finalizeContent: renderFinalizer("screenshot"),
    execute: async (args, exec) => await executeScreenshot(ctx, sandboxPolicy, operations, args, exec) as never,
  }), validateWorkspaceScreenshotArgs);
  const lint = closeWorkspaceTool(defineTool({
    name: "workspace_layout_lint",
    description: "Inspect one authoritative Workspace Worktree Slide with browser-backed layout rules.",
    parameters: workspaceLayoutLintParameters,
    output: {
      schema: workspaceLayoutLintOutputSchema,
      render: (_args, value) => [{
        type: "text",
        text: `Layout lint found ${String(value.findings.length)} issue(s) in Slide Unit ${value.unitId}.`,
      }],
    },
    finalizeContent: renderFinalizer("layout lint"),
    execute: async (args, exec) => await executeLayoutLint(operations, args, exec) as never,
  }), validateWorkspaceLayoutLintArgs);
  const registrations = [
    ctx.tools.register(screenshot),
    ctx.tools.register(lint),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (exec.name !== "workspace_screenshot") return await next();
      if (exec.signal.aborted) return await next();
      if (!accepting) throw disposing();
      if (operations.owner !== undefined) {
        let resolveCompletion!: () => void;
        const promise = new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        });
        activeExecutions.set(exec.token, { promise, resolve: resolveCompletion });
      }
      let ownedExecution: WorkspaceOwnedExecution | undefined;
      try {
        const preflight = async (signal: AbortSignal): Promise<PreToolDecision> => {
          const ownedExec = { ...exec, signal };
          const filesystem = currentFilesystem(ctx, "screenshot");
          const policy = currentPolicy(filesystem, sandboxPolicy, ownedExec, "screenshot");
          requireLocal(filesystem, "screenshot");
          const input = validateWorkspaceScreenshotArgs(exec.arguments);
          const contained = await preflightScreenshotDirectory(
            filesystem,
            policy,
            ownedExec,
            input.output_directory ?? "screenshots",
          );
          if (!contained) return await next();
          if (operations.owner === undefined) {
            return { kind: "ask", reason: SCREENSHOT_APPROVAL_REASON };
          }
          const decision = await requestScreenshotApproval(ctx, exec, signal);
          if (!accepting) throw disposing();
          return decision;
        };
        if (operations.owner === undefined) return await preflight(exec.signal);
        return await operations.owner.run(exec, async (owned) => {
          ownedExecution = owned;
          const decision = await preflight(owned.signal);
          if (owned.ownerSignal.aborted) throw disposing();
          if (owned.callerSignal.aborted) return await next();
          return decision;
        });
      } catch (error) {
        if (exec.signal.aborted) return await next();
        if (error instanceof WorkspaceRenderToolError) throw error;
        const projected = projectWorkspaceFileEffectFailure(error, "screenshot");
        if (projected !== undefined) throw projected;
        if (
          error instanceof WorkspaceOwnerNotAcceptingError
          || ownedExecution?.ownerSignal.aborted === true
        ) throw disposing();
        throw operationFailed();
      }
    }),
  ];
  const unregisterResult = ctx.root.on("tools/result", (exec) => {
    const completion = activeExecutions.get(exec.token);
    if (completion === undefined) return;
    activeExecutions.delete(exec.token);
    completion.resolve();
  });
  let registered = true;
  let resultRegistered = true;
  return {
    stopAccepting() {
      accepting = false;
    },
    unregister() {
      if (!registered) return;
      registered = false;
      for (const dispose of [...registrations].reverse()) dispose();
    },
    async drain() {
      await Promise.allSettled([...activeExecutions.values()].map(({ promise }) => promise));
    },
    dispose() {
      if (!resultRegistered) return;
      resultRegistered = false;
      unregisterResult();
    },
  };
}

const SCREENSHOT_APPROVAL_REASON = "Workspace screenshot writes PNG files to a Host-local Session directory.";

async function requestScreenshotApproval(
  ctx: Context,
  exec: ToolExecution,
  signal: AbortSignal,
): Promise<PreToolDecision> {
  const approval = ctx.get("approval");
  if (approval === undefined) {
    return { kind: "deny", reason: SCREENSHOT_APPROVAL_REASON };
  }
  if (exec.agent === undefined) {
    return {
      kind: "deny",
      reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`,
    };
  }
  const outcome: "allowed-once" | "cancelled" | "rejected" | "unavailable" = await approval.request({
    agent: exec.agent,
    callId: exec.callId,
    reason: SCREENSHOT_APPROVAL_REASON,
    signal,
    toolName: exec.name,
  });
  switch (outcome) {
    case "allowed-once": return { kind: "allow" };
    case "rejected": return { kind: "deny", reason: `the user rejected tool "${exec.name}"` };
    case "cancelled": return { kind: "deny", reason: `approval for tool "${exec.name}" was cancelled` };
    case "unavailable": return {
      kind: "deny",
      reason: `tool "${exec.name}" requires approval, but no approval channel is available`,
    };
  }
}

async function preflightScreenshotDirectory(
  filesystem: FileSystem,
  policy: SandboxExecutionPolicy | undefined,
  exec: Parameters<typeof resolveContainedPath>[2],
  path: string,
): Promise<boolean> {
  const cwd = exec.agent?.session.header.cwd;
  if (cwd === undefined) throw screenshotSessionCwdRequired();
  const root = await filesystem.resolve(cwd, { cwd, signal: exec.signal });
  if (exec.signal.aborted) return false;
  const target = await filesystem.resolve(path, { cwd, signal: exec.signal });
  if (exec.signal.aborted) return false;
  if (!filesystem.contains(root, target)) throw screenshotPathOutsideSession();
  if (policy?.mode === "workspace-write") {
    const policyRoot = await filesystem.resolve(policy.workspaceRoot, { cwd, signal: exec.signal });
    if (exec.signal.aborted) return false;
    if (!filesystem.contains(policyRoot, target)) throw screenshotPathOutsideSession();
  }
  return true;
}

export function validateWorkspaceScreenshotArgs(value: unknown): WorkspaceScreenshotArgs {
  const record = exactRecord(value, ["scope", "unit_id"], ["output_directory", "target", "worktree_id"]);
  const scope = stringProperty(record, "scope");
  if (scope !== "trunk" && scope !== "worktree") throw invalidArguments();
  const worktreeId = optionalNonBlank(record, "worktree_id");
  if ((scope === "trunk" && worktreeId !== undefined) || (scope === "worktree" && worktreeId === undefined)) {
    throw invalidArguments();
  }
  const targetValue = dataProperty(record, "target");
  const target = targetValue === undefined ? undefined : parseTargetShape(targetValue);
  const outputDirectory = optionalNonBlank(record, "output_directory");
  const result: WorkspaceScreenshotArgs = {
    scope,
    unit_id: nonBlank(record, "unit_id"),
    ...(worktreeId === undefined ? {} : { worktree_id: worktreeId }),
    ...(outputDirectory === undefined ? {} : { output_directory: outputDirectory }),
    ...(target === undefined ? {} : { target }),
  };
  validateArgumentBudget(result);
  if (target !== undefined) validateTargetSemantics(target);
  return result;
}

export function validateWorkspaceLayoutLintArgs(value: unknown): WorkspaceLayoutLintArgs {
  const record = exactRecord(value, ["unit_id", "worktree_id"], ["pages"]);
  const pagesValue = dataProperty(record, "pages");
  const pages = pagesValue === undefined ? undefined : pageSelectors(pagesValue, false);
  const result: WorkspaceLayoutLintArgs = {
    unit_id: nonBlank(record, "unit_id"),
    worktree_id: nonBlank(record, "worktree_id"),
    ...(pages === undefined ? {} : { pages }),
  };
  validateArgumentBudget(result);
  if (pages !== undefined) {
    if (pages.length === 0) throw invalidArguments();
    if (pages.length > MAX_LAYOUT_PAGE_SELECTORS) throw limitExceeded("layout-page-selectors", MAX_LAYOUT_PAGE_SELECTORS, pages.length);
    validatePageSelectors(pages);
  }
  return result;
}

export function validateWorkspaceScreenshotCapture(
  directory: string,
  target: WorkspaceRuntimeTarget,
  value: unknown,
  targetOptions?: WorkspaceScreenshotOperationTarget,
  slidePageIdentities?: readonly WorkspaceSlidePageIdentity[],
): WorkspaceScreenshotValue {
  if (!isAbsolute(directory) || resolve(directory) !== directory) throw invalidOutput();
  const record = exactRecord(value, ["images", "unitId", "unitType"], [], invalidOutput);
  if (dataProperty(record, "unitId") !== target.unitId || dataProperty(record, "unitType") !== target.unitType) {
    throw invalidOutput();
  }
  const images = arrayProperty(record, "images", invalidOutput);
  if (images.length === 0) throw invalidOutput();
  const names = new Set<string>();
  const outputs = images.map((image) => projectScreenshotImage(directory, image, names));
  const result: WorkspaceScreenshotValue = {
    kind: "workspace-screenshot",
    outputs,
    unitId: target.unitId,
    unitType: target.unitType,
  };
  validateScreenshotOutputKinds(target.unitType, outputs, targetOptions, slidePageIdentities);
  validateWorkspaceScreenshotResultBudget(result);
  return result;
}

export function validateWorkspaceLayoutLintResult(
  target: WorkspaceRuntimeTarget,
  value: unknown,
  requestedSlidePages?: readonly WorkspaceSlidePageIdentity[],
): void {
  const record = exactRecord(value, ["coverage", "findings", "kind", "unitId", "unitType"], [], invalidLintResult);
  if (
    dataProperty(record, "kind") !== "unit-layout-lint"
    || dataProperty(record, "unitId") !== target.unitId
    || dataProperty(record, "unitType") !== "slide"
  ) throw invalidLintResult();
  const coverage = exactRecord(dataProperty(record, "coverage"), ["pages", "rules"], [], invalidLintResult);
  const pages = arrayProperty(coverage, "pages", invalidLintResult);
  const covered = new Set<string>();
  const coveredPageIds = new Set<string>();
  const coveredPageNumbers = new Set<number>();
  for (const page of pages) {
    const item = exactRecord(page, ["page", "pageId"], [], invalidLintResult);
    const pageNumber = dataProperty(item, "page");
    const pageId = dataProperty(item, "pageId");
    if (
      !positiveInteger(pageNumber)
      || !isNonBlank(pageId)
      || coveredPageNumbers.has(pageNumber)
      || coveredPageIds.has(pageId)
    ) throw invalidLintResult();
    coveredPageNumbers.add(pageNumber);
    coveredPageIds.add(pageId);
    const identity = `${String(pageNumber)}\0${pageId}`;
    if (covered.has(identity)) throw invalidLintResult();
    covered.add(identity);
  }
  if (requestedSlidePages !== undefined) {
    const canonical = canonicalSlideCoverage(requestedSlidePages);
    if (
      pages.length !== canonical.length
      || pages.some((page, index) => (
        dataProperty(page as object, "page") !== canonical[index]!.page
        || dataProperty(page as object, "pageId") !== canonical[index]!.pageId
      ))
    ) throw invalidLintResult();
  }
  const rules = arrayProperty(coverage, "rules", invalidLintResult);
  if (rules.length !== layoutRuleOrder.length || rules.some((rule, index) => rule !== layoutRuleOrder[index])) {
    throw invalidLintResult();
  }
  const findings = arrayProperty(record, "findings", invalidLintResult);
  const fingerprints = findings.map((finding) => validateFinding(finding, covered));
  if (fingerprints.some((fingerprint, index) => index > 0 && fingerprints[index - 1]!.localeCompare(fingerprint) >= 0)) {
    throw invalidLintResult();
  }
  validateResultBudget(value, invalidLintResult);
}

export function validateWorkspaceScreenshotResultBudget(value: unknown): void {
  validateResultBudget(value, invalidOutput);
}

async function executeScreenshot(
  ctx: Context,
  sandboxPolicy: SandboxPolicyService | undefined,
  operations: WorkspaceRenderToolOperations,
  raw: unknown,
  exec: ToolRunContext,
): Promise<WorkspaceScreenshotValue> {
  return await executeRenderOwned(operations.owner, exec, async (owned) => {
    try {
      const args = validateWorkspaceScreenshotArgs(raw);
      const directory = await resolveScreenshotDirectory(ctx, sandboxPolicy, args, exec, owned.signal);
      const scope = screenshotScope(args);
      const requestedSlidePages = args.target?.kind === "slide-pages" ? args.target.pages : undefined;
      const probe = validateRenderTargetProbe(
        await operations.probeTarget({
          scope,
          unitId: args.unit_id,
          ...(requestedSlidePages === undefined ? {} : { slidePages: requestedSlidePages }),
        }, owned.signal),
        scope,
        args.unit_id,
        requestedSlidePages,
      );
      const { target } = probe;
      requireTargetCompatibility(target.unitType, args.target);
      validateResolvedSlideSelection(args.target, probe.slidePageIdentities);
      const targetOptions = args.target === undefined ? undefined : toOperationTarget(args.target);
      const capture = await operations.captureScreenshot({
        signal: owned.signal,
        target,
        ...(targetOptions === undefined ? {} : { targetOptions }),
      });
      const result = validateWorkspaceScreenshotCapture(
        directory,
        target,
        capture,
        targetOptions,
        probe.slidePageIdentities,
      );
      let written: readonly { readonly location: string; readonly name: string }[];
      try {
        written = await operations.publishScreenshots({
          directory,
          result: capture,
          signal: owned.signal,
        });
      } catch (error) {
        throw projectScreenshotPublicationFailure(error, owned, result);
      }
      if (
        written.length !== result.outputs.length
        || written.some((output, index) => output.name !== result.outputs[index]!.name || output.location !== result.outputs[index]!.location)
      ) throw invalidOutput();
      return result;
    } catch (error) {
      throw projectRenderFailure(error, owned);
    }
  });
}

async function resolveScreenshotDirectory(
  ctx: Context,
  sandboxPolicy: SandboxPolicyService | undefined,
  args: WorkspaceScreenshotArgs,
  exec: ToolRunContext,
  signal: AbortSignal,
): Promise<string> {
  const filesystem = currentFilesystem(ctx, "screenshot");
  const policy = currentPolicy(filesystem, sandboxPolicy, exec, "screenshot");
  requireLocal(filesystem, "screenshot");
  const directory = await resolveContainedPath(
    filesystem,
    policy,
    exec,
    args.output_directory ?? "screenshots",
    "screenshot",
    signal,
  );
  signal.throwIfAborted();
  return filesystem.processPath(directory);
}

async function executeLayoutLint(
  operations: WorkspaceRenderToolOperations,
  raw: unknown,
  exec: ToolRunContext,
): Promise<unknown> {
  return await executeRenderOwned(operations.owner, exec, async (owned) => {
    try {
      const args = validateWorkspaceLayoutLintArgs(raw);
      const scope = { kind: "worktree", worktreeId: args.worktree_id } as const;
      const probe = validateRenderTargetProbe(
        await operations.probeTarget({
          scope,
          unitId: args.unit_id,
          ...(args.pages === undefined ? {} : { slidePages: args.pages }),
        }, owned.signal),
        scope,
        args.unit_id,
        args.pages,
      );
      const { target } = probe;
      if (target.unitType !== "slide") throw lintUnitTypeUnsupported();
      const result = await operations.lintLayout({
        signal: owned.signal,
        target,
        ...(args.pages === undefined ? {} : { pages: args.pages }),
      });
      validateWorkspaceLayoutLintResult(target, result, probe.slidePageIdentities);
      return result;
    } catch (error) {
      throw projectRenderFailure(error, owned);
    }
  });
}

async function executeRenderOwned<Result>(
  owner: WorkspaceToolOwner | undefined,
  exec: ToolRunContext,
  body: (owned: WorkspaceOwnedExecution) => Promise<Result>,
): Promise<Result> {
  try {
    if (owner !== undefined) return await owner.run(exec, body);
    return await body({
      callerSignal: exec.signal,
      ownerSignal: new AbortController().signal,
      signal: exec.signal,
    });
  } catch (error) {
    if (error instanceof WorkspaceRenderToolError) throw error;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing();
    throw operationFailed();
  }
}

function projectRenderFailure(
  error: unknown,
  owned: WorkspaceOwnedExecution,
): WorkspaceRenderToolError {
  if (error instanceof WorkspaceRenderToolError) return error;
  const projected = projectRenderDependencyFailure(error);
  if (owned.ownerSignal.aborted) return disposing();
  if (owned.callerSignal.aborted) return cancelled();
  return projected === undefined
    ? operationFailed()
    : renderFailure(projected.code, projected.detail);
}

function projectScreenshotPublicationFailure(
  error: unknown,
  owned: WorkspaceOwnedExecution,
  candidate: WorkspaceScreenshotValue,
): WorkspaceRenderToolError {
  if (
    error instanceof WorkspaceApplicationError
    && error.code === "workspace-screenshot-output-partial"
  ) {
    const detail = projectPartialOutput(error.detail, candidate);
    return detail === undefined
      ? operationFailed()
      : renderFailure(error.code, detail);
  }
  return projectRenderFailure(error, owned);
}

function projectRenderDependencyFailure(
  error: unknown,
): { readonly code: string; readonly detail?: Record<string, unknown> } | undefined {
  if (error instanceof WorkspaceApplicationError && workspaceApplicationRenderCodes.has(error.code)) {
    if (error.code === "workspace-screenshot-output-partial") return undefined;
    const detail = projectRenderDetail(error.code, error.detail);
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  const dependencyCode = projectWorkspaceRenderDependencyCode(error);
  if (dependencyCode !== undefined) {
    if (!renderCodes.has(dependencyCode)) return undefined;
    return {
      code: dependencyCode,
      ...(dependencyCode === "BROWSER_UNAVAILABLE"
        ? { detail: { guidance: "Configure UNIVER_RENDER_BROWSER or install a supported browser before retrying." } }
        : {}),
    };
  }
  const inherited = projectWorkspaceFileTransferDependencyFailure(error)
    ?? projectWorkspaceContentDependencyFailure(error);
  if (inherited === undefined) return undefined;
  const detail = projectInheritedRenderDetail(inherited.detail);
  return { code: inherited.code, ...(detail === undefined ? {} : { detail }) };
}

function projectRenderDetail(
  code: string,
  value: unknown,
): Record<string, unknown> | undefined {
  if (code === "BROWSER_UNAVAILABLE") {
    return { guidance: "Configure UNIVER_RENDER_BROWSER or install a supported browser before retrying." };
  }
  return projectInheritedRenderDetail(value);
}

function projectPartialOutput(
  value: unknown,
  candidate: WorkspaceScreenshotValue,
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, [
    "causeCode", "committedOutputCount", "committedOutputs", "totalOutputCount",
  ])) return undefined;
  const totalOutputCount = value["totalOutputCount"];
  const committedOutputCount = value["committedOutputCount"];
  const causeCode = value["causeCode"];
  const outputs = value["committedOutputs"];
  if (
    totalOutputCount !== candidate.outputs.length
    || !positiveInteger(committedOutputCount)
    || committedOutputCount > totalOutputCount
    || !new Set([
      "ABORTED", "workspace-screenshot-output-exists", "workspace-screenshot-output-failed",
    ]).has(causeCode as string)
    || !Array.isArray(outputs)
    || outputs.length !== committedOutputCount
  ) return undefined;
  const committedOutputs: Array<{ readonly location: string; readonly name: string }> = [];
  for (const [index, output] of outputs.entries()) {
    const expected = candidate.outputs[index];
    if (
      expected === undefined
      || !isPlainRecord(output)
      || !hasExactDataKeys(output, ["location", "name"])
      || output["location"] !== expected.location
      || output["name"] !== expected.name
    ) return undefined;
    committedOutputs.push({ location: expected.location, name: expected.name });
  }
  return { causeCode, committedOutputCount, committedOutputs, totalOutputCount };
}

function projectInheritedRenderDetail(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of ["assetId", "nodeId", "resourceId", "unitId", "worktreeId"] as const) {
    if (isNonBlank(value[key])) result[key] = value[key];
  }
  for (const key of [
    "actual", "actualByteSize", "baseRevision", "byteSize", "expectedByteSize", "limit",
    "observedRevision", "revision", "selectedRevision",
  ] as const) {
    if (nonNegativeInteger(value[key])) result[key] = value[key];
  }
  for (const key of ["actualUnitType", "supportedUnitType", "unitType"] as const) {
    if (unitTypes.has(value[key])) result[key] = value[key];
  }
  if (typeof value["kind"] === "string" && renderLimitKinds.has(value["kind"])) {
    result["kind"] = value["kind"];
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function hasExactDataKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
    });
}

function renderFinalizer(operation: "layout lint" | "screenshot") {
  return (_exec: unknown, result: Readonly<ToolExecutionResult>) => {
    if (!result.isError) return undefined;
    const code = result.error.info?.code;
    if (
      code !== TOOL_ABORTED
      && code !== "workspace-operation-cancelled"
      && code !== "workspace-screenshot-output-partial"
    ) return undefined;
    return [{
      type: "text" as const,
      text: operation === "screenshot"
        ? "Workspace screenshot output may exist. Inspect the approved output directory and any listed committed files before deciding on a deliberate retry. Never recapture or retry automatically."
        : "Workspace layout lint may have completed. Inspect the current Unit before deciding on a deliberate retry. Never rerun it automatically.",
    }];
  };
}

function parseTargetShape(value: unknown): WorkspaceScreenshotTarget {
  const shape = exactRecord(value, ["kind"], [
    "contact_sheet", "element_ids", "padding", "pages", "range", "region", "scale", "sheet_name",
  ]);
  const kind = stringProperty(shape, "kind");
  switch (kind) {
    case "sheet-viewport": {
      const record = exactRecord(value, ["kind"], ["scale"]);
      return simpleScaleTarget(record, kind);
    }
    case "sheet-range": {
      const record = exactRecord(value, ["kind", "range"], ["scale", "sheet_name"]);
      return {
        kind,
        range: stringProperty(record, "range"),
        ...optionalScaleValue(record),
        ...optionalNonBlankValue(record, "sheet_name"),
      };
    }
    case "doc-pages": {
      const record = exactRecord(value, ["kind"], ["pages", "scale"]);
      const pages = optionalPageSelectors(record, true);
      return { kind, ...(pages === undefined ? {} : { pages: pages as readonly number[] }), ...optionalScaleValue(record) };
    }
    case "slide-pages": {
      const record = exactRecord(value, ["kind"], ["contact_sheet", "pages", "scale"]);
      const pages = optionalPageSelectors(record, false);
      const contact = dataProperty(record, "contact_sheet");
      return {
        kind,
        ...(pages === undefined ? {} : { pages }),
        ...(contact === undefined ? {} : { contact_sheet: parseContactSheet(contact) }),
        ...optionalScaleValue(record),
      };
    }
    case "board-content": {
      const record = exactRecord(value, ["kind"], ["element_ids", "padding", "region", "scale"]);
      const elementIdsValue = dataProperty(record, "element_ids");
      const regionValue = dataProperty(record, "region");
      const padding = dataProperty(record, "padding");
      const elementIds = elementIdsValue === undefined ? undefined : stringArray(elementIdsValue);
      const region = regionValue === undefined ? undefined : parseBoundingBox(regionValue);
      if (padding !== undefined && typeof padding !== "number") throw invalidArguments();
      return {
        kind,
        ...(elementIds === undefined ? {} : { element_ids: elementIds }),
        ...(region === undefined ? {} : { region }),
        ...(padding === undefined ? {} : { padding }),
        ...optionalScaleValue(record),
      };
    }
    case "base-view": {
      const record = exactRecord(value, ["kind"], ["scale"]);
      return simpleScaleTarget(record, kind);
    }
    default:
      throw invalidArguments();
  }
}

function toOperationTarget(target: WorkspaceScreenshotTarget): WorkspaceScreenshotOperationTarget {
  if (target.kind === "sheet-range") {
    const { sheet_name: sheetName, ...rest } = target;
    return { ...rest, ...(sheetName === undefined ? {} : { sheetName }) };
  }
  if (target.kind === "slide-pages") {
    const { contact_sheet: contactSheet, ...rest } = target;
    return { ...rest, ...(contactSheet === undefined ? {} : { contactSheet }) };
  }
  if (target.kind === "board-content") {
    const { element_ids: elementIds, ...rest } = target;
    return { ...rest, ...(elementIds === undefined ? {} : { elementIds }) };
  }
  return target;
}

function validateTargetSemantics(target: WorkspaceScreenshotTarget): void {
  validateScale(target.scale);
  switch (target.kind) {
    case "sheet-range":
      if (!validA1Range(target.range) || (target.sheet_name !== undefined && !isNonBlank(target.sheet_name))) throw invalidArguments();
      break;
    case "doc-pages":
    case "slide-pages":
      if (target.pages !== undefined) {
        if (target.pages.length === 0) throw invalidArguments();
        const numericPages = new Set(target.pages.filter((page): page is number => typeof page === "number"));
        const pageIds = new Set(target.pages.filter((page): page is string => typeof page === "string"));
        const knownPageCount = Math.max(numericPages.size, pageIds.size);
        if (knownPageCount > MAX_SCREENSHOT_PAGES) {
          throw limitExceeded("screenshot-pages", MAX_SCREENSHOT_PAGES, knownPageCount);
        }
        validatePageSelectors(target.pages);
      }
      if (target.kind === "slide-pages" && target.contact_sheet?.tile !== undefined) {
        const { columns, rows } = target.contact_sheet.tile;
        if (!positiveInteger(columns) || !positiveInteger(rows)) throw invalidArguments();
        if (
          target.pages?.every((page) => typeof page === "number") === true
          && columns * rows < new Set(target.pages).size
        ) throw invalidArguments();
      }
      break;
    case "board-content": {
      const selected = target.element_ids !== undefined || target.region !== undefined;
      if (target.element_ids !== undefined && target.region !== undefined) throw invalidArguments();
      if (!selected && (target.padding !== undefined || target.scale !== undefined)) throw invalidArguments();
      if (target.element_ids !== undefined && (target.element_ids.length === 0 || target.element_ids.some((id) => !isNonBlank(id)))) throw invalidArguments();
      if (target.region !== undefined) validateBoundingBox(target.region, invalidArguments);
      if (target.padding !== undefined && (!Number.isFinite(target.padding) || target.padding < 0)) throw invalidArguments();
      break;
    }
  }
}

function validateResolvedSlideSelection(
  target: WorkspaceScreenshotTarget | undefined,
  slidePageIdentities: readonly WorkspaceSlidePageIdentity[] | undefined,
): void {
  if (target?.kind !== "slide-pages" || target.pages === undefined || slidePageIdentities === undefined) return;
  const pageCount = new Set(slidePageIdentities.map(({ page }) => page)).size;
  if (pageCount > MAX_SCREENSHOT_PAGES) {
    throw limitExceeded("screenshot-pages", MAX_SCREENSHOT_PAGES, pageCount);
  }
  if (
    target.contact_sheet?.tile !== undefined
    && target.contact_sheet.tile.columns * target.contact_sheet.tile.rows < pageCount
  ) throw invalidArguments();
}

function projectScreenshotImage(
  directory: string,
  value: unknown,
  names: Set<string>,
): WorkspaceScreenshotOutput {
  const record = exactRecord(value, ["bytes", "height", "mediaType", "name", "width"], [
    "boardSelector", "contentBounds", "layoutAnalysis", "padding", "page", "pageId", "range",
    "role", "scale", "sheetName", "tiles",
  ], invalidOutput);
  const name = dataProperty(record, "name");
  const bytes = dataProperty(record, "bytes");
  const height = dataProperty(record, "height");
  const width = dataProperty(record, "width");
  if (
    !isNonBlank(name)
    || basename(name) !== name
    || name === "."
    || name === ".."
    || names.has(name)
    || !(bytes instanceof Uint8Array)
    || !positiveInteger(width)
    || !positiveInteger(height)
    || dataProperty(record, "mediaType") !== "image/png"
  ) throw invalidOutput();
  if (width * height > MAX_SCREENSHOT_PIXELS) {
    throw new WorkspaceRenderToolError("Workspace screenshot exceeded the SDK pixel limit.", "PIXEL_LIMIT_EXCEEDED");
  }
  names.add(name);
  const output: Record<string, unknown> = {
    height,
    location: join(directory, name),
    mediaType: "image/png",
    name,
    width,
  };
  for (const key of ["page", "tiles"] as const) {
    const item = dataProperty(record, key);
    if (item !== undefined) {
      if (!positiveInteger(item)) throw invalidOutput();
      output[key] = item;
    }
  }
  for (const key of ["pageId", "range", "sheetName"] as const) {
    const item = dataProperty(record, key);
    if (item !== undefined) {
      if (!isNonBlank(item)) throw invalidOutput();
      if (key === "range" && !validA1Range(item)) throw invalidOutput();
      output[key] = item;
    }
  }
  const role = dataProperty(record, "role");
  if (role !== undefined) {
    if (role !== "board-content" && role !== "contact-slide") throw invalidOutput();
    output["role"] = role;
  }
  const scale = dataProperty(record, "scale");
  if (scale !== undefined) {
    validateScale(scale, invalidOutput);
    output["scale"] = scale;
  }
  const padding = dataProperty(record, "padding");
  if (padding !== undefined) {
    if (typeof padding !== "number" || !Number.isFinite(padding) || padding < 0) throw invalidOutput();
    output["padding"] = padding;
  }
  const contentBounds = dataProperty(record, "contentBounds");
  if (contentBounds !== undefined) output["contentBounds"] = validatedBoundingBox(contentBounds, invalidOutput);
  const boardSelector = dataProperty(record, "boardSelector");
  if (boardSelector !== undefined) output["boardSelector"] = validateBoardSelector(boardSelector);
  const analysis = dataProperty(record, "layoutAnalysis");
  if (analysis !== undefined) {
    validateBoardLayoutAnalysis(analysis);
    output["layoutAnalysis"] = analysis;
  }
  return output as WorkspaceScreenshotOutput;
}

function validateScreenshotOutputKinds(
  unitType: WorkspaceUnitType,
  outputs: readonly WorkspaceScreenshotOutput[],
  target?: WorkspaceScreenshotOperationTarget,
  slidePageIdentities?: readonly WorkspaceSlidePageIdentity[],
): void {
  const common = new Set(["height", "location", "mediaType", "name", "width"]);
  const exact = (output: WorkspaceScreenshotOutput, required: readonly string[], optional: readonly string[] = []) => {
    const keys = Object.keys(output);
    const allowed = new Set([...common, ...required, ...optional]);
    if (required.some((key) => !Object.hasOwn(output, key)) || keys.some((key) => !allowed.has(key))) throw invalidOutput();
  };
  if (unitType === "sheet") {
    if (outputs.length !== 1) throw invalidOutput();
    exact(outputs[0]!, ["range"], ["sheetName"]);
    if (target?.kind === "sheet-range") {
      if (
        outputs[0]!["range"] !== canonicalA1Range(target.range)
        || outputs[0]!["sheetName"] !== target.sheetName
      ) throw invalidOutput();
    }
    return;
  }
  if (unitType === "doc") {
    if (outputs.length > MAX_SCREENSHOT_PAGES) throw invalidOutput();
    for (const output of outputs) exact(output, ["page"]);
    const pages = outputs.map((output) => output["page"]);
    if (new Set(pages).size !== pages.length) throw invalidOutput();
    if (target?.kind === "doc-pages" && target.pages !== undefined) {
      const requested = [...new Set(target.pages)];
      if (pages.length !== requested.length || pages.some((page, index) => page !== requested[index])) throw invalidOutput();
    }
    return;
  }
  if (unitType === "slide") {
    const contact = outputs.filter((output) => output["role"] === "contact-slide");
    const pages = outputs.filter((output) => output["role"] !== "contact-slide");
    if (pages.length === 0 || pages.length > MAX_SCREENSHOT_PAGES || contact.length > 1) throw invalidOutput();
    for (const output of pages) exact(output, ["page"], ["pageId"]);
    for (const output of contact) exact(output, ["role", "tiles"]);
    const pageNumbers = pages.map((output) => output["page"]);
    const pageIds = pages.flatMap((output) => typeof output["pageId"] === "string" ? [output["pageId"]] : []);
    if (new Set(pageNumbers).size !== pageNumbers.length || new Set(pageIds).size !== pageIds.length) throw invalidOutput();
    const requested = target?.kind === "slide-pages" && target.contactSheet !== undefined;
    if (contact.length !== (requested ? 1 : 0)) throw invalidOutput();
    if (contact[0]?.["tiles"] !== undefined && contact[0]["tiles"] !== pages.length) throw invalidOutput();
    if (target?.kind === "slide-pages" && target.pages !== undefined) {
      if (slidePageIdentities === undefined) throw invalidOutput();
      validateSlidePageIdentities(slidePageIdentities.map(({ page }) => page), pages);
    } else if (slidePageIdentities !== undefined) {
      throw invalidOutput();
    }
    return;
  }
  if (unitType === "board") {
    if (outputs.length !== 1) throw invalidOutput();
    exact(outputs[0]!, ["contentBounds", "layoutAnalysis", "pageId", "role", "scale"], ["boardSelector", "padding"]);
    if (outputs[0]!["role"] !== "board-content") throw invalidOutput();
    validateBoardOutputIdentity(outputs[0]!, target);
    return;
  }
  if (outputs.length !== 1) throw invalidOutput();
  exact(outputs[0]!, []);
}

function validateBoardOutputIdentity(
  output: WorkspaceScreenshotOutput,
  target?: WorkspaceScreenshotOperationTarget,
): void {
  const boardTarget = target?.kind === "board-content" ? target : undefined;
  const selector = output["boardSelector"];
  if (boardTarget?.region !== undefined) {
    if (!isPlainRecord(selector) || dataProperty(selector, "kind") !== "region") throw invalidOutput();
    const actual = dataProperty(selector, "region") as BoundingBox;
    if (
      actual.height !== boardTarget.region.height
      || actual.left !== boardTarget.region.left
      || actual.top !== boardTarget.region.top
      || actual.width !== boardTarget.region.width
    ) throw invalidOutput();
  } else if (boardTarget?.elementIds !== undefined) {
    if (!isPlainRecord(selector) || dataProperty(selector, "kind") !== "elements") throw invalidOutput();
    const actual = dataProperty(selector, "elementIds");
    if (!Array.isArray(actual) || actual.length !== boardTarget.elementIds.length || actual.some((id, index) => id !== boardTarget.elementIds![index])) throw invalidOutput();
  } else if (selector !== undefined) {
    throw invalidOutput();
  }
  if (output["padding"] !== boardTarget?.padding || output["scale"] !== (boardTarget?.scale ?? 1)) throw invalidOutput();
}

function validateSlidePageIdentities(
  requestedPageNumbers: readonly number[],
  outputs: readonly WorkspaceScreenshotOutput[],
): void {
  const firstUseOrder = [...new Set(requestedPageNumbers)];
  if (
    firstUseOrder.length !== outputs.length
    || firstUseOrder.some((page, index) => outputs[index]!["page"] !== page)
  ) throw invalidOutput();
}

function canonicalSlideCoverage(
  requested: readonly WorkspaceSlidePageIdentity[],
): readonly WorkspaceSlidePageIdentity[] {
  const seen = new Set<string>();
  return requested.filter(({ pageId }) => {
    if (seen.has(pageId)) return false;
    seen.add(pageId);
    return true;
  });
}

function validateBoardSelector(value: unknown): unknown {
  const record = exactRecord(value, ["kind"], ["elementIds", "region"], invalidOutput);
  const kind = dataProperty(record, "kind");
  if (kind === "region") {
    if (Object.hasOwn(record, "elementIds")) throw invalidOutput();
    return { kind, region: validatedBoundingBox(dataProperty(record, "region"), invalidOutput) };
  }
  if (kind === "elements") {
    if (Object.hasOwn(record, "region")) throw invalidOutput();
    const elementIds = stringArray(dataProperty(record, "elementIds"), invalidOutput);
    if (elementIds.length === 0 || elementIds.some((id) => !isNonBlank(id))) throw invalidOutput();
    return { elementIds, kind };
  }
  throw invalidOutput();
}

function validateBoardLayoutAnalysis(value: unknown): void {
  const record = exactRecord(value, ["contentBounds", "issues", "routes", "source", "summary"], [], invalidOutput);
  const bounds = dataProperty(record, "contentBounds");
  if (bounds !== null) validatedBoundingBox(bounds, invalidOutput);
  if (dataProperty(record, "source") !== "model" && dataProperty(record, "source") !== "rendered") throw invalidOutput();
  const summary = exactRecord(dataProperty(record, "summary"), ["errorCount", "unresolvedConnectorCount", "warningCount"], [], invalidOutput);
  for (const key of ["errorCount", "unresolvedConnectorCount", "warningCount"] as const) {
    if (!nonNegativeInteger(dataProperty(summary, key))) throw invalidOutput();
  }
  for (const route of arrayProperty(record, "routes", invalidOutput)) {
    const item = exactRecord(route, ["connectorId", "points", "resolved"], [], invalidOutput);
    if (!isNonBlank(dataProperty(item, "connectorId")) || typeof dataProperty(item, "resolved") !== "boolean") throw invalidOutput();
    validatePoints(dataProperty(item, "points"));
  }
  for (const issue of arrayProperty(record, "issues", invalidOutput)) validateBoardIssue(issue);
}

function validateBoardIssue(value: unknown): void {
  const record = exactRecord(value, [
    "bounds", "connectorIds", "elementIds", "focusBounds", "id", "rule", "severity",
  ], ["endpoint", "routePoints", "suggestedAction"], invalidOutput);
  validatedBoundingBox(dataProperty(record, "bounds"), invalidOutput);
  validatedBoundingBox(dataProperty(record, "focusBounds"), invalidOutput);
  if (!isNonBlank(dataProperty(record, "id"))) throw invalidOutput();
  for (const key of ["connectorIds", "elementIds"] as const) {
    const ids = stringArray(dataProperty(record, key), invalidOutput);
    if (ids.some((id) => !isNonBlank(id))) throw invalidOutput();
  }
  if (!boardIssueRules.has(dataProperty(record, "rule")) || !boardSeverities.has(dataProperty(record, "severity"))) throw invalidOutput();
  const endpoint = dataProperty(record, "endpoint");
  if (endpoint !== undefined && endpoint !== "start" && endpoint !== "end") throw invalidOutput();
  const action = dataProperty(record, "suggestedAction");
  if (action !== undefined && !boardActions.has(action)) throw invalidOutput();
  const points = dataProperty(record, "routePoints");
  if (points !== undefined) validatePoints(points);
}

function validateFinding(value: unknown, covered: ReadonlySet<string>): string {
  const shape = exactRecord(value, [
    "detail", "fingerprint", "id", "page", "pageId", "rule", "severity", "text",
  ], ["container", "other", "overflow", "overlapRatio", "pageBox", "related"], invalidLintResult);
  const rule = dataProperty(shape, "rule");
  const record = rule === "text-off-page"
    ? exactRecord(value, [
      "detail", "fingerprint", "id", "overflow", "page", "pageBox", "pageId", "rule", "severity", "text",
    ], [], invalidLintResult)
    : rule === "text-escapes-container"
    ? exactRecord(value, [
      "container", "detail", "fingerprint", "id", "overflow", "page", "pageId", "related", "rule", "severity", "text",
    ], [], invalidLintResult)
    : rule === "text-overlaps-text"
    ? exactRecord(value, [
      "detail", "fingerprint", "id", "other", "overlapRatio", "page", "pageId", "related", "rule", "severity", "text",
    ], [], invalidLintResult)
    : (() => { throw invalidLintResult(); })();
  for (const key of ["detail", "fingerprint", "id", "pageId"] as const) {
    if (!isNonBlank(dataProperty(record, key))) throw invalidLintResult();
  }
  const page = dataProperty(record, "page");
  const pageId = dataProperty(record, "pageId");
  const id = dataProperty(record, "id") as string;
  if (!positiveInteger(page) || !covered.has(`${String(page)}\0${String(pageId)}`)) throw invalidLintResult();
  if (dataProperty(record, "severity") !== "warning") throw invalidLintResult();
  if (validateLintText(dataProperty(record, "text")) !== id) throw invalidLintResult();
  let related = "";
  if (rule === "text-off-page") {
    validatedBoundingBox(dataProperty(record, "pageBox"), invalidLintResult);
    validateOverflow(dataProperty(record, "overflow"));
  } else if (rule === "text-escapes-container") {
    related = dataProperty(record, "related") as string;
    if (validateLintContainer(dataProperty(record, "container")) !== related) throw invalidLintResult();
    validateOverflow(dataProperty(record, "overflow"));
  } else {
    related = dataProperty(record, "related") as string;
    if (validateLintText(dataProperty(record, "other")) !== related) throw invalidLintResult();
    const overlap = dataProperty(record, "overlapRatio");
    if (typeof overlap !== "number" || !Number.isFinite(overlap) || overlap <= 0 || overlap > 1) throw invalidLintResult();
  }
  const fingerprint = dataProperty(record, "fingerprint") as string;
  if (fingerprint !== [rule, pageId, id, related].join(":")) throw invalidLintResult();
  return fingerprint;
}

function validateLintText(value: unknown): string {
  const record = exactRecord(value, ["content", "id", "ink"], ["color", "opacity"], invalidLintResult);
  if (typeof dataProperty(record, "content") !== "string" || !isNonBlank(dataProperty(record, "id"))) throw invalidLintResult();
  validatedBoundingBox(dataProperty(record, "ink"), invalidLintResult);
  optionalFinite(record, "opacity", invalidLintResult);
  optionalStringField(record, "color", invalidLintResult);
  return dataProperty(record, "id") as string;
}

function validateLintContainer(value: unknown): string {
  const record = exactRecord(value, ["box", "id", "type"], ["fill"], invalidLintResult);
  validatedBoundingBox(dataProperty(record, "box"), invalidLintResult);
  if (!isNonBlank(dataProperty(record, "id")) || !isNonBlank(dataProperty(record, "type"))) throw invalidLintResult();
  const fill = dataProperty(record, "fill");
  if (fill !== undefined) {
    const item = exactRecord(fill, [], ["color", "opacity", "type"], invalidLintResult);
    optionalStringField(item, "color", invalidLintResult);
    optionalStringField(item, "type", invalidLintResult);
    optionalFinite(item, "opacity", invalidLintResult);
  }
  return dataProperty(record, "id") as string;
}

function validateOverflow(value: unknown): void {
  const record = exactRecord(value, [], ["bottom", "left", "right", "top"], invalidLintResult);
  if (Object.keys(record).length === 0) throw invalidLintResult();
  for (const key of ["bottom", "left", "right", "top"] as const) {
    optionalFinite(record, key, invalidLintResult);
    const overflow = dataProperty(record, key);
    if (overflow !== undefined && Number(overflow) < 0) throw invalidLintResult();
  }
}

function validateRenderTargetProbe(
  value: unknown,
  scope: WorkspaceRuntimeScope,
  unitId: string,
  requestedSlidePages?: readonly PageSelector[],
): WorkspaceRenderTargetProbe {
  const probe = exactRecord(value, ["target"], ["slidePageIdentities"], operationFailed);
  const target = validateProbeTarget(dataProperty(probe, "target"), scope, unitId);
  const slidePageIdentitiesValue = dataProperty(probe, "slidePageIdentities");
  if (requestedSlidePages === undefined) {
    if (slidePageIdentitiesValue !== undefined) throw operationFailed();
    return { target };
  }
  if (target.unitType !== "slide") {
    if (slidePageIdentitiesValue !== undefined) throw operationFailed();
    return { target };
  }
  const slidePageIdentities = arrayValue(slidePageIdentitiesValue, operationFailed).map((value, index) => {
    const identity = exactRecord(value, ["page", "pageId"], [], operationFailed);
    const page = dataProperty(identity, "page");
    const pageId = dataProperty(identity, "pageId");
    const selector = requestedSlidePages[index];
    if (
      !positiveInteger(page)
      || !isNonBlank(pageId)
      || (typeof selector === "number" && page !== selector)
      || (typeof selector === "string" && pageId !== selector)
    ) throw operationFailed();
    return { page, pageId };
  });
  if (slidePageIdentities.length !== requestedSlidePages.length) throw operationFailed();
  return { slidePageIdentities, target };
}

function validateProbeTarget(
  value: unknown,
  scope: WorkspaceRuntimeScope,
  unitId: string,
): WorkspaceRuntimeTarget {
  const record = exactRecord(value, ["origin", "revision", "scope", "unitId", "unitType"], [], operationFailed);
  const origin = dataProperty(record, "origin");
  const revision = dataProperty(record, "revision");
  const actualScope = dataProperty(record, "scope");
  const actualUnitId = dataProperty(record, "unitId");
  const unitType = dataProperty(record, "unitType");
  if (!isNonBlank(origin) || !nonNegativeInteger(revision) || actualUnitId !== unitId || !unitTypes.has(unitType)) throw operationFailed();
  validateExactScope(actualScope, scope);
  return { origin, revision, scope, unitId, unitType: unitType as WorkspaceUnitType };
}

function validateExactScope(value: unknown, expected: WorkspaceRuntimeScope): void {
  const record = expected.kind === "trunk"
    ? exactRecord(value, ["kind"], [], operationFailed)
    : exactRecord(value, ["kind", "worktreeId"], [], operationFailed);
  if (dataProperty(record, "kind") !== expected.kind) throw operationFailed();
  if (expected.kind === "worktree" && dataProperty(record, "worktreeId") !== expected.worktreeId) throw operationFailed();
}

function requireTargetCompatibility(unitType: WorkspaceUnitType, target?: WorkspaceScreenshotTarget): void {
  if (target === undefined) return;
  const expected = target.kind.startsWith("sheet-") ? "sheet"
    : target.kind === "doc-pages" ? "doc"
    : target.kind === "slide-pages" ? "slide"
    : target.kind === "board-content" ? "board"
    : "base";
  if (unitType !== expected) throw targetMismatch();
}

function screenshotScope(args: WorkspaceScreenshotArgs): WorkspaceRuntimeScope {
  return args.scope === "trunk"
    ? { kind: "trunk" }
    : { kind: "worktree", worktreeId: args.worktree_id! };
}

function simpleScaleTarget<Kind extends "base-view" | "sheet-viewport">(
  record: Record<string, unknown>,
  kind: Kind,
): { readonly kind: Kind; readonly scale?: number } {
  return { kind, ...optionalScaleValue(record) };
}

function optionalScaleValue(record: Record<string, unknown>): { readonly scale?: number } {
  const scale = dataProperty(record, "scale");
  if (scale === undefined) return {};
  if (typeof scale !== "number") throw invalidArguments();
  return { scale };
}

function optionalPageSelectors(record: Record<string, unknown>, numericOnly: boolean): readonly PageSelector[] | undefined {
  const value = dataProperty(record, "pages");
  return value === undefined ? undefined : pageSelectors(value, numericOnly);
}

function pageSelectors(value: unknown, numericOnly: boolean): readonly PageSelector[] {
  const values = arrayValue(value, invalidArguments);
  for (const item of values) {
    if ((typeof item !== "number" && (!numericOnly && typeof item !== "string")) || (numericOnly && typeof item !== "number")) throw invalidArguments();
  }
  return [...values] as PageSelector[];
}

function validatePageSelectors(values: readonly PageSelector[]): void {
  if (values.some((item) => typeof item === "number" ? !positiveInteger(item) : !isNonBlank(item))) throw invalidArguments();
}

function parseContactSheet(value: unknown): NonNullable<SlidePagesTarget["contact_sheet"]> {
  const record = exactRecord(value, [], ["tile"]);
  const tile = dataProperty(record, "tile");
  if (tile === undefined) return {};
  const item = exactRecord(tile, ["columns", "rows"], []);
  const columns = dataProperty(item, "columns");
  const rows = dataProperty(item, "rows");
  if (typeof columns !== "number" || typeof rows !== "number") throw invalidArguments();
  return { tile: { columns, rows } };
}

function parseBoundingBox(value: unknown): BoundingBox {
  const record = exactRecord(value, ["height", "left", "top", "width"], []);
  const result = {
    height: numberProperty(record, "height"),
    left: numberProperty(record, "left"),
    top: numberProperty(record, "top"),
    width: numberProperty(record, "width"),
  };
  return result;
}

function validateBoundingBox(box: BoundingBox, failure: () => WorkspaceRenderToolError): void {
  if (![box.height, box.left, box.top, box.width].every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw failure();
}

function validatedBoundingBox(value: unknown, failure: () => WorkspaceRenderToolError): BoundingBox {
  const record = exactRecord(value, ["height", "left", "top", "width"], [], failure);
  const box = {
    height: dataProperty(record, "height"),
    left: dataProperty(record, "left"),
    top: dataProperty(record, "top"),
    width: dataProperty(record, "width"),
  };
  if (![box.height, box.left, box.top, box.width].every((item) => typeof item === "number")) throw failure();
  validateBoundingBox(box as BoundingBox, failure);
  return box as BoundingBox;
}

function validatePoints(value: unknown): void {
  for (const point of arrayValue(value, invalidOutput)) {
    const record = exactRecord(point, ["x", "y"], [], invalidOutput);
    if (![dataProperty(record, "x"), dataProperty(record, "y")].every((item) => typeof item === "number" && Number.isFinite(item))) throw invalidOutput();
  }
}

function stringArray(
  value: unknown,
  failure: () => WorkspaceRenderToolError = invalidArguments,
): readonly string[] {
  const values = arrayValue(value, failure);
  if (values.some((item) => typeof item !== "string")) throw failure();
  return [...values] as string[];
}

function validateScale(value: unknown, failure: () => WorkspaceRenderToolError = invalidArguments): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 4)) throw failure();
}

function validA1Range(value: string): boolean {
  return canonicalA1Range(value) !== undefined;
}

function canonicalA1Range(value: string): string | undefined {
  const match = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/u.exec(value.trim());
  if (match === null) return undefined;
  const startColumn = columnIndex(match[1]!);
  const startRow = Number(match[2]!) - 1;
  const endColumn = match[3] === undefined ? startColumn : columnIndex(match[3]);
  const endRow = match[4] === undefined ? startRow : Number(match[4]) - 1;
  if (
    !Number.isSafeInteger(startRow)
    || !Number.isSafeInteger(endRow)
    || !Number.isSafeInteger(startColumn)
    || !Number.isSafeInteger(endColumn)
    || startRow < 0
    || endRow < startRow
    || endColumn < startColumn
  ) return undefined;
  const start = `${match[1]!.toUpperCase()}${String(startRow + 1)}`;
  if (match[3] === undefined) return start;
  return `${start}:${match[3].toUpperCase()}${String(endRow + 1)}`;
}

function columnIndex(value: string): number {
  return [...value.toUpperCase()].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function validateArgumentBudget(value: object): void {
  const measurement = measureCanonicalJson(value);
  if (measurement.bytes > MAX_RENDER_ARGUMENT_BYTES) throw limitExceeded("render-arguments", MAX_RENDER_ARGUMENT_BYTES, measurement.bytes);
}

function validateResultBudget(value: unknown, malformed: () => WorkspaceRenderToolError): void {
  validateWorkspaceRenderResultBudget(value, malformed, limitExceeded);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  failure: () => WorkspaceRenderToolError = invalidArguments,
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw failure();
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) || required.some((key) => !Object.hasOwn(value, key))) throw failure();
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true || descriptor.value === undefined) throw failure();
  }
  return value;
}

function dataProperty(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function stringProperty(record: object, key: string): string {
  const value = dataProperty(record, key);
  if (typeof value !== "string") throw invalidArguments();
  return value;
}

function numberProperty(record: object, key: string): number {
  const value = dataProperty(record, key);
  if (typeof value !== "number") throw invalidArguments();
  return value;
}

function nonBlank(record: object, key: string): string {
  const value = dataProperty(record, key);
  if (!isNonBlank(value)) throw invalidArguments();
  return value;
}

function optionalNonBlank(record: object, key: string): string | undefined {
  const value = dataProperty(record, key);
  if (value === undefined) return undefined;
  if (!isNonBlank(value)) throw invalidArguments();
  return value;
}

function optionalNonBlankValue<Key extends "sheet_name">(
  record: object,
  key: Key,
): Partial<Record<Key, string>> {
  const value = optionalNonBlank(record, key);
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>;
}

function arrayValue(value: unknown, failure: () => WorkspaceRenderToolError): readonly unknown[] {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) throw failure();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) throw failure();
  }
  return value;
}

function arrayProperty(record: object, key: string, failure: () => WorkspaceRenderToolError): readonly unknown[] {
  return arrayValue(dataProperty(record, key), failure);
}

function optionalFinite(record: object, key: string, failure: () => WorkspaceRenderToolError): void {
  const value = dataProperty(record, key);
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) throw failure();
}

function optionalStringField(record: object, key: string, failure: () => WorkspaceRenderToolError): void {
  const value = dataProperty(record, key);
  if (value !== undefined && typeof value !== "string") throw failure();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function objectSchema<const Properties extends Record<string, unknown>>(properties: Properties) {
  return { type: "object", additionalProperties: false, properties } as const;
}

function requiredObject<const Schema extends Record<string, unknown>>(schema: Schema) {
  return { ...schema, required: true } as const;
}

const unitTypes = new Set<unknown>(["sheet", "doc", "slide", "board", "base"]);
const layoutRuleOrder = ["text-off-page", "text-escapes-container", "text-overlaps-text"] as const;
const boardSeverities = new Set<unknown>(["error", "warning"]);
const boardActions = new Set<unknown>(["bind-connector-endpoint", "replace-dashed-connector-with-sequence-lifeline"]);
const boardIssueRules = new Set<unknown>([
  "element-overlap", "connector-through-element", "connector-collinear-overlap",
  "connector-crossing", "connector-free-endpoint-near-element",
  "connector-free-endpoint-near-dashed-connector", "connector-marker-target-overlap",
  "connector-marker-corner-overlap", "connector-marker-collision",
  "connector-terminal-stem-too-short", "connector-terminal-dash-discontinuity",
]);
const renderCodes = new Set([
  "workspace-render-argument-invalid",
  "workspace-render-limit-exceeded",
  "workspace-screenshot-target-required",
  "workspace-screenshot-unit-data-invalid",
  "workspace-screenshot-reference-unit-type-unsupported",
  "workspace-screenshot-reference-resource-invalid",
  "workspace-screenshot-embed-resource-invalid",
  "workspace-screenshot-output-invalid",
  "workspace-screenshot-output-exists",
  "workspace-screenshot-output-partial",
  "workspace-screenshot-output-failed",
  "workspace-unit-layout-lint-unit-type-unsupported",
  "workspace-render-operation-failed",
  "PAGE_LIMIT_EXCEEDED",
  "PIXEL_LIMIT_EXCEEDED",
  "RENDER_RESULT_INVALID",
  "SCREENSHOT_ABORTED",
  "BROWSER_UNAVAILABLE",
  "RENDER_ABORTED",
  "RENDER_FAILED",
  "RENDER_TARGET_INVALID",
  "RUNTIME_CLOSED",
  "INVALID_RENDER_RESULT",
]);
const workspaceApplicationRenderCodes = new Set([
  "workspace-render-argument-invalid",
  "workspace-render-limit-exceeded",
  "workspace-screenshot-target-required",
  "workspace-screenshot-unit-data-invalid",
  "workspace-screenshot-reference-unit-type-unsupported",
  "workspace-screenshot-reference-resource-invalid",
  "workspace-screenshot-embed-resource-invalid",
  "workspace-screenshot-output-invalid",
  "workspace-screenshot-output-exists",
  "workspace-screenshot-output-partial",
  "workspace-screenshot-output-failed",
  "workspace-unit-layout-lint-unit-type-unsupported",
  "workspace-render-operation-failed",
]);
const renderLimitKinds = new Set([
  "layout-page-selectors",
  "render-arguments",
  "render-result-bytes",
  "render-result-depth",
  "screenshot-pages",
]);

class WorkspaceRenderToolError extends HarnessError {
  public constructor(
    message: string,
    code: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message, code);
  }
}

function invalidArguments(): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError("Workspace render arguments are invalid.", "workspace-render-argument-invalid");
}

function invalidOutput(): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError("Workspace screenshot output is invalid.", "workspace-screenshot-output-invalid");
}

function invalidLintResult(): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError("Workspace layout lint returned an invalid result.", "INVALID_RENDER_RESULT");
}

function targetMismatch(): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError("The screenshot target does not match the authoritative Unit type.", "workspace-screenshot-target-required");
}

function lintUnitTypeUnsupported(): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError("Workspace layout lint requires a Slide Unit.", "workspace-unit-layout-lint-unit-type-unsupported");
}

function screenshotSessionCwdRequired(): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError(
    "Workspace screenshot requires a calling Agent Session workspace.",
    "workspace-session-cwd-required",
  );
}

function screenshotPathOutsideSession(): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError(
    "Workspace screenshot path is outside the calling Session workspace.",
    "workspace-file-path-outside-session",
  );
}

function limitExceeded(kind: string, limit: number, actual: number): WorkspaceRenderToolError {
  return renderFailure("workspace-render-limit-exceeded", { actual, kind, limit });
}

function cancelled(): WorkspaceRenderToolError {
  return renderFailure("workspace-operation-cancelled");
}

function disposing(): WorkspaceRenderToolError {
  return renderFailure("workspace-plugin-disposing");
}

function renderFailure(
  code: string,
  detail?: Record<string, unknown>,
): WorkspaceRenderToolError {
  return new WorkspaceRenderToolError(
    `Workspace render operation failed. ${JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) })}`,
    code,
    detail,
  );
}

function operationFailed(): WorkspaceRenderToolError {
  return renderFailure("workspace-render-operation-failed");
}
