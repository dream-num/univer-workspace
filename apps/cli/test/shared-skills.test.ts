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

it("selects styles from context and keeps the binding starter optional", async () => {
  const content = (await readFile(join(skillRoot, "html-view", "SKILL.md"), "utf8")).replace(/\s+/gu, " ");
  expect(content).not.toMatch(/end your turn and wait|never silently choose/iu);
  for (const term of ["purpose", "audience", "adjectives", "dense rankings", "time series", "tasks/status", "key numbers",
    "structurally closest style card", "always name the style and why", "offer to change it", "one-line description",
    "binding pattern is still unclear, the [binding starter](examples/binding-starter.univer.html)", "Never compute Sheet metrics in page code",
    "add Sheet formula cells", "session's pull request", "create a pull request and add the Sheet first"])
    expect(content).toContain(term);
  const authoring = (await readFile(join(skillRoot, "html-view/references/authoring.md"), "utf8")).replace(/\s+/gu, " ");
  for (const term of ["before the returned Promise resolves", "exactly the requested dimensions", "padded with null",
    "entirely empty range", "Separate subscriptions have no ordering", "every contributing callback calls",
    "Subscribe attributes never change the DOM", "replace initial placeholders", "echarts.init keeps existing children"])
    expect(authoring).toContain(term);
});

it("keeps the design reference focused on the catalog and design floor", async () => {
  const content = await readFile(join(skillRoot, "html-view/references/design.md"), "utf8");
  expect(content).toContain("[html-view Skill](../SKILL.md)");
  expect(content).toContain("Suitable context and data");
  expect(content).toContain("When the user describes their own");
  expect(content).toContain("start from the template whose structure best");
  expect(content).not.toContain("Free design is the default");
  expect(content).toContain("## Keep the craft floor");
  expect(content).not.toMatch(/ask at most one question|otherwise choose from the catalog/iu);
});

it("previews before saving and keeps preview details in an optional reference", async () => {
  const content = (await readFile(join(skillRoot, "html-view/SKILL.md"), "utf8")).replace(/\s+/gu, " ");
  for (const term of ["With a local shell and `node`, and not as an agent identity whose Sheets the user's browser cannot read, write the page to a local HTML file",
    "[local preview](references/local-preview.md) only when running the preview",
    "Preview and iterate until the report passes before saving",
    "Without Node or a local shell, skip preview and do not write local files",
    "`html_view_save` and `dryRun: true`", "save once as a draft", "Revise pending drafts with `draft`",
    "With the CLI there are no drafts: `html-view create` publishes at once",
    "Preview and save an existing local file with bindings as a draft too",
    "why it fits the request or data in one clause",
    "For a PR-linked draft, say the page goes live when the user merges the pull request in Workspace",
    "Only drafts without a PR use **Publish**"])
    expect(content).toContain(term);
  const reference = (await readFile(join(skillRoot, "html-view/references/local-preview.md"), "utf8")).replace(/\s+/gu, " ");
  for (const term of ['skills_read {"name":"html-view","resource":"scripts/preview.mjs"}',
    "complete returned content to a local file", "installed html-view Skill directory",
    "node preview.mjs page.univer.html [--open]", "one JSON object per line",
    '"event":"ready"', '"event":"report"', '"event":"waiting"', "GET /report?token=<token>",
    "HTTP 204 before any report", "signed-in browser", "confirms trust",
    "add `repo` and `pr` to the URL", "Preview writes are trial by default",
    "Fix every `renderCheck` issue", "Require status `passed`", "Fix every warning in `bindings`",
    "Remove every entry in `leftoverPlaceholders`", "sha256", "Save that same content",
    "Chrome can ask for local network access", "Safari supports the file picker only",
    "After each file save, pick the file again", "If Node or a local shell is unavailable, skip local preview",
    "`dryRun: true`", "without creating a draft", "do not execute scripts or prove rendering",
    "With the CLI, which has no drafts, run `html-view validate` and then `html-view create`",
    "When this connection is an agent identity, its Sheets are private to it"])
    expect(reference).toContain(term);
});
