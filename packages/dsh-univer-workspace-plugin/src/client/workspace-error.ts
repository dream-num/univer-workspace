export function workspaceErrorMessage(body: unknown, status: number, workspaceOrigin: string): string {
  const error = body !== null && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : undefined;
  if (typeof error === "string") return error;
  const { message, url } = error !== null && typeof error === "object" ? (error as { message?: unknown; url?: unknown }) : {};
  const text = typeof message === "string" ? message : `Workspace request failed (${status})`;
  const link = confirmLink(url, workspaceOrigin);
  return link === undefined ? text : `${text} Confirm it in Workspace: ${link}`;
}

function confirmLink(raw: unknown, workspaceOrigin: string): string | undefined {
  if (typeof raw !== "string" || workspaceOrigin === "") return undefined;
  try {
    const url = new URL(raw, workspaceOrigin);
    return url.origin === new URL(workspaceOrigin).origin ? url.href : undefined;
  } catch {
    return undefined;
  }
}
