import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tools } from "../src/gateway/tools/registry.js";

const toolNames = new Set(tools.map(({ name }) => name));
const fieldNames = new Set(["idempotency_key", "html_upload_id"]);

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
    expect([...content].length).toBeLessThanOrEqual(8500);
    const description = /^description: (.+)$/mu.exec(content)?.[1];
    for (const routing of ["HTML View (.univer.html)", "shareable live HTML page", "dashboard", "report", "form", "Workspace Sheet data", "Prefer it over a local .html unless the user asks for a file"])
      expect(description).toContain(routing);
    expect(text).not.toMatch(/end your turn and wait|never silently choose|propose.*and wait/iu);
    expect(text).toContain("ask at most one question only for unclear purpose/data or an explicit plan/style request");
    expect(text).toContain("purpose, audience, adjectives and data shape");
    expect(text).toContain("structurally closest style card");
    expect(text).toContain("the page goes live when the user merges in Workspace");
    expect(text).toContain("Never merge or ask to merge on their behalf");
    expect(text).toContain("Ask mode cannot save");
    expect(text).toContain("Pass inline `html` by default");
    expect(text).toContain("Name the style and reason and offer to change it");
    for (const attribute of ["cell-text", "cell-model", "cell-subscribe", "range-subscribe"])
      expect(content).toContain(`data-univer-${attribute}`);
    const design = await readFile(new URL("../../cli/skill-data/html-view/references/design.md", import.meta.url), "utf8");
    const catalogIds = [...design.matchAll(/\| \[([a-z-]+)\]\(\.\.\/templates\//gu)].map((match) => match[1]);
    expect(catalogIds).toHaveLength(10);
    for (const id of catalogIds) expect(content).toContain(`- \`${id}\`.`);
  });

  it("keeps catalog IDs, templates and compact style cards in sync", async () => {
    const root = new URL("../../cli/skill-data/html-view/", import.meta.url);
    const design = await readFile(new URL("references/design.md", root), "utf8");
    const ids = [...design.matchAll(/\| \[([a-z-]+)\]\(\.\.\/templates\//gu)].map((match) => match[1]!).sort();
    expect((await readdir(new URL("templates/", root))).filter((file) => file.endsWith(".univer.html")).map((file) => file.replace(/\.univer\.html$/u, "")).sort()).toEqual(ids);
    expect((await readdir(new URL("styles/", root))).filter((file) => file.endsWith(".md")).map((file) => file.replace(/\.md$/u, "")).sort()).toEqual(ids);
    for (const id of ids) {
      const card = await readFile(new URL(`styles/${id}.md`, root), "utf8");
      const template = await readFile(new URL(`templates/${id}.univer.html`, root), "utf8");
      expect([...card].length, id).toBeLessThanOrEqual(3000);
      for (const link of template.matchAll(/<link[^>]+>/gu)) expect(card, id).toContain(link[0]);
      for (const tokens of template.matchAll(/:root\s*\{[^}]+\}/gu)) {
        if (tokens[0].includes("--")) expect(card, id).toContain(tokens[0]);
      }
      const chinese = /^Chinese pages:.*?(?= -->|$)/mu.exec(template)?.[0];
      if (chinese) expect(card, id).toContain(chinese);
    }
  });

  it("reads cards first and reserves full templates for matching data or interactions", async () => {
    for (const path of ["../skills/html-view-creator/SKILL.md", "../../cli/skill-data/html-view/SKILL.md"]) {
      const text = (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\s+/gu, " ");
      expect(text).toContain("styles/<id>.md");
      expect(text).toContain("by default");
      expect(text).toMatch(/Read the full (?:template|`templates\/)/u);
      expect(text).toContain("templates/<id>.univer.html");
      expect(text).toMatch(/only when the data's shape is close to/u);
      expect(text).toContain("page needs that template's interaction");
    }
    const creator = await readFile(new URL("../skills/html-view-creator/SKILL.md", import.meta.url), "utf8");
    for (const scenario of ["36-month cash runway", "Sales meeting; filters/target edits", "Customer delivery; status edits/insertion", "City sign-ups; first 100 entries"])
      expect(creator).toContain(`Original: ${scenario}.`);
  });

  it("guards against giant totals and stale loading text", async () => {
    const creator = (await readFile(new URL("../skills/html-view-creator/SKILL.md", import.meta.url), "utf8")).replace(/\s+/gu, " ");
    expect(creator).toContain("Do not add a strip of giant totals to every page");
    const root = new URL("../../cli/skill-data/html-view/", import.meta.url);
    for (const text of [creator, ...await Promise.all(["references/charts.md", "styles/trading-desk.md"].map(async (path) =>
      (await readFile(new URL(path, root), "utf8")).replace(/\s+/gu, " ")))]) {
      expect(text).toContain("Never put loading text inside a chart container");
      expect(text).toContain("echarts.init keeps existing children");
      expect(text).toContain("sibling or");
      expect(text).toContain("After data arrives, no placeholder text may remain");
    }
    for (const text of [creator, ...await Promise.all(["references/authoring.md", "styles/meeting-slides.md"].map(async (path) =>
      (await readFile(new URL(path, root), "utf8")).replace(/\s+/gu, " ")))]) {
      expect(text).toContain("every contributing callback calls");
      expect(text).toContain("Write placeholders only in the initial HTML");
      expect(text).toContain("never from another binding's state");
    }
  });

  it("routes shareable Workspace pages through one save tool", () => {
    const save = tools.find(({ name }) => name === "html_view_save")!;
    expect(save.description).toContain("prefer it over a local .html unless the user asks for a file");
    expect(save.description).toContain("Pass inline html by default");
    expect(save.description).toContain("the user merges in Workspace");
    expect(save.description).toContain("bindingCount");
    expect(save.description).not.toMatch(/wait|pick a style|choose by purpose/iu);
  });

  it("rejects catalog drift from the design reference", () => {
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/style-catalog.mjs", import.meta.url)), "--check"])).not.toThrow();
  });

  it("rejects invented tools in inline code while exempting explicit fields", () => {
    expect(unknownTools('Use `invented_tool` and `another_tool {"name": "page"}`.')).toEqual([
      "invented_tool", "another_tool",
    ]);
    expect(unknownTools('Use `html_view_save` with `idempotency_key`; read `skills_read {"name": "html-view"}`.')).toEqual([]);
  });
});

const workflowRules = [
  /(?:without waiting for (?:plan|style)|do not wait for the user to approve|editable pages need no approval wait|ask at most one question only (?:when|for))/iu,
  /(?:choose (?:by|from the catalog using)|select by) purpose|(?:choose from the catalog|otherwise choose).{0,120}(?:purpose|audience|data shape)|style the user named.{0,80}otherwise/iu,
  /(?:page|draft).{0,50}goes live when.{0,60}merges/iu,
  /prefer(?:ring)? (?:it|an HTML View).{0,40}(?:over|rather than).{0,20}local.{0,10}\.html/iu,
];

function duplicatedRules(content: string) {
  const text = content.replace(/\s+/gu, " ");
  return workflowRules.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

it("keeps HTML View workflow rules in the creator and CLI Skill", async () => {
  const roots = [new URL("../skills/", import.meta.url), new URL("../src/", import.meta.url),
    new URL("../../cli/skill-data/html-view/references/", import.meta.url)];
  const paths = [new URL("../README.md", import.meta.url)];
  for (const root of roots) {
    for (const file of await readdir(root, { recursive: true })) {
      if (/\.(?:md|ts)$/u.test(file)) paths.push(new URL(file, root));
    }
  }
  for (const path of paths) {
    if (path.pathname.endsWith("/skills/html-view-creator/SKILL.md")) continue;
    const rules = duplicatedRules(await readFile(path, "utf8"));
    if (path.pathname.endsWith("/tools/core/html-view-save.ts")) {
      expect(rules, path.pathname).toEqual([workflowRules[2]!.source, workflowRules[3]!.source]);
    } else expect(rules, path.pathname).toEqual([]);
  }
  const instructions = await readFile(new URL("../src/gateway/instructions.ts", import.meta.url), "utf8");
  expect(instructions.match(/For a page sharing or presenting Workspace data, use an HTML View and read the html-view-creator Skill\./gu)).toHaveLength(1);
  const core = await readFile(new URL("../skills/core/SKILL.md", import.meta.url), "utf8");
  expect(core.match(/For a page sharing or presenting Workspace data, use an HTML View and read the\s+`html-view-creator` Skill\./gu)).toHaveLength(1);
});

it.each([
  "Draft without waiting for plan or style approval.",
  "Use the style the user named; otherwise choose by purpose, audience and data shape.",
  "The page goes live when the user merges in Workspace.",
  "Prefer it over a local .html unless the user asks for a file.",
])("detects a workflow rule copied into another surface: %s", (sentence) => {
  expect(duplicatedRules(sentence).length).toBeGreaterThan(0);
});
