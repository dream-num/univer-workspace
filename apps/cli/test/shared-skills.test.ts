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
    const sharedContent = path === join(root, "html-view", "SKILL.md")
      ? content.replaceAll("`html-view validate --worktree <id>`", "the HTML View validation operation")
      : content;
    expect(sharedContent, path).not.toMatch(clientSyntax);
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

it("allows only the documented HTML View validation scope command", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-skills-html-view-"));
  try {
    await mkdir(join(root, "html-view"));
    const path = join(root, "html-view", "SKILL.md");
    await writeFile(path, "Use `html-view validate --worktree <id>`.");
    await checkSharedSkills(root);
    await writeFile(path, "Use `html-view create --worktree <id>`.");
    await expect(checkSharedSkills(root)).rejects.toThrow("SKILL.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["SKILL.md", "references/design.md"])("selects HTML View styles from context without a default wait in %s", async (path) => {
  const content = (await readFile(join(skillRoot, "html-view", path), "utf8")).replace(/\s+/gu, " ");
  expect(content).not.toMatch(/end your turn and wait|never silently choose/iu);
  for (const term of ["purpose", "audience", "adjectives", "dense rankings", "time series", "tasks/status", "key numbers", "one question", "one-line description"])
    expect(content).toContain(term);
  expect(content).toMatch(/structurally closest template/u);
  expect(content).toMatch(/name the (?:chosen )?style and why/iu);
  expect(content).toContain("offer to change it");
});
