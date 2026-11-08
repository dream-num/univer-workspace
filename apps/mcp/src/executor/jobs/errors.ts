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
    message: code.startsWith("workspace-typst-")
      ? message
      : message.replace(/(?:file:\/\/)?\/[^\r\n"'<>]+|[A-Za-z]:[\\/][^\r\n"'<>]+/g, "[path]"),
  };
}
