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
import { workspaceError } from "./errors.js";
import type { WorkspaceRenderUnitLoader, WorkspaceRenderUnitLoadInput } from "./render-unit.js";

export interface WorkspaceScreenshotWriteInput {
  readonly destination?: string;
  readonly result: UnitScreenshotResult;
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
    const runtime = await this.#createRuntime({
      renderPageRoot: this.options.renderPageRoot,
      license: this.options.license,
      env: this.options.env,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    try {
      return await createUnitScreenshot({ runtime }).capture(input);
    } finally {
      await runtime.close();
    }
  }

  public async writeImages(
    input: WorkspaceScreenshotWriteInput,
  ): Promise<readonly WorkspaceScreenshotWrittenImage[]> {
    const directory = resolve(this.#cwd, input.destination ?? "screenshots");
    await mkdir(directory, { recursive: true });
    const outputs = input.result.images.map((image) => {
      if (basename(image.name) !== image.name || image.name === "." || image.name === "..") {
        throw workspaceError(
          "workspace-screenshot-output-invalid",
          `Screenshot image name is unsafe: ${image.name}`,
        );
      }
      return { image, path: join(directory, image.name) };
    });
    for (const output of outputs) {
      if (await pathExists(output.path)) {
        throw workspaceError(
          "workspace-screenshot-output-exists",
          `Screenshot output already exists: ${output.path}`,
        );
      }
    }
    for (const output of outputs) await writeExclusive(output.path, output.image.bytes);
    return outputs.map(({ image, path }) => ({ location: path, name: image.name }));
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

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await link(temporary, path);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw workspaceError(
        "workspace-screenshot-output-exists",
        `Screenshot output already exists: ${path}`,
      );
    }
    throw error;
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
