/**
 * Render and SVG authoring tools.
 *
 * These tools keep the Office plugin's public names while targeting the
 * Workspace Unit/Worktree model. All computation is delegated to the pinned
 * Univer SDK adapters in `provider/*`; a missing browser render
 * page is reported as an execution error, never represented as a fake result.
 * @module dsh-univer-workspace-plugin/tools/render
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { JsonValue } from "../json-value.ts";
import { isAbsolute, relative, sep } from "node:path";
import type { UnitScreenshotInput } from "@univer-cli/unit-screenshot";
import type { SlideLayoutLintPageSelector } from "@univer-cli/unit-layout-lint";
import { compileSvg } from "../provider/svg-operations.ts";
import { lintUnitLayout, screenshotUnit } from "../provider/render-operations.ts";
import { resolveToolScope } from "./tool-scope.ts";
import { assertUnitInScope } from "./edit.ts";
import { existingSessionPath, newSessionPath } from "./workspace-path.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

const unitTypeEnum = {
  type: "string" as const,
  enum: ["sheet", "doc", "slide", "board", "base"] as const,
};

type UnitType = "sheet" | "doc" | "slide" | "board" | "base";
type PageSelector = number | string;

interface LintArguments {
  readonly unitId: string;
  readonly unitType: UnitType;
  readonly worktreeId?: string;
  readonly pages?: readonly PageSelector[];
}

interface ScreenshotArguments extends LintArguments {
  readonly output: string;
  readonly sheetName?: string;
  readonly range?: string;
  readonly contactSheet?: boolean;
  readonly tileColumns?: number;
  readonly tileRows?: number;
  readonly region?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly elementIds?: readonly string[];
  readonly padding?: number;
  readonly scale?: number;
}

interface CompileSvgArguments {
  readonly source: string;
  readonly worktreeId: string;
  readonly unitId: string;
  readonly page: number;
  readonly mode?: "replace" | "add";
}

function text(value: unknown): ContentBlock[] {
  return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value ?? {}) }];
}

/** Minimal structural view of the DSH attachment service.
 *
 * The plugin intentionally does not add a hard dependency on the attachment
 * package: DSH owns that service and may provide a compatible implementation
 * at runtime.  Keeping this seam structural lets the screenshot tool remain
 * loadable in profiles that do not ship attachments while still requiring the
 * real service before registration/execution.
 */
interface AttachmentStoreLike {
  readonly imageLimits: {
    readonly mediaTypes: readonly string[];
    readonly maxImagesPerMessage?: number;
    readonly maxMessageImageBytes: number;
    readonly maxImageBytes: number;
    readonly maxImagePixels?: number;
  };
  saveImages(
    inputs: readonly {
      readonly data: Uint8Array;
      readonly mediaType: "image/png";
      readonly name?: string;
    }[],
  ): Promise<readonly AttachmentRefLike[]>;
}

interface AttachmentRefLike {
  readonly attachmentId: string;
  readonly mediaType: "image/png";
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
}

interface ModelInfoLike {
  readonly inputModalities?: readonly string[];
}

interface LlmServiceLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<ModelInfoLike>;
}

/** Register the non-image render tools.
 *
 * `includeScreenshot` remains true for direct unit tests and callers that
 * explicitly own an attachment service.  The production plugin passes false
 * and registers the screenshot definition from an `attachments` injection;
 * this keeps the model tool catalog honest when durable image storage is not
 * installed.
 */
