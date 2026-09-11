import { readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runtimeSizeReport(root) {
  const components = {}, largestFiles = [];
  let bytes = 0, files = 0, sourceMapBytes = 0, sourceMapFiles = 0;
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) {
        const size = (await stat(path)).size;
        const name = relative(root, path).replaceAll("\\", "/");
        const component = name.startsWith("home/profiles/") ? "profile"
          : name.startsWith("home/internal-packages/") ? "plugin-install-sources"
          : name.split("/")[0];
        bytes += size; files++;
        components[component] = (components[component] ?? 0) + size;
        if (name.endsWith(".map")) { sourceMapBytes += size; sourceMapFiles++; }
        largestFiles.push({ path: name, bytes: size });
      }
    }
  }
  await visit(root);
  return { bytes, files, sourceMapBytes, sourceMapFiles, components,
    largestFiles: largestFiles.sort((a, b) => b.bytes - a.bytes).slice(0, 20) };
}

export function verifySizeReport(report) {
  if (report.sourceMapFiles) throw new Error("Desktop runtime contains source maps");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runtimeSizeReport(resolve(process.argv[2]));
  if (process.argv[3] && !process.argv[3].startsWith("--")) await writeFile(process.argv[3], JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--check")) verifySizeReport(report);
}
