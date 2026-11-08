import { workspaceError } from "@univerjs/univer-workspace-client-core/product";

/** Keep the facade's input diagnostics local to Markdown operations. */
export async function markdownOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && error.name === "DocMarkdownCompileError") {
      const diagnostics = "diagnostics" in error ? error.diagnostics : undefined;
      const hasCode = (code: string) =>
        Array.isArray(diagnostics) && diagnostics.some((diagnostic) => diagnostic?.code === code);
      if (hasCode("DOC_MARKDOWN_READ_RESULT_INVALID"))
        throw workspaceError(
          "workspace-runtime-result-invalid",
          "The runtime returned an invalid result.",
        );
      if (hasCode("DOC_MARKDOWN_READ_ASSET_UNAVAILABLE"))
        throw workspaceError("workspace-markdown-asset-unavailable", error.message, {
          diagnostics,
          retryable: true,
        });
      throw workspaceError(
        "workspace-markdown-invalid",
        error.message,
        "diagnostics" in error ? { diagnostics: error.diagnostics } : undefined,
      );
    }
    throw error;
  }
}
