/**
 * Cloudflare R2 Blob Storage Service.
 * Implements pure edge object storage for Workspace attachments, images, and snapshots.
 */
import type { ControlPlaneDb } from "../control-plane/db.ts";

export interface StoredObject {
  readonly byteSize: number;
  readonly sha256: string;
  readonly etag: string;
}

export interface StoredBlob extends StoredObject {
  readonly mediaType: string;
}

export function detectMediaType(sample: Uint8Array): string {
  if (sample.length >= 8 && sample[0] === 0x89 && sample[1] === 0x50 && sample[2] === 0x4e && sample[3] === 0x47) {
    return "image/png";
  }
  if (sample.length >= 3 && sample[0] === 0xff && sample[1] === 0xd8 && sample[2] === 0xff) {
    return "image/jpeg";
  }
  if (sample.length >= 6 && sample[0] === 0x47 && sample[1] === 0x49 && sample[2] === 0x46) {
    return "image/gif";
  }
  if (sample.length >= 4 && sample[0] === 0x25 && sample[1] === 0x50 && sample[2] === 0x44 && sample[3] === 0x46) {
    return "application/pdf";
  }
  if (sample.length >= 4 && sample[0] === 0x50 && sample[1] === 0x4b && sample[2] === 0x03 && sample[3] === 0x04) {
    return "application/zip";
  }
  if (sample.length >= 12 && sample[0] === 0x52 && sample[1] === 0x49 && sample[2] === 0x46 && sample[3] === 0x46) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export class R2BlobStore {
  constructor(private readonly bucket?: R2Bucket) {}

  async put(input: {
    objectKey: string;
    body: ArrayBuffer | Uint8Array;
    expectedByteSize?: number;
    detectMediaType?: boolean;
    contentType?: string;
  }): Promise<StoredBlob> {
    const bytes = input.body instanceof Uint8Array ? input.body : new Uint8Array(input.body);
    const byteSize = bytes.byteLength;

    // Calculate SHA-256 digest
    const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    const sha256 = hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
    const etag = sha256;

    const mediaType = input.contentType || (input.detectMediaType !== false ? detectMediaType(bytes.subarray(0, 32)) : "application/octet-stream");

    if (this.bucket) {
      await this.bucket.put(input.objectKey, bytes, {
        httpMetadata: { contentType: mediaType },
        sha256
      });
    }

    return {
      byteSize,
      sha256,
      etag,
      mediaType
    };
  }

  async get(objectKey: string, range?: { offset: number; length: number }): Promise<Response | null> {
    if (!this.bucket) {
      return null;
    }

    const options: R2GetOptions = {};
    if (range) {
      options.range = {
        offset: Math.max(0, range.offset),
        length: Math.max(0, range.length)
      };
    }

    const obj = await this.bucket.get(objectKey, options);
    if (!obj) return null;

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("ETag", obj.httpEtag);

    return new Response(obj.body, { headers });
  }

  async head(objectKey: string): Promise<{ byteSize: number; etag: string } | null> {
    if (!this.bucket) return null;
    const obj = await this.bucket.head(objectKey);
    if (!obj) return null;
    return {
      byteSize: obj.size,
      etag: obj.httpEtag
    };
  }

  async delete(objectKey: string): Promise<void> {
    if (!this.bucket) return;
    await this.bucket.delete(objectKey);
  }
}

/**
 * Handles HTTP routes for Blob uploads and content retrieval.
 */
export async function handleBlobRoutes(
  request: Request,
  db: ControlPlaneDb,
  blobStore: R2BlobStore,
  url: URL,
  currentUserId?: string
): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // POST /api/blob-upload-sessions
  if (path === "/api/blob-upload-sessions" && method === "POST") {
    if (!currentUserId) return new Response("Unauthorized", { status: 401 });
    const body = (await request.json()) as any;
    const { spaceId, parentNodeId, name, filename, byteSize, mediaType } = body;

    const uploadId = `upl_${crypto.randomUUID()}`;
    const nodeId = `node_${crypto.randomUUID()}`;
    const resourceId = `res_${crypto.randomUUID()}`;
    const objectKey = `blobs/${resourceId}/${filename}`;
    const operationId = `op_${crypto.randomUUID()}`;

    const session = await db.createUploadSession({
      id: uploadId,
      operation_id: operationId,
      actor_user_id: currentUserId,
      target_space_id: spaceId,
      target_parent_node_id: parentNodeId ?? null,
      node_id: nodeId,
      resource_id: resourceId,
      object_key: objectKey,
      node_name: name || filename,
      original_filename: filename,
      declared_media_type: mediaType ?? null,
      detected_media_type: null,
      byte_size: byteSize || 0,
      received_size: null,
      sha256: null,
      etag: null,
      state: "waiting_for_upload",
      expires_at: Date.now() + 3600 * 1000,
      completed_at: null,
      last_error_code: null
    });

    return new Response(
      JSON.stringify({
        upload: session,
        uploadTarget: { url: `/api/blob-upload-sessions/${uploadId}/content` }
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // PUT /api/blob-upload-sessions/:uploadId/content
  const uploadContentMatch = path.match(/^\/api\/blob-upload-sessions\/([^/]+)\/content$/);
  if (uploadContentMatch && method === "PUT") {
    const uploadId = uploadContentMatch[1];
    const session = await db.getUploadSession(uploadId);
    if (!session) return new Response("Upload session not found", { status: 404 });

    const arrayBuffer = await request.arrayBuffer();
    const result = await blobStore.put({
      objectKey: session.object_key,
      body: arrayBuffer,
      contentType: session.declared_media_type ?? undefined
    });

    await db.completeUploadSession(uploadId, {
      byteSize: result.byteSize,
      sha256: result.sha256,
      etag: result.etag,
      mediaType: result.mediaType
    });

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // POST /api/blob-upload-sessions/:uploadId/complete
  const uploadCompleteMatch = path.match(/^\/api\/blob-upload-sessions\/([^/]+)\/complete$/);
  if (uploadCompleteMatch && method === "POST") {
    const uploadId = uploadCompleteMatch[1];
    const session = await db.getUploadSession(uploadId);
    if (!session) return new Response("Upload session not found", { status: 404 });

    // Create Node
    const node = await db.createNode({
      id: session.node_id,
      spaceId: session.target_space_id,
      parentId: session.target_parent_node_id,
      name: session.node_name,
      createdBy: session.actor_user_id
    });

    // Create Resource
    const resource = await db.createResource({
      id: session.resource_id,
      nodeId: node.id,
      kind: "blob"
    });

    // Create Blob Resource Record
    await db.createBlobResource(resource.id, {
      objectKey: session.object_key,
      originalFilename: session.original_filename,
      mediaType: session.detected_media_type || session.declared_media_type || "application/octet-stream",
      byteSize: session.byte_size,
      sha256: session.sha256 || "unknown",
      etag: session.etag || "unknown"
    });

    return new Response(
      JSON.stringify({
        node,
        resource
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // GET /api/blob-resources/:resourceId/content or /download
  const blobContentMatch = path.match(/^\/api\/blob-resources\/([^/]+)\/(content|download)$/);
  if (blobContentMatch && method === "GET") {
    const resourceId = blobContentMatch[1];
    const isDownload = blobContentMatch[2] === "download";

    const resource = await db.getResourceById(resourceId);
    if (!resource || !resource.blob) {
      return new Response("Blob not found", { status: 404 });
    }

    const rangeHeader = request.headers.get("Range");
    let range: { offset: number; length: number } | undefined;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        const offset = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : resource.blob.byte_size - 1;
        range = { offset, length: end - offset + 1 };
      }
    }

    const res = await blobStore.get(resource.blob.object_key, range);
    if (!res) {
      return new Response("Blob content unavailable", { status: 404 });
    }

    const headers = new Headers(res.headers);
    headers.set("Content-Type", resource.blob.media_type);
    if (isDownload) {
      headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(resource.blob.original_filename)}"`);
    } else {
      headers.set("Content-Disposition", `inline; filename="${encodeURIComponent(resource.blob.original_filename)}"`);
    }

    return new Response(res.body, {
      status: range ? 206 : 200,
      headers
    });
  }

  return null;
}
