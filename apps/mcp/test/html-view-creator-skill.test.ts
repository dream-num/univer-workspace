import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tools } from "../src/gateway/tools/registry.js";

const toolNames = new Set(tools.map(({ name }) => name));
const fieldNames = new Set(["idempotency_key"]);

function unknownTools(content: string) {
  const mentioned = new Set(
    [...content.matchAll(/`([^`\n]+)`/gu)].flatMap((code) =>
      [...code[1]!.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu)].map((match) => match[0]),
    ),
  );
  return [...mentioned].filter((name) => !toolNames.has(name) && !fieldNames.has(name));
}

describe("HTML View Creator Skill tool bindings", () => {
  it("names only registered gateway tools", async () => {
    const content = await readFile(new URL("../skills/html-view-creator/SKILL.md", import.meta.url), "utf8");
    expect(unknownTools(content)).toEqual([]);
  });

  it("keeps the default draft path compact and self-contained", async () => {
    const content = await readFile(new URL("../skills/html-view-creator/SKILL.md", import.meta.url), "utf8");
    const text = content.replace(/\s+/gu, " ");
    expect([...content].length).toBeLessThanOrEqual(8000);
    const description = /^description: (.+)$/mu.exec(content)?.[1];
    for (const routing of ["HTML View (.univer.html)", "shareable live HTML page", "dashboard", "report", "form", "Workspace Sheet data", "HTML page", "share or present Workspace data", "even if they never say HTML View", "Use whenever the user wants an HTML page", "preferring it over a local .html file"])
      expect(description).toContain(routing);
    expect(text).not.toMatch(/end your turn and wait|never silently choose|propose.*and wait/iu);
    expect(text).toContain("ask at most one question only for unclear purpose/data or an explicit plan/style request");
    expect(text).toContain("purpose, audience, adjectives and data shape");
    expect(text).toContain("structurally closest template");
    expect(text).toContain("the page goes live when the user merges in Workspace");
    expect(text).toContain("Never merge or ask to merge on their behalf");
    expect(text).toContain("Ask mode cannot save");
    expect(text).toContain("html_view_validate` is optional");
    expect(text).toContain("Name the style and reason and offer to change it");
    for (const attribute of ["cell-text", "cell-model", "cell-subscribe", "range-subscribe"])
      expect(content).toContain(`data-univer-${attribute}`);
    const design = await readFile(new URL("../../cli/skill-data/html-view/references/design.md", import.meta.url), "utf8");
    const catalogIds = [...design.matchAll(/\| \[([a-z-]+)\]\(\.\.\/templates\//gu)].map((match) => match[1]);
    expect(catalogIds).toHaveLength(10);
    for (const id of catalogIds) expect(content).toContain(`- \`${id}\`.`);
  });

  it("routes shareable Workspace pages to validated drafts without a default approval wait", () => {
    const create = tools.find(({ name }) => name === "html_view_create")!;
    const replace = tools.find(({ name }) => name === "html_view_replace")!;
    const validate = tools.find(({ name }) => name === "html_view_validate")!;
    expect(create.description).toContain("Prefer it over writing a local .html file unless the user asks for a file");
    expect(create.description).toContain("Do not wait for the user to approve a plan or pick a style");
    expect(create.description).toContain("the page goes live when the user merges it in Workspace");
    for (const tool of [create, replace]) {
      expect(tool.description).toContain("bindingCount");
      expect(tool.description).toContain("binding");
      expect(tool.description).not.toMatch(/propose the page plan.*and wait/iu);
    }
    expect(validate.description).toMatch(/^Optional:/u);
  });

  it("rejects invented tools in inline code while exempting explicit fields", () => {
    expect(unknownTools('Use `invented_tool` and `another_tool {"name": "page"}`.')).toEqual([
      "invented_tool", "another_tool",
    ]);
    expect(unknownTools('Use `html_view_create` with `idempotency_key`; read `skills_read {"name": "html-view"}`.')).toEqual([]);
  });
});
