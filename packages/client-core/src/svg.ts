import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  builtinTextMeasurer,
  compileSvgToFacade,
  isSvgFacadeError,
  wrapSlideScript,
  type CompileSvgOptions,
  type CompileSvgResult,
  type SvgLineMeasureRun,
  type SvgTextMeasurer,
} from "@univer-cli/svg-facade";
import {
  createUniverRenderRuntime,
  type UniverRenderRuntimeOptions,
  type UniverTextMeasureInput,
  type UniverTextMeasureRuntime,
  type UniverTextMetrics,
} from "@univer-cli/univer-render-runtime";
import type { IDocumentData } from "@univerjs/core";
import type {
  WorkspaceContentExecuteInput,
  WorkspaceContentExecuteResult,
  WorkspaceContentExecutionFeature,
} from "./content-execution.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import { projectWorkspaceRenderDependencyCode } from "./render-unit.js";

const ESTIMATE_LINT =
  "text boxes were sized by estimation (--estimate-text-size), not by real font metrics: text can sit off-position, especially centred or right-aligned lines; recompile without the flag (with a browser) before you ship";

export interface WorkspaceCompileSvgInput {
  readonly add?: boolean;
  readonly estimateTextSize?: boolean;
  readonly file: string;
  readonly localRoot?: string;
  readonly maxAssetBytes?: number;
  readonly maxSourceBytes?: number;
  readonly page?: number;
  readonly signal?: AbortSignal;
}

export interface WorkspaceCompileSvgResult extends CompileSvgResult {
  readonly mode: "add" | "replace";
  readonly page: number | undefined;
}

export interface WorkspaceApplySvgInput {
  readonly compiled: WorkspaceCompileSvgResult;
  readonly maxValueBytes?: number;
  readonly maxValueDepth?: number;
  readonly signal?: AbortSignal;
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceApplySvgResult extends WorkspaceCompileSvgResult {
  readonly applied: WorkspaceContentExecuteResult;
}

export interface WorkspaceCompileSvgDependencies {
  readonly contentExecution: Pick<WorkspaceContentExecutionFeature, "executeSlide">;
  readonly createRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverTextMeasureRuntime>;
  readonly env: NodeJS.ProcessEnv;
  readonly license: string;
  readonly renderPageRoot: string;
  readonly compile?: (
    svg: string,
    options?: CompileSvgOptions,
  ) => Promise<CompileSvgResult>;
  readonly wrap?: typeof wrapSlideScript;
}

export interface WorkspaceSvgTextMeasurePort {
  measureText(input: UniverTextMeasureInput): Promise<UniverTextMetrics>;
}

export function projectWorkspaceSvgDependencyCode(error: unknown):
  | "BROWSER_UNAVAILABLE"
  | "SVG_FACADE_COMPILE_FAILED"
  | undefined {
  if (isSvgFacadeError(error)) return error.code;
  return projectWorkspaceRenderDependencyCode(error) === "BROWSER_UNAVAILABLE"
    ? "BROWSER_UNAVAILABLE"
    : undefined;
}

export class WorkspaceCompileSvgFeature {
  readonly #compile: NonNullable<WorkspaceCompileSvgDependencies["compile"]>;
  readonly #createRuntime: NonNullable<WorkspaceCompileSvgDependencies["createRuntime"]>;
  readonly #wrap: NonNullable<WorkspaceCompileSvgDependencies["wrap"]>;

  public constructor(private readonly dependencies: WorkspaceCompileSvgDependencies) {
    this.#compile = dependencies.compile ?? compileSvgToFacade;
    this.#createRuntime = dependencies.createRuntime ?? createUniverRenderRuntime;
    this.#wrap = dependencies.wrap ?? wrapSlideScript;
  }

