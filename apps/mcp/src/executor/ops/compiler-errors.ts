import { workspaceError } from "@univerjs/univer-workspace-client-core/product";

export async function compilerOperation<T>(
  format: "typst" | "svg",
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const names =
      format === "typst" ? ["DocTypstFacadeError", "DaCTypstTranslationError"] : ["SvgFacadeError"];
    if (error instanceof Error && names.includes(error.name))
      throw workspaceError(
        `workspace-${format}-invalid`,
        error.message,
        "diagnostics" in error ? { diagnostics: error.diagnostics } : undefined,
      );
    throw error;
  }
}
