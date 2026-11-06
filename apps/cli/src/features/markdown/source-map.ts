import { readFile } from "node:fs/promises";
import { parseDocMarkdownSourceMap } from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "../../errors.js";

export async function readMarkdownSourceMap(
  file: string,
): Promise<ReturnType<typeof parseDocMarkdownSourceMap>> {
  const content = await readFile(file, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw workspaceError("workspace-argument-invalid", `Source map ${file} is not valid JSON.`);
  }
  return parseDocMarkdownSourceMap(value);
}
