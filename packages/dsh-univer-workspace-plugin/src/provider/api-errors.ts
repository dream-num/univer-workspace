/**
 * Shared HTTP response errors and narrow helpers for Workspace providers.
 * @module dsh-univer-workspace-plugin/provider/api-errors
 */

/** An unexpected Workspace API response. */
export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

/** Parse a JSON response or throw a typed error. */
export async function readJson(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new WorkspaceApiError(
      `workspace ${operation} failed: ${body.error?.message ?? response.statusText}`,
      response.status,
      body.error?.code ?? "WORKSPACE_ERROR",
    );
  }
  return response.json() as unknown;
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function accessRole(value: unknown): "owner" | "admin" | "editor" | "viewer" {
  return value === "owner" || value === "admin" || value === "editor" || value === "viewer"
    ? value
    : "viewer";
}
