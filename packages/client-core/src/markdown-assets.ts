import type { DocMarkdownAsset } from "@univer-cli/doc-markdown-facade";
import { workspaceError } from "./errors.js";

export interface WorkspaceMarkdownAssetRequest {
  (path: string, init: RequestInit): Promise<Response>;
}

export interface WorkspaceMarkdownAssetOptions {
  readonly origin: string;
  readonly worktreeId: string;
  readonly request: WorkspaceMarkdownAssetRequest;
}

/** Read only current Workspace Asset references through the authenticated Worktree API. */
export async function readWorkspaceMarkdownImage(
  reference: string,
  options: WorkspaceMarkdownAssetOptions,
): Promise<DocMarkdownAsset> {
  const assetId = workspaceAssetId(reference, options);
  const prefix = `/universer-api/worktrees/${encodeURIComponent(options.worktreeId)}/file/${encodeURIComponent(assetId)}`;
  const init: RequestInit = {
    method: "GET",
    redirect: "manual",
    headers: { "accept-encoding": "identity" },
  };
  const sign = await options.request(`${prefix}/sign-url`, init);
  if (!sign.ok) throw unavailable(`Workspace Asset authorization failed (${sign.status}).`);
  const signed: unknown = await sign.json();
  if (
    !isRecord(signed) ||
    !isRecord(signed["error"]) ||
    signed["error"]["code"] !== 1 ||
    typeof signed["url"] !== "string"
  )
    throw unavailable("Workspace Asset sign response is invalid.");
  const url = new URL(signed["url"], options.origin);
  if (
    url.origin !== new URL(options.origin).origin ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== `${prefix}/content`
  )
    throw unavailable(
      "Workspace Asset content must use its authenticated same-origin content endpoint.",
    );
  const response = await options.request(url.pathname, init);
  if (!response.ok) throw unavailable(`Workspace Asset download failed (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const length = response.headers.get("content-length");
  if (
    !mimeType?.startsWith("image/") ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > 20_000_000))
  )
    throw unavailable("Workspace Asset is not a supported bounded image.");
  const data = new Uint8Array(await response.arrayBuffer());
  if (
    !data.byteLength ||
    data.byteLength > 20_000_000 ||
    (length !== null && Number(length) !== data.byteLength)
  )
    throw unavailable("Workspace Asset image length is invalid.");
  return { data, mimeType };
}

function workspaceAssetId(reference: string, options: WorkspaceMarkdownAssetOptions): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(reference)) return reference;
  let url: URL;
  try {
    url = new URL(reference, options.origin);
  } catch {
    throw unavailable("The current image is not a Workspace Asset reference.");
  }
  if (
    url.origin !== new URL(options.origin).origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw unavailable("The current image is not a Workspace Asset reference.");
  const worktreePrefix = `/universer-api/worktrees/${encodeURIComponent(options.worktreeId)}/file/`;
  const prefix = url.pathname.startsWith(worktreePrefix) ? worktreePrefix : "/universer-api/file/";
  if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith("/content"))
    throw unavailable("The current image is not a Workspace Asset content reference.");
  const id = url.pathname.slice(prefix.length, -"/content".length);
  if (!uuid.test(id))
    throw unavailable("The current image has an invalid Workspace Asset identity.");
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function unavailable(message: string): Error {
  return workspaceError("workspace-markdown-asset-unavailable", message);
}
