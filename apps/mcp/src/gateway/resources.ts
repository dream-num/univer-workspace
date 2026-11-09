import { constants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  createResourceLibrary,
  FilesystemResourceCache,
  FilesystemResourceOutput,
  HttpsResourceDownloader,
  loadResourceManifestFromPath,
  type HttpsResourceDownloaderOptions,
  type ResourceLibrary,
} from "@univer-cli/resource-library";

export class ResourceCacheUnsafeError extends Error {
  readonly code = "workspace-resource-cache-unsafe";

  constructor() {
    super("The SVG resource cache is unsafe.");
  }
}

export class ResourceCacheIoError extends Error {
  constructor(cause: unknown) {
    super("The SVG resource cache could not be accessed.", { cause });
  }
}

// resource-library 1.3.1 follows cache symlinks; remove this adapter after upstream confines them.
class GatewayResourceCache extends FilesystemResourceCache {
  private readonly uid = userInfo().uid;
  private readonly directories = new Set<string>();
  private root: string | undefined;

  constructor(directory: string, privateParent: string | undefined) {
    super(directory);
    if (privateParent !== undefined) this.directories.add(privateParent);
    this.directories.add(this.location);
  }

  private checkDirectory(directory: string): void {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== this.uid || (stat.mode & 0o022) !== 0) {
      throw new ResourceCacheUnsafeError();
    }
  }

  private createDirectory(directory: string): void {
    const first = mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directories.add(directory);
    if (first !== undefined) {
      for (let current = directory; current !== first; current = dirname(current)) {
        this.directories.add(dirname(current));
      }
    }
    this.checkDirectory(directory);
  }

  private checkRoot(): void {
    let recreated = false;
    // Check tracked parents before recreating children so a replaced parent cannot redirect writes.
    for (const directory of [...this.directories].sort((a, b) => a.length - b.length)) {
      try {
        this.checkDirectory(directory);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
        this.createDirectory(directory);
        recreated = true;
      }
    }
    for (const directory of this.directories) this.checkDirectory(directory);
    const root = realpathSync(this.location);
    if (this.root !== undefined && !recreated && root !== this.root) {
      throw new ResourceCacheUnsafeError();
    }
    this.root = root;
  }

  private checkInside(path: string): void {
    if (this.root === undefined || !realpathSync(path).startsWith(this.root + sep)) {
      throw new ResourceCacheUnsafeError();
    }
  }

  private prepareFile(handle: string): string {
    this.checkRoot();
    // The library validates handles against the manifest before calling the cache.
    const file = join(this.location, `${handle}.svg`);
    const registry = dirname(file);
    try {
      mkdirSync(registry, { mode: 0o700 });
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    this.checkDirectory(registry);
    this.checkInside(registry);
    return file;
  }

  private checkFile(file: string) {
    this.checkRoot();
    this.checkDirectory(dirname(file));
    this.checkInside(dirname(file));
    const stat = lstatSync(file);
    if (!stat.isFile()) throw new ResourceCacheUnsafeError();
    this.checkInside(file);
    return stat;
  }

  override async read(handle: string): Promise<string | undefined> {
    try {
      const path = this.prepareFile(handle);
      try {
        lstatSync(path);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      }
      const before = this.checkFile(path);
      const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      ).catch((error: unknown) => {
        if (hasCode(error, "ELOOP")) throw new ResourceCacheUnsafeError();
        throw error;
      });
      try {
        const opened = await file.stat();
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
          throw new ResourceCacheUnsafeError();
        }
        const svg = await file.readFile("utf8");
        this.checkFile(path);
        return svg;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof ResourceCacheUnsafeError) throw error;
      throw new ResourceCacheIoError(error);
    }
  }

  override async write(handle: string, svg: string): Promise<void> {
    try {
      const path = this.prepareFile(handle);
      await super.write(handle, svg);
      this.checkFile(path);
    } catch (error) {
      if (error instanceof ResourceCacheUnsafeError) throw error;
      throw new ResourceCacheIoError(error);
    }
  }

  override async clear() {
    try {
      this.checkRoot();
      return await super.clear();
    } catch (error) {
      if (error instanceof ResourceCacheUnsafeError) throw error;
      throw new ResourceCacheIoError(error);
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Public catalog data is shared by gateway users within a private per-uid cache. */
export function openResourceLibrary(
  cacheDirectory: string | undefined,
  downloader?: HttpsResourceDownloaderOptions,
): ResourceLibrary {
  const privateParent = join(tmpdir(), `univer-workspace-mcp-${String(userInfo().uid)}`);
  const cache = new GatewayResourceCache(
    resolve(cacheDirectory ?? join(privateParent, "resources")),
    cacheDirectory === undefined ? privateParent : undefined,
  );
  return createResourceLibrary({
    cache,
    manifest: loadResourceManifestFromPath(
      createRequire(import.meta.url).resolve("@univerjs-pro/cli-assets/manifest.json"),
    ),
    downloader: new HttpsResourceDownloader(downloader),
    output: new FilesystemResourceOutput(),
  });
}
