import {
  WORKSPACE_LOGIN_PATH,
  WORKSPACE_SPACES_PATH,
  WORKSPACE_SPACE_MUTATION_PATH,
  type WorkspaceSpace,
  type WorkspaceSpaceList,
  type WorkspaceSpaceRenameResult,
} from "./workspace-contract.ts";

function parseSpace(value: unknown): WorkspaceSpace | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.spaceId !== "string" || record.spaceId === "") return undefined;
  if (record.type !== "personal" && record.type !== "team") return undefined;
  if (typeof record.name !== "string" || record.name === "") return undefined;
  if (record.accessRole !== "owner" && record.accessRole !== "admin"
    && record.accessRole !== "editor" && record.accessRole !== "viewer") return undefined;
  if (typeof record.dshWorkspaceId !== "string" || record.dshWorkspaceId === "") return undefined;
  return {
    spaceId: record.spaceId,
    type: record.type,
    name: record.name,
    accessRole: record.accessRole,
    dshWorkspaceId: record.dshWorkspaceId,
  };
}

/** Load the authenticated user's product Spaces and their DSH carriers. */
export async function fetchWorkspaceSpaces(): Promise<readonly WorkspaceSpace[]> {
  const response = await fetch(WORKSPACE_SPACES_PATH, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (response.status === 401) {
    window.location.assign(WORKSPACE_LOGIN_PATH);
    throw new Error("authentication_required");
  }
  if (!response.ok) {
    let diagnosticId = "";
    try {
      const body = await response.json() as { diagnosticId?: unknown };
      if (typeof body.diagnosticId === "string") diagnosticId = `:${body.diagnosticId}`;
    } catch { /* retain stable fallback */ }
    throw new Error(`space_list_failed${diagnosticId}`);
  }
  const payload = await response.json() as Partial<WorkspaceSpaceList>;
  if (!Array.isArray(payload.spaces)) throw new Error("space_list_failed");
  const spaces = payload.spaces.map(parseSpace);
  if (spaces.some(space => space === undefined)) throw new Error("space_list_failed");
  return spaces as readonly WorkspaceSpace[];
}

/** Rename one Space through the Harness proxy; no Workspace credential enters the browser. */
export async function renameWorkspaceSpace(spaceId: string, name: string): Promise<WorkspaceSpaceRenameResult> {
  const response = await fetch(`${WORKSPACE_SPACE_MUTATION_PATH}/${encodeURIComponent(spaceId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (response.status === 401) {
    window.location.assign(WORKSPACE_LOGIN_PATH);
    throw new Error("authentication_required");
  }
  if (response.status === 400) throw new Error("space_name_invalid");
  if (response.status === 403) throw new Error("space_rename_forbidden");
  if (response.status === 404) throw new Error("space_not_found");
  if (!response.ok) throw new Error("space_rename_failed");
  const payload = await response.json() as Partial<WorkspaceSpaceRenameResult>;
  if (payload.space === undefined || payload.space.spaceId !== spaceId
    || typeof payload.space.name !== "string" || payload.space.name === "") {
    throw new Error("space_rename_failed");
  }
  return payload as WorkspaceSpaceRenameResult;
}
