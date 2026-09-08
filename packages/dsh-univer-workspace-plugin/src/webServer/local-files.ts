import { opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export interface LocalFileEntry {
  path: string;
  name: string;
  kind: "file" | "folder";
}

function hostPath(value: string): string {
  const expanded =
    value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded) || expanded.includes("\0"))
    throw new Error("An absolute host path is required");
  return resolve(expanded);
}

/** Resolve identity on the Harness host; never read file contents for completion. */
export async function resolveLocalFile(path: string): Promise<LocalFileEntry> {
  const canonical = await realpath(hostPath(path));
  const info = await stat(canonical);
  if (!info.isFile() && !info.isDirectory())
    throw new Error("Only regular files and folders can be referenced");
  return {
    path: canonical,
    name: basename(canonical) || canonical,
    kind: info.isDirectory() ? "folder" : "file",
  };
}

/** Bounded one-level browsing. A query is a path prefix, never a recursive search. */
export async function browseLocalFiles(query: string, signal: AbortSignal) {
  const requested = hostPath(query || homedir());
  let directory = requested;
  let prefix = "";
  try {
    if (!(await stat(requested)).isDirectory()) {
      directory = dirname(requested);
      prefix = basename(requested);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    directory = dirname(requested);
    prefix = basename(requested);
  }
  const parent = await resolveLocalFile(directory);
  const entries: LocalFileEntry[] = [];
  let scanned = 0;
  let truncated = false;
  const handle = await opendir(parent.path);
  for await (const entry of handle) {
    signal.throwIfAborted();
    if (++scanned > 5000 || entries.length >= 200) {
      truncated = true;
      break;
    }
    if (!entry.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) continue;
    if (entry.isFile() || entry.isDirectory()) {
      entries.push({
        path: join(parent.path, entry.name),
        name: entry.name,
        kind: entry.isDirectory() ? "folder" : "file",
      });
    } else if (entry.isSymbolicLink()) {
      try {
        entries.push({
          ...(await resolveLocalFile(join(parent.path, entry.name))),
          name: entry.name,
        });
      } catch {
        /* Broken or inaccessible links are not candidates. */
      }
    }
  }
  entries.sort(
    (a, b) =>
      Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name),
  );
  return { directory: parent.path, parent: dirname(parent.path), entries, truncated };
}
