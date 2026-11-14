import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseHtmlViewStyles } from "../src/gateway/tools/core/html-view-styles.js";

const designUrl = new URL("../../cli/skill-data/html-view/references/design.md", import.meta.url);
const templatesUrl = new URL("../../cli/skill-data/html-view/templates/", import.meta.url);
const row = (id: string, en = "Name", zh = "名称") =>
  `| [${id}](../templates/${id}.univer.html) | ${en} | ${zh} | Calm | 沉静 | Scenario | Signature |`;
const catalog = (...rows: string[]) =>
  `## Style catalog\n\n${rows.join("\n")}\n\n## Page language\n${row("unrelated")}`;
const defaultRow = row("first", "First (default)", "首选（默认）");

describe("HTML View style catalog", () => {
  it("keeps the design.md catalog and template directory in agreement", async () => {
    const output = parseHtmlViewStyles(await readFile(designUrl, "utf8"));
    const templates = (await readdir(templatesUrl)).filter((name) => name.endsWith(".univer.html"));
    expect(output.styles.map(({ id }) => `${id}.univer.html`).sort()).toEqual(templates.sort());
  });

  it("preserves catalog order, derives the default and strips both name markers", () => {
    expect(parseHtmlViewStyles(catalog(row("second"), defaultRow))).toEqual({
      default: "first",
      styles: [
        { id: "second", name: { en: "Name", zh: "名称" }, mood: { en: "Calm", zh: "沉静" } },
        { id: "first", name: { en: "First", zh: "首选" }, mood: { en: "Calm", zh: "沉静" } },
      ],
    });
  });

  it.each([
    "## No catalog",
    catalog(row("first")),
    catalog(defaultRow, row("second", "Second (default)", "次选（默认）")),
    catalog(row("first", "First (default)", "首选")),
    catalog(defaultRow, row("first")),
    catalog(defaultRow.replace("../templates/first.univer.html", "../templates/other.univer.html")),
    catalog(defaultRow.replace(" | 沉静 |", " | |")),
    catalog(defaultRow.replace("First (default)", "(default)")),
  ])("rejects an invalid catalog %#", (source) => {
    expect(() => parseHtmlViewStyles(source)).toThrow();
  });
});
