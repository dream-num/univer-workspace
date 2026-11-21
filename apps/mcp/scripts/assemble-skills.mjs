import { withStyleCatalog } from "./style-catalog.mjs";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

const target = new URL("../dist/skill-data/", import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of ["core", "html-view-creator", "skill-creator"]) {
  cpSync(new URL(`../skills/${name}/`, import.meta.url), new URL(`${name}/`, target), { recursive: true });
}
for (const name of [
  "base",
  "blob",
  "board",
  "cross-unit-formula",
  "doc",
  "embed",
  "html-view",
  "sheet",
  "slide",
]) {
  cpSync(new URL(`../../cli/skill-data/${name}/`, import.meta.url), new URL(`${name}/`, target), {
    recursive: true,
  });
}

const creator = new URL("html-view-creator/SKILL.md", target);
writeFileSync(creator, withStyleCatalog(readFileSync(creator, "utf8")));
