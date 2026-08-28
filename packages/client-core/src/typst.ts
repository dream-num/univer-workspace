import {
  compileDocTypstBundle,
  type CompileDocTypstBundleOptions,
  type CompileDocTypstBundleResult,
} from "@univer-cli/doc-typst-facade";
import { workspaceError } from "./errors.js";
import type { WorkspaceUnitFeature } from "./unit.js";
import type { WorkspaceUnit } from "./worktree-model.js";

export interface WorkspaceCompileTypstInput {
  readonly apply?: {
    readonly idempotencyKey?: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
    readonly worktreeId: string;
  };
  readonly bundlePath: string;
  readonly previewDir?: string;
}

export interface WorkspaceCompileTypstResult extends CompileDocTypstBundleResult {
  readonly committed: boolean;
  readonly unit?: WorkspaceUnit;
}

export interface WorkspaceTypstMaterializeInput {
  readonly javascript: string;
  readonly targetUnitId: string;
}

export interface WorkspaceTypstMaterializeResult {
  readonly initialData: Readonly<Record<string, unknown>>;
  readonly name?: string;
}

export interface WorkspaceTypstMaterializer {
  materialize(input: WorkspaceTypstMaterializeInput): Promise<WorkspaceTypstMaterializeResult>;
}

export interface WorkspaceCompileTypstDependencies {
  readonly compile?: (
    bundlePath: string,
    options?: CompileDocTypstBundleOptions,
  ) => Promise<CompileDocTypstBundleResult>;
  readonly materializer: WorkspaceTypstMaterializer;
  readonly units: Pick<WorkspaceUnitFeature, "create">;
}

/** Workspace orchestration: compile once, validate, materialize, then create one staged Doc. */
export class WorkspaceCompileTypstFeature {
  private readonly compile: NonNullable<WorkspaceCompileTypstDependencies["compile"]>;

  public constructor(private readonly dependencies: WorkspaceCompileTypstDependencies) {
    this.compile = dependencies.compile ?? compileDocTypstBundle;
  }

  public async execute(input: WorkspaceCompileTypstInput): Promise<WorkspaceCompileTypstResult> {
    const compileOptions: CompileDocTypstBundleOptions =
      input.previewDir === undefined ? {} : { previewDir: input.previewDir };
    const compiled = await this.compile(input.bundlePath, compileOptions);
    if (input.apply === undefined) return { ...compiled, committed: false };

    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      throw workspaceError(
        "workspace-typst-diagnostics",
        `Typst compilation contains ${String(errors.length)} error diagnostic(s); no Unit was created.`,
        { diagnostics: errors },
      );
    }
    const materialized = await this.dependencies.materializer.materialize({
      javascript: compiled.javascript,
      targetUnitId: compiled.targetUnitId,
    });
    const unit = await this.dependencies.units.create({
      name: materialized.name ?? compiled.title,
      spaceId: input.apply.spaceId,
      type: "doc",
      worktreeId: input.apply.worktreeId,
      initialData: materialized.initialData,
      ...(input.apply.parentNodeId === undefined
        ? {}
        : { parentNodeId: input.apply.parentNodeId }),
      ...(input.apply.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.apply.idempotencyKey }),
    });
    return { ...compiled, committed: true, unit };
  }
}
