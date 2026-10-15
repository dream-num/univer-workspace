import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";

export async function uploadBlob(
  spaceId: string,
  parentNodeId: string | null,
  file: File,
  failureMessage = "File upload failed.",
  readResponseError = false,
) {
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
  if (!reserved.uploadTarget) throw new Error(failureMessage);
  try {
    const response = await fetch(reserved.uploadTarget.contentUrl, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    if (!response.ok) {
      const value = readResponseError ? await response.json().catch(() => null) : null;
      throw value ? apiError(value) : new Error(failureMessage);
    }
    const { data, error } = await api.POST("/api/blob-upload-sessions/{uploadId}/complete", {
      params: { path: { uploadId: reserved.upload.id } },
    });
    if (error) throw apiError(error);
    return data;
  } catch (reason) {
    await api
      .DELETE("/api/blob-upload-sessions/{uploadId}", {
        params: { path: { uploadId: reserved.upload.id } },
      })
      .catch(() => undefined);
    throw reason;
  }
}

// 保留两入口既有合同：Unit 结果调用方还解析响应错误，任务完成调用方使用固定兜底文案。
export async function importDocument(
  spaceId: string,
  parentNodeId: string | null,
  file: File,
  failureMessage = "File import failed.",
  requireUnitId = false,
) {
  const form = new FormData();
  form.append("file", file);
  const upload = await fetch(
    `/universer-api/stream/file/upload?size=${encodeURIComponent(file.size)}&source=1&flate=false`,
    { method: "POST", credentials: "include", body: form },
  );
  const uploaded = (await upload.json().catch(() => null)) as {
    readonly FileId?: string;
  } | null;
  if (!upload.ok || !uploaded?.FileId) throw requireUnitId && uploaded ? apiError(uploaded) : new Error(failureMessage);
  const start = await fetch("/universer-api/exchange/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileID: uploaded.FileId,
      outputType: 1,
      spaceId,
      parentNodeId,
    }),
  });
  const started = (await start.json().catch(() => null)) as {
    readonly taskID?: string;
  } | null;
  if (!start.ok || !started?.taskID) throw requireUnitId && started ? apiError(started) : new Error(failureMessage);
  return waitForDocumentImport(started.taskID, failureMessage, requireUnitId);
}

async function waitForDocumentImport(taskId: string, failureMessage: string, requireUnitId: boolean) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`/universer-api/exchange/task/${encodeURIComponent(taskId)}`, {
      credentials: "include",
    });
    const task = (await response.json().catch(() => null)) as {
      readonly status?: string;
      readonly error?: { readonly message?: string };
      readonly import?: { readonly unitID?: string };
    } | null;
    const message = requireUnitId ? task?.error?.message || failureMessage : (task?.error?.message ?? failureMessage);
    if (!response.ok) throw new Error(message);
    if (task?.status === "done" && (!requireUnitId || task.import?.unitID)) return task.import?.unitID;
    if (task?.status === "failed") throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(failureMessage);
}
