import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const BINARY = /\.(?:png|webp|mp4|xlsx|pptx)$/u;
const HIDDEN = /(?![ \t\n\r])[\p{Cc}\p{Cf}\p{Co}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u{2800}\u{1D159}\u{FFFC}\u{FFFD}]/gu;

const hidden = (text: string) =>
  [...text.matchAll(HIDDEN)].map(([character]) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);

it("finds bidi controls, invisible characters and non-ASCII spaces", () => {
  expect(hidden("a\u{202E}b\u{200B}c\u{3164}d\u{A0}e\u{E0068}f\t g\n")).toEqual(["U+202E", "U+200B", "U+3164", "U+00A0", "U+E0068"]);
});

it("spells bidi controls and invisible characters as escapes in every tracked text file", () => {
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-files", "-z", "--stage"], { cwd: repository, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (error) {
    throw new Error(`This test reads the files git tracks, so it needs git and a git checkout at ${repository}.`, { cause: error });
  }
  // Regular files only, so symlinks and submodules drop out. A new binary format fails below with U+FFFD until BINARY
  // lists it; git's own binary guess is not used because one raw NUL would hide a whole file from it.
  const files = listing.split("\0")
    .flatMap((entry) => /^100\d{3} \S+ \d\t(.+)$/su.exec(entry)?.[1] ?? [])
    .filter((path) => !BINARY.test(path));
  for (const path of [
    "apps/workspace/contracts/http/openapi.yaml",
    "apps/workspace/web/src/app/styles/global.css",
    "apps/workspace/scripts/test-discord-bot-login.sh",
    "apps/agent/desktop/assets/icon.svg",
    "apps/agent/desktop/installer/agent.nsh",
    "apps/agent/desktop/scripts/install-windows.ps1",
    "apps/mcp/src/main.ts",
    "apps/cli/src/main.ts",
    "apps/workspace/Dockerfile",
    "apps/workspace/.env.example",
    "packages/client-core/src/index.ts",
    ".agents/skills/verify-uvw/bin/verify-uvw",
    ".agents/skills/verify-uvw/bin/seed-sales.py",
    ".dockerignore",
    "Makefile",
  ]) expect(files).toContain(path);
  const found = files.flatMap((path) =>
    readFileSync(join(repository, path), "utf8").split("\n").flatMap((line, index) =>
      hidden(line).map((code) => `${path}:${index + 1} ${code}`)));
  expect(found).toEqual([]);
});
