import { readFile } from "node:fs/promises";
import { parseDocMarkdownSourceMap } from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "../../errors.js";

export async function readMarkdownSourceMap(
  path: string,
): Promise<ReturnType<typeof parseDocMarkdownSourceMap>> {
  const text = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw workspaceError(
      "workspace-argument-invalid",
      `Invalid --source-map JSON in ${path}: ${error.message}`,
    );
  }
  return parseDocMarkdownSourceMap(value);
}
