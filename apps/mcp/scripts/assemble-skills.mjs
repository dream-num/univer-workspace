import { cpSync, mkdirSync, rmSync } from "node:fs";

const target = new URL("../dist/skill-data/", import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(new URL("../skills/core/", import.meta.url), new URL("core/", target), { recursive: true });
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
