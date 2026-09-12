import { setTimeout as delay } from "node:timers/promises";
import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import { readJson, WorkspaceApiError } from "./api-errors.ts";

export interface BlobUploadInput {
  readonly bytes: Uint8Array;
  readonly declaredMediaType?: string;
  readonly originalFilename?: string;
  readonly name: string;
  readonly spaceId: string;
  readonly parentNodeId?: string;
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
}

class RetryableUploadError extends Error {}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function malformed(): never {
  throw new WorkspaceApiError("Malformed Blob upload response.", 502, "MALFORMED_UPLOAD");
}

// 文件上传统一使用宿主认证客户端；内容格式与业务校验由调用方负责。
export async function uploadBlob(client: WorkspaceHttpClient, input: BlobUploadInput) {
  // 固定本次上传的字节，调用方随后修改缓冲区不会影响重试。
  const bytes = new Uint8Array(input.bytes);
  const { name, spaceId, idempotencyKey, parentNodeId, declaredMediaType } = input;
  const origin = new URL(client.origin);
  const signal = input.signal;
  signal?.throwIfAborted();
  const request = async (path: string, init?: RequestInit) => {
    let response: Response;
    try {
      response = await client.request(path, { ...init, ...(signal ? { signal } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new RetryableUploadError("Upload transport failed.", { cause: error });
    }
    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      await response.body?.cancel();
      throw new RetryableUploadError(`Upload HTTP ${response.status}.`);
    }
    return response;
  };
  const json = async (response: Response, operation: string) => {
    try {
      return await readJson(response, operation);
    } catch (error) {
      if (error instanceof SyntaxError) malformed();
      throw error;
    }
  };
  const originalFilename = input.originalFilename ?? name;
  if (!name.trim() || !spaceId.trim() || !idempotencyKey.trim())
    throw new Error("Blob upload requires name, spaceId and idempotencyKey.");
  const body = JSON.stringify({
    name,
    originalFilename,
    spaceId,
    parentNodeId: parentNodeId ?? null,
    byteSize: bytes.length,
    ...(declaredMediaType ? { declaredMediaType } : {}),
  });
  let identity: { id: string; nodeId: string; resourceId: string } | undefined;
  // 同一次发布保持 key 和字节不变；响应丢失后查询状态，避免重复发布文件。
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if (attempt) await delay(250, undefined, { signal });
      signal?.throwIfAborted();
      const response = identity
        ? await request(`/api/blob-upload-sessions/${encodeURIComponent(identity.id)}`)
        : await request("/api/blob-upload-sessions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body,
          });
      const upload = record(record(await json(response, "reserve Blob upload")).upload);
      if (
        ![upload.id, upload.nodeId, upload.resourceId].every(
          (value) => typeof value === "string" && value.length > 0,
        )
      )
        malformed();
      if (
        upload.byteSize !== bytes.length ||
        upload.name !== name ||
        upload.originalFilename !== originalFilename
      )
        malformed();
      if (
        identity &&
        (upload.id !== identity.id ||
          upload.nodeId !== identity.nodeId ||
          upload.resourceId !== identity.resourceId)
      )
        malformed();
      identity ??= {
        id: upload.id as string,
        nodeId: upload.nodeId as string,
        resourceId: upload.resourceId as string,
      };
      const path = `/api/blob-upload-sessions/${encodeURIComponent(identity.id)}`;
      if (upload.state === "waitingForUpload") {
        const sent = await request(`${path}/content`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: bytes,
        });
        if (!sent.ok) await json(sent, "upload Blob bytes");
        continue;
      }
      if (upload.state === "verifying") continue;
      if (upload.state === "uploaded" || upload.state === "completed") {
        const result = record(
          await json(await request(`${path}/complete`, { method: "POST" }), "publish Blob"),
        );
        const node = record(result.node);
        const resource = record(node.resource);
        if (
          node.id !== identity.nodeId ||
          resource.id !== identity.resourceId ||
          resource.kind !== "blob"
        )
          malformed();
        return {
          nodeId: identity.nodeId,
          resourceId: identity.resourceId,
          workspaceUrl: new URL(`/nodes/${encodeURIComponent(identity.nodeId)}`, origin).href,
        };
      }
      if (["failed", "expired", "aborted"].includes(String(upload.state)))
        throw new WorkspaceApiError(`Blob upload is ${upload.state}.`, 409, "UPLOAD_TERMINATED");
      malformed();
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason;
      // 只有网络边界确认的暂时失败才重试，业务和解析错误直接返回。
      if (!(error instanceof RetryableUploadError)) throw error;
    }
  }
  throw new WorkspaceApiError(
    `Blob upload result is unknown; retry the same content with idempotencyKey ${idempotencyKey}${identity ? `, uploadId ${identity.id}` : ""}.`,
    504,
    "UPLOAD_RESULT_UNKNOWN",
  );
}
