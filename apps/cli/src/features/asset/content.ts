import { workspaceError } from "../../errors.js";
import { isWorkspaceRecord, type WorkspaceHttp } from "../../transport/http.js";

export async function resolveWorkspaceAssetContent(
  http: WorkspaceHttp,
  input: { readonly assetId: string; readonly signal?: AbortSignal; readonly worktreeId: string },
): Promise<Response> {
  const body = await http.json(
    `/universer-api/worktrees/${encodeURIComponent(input.worktreeId)}/file/${encodeURIComponent(input.assetId)}/sign-url`,
    input.signal === undefined ? {} : { signal: input.signal },
  );
  const serviceError = body["error"];
  if (
    !isWorkspaceRecord(serviceError) ||
    (typeof serviceError["code"] !== "string" && typeof serviceError["code"] !== "number") ||
    typeof serviceError["message"] !== "string"
  ) {
    throw workspaceError(
      "workspace-invalid-response",
      "Workspace Asset sign response contains an invalid error envelope.",
    );
  }
  if (serviceError["code"] !== 1) {
    throw workspaceError(
      String(serviceError["code"]),
      serviceError["message"] || "Workspace Asset could not be resolved.",
    );
  }
  return await http.content(
    contentUrl(body["url"], http.origin),
    input.signal === undefined ? undefined : input.signal,
  );
}

function contentUrl(value: unknown, origin: string): URL {
  if (typeof value !== "string" || value === "") {
    throw workspaceError(
      "workspace-invalid-response",
      "Workspace Asset sign response is missing a content URL.",
    );
  }
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    throw workspaceError(
      "workspace-invalid-response",
      "Workspace Asset sign response contains an invalid content URL.",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw workspaceError(
      "workspace-invalid-response",
      "Workspace Asset content URL must use HTTP(S) without credentials.",
    );
  }
  return url;
}
