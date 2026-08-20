import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseWorkflow = await readFile(
  new URL("../../.github/workflows/release-cli.yml", import.meta.url),
  "utf8",
);
const deployWorkflow = await readFile(
  new URL("../../.github/workflows/push.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = await readFile(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const rootManifest = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);
const cliManifest = JSON.parse(
  await readFile(new URL("../../apps/cli/package.json", import.meta.url), "utf8"),
);

test("keeps the source version as a sentinel and exposes one SDK update command", () => {
  assert.equal(cliManifest.version, "0.0.0");
  assert.equal(rootManifest.scripts["update:sdk"], "node scripts/update-sdk-dependencies.mjs");
  assert.equal(rootManifest.scripts["sdk:update"], undefined);
});

test("defines one CI workflow for latest and insiders CLI releases", () => {
  assert.match(releaseWorkflow, /^name: Release CLI to insider-npm$/mu);
  assert.match(releaseWorkflow, /tags:\n\s+- "v0\.4\.\*"\n\s+- "!v0\.4\.\*-\*"/u);
  assert.match(releaseWorkflow, /workflow_dispatch:/u);
  assert.match(releaseWorkflow, /CHANNEL="latest"/u);
  assert.match(releaseWorkflow, /CHANNEL="insiders"/u);
  assert.match(releaseWorkflow, /GITHUB_REF_NAME.*BASE_BRANCH/u);
  assert.match(releaseWorkflow, /^  prepare:$/mu);
  assert.match(releaseWorkflow, /^  publish:$/mu);
  assert.match(releaseWorkflow, /include-hidden-files: true/u);
  assert.match(releaseWorkflow, /actions\/download-artifact@v4/u);
  assert.match(releaseWorkflow, /node scripts\/release\/publish-cli\.mjs/u);
  assert.doesNotMatch(releaseWorkflow, /CHANNEL="alpha"|Promotion|registry\.npmjs\.org/u);
});

test("deploys one existing stable 0.4.x release tag without an image bypass", () => {
  assert.match(deployWorkflow, /^name: Deploy Workspace$/mu);
  assert.match(deployWorkflow, /release_tag:\n[\s\S]*?required: true/u);
  assert.match(deployWorkflow, /ref: refs\/tags\/\$\{\{ inputs\.release_tag \}\}/u);
  assert.match(deployWorkflow, /IMAGE_TAG: \$\{\{ steps\.release\.outputs\.image_tag \}\}/u);
  assert.match(deployWorkflow, /\^v0\\\.4\\\./u);
  assert.doesNotMatch(deployWorkflow, /alpha/u);
  assert.doesNotMatch(deployWorkflow, /image-tag:|deploy-manual:/u);
});

test("keeps real package construction and smoke installation in regular CI", () => {
  assert.match(ciWorkflow, /pnpm package:workspace-cli/u);
  assert.match(ciWorkflow, /pnpm --filter univer-workspace-cli package:smoke/u);
});