export function registerRenderTools(
  ctx: Context,
  options: { readonly includeScreenshot?: boolean } = {},
): () => void {
  const disposeLint = registerUniverTool(
    ctx,
    defineTool({
      name: "univer_lint",
      description:
        "Analyze a Slide Unit with the pinned Univer layout-lint runtime. Reports off-page text, escaped containers, and text overlap; it never fabricates a pass result.",
      parameters: {
        unitId: {
          type: "string",
          required: true,
          description: "Explicit Slide Unit id from univer_status.",
        },
        unitType: {
          ...unitTypeEnum,
          required: true,
          description: "Must be slide for layout lint.",
        },
        worktreeId: {
          type: "string",
          description: "Optional draft Worktree scope; omit for trunk.",
        },
        pages: {
          type: "array",
          items: { oneOf: [{ type: "integer" }, { type: "string" }] },
          description: "Optional 1-based page numbers or page ids.",
        },
      },
      output: {
        schema: { type: "json" },
        render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
      },
      async execute(args: LintArguments, exec: ToolRunContext): Promise<JsonValue> {
        const source = await loadUnitSource(ctx, exec, args);
        const result = await lintUnitLayout(
          source,
          args.pages as readonly SlideLayoutLintPageSelector[] | undefined,
          {
            env: process.env,
            signal: exec.signal,
          },
        );
        return {
          ok: true,
          operation: "lint",
          unitId: args.unitId,
          unitType: args.unitType,
          result: result as unknown as JsonValue,
        };
      },
      presentCall: () => ({ card: "generic", title: "Lint Univer Unit", kind: "read" }),
    }),
  );

  const disposeScreenshot =
    options.includeScreenshot === false ? () => undefined : registerScreenshotTool(ctx);

  const disposeCompile = registerUniverTool(
    ctx,
    defineTool({
      name: "univer_compile_svg",
      description:
        "Compile an SVG with the pinned Univer SVG Facade SDK and apply the generated Slide program to one explicit draft Worktree page.",
      parameters: {
        source: {
          type: "string",
          required: true,
          description: "SVG path inside the session workspace.",
        },
        worktreeId: { type: "string", required: true, description: "Writable draft Worktree id." },
        unitId: { type: "string", required: true, description: "Explicit Slide Unit id." },
        page: { type: "integer", required: true, description: "1-based Slide page number." },
        mode: { type: "string", enum: ["replace", "add"] },
      },
      output: {
        schema: { type: "json" },
        render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
      },
      async execute(args: CompileSvgArguments, exec: ToolRunContext): Promise<JsonValue> {
        const resolved = await resolveToolScope(ctx, exec);
        await assertUnitInScope(ctx, resolved, args.unitId, "slide", args.worktreeId);
        const source = await existingSessionPath(exec, args.source);
        const compiled = await compileSvg({
          source: source.path,
          sourceWorkspace: source.workspace,
          page: args.page,
          ...(args.mode === undefined ? {} : { mode: args.mode }),
          signal: exec.signal,
        });
        const execution = await ctx.get("univerWorkspace")!.editUnit(resolved.userId, {
          scope: { kind: "worktree", worktreeId: args.worktreeId },
          unitId: args.unitId,
          unitType: "slide",
          code: compiled.code,
        });
        return {
          ok: true,
          operation: "compile-svg",
          sourcePath: args.source,
          unitId: args.unitId,
          worktreeId: args.worktreeId,
          page: compiled.page,
          mode: compiled.mode,
          viewport: compiled.viewport,
          textMeasure: compiled.textMeasure,
          warnings: [...compiled.warnings],
          lints: [...compiled.lints],
          execution: execution as unknown as JsonValue,
        };
      },
      presentCall: () => ({ card: "generic", title: "Compile SVG into Slide", kind: "execute" }),
    }),
  );

  return () => {
    disposeCompile();
    disposeScreenshot();
    disposeLint();
  };
}

/**
 * Register `univer_screenshot` against a context that has an attachment
 * service.  Keep this separate from the other render tools so Cordis can
 * unload it whenever the service disappears.
 */
