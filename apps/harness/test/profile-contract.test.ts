import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

const profilePatchUrl = new URL("../cordis.patch.yml", import.meta.url);
const compositionSourceRoots = [
  new URL("../src/", import.meta.url),
  new URL("../../../packages/dsh-univer-workspace-plugin/src/", import.meta.url),
  new URL("../../../packages/dsh-univer-workspace-skin-plugin/src/", import.meta.url),
] as const;

async function collectSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectSources(path);
      return [".ts", ".tsx", ".mjs"].includes(extname(entry.name)) ? [path] : [];
    }),
  );

  return nested.flat();
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*)["']([^"']+)["']/g),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

describe("Harness profile command-line contract", () => {
  it("lets the DSH Web --port flag override deployment defaults consistently", async () => {
    const profilePatch = await readFile(profilePatchUrl, "utf8");

    expect(profilePatch).toContain(
      "port: !!js ctx.webStartup.port ?? Number(process.env.PORT ?? 3080)",
    );
    expect(profilePatch).toContain(
      "`http://127.0.0.1:${ctx.webStartup.port ?? process.env.PORT ?? 3080}`",
    );
  });

  it("extends DSH only through public route registration contracts", async () => {
    const entry = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(entry).toContain("ctx.webServer.register(route)");

    for (const root of compositionSourceRoots) {
      for (const path of await collectSources(root.pathname)) {
        const source = await readFile(path, "utf8");
        expect(source, path).not.toContain(".upgrades");
        expect(source, path).not.toContain(".prefixes");
        expect(source, path).not.toContain("dsh-host-apiproxy");

        for (const specifier of importSpecifiers(source)) {
          expect(specifier, path).not.toContain("deepseek-harness");
          expect(specifier, path).not.toContain("node_modules");
          if (specifier.startsWith("@deepseek-ai/")) {
            expect(specifier, path).not.toMatch(/\/(?:src|lib|dist)(?:\/|$)/);
          }
        }
      }
    }
  });
});
