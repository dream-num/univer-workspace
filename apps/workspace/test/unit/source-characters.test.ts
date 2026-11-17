import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const HIDDEN = /(?![ \t\n\r])[\p{Cc}\p{Cf}\p{Co}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u{2800}\u{1D159}\u{FFFC}\u{FFFD}]/gu;
const TEXT = /\.(?:[cm]?[jt]sx?|sql|json|md|mdx|html|ya?ml|css|scss|svg|sh|toml|txt)$/u;

const hidden = (text: string) =>
  [...text.matchAll(HIDDEN)].map(([character]) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);

it("finds bidi controls, invisible characters and non-ASCII spaces", () => {
  expect(hidden("a\u{202E}b\u{200B}c\u{3164}d\u{A0}e\u{E0068}f\t g\n")).toEqual(["U+202E", "U+200B", "U+3164", "U+00A0", "U+E0068"]);
});

it("spells bidi controls and invisible characters as escapes in every tracked text file", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repository, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter((path) => TEXT.test(path));
  for (const path of [
    "apps/workspace/contracts/http/openapi.yaml",
    "apps/workspace/web/src/app/styles/global.css",
    "apps/workspace/scripts/test-discord-bot-login.sh",
    "apps/agent/desktop/assets/icon.svg",
    "apps/mcp/src/main.ts",
    "apps/cli/src/main.ts",
    "packages/client-core/src/index.ts",
  ]) expect(files).toContain(path);
  const found = files.flatMap((path) =>
    readFileSync(join(repository, path), "utf8").split("\n").flatMap((line, index) =>
      hidden(line).map((code) => `${path}:${index + 1} ${code}`)));
  expect(found).toEqual([]);
});