export function registerScreenshotTool(ctx: Context): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_screenshot",
      description:
        "Render one explicit Workspace Unit to PNG files through the pinned Univer screenshot runtime and return durable image attachments for visual verification.",
      parameters: {
        unitId: {
          type: "string",
          required: true,
          description: "Explicit Unit id from univer_status.",
        },
        unitType: { ...unitTypeEnum, required: true },
        worktreeId: {
          type: "string",
          description: "Optional draft Worktree scope; omit for trunk.",
        },
        output: {
          type: "string",
          required: true,
          description: "Session-relative output directory for PNG files.",
        },
        sheetName: { type: "string" },
        range: { type: "string", description: "Sheet A1 range, e.g. B2:H40." },
        pages: { type: "array", items: { oneOf: [{ type: "integer" }, { type: "string" }] } },
        contactSheet: { type: "boolean" },
        tileColumns: { type: "integer" },
        tileRows: { type: "integer" },
        region: {
          type: "object",
          additionalProperties: false,
          properties: {
            left: { type: "number", required: true },
            top: { type: "number", required: true },
            width: { type: "number", required: true },
            height: { type: "number", required: true },
          },
        },
        elementIds: { type: "array", items: { type: "string" } },
        padding: { type: "number" },
        scale: { type: "number", description: "Render scale from 0.1 to 4." },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true, const: true },
            operation: { type: "string", required: true, const: "screenshot" },
            unitId: { type: "string", required: true },
            unitType: { type: "string", required: true },
            output: { type: "string", required: true },
            result: { type: "json", required: true },
          },
        },
        render: (_args: unknown, value: unknown): ContentBlock[] => {
          const record = value as {
            readonly result?: { readonly images?: readonly { readonly image?: unknown }[] };
          };
          const images = record.result?.images;
          if (!Array.isArray(images)) return text(value);
          return [
            { type: "text", text: JSON.stringify(record) },
            ...images.flatMap((image) =>
              image.image === undefined
                ? []
                : [
                    {
                      type: "image" as const,
                      attachment: image.image,
                    } as unknown as ContentBlock,
                  ],
            ),
          ];
        },
      },
      async execute(args: ScreenshotArguments, exec: ToolRunContext) {
        const attachments = ctx.get("attachments") as AttachmentStoreLike | undefined;
        if (attachments === undefined) {
          throw new UniverError(
            "Screenshot attachments are unavailable in this deployment.",
            "SCREENSHOT_ATTACHMENTS_UNAVAILABLE",
          );
        }
        assertAttachmentPolicy(attachments);
        await assertImageCapableRoute(ctx, exec, args.output);
        const resolved = await resolveToolScope(ctx, exec);
        await assertUnitInScope(ctx, resolved, args.unitId, args.unitType, args.worktreeId);
        const service = ctx.get("univerWorkspace")!;
        const scope =
          args.worktreeId === undefined
            ? { kind: "trunk" as const }
            : { kind: "worktree" as const, worktreeId: args.worktreeId };
        const unitData = await service.exportUnitData(resolved.userId, {
          scope,
          unitId: args.unitId,
          unitType: args.unitType,
        });
        const output = await newSessionPath(exec, args.output);
        const captured = await screenshotUnit(
          { unitId: args.unitId, unitType: args.unitType, unitData },
          output.path,
          screenshotTarget(args),
          { env: process.env, signal: exec.signal },
        );
        const decoded = captured.images.map((image) => ({
          image,
          bytes: Buffer.from(image.data, "base64"),
        }));
        validateAttachmentLimits(attachments, decoded);
        exec.signal.throwIfAborted();
        let refs: readonly AttachmentRefLike[];
        try {
          refs = await attachments.saveImages(
            decoded.map(({ image, bytes }) => ({
              data: new Uint8Array(bytes),
              mediaType: "image/png" as const,
              name: image.name,
            })),
          );
        } catch (error) {
          // Do not expose an attachment backend stack.  The hardened wrapper
          // assigns a stable operation code while retaining the cause locally.
          throw new UniverError(
            "Screenshot attachment persistence failed.",
            "SCREENSHOT_ATTACHMENT_WRITE_FAILED",
            { cause: error },
          );
        }
        if (refs.length !== decoded.length) {
          throw new UniverError(
            "Screenshot attachment service returned an incomplete image batch.",
            "SCREENSHOT_ATTACHMENT_RESULT_INVALID",
          );
        }
        const outputLabel = displaySessionPath(output.workspace, output.path);
        const images = decoded.map(({ image }, index) => {
          const ref = refs[index]!;
          return {
            // Absolute provider paths never cross the tool boundary. Keep a
            // session-relative label for follow-up tools instead.
            path: `${outputLabel}/${image.name}`,
            name: image.name,
            mediaType: image.mediaType,
            width: image.width,
            height: image.height,
            metadata: image.metadata,
            image: {
              attachmentId: ref.attachmentId,
              mediaType: ref.mediaType,
              bytes: ref.bytes,
              width: ref.width,
              height: ref.height,
              ...(ref.name === undefined ? {} : { name: ref.name }),
            },
          };
        });
        return {
          ok: true,
          operation: "screenshot" as const,
          unitId: captured.unitId,
          unitType: captured.unitType,
          output: outputLabel,
          result: {
            unitId: captured.unitId,
            unitType: captured.unitType,
            images: images as unknown as JsonValue,
          } as unknown as JsonValue,
        };
      },
      presentCall: (args: ScreenshotArguments) => ({
        card: "generic",
        title: "Screenshot Univer Unit",
        kind: "read",
        locations: [{ path: displayPathArgument(args.output) }],
      }),
    }),
  );
}

