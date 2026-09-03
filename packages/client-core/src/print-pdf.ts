import { randomUUID } from "node:crypto";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import {
  createUnitPdfPrinter,
  type UnitPdfPrintInput,
  type UnitPdfPrintResult,
} from "@univer-cli/unit-pdf-printer";
import {
  createUniverRenderRuntime,
  type UniverPrintPdfRuntime,
  type UniverRenderRuntimeOptions,
} from "@univer-cli/univer-render-runtime";
import { workspaceError } from "./errors.js";
import type { WorkspaceRenderUnitLoader } from "./render-unit.js";
import type { WorkspaceRuntimeScope } from "./runtime-target.js";

export interface WorkspacePrintPdfInput {
  readonly destination: string;
  readonly scope: WorkspaceRuntimeScope;
  readonly signal?: AbortSignal;
  readonly unitId: string;
}

export interface WorkspacePrintPdfResult {
  readonly location: string;
  readonly ok: true;
  readonly pageCount: number;
  readonly unitId: string;
  readonly unitType: UnitPdfPrintResult["unitType"];
}

export interface WorkspacePrintPdfFeatureOptions {
  readonly renderPageRoot: string;
  readonly license: string;
  readonly env: NodeJS.ProcessEnv;
  readonly loader: Pick<WorkspaceRenderUnitLoader, "loadUnit">;
  readonly createRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverPrintPdfRuntime>;
  readonly cwd?: string;
}

export interface WorkspacePrintPdfApplication {
  print(input: WorkspacePrintPdfInput): Promise<WorkspacePrintPdfResult>;
}

/** Print a materialized remote Workspace Unit through the shared browser Render Page. */
export class WorkspacePrintPdfFeature implements WorkspacePrintPdfApplication {
  readonly #createRuntime: NonNullable<WorkspacePrintPdfFeatureOptions["createRuntime"]>;
  readonly #cwd: string;

  public constructor(private readonly options: WorkspacePrintPdfFeatureOptions) {
    this.#createRuntime = options.createRuntime ?? createUniverRenderRuntime;
    this.#cwd = options.cwd ?? process.cwd();
  }

  public async print(input: WorkspacePrintPdfInput): Promise<WorkspacePrintPdfResult> {
    const location = resolve(this.#cwd, input.destination);
    if (extname(location).toLowerCase() !== ".pdf") {
      throw workspaceError(
        "workspace-print-pdf-output-invalid",
        "PDF output path must end in .pdf.",
      );
    }
    const source = await this.options.loader.loadUnit({
      scope: input.scope,
      unitId: input.unitId,
    });
    if (source.unitType === "base") {
      throw workspaceError(
        "workspace-print-pdf-type-unsupported",
        "Base Units do not support PDF printing.",
      );
    }
    const runtime = await this.#createRuntime({
      renderPageRoot: this.options.renderPageRoot,
      license: this.options.license,
      env: this.options.env,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    try {
      const printed = await createUnitPdfPrinter({ runtime }).print({
        ...source,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      } as UnitPdfPrintInput);
      await writeExclusive(location, printed.bytes);
      return {
        location,
        ok: true,
        pageCount: printed.pageCount,
        unitId: printed.unitId,
        unitType: printed.unitType,
      };
    } finally {
      await runtime.close();
    }
  }
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await link(temporary, path);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw workspaceError(
        "workspace-print-pdf-output-exists",
        `PDF output already exists: ${path}`,
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
