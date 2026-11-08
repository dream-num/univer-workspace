import { workspaceError } from "@univerjs/univer-workspace-client-core/product";

/** Keep the facade's input diagnostics local to Markdown operations. */
export async function markdownOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && error.name === "DocMarkdownCompileError")
      throw workspaceError(
        "workspace-markdown-invalid",
        error.message,
        "diagnostics" in error ? { diagnostics: error.diagnostics } : undefined,
      );
    throw error;
  }
}
