import {
  createUnitLayoutLint,
  type UnitLayoutLint,
  type UnitLayoutLintOptions,
  type UnitLayoutLintSource,
} from "@univer-cli/unit-layout-lint";
import {
  createHeadlessBoardLayoutRuntime,
  createStandardHeadlessUniverFactory,
} from "@univer-cli/headless-univer";
import {
  createUniverRenderRuntime,
  type UniverRenderRuntimeOptions,
} from "@univer-cli/univer-render-runtime";
import { workspaceError } from "./errors.js";
import type { WorkspaceRenderUnitLoader } from "./render-unit.js";
import type { WorkspaceRuntimeScope } from "./runtime-target.js";

export interface WorkspaceUnitLayoutLintFeatureOptions {
  readonly renderPageRoot: string;
  readonly license: string;
  readonly env: NodeJS.ProcessEnv;
  readonly loader: Pick<WorkspaceRenderUnitLoader, "loadUnit">;
  readonly createRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<NonNullable<UnitLayoutLintOptions["runtime"]> & { close(): Promise<void> }>;
  readonly createModelRuntime?: () => NonNullable<UnitLayoutLintOptions["modelRuntime"]>;
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
    const unit = await this.options.loader.loadUnit(input);
    if (unit.unitType !== "slide" && unit.unitType !== "board") {
      throw workspaceError(
        "workspace-unit-layout-lint-unit-type-unsupported",
        `Layout lint requires a Slide or Board Unit; ${input.unitId} is ${unit.unitType}.`,
      );
    }
    const references = {
      ...(unit.formulaReferenceUnits === undefined
        ? {}
        : { formulaReferenceUnits: unit.formulaReferenceUnits }),
    };
    if (unit.unitType === "board") {
      return {
        unitType: "board",
        unitData: unit.unitData,
        ...references,
        ...(unit.embeddedUnits === undefined ? {} : { embeddedUnits: unit.embeddedUnits }),
      };
    }
    return { unitType: "slide", unitData: unit.unitData, ...references };
  }

  public lint(): UnitLayoutLint {
    return {
      lint: async (input) => {
        const modelRuntime =
          input.unitType === "board"
            ? (this.options.createModelRuntime?.() ??
              createHeadlessBoardLayoutRuntime({
                createUniver: createStandardHeadlessUniverFactory({
                  license: this.options.license,
                }),
              }))
            : undefined;
        if (input.unitType === "board" && input.mode === "model") {
          return await createUnitLayoutLint(
            modelRuntime === undefined ? {} : { modelRuntime },
          ).lint(input);
        }
        const runtime = await this.#createRuntime({
          renderPageRoot: this.options.renderPageRoot,
          env: this.options.env,
          license: this.options.license,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        try {
          return await createUnitLayoutLint({
            runtime,
            ...(modelRuntime === undefined ? {} : { modelRuntime }),
          }).lint(input);
        } finally {
          await runtime.close();
        }
      },
    };
  }
}
