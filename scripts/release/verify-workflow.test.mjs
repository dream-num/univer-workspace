import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public verification is a version-only product workflow using fixed shared read-only Actions", async () => {
  const source = await readFile(new URL("../../.github/workflows/verify-cli-public.yml", import.meta.url), "utf8");
  const inputs = source.match(/^    inputs:\n([\s\S]+?)\n\n/mu)?.[1];
  assert.deepEqual([...inputs.matchAll(/^      ([\w-]+):$/gmu)].map((match) => match[1]), ["version"]);
  assert.match(source, /^permissions:\n  contents: read\n  actions: read$/mu);
  assert.match(source, /repository: dream-num\/univer-workspace\n          workflow: release-cli-manual.yml/u);
  assert.match(source, /"versionPackage":"univer-workspace-cli"/u);
  const pins = [...source.matchAll(/uses: dream-num\/release-actions\/(\S+)@([0-9a-f]{40})$/gmu)];
  assert.deepEqual(pins.map((pin) => pin[1]), ["resolve-npm-source-run", "check-npm-public"]);
  assert.equal(pins[0][2], pins[1][2]);
  assert.match(source, /version: \$\{\{ steps\.release\.outputs\.version \}\}/u);
  assert.match(source, /integrity: \$\{\{ fromJSON\(steps\.release\.outputs\.batch\)\.packages\[0\]\.integrity \}\}/u);
  assert.match(source, /verify-tarball: 'true'/u);
  assert.match(source, /if: steps\.verify\.outputs\.status != 'visible_match'/u);
  assert.doesNotMatch(source, /secrets\.|id-token:|: write|npm (publish|unpublish)|run: node/u);
});
