import {
  createUnitLayoutLint,
  type UnitLayoutLint,
  type UnitLayoutLintSource,
} from "@univer-cli/unit-layout-lint";
import {
  createUniverRenderRuntime,
  type UniverRenderRuntimeOptions,
  type UniverSlideLayoutRuntime,
} from "@univer-cli/univer-render-runtime";
import { workspaceError } from "./errors.js";
import { awaitRenderOperation, type WorkspaceRenderUnitLoader } from "./render-unit.js";
import type { WorkspaceRuntimeScope } from "./runtime-target.js";

export interface WorkspaceUnitLayoutLintFeatureOptions {
  readonly renderPageRoot: string;
  readonly license: string;
  readonly env: NodeJS.ProcessEnv;
  readonly loader: Pick<WorkspaceRenderUnitLoader, "loadUnit">;
  readonly createRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverSlideLayoutRuntime & { close(): Promise<void> }>;
}

export class WorkspaceUnitLayoutLintFeature {
  readonly #createRuntime: NonNullable<WorkspaceUnitLayoutLintFeatureOptions["createRuntime"]>;

  public constructor(private readonly options: WorkspaceUnitLayoutLintFeatureOptions) {
    this.#createRuntime = options.createRuntime ?? createUniverRenderRuntime;
  }

  public async loadUnit(input: {
    readonly scope: WorkspaceRuntimeScope;
    readonly signal?: AbortSignal;
    readonly unitId: string;
  }): Promise<UnitLayoutLintSource> {
    const unit = await this.options.loader.loadUnit(input);
    if (unit.unitType !== "slide") {
      throw workspaceError(
        "workspace-unit-layout-lint-unit-type-unsupported",
        `Slide layout lint requires a Slide Unit; ${input.unitId} is ${unit.unitType}.`,
      );
    }
    return {
      unitType: "slide",
      unitData: unit.unitData as UnitLayoutLintSource["unitData"],
      ...(unit.formulaReferenceUnits === undefined
        ? {}
        : { formulaReferenceUnits: unit.formulaReferenceUnits }),
    };
  }

  public lint(): UnitLayoutLint {
    return {
      lint: async (input) => {
        input.signal?.throwIfAborted();
        let runtime: UniverSlideLayoutRuntime & { close(): Promise<void> };
        try {
          runtime = await this.#createRuntime({
            renderPageRoot: this.options.renderPageRoot,
            env: this.options.env,
            license: this.options.license,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
        } catch (error) {
          input.signal?.throwIfAborted();
          throw error;
        }
        let failed = false;
        try {
          input.signal?.throwIfAborted();
          return await awaitRenderOperation(createUnitLayoutLint({ runtime }).lint(input), input.signal);
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          try {
            await runtime.close();
          } catch (error) {
            if (!failed) {
              input.signal?.throwIfAborted();
              throw error;
            }
          }
          if (!failed) input.signal?.throwIfAborted();
        }
      },
    };
  }
}
