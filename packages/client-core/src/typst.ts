import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  compileDocTypstBundle,
  type CompileDocTypstBundleOptions,
  type CompileDocTypstBundleResult,
} from "@univer-cli/doc-typst-facade";
import { workspaceError } from "./errors.js";
import { assertWorkspaceSourceFiles, type WorkspaceSourceFiles } from "./files.js";
import type { WorkspaceUnitFeature } from "./unit.js";
import type { WorkspaceUnit } from "./worktree-model.js";

export type WorkspaceCompileTypstSource =
  | { readonly bundlePath: string; readonly bundle?: never }
  | { readonly bundle: WorkspaceSourceFiles; readonly bundlePath?: never };

export type WorkspaceCompileTypstInput = WorkspaceCompileTypstSource & {
  readonly apply?: {
    readonly idempotencyKey?: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
    readonly worktreeId: string;
  };
  readonly previewDir?: string;
};

export interface WorkspaceCompileTypstResult extends CompileDocTypstBundleResult {
  readonly committed: boolean;
  readonly unit?: WorkspaceUnit;
}

export interface WorkspaceTypstMaterializeInput {
  readonly javascript: string;
  readonly targetUnitId: string;
}

export interface WorkspaceTypstMaterializeResult {
  readonly value?: unknown;
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
    if ((input.bundlePath === undefined) === (input.bundle === undefined)) {
      throw workspaceError(
        "workspace-argument-invalid",
        "Provide exactly one of a Typst bundle path or in-memory bundle files.",
      );
    }
    if (input.bundle !== undefined && input.previewDir !== undefined) {
      throw workspaceError(
        "workspace-argument-invalid",
        "previewDir is not supported with an in-memory Typst bundle.",
      );
    }
    const compileOptions: CompileDocTypstBundleOptions =
      input.previewDir === undefined ? {} : { previewDir: input.previewDir };
    const compiled =
      input.bundlePath !== undefined
        ? await this.compile(input.bundlePath, compileOptions)
        : await withBundleDirectory(input.bundle as WorkspaceSourceFiles, (directory) =>
            this.compile(directory, compileOptions),
          );
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
      ...(input.apply.parentNodeId === undefined ? {} : { parentNodeId: input.apply.parentNodeId }),
      ...(input.apply.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.apply.idempotencyKey }),
    });
    return { ...compiled, committed: true, unit };
  }
}

/** The facade reads a directory, so an in-memory bundle lives in a private one for the compile only. */
async function withBundleDirectory<Result>(
  files: WorkspaceSourceFiles,
  operation: (directory: string) => Promise<Result>,
): Promise<Result> {
  assertWorkspaceSourceFiles(files);
  const directory = await mkdtemp(join(tmpdir(), "workspace-typst-"));
  try {
    for (const [path, bytes] of files) {
      const target = join(directory, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
    return await operation(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
