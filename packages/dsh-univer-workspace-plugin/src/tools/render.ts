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
import type { SlideLayoutLintPageSelector } from "@univer-cli/unit-layout-lint";
import { compileSvg } from "../provider/svg-operations.ts";
import { lintUnitLayout } from "../provider/render-operations.ts";
import { screenshotWithAttachments, ScreenshotSupportError, displayPathArgument, type ScreenshotArguments, type AttachmentStoreLike, type LlmServiceLike } from "@univerjs/univer-workspace-agent-runtime/workspace-screenshot";
import { SessionPathError } from "@univerjs/univer-workspace-agent-runtime/workspace-session-path";
import { resolveToolScope } from "./tool-scope.ts";
import { assertUnitInScope } from "./edit.ts";
import { existingSessionPath } from "./workspace-path.ts";
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
  options: { readonly license: string; readonly includeScreenshot?: boolean },
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
            license: options.license,
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
    options.includeScreenshot === false ? () => undefined : registerScreenshotTool(ctx, options);

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
export function registerScreenshotTool(
  ctx: Context,
  options: { readonly license: string },
): () => void {
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
        try {
          return await screenshotWithAttachments(
            args, exec, ctx.get("attachments") as AttachmentStoreLike | undefined,
            ctx.get("llm") as LlmServiceLike | undefined,
            () => loadUnitSource(ctx, exec, args),
            { license: options.license, env: process.env, signal: exec.signal },
          );
        } catch (error) {
          if (error instanceof ScreenshotSupportError || error instanceof SessionPathError) {
            throw new UniverError(error.message, error.code, { cause: error });
          }
          throw error;
        }
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
