/**
 * Workspace exchange: import Office files into Units and export Units to
 * Office files. Mirrors the Workspace exchange endpoints
 * (`/universer-api/stream/file/upload`, `/universer-api/exchange/...`,
 * `/universer-api/exchange/task/:id`, `/universer-api/file/:id/content`).
 * @module dsh-univer-workspace-plugin/provider/exchange
 */

import type { WorkspaceHttpClient } from "@univerjs/univer-workspace-harness";

/** `FileSource.HttpImport` — the upload source the exchange router accepts. */
const HTTP_IMPORT_SOURCE = 1;

export type ExchangeUnitType = "sheet" | "doc" | "slide" | "base";

export interface ImportRequest {
  readonly fileID: string;
  readonly outputType: 1 | 2;
  readonly spaceId?: string;
  readonly parentNodeId?: string;
  readonly options?: unknown;
}

export interface ExportRequest {
  readonly unitID?: string;
  readonly jsonID?: string;
  readonly format: "xlsx" | "csv" | "docx" | "pptx" | "pdf";
  readonly options?: unknown;
}

export interface ExchangeTaskResult {
  readonly status: "pending" | "done" | "failed";
  readonly import?: { readonly unitID: string; readonly jsonID: string };
  readonly export?: { readonly fileID: string; readonly fileUrl: string };
  readonly message?: string;
}

/** Upload a single Office file for later import. Returns its fileID. */
export async function uploadFile(
  client: WorkspaceHttpClient,
  filename: string,
  bytes: Uint8Array,
  mediaType: string,
): Promise<string> {
  const query = new URLSearchParams({
    source: String(HTTP_IMPORT_SOURCE),
    size: String(bytes.byteLength),
    flate: "0",
  });
  const form = new FormData();
  const blob = new Blob([new Uint8Array(bytes)], { type: mediaType });
  form.append("file", blob, filename);
  const response = await client.request(`/universer-api/stream/file/upload?${query.toString()}`, {
    method: "POST",
    body: form,
  });
  const body = (await response.json()) as { FileId?: unknown; error?: { code?: string; message?: string } };
  if (!response.ok || typeof body.FileId !== "string") {
    throw new Error(`workspace file upload failed: ${body.error?.message ?? response.status}`);
  }
  return body.FileId;
}

/** Start an import task and return its taskID. */
export async function startImport(
  client: WorkspaceHttpClient,
  type: ExchangeUnitType | "auto",
  input: ImportRequest,
): Promise<string> {
  const path = type === "auto" ? "/universer-api/exchange/import" : `/universer-api/exchange/${type}/import`;
  const response = await client.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { taskID?: unknown; error?: { code?: string; message?: string } };
  if (!response.ok || typeof body.taskID !== "string") {
    throw new Error(`workspace import failed: ${body.error?.message ?? response.status}`);
  }
  return body.taskID;
}

/** Start an export task and return its taskID. */
export async function startExport(
  client: WorkspaceHttpClient,
  type: ExchangeUnitType,
  input: ExportRequest,
): Promise<string> {
  const response = await client.request(`/universer-api/exchange/${type}/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { taskID?: unknown; error?: { code?: string; message?: string } };
  if (!response.ok || typeof body.taskID !== "string") {
    throw new Error(`workspace export failed: ${body.error?.message ?? response.status}`);
  }
  return body.taskID;
}

/** Poll one exchange task to a terminal result. */
export async function getTask(client: WorkspaceHttpClient, taskID: string): Promise<ExchangeTaskResult> {
  const response = await client.request(`/universer-api/exchange/task/${encodeURIComponent(taskID)}`);
  const body = (await response.json()) as ExchangeTaskResult & { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new Error(`workspace exchange task failed: ${body.error?.message ?? response.status}`);
  }
  return body;
}

/** Poll an exchange task until it settles (done or failed). */
export async function awaitTask(client: WorkspaceHttpClient, taskID: string, signal?: AbortSignal): Promise<ExchangeTaskResult> {
  for (;;) {
    if (signal?.aborted) throw new Error("exchange task cancelled");
    const result = await getTask(client, taskID);
    if (result.status === "pending") {
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    return result;
  }
}

/** Download an exchange artifact's bytes by fileID. */
export async function downloadFile(client: WorkspaceHttpClient, fileID: string): Promise<Uint8Array> {
  const response = await client.request(`/universer-api/file/${encodeURIComponent(fileID)}/content`);
  if (!response.ok) throw new Error(`workspace file download failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
