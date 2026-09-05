import { WORKSPACE_TEMPLATE_FORK_PATH, type WorkspaceTemplate } from "./workspace-contract.ts";

/** Fork one configured Harness template through the authenticated host route. */
export async function forkTemplate(template: WorkspaceTemplate): Promise<string> {
  const response = await fetch(WORKSPACE_TEMPLATE_FORK_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ key: template.key }),
  });
  if (response.status === 401) {
    throw new Error("workspace_connection_required");
  }
  if (!response.ok) throw new Error("template_fork_failed");
  const payload = (await response.json()) as { sessionId?: unknown };
  if (typeof payload.sessionId !== "string" || payload.sessionId === "") {
    throw new Error("template_fork_failed");
  }
  return payload.sessionId;
}
