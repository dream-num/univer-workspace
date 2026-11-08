import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { constants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { open, readdir, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { jobRecordSchema, type JobRecord } from "../jobs/model.js";
import { Readable } from "node:stream";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import {
  defaultLimits,
  objectSchema,
  uploadInputSchema,
  type StagingObject,
  type StagingStore,
  type UploadInput,
  type UploadLimits,
  type UploadPurpose,
} from "./model.js";

const UPLOAD_TTL = 60 * 60_000;
const LOCK_TTL = 2 * 60 * 60_000;
// The reservation critical section takes milliseconds, so a crashed holder must not block a key for hours.
const JOB_LOCK_TTL = 10_000;
const LINK_TTL = 10 * 60_000;
const DOWNLOAD_TTL = 15 * 60_000;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const officeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/msword",
  "application/vnd.ms-powerpoint",
]);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const missing = () => workspaceError("workspace-upload-not-found", "Upload not found or expired.");
const sizeError = () =>
  workspaceError("workspace-file-size-mismatch", "File exceeds the size upper limit.");
class CorruptMetadataError extends Error {}

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export class LocalStagingStore implements StagingStore {
  readonly limits: UploadLimits;
  private readonly root: string;
  private readonly directories = new Set<string>();
  private readonly canonical: string;
  private readonly ready: Promise<void>;
  private readonly timer: ReturnType<typeof setInterval>;
  // shortcut: quota accounting is per replica, coordinate reservations before multi-replica quota enforcement.
  private readonly objects = new Map<string, StagingObject>();
  private readonly maxUserBytes: number;
  private readonly maxPendingUploads: number;
  private readonly onError: (error: unknown, id?: string) => void;
  private readonly active = new Set<string>();
  private sweeping: Promise<void> | undefined;

  constructor(
    directory: string,
    private readonly publicUrl: string,
    options: {
      limits?: UploadLimits;
      maxUserBytes?: number;
      maxPendingUploads?: number;
      now?: () => number;
      intervalMs?: number;
      onError?: (error: unknown, id?: string) => void;
    } = {},
  ) {
    this.maxUserBytes = options.maxUserBytes ?? 2 * 1024 * 1024 * 1024;
    this.maxPendingUploads = options.maxPendingUploads ?? 20;
    this.onError = options.onError ?? (() => {});
    this.limits = options.limits ?? defaultLimits;
    this.now = options.now ?? Date.now;
    this.root = resolve(directory);
    try {
      const first = mkdirSync(this.root, { recursive: true, mode: 0o700 });
      this.directories.add(this.root);
      if (first !== undefined)
        for (let current = this.root; current !== first; current = dirname(current))
          this.directories.add(dirname(current));
      this.canonical = realpathSync(this.root);
      this.checkRoot();
    } catch {
      throw new Error("Unable to initialize private staging directory.");
    }
    this.ready = this.sweep().catch((error: unknown) => this.onError(error));
    this.timer = setInterval(() => {
      if (this.sweeping) return;
      this.sweeping = this.ready
        .then(() => this.sweep())
        .catch((error: unknown) => this.onError(error))
        .finally(() => {
          this.sweeping = undefined;
        });
    }, options.intervalMs ?? 60_000);
    this.timer.unref();
  }
  private readonly now: () => number;

  private checkRoot(): void {
    for (const directory of this.directories) {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
        throw new Error("Staging directory must be private and owned by the current uid.");
    }
    if (realpathSync(this.root) !== this.canonical) throw new Error("Staging directory changed.");
  }
  private path(id: string, suffix: string): string {
    this.checkRoot();
    if (!idPattern.test(id)) throw missing();
    return join(this.root, `${id}.${suffix}`);
  }
  private async safeOpen(path: string): Promise<FileHandle> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0
      )
        throw new Error("Unsafe staging file.");
      return file;
    } catch (error) {
      await file.close();
      throw error;
    }
  }
  private async read(id: string): Promise<StagingObject | undefined> {
    if (!idPattern.test(id)) throw missing();
    try {
      const file = await this.safeOpen(this.path(id, "json"));
      try {
        const text = await file.readFile("utf8");
        try {
          const object = objectSchema.parse(JSON.parse(text));
          if (object.id !== id) throw new Error("Staging identity mismatch.");
          return object;
        } catch {
          throw new CorruptMetadataError("Invalid staging metadata.");
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      if (error instanceof CorruptMetadataError) throw error;
      throw new Error("Unable to read staging metadata.", { cause: error });
    }
  }
  async readJob(id: string): Promise<JobRecord | undefined> {
    if (!idPattern.test(id)) return undefined;
    try {
      const file = await this.safeOpen(this.path(id, "job.json"));
      try {
        const text = await file.readFile("utf8");
        try {
          const job = jobRecordSchema.parse(JSON.parse(text));
          if (job.id !== id) throw new Error("Job identity mismatch.");
          return job;
        } catch {
          throw new CorruptMetadataError("Invalid job metadata.");
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
  async writeJob(job: JobRecord): Promise<void> {
    await this.metadata(job, "job.json");
  }
  async reserveJob(job: JobRecord): Promise<JobRecord> {
    await this.ready;
    if (job.key === undefined) {
      await this.writeJob(job);
      return job;
    }
    const digest = hash(JSON.stringify([job.userId, job.tool, job.key]));
    const lockId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.lock(
          lockId,
          async () => {
            for (const name of await readdir(this.root)) {
              if (!name.endsWith(".job.json")) continue;
              let existing: JobRecord | undefined;
              try {
                existing = await this.readJob(name.slice(0, 36));
              } catch (error) {
                if (error instanceof CorruptMetadataError) continue;
                throw error;
              }
              if (
                existing &&
                existing.status !== "failed" &&
                (existing.status !== "running" || existing.deadlineAt > this.now()) &&
                existing.expiresAt > this.now() &&
                existing.userId === job.userId &&
                existing.tool === job.tool &&
                existing.key === job.key
              )
                return existing;
            }
            await this.writeJob(job);
            return job;
          },
          JOB_LOCK_TTL,
        );
      } catch (error) {
        if (!hasCode(error, "workspace-upload-busy") || attempt >= 100) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
  private async metadata(object: StagingObject | JobRecord, suffix = "json"): Promise<void> {
    const temp = this.path(object.id, `${randomUUID()}.tmp`);
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(object));
      await file.sync();
      await file.close();
      await rename(temp, this.path(object.id, suffix));
    } finally {
      await file.close();
      await unlink(temp).catch((error) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
    }
  }
  private link(object: StagingObject, token: string, page = false): string {
    const path = `/mcp/files/${object.kind}s/${object.id}${page ? "/page" : ""}`;
    const url = new URL(path, this.publicUrl);
    url.searchParams.set("token", token);
    return url.href;
  }
  async createUpload(owner: string, value: UploadInput) {
    await this.ready;
    const input = uploadInputSchema.parse(value);
    if (
      (input.purpose === "office-import" && !officeTypes.has(input.media_type)) ||
      (!["office-import", "blob"].includes(input.purpose) &&
        !["application/zip", "application/x-zip-compressed"].includes(input.media_type))
    ) {
      throw workspaceError(
        "workspace-upload-media-type-invalid",
        "Media type is not allowed for this upload purpose.",
      );
    }
    const token = randomBytes(32).toString("hex");
    const createdAt = this.now();
    const object: StagingObject = {
      id: randomUUID(),
      kind: "upload",
      owner,
      purpose: input.purpose,
      fileName: input.file_name,
      mediaType: input.media_type,
      size: 0,
      maxBytes: Math.min(input.size ?? this.limits[input.purpose], this.limits[input.purpose]),
      state: "pending",
      createdAt,
      expiresAt: createdAt + UPLOAD_TTL,
      tokenHash: hash(token),
    };
    this.account(object);
    try {
      await this.metadata(object);
    } catch (error) {
      this.objects.delete(object.id);
      throw error;
    }
    return {
      upload: {
        upload_id: object.id,
        upload_url: this.link(object, token),
        page_url: this.link(object, token, true),
        expires_at: new Date(createdAt + LINK_TTL).toISOString(),
        max_bytes: Math.min(input.size ?? this.limits[input.purpose], this.limits[input.purpose]),
      },
    };
  }
  async requireUpload(owner: string, id: string, purpose: UploadPurpose): Promise<StagingObject> {
    await this.ready;
    const object = await this.read(id);
    if (
      !object ||
      object.kind !== "upload" ||
      object.owner !== owner ||
      object.expiresAt <= this.now()
    )
      throw missing();
    if (object.purpose !== purpose)
      throw workspaceError("workspace-upload-purpose-mismatch", "Upload has a different purpose.");
    if (object.state !== "ready")
      throw workspaceError("workspace-upload-not-ready", "Upload bytes have not been received.");
    return object;
  }
  async withUpload<T>(
    owner: string,
    id: string,
    purpose: UploadPurpose,
    consume: (object: StagingObject, path: string) => Promise<T>,
  ): Promise<T> {
    await this.ready;
    return this.lock(id, async () => {
      const object = await this.requireUpload(owner, id, purpose);
      const path = this.path(id, "data");
      const file = await this.safeOpen(path);
      try {
        if ((await file.stat()).size !== object.size)
          throw new Error("Staging data integrity mismatch.");
        return await consume(object, path);
      } finally {
        await file.close();
      }
    });
  }
  private async lock<T>(id: string, action: () => Promise<T>, staleAfterMs?: number): Promise<T> {
    const path = this.path(id, "lock");
    let file: FileHandle;
    try {
      try {
        file = await open(path, "wx", 0o600);
      } catch (error) {
        if (!hasCode(error, "EEXIST") || staleAfterMs === undefined) throw error;
        const lockTime = await this.lockTime(id);
        if (lockTime === undefined || lockTime + staleAfterMs > this.now()) throw error;
        // ponytail: two reclaimers can both pass this check; the loser may drop the winner's fresh lock.
        await unlink(path).catch((failure) => {
          if (!hasCode(failure, "ENOENT")) throw failure;
        });
        file = await open(path, "wx", 0o600);
      }
    } catch (error) {
      if (hasCode(error, "EEXIST"))
        throw workspaceError(
          "workspace-upload-busy",
          "File transfer is already in progress. Retry later.",
        );
      throw error;
    }
    const token = randomBytes(32).toString("hex");
    this.active.add(id);
    try {
      await file.writeFile(token);
      return await action();
    } finally {
      this.active.delete(id);
      await file.close().catch((error: unknown) => this.onError(error, id));
      try {
        const current = await this.safeOpen(path);
        let matches: boolean;
        try {
          matches = (await current.readFile("utf8")) === token;
        } finally {
          await current.close();
        }
        if (matches) await unlink(path);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) this.onError(error, id);
      }
    }
  }

  private async write(
    object: StagingObject,
    content: AsyncIterable<Uint8Array>,
    maxBytes = this.limits[object.purpose],
  ): Promise<StagingObject> {
    const temp = this.path(object.id, `${randomUUID()}.tmp`);
    const file = await open(temp, "wx", 0o600);
    const digest = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of content) {
        size += chunk.byteLength;
        if (size > Math.min(maxBytes, this.limits[object.purpose])) throw sizeError();
        this.account({ ...object, size });
        digest.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset);
          if (bytesWritten === 0) throw new Error("Zero-byte staging write.");
          offset += bytesWritten;
        }
      }
      if (object.expiresAt <= this.now()) throw sizeError();
      await file.sync();
      await file.close();
      await rename(temp, this.path(object.id, "data"));
      const ready: StagingObject = {
        ...object,
        size,
        state: "ready",
        sha256: digest.digest("hex"),
      };
      await this.metadata(ready);
      this.objects.set(object.id, ready);
      return ready;
    } catch (error) {
      this.objects.set(object.id, object);
      await unlink(this.path(object.id, "data")).catch((cleanupError) => {
        if (!hasCode(cleanupError, "ENOENT")) this.onError(cleanupError, object.id);
      });
      throw error;
    } finally {
      await file.close();
      await unlink(temp).catch((error) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
    }
  }
  async createDownload(input: {
    owner: string;
    fileName: string;
    mediaType: string;
    size?: number;
    content: AsyncIterable<Uint8Array>;
  }) {
    await this.ready;
    const token = randomBytes(32).toString("hex");
    const createdAt = this.now();
    const object = objectSchema.parse({
      id: randomUUID(),
      kind: "download",
      owner: input.owner,
      purpose: "blob",
      fileName: input.fileName,
      mediaType:
        uploadInputSchema.shape.media_type.safeParse(input.mediaType.split(";")[0]?.trim()).data ??
        "application/octet-stream",
      size: 0,
      state: "pending",
      createdAt,
      expiresAt: createdAt + DOWNLOAD_TTL,
      tokenHash: hash(token),
    });
    if (input.size !== undefined && input.size > this.limits.blob) throw sizeError();
    this.account(object);
    try {
      await this.metadata(object);
      const ready = await this.lock(object.id, () => this.write(object, input.content, input.size));
      return {
        url: this.link(ready, token),
        expires_at: new Date(ready.expiresAt).toISOString(),
        file_name: ready.fileName,
        media_type: ready.mediaType,
        size: ready.size,
      };
    } catch (error) {
      await this.remove(object.id);
      throw error;
    }
  }
  async handle(request: Request, url = new URL(request.url)): Promise<Response> {
    await this.ready;
    const match = /^\/mcp\/files\/(uploads|downloads)\/([^/]+)(\/page)?$/.exec(url.pathname);
    if (!match || !match[2] || !idPattern.test(match[2]))
      return new Response("Not found", { status: 404, headers });
    const object = await this.read(match[2]);
    const token = url.searchParams.get("token") ?? "";
    if (
      !object ||
      match[1] !== `${object.kind}s` ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(hash(token), "hex"), Buffer.from(object.tokenHash, "hex")) ||
      object.expiresAt <= this.now() ||
      (object.kind === "upload" && object.createdAt + LINK_TTL <= this.now())
    )
      return new Response("Not found", { status: 404, headers });
    if (object.kind === "upload" && request.method === "GET" && match[3]) return uploadPage();
    if (object.kind === "download" && object.state === "pending")
      return new Response("Not found", { status: 404, headers });
    if (
      object.kind === "download" &&
      request.method === "GET" &&
      !match[3] &&
      object.state === "ready"
    ) {
      const file = await this.safeOpen(this.path(object.id, "data"));
      if ((await file.stat()).size !== object.size) {
        await file.close();
        throw new Error("Staging data integrity mismatch.");
      }
      return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>, {
        headers: {
          ...headers,
          "Content-Type": object.mediaType,
          "Content-Length": String(object.size),
          "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeDownloadName(object.fileName)).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
          "Content-Security-Policy": "sandbox; default-src 'none'",
        },
      });
    }
    if (object.kind === "upload" && request.method === "PUT" && !match[3]) {
      try {
        await this.lock(object.id, async () => {
          const latest = await this.read(object.id);
          if (!latest || latest.state === "ready")
            throw workspaceError(
              "workspace-upload-already-ready",
              "Upload has already been received.",
            );
          const length = request.headers.get("content-length");
          const bound = Math.min(latest.maxBytes ?? latest.size, this.limits[latest.purpose]);
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > bound))
            throw sizeError();
          await this.write(latest, request.body ?? empty(), bound);
        });
        return new Response(null, { status: 204, headers });
      } catch (error) {
        if (hasCode(error, "workspace-staging-quota-exceeded"))
          return new Response("Staging quota exceeded", { status: 429, headers });
        if (hasCode(error, "workspace-file-size-mismatch"))
          return new Response("File size mismatch", { status: 413, headers });
        if (
          hasCode(error, "workspace-upload-already-ready") ||
          hasCode(error, "workspace-upload-busy")
        )
          return new Response("Upload already received or busy", { status: 409, headers });
        throw error;
      }
    }
    return new Response("Method not allowed", { status: 405, headers });
  }
  private account(object: StagingObject): void {
    let bytes = object.size;
    let pending = object.kind === "upload" && object.state === "pending" ? 1 : 0;
    for (const other of this.objects.values()) {
      if (other.id === object.id || other.owner !== object.owner) continue;
      bytes += other.size;
      if (other.kind === "upload" && other.state === "pending") pending++;
    }
    if (bytes > this.maxUserBytes || pending > this.maxPendingUploads)
      throw workspaceError(
        "workspace-staging-quota-exceeded",
        "Staging quota exceeded. Wait for staged files to expire and retry.",
      );
    this.objects.set(object.id, object);
  }
  private async remove(id: string): Promise<void> {
    for (const suffix of ["json", "data"])
      await unlink(this.path(id, suffix)).catch((error) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
    this.objects.delete(id);
  }
  private async lockTime(id: string): Promise<number | undefined> {
    try {
      return lstatSync(this.path(id, "lock")).mtimeMs;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
  async sweep(): Promise<void> {
    this.checkRoot();
    for (const name of await readdir(this.root)) {
      const id = name.slice(0, 36);
      if (!idPattern.test(id) || this.active.has(id)) continue;
      try {
        if (name === `${id}.job.json`) {
          try {
            const job = await this.readJob(id);
            if (job && job.expiresAt <= this.now()) await unlink(this.path(id, "job.json"));
          } catch (error) {
            if (lstatSync(this.path(id, "job.json")).mtimeMs + DOWNLOAD_TTL <= this.now())
              await unlink(this.path(id, "job.json"));
            this.onError(error, id);
          }
          continue;
        }
        if (name === `${id}.json`) {
          try {
            const object = await this.read(id);
            if (object && object.expiresAt > this.now()) {
              if (!this.active.has(id)) this.objects.set(id, object);
              continue;
            }
          } catch (error) {
            if (!(error instanceof CorruptMetadataError)) throw error;
            if (lstatSync(this.path(id, "json")).mtimeMs + UPLOAD_TTL > this.now()) continue;
          }
        } else {
          if (name === `${id}.lock`) {
            if (lstatSync(this.path(id, "lock")).mtimeMs + LOCK_TTL > this.now()) continue;
          } else {
            if (!/^[a-f0-9-]{36}\.(?:data|[a-f0-9-]{36}\.tmp)$/.test(name)) continue;
            if (lstatSync(join(this.root, name)).mtimeMs + UPLOAD_TTL > this.now()) continue;
          }
        }
        const lockTime = await this.lockTime(id);
        if (lockTime !== undefined) {
          if (lockTime + LOCK_TTL > this.now()) continue;
          await unlink(this.path(id, "lock")).catch((error) => {
            if (!hasCode(error, "ENOENT")) throw error;
          });
        }
        await this.lock(id, async () => {
          if (name === `${id}.json`) {
            try {
              const object = await this.read(id);
              if (object && object.expiresAt <= this.now()) await this.remove(id);
              else if (object) this.objects.set(id, object);
              else this.objects.delete(id);
            } catch (error) {
              if (!(error instanceof CorruptMetadataError)) throw error;
              if (lstatSync(this.path(id, "json")).mtimeMs + UPLOAD_TTL <= this.now()) {
                await this.remove(id);
                this.onError(error, id);
              }
            }
          } else if (/^[a-f0-9-]{36}\.(?:data|[a-f0-9-]{36}\.tmp)$/.test(name)) {
            const path = join(this.root, name);
            const stat = lstatSync(path);
            try {
              if (stat.mtimeMs + UPLOAD_TTL <= this.now() && !(await this.read(id)))
                await unlink(path);
            } catch (error) {
              if (!(error instanceof CorruptMetadataError)) throw error;
            }
          }
        });
      } catch (error) {
        if (!hasCode(error, "ENOENT") && !hasCode(error, "workspace-upload-busy"))
          this.onError(error, id);
      }
    }
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.ready;
    await this.sweeping;
  }
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
async function* empty(): AsyncIterable<Uint8Array> {}
function uploadPage(): Response {
  const nonce = randomBytes(24).toString("base64");
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Upload a file</title><h1>Upload a file</h1><form><label>Choose file <input type="file" required></label><button>Upload</button></form><p role="status"></p><script nonce="${nonce}">document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const status=document.querySelector('[role=status]');const file=document.querySelector('input').files[0];if(!file)return;status.textContent='Uploading…';try{const url=new URL(location.href);url.pathname=url.pathname.replace(/\\/page$/,'');const response=await fetch(url,{method:'PUT',body:file,credentials:'omit'});status.textContent=response.ok?'Upload complete. Return to your assistant.':response.status===413?'File is too large. Choose a smaller file.':response.status===429?'Staging quota exceeded. Try again later.':'Upload failed. Ask your assistant for a new link.';}catch{status.textContent='Upload failed. Try again.';}});</script></html>`,
    {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}

function safeDownloadName(name: string): string {
  return (
    Array.from(
      Buffer.from(name)
        .toString("utf8")
        .replace(/[\\/\p{Cc}]/gu, "_"),
    )
      .slice(0, 180)
      .join("") || "download"
  );
}
