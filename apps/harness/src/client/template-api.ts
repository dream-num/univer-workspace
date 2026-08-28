import { UWH_LOGIN_PATH, UWH_TEMPLATE_FORK_PATH, type UwhTemplate } from "../contract.ts";

/** Fork one configured Harness template through the authenticated host route. */
export async function forkTemplate(template: UwhTemplate): Promise<string> {
  const response = await fetch(UWH_TEMPLATE_FORK_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ key: template.key }),
  });
  if (response.status === 401) {
    window.location.assign(UWH_LOGIN_PATH);
    throw new Error("authentication_required");
  }
  if (!response.ok) throw new Error("template_fork_failed");
  const payload = await response.json() as { sessionId?: unknown };
  if (typeof payload.sessionId !== "string" || payload.sessionId === "") {
    throw new Error("template_fork_failed");
  }
  return payload.sessionId;
}
