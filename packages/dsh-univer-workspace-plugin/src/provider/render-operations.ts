/**
 * Public beta.2 render adapters used by the host tools.
 *
 * The Workspace service owns authenticated UnitData acquisition.  This
 * module owns only the target-neutral CLI SDK calls that consume that data;
 * it deliberately has no Cordis or Workspace HTTP knowledge.  A render page
 * is supplied by deployment through `UWH_RENDER_PAGE_ROOT` (or the generic
 * `UNIVER_RENDER_PAGE_ROOT`) and is therefore a real SDK dependency rather
 * than an in-process approximation.
 *
 * @module dsh-univer-workspace-plugin/provider/render-operations
 */

import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  createUnitLayoutLint,
  isUnitLayoutLintError,
  type SlideLayoutLintPageSelector,
  type UnitLayoutLintReport,
} from "@univer-cli/unit-layout-lint";
import {
  createUnitScreenshot,
  isUnitScreenshotError,
  type ScreenshotImage,
  type UnitScreenshotInput,
  type UnitScreenshotResult,
} from "@univer-cli/unit-screenshot";
import {
  createUniverRenderRuntime,
  isUniverRenderError,
  type UniverRenderRuntime,
  type UniverSlideLayoutRuntime,
  type UniverRenderUnit,
} from "@univer-cli/univer-render-runtime";
import type { CollaborationUnitData } from "@univer-cli/univer-collaboration-runtime";
import type { JsonValue } from "@deepseek-ai/dsh-tools";
import type { WorkspaceRuntimeScope, WorkspaceUnitType } from "../runtime/target.ts";

export interface RenderUnitSource {
  readonly unitId: string;
  readonly unitType: WorkspaceUnitType;
  readonly unitData: CollaborationUnitData;
}

export interface RenderRuntimeConfig {
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}

export interface ScreenshotWrite {
  readonly name: string;
  readonly path: string;
  readonly mediaType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly data: string;
  readonly metadata: JsonValue;
}

export interface ScreenshotOperationResult {
  readonly unitId: string;
  readonly unitType: WorkspaceUnitType;
  readonly images: readonly ScreenshotWrite[];
}

const DEFAULT_MAX_PAGES = 30;
const DEFAULT_MAX_PIXELS = 16_777_216;

/**
 * Run the public Slide layout-lint SDK against one synchronized Unit.
 * `createUnitLayoutLint` itself performs all finding calculations; no local
 * heuristic is substituted here.
 */
export async function lintUnitLayout(
  source: RenderUnitSource,
  pages: readonly SlideLayoutLintPageSelector[] | undefined,
  config: RenderRuntimeConfig = {},
): Promise<UnitLayoutLintReport> {
  if (source.unitType !== "slide") {
    throw new Error(`Unit is ${source.unitType}; layout lint requires a Slide Unit.`);
  }
  const runtime = await openRenderRuntime(config);
  try {
    return await createUnitLayoutLint({ runtime }).lint({
      unitType: "slide",
      unitData: source.unitData as never,
      ...(pages === undefined ? {} : { pages }),
      ...(config.signal === undefined ? {} : { signal: config.signal }),
    });
  } catch (error) {
    throw normalizeRenderError(error);
  } finally {
    await runtime.close();
  }
}

/**
 * Render one Unit through the public screenshot SDK and persist the PNGs in
 * an already-authorized session directory.  The returned `data` fields are
 * base64 for a lossless DSH JSON result; callers may use `path` for local
 * follow-up operations.
 */
export async function screenshotUnit(
  source: RenderUnitSource,
  outputDirectory: string,
  target: UnitScreenshotInput["target"] | undefined,
  config: RenderRuntimeConfig = {},
): Promise<ScreenshotOperationResult> {
  const runtime = await openRenderRuntime(config);
  try {
    const input = screenshotInput(source, target, config.signal);
    const result = await createUnitScreenshot({
      runtime,
      limits: {
        maxPages: positiveEnv(config.env ?? process.env, "UWH_SCREENSHOT_MAX_PAGES", DEFAULT_MAX_PAGES),
        maxPixels: positiveEnv(config.env ?? process.env, "UWH_SCREENSHOT_MAX_PIXELS", DEFAULT_MAX_PIXELS),
      },
    }).capture(input);
    const images = await persistScreenshots(result, outputDirectory, config.signal);
    return { unitId: result.unitId, unitType: result.unitType, images };
  } catch (error) {
    throw normalizeRenderError(error);
  } finally {
    await runtime.close();
  }
}