/** Return a stable session-relative path label, never an absolute host path. */
function displaySessionPath(workspace: string, path: string): string {
  const value = relative(workspace, path);
  if (value === "" || value === ".") return ".";
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) return "[workspace]";
  return value.split(sep).join("/");
}

/** Keep pending-call presentation free of absolute paths supplied by a model. */
function displayPathArgument(value: string): string {
  if (!isAbsolute(value)) return value;
  const normalized = value.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename === "" ? "[workspace]" : basename;
}

function assertAttachmentPolicy(attachments: AttachmentStoreLike): void {
  if (!attachments.imageLimits.mediaTypes.includes("image/png")) {
    throw new UniverError(
      "This deployment does not accept PNG screenshot attachments.",
      "SCREENSHOT_MEDIA_TYPE_UNAVAILABLE",
    );
  }
  const { maxMessageImageBytes, maxImageBytes } = attachments.imageLimits;
  if (
    !Number.isSafeInteger(maxMessageImageBytes) ||
    maxMessageImageBytes < 1 ||
    !Number.isSafeInteger(maxImageBytes) ||
    maxImageBytes < 1
  ) {
    throw new UniverError(
      "The screenshot attachment policy is unavailable.",
      "SCREENSHOT_ATTACHMENT_POLICY_INVALID",
    );
  }
}

function validateAttachmentLimits(
  attachments: AttachmentStoreLike,
  images: readonly {
    readonly image: {
      readonly name: string;
      readonly width: number;
      readonly height: number;
      readonly bytes: number;
    };
    readonly bytes: Uint8Array;
  }[],
): void {
  const limits = attachments.imageLimits;
  if (limits.maxImagesPerMessage !== undefined && images.length > limits.maxImagesPerMessage) {
    throw new UniverError(
      "Screenshot returned more images than the attachment limit.",
      "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
    );
  }
  const totalBytes = images.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  if (totalBytes > limits.maxMessageImageBytes) {
    throw new UniverError(
      "Screenshot images exceed the attachment message limit; capture fewer pages or a smaller range.",
      "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
    );
  }
  for (const { image, bytes } of images) {
    if (bytes.byteLength > limits.maxImageBytes) {
      throw new UniverError(
        "A screenshot image exceeds the per-image attachment limit.",
        "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
      );
    }
    if (limits.maxImagePixels !== undefined && image.width * image.height > limits.maxImagePixels) {
      throw new UniverError(
        "A screenshot image exceeds the pixel limit.",
        "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
      );
    }
  }
}

async function assertImageCapableRoute(
  ctx: Context,
  exec: ToolRunContext,
  identity: string,
): Promise<void> {
  const agent = exec.agent as unknown as
    | {
        readonly session?: {
          readonly requestHeader?: () =>
            | { readonly config?: { readonly provider?: string; readonly model?: string } }
            | undefined;
        };
        readonly options?: { readonly provider?: string; readonly model?: string };
      }
    | undefined;
  const routed = agent?.session?.requestHeader?.()?.config;
  const provider = routed?.provider ?? agent?.options?.provider;
  const model = routed?.model ?? agent?.options?.model;
  const llm = ctx.get("llm") as LlmServiceLike | undefined;
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new UniverError(
      "The current model route cannot accept screenshot input.",
      "SCREENSHOT_MODEL_ROUTE_UNAVAILABLE",
    );
  }
  const info = await llm.resolveModelInfo(provider, model, exec.signal);
  if (info.inputModalities === undefined || !info.inputModalities.includes("image")) {
    throw new UniverError(
      "The current model does not support image input.",
      "SCREENSHOT_MODEL_NOT_IMAGE_CAPABLE",
    );
  }
}

async function loadUnitSource(
  ctx: Context,
  exec: ToolRunContext,
  args: LintArguments,
): Promise<{
  readonly unitId: string;
  readonly unitType: UnitType;
  readonly unitData: Awaited<ReturnType<NonNullable<Context["univerWorkspace"]>["exportUnitData"]>>;
}> {
  const resolved = await resolveToolScope(ctx, exec);
  await assertUnitInScope(ctx, resolved, args.unitId, args.unitType, args.worktreeId);
  const scope =
    args.worktreeId === undefined
      ? { kind: "trunk" as const }
      : { kind: "worktree" as const, worktreeId: args.worktreeId };
  const unitData = await ctx.get("univerWorkspace")!.exportUnitData(resolved.userId, {
    scope,
    unitId: args.unitId,
    unitType: args.unitType,
  });
  return { unitId: args.unitId, unitType: args.unitType, unitData };
}

