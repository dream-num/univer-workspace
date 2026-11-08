import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";

// Mirrors the CLI's `skills` command (apps/cli/src/features/skills/command.ts) over the build-time copy of
// apps/cli/skill-data. Keep the order and the parsing identical so both clients show the same Skills.
export const SKILL_NAMES = [
  "base",
  "blob",
  "board",
  "core",
  "doc",
  "embed",
  "cross-unit-formula",
  "html-view",
  "sheet",
  "slide",
] as const;

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
}
export interface SkillSnapshot {
  readonly name: string;
  readonly content: string;
  readonly resources?: readonly { readonly path: string; readonly readCommand: string }[];
  readonly files?: readonly { readonly path: string; readonly content: string }[];
}

const invalid = (message: string) => workspaceError("workspace-argument-invalid", message);

export const readInstruction = (name: string, path: string) =>
  `Call skills_read with name "${name}" and resource "${path}".`;

function parseMetadata(content: string, path: string): SkillMetadata {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (match === null) throw new Error(`Invalid Skill frontmatter: ${path}`);
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const value = line.slice(separator + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    fields.set(line.slice(0, separator).trim(), quoted ? value.slice(1, -1) : value);
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || !description)
    throw new Error(`Skill frontmatter requires name and description: ${path}`);
  return { name, description };
}

async function supplementalPaths(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const child of ["references", "templates"] as const) {
    let entries;
    try {
      entries = await readdir(join(directory, child), { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) if (entry.isFile()) files.push(`${child}/${entry.name}`);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function load(root: string, name: string) {
  if (!SKILL_NAMES.some((known) => known === name)) {
    throw invalid(`Unknown skill: ${name}. Call skills_read without arguments to list the skills.`);
  }
  const directory = join(root, name);
  const content = await readFile(join(directory, "SKILL.md"), "utf8");
  const metadata = parseMetadata(content, `${name}/SKILL.md`);
  if (metadata.name !== name) {
    throw new Error(`Skill metadata name mismatch in ${name}/SKILL.md: received ${metadata.name}`);
  }
  return { directory, content, metadata, paths: await supplementalPaths(directory) };
}

export async function listSkills(root: string): Promise<readonly SkillMetadata[]> {
  return await Promise.all(SKILL_NAMES.map(async (name) => (await load(root, name)).metadata));
}

export async function getSkill(root: string, name: string, full: boolean): Promise<SkillSnapshot> {
  const { directory, content, paths } = await load(root, name);
  return {
    name,
    content,
    ...(paths.length === 0
      ? {}
      : { resources: paths.map((path) => ({ path, readCommand: readInstruction(name, path) })) }),
    ...(full
      ? {
          files: await Promise.all(
            paths.map(async (path) => ({
              path,
              content: await readFile(join(directory, path), "utf8"),
            })),
          ),
        }
      : {}),
  };
}

export async function readSkillResource(root: string, name: string, resource: string) {
  const { directory, paths } = await load(root, name);
  if (!paths.includes(resource)) {
    throw invalid(
      `Unknown resource for skill ${name}: ${resource}. Call skills_read with name "${name}" to list resources.`,
    );
  }
  return { name, path: resource, content: await readFile(join(directory, resource), "utf8") };
}

/** Every file of every Skill: SKILL.md first, then its references and templates. */
export async function listSkillFiles(
  root: string,
): Promise<readonly { readonly name: string; readonly path: string }[]> {
  const perSkill = await Promise.all(
    SKILL_NAMES.map(async (name) => {
      const { paths } = await load(root, name);
      return ["SKILL.md", ...paths].map((path) => ({ name, path }));
    }),
  );
  return perSkill.flat();
}

export const skillUri = (name: string, path: string) => `uvw://skills/${name}/${path}`;
export const skillMimeType = (path: string) =>
  path.endsWith(".md") ? "text/markdown" : "text/plain";
