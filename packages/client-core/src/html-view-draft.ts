import { workspaceError } from "./errors.js";
import { isWorkspaceRecord, type AuthenticatedWorkspaceHttp } from "./http.js";
import { htmlViewUrls } from "./html-view-page.js";

export type WorkspaceHtmlViewDraftStatus =
  | { readonly state: "pending" | "rejected" | "expired" | "conflicted" }
  | { readonly state: "published"; readonly nodeId: string; readonly resourceId: string;
      readonly etag: string; readonly shareUrl: string; readonly workspaceUrl: string };

export interface WorkspaceHtmlViewDraft {
  readonly id: string;
  readonly kind: "create" | "replace";
  readonly name: string;
  readonly spaceId: string;
  readonly targetResourceId: string | null;
  readonly previewUrl: string;
  readonly expiresAt: string;
  readonly status: WorkspaceHtmlViewDraftStatus;
}

export function htmlViewDraftUrl(origin: string, id: string): string {
  return new URL(`/drafts/${encodeURIComponent(id)}`, origin).href;
}

export async function readWorkspaceHtmlViewDraft(
  authenticatedHttp: AuthenticatedWorkspaceHttp,
  origin: string,
  id: string,
): Promise<WorkspaceHtmlViewDraft> {
  const http = await authenticatedHttp();
  const body = await http.json(`/api/html-view-drafts/${encodeURIComponent(id)}`);
  const draft = parseHtmlViewDraft(body["draft"], origin);
  if (draft.id !== id) throw workspaceError("workspace-result-mismatch", "HTML View draft ID does not match the request.");
  return draft;
}

export function parseHtmlViewDraft(value: unknown, origin: string): WorkspaceHtmlViewDraft {
  const invalid = () => workspaceError("workspace-invalid-response", "Workspace returned an invalid HTML View draft.");
  if (!isWorkspaceRecord(value)) throw invalid();
  const string = (key: string): string => {
    const field = value[key];
    if (typeof field !== "string" || !field) throw invalid();
    return field;
  };
  const kind = value["kind"];
  const state = value["state"];
  const targetResourceId = value["targetResourceId"];
  if (kind !== "create" && kind !== "replace") throw invalid();
  if (kind === "create" ? targetResourceId !== null : typeof targetResourceId !== "string" || !targetResourceId) throw invalid();
  let status: WorkspaceHtmlViewDraftStatus;
  if (state === "published") {
    const published = value["published"];
    if (!isWorkspaceRecord(published) || typeof published["nodeId"] !== "string" || !published["nodeId"] ||
        typeof published["resourceId"] !== "string" || !published["resourceId"] ||
        typeof published["etag"] !== "string" || published["etag"].length > 200 || !/^"[^"\r\n]+"$/.test(published["etag"])) throw invalid();
    status = { state, nodeId: published["nodeId"], resourceId: published["resourceId"], etag: published["etag"],
      ...htmlViewUrls(origin, published["nodeId"]) };
  } else if (state === "pending" || state === "rejected" || state === "expired" || state === "conflicted") {
    if (value["published"] !== null) throw invalid();
    status = { state };
  } else throw invalid();
  const id = string("id");
  return { id, kind, name: string("name"), spaceId: string("spaceId"),
    targetResourceId: typeof targetResourceId === "string" ? targetResourceId : null,
    previewUrl: htmlViewDraftUrl(origin, id), expiresAt: string("expiresAt"), status };
}