function screenshotTarget(args: ScreenshotArguments): UnitScreenshotInput["target"] | undefined {
  const usesSheet = args.sheetName !== undefined || args.range !== undefined;
  const usesPaged =
    args.pages !== undefined ||
    args.contactSheet === true ||
    args.tileColumns !== undefined ||
    args.tileRows !== undefined;
  const usesBoard =
    args.region !== undefined || args.elementIds !== undefined || args.padding !== undefined;
  if ([usesSheet, usesPaged, usesBoard].filter(Boolean).length > 1) {
    throw new UniverError(
      "Sheet, paged-Unit, and Board screenshot selectors cannot be combined.",
      "SCREENSHOT_INPUT_INVALID",
    );
  }
  if (args.scale !== undefined && (args.scale < 0.1 || args.scale > 4)) {
    throw new UniverError(
      "Screenshot scale must be between 0.1 and 4.",
      "SCREENSHOT_INPUT_INVALID",
    );
  }
  if (args.unitType === "sheet" && usesSheet) {
    if (args.range === undefined || args.range.trim() === "") {
      throw new UniverError("sheetName requires a non-empty range.", "SCREENSHOT_INPUT_INVALID");
    }
    return {
      kind: "sheet-range",
      range: args.range,
      ...(args.sheetName === undefined ? {} : { sheetName: args.sheetName }),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (args.unitType === "doc" && usesPaged) {
    const pages = args.pages;
    if (pages !== undefined && pages.some((page) => typeof page !== "number")) {
      throw new UniverError(
        "Doc screenshots accept numeric pages only.",
        "SCREENSHOT_INPUT_INVALID",
      );
    }
    if (
      args.contactSheet === true ||
      args.tileColumns !== undefined ||
      args.tileRows !== undefined
    ) {
      throw new UniverError(
        "Doc screenshots do not support contact sheets.",
        "SCREENSHOT_INPUT_INVALID",
      );
    }
    return {
      kind: "doc-pages",
      ...(pages === undefined ? {} : { pages: pages as readonly number[] }),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (args.unitType === "slide" && usesPaged) {
    const hasColumns = args.tileColumns !== undefined;
    const hasRows = args.tileRows !== undefined;
    if (hasColumns !== hasRows || (hasColumns && args.contactSheet !== true)) {
      throw new UniverError(
        "tileColumns and tileRows must be provided together with contactSheet.",
        "SCREENSHOT_INPUT_INVALID",
      );
    }
    return {
      kind: "slide-pages",
      ...(args.pages === undefined ? {} : { pages: args.pages }),
      ...(args.contactSheet === true
        ? {
            contactSheet:
              hasColumns && hasRows
                ? { tile: { columns: args.tileColumns!, rows: args.tileRows! } }
                : {},
          }
        : {}),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (args.unitType === "board" && usesBoard) {
    return {
      kind: "board-content",
      ...(args.region === undefined ? {} : { region: args.region }),
      ...(args.elementIds === undefined ? {} : { elementIds: args.elementIds }),
      ...(args.padding === undefined ? {} : { padding: args.padding }),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (usesSheet || usesPaged || usesBoard) {
    throw new UniverError(
      `Screenshot selectors are not supported for ${args.unitType} Units.`,
      "SCREENSHOT_INPUT_INVALID",
    );
  }
  if (args.scale === undefined) return undefined;
  if (args.unitType === "sheet")
    return { kind: "sheet-viewport", scale: args.scale } as UnitScreenshotInput["target"];
  if (args.unitType === "doc")
    return { kind: "doc-pages", scale: args.scale } as UnitScreenshotInput["target"];
  if (args.unitType === "slide")
    return { kind: "slide-pages", scale: args.scale } as UnitScreenshotInput["target"];
  if (args.unitType === "base")
    return { kind: "base-view", scale: args.scale } as UnitScreenshotInput["target"];
  return { kind: "board-content", scale: args.scale } as UnitScreenshotInput["target"];
}
