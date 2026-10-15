import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";

export async function uploadBlob(spaceId: string, parentNodeId: string | null, file: File) {
  const { data: reserved, error: reserveError } = await api.POST("/api/blob-upload-sessions", {
    params: { header: { "Idempotency-Key": createIdempotencyKey() } },
    body: {
      spaceId,
      parentNodeId,
      name: file.name,
      originalFilename: file.name,
      byteSize: file.size,
      ...(file.type ? { declaredMediaType: file.type } : {}),
    },
  });
  if (reserveError) throw apiError(reserveError);
  if (!reserved.uploadTarget) throw new Error("File upload failed.");
  try {
    const response = await fetch(reserved.uploadTarget.contentUrl, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    if (!response.ok) throw new Error("File upload failed.");
    const { error } = await api.POST("/api/blob-upload-sessions/{uploadId}/complete", {
      params: { path: { uploadId: reserved.upload.id } },
    });
    if (error) throw apiError(error);
  } catch (reason) {
    await api
      .DELETE("/api/blob-upload-sessions/{uploadId}", {
        params: { path: { uploadId: reserved.upload.id } },
      })
      .catch(() => undefined);
    throw reason;
  }
}

export async function importDocument(spaceId: string, parentNodeId: string | null, file: File) {
  const form = new FormData();
  form.append("file", file);
  const upload = await fetch(
    `/universer-api/stream/file/upload?size=${encodeURIComponent(file.size)}&source=1&flate=false`,
    { method: "POST", credentials: "include", body: form },
  );
  const uploaded = (await upload.json().catch(() => null)) as { readonly FileId?: string } | null;
  if (!upload.ok || !uploaded?.FileId) throw new Error("File import failed.");
  const start = await fetch("/universer-api/exchange/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileID: uploaded.FileId, outputType: 1, spaceId, parentNodeId }),
  });
  const started = (await start.json().catch(() => null)) as { readonly taskID?: string } | null;
  if (!start.ok || !started?.taskID) throw new Error("File import failed.");
  await waitForDocumentImport(started.taskID);
}

async function waitForDocumentImport(taskId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`/universer-api/exchange/task/${encodeURIComponent(taskId)}`, {
      credentials: "include",
    });
    const task = (await response.json().catch(() => null)) as
      | { readonly status?: string; readonly error?: { readonly message?: string } }
      | null;
    if (!response.ok) throw new Error(task?.error?.message ?? "File import failed.");
    if (task?.status === "done") return;
    if (task?.status === "failed") throw new Error(task.error?.message ?? "File import failed.");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("File import failed.");
}


export async function waitForDocumentImportWithUnit(
  taskId: string,
  fallbackMessage: string
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(
      `/universer-api/exchange/task/${encodeURIComponent(taskId)}`,
      { credentials: "include" }
    );
    const task = (await response.json().catch(() => null)) as
      | {
          readonly status?: string;
          readonly error?: { readonly message?: string };
          readonly import?: { readonly unitID?: string };
        }
      | null;
    if (!response.ok) throw new Error(task?.error?.message || fallbackMessage);
    if (task?.status === "done" && task.import?.unitID) {
      return task.import.unitID;
    }
    if (task?.status === "failed") {
      throw new Error(task.error?.message || fallbackMessage);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(fallbackMessage);
}
