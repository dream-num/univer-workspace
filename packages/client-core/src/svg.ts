import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  builtinTextMeasurer,
  compileSvgToFacade,
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

const ESTIMATE_LINT =
  "text boxes were sized by estimation (--estimate-text-size), not by real font metrics: text can sit off-position, especially centred or right-aligned lines; recompile without the flag (with a browser) before you ship";

export interface WorkspaceCompileSvgInput {
  readonly add?: boolean;
  readonly estimateTextSize?: boolean;
  readonly file: string;
  readonly page?: number;
}

export interface WorkspaceCompileSvgResult extends CompileSvgResult {
  readonly mode: "add" | "replace";
  readonly page: number | undefined;
}

export interface WorkspaceApplySvgInput {
  readonly compiled: WorkspaceCompileSvgResult;
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
    let runtimePromise: Promise<UniverTextMeasureRuntime> | undefined;
    const textMeasurer: SvgTextMeasurer =
      input.estimateTextSize === true
        ? builtinTextMeasurer
        : {
            source: "univer-render-runtime",
            measureLine: async (line) => {
              runtimePromise ??= this.#createRuntime({
                renderPageRoot: this.dependencies.renderPageRoot,
                env: this.dependencies.env,
                license: this.dependencies.license,
              });
              return await createWorkspaceSvgTextMeasurer(await runtimePromise).measureLine(line);
            },
          };
    try {
      const compiled = await this.#compile(readFileSync(input.file, "utf8"), {
        assetResolver: (href) => ({
          bytes: readFileSync(resolve(dirname(input.file), href)),
        }),
        textMeasurer,
      });
      const mode = input.add === true ? "add" : "replace";
      return {
        code:
          input.page === undefined
            ? compiled.code
            : this.#wrap(compiled.code, { page: input.page, mode, ...compiled.viewport }),
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
    } finally {
      const runtime = await runtimePromise?.catch(() => undefined);
      await runtime?.close();
    }
  }

  public async apply(input: WorkspaceApplySvgInput): Promise<WorkspaceApplySvgResult> {
    const executionInput: WorkspaceContentExecuteInput = {
      code: input.compiled.code,
      unitId: input.unitId,
      worktreeId: input.worktreeId,
    };
    return {
      ...input.compiled,
      applied: await this.dependencies.contentExecution.executeSlide(executionInput),
    };
  }
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
