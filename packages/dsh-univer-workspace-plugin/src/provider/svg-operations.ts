/** SVG-to-Slide adapter built solely on the public beta.2 CLI SDK. */

import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  builtinTextMeasurer,
  compileSvgToFacade,
  isSvgFacadeError,
  wrapSlideScript,
} from "@univer-cli/svg-facade";

export interface CompileSvgInput {
  readonly source: string;
  readonly sourceWorkspace: string;
  readonly page: number;
  readonly mode?: "replace" | "add";
  readonly signal?: AbortSignal;
}

export interface CompiledSvgProgram {
  readonly code: string;
  readonly lints: readonly string[];
  readonly mode: "replace" | "add";
  readonly page: number;
  readonly textMeasure: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly warnings: readonly string[];
}

/**
 * Compile an authorized SVG and wrap it in the public Slide Facade program.
 * The beta.2 SDK's deterministic text measurer is explicit in the result;
 * callers can therefore distinguish this bounded headless mode from a
 * browser-measured render operation.
 */
export async function compileSvg(input: CompileSvgInput): Promise<CompiledSvgProgram> {
  if (!Number.isSafeInteger(input.page) || input.page < 1) {
    throw new Error("SVG target page must be a positive integer");
  }
  input.signal?.throwIfAborted();
  const svg = await readFile(input.source, "utf8");
  input.signal?.throwIfAborted();
  try {
    const compiled = await compileSvgToFacade(svg, {
      textMeasurer: builtinTextMeasurer,
      assetResolver: (href) => readAsset(input.sourceWorkspace, input.source, href),
    });
    input.signal?.throwIfAborted();
    const mode = input.mode ?? "replace";
    return {
      code: wrapSlideScript(compiled.code, {
        page: input.page,
        mode,
        ...compiled.viewport,
      }),
      lints: [...compiled.lints],
      mode,
      page: input.page,
      textMeasure: compiled.textMeasure,
      viewport: compiled.viewport,
      warnings: [...compiled.warnings],
    };
  } catch (error) {
    if (isSvgFacadeError(error)) {
      throw new Error(`SVG compilation failed: ${error.message}`, { cause: error });
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function readAsset(workspace: string, source: string, href: string): { readonly bytes: Uint8Array } {
  let path: string;
  try {
    const candidate = isAbsolute(href) ? resolve(href) : resolve(dirname(source), href);
    path = realpathSync(candidate);
  } catch (error) {
    throw new Error(`Cannot read SVG asset ${JSON.stringify(href)}`, { cause: error });
  }
  const root = realpathSync(workspace);
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`SVG asset ${JSON.stringify(href)} is outside the session workspace`);
  }
  try {
    return { bytes: readFileSync(path) };
  } catch (error) {
    throw new Error(`Cannot read SVG asset ${JSON.stringify(href)}`, { cause: error });
  }
}
