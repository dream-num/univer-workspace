/** Read only the references/templates shipped with a known bundled Skill. */
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { UniverError } from "../tools/errors.ts";

export class BundledSkillResources {
  private readonly names: ReadonlySet<string>;
  private readonly root: string;

  constructor(root: URL, names: readonly string[]) {
    this.root = fileURLToPath(root);
    this.names = new Set(names);
  }

  async entry(skill: string, signal?: AbortSignal): Promise<string> {
    const directory = await this.directory(skill, signal);
    return this.readFile(directory, "SKILL.md", signal);
  }

  async list(skill: string, signal?: AbortSignal): Promise<string[]> {
    const directory = await this.directory(skill, signal);
    const paths: string[] = [];
    const visit = async (path: string): Promise<void> => {
      signal?.throwIfAborted();
      const target = join(directory, path);
      try {
        // Do not follow resource-directory symlinks, including the top-level folders.
        if (!(await lstat(target)).isDirectory()) return;
        if (!contains(directory, await realpath(target))) throw unavailable();
        for (const entry of await readdir(target, { withFileTypes: true })) {
          const child = `${path}/${entry.name}`;
          if (entry.isDirectory()) await visit(child);
          else if (entry.isFile()) paths.push(child);
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (isMissing(error)) return;
        throw unavailable();
      }
    };
    await visit("references");
    await visit("templates");
    return paths.sort();
  }

  async read(skill: string, path: string, signal?: AbortSignal) {
    const paths = await this.list(skill, signal);
    if (!paths.includes(path)) {
      throw new UniverError(
        "Resource is not listed for this bundled Skill. Load the Skill to see available resource paths.",
        "SKILL_RESOURCE_NOT_FOUND",
      );
    }
    const directory = await this.directory(skill, signal);
    return { skill, path, content: await this.readFile(directory, path, signal) };
  }

  private async directory(skill: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!this.names.has(skill)) {
      throw new UniverError(
        "Unknown bundled Workspace Skill. Use its exact catalog name.",
        "SKILL_NOT_FOUND",
      );
    }
    try {
      const root = await realpath(this.root);
      const path = join(root, skill);
      if (!(await lstat(path)).isDirectory()) throw unavailable();
      const directory = await realpath(path);
      if (!contains(root, directory)) throw unavailable();
      return directory;
    } catch {
      signal?.throwIfAborted();
      throw unavailable();
    }
  }

  private async readFile(directory: string, path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    try {
      const target = join(directory, path);
      if (!(await lstat(target)).isFile()) throw unavailable();
      const canonical = await realpath(target);
      if (!contains(directory, canonical)) throw unavailable();
      return await readFile(canonical, { encoding: "utf8", signal });
    } catch {
      signal?.throwIfAborted();
      throw unavailable();
    }
  }
}

function contains(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function unavailable(): UniverError {
  return new UniverError(
    "Bundled Skill resource is missing, unreadable, or outside its package directory.",
    "SKILL_RESOURCE_UNAVAILABLE",
  );
}
