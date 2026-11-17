import { getHtmlViewUnitIds, isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { waitForCreatedResource } from "./wait-for-created-resource";

type Messages = { readonly failed: string; readonly continuing: string };

async function copyFile(nodeId: string, idempotencyKey: string, messages: Messages): Promise<string> {
  const { data, error } = await api.POST("/api/nodes/{nodeId}/copies", {
    params: { path: { nodeId }, header: { "Idempotency-Key": idempotencyKey } },
    body: { target: { kind: "personalSpace" } },
  });
  if (error) throw apiError(error);
  if ("unit" in data) throw new Error(messages.failed);
  return waitForCreatedResource(data, messages);
}

async function resourceOf(nodeId: string) {
  const { data, error } = await api.GET("/api/nodes/{nodeId}", { params: { path: { nodeId } } });
  if (error) throw apiError(error);
  return data.node.resource;
}

/** A page is copied with the Sheets it binds and bound to their copies, so the caller can edit all of it. */
export async function copyToPersonalSpace(nodeId: string, idempotencyKey: string, messages: Messages): Promise<string> {
  const copyId = await copyFile(nodeId, idempotencyKey, messages);
  const copy = await resourceOf(copyId);
  if (copy?.kind !== "blob") return copyId;
  const opened = await api.POST("/api/resources/{resourceId}/open", { params: { path: { resourceId: copy.id } } });
  if (opened.error) throw apiError(opened.error);
  const page = opened.data.resource;
  if (page.kind !== "blob" || !isHtmlViewFilename(page.originalFilename)) return copyId;

  const content = await fetch(page.contentUrl, { credentials: "include", cache: "no-store" });
  const etag = content.headers.get("ETag");
  if (!content.ok || !etag) throw new Error(messages.failed);
  const source = await content.text();
  let html = source;
  for (const unitId of getHtmlViewUnitIds(parseHtmlView(source))) {
    const sheet = await api.GET("/api/unit-resources/{unitId}", { params: { path: { unitId } } });
    if (sheet.error) throw apiError(sheet.error);
    const sheetCopy = await resourceOf(await copyFile(sheet.data.node.id, `${idempotencyKey}-${unitId}`, messages));
    if (sheetCopy?.kind !== "univer") throw new Error(messages.failed);
    html = html.replaceAll(unitId, sheetCopy.unitId);
  }
  if (html === source) return copyId;
  const replaced = await fetch(`/api/blob-resources/${encodeURIComponent(page.id)}/content`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/octet-stream",
      "If-Match": etag,
      "Idempotency-Key": `${idempotencyKey}-bind`,
    },
    body: html,
  });
  if (!replaced.ok) throw new Error(messages.failed);
  return copyId;
}
