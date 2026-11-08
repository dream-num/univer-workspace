import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createNodeResourceLibraryFactory,
  type ResourceLibrary,
} from "@univer-cli/resource-library";

/** The catalog is public data, so every user shares one cache. The default lives under the OS temp directory. */
export function openResourceLibrary(cacheDirectory: string | undefined): ResourceLibrary {
  return createNodeResourceLibraryFactory({
    cacheRoot: resolve(cacheDirectory ?? join(tmpdir(), "univer-workspace-mcp", "resources")),
    manifestPath: createRequire(import.meta.url).resolve("@univerjs-pro/cli-assets/manifest.json"),
  })();
}
