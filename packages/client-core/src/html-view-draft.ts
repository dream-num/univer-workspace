import { workspaceError } from "./errors.js";
import { isWorkspaceRecord, type AuthenticatedWorkspaceHttp } from "./http.js";
import { htmlViewUrls } from "./html-view-page.js";

export type WorkspaceHtmlViewDraftStatus =
  | { readonly state: "pending" | "rejected" | "expired" | "conflicted" }
  | { readonly state: "superseded"; readonly supersededBy: string; readonly successorUrl: string }
  | { readonly state: "published"; readonly nodeId: string; readonly resourceId: string;
      readonly etag: string; readonly shareUrl: string; readonly workspaceUrl: string };

export interface WorkspaceHtmlViewDraft {
  readonly id: string;
  readonly kind: "create" | "replace";
  readonly name: string;
  readonly spaceId: string;
  readonly targetResourceId: string | null;
  readonly sourceWorktreeId?: string | null;
  readonly publishWhen?: "merge" | "publish";
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

/**
 * The author's newest pending draft of a page, or of another file, attached to a Worktree: the file as that pull
 * request, or the fork it belongs to, shows it. `baseEtag` is the ETag of the file it replaces, which is still
 * current while it is pending.
 */
export async function findWorkspaceHtmlViewDraft(
  authenticatedHttp: AuthenticatedWorkspaceHttp,
  origin: string,
  input: { readonly worktreeId: string; readonly resourceId: string; readonly authorId: string },
): Promise<(WorkspaceHtmlViewDraft & { readonly baseEtag: string }) | undefined> {
  const body = await (await authenticatedHttp()).json(`/api/worktrees/${encodeURIComponent(input.worktreeId)}/html-view-drafts`);
  if (!Array.isArray(body["drafts"])) throw workspaceError("workspace-invalid-response", "Workspace response is missing drafts.");
  const found = body["drafts"].filter((value: unknown) =>
    isWorkspaceRecord(value) && value["state"] === "pending" && value["targetResourceId"] === input.resourceId &&
    isWorkspaceRecord(value["author"]) && value["author"]["id"] === input.authorId).at(-1) as Record<string, unknown> | undefined;
  if (found === undefined) return undefined;
  const baseEtag = found["baseEtag"];
  if (typeof baseEtag !== "string" || !/^"[^"\r\n]+"$/.test(baseEtag))
    throw workspaceError("workspace-invalid-response", "Workspace returned an invalid HTML View draft.");
  return { ...parseHtmlViewDraft(found, origin), baseEtag };
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
  const sourceWorktreeId = value["sourceWorktreeId"];
  if (sourceWorktreeId !== undefined && sourceWorktreeId !== null &&
      (typeof sourceWorktreeId !== "string" || !sourceWorktreeId)) throw invalid();
  const publishWhen = value["publishWhen"];
  if (publishWhen !== undefined && publishWhen !== "merge" && publishWhen !== "publish") throw invalid();
  let status: WorkspaceHtmlViewDraftStatus;
  if (state === "published") {
    const published = value["published"];
    if (!isWorkspaceRecord(published) || typeof published["nodeId"] !== "string" || !published["nodeId"] ||
        typeof published["resourceId"] !== "string" || !published["resourceId"] ||
        typeof published["etag"] !== "string" || published["etag"].length > 200 || !/^"[^"\r\n]+"$/.test(published["etag"])) throw invalid();
    status = { state, nodeId: published["nodeId"], resourceId: published["resourceId"], etag: published["etag"],
      ...htmlViewUrls(origin, published["nodeId"]) };
  } else if (state === "superseded") {
    if (value["published"] !== null) throw invalid();
    const supersededBy = string("supersededBy");
    status = { state, supersededBy, successorUrl: htmlViewDraftUrl(origin, supersededBy) };
  } else if (state === "pending" || state === "rejected" || state === "expired" || state === "conflicted") {
    if (value["published"] !== null) throw invalid();
    status = { state };
  } else throw invalid();
  const id = string("id");
  return { id, kind, ...(publishWhen === undefined ? {} : { publishWhen }), ...(sourceWorktreeId === undefined ? {} : { sourceWorktreeId }), name: string("name"), spaceId: string("spaceId"),
    targetResourceId: typeof targetResourceId === "string" ? targetResourceId : null,
    previewUrl: htmlViewDraftUrl(origin, id), expiresAt: string("expiresAt"), status };
}

export async function readWorkspaceHtmlViewDraftContent(
  authenticatedHttp: AuthenticatedWorkspaceHttp,
  origin: string,
  id: string,
  maxChars: number,
) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 0)
    throw workspaceError("workspace-argument-invalid", "HTML View read limit must be a nonnegative integer.");
  const draft = await readWorkspaceHtmlViewDraft(authenticatedHttp, origin, id);
  if (draft.status.state !== "pending")
    throw workspaceError("workspace-conflict", `Draft is ${draft.status.state}.${draft.status.state === "superseded" ? ` Successor draft: ${draft.status.supersededBy}.` : ""}`);
  const response = await (await authenticatedHttp()).request(`/api/html-view-drafts/${encodeURIComponent(id)}/content`);
  const reader = response.body?.getReader();
  if (!reader) throw workspaceError("workspace-invalid-response", "Draft content is missing.");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let html = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (html.length > maxChars)
        throw workspaceError("workspace-result-too-large", "HTML View draft is too large to revise inline.");
    }
    html += decoder.decode();
    if (JSON.stringify(html).length - 2 > maxChars)
      throw workspaceError("workspace-result-too-large", "HTML View draft is too large to revise inline.");
    return { draft, html };
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
