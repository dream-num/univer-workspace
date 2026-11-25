import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tools } from "../src/gateway/tools/registry.js";

const core = await readFile(new URL("../skills/core/SKILL.md", import.meta.url), "utf8");
const bindings = new Map<string, string>();
for (const line of core.split("\n")) {
  const binding = /^- (.+) -> (?:`([a-z_]+)`|(unavailable))[.;]/u.exec(line);
  if (!binding) continue;
  for (const operation of binding[1]!.matchAll(/`([^`]+)`/gu)) {
    bindings.set(operation[1]!, binding[2] ?? binding[3]!);
  }
}

function resolveOperation(operation: string) {
  if (operation.startsWith("auth ")) return bindings.get("auth *");
  return bindings.get(operation) ?? operation.replace(/^worktree /u, "pr ").replace(/[ -]/gu, "_");
}

const groups = new Set([
  "api", "asset", "auth", "blob", "file", "html-view", "issue", "job", "label",
  "pr", "repo", "resources", "skills", "space", "unit", "worktree", "search",
]);
const singles = new Set([
  "whoami", "claim", "share", "browse", "execute", "outline", "read", "find", "inspect",
  "screenshot", "import", "export", "lint", "config", "daemon", "-v",
]);

function operationName(command: string) {
  const words = command.trim().split(/\s+/u);
  const root = words[0]!;
  const length = /^(?:space node|resources cache|file upload)\b/u.test(command) ? 3
    : groups.has(root) || command.startsWith("screenshot setup") ? 2 : 1;
  if (words.length < length) return undefined;
  return words.slice(0, length).join(" ");
}

function mentionedOperations(content: string) {
  const operations = new Set<string>();
  for (const match of content.matchAll(/\buvw[ \t]+([^`\n]+)/gu)) {
    const operation = operationName(match[1]!);
    if (operation) operations.add(operation);
  }
  const prose = content.replace(/^```[^\n]*\n[\s\S]*?^```/gmu, "");
  for (const match of prose.matchAll(/`([^`\n]+)`/gu)) {
    const command = match[1]!.replace(/^uvw\s+/u, "");
    const root = command.split(/\s+/u)[0]!;
    if (!groups.has(root) && !singles.has(root) && !/^(?:compile-|export-|print-)[a-z-]+$/u.test(root)) continue;
    const operation = operationName(command);
    if (operation) operations.add(operation);
  }
  return [...operations].sort();
}

describe("shared Skill operation resolution", () => {
  it("parses command mentions with arguments, aliases and shell examples without reading API code as commands", () => {
    expect(mentionedOperations([
      "Use `pr create`, `worktree ready`, `space node move` and `compile-svg`.",
      "Run `repo edit <repo> --visibility public` or `html-view validate --worktree <id>`.",
      "Read `unitId`, `workbook.getSheets()` and `label` as data.",
      "```bash\nuvw api show FWorkbook\nuvw invented --json\n```",
      "```ts\nconst read = 'not a command';\n```",
      "Use `uvw pr create --repo example`.",
    ].join("\n"))).toEqual([
      "api show", "compile-svg", "html-view validate", "invented", "pr create", "repo edit",
      "space node move", "worktree ready",
    ]);
    expect(resolveOperation("pr invented")).toBe("pr_invented");
    expect(tools.some(({ name }) => name === resolveOperation("pr invented"))).toBe(false);
  });

  it("documents the naming rule, real exceptions, unavailable commands and complete toolset lists", () => {
    expect(core).toContain("Replace spaces and hyphens in an operation name with underscores");
    expect(core).toContain("Single-word names stay unchanged");
    expect(core).toContain("worktree prefix with pr first");
    expect([...core].length).toBeLessThanOrEqual(20800);
    expect(Object.fromEntries(bindings)).toEqual({
      "repo rename": "repo_edit", "skills list": "skills_read", "skills get": "skills_read",
      "space node create": "space_node", "space node rename": "space_node",
      "space node move": "space_node", "space node trash": "space_node",
      "issue close": "issue_set_state", "issue reopen": "issue_set_state",
      "issue submit": "issue_verdict", "issue accept": "issue_verdict", "issue send-back": "issue_verdict",
      "label create": "label_write", "label edit": "label_write", "label delete": "label_write",
      "search issues": "search", "search prs": "search", "html-view create": "html_view_save",
      "auth *": "unavailable", "config": "unavailable", "daemon": "unavailable",
      "screenshot setup": "unavailable", "skills path": "unavailable",
      "resources cache path": "unavailable", "resources cache clear": "unavailable",
      "-v": "unavailable", "html-view validate": "unavailable",
    });
    for (const target of bindings.values()) {
      expect(target === "unavailable" || tools.some(({ name }) => name === target), target).toBe(true);
    }
    expect(resolveOperation("auth login")).toBe("unavailable");
    expect(resolveOperation("worktree merge")).toBe("pr_merge");
    for (const toolset of ["admin", "files"]) {
      const line = core.split("\n").find((line) => line.startsWith(`- ${toolset}:`))!;
      const listed = [...line.split(". For")[0]!.matchAll(/`([a-z_]+)`/gu)].map((match) => match[1]!);
      expect(listed.sort()).toEqual(tools.filter((tool) => tool.toolset === toolset).map(({ name }) => name).sort());
    }
  });

  it("resolves every operation referenced by the shared Skills and their shipped references", async () => {
    const source = new URL("../../cli/skill-data/", import.meta.url);
    const assembled = new URL("../dist/skill-data/", import.meta.url);
    const shipped = new Set(await readdir(assembled));
    const operations = new Set<string>();
    let files = 0;
    for (const skill of await readdir(source)) {
      if (skill === "core" || !shipped.has(skill)) continue;
      const root = new URL(`${skill}/`, source);
      for (const path of await readdir(root, { recursive: true })) {
        if (path !== "SKILL.md" && !/^references\/.*\.md$/u.test(path)) continue;
        const content = await readFile(new URL(path, root), "utf8");
        expect(await readFile(new URL(`${skill}/${path}`, assembled), "utf8")).toBe(content);
        files++;
        for (const operation of mentionedOperations(content)) {
          operations.add(operation);
          const target = resolveOperation(operation);
          expect(target === "unavailable" || tools.some(({ name }) => name === target), `${skill}/${path}: ${operation} -> ${target}`).toBe(true);
        }
      }
    }
    expect(files).toBeGreaterThan(9);
    expect(operations.size).toBeGreaterThan(20);
    console.info(`Checked ${operations.size} distinct operations across ${files} shared Skill and reference files: ${[...operations].sort().join(", ")}`);
  });
});
