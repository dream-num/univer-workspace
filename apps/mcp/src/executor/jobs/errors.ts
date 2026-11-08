// SDK ExchangeErrorCode values. Keep this boundary independent of native imports.
const exchangeCodes = new Set([
  "INVALID_ARGUMENT",
  "UNSUPPORTED_FORMAT",
  "INVALID_FILE",
  "INCOMPLETE_SNAPSHOT",
  "IO_ERROR",
  "NATIVE_LOAD_FAILED",
  "CONVERSION_FAILED",
  "workspace-import-too-large",
  "workspace-typst-invalid",
  "workspace-typst-diagnostics",
]);

export function conversionError(code: string, message: string) {
  return {
    code:
      exchangeCodes.has(code) || /^LICENSE_[A-Z0-9_]+$/.test(code)
        ? code
        : "workspace-exchange-conversion-failed",
    message: scrubAbsolutePaths(message),
  };
}

function scrubAbsolutePaths(text: string): string {
  return text.replace(
    /(^|[\s("'=])(?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^\r\n"'<>)]*/g,
    "$1[path]",
  );
}

/** All child error and diagnostic text crosses this boundary before reaching a caller. */
export function rewriteJobPaths(value: unknown, directories: readonly string[]): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const directory of directories) {
      const escaped = directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(
        new RegExp(`(?:file://)?${escaped}/(?:(?:workspace-typst-[^/\\s]+/)|(?:dac-typst-eval-[^/\\s]+/dac/))*`, "g"),
        "",
      );
    }
    return scrubAbsolutePaths(text);
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteJobPaths(entry, directories));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteJobPaths(entry, directories)]),
    );
  return value;
}
