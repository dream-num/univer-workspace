/** Render structured transport failures without exposing request or credential objects. */
export function viewerErrorMessage(reason: unknown): string {
  const detail = errorDetail(reason, 0);
  return detail ?? "Unable to load this document. Try again or reconnect to Workspace.";
}

function errorDetail(reason: unknown, depth: number): string | undefined {
  if (depth > 3) return undefined;
  if (typeof reason === "string") {
    const message = reason.trim();
    return message !== "" && !message.includes("[object Object]") ? message : undefined;
  }
  if (reason === null || typeof reason !== "object") return undefined;
  const value = reason as Record<string, unknown>;
  const message = errorDetail(value.message, depth + 1)
    ?? errorDetail(value.error, depth + 1)
    ?? errorDetail(value.cause, depth + 1);
  if (message !== undefined) return message;
  if (typeof value.status === "number" && value.status >= 400 && value.status <= 599) {
    return `Document request failed (HTTP ${value.status}). Try again or reconnect to Workspace.`;
  }
  return undefined;
}
