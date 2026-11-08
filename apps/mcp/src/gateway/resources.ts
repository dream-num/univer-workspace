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

// resource-library 1.3.1 follows cache symlinks; remove this adapter after upstream confines them.
class GatewayResourceCache extends FilesystemResourceCache {
  private readonly uid = userInfo().uid;
  private readonly directories = new Set<string>();
  private readonly root: string;

  constructor(directory: string, privateParent: string | undefined) {
    super(directory);
    try {
      if (privateParent !== undefined) this.createDirectory(privateParent);
      this.createDirectory(this.location);
      this.root = realpathSync(this.location);
      this.checkRoot();
    } catch {
      throw new ResourceCacheUnsafeError();
    }
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
    for (const directory of this.directories) this.checkDirectory(directory);
    if (realpathSync(this.location) !== this.root) throw new ResourceCacheUnsafeError();
  }

  private checkInside(path: string): void {
    if (!realpathSync(path).startsWith(this.root + sep)) throw new ResourceCacheUnsafeError();
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

  private checkFile(file: string): void {
    this.checkRoot();
    this.checkDirectory(dirname(file));
    this.checkInside(dirname(file));
    if (!lstatSync(file).isFile()) throw new ResourceCacheUnsafeError();
    this.checkInside(file);
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
      this.checkFile(path);
      const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (!(await file.stat()).isFile()) throw new ResourceCacheUnsafeError();
        const svg = await file.readFile("utf8");
        this.checkFile(path);
        return svg;
      } finally {
        await file.close();
      }
    } catch {
      throw new ResourceCacheUnsafeError();
    }
  }

  override async write(handle: string, svg: string): Promise<void> {
    try {
      const path = this.prepareFile(handle);
      await super.write(handle, svg);
      this.checkFile(path);
    } catch {
      throw new ResourceCacheUnsafeError();
    }
  }

  override async clear() {
    try {
      this.checkRoot();
      return await super.clear();
    } catch {
      throw new ResourceCacheUnsafeError();
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