  public async compile(input: WorkspaceCompileSvgInput): Promise<WorkspaceCompileSvgResult> {
    input.signal?.throwIfAborted();
    let runtimePromise: Promise<UniverTextMeasureRuntime> | undefined;
    let failed = false;
    const textMeasurer: SvgTextMeasurer =
      input.estimateTextSize === true
        ? builtinTextMeasurer
        : {
            source: "univer-render-runtime",
            measureLine: async (line) => {
              input.signal?.throwIfAborted();
              runtimePromise ??= this.#createRuntime({
                renderPageRoot: this.dependencies.renderPageRoot,
                env: this.dependencies.env,
                license: this.dependencies.license,
                ...(input.signal === undefined ? {} : { signal: input.signal }),
              });
              const runtime = await runtimePromise;
              input.signal?.throwIfAborted();
              const measured = await createWorkspaceSvgTextMeasurer(runtime).measureLine(line);
              input.signal?.throwIfAborted();
              return measured;
            },
          };
    try {
      const source = readSvgFile(input.file, {
        controlled: input.localRoot !== undefined || input.maxSourceBytes !== undefined,
        kind: "source",
        ...(input.maxSourceBytes === undefined ? {} : { maxBytes: input.maxSourceBytes }),
        ...(input.localRoot === undefined ? {} : { root: input.localRoot }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      let remainingAssetBytes = input.maxAssetBytes;
      const compiled = await this.#compile(source.bytes.toString("utf8"), {
        assetResolver: (href) => {
          input.signal?.throwIfAborted();
          const asset = readSvgFile(resolveSvgAsset(source.path, href), {
            controlled: input.localRoot !== undefined || input.maxAssetBytes !== undefined,
            kind: "asset",
            ...(remainingAssetBytes === undefined ? {} : { maxBytes: remainingAssetBytes }),
            ...(input.localRoot === undefined ? {} : { root: input.localRoot }),
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
          if (remainingAssetBytes !== undefined) remainingAssetBytes -= asset.bytes.byteLength;
          return { bytes: asset.bytes };
        },
        textMeasurer,
      });
      input.signal?.throwIfAborted();
      const mode = input.add === true ? "add" : "replace";
      const code = input.page === undefined
        ? compiled.code
        : this.#wrap(compiled.code, { page: input.page, mode, ...compiled.viewport });
      input.signal?.throwIfAborted();
      return {
        code,
        lints:
          input.estimateTextSize === true
            ? [...compiled.lints, ESTIMATE_LINT]
            : compiled.lints,
        mode,
        page: input.page,
        textMeasure: compiled.textMeasure,
        viewport: compiled.viewport,
        warnings: compiled.warnings,
      };
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const runtime = await runtimePromise?.catch(() => undefined);
      try {
        await runtime?.close();
      } catch (error) {
        if (!failed) throw error;
      }
      if (!failed) input.signal?.throwIfAborted();
    }
  }

  public async apply(input: WorkspaceApplySvgInput): Promise<WorkspaceApplySvgResult> {
    input.signal?.throwIfAborted();
    const executionInput: WorkspaceContentExecuteInput = {
      code: input.compiled.code,
      ...(input.maxValueBytes === undefined ? {} : { maxValueBytes: input.maxValueBytes }),
      ...(input.maxValueDepth === undefined ? {} : { maxValueDepth: input.maxValueDepth }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      unitId: input.unitId,
      worktreeId: input.worktreeId,
    };
    return {
      ...input.compiled,
      applied: await this.dependencies.contentExecution.executeSlide(executionInput),
    };
  }
}

interface ReadSvgFileOptions {
  readonly controlled: boolean;
  readonly kind: "asset" | "source";
  readonly maxBytes?: number;
  readonly root?: string;
  readonly signal?: AbortSignal;
}

function readSvgFile(path: string, options: ReadSvgFileOptions): { readonly bytes: Buffer; readonly path: string } {
  options.signal?.throwIfAborted();
  let canonicalPath: string;
  let canonicalRoot: string | undefined;
  try {
    canonicalPath = realpathSync(path);
    canonicalRoot = options.root === undefined ? undefined : realpathSync(options.root);
  } catch (error) {
    options.signal?.throwIfAborted();
    throw options.controlled ? unavailable(options.kind) : error;
  }
  options.signal?.throwIfAborted();
  if (canonicalRoot !== undefined && !contains(canonicalRoot, canonicalPath)) {
    throw workspaceError(
      "workspace-svg-input-outside-root",
      "SVG input is outside the allowed local root.",
    );
  }

  let expected: ReturnType<typeof lstatSync>;
  let descriptor: number;
  try {
    expected = lstatSync(canonicalPath);
    if (!expected.isFile()) throw unavailable(options.kind);
    options.signal?.throwIfAborted();
    descriptor = openSync(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof WorkspaceApplicationError) throw error;
    throw options.controlled ? unavailable(options.kind) : error;
  }

  try {
    const opened = fstatSync(descriptor);
    options.signal?.throwIfAborted();
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino) {
      throw unavailable(options.kind);
    }
    const openedPath = realpathSync(canonicalPath);
    const current = lstatSync(canonicalPath);
    if (
      openedPath !== canonicalPath
      || (canonicalRoot !== undefined && !contains(canonicalRoot, openedPath))
      || current.dev !== opened.dev
      || current.ino !== opened.ino
    ) throw unavailable(options.kind);
    const maxBytes = options.maxBytes ?? opened.size;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes >= Number.MAX_SAFE_INTEGER) {
      throw limitExceeded(options.kind, 0, 0);
    }
    const chunks: Buffer[] = [];
    let actual = 0;
    while (actual <= maxBytes) {
      options.signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - actual));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      actual += bytesRead;
    }
    options.signal?.throwIfAborted();
    if (actual > maxBytes) throw limitExceeded(options.kind, maxBytes, actual);
    return { bytes: Buffer.concat(chunks, actual), path: canonicalPath };
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof WorkspaceApplicationError || !options.controlled) throw error;
    throw unavailable(options.kind);
  } finally {
    closeSync(descriptor);
  }
}

