import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";

const RUNTIME_SKILL_NAMES = [
  "base",
  "board",
  "core",
  "doc",
  "embed",
  "cross-unit-formula",
  "sheet",
  "slide",
] as const;

interface SkillMetadata {
  readonly description: string;
  readonly name: string;
}

interface SkillFile {
  readonly content: string;
  readonly path: string;
}

interface SkillSnapshot {
  readonly content: string;
  readonly directory: string;
  readonly files?: readonly SkillFile[];
  readonly metadata: SkillMetadata;
}

interface JsonOption {
  readonly json?: boolean;
}

interface GetOptions extends JsonOption {
  readonly all?: boolean;
  readonly full?: boolean;
}

export function createSkillsCommand(skillDataRoot: string): Command {
  const skills = new Command("skills")
    .description("Read version-matched operational Skills")
    .enablePositionalOptions()
    .option("--json", "write structured JSON")
    .action(async (options: JsonOption) => {
      await listSkills(skills, skillDataRoot, options);
    });

  const list = new Command("list")
    .description("List version-matched operational Skills")
    .option("--json", "write structured JSON")
    .action(async (options: JsonOption) => {
      await listSkills(list, skillDataRoot, options);
    });

  const get = new Command("get")
    .description("Read one or all version-matched operational Skills")
    .argument("[name]", "Skill name")
    .option("--all", "read all operational Skills")
    .option("--full", "include direct references and templates")
    .option("--json", "write structured JSON")
    .action(async (name: string | undefined, options: GetOptions) => {
      if (options.all === true && name !== undefined) {
        fail(get, "skills get accepts either <name> or --all, not both.");
      }
      if (options.all !== true && name === undefined) {
        fail(get, "skills get requires a <name> or --all.");
      }
      const names = options.all === true ? RUNTIME_SKILL_NAMES : [name!];
      const snapshots = await run(
        get,
        async () =>
          await Promise.all(
            names.map(
              async (selected) =>
                await readSkillSnapshot(skillDataRoot, selected, options.full === true),
            ),
          ),
      );
      write(
        get,
        options,
        {
          success: true,
          data: snapshots.map((snapshot) => ({
            name: snapshot.metadata.name,
            content: snapshot.content,
            ...(snapshot.files === undefined ? {} : { files: snapshot.files }),
          })),
        },
        snapshots.map(renderSkillSnapshot).join("\n\n---\n\n"),
      );
    });

  const path = new Command("path")
    .description("Print installed Skill resource paths")
    .argument("[name]", "Skill name")
    .option("--json", "write structured JSON")
    .action(async (name: string | undefined, options: JsonOption) => {
      if (name === undefined) {
        write(path, options, { success: true, data: { paths: [skillDataRoot] } }, skillDataRoot);
        return;
      }
      const snapshot = await run(
        path,
        async () => await readSkillSnapshot(skillDataRoot, name, false),
      );
      write(
        path,
        options,
        { success: true, data: { name: snapshot.metadata.name, path: snapshot.directory } },
        snapshot.directory,
      );
    });

  return skills.addCommand(list).addCommand(get).addCommand(path);
}

async function listSkills(
  command: Command,
  skillDataRoot: string,
  options: JsonOption,
): Promise<void> {
  const snapshots = await run(
    command,
    async () =>
      await Promise.all(
        RUNTIME_SKILL_NAMES.map(
          async (name) => await readSkillSnapshot(skillDataRoot, name, false),
        ),
      ),
  );
  const metadata = snapshots.map((snapshot) => snapshot.metadata);
  write(
    command,
    options,
    { success: true, data: metadata },
    metadata.map((skill) => `${skill.name}\t${skill.description}`).join("\n"),
  );
}

async function readSkillSnapshot(
  skillDataRoot: string,
  name: string,
  full: boolean,
): Promise<SkillSnapshot> {
  if (!RUNTIME_SKILL_NAMES.includes(name as (typeof RUNTIME_SKILL_NAMES)[number])) {
    throw new SkillResourceError(`Unknown skill: ${name}`);
  }
  const directory = join(skillDataRoot, name);
  const skillPath = join(directory, "SKILL.md");
  let content: string;
  try {
    content = await readFile(skillPath, "utf8");
  } catch {
    throw new SkillResourceError(`Skill resource is missing: ${skillPath}`);
  }
  const metadata = parseSkillMetadata(content, skillPath);
  if (metadata.name !== name) {
    throw new SkillResourceError(
      `Skill metadata name mismatch in ${skillPath}: expected ${name}, received ${metadata.name}`,
    );
  }
  return {
    content,
    directory,
    metadata,
    ...(full ? { files: await readSupplementalFiles(directory) } : {}),
  };
}

function parseSkillMetadata(content: string, path: string): SkillMetadata {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (match === null) throw new SkillResourceError(`Invalid Skill frontmatter: ${path}`);
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields.set(line.slice(0, separator).trim(), unquote(line.slice(separator + 1).trim()));
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (name === undefined || name === "" || description === undefined || description === "") {
    throw new SkillResourceError(`Skill frontmatter requires name and description: ${path}`);
  }
  return { name, description };
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function readSupplementalFiles(directory: string): Promise<readonly SkillFile[]> {
  const files: SkillFile[] = [];
  for (const child of ["references", "templates"] as const) {
    const childRoot = join(directory, child);
    let entries;
    try {
      entries = await readdir(childRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absolutePath = join(childRoot, entry.name);
      if (!(await stat(absolutePath)).isFile()) continue;
      files.push({ path: `${child}/${entry.name}`, content: await readFile(absolutePath, "utf8") });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function renderSkillSnapshot(snapshot: SkillSnapshot): string {
  if (snapshot.files === undefined || snapshot.files.length === 0) {
    return snapshot.content.trimEnd();
  }
  return [
    snapshot.content.trimEnd(),
    ...snapshot.files.map((file) => `\n--- ${file.path} ---\n\n${file.content.trimEnd()}`),
  ].join("\n");
}

async function run<Result>(command: Command, operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SkillResourceError) fail(command, error.message);
    throw error;
  }
}

function write(command: Command, options: JsonOption, value: unknown, output: string): void {
  command
    .configureOutput()
    .writeOut?.(`${isJsonOutput(command, options) ? JSON.stringify(value) : output}\n`);
}

function isJsonOutput(command: Command, options: JsonOption): boolean {
  return options.json === true || command.optsWithGlobals()["json"] === true;
}

function fail(command: Command, message: string): never {
  command.error(message, { code: "skill-resource-error", exitCode: 1 });
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

class SkillResourceError extends Error {}
