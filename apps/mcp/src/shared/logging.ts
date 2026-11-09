export const credentialRedactions = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "executorToken",
  "*.executorToken",
  "rendererToken",
  "*.rendererToken",
  "grant",
  "*.grant",
  "session",
  "*.session",
  "MCP_EXECUTOR_TOKEN",
  "*.MCP_EXECUTOR_TOKEN",
  "MCP_RENDERER_TOKEN",
  "*.MCP_RENDERER_TOKEN",
  "MCP_EXECUTOR_ALLOWED_USER_IDS",
  "*.MCP_EXECUTOR_ALLOWED_USER_IDS",
  "UNIVER_LICENSE",
  "UNIVER_LICENSE_KEY",
  "METRICS_TOKEN",
  "MCP_OAUTH_CLIENT_SECRET",
];

// Error messages, stacks and paths may contain credentials or document contents.
export function safeErrorFields(error: unknown) {
  const fields: { error_name: string; code?: string; syscall?: string } = {
    error_name: error instanceof Error ? error.constructor.name : "UnknownError",
  };
  if (!(error instanceof Error)) return fields;
  const source = error.cause instanceof Error ? error.cause : error;
  if ("code" in source && typeof source.code === "string" && /^[\w.-]{1,128}$/.test(source.code))
    fields.code = source.code;
  if (
    "syscall" in source &&
    typeof source.syscall === "string" &&
    /^[\w.-]{1,128}$/.test(source.syscall)
  )
    fields.syscall = source.syscall;
  return fields;
}

export function isClientAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      ("code" in error &&
        (error.code === "ECONNRESET" || error.code === "ERR_STREAM_PREMATURE_CLOSE")))
  );
}