function resolveSvgAsset(source: string, href: string): string {
  return href.startsWith("file:") ? fileURLToPath(href) : resolve(dirname(source), href);
}

function contains(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function unavailable(kind: "asset" | "source"): WorkspaceApplicationError {
  return workspaceError(
    kind === "source" ? "workspace-svg-source-unavailable" : "workspace-svg-asset-unavailable",
    kind === "source" ? "SVG source is unavailable." : "SVG asset is unavailable.",
  );
}

function limitExceeded(kind: "asset" | "source", limit: number, actual: number): WorkspaceApplicationError {
  return workspaceError(
    "workspace-svg-limit-exceeded",
    "SVG input exceeds its byte limit.",
    { actual, kind, limit },
  );
}

export function createWorkspaceSvgTextMeasurer(
  runtime: WorkspaceSvgTextMeasurePort,
): SvgTextMeasurer {
  return {
    source: "univer-render-runtime",
    measureLine: async ({ runs }) => {
      const dataStream = runs.map((run) => run.text).join("");
      let offset = 0;
      const textRuns = runs.map((run) => {
        const start = offset;
        offset += run.text.length;
        return { st: start, ed: offset, ts: textStyle(run) };
      });
      const doc = {
        id: "svg-facade-measure",
        body: {
          dataStream: `${dataStream}\r\n`,
          paragraphs: [{ paragraphId: "svg-facade-measure-p0", startIndex: dataStream.length }],
          textRuns,
        },
        documentStyle: {
          marginBottom: 0,
          marginLeft: 0,
          marginRight: 0,
          marginTop: 0,
          pageSize: { height: 1_000_000, width: 1_000_000 },
        },
      } as unknown as IDocumentData;
      const metrics = await runtime.measureText({ doc });
      return {
        ascent: metrics.firstLineAscent,
        descent: metrics.firstLineDescent,
        width: metrics.actualWidth,
      };
    },
  };
}

function textStyle(run: SvgLineMeasureRun): Record<string, unknown> {
  return {
    fs: run.fontSizePx * 0.75,
    ...(run.bold ? { bl: 1 } : {}),
    ...(run.italic ? { it: 1 } : {}),
    ...(run.fontFamily === undefined ? {} : { ff: run.fontFamily }),
  };
}
