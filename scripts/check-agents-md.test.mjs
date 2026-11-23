import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkAgentsMd } from "./check-agents-md.mjs";

const script = fileURLToPath(new URL("./check-agents-md.mjs", import.meta.url));

function fixture(files, untracked = {}) {
  const root = mkdtempSync(join(tmpdir(), "agents-md-"));
  for (const [file, content] of Object.entries({ ...files, ...untracked })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(
      join(root, file),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", ...Object.keys(files)], { cwd: root });
  return root;
}

const base = {
  "package.json": { scripts: { build: "true" } },
  "pnpm-workspace.yaml": 'packages:\n  - apps/*\n  # npm-managed\n  - "!apps/npm-app"\nother: 1\n',
  "apps/web/package.json": { name: "@x/web", scripts: { dev: "true" } },
  "apps/npm-app/package.json": { name: "@x/npm-app", scripts: { pack: "true" } },
  "apps/npm-app/src/index.ts": "",
  "docs/guide.md": "",
};

const broken = fixture(
  {
    ...base,
    "AGENTS.md": [
      "# Fixture",
      "[guide](docs/guide.md#intro) [site](https://example.com) [mail](mailto:a@b.c) [top](#top)",
      "[missing](docs/missing.md)",
      "`apps/web/package.json` `apps/web/gone.ts:12` `io.example/skills` `@x/web` `apps/*` `/files`",
      "`pnpm build` `pnpm install` `pnpm -r build` `pnpm run nope` `pnpm build && pnpm absent`",
      "`pnpm --filter @x/web dev` `pnpm -F @x/web gone` `pnpm --filter @x/npm-app pack`",
      "```sh",
      "pnpm build",
      "pnpm fenced-missing",
      "```",
      "Unfenced pnpm missing-outside-code and apps/unquoted/path.",
      "A span that wraps `pnpm deploy --prod",
      "--flag` before `apps/nope/`.",
    ].join("\n"),
    "apps/npm-app/AGENTS.md": "`npm run pack` `npm run absent`\n`src/index.ts` `src/gone.ts`\n",
  },
  { "apps/web/AGENTS.md": "`pnpm untracked`\n" },
);

test("reports only broken references of each kind with their line numbers", () => {
  assert.deepEqual(checkAgentsMd(broken), [
    "AGENTS.md:3: link docs/missing.md not found",
    "AGENTS.md:4: path apps/web/gone.ts not found",
    "AGENTS.md:5: pnpm-script nope not found",
    "AGENTS.md:5: pnpm-script absent not found",
    "AGENTS.md:6: pnpm-script @x/web gone not found",
    "AGENTS.md:6: pnpm-script @x/npm-app pack not found",
    "AGENTS.md:9: pnpm-script fenced-missing not found",
    "AGENTS.md:13: path apps/nope not found",
    "apps/npm-app/AGENTS.md:1: npm-script absent not found",
    "apps/npm-app/AGENTS.md:2: path src/gone.ts not found",
  ]);
});

test("the command exits 1 with the report on breaks and 0 when every reference resolves", () => {
  const failing = spawnSync(process.execPath, [script], { cwd: broken, encoding: "utf8" });
  assert.equal(failing.status, 1);
  assert.equal(failing.stdout.trim().split("\n").length, 10);
  assert.match(failing.stdout, /^AGENTS\.md:3: link docs\/missing\.md not found$/m);

  const clean = fixture({ ...base, "AGENTS.md": "[guide](docs/guide.md) `pnpm build`\n" });
  const passing = spawnSync(process.execPath, [script], { cwd: clean, encoding: "utf8" });
  assert.equal(passing.status, 0);
  assert.equal(passing.stdout, "");
});

test("the command still runs when invoked through a symlinked path", () => {
  const linked = join(mkdtempSync(join(tmpdir(), "agents-md-link-")), "check.mjs");
  symlinkSync(script, linked);
  const result = spawnSync(process.execPath, [linked], { cwd: broken, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim().split("\n").length, 10);
});
