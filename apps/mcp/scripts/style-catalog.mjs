import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const design = new URL("../../cli/skill-data/html-view/references/design.md", import.meta.url);
const creator = new URL("../skills/html-view-creator/SKILL.md", import.meta.url);
const block = /STYLE CATALOG START\n[\s\S]*?\nSTYLE CATALOG END/u;

export function withStyleCatalog(content) {
  const catalog = readFileSync(design, "utf8").split(/^## Style catalog\s*$/mu)[1]?.split(/^## /mu)[0];
  assert(catalog, "Missing HTML View style catalog");
  const rows = catalog.split(/\r?\n/u).filter((line) => line.startsWith("| [")).map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const id = /^\[([a-z0-9-]+)\]\(\.\.\/templates\/\1\.univer\.html\)$/u.exec(cells[0])?.[1];
    assert(id && cells.length === 8 && cells[5] && cells[7], "Catalog rows need a style ID, original scenario and suitable context and data");
    const scenario = cells[5]
      .replace("Startup cash runway with a live 36-month Sheet model", "36-month cash runway")
      .replace("Weekly sales meeting with region/channel filters and editable record targets", "Sales meeting; filters/target edits")
      .replace("Customer implementation delivery tracker with status edits and task insertion", "Customer delivery; status edits/insertion")
      .replace("Public city sign-ups, counting the first 100 entries", "City sign-ups; first 100 entries");
    return `- \`${id}\`. ${cells[7]} Original: ${scenario}.`;
  });
  assert(rows.length && block.test(content), "Missing catalog rows or creator markers");
  return content.replace(block, `STYLE CATALOG START\n${rows.join("\n")}\nSTYLE CATALOG END`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = readFileSync(creator, "utf8");
  const generated = withStyleCatalog(current);
  if (process.argv.includes("--check"))
    assert.equal(current, generated, "HTML View catalog drift: run generate:style-catalog");
  else writeFileSync(creator, generated);
}
