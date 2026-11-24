import { workspaceError } from "./errors.js";
import { isWorkspaceRecord, type WorkspaceHttp } from "./http.js";
import { usernameKey } from "./username.js";

/** The user search hit for an exact user ID or username. Search hides unclaimed and stopped agents. */
export async function findUser(
  http: WorkspaceHttp,
  value: string,
): Promise<{ readonly id: string; readonly username: string } | undefined> {
  const body = await http.json(`/api/users/search?${new URLSearchParams({ query: value }).toString()}`);
  const candidates = body["users"];
  if (!Array.isArray(candidates) || candidates.some((candidate) =>
    !isWorkspaceRecord(candidate) || typeof candidate["id"] !== "string" || typeof candidate["username"] !== "string")) {
    throw workspaceError("workspace-invalid-response", "Workspace User search response is malformed.");
  }
  const users = candidates as readonly { readonly id: string; readonly username: string }[];
  return users.find((user) => user.id === value) ??
    users.find((user) => usernameKey(user.username) === usernameKey(value));
}
