import { getHtmlViewUnitIds, isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { waitForCreatedResource } from "./wait-for-created-resource";

type Messages = { readonly failed: string; readonly continuing: string; readonly sheetUnreadable: string };

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

async function htmlViewOf(nodeId: string, messages: Messages) {
  const resource = await resourceOf(nodeId);
  if (resource?.kind !== "blob") return undefined;
  const opened = await api.POST("/api/resources/{resourceId}/open", { params: { path: { resourceId: resource.id } } });
  if (opened.error) throw apiError(opened.error);
  const page = opened.data.resource;
  if (page.kind !== "blob" || !isHtmlViewFilename(page.originalFilename)) return undefined;
  const content = await fetch(page.contentUrl, { credentials: "include", cache: "no-store" });
  const etag = content.headers.get("ETag");
  if (!content.ok || !etag) throw new Error(messages.failed);
  return { id: page.id, etag, html: await content.text() };
}

/** The Node of every Sheet the page binds, found before anything is copied so an unreadable one creates nothing. */
async function boundSheets(html: string, messages: Messages): Promise<Map<string, string>> {
  const sheets = new Map<string, string>();
  for (const unitId of getHtmlViewUnitIds(parseHtmlView(html))) {
    const sheet = await api.GET("/api/unit-resources/{unitId}", { params: { path: { unitId } } });
    if (sheet.response.status === 404) throw new Error(messages.sheetUnreadable);
    if (sheet.error) throw apiError(sheet.error);
    sheets.set(unitId, sheet.data.node.id);
  }
  return sheets;
}

/** A page is copied with the Sheets it binds and bound to their copies, so the caller can edit all of it. */
export async function copyToPersonalSpace(nodeId: string, idempotencyKey: string, messages: Messages): Promise<string> {
  const source = await htmlViewOf(nodeId, messages);
  const sheets = source ? await boundSheets(source.html, messages) : new Map<string, string>();
  const copyId = await copyFile(nodeId, idempotencyKey, messages);
  if (sheets.size === 0) return copyId;

  const page = await htmlViewOf(copyId, messages);
  if (!page) throw new Error(messages.failed);
  let html = page.html;
  for (const [unitId, sheetNodeId] of sheets) {
    const sheetCopy = await resourceOf(await copyFile(sheetNodeId, `${idempotencyKey}-${unitId}`, messages));
    if (sheetCopy?.kind !== "univer") throw new Error(messages.failed);
    html = html.replaceAll(unitId, sheetCopy.unitId);
  }
  if (html === page.html) return copyId;
  const replaced = await fetch(`/api/blob-resources/${encodeURIComponent(page.id)}/content`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/octet-stream",
      "If-Match": page.etag,
      "Idempotency-Key": `${idempotencyKey}-bind`,
    },
    body: html,
  });
  if (!replaced.ok) throw new Error(messages.failed);
  return copyId;
}
