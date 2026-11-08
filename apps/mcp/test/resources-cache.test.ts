import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openResourceLibrary, ResourceCacheUnsafeError } from "../src/gateway/resources.js";

describe("resource cache directories", () => {
  let sandbox: string;
  const downloader = { fetch: async () => new Response("<svg></svg>") };

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "mcp-cache-directories-"));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(sandbox, { recursive: true, force: true });
  });

  function firstHandle(library: ReturnType<typeof openResourceLibrary>): string {
    const [item] = library.find({ queries: ["arrow"], limit: 1 }).resources;
    if (item === undefined) throw new Error("Expected an arrow in the real catalog");
    return item.handle;
  }

  it("rejects a symlink or group-writable root before opening the library", async () => {
    const root = join(sandbox, "resources");
    await symlink(sandbox, root);
    expect(() => openResourceLibrary(root)).toThrow(ResourceCacheUnsafeError);
    await rm(root);
    await mkdir(root, { mode: 0o700 });
    await chmod(root, 0o770);
    expect(() => openResourceLibrary(root)).toThrow(ResourceCacheUnsafeError);
  });

  it("creates the default per-uid root privately and rechecks its existing parent", async () => {
    vi.stubEnv("TMPDIR", sandbox);
    const parent = join(sandbox, `univer-workspace-mcp-${String(userInfo().uid)}`);
    const library = openResourceLibrary(undefined, downloader);
    expect(library.cacheLocation).toBe(join(parent, "resources"));
    for (const directory of [parent, library.cacheLocation]) {
      const stat = await lstat(directory);
      expect(stat.mode & 0o777).toBe(0o700);
      expect(stat.uid).toBe(userInfo().uid);
    }
    await chmod(parent, 0o770);
    expect(() => openResourceLibrary(undefined)).toThrow(ResourceCacheUnsafeError);
    await expect(library.read({ handle: firstHandle(library) })).rejects.toThrow(
      ResourceCacheUnsafeError,
    );
  });

  it("rejects a preplanted default parent symlink without writing through it", async () => {
    vi.stubEnv("TMPDIR", sandbox);
    const parent = join(sandbox, `univer-workspace-mcp-${String(userInfo().uid)}`);
    await symlink(sandbox, parent);
    expect(() => openResourceLibrary(undefined)).toThrow(ResourceCacheUnsafeError);
    await expect(lstat(join(sandbox, "resources"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates every missing custom parent privately and rechecks it before reads", async () => {
    const parent = join(sandbox, "gateway");
    const middle = join(parent, "cache");
    const root = join(middle, "resources");
    const library = openResourceLibrary(root, downloader);
    for (const directory of [parent, middle, root]) {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    }
    await chmod(parent, 0o770);
    await expect(library.read({ handle: firstHandle(library) })).rejects.toThrow(
      ResourceCacheUnsafeError,
    );
    await chmod(parent, 0o700);
    await rename(parent, join(sandbox, "moved"));
    await symlink(join(sandbox, "moved"), parent);
    await expect(library.read({ handle: firstHandle(library) })).rejects.toThrow(
      ResourceCacheUnsafeError,
    );
  });

  it("refuses an unsafe registry or a non-regular SVG", async () => {
    const root = join(sandbox, "resources");
    const library = openResourceLibrary(root, downloader);
    const handle = firstHandle(library);
    const registry = join(root, handle.split("/")[0]!);
    await mkdir(registry, { mode: 0o700 });
    await chmod(registry, 0o777);
    await expect(library.read({ handle })).rejects.toThrow(ResourceCacheUnsafeError);
    await chmod(registry, 0o700);
    await mkdir(join(root, `${handle}.svg`));
    await expect(library.read({ handle })).rejects.toThrow(ResourceCacheUnsafeError);
  });
});
