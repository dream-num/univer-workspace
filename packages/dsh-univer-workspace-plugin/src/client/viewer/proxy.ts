/** Same-origin proxy URL construction for one embedded Viewer scope. */

import {
  WorktreeClient,
  createWorktreeMergePreviewConfig,
  type WorktreeMergePreviewConfig,
} from "@univerjs-pro/collaboration-worktree-client";

/** The proxy prefix served by the harness host-side collaboration route. */
export const PROXY_PREFIX = "/univer-workspace/collab";

const PROXY_WS_CONNECT = `${PROXY_PREFIX}/connect`;

export interface ViewerUrls {
  readonly snapshotServerUrl: string;
  readonly collabSubmitChangesetUrl: string;
  readonly collabWebSocketUrl: string;
  readonly wsSessionTicketUrl: string;
  readonly authzUrl: string;
  readonly uploadFileServerUrl: string;
  readonly signUrlServerUrl: string;
  readonly getTaskServerUrl: string;
  readonly importServerUrl: string;
  readonly exportServerUrl: string;
  readonly downloadEndpointUrl: string;
}

export type ViewerMergePreviewConfig = WorktreeMergePreviewConfig;

function proxied(path: string): string {
  return `${PROXY_PREFIX}${path}`;
}

function proxiedWebSocket(workspacePath: string): string {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${window.location.host}${PROXY_WS_CONNECT}?target=${encodeURIComponent(workspacePath)}`;
}

function sameOriginRoot(): string {
  const origin = window.location.origin;
  if (typeof origin === "string" && origin.length > 0) return `${origin}/`;
  return `${window.location.protocol}//${window.location.host}/`;
}

/**
 * Build the collaboration-client endpoint set for a trunk or worktree view.
 * Keeping this in a small pure-ish module makes transport changes independent
 * from the Univer runtime composition.
 */
export function buildViewerUrls(worktreeId?: string): ViewerUrls {
  const worktreeSeg =
    worktreeId !== undefined ? `/worktrees/${encodeURIComponent(worktreeId)}` : "";
  const base = `${PROXY_PREFIX}/universer-api${worktreeSeg}`;
  return {
    snapshotServerUrl: `${base}/snapshot`,
    collabSubmitChangesetUrl: `${base}/comb`,
    collabWebSocketUrl: proxiedWebSocket(`/universer-api${worktreeSeg}/comb/connect`),
    wsSessionTicketUrl: proxied("/universer-api/user/session-ticket"),
    authzUrl: proxied("/universer-api/authz"),
    uploadFileServerUrl: `${base}/stream/file/upload`,
    signUrlServerUrl: `${base}/file/{fileID}/sign-url`,
    getTaskServerUrl: proxied(`${basePath(worktreeSeg)}/exchange/task/{taskID}`),
    importServerUrl: proxied(`${basePath(worktreeSeg)}/exchange/{type}/import`),
    exportServerUrl: proxied(`${basePath(worktreeSeg)}/exchange/{type}/export`),
    downloadEndpointUrl: sameOriginRoot(),
  };
}

/**
 * Resolve the immutable snapshot used by a ready Worktree Viewer.
 *
 * The Workspace merge evaluator is the authority for this snapshot.  The
 * Worktree SDK performs the response validation and binary Sheet-block
 * decoding; its request is routed through the DSH collaboration proxy so the
 * browser never receives or stores the upstream Workspace credential.
 * `undefined` means the evaluator found no delta (`not-behind`), in which case
 * the regular Worktree snapshot remains the canonical source.
 */
export async function loadViewerMergePreviewConfig(
  worktreeId: string,
  unitId: string,
): Promise<ViewerMergePreviewConfig | undefined> {
  const client = new WorktreeClient({
    origin: window.location.origin,
    fetch: proxyFetch,
  });
  const evaluation = await client.evaluateUnitMerge(worktreeId, unitId);
  if (evaluation.status === "not-behind") return undefined;
  if (evaluation.status !== "preview") {
    throw new Error(mergePreviewFailure(evaluation.status));
  }
  return createWorktreeMergePreviewConfig({
    origin: window.location.origin,
    worktreeID: worktreeId,
    preview: evaluation.preview,
  });
}

function proxyFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const target = new URL(rawUrl, window.location.origin);
  if (
    target.origin === window.location.origin &&
    (target.pathname === "/universer-api" || target.pathname.startsWith("/universer-api/"))
  ) {
    target.pathname = `${PROXY_PREFIX}${target.pathname}`;
  }
  return fetch(target, init);
}

function mergePreviewFailure(status: string): string {
  if (status === "conflict") return "The Worktree has a merge conflict; preview is unavailable.";
  if (status === "already-merged")
    return "The Worktree has already been merged; preview is unavailable.";
  if (status === "not-applicable") return "This Worktree Unit has no merge preview.";
  return "The Worktree merge preview is unavailable.";
}

function basePath(worktreeSeg: string): string {
  return `/universer-api${worktreeSeg}`;
}
