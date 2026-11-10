import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const skillRoot = fileURLToPath(new URL("../skill-data/", import.meta.url));
const clientSyntax =
  /\buvw\b|UNIVER_HOME|^\s*(?:`{3,}|~{3,})(?:bash|sh|shell)\b|--(?:worktree|unit|json|out|file|space|apply|full|force)\b/im;

async function checkSharedSkills(root: string): Promise<void> {
  for (const file of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = join(file.parentPath, file.name);
    if (path.startsWith(join(root, "core") + sep)) continue;
    const content = await readFile(path, "utf8");
    expect(content, path).not.toMatch(clientSyntax);
  }
}

it("keeps every shared Skill file free of client syntax", async () => {
  await checkSharedSkills(skillRoot);
});

it.each([
  "uvw inspect",
  "UNIVER_HOME",
  "```bash",
  "```sh",
  "```shell",
  "~~~shell",
  ...["worktree", "unit", "json", "out", "file", "space", "apply", "full", "force"].map(
    (flag) => `--${flag}`,
  ),
])("rejects a seeded shared reference or template containing %s", async (violation) => {
  const root = await mkdtemp(join(tmpdir(), "shared-skills-"));
  try {
    await mkdir(join(root, "core"), { recursive: true });
    await writeFile(join(root, "core", "SKILL.md"), "uvw --json");
    await mkdir(join(root, "future", "templates"), { recursive: true });
    await writeFile(join(root, "future", "templates", "example.txt"), violation);
    await expect(checkSharedSkills(root)).rejects.toThrow("example.txt");
    await writeFile(join(root, "future", "templates", "example.txt"), "Run `inspect`.");
    await checkSharedSkills(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
