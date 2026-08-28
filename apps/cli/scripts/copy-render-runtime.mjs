import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRequire = createRequire(join(appRoot, "package.json"));
const coreRoot = await packageRoot(appRequire.resolve("@univerjs/univer-workspace-client-core"));
const source = join(coreRoot, "dist", "render-runtime");
const target = join(appRoot, "dist", "render-runtime");
const index = await readFile(join(source, "index.html"), "utf8");
const references = [...index.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1]);
if (references.length === 0 || references.some((reference) => !reference.startsWith("./"))) {
  throw new Error("Client Core render page has an invalid asset manifest");
}
for (const reference of references) await access(join(source, reference));
await rm(target, { force: true, recursive: true });
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });

async function packageRoot(resolvedEntry) {
  let directory = dirname(resolvedEntry);
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === "@univerjs/univer-workspace-client-core") return directory;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Unable to locate Client Core package root");
    directory = parent;
  }
}
