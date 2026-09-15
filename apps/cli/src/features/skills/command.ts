import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";

const RUNTIME_SKILL_NAMES = [
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

interface SkillMetadata {
  readonly description: string;
  readonly name: string;
}

interface SkillFile {
  readonly content: string;
  readonly path: string;
}

interface SkillResource {
  readonly path: string;
  readonly readCommand: string;
}

interface SkillSnapshot {
  readonly content: string;
  readonly directory: string;
  readonly files?: readonly SkillFile[];
  readonly metadata: SkillMetadata;
  readonly resources: readonly SkillResource[];
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
            ...(snapshot.resources.length === 0 ? {} : { resources: snapshot.resources }),
            ...(snapshot.files === undefined ? {} : { files: snapshot.files }),
          })),
        },
        snapshots.map(renderSkillSnapshot).join("\n\n---\n\n"),
      );
    });

  const read = new Command("read")
    .description("Read one bundled reference or template without accessing installation paths")
    .argument("<name>", "Skill name")
    .argument("<resource>", "resource path listed by skills get, e.g. references/authoring.md")
    .option("--json", "write structured JSON")
    .action(async (name: string, resource: string, options: JsonOption) => {
      const result = await run(read, async () => {
        const snapshot = await readSkillSnapshot(skillDataRoot, name, false);
        if (!snapshot.resources.some((entry) => entry.path === resource)) {
          throw new SkillResourceError(
            `Unknown resource for skill ${name}: ${resource}. Run univer-workspace-cli skills get ${name} to list resources.`,
          );
        }
        return {
          name,
          path: resource,
          content: await readFile(join(snapshot.directory, resource), "utf8"),
        };
      });
      write(read, options, { success: true, data: result }, result.content.trimEnd());
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

  return skills.addCommand(list).addCommand(get).addCommand(read).addCommand(path);
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
  const resources = (await listSupplementalPaths(directory)).map((path) => ({
    path,
    readCommand: `univer-workspace-cli skills read ${name} ${shellArgument(path)}`,
  }));
  return {
    content,
    directory,
    metadata,
    resources,
    ...(full
      ? {
          files: await Promise.all(
            resources.map(async ({ path }) => ({
              path,
              content: await readFile(join(directory, path), "utf8"),
            })),
          ),
        }
      : {}),
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

async function listSupplementalPaths(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
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
      files.push(`${child}/${entry.name}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function renderSkillSnapshot(snapshot: SkillSnapshot): string {
  if (snapshot.files === undefined && snapshot.resources.length > 0) {
    return [
      snapshot.content.trimEnd(),
      "\nRead bundled references and templates through the CLI (no installation-directory access needed):\n",
      ...snapshot.resources.map((resource) => resource.readCommand),
      `\nRead all: univer-workspace-cli skills get ${snapshot.metadata.name} --full`,
    ].join("\n");
  }
  if (snapshot.files === undefined || snapshot.files.length === 0) {
    return snapshot.content.trimEnd();
  }
  return [
    snapshot.content.trimEnd(),
    ...snapshot.files.map((file) => `\n--- ${file.path} ---\n\n${file.content.trimEnd()}`),
  ].join("\n");
}

function shellArgument(value: string): string {
  return /^[a-zA-Z0-9_./-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
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
