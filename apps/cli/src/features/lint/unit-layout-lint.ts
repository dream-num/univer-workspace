import {
  createUnitLayoutLint,
  type UnitLayoutLint,
  type UnitLayoutLintSource,
} from "@univer-cli/unit-layout-lint";
import type {
  UniverRenderRuntimeOptions,
  UniverSlideLayoutRuntime,
} from "@univer-cli/univer-render-runtime";
import { createUniverRenderRuntime } from "@univer-cli/univer-render-runtime";
import { resolveUniverLicense } from "../../config.js";
import { workspaceError } from "../../errors.js";
import type { WorkspaceRuntimeScope } from "../../runtime/target.js";

export interface WorkspaceUnitLayoutLintSource {
  loadUnit(input: { readonly scope: WorkspaceRuntimeScope; readonly unitId?: string }): Promise<{
    readonly formulaReferenceUnits?: UnitLayoutLintSource["formulaReferenceUnits"];
    readonly unitData: unknown;
    readonly unitType: string;
  }>;
}

export interface WorkspaceUnitLayoutLintFeatureOptions {
  readonly renderPageRoot: string;
  readonly createRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverSlideLayoutRuntime & { close(): Promise<void> }>;
  readonly env: NodeJS.ProcessEnv;
  readonly source: WorkspaceUnitLayoutLintSource;
}

export class WorkspaceUnitLayoutLintFeature {
  readonly #createRuntime: NonNullable<WorkspaceUnitLayoutLintFeatureOptions["createRuntime"]>;

  public constructor(private readonly options: WorkspaceUnitLayoutLintFeatureOptions) {
    this.#createRuntime = options.createRuntime ?? createUniverRenderRuntime;
  }

  public async loadUnit(input: {
    readonly scope: WorkspaceRuntimeScope;
    readonly unitId: string;
  }): Promise<UnitLayoutLintSource> {
    const unit = await this.options.source.loadUnit(input);
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
        const runtime = await this.#createRuntime({
          renderPageRoot: this.options.renderPageRoot,
          env: this.options.env,
          license: resolveUniverLicense(this.options.env),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        try {
          return await createUnitLayoutLint({ runtime }).lint(input);
        } finally {
          await runtime.close();
        }
      },
    };
  }
}
