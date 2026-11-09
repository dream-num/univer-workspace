import type { WorkspaceSourceFiles } from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";

const references = z.object({
  pages: z.array(z.union([z.string(), z.object({ source: z.string() })])).min(1),
  prelude: z.array(z.string()).optional(),
});

// Validate the uploaded file references before the facade turns them into filesystem operations.
export function validateTypstBundle(files: WorkspaceSourceFiles): void {
  const invalid = (message: string) => workspaceError("workspace-typst-invalid", message);
  const manifest = files.get("typst.json");
  if (!manifest) throw invalid("typst.json: file not found in the bundle.");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(manifest).toString("utf8"));
  } catch (error) {
    throw invalid(`typst.json: invalid JSON. ${error instanceof Error ? error.message : ""}`);
  }
  const parsed = references.safeParse(value);
  if (!parsed.success)
    throw invalid(
      `typst.json: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  for (const path of [
    ...parsed.data.pages.map((page) => (typeof page === "string" ? page : page.source)),
    ...(parsed.data.prelude ?? []),
  ]) {
    if (
      !path ||
      path.startsWith("/") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) ||
      /[\\\0]/.test(path) ||
      path.split("/").includes("..")
    )
      throw invalid(
        `typst.json: unsafe source path ${JSON.stringify(path)}; use a bundle-relative file path without traversal.`,
      );
    const normalized = path
      .split("/")
      .filter((part) => part && part !== ".")
      .join("/");
    if (!normalized || [...files.keys()].some((file) => file.startsWith(`${normalized}/`)))
      throw invalid(`${path}: expected a source file, but this path is a directory.`);
    if (!files.has(normalized)) throw invalid(`${path}: file not found in the bundle.`);
  }
}
