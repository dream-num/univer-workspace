import { randomUUID } from "node:crypto";

/** Correlation id safe to copy from a browser error into Pod logs. */
export function diagnosticId(): string {
  return randomUUID();
}

/** Emit one structured line collected by Docker/Kubernetes stderr. */
export function logDiagnostic(event: string, details: Record<string, unknown>): string {
  const id = typeof details.diagnosticId === "string" ? details.diagnosticId : diagnosticId();
  console.error(`[uwh] ${JSON.stringify({ event, diagnosticId: id, ...details, at: new Date().toISOString() })}`);
  return id;
}

/** Attach a correlation id to every server-side 5xx response. */
export function responseErrorBody(status: number, body: unknown): unknown {
  if (status < 500) return body;
  const id = logDiagnostic("http-error", { status, body: typeof body === "string" ? body : undefined });
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), diagnosticId: id };
  }
  return { error: String(body), diagnosticId: id };
}