async function openRenderRuntime(config: RenderRuntimeConfig): Promise<UniverRenderRuntime & UniverSlideLayoutRuntime> {
  const env = config.env ?? process.env;
  const renderPageRoot = env.UWH_RENDER_PAGE_ROOT?.trim() || env.UNIVER_RENDER_PAGE_ROOT?.trim();
  if (renderPageRoot === undefined || renderPageRoot === "") {
    throw new Error(
      "Univer rendering is unavailable: configure UWH_RENDER_PAGE_ROOT (a version-matched built render page) before using univer_lint or univer_screenshot.",
    );
  }
  const license = env.UWH_UNIVER_LICENSE?.trim() || env.UNIVER_LICENSE?.trim();
  const browserExecutablePath = env.UWH_RENDER_BROWSER?.trim() || env.UNIVER_RENDER_BROWSER?.trim();
  return await createUniverRenderRuntime({
    renderPageRoot,
    env,
    ...(license === undefined || license === "" ? {} : { license }),
    ...(browserExecutablePath === undefined || browserExecutablePath === "" ? {} : { browserExecutablePath }),
    ...(config.signal === undefined ? {} : { signal: config.signal }),
  });
}

function screenshotInput(
  source: RenderUnitSource,
  target: UnitScreenshotInput["target"] | undefined,
  signal: AbortSignal | undefined,
): UnitScreenshotInput {
  const base = {
    unitType: source.unitType,
    unitData: source.unitData,
    ...(target === undefined ? {} : { target }),
    ...(signal === undefined ? {} : { signal }),
  } as unknown as UnitScreenshotInput;
  return base;
}

async function persistScreenshots(
  result: UnitScreenshotResult,
  outputDirectory: string,
  signal: AbortSignal | undefined,
): Promise<readonly ScreenshotWrite[]> {
  signal?.throwIfAborted();
  await mkdir(outputDirectory, { recursive: true });
  const writes: ScreenshotWrite[] = [];
  for (const image of result.images) {
    signal?.throwIfAborted();
    if (basename(image.name) !== image.name || image.name === "." || image.name === "..") {
      throw new Error(`Unsafe screenshot image name: ${image.name}`);
    }
    const path = resolve(outputDirectory, image.name);
    try {
      await writeFile(path, image.bytes, signal === undefined ? { flag: "wx" } : { flag: "wx", signal });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new Error(`Screenshot output already exists: ${path}`, { cause: error });
      }
      throw error;
    }
    writes.push({
      name: image.name,
      path,
      mediaType: image.mediaType,
      width: image.width,
      height: image.height,
      bytes: image.bytes.byteLength,
      data: Buffer.from(image.bytes).toString("base64"),
      metadata: screenshotMetadata(image),
    });
  }
  return writes;
}

function screenshotMetadata(image: ScreenshotImage): JsonValue {
  return {
    ...(image.boardSelector === undefined ? {} : { boardSelector: image.boardSelector as unknown as JsonValue }),
    ...(image.contentBounds === undefined ? {} : { contentBounds: image.contentBounds as unknown as JsonValue }),
    ...(image.layoutAnalysis === undefined ? {} : { layoutAnalysis: image.layoutAnalysis as unknown as JsonValue }),
    ...(image.padding === undefined ? {} : { padding: image.padding }),
    ...(image.page === undefined ? {} : { page: image.page }),
    ...(image.pageId === undefined ? {} : { pageId: image.pageId }),
    ...(image.range === undefined ? {} : { range: image.range }),
    ...(image.role === undefined ? {} : { role: image.role }),
    ...(image.scale === undefined ? {} : { scale: image.scale }),
    ...(image.sheetName === undefined ? {} : { sheetName: image.sheetName }),
    ...(image.tiles === undefined ? {} : { tiles: image.tiles }),
  };
}

function positiveEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function normalizeRenderError(error: unknown): Error {
  if (isUniverRenderError(error)) return new Error(`Univer render failed: ${error.message}`, { cause: error });
  if (isUnitLayoutLintError(error)) return new Error(`Univer layout lint failed: ${error.message}`, { cause: error });
  if (isUnitScreenshotError(error)) return new Error(`Univer screenshot failed: ${error.message}`, { cause: error });
  return error instanceof Error ? error : new Error(String(error));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
