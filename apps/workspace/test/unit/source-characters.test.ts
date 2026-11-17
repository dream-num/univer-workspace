import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const HIDDEN = /(?![ \t\n\r])[\p{Cc}\p{Cf}\p{Co}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u{2800}\u{1D159}\u{FFFC}\u{FFFD}]/gu;

const hidden = (text: string) =>
  [...text.matchAll(HIDDEN)].map(([character]) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);

it("finds bidi controls, invisible characters and non-ASCII spaces", () => {
  expect(hidden("a\u{202E}b\u{200B}c\u{3164}d\u{A0}e\u{E0068}f\t g\n")).toEqual(["U+202E", "U+200B", "U+3164", "U+00A0", "U+E0068"]);
});

it("spells bidi controls and invisible characters as escapes in server source and tests", () => {
  const files = ["server/src", "test"].flatMap((directory) =>
    readdirSync(join(workspace, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]sx?|sql|json|md|html)$/u.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name)));
  expect(files.length).toBeGreaterThan(100);
  const found = files.flatMap((path) =>
    readFileSync(path, "utf8").split("\n").flatMap((line, index) =>
      hidden(line).map((code) => `${relative(workspace, path)}:${index + 1} ${code}`)));
  expect(found).toEqual([]);
});
