import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return await sourceFiles(path);
      return extname(entry.name) === ".ts" || extname(entry.name) === ".tsx" ? [path] : [];
    }),
  );
  return files.flat();
}

describe("Workspace file browser source policy", () => {
  it("keeps styling and interaction ownership inside the shared package boundary", async () => {
    for (const path of await sourceFiles(sourceRoot)) {
      const source = await readFile(path, "utf8");
      const label = relative(sourceRoot, path);

      expect(source, `${label} must keep component styles in SCSS modules`).not.toMatch(
        /\bstyle\s*=\s*\{\{/u,
      );
      expect(source, `${label} must not use native browser dialogs`).not.toMatch(
        /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/u,
      );
      expect(source, `${label} must not inject runtime style elements`).not.toMatch(
        /document\.createElement\(\s*["']style["']\s*\)/u,
      );
      expect(source, `${label} must not depend on DSH or application-private modules`).not.toMatch(
        /\bfrom\s+["'](?:@deepseek-ai\/|(?:\.\.\/)+apps\/)/u,
      );
    }
  });
});
