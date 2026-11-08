import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { constants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { open, readdir, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  "text/csv",
]);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const missing = () => workspaceError("workspace-upload-not-found", "Upload not found or expired.");
const sizeError = () =>
  workspaceError(
    "workspace-file-size-mismatch",
    "File size differs from the declared size or exceeds the purpose limit.",
  );
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
  private sweeping: Promise<void> | undefined;

  constructor(
    directory: string,
    private readonly publicUrl: string,
    options: {
      limits?: UploadLimits;
      now?: () => number;
      intervalMs?: number;
      onError?: () => void;
    } = {},
  ) {
    this.limits = options.limits ?? defaultLimits;
    this.now = options.now ?? Date.now;
    this.root = resolve(directory);
    const first = mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.directories.add(this.root);
    if (first !== undefined)
      for (let current = this.root; current !== first; current = dirname(current))
        this.directories.add(dirname(current));
    this.canonical = realpathSync(this.root);
    this.checkRoot();
    this.ready = this.sweep();
    this.timer = setInterval(() => {
      if (this.sweeping) return;
      this.sweeping = this.ready
        .then(() => this.sweep())
        .catch(() => options.onError?.())
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
    try {
      const file = await this.safeOpen(this.path(id, "json"));
      try {
        const object = objectSchema.parse(JSON.parse(await file.readFile("utf8")));
        if (object.id !== id) throw new Error("Staging identity mismatch.");
        return object;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (hasCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
  private async metadata(object: StagingObject): Promise<void> {
    const temp = this.path(object.id, `${randomUUID()}.tmp`);
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(object));
      await file.sync();
      await file.close();
      await rename(temp, this.path(object.id, "json"));
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
    if (input.size > this.limits[input.purpose]) throw sizeError();
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
      size: input.size,
      state: "pending",
      createdAt,
      expiresAt: createdAt + UPLOAD_TTL,
      tokenHash: hash(token),
    };
    await this.metadata(object);
    return {
      upload: {
        upload_id: object.id,
        upload_url: this.link(object, token),
        page_url: this.link(object, token, true),
        expires_at: new Date(createdAt + LINK_TTL).toISOString(),
        max_bytes: this.limits[input.purpose],
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
        if ((await file.stat()).size !== object.size) throw sizeError();
        return await consume(object, path);
      } finally {
        await file.close();
      }
    });
  }
  private async lock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const path = this.path(id, "lock");
    let file: FileHandle;
    try {
      file = await open(path, "wx", 0o600);
    } catch (error) {
      if (hasCode(error, "EEXIST"))
        throw workspaceError(
          "workspace-upload-busy",
          "File transfer is already in progress. Retry later.",
        );
      throw error;
    }
    try {
      return await action();
    } finally {
      await file.close();
      await unlink(path);
    }
  }
  private async write(
    object: StagingObject,
    content: AsyncIterable<Uint8Array>,
    expectedSize?: number,
  ): Promise<StagingObject> {
    const temp = this.path(object.id, `${randomUUID()}.tmp`);
    const file = await open(temp, "wx", 0o600);
    const digest = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of content) {
        size += chunk.byteLength;
        if (
          size > this.limits[object.purpose] ||
          (expectedSize !== undefined && size > expectedSize)
        )
          throw sizeError();
        digest.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset);
          if (bytesWritten === 0) throw new Error("Zero-byte staging write.");
          offset += bytesWritten;
        }
      }
      if ((expectedSize !== undefined && size !== expectedSize) || object.expiresAt <= this.now())
        throw sizeError();
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
      return ready;
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
      mediaType: input.mediaType.split(";")[0]?.trim(),
      size: input.size ?? 0,
      state: "pending",
      createdAt,
      expiresAt: createdAt + DOWNLOAD_TTL,
      tokenHash: hash(token),
    });
    if (input.size !== undefined && input.size > this.limits.blob) throw sizeError();
    await this.metadata(object);
    try {
      const ready = await this.write(object, input.content, input.size);
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
  async handle(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
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
    if (
      object.kind === "download" &&
      request.method === "GET" &&
      !match[3] &&
      object.state === "ready"
    ) {
      const file = await this.safeOpen(this.path(object.id, "data"));
      if ((await file.stat()).size !== object.size) {
        await file.close();
        throw sizeError();
      }
      return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>, {
        headers: {
          ...headers,
          "Content-Type": object.mediaType,
          "Content-Length": String(object.size),
          "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(object.fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
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
          if (
            length === null ||
            !/^\d+$/.test(length) ||
            Number(length) !== latest.size ||
            latest.size > this.limits[latest.purpose]
          )
            throw sizeError();
          await this.write(latest, request.body ?? empty(), latest.size);
        });
        return new Response(null, { status: 204, headers });
      } catch (error) {
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
  private async remove(id: string): Promise<void> {
    for (const suffix of ["json", "data"])
      await unlink(this.path(id, suffix)).catch((error) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
  }
  async sweep(): Promise<void> {
    this.checkRoot();
    for (const name of await readdir(this.root)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!idPattern.test(id)) continue;
      const object = await this.read(id);
      if (object && object.expiresAt <= this.now()) {
        await this.remove(id);
        await unlink(this.path(id, "lock")).catch((error) => {
          if (!hasCode(error, "ENOENT")) throw error;
        });
      }
    }
    for (const name of await readdir(this.root)) {
      if (!/^[a-f0-9-]{36}\.(?:data|[a-f0-9-]{36}\.tmp)$/.test(name)) continue;
      const path = join(this.root, name);
      const stat = lstatSync(path);
      if (stat.mtimeMs + UPLOAD_TTL <= this.now() && !(await this.read(name.slice(0, 36))))
        await unlink(path);
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
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Upload a file</title><h1>Upload a file</h1><form><label>Choose file <input type="file" required></label><button>Upload</button></form><p role="status"></p><script nonce="${nonce}">document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const status=document.querySelector('[role=status]');const file=document.querySelector('input').files[0];if(!file)return;status.textContent='Uploading…';try{const url=new URL(location.href);url.pathname=url.pathname.replace(/\\/page$/,'');const response=await fetch(url,{method:'PUT',body:file,credentials:'omit'});status.textContent=response.ok?'Upload complete. Return to your assistant.':'Upload failed. Ask your assistant for a new link.';}catch{status.textContent='Upload failed. Try again.';}});</script></html>`,
    {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
