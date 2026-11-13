import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "../src/gateway/tools/registry.js";
import { IDEMPOTENCY_KEY_DESCRIPTION } from "../src/gateway/tools/schemas.js";

const names = new Set(tools.map(({ name }) => name));

function unknownTools(content: string) {
  const mentioned = new Set(
    [...content.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/gu)].map((match) => match[1]!),
  );
  for (const row of content.split("\n")) {
    if (!row.startsWith("|")) continue;
    const target = row.split("|")[2];
    for (const match of target?.matchAll(/^\s*`([a-z][a-z0-9_]*)`\s*$/gu) ?? []) {
      mentioned.add(match[1]!);
    }
  }
  return [...mentioned].filter((name) => !names.has(name));
}

describe("MCP core Skill tool bindings", () => {
  it("keeps verified edits in draft until the user requests completion or review", async () => {
    for (const path of ["../skills/core/SKILL.md", "../dist/skill-data/core/SKILL.md"]) {
      const content = (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\s+/gu, " ");
      expect(content, path).toContain(
        "Ready only on explicit user completion/review request; undo true returns ready to draft",
      );
      expect(content, path).toContain("Continue draft directly. Only writes need draft");
      expect(content, path).toContain(
        "read-only `execute`, `screenshot`, `export`, `export_markdown` and `print_pdf` work on a ready Worktree unchanged.",
      );
      expect(content, path).toContain(
        "Before the first write of an explicitly requested rework, return ready to draft once with `pr_ready` and undo true.",
      );
      expect(content, path).toContain(
        "Leave the rework in draft until a new explicit user completion or review request.",
      );
      expect(content, path).toContain("Read stored content with `inspect` or read-only `execute`.");
      expect(content, path).toContain(
        "Only mark the Worktree ready with `pr_ready` when the user explicitly says the work is finished or requests review. Otherwise, leave the verified changes in draft.",
      );
      expect(content, path).toContain(
        "Read it with `pr_view` and confirm draft, or ready if explicitly requested.",
      );
      expect(content, path).toContain(
        "Return the review URL, pull request number, Worktree id and Unit id to the user.",
      );
      expect(content, path).not.toContain("3. Mark the Worktree ready with `pr_ready`.");
      expect(content, path).not.toContain("4. Read it with `pr_view` and confirm ready.");
      expect(content, path).not.toContain("mark it ready once when the rework is done");
    }
    const description = tools.find(({ name }) => name === "execute")!.description;
    expect(description).toContain("Content writes require a draft Worktree");
    expect(description).toContain(
      "before writing to an already-ready pull request, use pr_ready with undo: true",
    );
    expect(description).toContain("Read-only code does not require reopening");
    expect(description).toContain("Read back with inspect to verify changes");
    expect(description).toContain(
      "leave them in draft unless the user explicitly requests completion or review",
    );
    expect(description).not.toContain("Read back with inspect before marking ready.");
  });

  it("states the shared idempotency key rule", async () => {
    const content = await readFile(new URL("../skills/core/SKILL.md", import.meta.url), "utf8");
    expect(content.replace(/\s+/gu, " ")).toContain(IDEMPOTENCY_KEY_DESCRIPTION);
  });

  it("names only registered tools, including single-word table bindings", async () => {
    const root = new URL("../skills/", import.meta.url).pathname;
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const content = await readFile(path, "utf8");
      expect(unknownTools(content), path).toEqual([]);
      expect(content, path).not.toMatch(/\buvw\b/u);
    }
  });

  it("serves no CLI invocation in any assembled Skill file", async () => {
    const root = new URL("../dist/skill-data/", import.meta.url).pathname;
    const files = await readdir(root, { recursive: true, withFileTypes: true });
    expect(files.filter((entry) => entry.isFile()).length).toBeGreaterThan(10);
    for (const entry of files) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      expect(await readFile(path, "utf8"), path).not.toMatch(/\buvw\b/u);
    }
  });

  it("assembles the shared Sheet reading workflow and reference", async () => {
    const source = new URL("../../cli/skill-data/sheet/", import.meta.url);
    const assembled = new URL("../dist/skill-data/sheet/", import.meta.url);
    for (const path of ["SKILL.md", "references/reading.md"]) {
      expect(await readFile(new URL(path, assembled), "utf8")).toBe(
        await readFile(new URL(path, source), "utf8"),
      );
    }
    const skill = await readFile(new URL("SKILL.md", assembled), "utf8");
    expect(skill).toContain("## Read a sheet");
    expect(skill).toContain("(references/reading.md)");
    const reference = await readFile(new URL("references/reading.md", assembled), "utf8");
    for (const operation of ["outline", "read", "find"]) {
      expect(reference).toContain(`## ${operation}\n`);
    }
  });

  it("describes every tool without naming the CLI", () => {
    expect(
      tools.filter(({ description }) => /\buvw\b/u.test(description)).map(({ name }) => name),
    ).toEqual([]);
  });

  it("rejects invented snake_case tools and single-word operation bindings", () => {
    expect(unknownTools("Use `invented_tool`.\n| `inspect` | `invented` | Read content |")).toEqual(
      ["invented_tool", "invented"],
    );
    expect(unknownTools("Use `api_show`.\n| `inspect` | `inspect` | Read content |")).toEqual([]);
    expect(unknownTools("| `user-invocable` | `false` hides it; `true` shows it. |")).toEqual([]);
  });
});
