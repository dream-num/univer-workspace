import { randomUUID } from "node:crypto";
import { access, link, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  createUnitScreenshot,
  type UnitScreenshotInput,
  type UnitScreenshotResult,
} from "@univer-cli/unit-screenshot";
import {
  createUniverRenderRuntime,
  type UniverRenderRuntime,
  type UniverRenderRuntimeOptions,
  type UniverRenderUnit,
} from "@univer-cli/univer-render-runtime";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import {
  awaitRenderOperation,
  type WorkspaceRenderUnitLoader,
  type WorkspaceRenderUnitLoadInput,
} from "./render-unit.js";

export interface WorkspaceScreenshotWriteInput {
  readonly destination?: string;
  readonly result: UnitScreenshotResult;
  readonly signal?: AbortSignal;
}

export interface WorkspaceScreenshotWrittenImage {
  readonly location: string;
  readonly name: string;
}

export interface WorkspaceScreenshotFeatureOptions {
  readonly renderPageRoot: string;
  readonly license: string;
  readonly env: NodeJS.ProcessEnv;
  readonly loader: Pick<WorkspaceRenderUnitLoader, "loadUnit">;
  readonly createRuntime?: (options: UniverRenderRuntimeOptions) => Promise<UniverRenderRuntime>;
  readonly cwd?: string;
}

export interface WorkspaceScreenshotApplication {
  capture(input: UnitScreenshotInput): Promise<UnitScreenshotResult>;
  loadUnit(input: WorkspaceRenderUnitLoadInput): Promise<UniverRenderUnit>;
  writeImages(
    input: WorkspaceScreenshotWriteInput,
  ): Promise<readonly WorkspaceScreenshotWrittenImage[]>;
}

export class WorkspaceScreenshotFeature implements WorkspaceScreenshotApplication {
  readonly #createRuntime: NonNullable<WorkspaceScreenshotFeatureOptions["createRuntime"]>;
  readonly #cwd: string;

  public constructor(private readonly options: WorkspaceScreenshotFeatureOptions) {
    this.#createRuntime = options.createRuntime ?? createUniverRenderRuntime;
    this.#cwd = options.cwd ?? process.cwd();
  }

  public async loadUnit(input: WorkspaceRenderUnitLoadInput): Promise<UniverRenderUnit> {
    return await this.options.loader.loadUnit(input);
  }

  public async capture(input: UnitScreenshotInput): Promise<UnitScreenshotResult> {
    input.signal?.throwIfAborted();
    let runtime: UniverRenderRuntime;
    try {
      runtime = await this.#createRuntime({
        renderPageRoot: this.options.renderPageRoot,
        license: this.options.license,
        env: this.options.env,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error) {
      input.signal?.throwIfAborted();
      throw error;
    }
    let failed = false;
    try {
      input.signal?.throwIfAborted();
      return await awaitRenderOperation(createUnitScreenshot({ runtime }).capture(input), input.signal);
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
  }

  public async writeImages(
    input: WorkspaceScreenshotWriteInput,
  ): Promise<readonly WorkspaceScreenshotWrittenImage[]> {
    input.signal?.throwIfAborted();
    const directory = resolve(this.#cwd, input.destination ?? "screenshots");
    await mkdir(directory, { recursive: true });
    input.signal?.throwIfAborted();
    const outputs = input.result.images.map((image) => {
      if (basename(image.name) !== image.name || image.name === "." || image.name === "..") {
        throw workspaceError(
          "workspace-screenshot-output-invalid",
          `Screenshot image name is unsafe: ${image.name}`,
        );
      }
      return { image, path: join(directory, image.name) };
    });
    input.signal?.throwIfAborted();
    for (const output of outputs) {
      input.signal?.throwIfAborted();
      if (await pathExists(output.path)) {
        throw workspaceError(
          "workspace-screenshot-output-exists",
          `Screenshot output already exists: ${output.path}`,
        );
      }
      input.signal?.throwIfAborted();
    }
    const committedOutputs: WorkspaceScreenshotWrittenImage[] = [];
    try {
      for (const output of outputs) {
        input.signal?.throwIfAborted();
        await writeExclusive(output.path, output.image.bytes, input.signal, () => {
          committedOutputs.push({ location: output.path, name: output.image.name });
        });
      }
      return committedOutputs;
    } catch (error) {
      if (input.signal === undefined || committedOutputs.length === 0) throw error;
      throw workspaceError(
        "workspace-screenshot-output-partial",
        "Some screenshot outputs were committed. Inspect the listed files before retrying.",
        {
          totalOutputCount: outputs.length,
          committedOutputCount: committedOutputs.length,
          committedOutputs,
          causeCode: partialOutputCauseCode(error, input.signal),
        },
      );
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeExclusive(
  path: string,
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
  committed: () => void,
): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  let failure: unknown;
  let failed = false;
  try {
    signal?.throwIfAborted();
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    signal?.throwIfAborted();
    await link(temporary, path);
    committed();
    signal?.throwIfAborted();
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      failure = workspaceError(
        "workspace-screenshot-output-exists",
        `Screenshot output already exists: ${path}`,
      );
    } else {
      failure = error;
    }
    failed = true;
  } finally {
    try {
      signal?.throwIfAborted();
    } catch (error) {
      failure = error;
      failed = true;
    }
    try {
      await unlink(temporary);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        failure = error;
        failed = true;
      }
    }
    try {
      signal?.throwIfAborted();
    } catch (error) {
      failure = error;
      failed = true;
    }
  }
  if (failed) throw failure;
}

function partialOutputCauseCode(
  error: unknown,
  signal: AbortSignal,
): "ABORTED" | "workspace-screenshot-output-exists" | "workspace-screenshot-output-failed" {
  if (signal.aborted) return "ABORTED";
  if (
    error instanceof WorkspaceApplicationError &&
    error.code === "workspace-screenshot-output-exists"
  ) {
    return "workspace-screenshot-output-exists";
  }
  return "workspace-screenshot-output-failed";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
