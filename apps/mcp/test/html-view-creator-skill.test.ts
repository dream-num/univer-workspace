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
    expect([...content].length).toBeLessThanOrEqual(9000);
    const description = /^description: (.+)$/mu.exec(content)?.[1];
    for (const routing of ["HTML View (.univer.html)", "shareable live HTML page", "dashboard", "report", "form", "Workspace Sheet data", "Prefer it over a local .html unless the user asks for a file"])
      expect(description).toContain(routing);
    expect(text).not.toMatch(/end your turn and wait|never silently choose|propose.*and wait/iu);
    expect(text).toContain("ask at most one question only for unclear purpose/data or an explicit plan/style request");
    expect(text).toContain("Design the page yourself for the data and audience by default");
    expect(text).toContain("Built-in styles are optional starting points");
    expect(text).toContain("Free design need not derive from a card or template");
    expect(text).toContain('skills_read {"name":"html-view","resource":"examples/binding-starter.univer.html"}');
    expect(text).toContain("Read the neutral binding starter by default");
    expect(text).toContain("the page goes live when the user merges in Workspace");
    expect(text).toContain("Never merge or ask to merge on their behalf");
    expect(text).toContain("Ask mode cannot save");
    expect(text).toContain("Pass inline `html` by default");
    expect(text).toContain("design name and why");
    for (const attribute of ["cell-text", "cell-model", "cell-subscribe", "range-subscribe"])
      expect(content).toContain(`data-univer-${attribute}`);
    expect(content).not.toMatch(/STYLE CATALOG|night-gauge|structurally closest/u);
    const sections = [...content.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
    expect(sections).toEqual(["Rules", "1. Read the data", "2. Declare the bindings", "3. Render every update",
      "4. Write and confirm", "5. Keep numbers in the Sheet", "6. Check the binding samples", "7. Save and reply", "8. Continue"]);
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

  it("keeps built-in cards optional and reads full templates only for their original scenario", async () => {
    for (const path of ["../skills/html-view-creator/SKILL.md", "../../cli/skill-data/html-view/SKILL.md", "../../cli/skill-data/html-view/references/design.md"]) {
      const text = (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\s+/gu, " ");
      expect(text).toContain("optional starting points");
      expect(text).toContain("styles/<id>.md");
      expect(text).toContain("templates/<id>.univer.html");
      expect(text).toContain("only when the data matches its original scenario");
      expect(text).toContain("need not derive from a card or template");
    }
  });

  it("teaches binding runtime semantics and keeps derived metrics in Sheet formulas", async () => {
    const creator = (await readFile(new URL("../skills/html-view-creator/SKILL.md", import.meta.url), "utf8")).replace(/\s+/gu, " ");
    for (const rule of ["one source attribute per element", "Fixed ranges do not grow", "zero-based coordinates",
      "Callbacks fire before the subscribe Promise resolves", "full matrix padded with null, including for empty ranges",
      "Separate subscriptions have no ordering", "binding attributes never change the DOM", "render code must replace placeholders",
      "show error states on rejection", "setCellValue(reference, value)` then `flush()", "insertRowsWithValues",
      "getWriteMode(unitId)", "data-workspace-src", "never compute Sheet metrics in page code",
      "add formula cells to the Sheet inside the session's pull request with `execute`", "`pr_create`", "`unit_add`",
      "save the draft with `repo` and `pr`", "Use these samples as the self-check"])
      expect(creator).toContain(rule);
    const authoring = (await readFile(new URL("../../cli/skill-data/html-view/references/authoring.md", import.meta.url), "utf8")).replace(/\s+/gu, " ");
    for (const rule of ["before the returned Promise resolves", "exactly the requested dimensions", "padded with null",
      "entirely empty range", "Separate subscriptions have no ordering", "Subscribe attributes never change the DOM",
      "replace initial placeholders", "echarts.init keeps existing children", "Sheet formula cells", "getWriteMode(unitId)"])
      expect(authoring).toContain(rule);
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
    expect(save.description).toContain("Built-in styles are optional starting points");
    expect(tools.find(({ name }) => name === "html_view_styles")!.description).toContain("optional starting points");
    expect(save.description).not.toMatch(/wait|pick a style|choose by purpose/iu);
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
  /design the page yourself for the data and audience by default/iu,
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
  "Design the page yourself for the data and audience by default.",
  "The page goes live when the user merges in Workspace.",
  "Prefer it over a local .html unless the user asks for a file.",
])("detects a workflow rule copied into another surface: %s", (sentence) => {
  expect(duplicatedRules(sentence).length).toBeGreaterThan(0);
});
