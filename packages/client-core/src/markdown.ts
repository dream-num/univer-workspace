import type {
  WorkspaceContentExecutionFeature,
  WorkspaceContentExecuteResult,
} from "./content-execution.js";
import { workspaceError } from "./errors.js";
import type { WorkspaceTypstMaterializer } from "./typst.js";
import type { WorkspaceUnitFeature } from "./unit.js";
import type { WorkspaceUnit } from "./worktree-model.js";
import type { WorkspaceSourceFiles } from "./files.js";
import {
  compileWorkspaceMarkdownFile,
  compileWorkspaceMarkdownSource,
  workspaceMarkdownTargetUnitId,
  type WorkspaceMarkdownCompilation,
  type WorkspaceMarkdownUpdate,
} from "./markdown-source.js";
export {
  compileWorkspaceMarkdownFile,
  compileWorkspaceMarkdownSource,
  type WorkspaceMarkdownOptions,
  type WorkspaceMarkdownCompilation,
  type WorkspaceMarkdownUpdate,
} from "./markdown-source.js";

export type WorkspaceCompileMarkdownSource =
  | { readonly file: string; readonly markdown?: never; readonly assets?: never }
  | {
      readonly markdown: string;
      readonly assets?: WorkspaceSourceFiles;
      readonly file?: never;
    };

export type WorkspaceCompileMarkdownInput = WorkspaceCompileMarkdownSource & {
  readonly title?: string;
  readonly apply?: {
    readonly worktreeId: string;
    readonly spaceId: string;
    readonly parentNodeId?: string;
    readonly idempotencyKey?: string;
  };
  readonly update?: {
    readonly worktreeId: string;
    readonly unitId: string;
    readonly sourceMap: WorkspaceMarkdownUpdate["sourceMap"];
    readonly blockIds: string[];
  };
};

export interface WorkspaceCompileMarkdownResult extends WorkspaceMarkdownCompilation {
  readonly committed: boolean;
  readonly unit?: WorkspaceUnit;
  readonly execution?: WorkspaceContentExecuteResult;
  readonly materializedSourceMap?: unknown;
}

export interface WorkspaceCompileMarkdownDependencies {
  readonly compile?: typeof compileWorkspaceMarkdownFile;
  readonly compileSource?: typeof compileWorkspaceMarkdownSource;
  readonly materializer: WorkspaceTypstMaterializer;
  readonly units: Pick<WorkspaceUnitFeature, "create">;
  readonly contentExecution: Pick<WorkspaceContentExecutionFeature, "execute">;
}

/** Compile before touching remote state; apply only valid Modern Docs to a draft. */
export class WorkspaceCompileMarkdownFeature {
  public constructor(private readonly dependencies: WorkspaceCompileMarkdownDependencies) {}

  public async execute(
    input: WorkspaceCompileMarkdownInput,
  ): Promise<WorkspaceCompileMarkdownResult> {
    if (input.apply !== undefined && input.update !== undefined) {
      throw workspaceError("workspace-argument-invalid", "Choose create or update, not both.");
    }
    if ((input.file === undefined) === (input.markdown === undefined)) {
      throw workspaceError(
        "workspace-argument-invalid",
        "Provide exactly one of a Markdown file or in-memory Markdown.",
      );
    }
    const options = {
      targetUnitId:
        input.update?.unitId ?? workspaceMarkdownTargetUnitId(input.apply?.idempotencyKey),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.update === undefined
        ? {}
        : { update: { sourceMap: input.update.sourceMap, blockIds: input.update.blockIds } }),
    };
    const compiled =
      input.file !== undefined
        ? await (this.dependencies.compile ?? compileWorkspaceMarkdownFile)(input.file, options)
        : await (this.dependencies.compileSource ?? compileWorkspaceMarkdownSource)(
            input.markdown as string,
            options,
            input.assets,
          );
    if (input.apply === undefined && input.update === undefined)
      return { ...compiled, committed: false };
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      throw workspaceError(
        "workspace-markdown-diagnostics",
        "Markdown compilation failed; no document was changed.",
        { diagnostics: errors },
      );
    }
    if (input.update !== undefined) {
      const execution = await this.dependencies.contentExecution.execute({
        code: compiled.javascript,
        unitId: input.update.unitId,
        worktreeId: input.update.worktreeId,
      });
      return {
        ...compiled,
        committed: execution.committed,
        execution,
        materializedSourceMap: sourceMapFrom(execution.value),
      };
    }
    const apply = input.apply!;
    const materialized = await this.dependencies.materializer.materialize({
      javascript: compiled.javascript,
      targetUnitId: compiled.targetUnitId,
    });
    const unit = await this.dependencies.units.create({
      type: "doc",
      name: materialized.name ?? compiled.title,
      initialData: materialized.initialData,
      spaceId: apply.spaceId,
      worktreeId: apply.worktreeId,
      ...(apply.parentNodeId === undefined ? {} : { parentNodeId: apply.parentNodeId }),
      ...(apply.idempotencyKey === undefined ? {} : { idempotencyKey: apply.idempotencyKey }),
    });
    return {
      ...compiled,
      committed: true,
      unit,
      materializedSourceMap: sourceMapFrom(materialized.value),
    };
  }
}

function sourceMapFrom(value: unknown): unknown {
  return typeof value === "object" && value !== null && "sourceMap" in value
    ? value.sourceMap
    : undefined;
}
